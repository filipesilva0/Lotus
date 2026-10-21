//! In-app updates. The web layer calls `update_check` and `update_install`; everything else
//! (endpoint, signature check, installer launch) is done by tauri-plugin-updater.
//!
//! Network: this is the only code that talks to GitHub. It runs only when the user presses
//! "Check for updates" (or has switched on the launch check), and it sends no data beyond the
//! HTTP request itself.

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

#[derive(Serialize, Clone)]
pub struct UpdateInfo {
    pub version: String,
    pub current: String,
    pub notes: Option<String>,
    pub date: Option<String>,
}

#[derive(Serialize, Clone)]
struct Progress {
    downloaded: u64,
    total: Option<u64>,
}

fn updater(app: &AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    app.updater().map_err(|e| e.to_string())
}

/// `Ok(None)` means Tomo is up to date.
#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    let found = updater(&app)?.check().await.map_err(|e| e.to_string())?;
    Ok(found.map(|u| UpdateInfo {
        version: u.version.clone(),
        current: u.current_version.clone(),
        notes: u.body.clone(),
        date: u.date.map(|d| d.to_string()),
    }))
}

/// Downloads the new installer (progress goes out as `update:progress`), verifies its signature,
/// runs it, and restarts Tomo. On Windows the installer takes over and this process exits, so a
/// successful call normally never returns to the web layer.
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<(), String> {
    let Some(update) = updater(&app)?.check().await.map_err(|e| e.to_string())? else {
        return Err("Tomo is already up to date.".into());
    };
    let mut downloaded: u64 = 0;
    let emitter = app.clone();
    update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = emitter.emit("update:progress", Progress { downloaded, total });
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    app.restart()
}
