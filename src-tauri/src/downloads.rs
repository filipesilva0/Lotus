//! Downloads model files (image checkpoints, LoRAs) into a folder the user chose.
//!
//! Ollama and Voicebox download their own models; ComfyUI has no download API of its own, so Lotus
//! fetches the file itself. The request is made from Rust (not the web layer), only over https, only
//! when the user pressed Download, and the file is written to `<name>.lotus-part` first so a cancelled
//! or failed download never leaves a half-written model that ComfyUI would try to load.

use serde::Serialize;
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_http::reqwest;

#[derive(Default)]
pub struct Downloads(Mutex<HashMap<String, Arc<AtomicBool>>>);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    id: String,
    received: u64,
    total: Option<u64>,
    done: bool,
    error: Option<String>,
    path: Option<String>,
}

fn emit(app: &AppHandle, p: Progress) {
    let _ = app.emit("download:progress", p);
}

const ALLOWED_EXT: [&str; 8] = ["safetensors", "ckpt", "pt", "pth", "bin", "gguf", "sft", "onnx"];

fn check_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > 200 {
        return Err("Give the file a name (up to 200 characters).".to_string());
    }
    if name.contains('/') || name.contains('\\') || name.contains(':') || name.contains("..") {
        return Err("The file name cannot contain folders or special characters.".to_string());
    }
    let ext = Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if !ALLOWED_EXT.contains(&ext.as_str()) {
        return Err(format!(
            "Model files end in one of: {}. This name ends in \"{}\".",
            ALLOWED_EXT.join(", "),
            ext
        ));
    }
    Ok(())
}

fn http_hint(status: u16) -> String {
    match status {
        401 | 403 => format!(
            "The server refused the download (HTTP {status}). Gated Hugging Face models and many Civitai files need an access token: paste one in the token field and try again."
        ),
        404 => "The server says that file does not exist (HTTP 404). Check the link.".to_string(),
        429 => "The server is rate limiting you (HTTP 429). Wait a few minutes and try again.".to_string(),
        s => format!("The server answered HTTP {s} instead of sending the file."),
    }
}

async fn stream_to_file(
    app: &AppHandle,
    id: &str,
    url: &str,
    token: Option<String>,
    part: &Path,
    cancel: &Arc<AtomicBool>,
) -> Result<u64, String> {
    let client = reqwest::Client::builder()
        .user_agent("Lotus/0.1 (model download started by the user)")
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client.get(url);
    if let Some(t) = token.filter(|t| !t.trim().is_empty()) {
        req = req.bearer_auth(t.trim());
    }
    let mut resp = req.send().await.map_err(|e| format!("Could not connect: {e}"))?;
    if !resp.status().is_success() {
        return Err(http_hint(resp.status().as_u16()));
    }
    let is_page = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|ct| ct.starts_with("text/html"))
        .unwrap_or(false);
    if is_page {
        return Err("That link opens a web page, not a file. Use the file's direct download link (on Hugging Face, the one under \"resolve\").".to_string());
    }
    let total = resp.content_length();
    let mut file = std::fs::File::create(part).map_err(|e| format!("Could not create the file: {e}"))?;
    let mut received: u64 = 0;
    let mut last = Instant::now();
    emit(app, Progress { id: id.to_string(), received, total, done: false, error: None, path: None });
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err("Cancelled".to_string());
        }
        match resp.chunk().await {
            Ok(Some(bytes)) => {
                file.write_all(&bytes).map_err(|e| format!("Could not write to disk: {e}"))?;
                received += bytes.len() as u64;
                if last.elapsed() >= Duration::from_millis(250) {
                    last = Instant::now();
                    emit(app, Progress { id: id.to_string(), received, total, done: false, error: None, path: None });
                }
            }
            Ok(None) => break,
            Err(e) => return Err(format!("The download was interrupted: {e}")),
        }
    }
    file.flush().map_err(|e| e.to_string())?;
    if let Some(t) = total {
        if t != received {
            return Err(format!("The download ended early ({received} of {t} bytes). Try again."));
        }
    }
    Ok(received)
}

/// Downloads `url` to `<dest_dir>/<file_name>`. Resolves with the final path.
#[tauri::command]
pub async fn download_start(
    app: AppHandle,
    state: State<'_, Downloads>,
    id: String,
    url: String,
    dest_dir: String,
    file_name: String,
    token: Option<String>,
) -> Result<String, String> {
    let fail = |app: &AppHandle, id: &str, msg: String| -> String {
        emit(app, Progress { id: id.to_string(), received: 0, total: None, done: true, error: Some(msg.clone()), path: None });
        msg
    };
    if !url.starts_with("https://") {
        return Err(fail(&app, &id, "Only https:// links can be downloaded.".to_string()));
    }
    if let Err(m) = check_name(&file_name) {
        return Err(fail(&app, &id, m));
    }
    let dir = PathBuf::from(&dest_dir);
    if !dir.is_dir() {
        // Create the last folder (for example "loras") when its parent exists; never a whole new tree.
        let parent_ok = dir.parent().map(|p| p.is_dir()).unwrap_or(false);
        if !parent_ok || std::fs::create_dir(&dir).is_err() {
            return Err(fail(&app, &id, format!("The folder {dest_dir} does not exist.")));
        }
    }
    let target = dir.join(&file_name);
    if target.exists() {
        return Err(fail(&app, &id, format!("{file_name} is already in that folder.")));
    }
    let part = dir.join(format!("{file_name}.lotus-part"));

    let cancel = Arc::new(AtomicBool::new(false));
    state.0.lock().unwrap().insert(id.clone(), cancel.clone());
    let result = stream_to_file(&app, &id, &url, token, &part, &cancel).await;
    state.0.lock().unwrap().remove(&id);

    match result {
        Ok(received) => match std::fs::rename(&part, &target) {
            Ok(()) => {
                let path = target.to_string_lossy().into_owned();
                emit(&app, Progress { id, received, total: Some(received), done: true, error: None, path: Some(path.clone()) });
                Ok(path)
            }
            Err(e) => {
                let _ = std::fs::remove_file(&part);
                Err(fail(&app, &id, format!("Could not finish the file: {e}")))
            }
        },
        Err(msg) => {
            let _ = std::fs::remove_file(&part);
            Err(fail(&app, &id, msg))
        }
    }
}

#[tauri::command]
pub fn download_cancel(state: State<'_, Downloads>, id: String) {
    if let Some(flag) = state.0.lock().unwrap().get(&id) {
        flag.store(true, Ordering::Relaxed);
    }
}

/// Looks for ComfyUI's `models` folder starting from the launcher the user located
/// (a .bat/.exe inside the ComfyUI folder, or the portable package's root).
#[tauri::command]
pub async fn comfy_models_dir(launcher: String) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || find_models(&launcher)).await.ok().flatten()
}

fn find_models(launcher: &str) -> Option<String> {
    let start = Path::new(launcher);
    let mut dir = if start.is_dir() { Some(start.to_path_buf()) } else { start.parent().map(|p| p.to_path_buf()) };
    for _ in 0..4 {
        let d = dir?;
        for rel in ["models", "ComfyUI/models", "ComfyUI_windows_portable/ComfyUI/models"] {
            let cand = d.join(rel);
            if cand.join("checkpoints").is_dir() {
                return Some(cand.to_string_lossy().into_owned());
            }
        }
        dir = d.parent().map(|p| p.to_path_buf());
    }
    None
}

/// File names in a folder (used to show which downloaded models are already on disk).
#[tauri::command]
pub async fn list_model_files(dir: String) -> Vec<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut out: Vec<String> = match std::fs::read_dir(&dir) {
            Ok(rd) => rd
                .flatten()
                .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .filter(|n| !n.ends_with(".lotus-part"))
                .collect(),
            Err(_) => Vec::new(),
        };
        out.sort();
        out
    })
    .await
    .unwrap_or_default()
}
