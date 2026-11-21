//! The composer's "+" (attach files) in the desktop app (0.19 critique #12).
//!
//! A page's `<input type="file">` opens a Windows file dialog that is not owned by the Lotus window:
//! it took focus, left Lotus behind other windows when it closed, and the window flashed a blank
//! frame while it lost focus. Here the dialog is a child of the window that asked, so it stays on top
//! of Lotus, and focus returns to Lotus when it closes. The files the user picked are read here and
//! handed to the page as base64 (only files the user chose in this dialog, capped in size).

use serde::Serialize;
use std::path::Path;
use tauri::{Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

/// The most one picked file may weigh (the page refuses larger ones anyway).
const MAX_FILE: u64 = 64 * 1024 * 1024;
/// At most this many files per pick.
const MAX_FILES: usize = 40;

#[derive(Serialize)]
pub struct Picked {
    name: String,
    /// The file's bytes, base64. Empty when it was too large to attach (`too_large`).
    data: String,
    size: u64,
    too_large: bool,
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Standard base64 with padding.
pub fn base64(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        out.push(B64[(n >> 18) as usize & 63] as char);
        out.push(B64[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { B64[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { B64[n as usize & 63] as char } else { '=' });
    }
    out
}

fn read_one(path: &Path) -> Option<Picked> {
    let name = path.file_name()?.to_string_lossy().into_owned();
    let size = std::fs::metadata(path).ok()?.len();
    if size > MAX_FILE {
        return Some(Picked { name, data: String::new(), size, too_large: true });
    }
    let bytes = std::fs::read(path).ok()?;
    Some(Picked { name, data: base64(&bytes), size, too_large: false })
}

/// Opens the file dialog over the window that asked; returns the picked files (empty when cancelled).
#[tauri::command]
pub async fn pick_files(window: WebviewWindow, title: Option<String>, images_only: Option<bool>) -> Result<Vec<Picked>, String> {
    let app = window.app_handle().clone();
    let win = window.clone();
    let paths = tauri::async_runtime::spawn_blocking(move || {
        let mut d = app.dialog().file().set_parent(&win).set_title(title.unwrap_or_else(|| "Attach files".into()));
        if images_only.unwrap_or(false) {
            d = d.add_filter("Images", &["png", "jpg", "jpeg", "webp", "gif", "bmp"]);
        }
        d.blocking_pick_files()
    })
    .await
    .map_err(|e| e.to_string())?;
    // Back to Lotus, whatever the dialog did with focus.
    let _ = window.set_focus();
    let Some(paths) = paths else { return Ok(Vec::new()) };
    tauri::async_runtime::spawn_blocking(move || {
        paths
            .into_iter()
            .take(MAX_FILES)
            .filter_map(|p| p.into_path().ok())
            .filter_map(|p| read_one(&p))
            .collect::<Vec<_>>()
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::base64;

    #[test]
    fn base64_matches_the_standard() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
        assert_eq!(base64(&[0xff, 0xfe, 0x00]), "//4A");
    }
}
