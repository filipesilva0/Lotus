//! Starts and stops the local engines Lotus talks to (Voicebox, Ollama, ComfyUI).
//! Lotus only supervises processes it started itself; anything already running is left alone.

use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::State;

#[derive(Default)]
pub struct Engines(Mutex<HashMap<String, Child>>);

#[derive(Serialize)]
pub struct Started {
    pub pid: u32,
}

#[tauri::command]
pub fn engine_start(
    state: State<Engines>,
    name: String,
    exe: String,
    args: Vec<String>,
    cwd: Option<String>,
) -> Result<Started, String> {
    let mut map = state.0.lock().unwrap();
    if let Some(child) = map.get_mut(&name) {
        if child.try_wait().map_err(|e| e.to_string())?.is_none() {
            return Ok(Started { pid: child.id() });
        }
    }

    let mut cmd = Command::new(&exe);
    cmd.args(&args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    if let Some(dir) = cwd.filter(|d| !d.is_empty()) {
        cmd.current_dir(dir);
    }
    if name == "voicebox" {
        // The Voicebox server exits on its own if Lotus disappears.
        cmd.arg("--parent-pid").arg(std::process::id().to_string());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let child = cmd.spawn().map_err(|e| format!("Could not start {exe}: {e}"))?;
    let pid = child.id();
    map.insert(name, child);
    Ok(Started { pid })
}

#[tauri::command]
pub fn engine_stop(state: State<Engines>, name: String) -> Result<(), String> {
    if let Some(mut child) = state.0.lock().unwrap().remove(&name) {
        child.kill().map_err(|e| e.to_string())?;
        let _ = child.wait();
    }
    Ok(())
}

#[derive(Serialize)]
pub struct Ping {
    pub reachable: bool,
    pub status: Option<u16>,
    pub detail: String,
}

/// Raw TCP + HTTP/1.1 GET to an engine, bypassing the web layer and the HTTP plugin entirely.
/// Used only to explain *why* an engine looks offline (nothing listening vs. blocked vs. a Lotus bug).
#[tauri::command]
pub fn engine_ping(host: String, port: u16, path: String) -> Ping {
    use std::io::{Read, Write};
    use std::net::{TcpStream, ToSocketAddrs};
    use std::time::Duration;

    let addr = match (host.as_str(), port).to_socket_addrs().ok().and_then(|mut a| a.next()) {
        Some(a) => a,
        None => return Ping { reachable: false, status: None, detail: format!("Could not resolve {host}") },
    };
    let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_millis(1500)) {
        Ok(s) => s,
        Err(e) => {
            return Ping { reachable: false, status: None, detail: format!("Nothing is listening on {host}:{port} ({e})") }
        }
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(1500)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(1500)));
    let req = format!("GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nConnection: close\r\n\r\n");
    if stream.write_all(req.as_bytes()).is_err() {
        return Ping { reachable: true, status: None, detail: "Connected, but the request could not be sent".into() };
    }
    let mut buf = [0u8; 64];
    let n = stream.read(&mut buf).unwrap_or(0);
    let head = String::from_utf8_lossy(&buf[..n]).to_string();
    let status = head.split_whitespace().nth(1).and_then(|s| s.parse::<u16>().ok());
    Ping { reachable: true, status, detail: head.lines().next().unwrap_or("").to_string() }
}

/// True when Lotus started this engine and it is still alive.
#[tauri::command]
pub fn engine_supervised(state: State<Engines>, name: String) -> bool {
    state
        .0
        .lock()
        .unwrap()
        .get_mut(&name)
        .map(|c| matches!(c.try_wait(), Ok(None)))
        .unwrap_or(false)
}

pub fn kill_all(state: &Engines) {
    for (_, mut child) in state.0.lock().unwrap().drain() {
        let _ = child.kill();
    }
}

fn env_path(var: &str, rest: &str) -> Option<PathBuf> {
    std::env::var_os(var).map(|b| PathBuf::from(b).join(rest))
}

fn on_path(exe: &str) -> Option<PathBuf> {
    std::env::var_os("PATH")
        .and_then(|paths| std::env::split_paths(&paths).map(|d| d.join(exe)).find(|p| p.is_file()))
}

/// Best-effort lookup of a known engine executable. Returns None if nothing is found,
/// in which case the UI asks the user to browse for it.
#[tauri::command]
pub fn engine_find(name: String, data_dir: Option<String>) -> Option<String> {
    let mut candidates: Vec<Option<PathBuf>> = Vec::new();
    match name.as_str() {
        "ollama" => {
            candidates.push(env_path("LOCALAPPDATA", r"Programs\Ollama\ollama.exe"));
            candidates.push(on_path("ollama.exe"));
        }
        "voicebox" => {
            if let Some(d) = data_dir {
                candidates.push(Some(PathBuf::from(&d).join(r"engines\voicebox\voicebox-server.exe")));
            }
            candidates.push(on_path("voicebox-server.exe"));
            candidates.push(env_path("LOCALAPPDATA", r"Voicebox\voicebox-server.exe"));
            candidates.push(env_path("LOCALAPPDATA", r"Programs\Voicebox\voicebox-server.exe"));
            candidates.push(env_path("ProgramFiles", r"Voicebox\voicebox-server.exe"));
        }
        _ => {}
    }
    candidates.into_iter().flatten().find(|p| p.is_file()).map(|p| p.to_string_lossy().into_owned())
}
