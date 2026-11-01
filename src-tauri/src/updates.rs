//! In-app updates. The web layer calls `update_check` and `update_install`; everything else
//! (endpoint, signature check, installer launch) is done by tauri-plugin-updater.
//!
//! Releases come from https://github.com/filipesilva0/Lotus (the endpoint and public key are in
//! tauri.conf.json; the release workflow signs every build and uploads latest.json).
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

/// On Linux only the AppImage can replace itself. Copies installed from the .deb or .rpm belong to
/// the system package manager, so they are told where to get the new package instead.
fn can_self_install() -> Result<(), String> {
    #[cfg(target_os = "linux")]
    if std::env::var_os("APPIMAGE").is_none() {
        return Err("This copy of Lotus was installed from a .deb or .rpm package, which Lotus cannot replace by itself. Download the new package from the Lotus website or the GitHub Releases page and install it over this one.".into());
    }
    Ok(())
}

/// `Ok(None)` means Lotus is up to date.
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
/// runs it, and restarts Lotus. On Windows the installer takes over and this process exits; on macOS
/// the .app bundle and on Linux the AppImage are swapped in place, then Lotus restarts. Either way a
/// successful call normally never returns to the web layer.
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<(), String> {
    can_self_install()?;
    let Some(update) = updater(&app)?.check().await.map_err(|e| e.to_string())? else {
        return Err("Lotus is already up to date.".into());
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
