//! Back end of the App Builder page: project files, command processes with streamed output,
//! a small static preview server, toolchain detection and Android device helpers.
//!
//! Everything here is plain `std` (no new crates). Project file access always goes through
//! `safe_join`, which refuses any path that would leave the project folder.

use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};

struct Preview {
    port: u16,
    stop: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct AppBuilder {
    procs: Mutex<HashMap<String, Arc<Mutex<Child>>>>,
    previews: Mutex<HashMap<String, Preview>>,
}

// ── helpers ────────────────────────────────────────────────────────────────

/// Runs blocking work off the UI thread.
async fn blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    match tauri::async_runtime::spawn_blocking(f).await {
        Ok(r) => r,
        Err(e) => Err(e.to_string()),
    }
}

/// `root` joined with `rel`, refusing anything that would leave `root` (`..`, drive letters,
/// `:` stream names, or a symlink that points elsewhere).
fn safe_join(root: &str, rel: &str) -> Result<PathBuf, String> {
    let base = Path::new(root)
        .canonicalize()
        .map_err(|_| format!("The project folder {root} does not exist."))?;
    let mut p = base.clone();
    for c in Path::new(rel).components() {
        match c {
            Component::Normal(x) => {
                if x.to_string_lossy().contains(':') {
                    return Err("File names cannot contain a colon.".to_string());
                }
                p.push(x);
            }
            Component::CurDir => {}
            _ => return Err("That path leaves the project folder.".to_string()),
        }
    }
    let mut anc: &Path = p.as_path();
    while !anc.exists() {
        anc = anc.parent().ok_or_else(|| "Invalid path.".to_string())?;
    }
    let real = anc.canonicalize().map_err(|e| e.to_string())?;
    if !real.starts_with(&base) {
        return Err("That path leaves the project folder.".to_string());
    }
    Ok(p)
}

fn hide_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    #[cfg(not(windows))]
    {
        let _ = cmd;
    }
}

/// A command line run through the system shell (`cmd /C` on Windows, `sh -c` elsewhere).
fn shell(command: &str) -> Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut c = Command::new("cmd");
        c.args(["/D", "/S", "/C"]).raw_arg(format!("\"{command}\""));
        c
    }
    #[cfg(not(windows))]
    {
        let mut c = Command::new("sh");
        c.arg("-c").arg(command);
        c
    }
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn b64_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b1 = if chunk.len() > 1 { chunk[1] } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] } else { 0 };
        let n = ((chunk[0] as u32) << 16) | ((b1 as u32) << 8) | (b2 as u32);
        out.push(B64[((n >> 18) & 63) as usize] as char);
        out.push(B64[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { B64[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { B64[(n & 63) as usize] as char } else { '=' });
    }
    out
}

fn b64_decode(s: &str) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(s.len() / 4 * 3);
    let mut acc: u32 = 0;
    let mut bits: u32 = 0;
    for ch in s.bytes() {
        let v: u8 = match ch {
            b'A'..=b'Z' => ch - b'A',
            b'a'..=b'z' => ch - b'a' + 26,
            b'0'..=b'9' => ch - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' | b'\n' | b'\r' | b' ' => continue,
            _ => return Err("The file data is not valid base64.".to_string()),
        };
        acc = ((acc << 6) | v as u32) & 0x00FF_FFFF;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((acc >> bits) & 0xFF) as u8);
        }
    }
    Ok(out)
}

// ── project files ──────────────────────────────────────────────────────────

const SKIP_DIRS: [&str; 8] = ["node_modules", ".git", "target", ".gradle", "Pods", ".venv", "__pycache__", ".idea"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    pub rel: String,
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
}

#[derive(Serialize)]
pub struct Tree {
    pub entries: Vec<FsEntry>,
    pub truncated: bool,
}

fn rel_string(base: &Path, path: &Path) -> String {
    path.strip_prefix(base)
        .map(|r| {
            r.components()
                .map(|c| c.as_os_str().to_string_lossy().into_owned())
                .collect::<Vec<String>>()
                .join("/")
        })
        .unwrap_or_default()
}

/// Returns true when the entry limit was hit.
fn walk(base: &Path, dir: &Path, out: &mut Vec<FsEntry>, limit: usize, depth: usize) -> bool {
    if depth > 12 {
        return false;
    }
    let rd = match std::fs::read_dir(dir) {
        Ok(r) => r,
        Err(_) => return false,
    };
    let mut items: Vec<std::fs::DirEntry> = rd.flatten().collect();
    items.sort_by_key(|e| e.file_name());
    for e in items {
        if out.len() >= limit {
            return true;
        }
        let ft = match e.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        if ft.is_symlink() {
            continue;
        }
        let name = e.file_name().to_string_lossy().into_owned();
        let path = e.path();
        if ft.is_dir() {
            if SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            out.push(FsEntry { rel: rel_string(base, &path), name, is_dir: true, size: 0 });
            if walk(base, &path, out, limit, depth + 1) {
                return true;
            }
        } else {
            let size = e.metadata().map(|m| m.len()).unwrap_or(0);
            out.push(FsEntry { rel: rel_string(base, &path), name, is_dir: false, size });
        }
    }
    false
}

/// Creates the project folder (and parents) and returns its canonical path.
#[tauri::command]
pub async fn proj_create(path: String) -> Result<String, String> {
    blocking(move || {
        std::fs::create_dir_all(&path).map_err(|e| format!("Could not create {path}: {e}"))?;
        let real = Path::new(&path).canonicalize().map_err(|e| e.to_string())?;
        Ok(real.to_string_lossy().into_owned())
    })
    .await
}

#[tauri::command]
pub async fn proj_tree(root: String, limit: Option<usize>) -> Result<Tree, String> {
    blocking(move || {
        let base = Path::new(&root)
            .canonicalize()
            .map_err(|_| format!("The project folder {root} does not exist."))?;
        let cap = limit.unwrap_or(4000).min(20000);
        let mut entries = Vec::new();
        let truncated = walk(&base, &base, &mut entries, cap, 0);
        Ok(Tree { entries, truncated })
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRead {
    pub text: Option<String>,
    pub size: u64,
    pub binary: bool,
    pub too_large: bool,
}

const READ_LIMIT: u64 = 2 * 1024 * 1024;
const WRITE_LIMIT: usize = 12 * 1024 * 1024;

#[tauri::command]
pub async fn proj_read(root: String, rel: String) -> Result<FileRead, String> {
    blocking(move || {
        let p = safe_join(&root, &rel)?;
        let meta = std::fs::metadata(&p).map_err(|_| format!("{rel} does not exist."))?;
        if meta.is_dir() {
            return Err(format!("{rel} is a folder."));
        }
        if meta.len() > READ_LIMIT {
            return Ok(FileRead { text: None, size: meta.len(), binary: false, too_large: true });
        }
        let bytes = std::fs::read(&p).map_err(|e| format!("Could not read {rel}: {e}"))?;
        if bytes.contains(&0u8) {
            return Ok(FileRead { text: None, size: meta.len(), binary: true, too_large: false });
        }
        Ok(FileRead { text: Some(String::from_utf8_lossy(&bytes).into_owned()), size: meta.len(), binary: false, too_large: false })
    })
    .await
}

/// Writes a file, creating folders as needed. `base64` = the content is base64 (for icons and other binaries).
#[tauri::command]
pub async fn proj_write(root: String, rel: String, content: String, base64: Option<bool>) -> Result<(), String> {
    blocking(move || {
        if rel.trim().is_empty() {
            return Err("A file path is required.".to_string());
        }
        let p = safe_join(&root, &rel)?;
        let bytes = if base64.unwrap_or(false) { b64_decode(&content)? } else { content.into_bytes() };
        if bytes.len() > WRITE_LIMIT {
            return Err("That file is larger than 12 MB, which is more than Lotus will write.".to_string());
        }
        if p.is_dir() {
            return Err(format!("{rel} is a folder."));
        }
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("Could not create the folder for {rel}: {e}"))?;
        }
        std::fs::write(&p, bytes).map_err(|e| format!("Could not write {rel}: {e}"))
    })
    .await
}

#[tauri::command]
pub async fn proj_mkdir(root: String, rel: String) -> Result<(), String> {
    blocking(move || {
        let p = safe_join(&root, &rel)?;
        std::fs::create_dir_all(&p).map_err(|e| format!("Could not create {rel}: {e}"))
    })
    .await
}

#[tauri::command]
pub async fn proj_delete(root: String, rel: String) -> Result<(), String> {
    blocking(move || {
        if rel.trim().is_empty() || rel == "." {
            return Err("The project folder itself cannot be deleted from here.".to_string());
        }
        let p = safe_join(&root, &rel)?;
        if p.is_dir() {
            std::fs::remove_dir_all(&p).map_err(|e| format!("Could not delete {rel}: {e}"))
        } else if p.exists() {
            std::fs::remove_file(&p).map_err(|e| format!("Could not delete {rel}: {e}"))
        } else {
            Err(format!("{rel} does not exist."))
        }
    })
    .await
}

#[tauri::command]
pub async fn proj_rename(root: String, from: String, to: String) -> Result<(), String> {
    blocking(move || {
        let a = safe_join(&root, &from)?;
        let b = safe_join(&root, &to)?;
        if !a.exists() {
            return Err(format!("{from} does not exist."));
        }
        if b.exists() {
            return Err(format!("{to} already exists."));
        }
        if let Some(parent) = b.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::rename(&a, &b).map_err(|e| format!("Could not rename {from}: {e}"))
    })
    .await
}

// ── command processes ──────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
struct ProcOut {
    id: String,
    stream: &'static str,
    data: String,
}

#[derive(Serialize, Clone)]
struct ProcExit {
    id: String,
    code: Option<i32>,
}

fn pipe_reader<R: Read + Send + 'static>(app: AppHandle, id: String, stream: &'static str, mut r: R) {
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match r.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).into_owned();
                    let _ = app.emit_to("main", "proc:output", ProcOut { id: id.clone(), stream, data });
                }
            }
        }
    });
}

fn watch(app: AppHandle, id: String, child: Arc<Mutex<Child>>) {
    std::thread::spawn(move || {
        let code = loop {
            let st = child.lock().unwrap().try_wait();
            match st {
                Ok(Some(s)) => break s.code(),
                Ok(None) => std::thread::sleep(Duration::from_millis(150)),
                Err(_) => break None,
            }
        };
        // Let the output readers drain before announcing the exit.
        std::thread::sleep(Duration::from_millis(250));
        {
            let state = app.state::<AppBuilder>();
            let mut procs = state.procs.lock().unwrap();
            let same = procs.get(&id).map(|c| Arc::ptr_eq(c, &child)).unwrap_or(false);
            if same {
                procs.remove(&id);
            }
        }
        let _ = app.emit_to("main", "proc:exit", ProcExit { id, code });
    });
}

fn kill_tree(c: &Arc<Mutex<Child>>) {
    let mut ch = c.lock().unwrap();
    #[cfg(windows)]
    {
        let mut k = Command::new("taskkill");
        let pid = ch.id().to_string();
        k.args(["/PID", pid.as_str(), "/T", "/F"]);
        hide_window(&mut k);
        let _ = k.output();
    }
    let _ = ch.kill();
}

/// Starts a shell command inside the project. Output arrives as `proc:output` events and the
/// end as `proc:exit`. Resolves with the process id.
#[tauri::command]
pub async fn proc_spawn(
    app: AppHandle,
    state: State<'_, AppBuilder>,
    id: String,
    command: String,
    root: String,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
) -> Result<u32, String> {
    let dir = safe_join(&root, cwd.as_deref().unwrap_or(""))?;
    if !dir.is_dir() {
        return Err("The working folder does not exist.".to_string());
    }
    if command.trim().is_empty() {
        return Err("There is nothing to run.".to_string());
    }
    {
        let procs = state.procs.lock().unwrap();
        if let Some(existing) = procs.get(&id) {
            if matches!(existing.lock().unwrap().try_wait(), Ok(None)) {
                return Err(format!("\"{id}\" is already running. Stop it first."));
            }
        }
    }
    let mut cmd = shell(&command);
    cmd.current_dir(&dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("BROWSER", "none")
        .env("NO_COLOR", "1")
        .env("FORCE_COLOR", "0");
    // Android tools (adb, emulator, Gradle's SDK lookup) work from the built-in terminal even when the SDK is not on PATH.
    if let Some(sdk) = android_sdk() {
        let mut dirs: Vec<PathBuf> = std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).collect();
        dirs.push(sdk.join("platform-tools"));
        dirs.push(sdk.join("emulator"));
        if let Ok(joined) = std::env::join_paths(dirs) {
            cmd.env("PATH", joined);
        }
        if std::env::var_os("ANDROID_HOME").is_none() {
            cmd.env("ANDROID_HOME", &sdk);
        }
        if std::env::var_os("ANDROID_SDK_ROOT").is_none() {
            cmd.env("ANDROID_SDK_ROOT", &sdk);
        }
    }
    if let Some(vars) = env {
        for (k, v) in vars {
            cmd.env(k, v);
        }
    }
    hide_window(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| format!("Could not run the command: {e}"))?;
    let pid = child.id();
    if let Some(o) = child.stdout.take() {
        pipe_reader(app.clone(), id.clone(), "out", o);
    }
    if let Some(e) = child.stderr.take() {
        pipe_reader(app.clone(), id.clone(), "err", e);
    }
    let child = Arc::new(Mutex::new(child));
    state.procs.lock().unwrap().insert(id.clone(), child.clone());
    watch(app, id, child);
    Ok(pid)
}

#[tauri::command]
pub async fn proc_kill(state: State<'_, AppBuilder>, id: String) -> Result<(), String> {
    let child = state.procs.lock().unwrap().get(&id).cloned();
    if let Some(c) = child {
        kill_tree(&c);
    }
    Ok(())
}

#[tauri::command]
pub fn proc_running(state: State<'_, AppBuilder>) -> Vec<String> {
    state.procs.lock().unwrap().keys().cloned().collect()
}

pub fn kill_all(state: &AppBuilder) {
    let all: Vec<Arc<Mutex<Child>>> = state.procs.lock().unwrap().values().cloned().collect();
    for c in all {
        kill_tree(&c);
    }
    for (_, p) in state.previews.lock().unwrap().drain() {
        p.stop.store(true, Ordering::Relaxed);
    }
}

// ── static preview server ──────────────────────────────────────────────────

#[derive(Serialize)]
pub struct PreviewInfo {
    pub port: u16,
    pub url: String,
}

fn preview_info(port: u16) -> PreviewInfo {
    PreviewInfo { port, url: format!("http://127.0.0.1:{port}/") }
}

const RELOAD_JS: &str = "<script>(function(){var t=null;async function p(){try{var r=await fetch('/__lotus/reload',{cache:'no-store'});var v=await r.text();if(t!==null&&v!==t){location.reload();return;}t=v;}catch(e){}setTimeout(p,800);}p();})();</script>";

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            let hex = std::str::from_utf8(&b[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok());
            if let Some(v) = hex {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn mime_for(p: &Path) -> &'static str {
    let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "webmanifest" => "application/manifest+json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "txt" | "md" => "text/plain; charset=utf-8",
        "wasm" => "application/wasm",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        _ => "application/octet-stream",
    }
}

fn newest_mtime(dir: &Path, budget: &mut usize, depth: usize) -> u64 {
    let mut newest = 0u64;
    if depth > 8 {
        return newest;
    }
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            if *budget == 0 {
                break;
            }
            *budget -= 1;
            let ft = match e.file_type() {
                Ok(t) => t,
                Err(_) => continue,
            };
            if ft.is_symlink() {
                continue;
            }
            if ft.is_dir() {
                let name = e.file_name().to_string_lossy().into_owned();
                if SKIP_DIRS.contains(&name.as_str()) {
                    continue;
                }
                newest = newest.max(newest_mtime(&e.path(), budget, depth + 1));
            } else if let Ok(m) = e.metadata().and_then(|m| m.modified()) {
                let ms = m.duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
                newest = newest.max(ms);
            }
        }
    }
    newest
}

fn respond(s: &mut TcpStream, code: u16, mime: &str, body: &[u8], head_only: bool) -> std::io::Result<()> {
    let reason = match code {
        200 => "OK",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Error",
    };
    let head = format!(
        "HTTP/1.1 {code} {reason}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    );
    s.write_all(head.as_bytes())?;
    if !head_only {
        s.write_all(body)?;
    }
    s.flush()
}

fn with_reload(body: Vec<u8>) -> Vec<u8> {
    let text = String::from_utf8_lossy(&body).into_owned();
    let lower = text.to_lowercase();
    match lower.rfind("</body>") {
        Some(i) if text.is_char_boundary(i) => format!("{}{}{}", &text[..i], RELOAD_JS, &text[i..]).into_bytes(),
        _ => format!("{text}{RELOAD_JS}").into_bytes(),
    }
}

fn serve_one(mut s: TcpStream, dir: &Path) -> std::io::Result<()> {
    s.set_nonblocking(false)?;
    s.set_read_timeout(Some(Duration::from_secs(5)))?;
    s.set_write_timeout(Some(Duration::from_secs(10)))?;
    let mut buf = [0u8; 8192];
    let n = s.read(&mut buf)?;
    let head = String::from_utf8_lossy(&buf[..n]).into_owned();
    let mut parts = head.lines().next().unwrap_or("").split_whitespace();
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("/");
    let head_only = method == "HEAD";
    if method != "GET" && !head_only {
        return respond(&mut s, 405, "text/plain", b"Method not allowed", false);
    }
    let path_only = target.split(|c: char| c == '?' || c == '#').next().unwrap_or("/");
    if path_only == "/__lotus/reload" {
        let mut budget = 3000usize;
        let v = newest_mtime(dir, &mut budget, 0).to_string();
        return respond(&mut s, 200, "text/plain", v.as_bytes(), head_only);
    }
    let decoded = percent_decode(path_only);
    let mut file = dir.to_path_buf();
    for seg in decoded.split('/') {
        if seg.is_empty() || seg == "." {
            continue;
        }
        if seg == ".." || seg.contains('\\') || seg.contains(':') {
            return respond(&mut s, 403, "text/plain", b"Forbidden", head_only);
        }
        file.push(seg);
    }
    if file.is_dir() {
        file.push("index.html");
    }
    match std::fs::read(&file) {
        Ok(body) => {
            let mime = mime_for(&file);
            let body = if mime.starts_with("text/html") { with_reload(body) } else { body };
            respond(&mut s, 200, mime, &body, head_only)
        }
        Err(_) => {
            let page = b"<!doctype html><meta charset=utf-8><body style=\"font:14px system-ui;padding:2rem;color:#555\"><h3>Not found</h3><p>This file does not exist in the project yet.</p></body>";
            respond(&mut s, 404, "text/html; charset=utf-8", page, head_only)
        }
    }
}

fn accept_loop(listener: TcpListener, dir: PathBuf, stop: Arc<AtomicBool>) {
    while !stop.load(Ordering::Relaxed) {
        match listener.accept() {
            Ok((stream, _)) => {
                let d = dir.clone();
                std::thread::spawn(move || {
                    let _ = serve_one(stream, &d);
                });
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(25)),
            Err(_) => std::thread::sleep(Duration::from_millis(100)),
        }
    }
}

/// Serves a project folder on 127.0.0.1 (random free port). HTML pages reload by themselves when a file changes.
#[tauri::command]
pub async fn preview_serve(state: State<'_, AppBuilder>, root: String, dir: Option<String>) -> Result<PreviewInfo, String> {
    let dir_path = safe_join(&root, dir.as_deref().unwrap_or(""))?;
    if !dir_path.is_dir() {
        return Err("That folder does not exist.".to_string());
    }
    let key = dir_path.to_string_lossy().into_owned();
    {
        let map = state.previews.lock().unwrap();
        if let Some(p) = map.get(&key) {
            return Ok(preview_info(p.port));
        }
    }
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("Could not start the preview server: {e}"))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let stop = Arc::new(AtomicBool::new(false));
    let flag = stop.clone();
    let served = dir_path.clone();
    std::thread::spawn(move || accept_loop(listener, served, flag));
    state.previews.lock().unwrap().insert(key, Preview { port, stop });
    Ok(preview_info(port))
}

#[tauri::command]
pub async fn preview_stop(state: State<'_, AppBuilder>, root: String, dir: Option<String>) -> Result<(), String> {
    let dir_path = safe_join(&root, dir.as_deref().unwrap_or(""))?;
    let key = dir_path.to_string_lossy().into_owned();
    let removed = state.previews.lock().unwrap().remove(&key);
    if let Some(p) = removed {
        p.stop.store(true, Ordering::Relaxed);
    }
    Ok(())
}

// ── toolchain detection ────────────────────────────────────────────────────

fn android_sdk() -> Option<PathBuf> {
    for v in ["ANDROID_HOME", "ANDROID_SDK_ROOT"] {
        if let Some(p) = std::env::var_os(v) {
            let p = PathBuf::from(p);
            if p.is_dir() {
                return Some(p);
            }
        }
    }
    std::env::var_os("LOCALAPPDATA")
        .map(|b| PathBuf::from(b).join("Android").join("Sdk"))
        .filter(|p| p.is_dir())
}

fn sdk_tool(sub: &str, name: &str) -> Option<PathBuf> {
    let exe = if cfg!(windows) { format!("{name}.exe") } else { name.to_string() };
    android_sdk().map(|s| s.join(sub).join(exe)).filter(|p| p.is_file())
}

fn adb() -> Command {
    let mut c = Command::new(sdk_tool("platform-tools", "adb").unwrap_or_else(|| PathBuf::from("adb")));
    hide_window(&mut c);
    c
}

fn adb_line() -> String {
    match sdk_tool("platform-tools", "adb") {
        Some(p) => format!("\"{}\"", p.to_string_lossy()),
        None => "adb".to_string(),
    }
}

#[derive(Serialize)]
pub struct Tool {
    pub id: String,
    pub found: bool,
    pub version: String,
}

/// Runs a version command; gives up after 8 seconds.
fn probe(cmdline: &str) -> (bool, String) {
    let line = cmdline.to_string();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut c = shell(&line);
        c.stdin(Stdio::null());
        hide_window(&mut c);
        let _ = tx.send(c.output());
    });
    match rx.recv_timeout(Duration::from_secs(8)) {
        Ok(Ok(o)) => {
            let raw = if o.stdout.is_empty() { o.stderr } else { o.stdout };
            let text = String::from_utf8_lossy(&raw).into_owned();
            let first = text.lines().next().unwrap_or("").trim().to_string();
            (o.status.success() && !first.is_empty(), first)
        }
        _ => (false, String::new()),
    }
}

/// Which build tools are installed (so the UI can say what a target still needs).
#[tauri::command]
pub async fn toolchain_check() -> Result<Vec<Tool>, String> {
    blocking(|| {
        let checks: Vec<(&str, String)> = vec![
            ("node", "node --version".to_string()),
            ("npm", "npm --version".to_string()),
            ("git", "git --version".to_string()),
            ("python", "python --version".to_string()),
            ("cargo", "cargo --version".to_string()),
            ("rustc", "rustc --version".to_string()),
            ("java", "java -version".to_string()),
            ("dotnet", "dotnet --version".to_string()),
            ("adb", format!("{} version", adb_line())),
        ];
        let handles: Vec<std::thread::JoinHandle<Tool>> = checks
            .into_iter()
            .map(|(id, line)| {
                let id = id.to_string();
                std::thread::spawn(move || {
                    let (found, version) = probe(&line);
                    Tool { id, found, version }
                })
            })
            .collect();
        Ok(handles.into_iter().filter_map(|h| h.join().ok()).collect())
    })
    .await
}

// ── Android devices ────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct AndroidPaths {
    pub sdk: Option<String>,
    pub adb: Option<String>,
    pub emulator: Option<String>,
}

#[tauri::command]
pub fn android_paths() -> AndroidPaths {
    AndroidPaths {
        sdk: android_sdk().map(|p| p.to_string_lossy().into_owned()),
        adb: sdk_tool("platform-tools", "adb").map(|p| p.to_string_lossy().into_owned()),
        emulator: sdk_tool("emulator", "emulator").map(|p| p.to_string_lossy().into_owned()),
    }
}

#[derive(Serialize)]
pub struct AdbDevice {
    pub serial: String,
    pub state: String,
    pub model: String,
}

#[tauri::command]
pub async fn adb_devices() -> Result<Vec<AdbDevice>, String> {
    blocking(|| {
        let mut c = adb();
        c.args(["devices", "-l"]);
        let o = c.output().map_err(|e| format!("Could not run adb: {e}"))?;
        let text = String::from_utf8_lossy(&o.stdout).into_owned();
        let list: Vec<AdbDevice> = text
            .lines()
            .skip(1)
            .filter_map(|l| {
                let mut it = l.split_whitespace();
                let serial = it.next()?;
                let state = it.next()?;
                if state != "device" && state != "offline" && state != "unauthorized" {
                    return None;
                }
                let model = l
                    .split("model:")
                    .nth(1)
                    .and_then(|m| m.split_whitespace().next())
                    .unwrap_or("")
                    .to_string();
                Some(AdbDevice { serial: serial.to_string(), state: state.to_string(), model })
            })
            .collect();
        Ok(list)
    })
    .await
}

#[tauri::command]
pub async fn emulator_avds() -> Result<Vec<String>, String> {
    blocking(|| {
        let exe = match sdk_tool("emulator", "emulator") {
            Some(p) => p,
            None => return Ok(Vec::new()),
        };
        let mut c = Command::new(exe);
        c.arg("-list-avds");
        hide_window(&mut c);
        let o = c.output().map_err(|e| format!("Could not run the emulator: {e}"))?;
        let text = String::from_utf8_lossy(&o.stdout).into_owned();
        Ok(text.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty() && !l.contains(' ')).collect())
    })
    .await
}

/// One screenshot of the device as base64 PNG.
#[tauri::command]
pub async fn adb_screenshot(serial: String) -> Result<String, String> {
    blocking(move || {
        let mut c = adb();
        c.args(["-s", serial.as_str(), "exec-out", "screencap", "-p"]);
        let o = c.output().map_err(|e| format!("Could not run adb: {e}"))?;
        if !o.status.success() || o.stdout.len() < 100 {
            let why = String::from_utf8_lossy(&o.stderr).trim().to_string();
            return Err(if why.is_empty() { "The device did not return a screenshot.".to_string() } else { why });
        }
        Ok(b64_encode(&o.stdout))
    })
    .await
}

#[tauri::command]
pub async fn adb_tap(serial: String, x: u32, y: u32) -> Result<(), String> {
    blocking(move || {
        let (xs, ys) = (x.to_string(), y.to_string());
        let mut c = adb();
        c.args(["-s", serial.as_str(), "shell", "input", "tap", xs.as_str(), ys.as_str()]);
        c.output().map(|_| ()).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn adb_swipe(serial: String, x1: u32, y1: u32, x2: u32, y2: u32, ms: u32) -> Result<(), String> {
    blocking(move || {
        let a = [x1.to_string(), y1.to_string(), x2.to_string(), y2.to_string(), ms.to_string()];
        let mut c = adb();
        c.args(["-s", serial.as_str(), "shell", "input", "swipe"]);
        for v in a.iter() {
            c.arg(v.as_str());
        }
        c.output().map(|_| ()).map_err(|e| e.to_string())
    })
    .await
}

/// Android key codes: 3 Home, 4 Back, 187 Recents.
#[tauri::command]
pub async fn adb_key(serial: String, code: u32) -> Result<(), String> {
    blocking(move || {
        let ks = code.to_string();
        let mut c = adb();
        c.args(["-s", serial.as_str(), "shell", "input", "keyevent", ks.as_str()]);
        c.output().map(|_| ()).map_err(|e| e.to_string())
    })
    .await
}

