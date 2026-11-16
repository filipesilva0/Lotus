//! Starts and looks after `lotusd`, Lotus's background core (see `core/` at the repository root).
//!
//! The core owns Lotus's data: `lotus.db` (settings, chats, tasks, memory, skills), and the images and
//! audio saved in the Lotus Studio folder. The windows talk to it over HTTP on 127.0.0.1 with a token
//! generated here for each run; `core_info` hands both to the web layer.
//!
//! Lifetime: the core is started when Lotus starts and stops when Lotus quits. It watches its stdin,
//! which this process holds open, so it also exits if Lotus crashes. If it exits on its own it is
//! restarted (at most 5 times a minute); every successful start is announced with `core:ready`.

use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CoreInfo {
    pub port: u16,
    pub token: String,
    pub version: String,
    pub pid: u32,
}

#[derive(Deserialize)]
struct Ready {
    port: u16,
    pid: u32,
    version: String,
}

struct Running {
    child: Child,
    /// Held open for as long as the core should run; dropping it tells the core to stop.
    stdin: Option<ChildStdin>,
    info: CoreInfo,
}

#[derive(Default)]
struct Inner {
    running: Option<Running>,
    /// Why the last start failed, shown to the user instead of a silent blank.
    error: Option<String>,
    starting: bool,
    stopping: bool,
    /// Bumped by `stop`, so a watcher thread from an earlier start knows to leave.
    generation: u64,
    restarts: Vec<Instant>,
}

#[derive(Default, Clone)]
pub struct Core(Arc<Mutex<Inner>>);

/// 256 random bits from the OS, without another crate: every `RandomState` is seeded from the OS's
/// random source, and hashing through four fresh ones gives four independent 64-bit values.
pub fn new_token() -> String {
    use std::hash::{BuildHasher, Hasher};
    let mut out = String::with_capacity(64);
    for i in 0..4u64 {
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u64(i);
        h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
        out.push_str(&format!("{:016x}", h.finish()));
    }
    out
}

/// Parses the core's first stdout line.
fn parse_ready(line: &str) -> Result<Ready, String> {
    if let Some(json) = line.trim().strip_prefix("LOTUSD_READY ") {
        return serde_json::from_str(json).map_err(|e| format!("The Lotus core sent an unreadable start message: {e}"));
    }
    if let Some(json) = line.trim().strip_prefix("LOTUSD_FAILED ") {
        let v: serde_json::Value = serde_json::from_str(json).unwrap_or_default();
        return Err(v.get("error").and_then(|e| e.as_str()).unwrap_or("The Lotus core could not start.").to_string());
    }
    Err(format!("The Lotus core did not start properly (it said: {}).", line.trim().chars().take(200).collect::<String>()))
}

/// The sidecar sits next to the Lotus executable (Tauri copies `binaries/lotusd-<triple>` there as `lotusd`).
/// Linux packages are the exception: linuxdeploy (AppImage) rewrites every binary in `usr/bin`, which
/// breaks a Bun single-file executable, so the AppImage, .deb and .rpm carry it as a plain file in
/// `usr/share/lotus/lotusd` (tauri.linux.conf.json) and it is looked up there next.
fn sidecar_path() -> PathBuf {
    sidecar_in(&crate::paths::exe_dir())
}

fn sidecar_in(exe_dir: &std::path::Path) -> PathBuf {
    let name = if cfg!(windows) { "lotusd.exe" } else { "lotusd" };
    let beside = exe_dir.join(name);
    if cfg!(target_os = "linux") && !beside.exists() {
        let shared = exe_dir.join("..").join("share").join("lotus").join(name);
        if shared.exists() {
            return shared;
        }
    }
    beside
}

/// (data folder, Lotus Studio folder, the app-data folder older versions used).
fn folders(app: &AppHandle) -> (PathBuf, PathBuf, PathBuf) {
    let installed = app.path().app_data_dir().unwrap_or_default();
    let studio = crate::setup::studio_dir(app);
    let data = PathBuf::from(crate::paths::describe(installed.clone(), studio.clone()).data_dir);
    (data, studio, installed)
}

fn spawn(app: &AppHandle, token: &str) -> Result<Running, String> {
    let exe = sidecar_path();
    if !exe.exists() {
        return Err(format!("The Lotus core is missing ({}). Reinstall Lotus to restore it.", exe.display()));
    }
    let (data, studio, legacy) = folders(app);
    let mut cmd = Command::new(&exe);
    cmd.arg("--data").arg(&data).arg("--studio").arg(&studio).arg("--watch-stdin");
    if legacy != data && legacy.join("lotus.db").exists() {
        cmd.arg("--legacy-data").arg(&legacy);
    }
    cmd.env("LOTUSD_TOKEN", token);
    // The dev server's page is allowed to call the core in `tauri dev`.
    if cfg!(debug_assertions) {
        cmd.env("LOTUSD_ORIGINS", "http://127.0.0.1:3000,http://localhost:3000");
    }
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flash
    }
    let mut child = cmd.spawn().map_err(|e| format!("Could not start the Lotus core: {e}"))?;
    let stdout = child.stdout.take().ok_or("The Lotus core has no output pipe.")?;

    // Wait for the READY line, but never forever.
    let (tx, rx) = std::sync::mpsc::channel::<Result<Ready, String>>();
    std::thread::spawn(move || {
        let mut lines = BufReader::new(stdout).lines();
        let first = match lines.next() {
            Some(Ok(l)) => parse_ready(&l),
            _ => Err("The Lotus core stopped before it was ready. Its log is in the Lotus data folder (logs/lotusd.log).".to_string()),
        };
        let _ = tx.send(first);
        // Keep draining so the core never blocks on a full pipe.
        for _ in lines {}
    });
    match rx.recv_timeout(Duration::from_secs(20)) {
        Ok(Ok(r)) => Ok(Running {
            stdin: child.stdin.take(),
            child,
            info: CoreInfo { port: r.port, token: token.to_string(), version: r.version, pid: r.pid },
        }),
        Ok(Err(e)) => {
            let _ = child.kill();
            Err(e)
        }
        Err(_) => {
            let _ = child.kill();
            Err("The Lotus core took too long to start (20 s). Its log is in the Lotus data folder (logs/lotusd.log).".to_string())
        }
    }
}

impl Core {
    /// Starts the core in the background and keeps it running.
    pub fn start(&self, app: &AppHandle) {
        let token = new_token();
        let me = self.clone();
        let app = app.clone();
        {
            let mut g = self.0.lock().expect("core state");
            if g.starting || g.running.is_some() {
                return;
            }
            g.starting = true;
            g.error = None;
        }
        let gen = self.0.lock().expect("core state").generation;
        std::thread::spawn(move || me.run(app, token, gen));
    }

    fn run(&self, app: AppHandle, token: String, gen: u64) {
        loop {
            let result = spawn(&app, &token);
            {
                let mut g = self.0.lock().expect("core state");
                if g.generation != gen {
                    // Stopped while starting: don't leave this one running.
                    if let Ok(mut r) = result {
                        let _ = r.child.kill();
                    }
                    return;
                }
                g.starting = false;
                match result {
                    Ok(r) => {
                        let info = r.info.clone();
                        g.running = Some(r);
                        g.error = None;
                        drop(g);
                        // Windows that already talk to the core reconnect to the new port.
                        let _ = app.emit("core:ready", info);
                    }
                    Err(e) => {
                        g.error = Some(e.clone());
                        drop(g);
                        let _ = app.emit("core:down", e);
                        return;
                    }
                }
            }
            // Watch the process; restart it if it stops, or stops answering, while Lotus is still running.
            let mut tick: u32 = 0;
            let mut missed: u32 = 0;
            loop {
                std::thread::sleep(Duration::from_millis(500));
                tick = tick.wrapping_add(1);
                // Every 5 s: is the core still answering? A core that is alive but stuck (seen on
                // 0.8.0: no log lines, windows couldn't reach it) is stopped so it restarts.
                if tick % 10 == 0 {
                    let port = self.0.lock().ok().and_then(|g| g.running.as_ref().map(|r| r.info.port));
                    if let Some(port) = port {
                        if health_ok(port) {
                            missed = 0;
                        } else {
                            missed += 1;
                        }
                        if missed >= HEALTH_MISSES {
                            missed = 0;
                            log_line(&app, &format!("the core on port {port} didn't answer for {}s; restarting it", HEALTH_MISSES * 5));
                            if let Ok(mut g) = self.0.lock() {
                                if let Some(r) = g.running.as_mut() {
                                    let _ = r.child.kill();
                                }
                            }
                        }
                    }
                }
                let mut g = self.0.lock().expect("core state");
                if g.stopping || g.generation != gen {
                    return;
                }
                let exited = match g.running.as_mut() {
                    Some(r) => !matches!(r.child.try_wait(), Ok(None)),
                    None => true,
                };
                if !exited {
                    continue;
                }
                g.running = None;
                let now = Instant::now();
                g.restarts.retain(|t| now.duration_since(*t) < Duration::from_secs(60));
                g.restarts.push(now);
                if g.restarts.len() > 5 {
                    let msg = "The Lotus core keeps stopping. Quit and reopen Lotus; if it happens again, the log is in the Lotus data folder (logs/lotusd.log).".to_string();
                    g.error = Some(msg.clone());
                    drop(g);
                    let _ = app.emit("core:down", msg);
                    return;
                }
                g.starting = true;
                drop(g);
                let _ = app.emit("core:down", "The Lotus core stopped; restarting it.");
                break;
            }
        }
    }

    /// Waits (up to `wait`) for the core to be ready.
    pub fn info(&self, wait: Duration) -> Result<CoreInfo, String> {
        let until = Instant::now() + wait;
        loop {
            {
                let g = self.0.lock().map_err(|_| "The Lotus core state is unavailable.".to_string())?;
                if let Some(r) = &g.running {
                    return Ok(r.info.clone());
                }
                if !g.starting {
                    return Err(g.error.clone().unwrap_or_else(|| "The Lotus core is not running.".to_string()));
                }
            }
            if Instant::now() >= until {
                return Err("The Lotus core is still starting. Try again in a moment.".to_string());
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    /// Asks the core to stop (closing its stdin), then makes sure it has.
    pub fn stop(&self) {
        let running = {
            let mut g = match self.0.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            g.stopping = true;
            g.starting = false;
            g.generation += 1;
            g.running.take()
        };
        if let Some(mut r) = running {
            if let Some(mut s) = r.stdin.take() {
                let _ = s.flush();
                drop(s);
            }
            let until = Instant::now() + Duration::from_millis(2000);
            while Instant::now() < until {
                if !matches!(r.child.try_wait(), Ok(None)) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            let _ = r.child.kill();
            let _ = r.child.wait();
        }
    }

    /// Stops and starts again (after the Lotus Studio folder changes).
    pub fn restart(&self, app: &AppHandle) {
        self.stop();
        {
            let mut g = self.0.lock().expect("core state");
            g.stopping = false;
            g.restarts.clear();
        }
        self.start(app);
    }
}

/// Health checks in a row that may fail (5 s apart, each waiting up to 3 s) before the core is restarted.
const HEALTH_MISSES: u32 = 6;

/// `GET /health` on the core, with plain std networking (no token needed, reveals nothing).
fn health_ok(port: u16) -> bool {
    use std::io::Read;
    use std::net::{SocketAddr, TcpStream};
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut s) = TcpStream::connect_timeout(&addr, Duration::from_secs(3)) else { return false };
    let _ = s.set_read_timeout(Some(Duration::from_secs(3)));
    let _ = s.set_write_timeout(Some(Duration::from_secs(3)));
    if s.write_all(format!("GET /health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n").as_bytes()).is_err() {
        return false;
    }
    let mut buf = [0u8; 64];
    match s.read(&mut buf) {
        Ok(n) if n > 0 => is_ok_status(&buf[..n]),
        _ => false,
    }
}

fn is_ok_status(head: &[u8]) -> bool {
    let line = String::from_utf8_lossy(head);
    line.starts_with("HTTP/1.1 200") || line.starts_with("HTTP/1.0 200")
}

/// Appends a line to the core's own log (so a restart by the app is visible next to the core's lines).
fn log_line(app: &AppHandle, msg: &str) {
    let (data, _, _) = folders(app);
    let dir = data.join("logs");
    let _ = std::fs::create_dir_all(&dir);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("lotusd.log")) {
        let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let _ = writeln!(f, "[app {secs}] {msg}");
    }
}

/// Restarts the core now (the "Restart Core" button in the notice).
#[tauri::command]
pub async fn core_restart(app: AppHandle) -> Result<(), String> {
    let core = app.state::<Core>().inner().clone();
    log_line(&app, "restart asked for from the window");
    tauri::async_runtime::spawn_blocking(move || core.restart(&app)).await.map_err(|e| e.to_string())
}

/// Port and token for the web layer. Waits briefly while the core is starting.
#[tauri::command]
pub async fn core_info(app: AppHandle) -> Result<CoreInfo, String> {
    let core = app.state::<Core>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || core.info(Duration::from_secs(20))).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_are_long_and_unique() {
        let a = new_token();
        let b = new_token();
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn linux_packages_keep_the_core_in_share() {
        let root = std::env::temp_dir().join(format!("lotusd-path-{}", std::process::id()));
        let bin = root.join("usr").join("bin");
        let share = root.join("usr").join("share").join("lotus");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::create_dir_all(&share).unwrap();
        // Nothing beside the app: falls back to usr/share/lotus.
        std::fs::write(share.join("lotusd"), b"x").unwrap();
        assert!(sidecar_in(&bin).ends_with("share/lotus/lotusd"));
        // A copy beside the app (dev builds, tarballs) wins.
        std::fs::write(bin.join("lotusd"), b"x").unwrap();
        assert_eq!(sidecar_in(&bin), bin.join("lotusd"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn health_status_line() {
        assert!(is_ok_status(b"HTTP/1.1 200 OK\r\ncontent-type"));
        assert!(!is_ok_status(b"HTTP/1.1 503 Service Unavailable"));
        assert!(!is_ok_status(b""));
        // Nothing listening on a closed port.
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        drop(l);
        assert!(!health_ok(port));
    }

    #[test]
    fn ready_line_is_parsed() {
        let r = parse_ready("LOTUSD_READY {\"port\":53121,\"pid\":42,\"version\":\"0.1.0\"}\n").unwrap();
        assert_eq!((r.port, r.pid, r.version.as_str()), (53121, 42, "0.1.0"));
        assert_eq!(parse_ready("LOTUSD_FAILED {\"error\":\"disk full\"}").err().unwrap(), "disk full");
        assert!(parse_ready("Segmentation fault").is_err());
    }
}
