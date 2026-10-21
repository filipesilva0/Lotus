//! The floating island window: a small transparent, always-on-top window pinned to the
//! top centre of the primary monitor. The web layer owns all animation and tells us the
//! size it needs; we resize and re-centre the native window to match.

use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition, WebviewWindow};

const TOP_MARGIN: f64 = 6.0;

fn island(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window("island").ok_or_else(|| "island window missing".to_string())
}

fn place(w: &WebviewWindow, logical_width: f64) -> Result<(), String> {
    let mon = w
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .or(w.current_monitor().map_err(|e| e.to_string())?)
        .ok_or("no monitor")?;
    let scale = mon.scale_factor();
    let origin = mon.position();
    let width_px = mon.size().width as f64;
    let x = origin.x as f64 + (width_px - logical_width * scale) / 2.0;
    let y = origin.y as f64 + TOP_MARGIN * scale;
    w.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn island_resize(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    let w = island(&app)?;
    let (cw, ch) = (width.clamp(96.0, 960.0), height.clamp(28.0, 960.0));
    w.set_size(LogicalSize::new(cw, ch)).map_err(|e| e.to_string())?;
    place(&w, cw)
}

#[tauri::command]
pub fn island_show(app: AppHandle) -> Result<(), String> {
    let w = island(&app)?;
    w.show().map_err(|e| e.to_string())?;
    w.set_always_on_top(true).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn island_hide(app: AppHandle) -> Result<(), String> {
    island(&app)?.hide().map_err(|e| e.to_string())
}

/// Give the island keyboard focus (needed when the chat opens so you can type immediately).
#[tauri::command]
pub fn island_focus(app: AppHandle) -> Result<(), String> {
    island(&app)?.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn island_visible(app: AppHandle) -> bool {
    island(&app).and_then(|w| w.is_visible().map_err(|e| e.to_string())).unwrap_or(false)
}
