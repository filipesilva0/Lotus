//! The floating island window: a small transparent, always-on-top window pinned to the
//! top centre of a monitor. The web layer owns all animation and tells us the size it needs;
//! we resize and re-centre the native window to match.
//!
//! 0.23: a watcher thread notices when the mouse rests against the top centre of any screen and
//! tells the island to open there ("island:wake"), so the island follows the screen you are using.
//! It also reports copied text ("island:clip", Windows only, off unless the user turns it on).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewWindow};

/// Session 16: flush with the top edge, so the island reads as growing out of the screen's top
/// (the notch on a MacBook), like the Dynamic Island.
const TOP_MARGIN: f64 = 0.0;
/// How close to the top edge, and how far either side of the centre, counts as "reaching for it" (logical px).
const EDGE_PX: f64 = 3.0;
const HALF_WIDTH: f64 = 180.0;
/// The mouse must rest there this long (a quick pass to a browser tab doesn't open it).
const DWELL_TICKS: u32 = 3;
const TICK: Duration = Duration::from_millis(90);

static WAKE: AtomicBool = AtomicBool::new(false);
static CLIP: AtomicBool = AtomicBool::new(false);
static STARTED: OnceLock<()> = OnceLock::new();
/// The monitor the island lives on: (x, y, width in px, scale). None = the primary monitor.
static SCREEN: Mutex<Option<(i32, i32, u32, f64)>> = Mutex::new(None);

fn island(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window("island").ok_or_else(|| "island window missing".to_string())
}

fn primary(w: &WebviewWindow) -> Result<(i32, i32, u32, f64), String> {
    let mon = w
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .or(w.current_monitor().map_err(|e| e.to_string())?)
        .ok_or("no monitor")?;
    Ok((mon.position().x, mon.position().y, mon.size().width, mon.scale_factor()))
}

fn place(w: &WebviewWindow, logical_width: f64) -> Result<(), String> {
    let saved = *SCREEN.lock().map_err(|e| e.to_string())?;
    let (ox, oy, width_px, scale) = match saved {
        Some(s) => s,
        None => primary(w)?,
    };
    let x = ox as f64 + (width_px as f64 - logical_width * scale) / 2.0;
    let y = oy as f64 + TOP_MARGIN * scale;
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

/// 0.23: what to watch for. `wake`: the mouse at the top centre of a screen. `clipboard`: copied text.
#[tauri::command]
pub fn island_watch(app: AppHandle, wake: bool, clipboard: bool) {
    WAKE.store(wake, Ordering::SeqCst);
    CLIP.store(clipboard, Ordering::SeqCst);
    if (wake || clipboard) && STARTED.set(()).is_ok() {
        std::thread::Builder::new()
            .name("island-watch".into())
            .spawn(move || watch(app))
            .ok();
    }
}

/// Is `(x, y)` (physical px) against the top edge of this monitor, near its centre?
pub fn at_top_centre(x: f64, y: f64, mon: (i32, i32, u32, f64)) -> bool {
    let (ox, oy, w, scale) = mon;
    let centre = ox as f64 + w as f64 / 2.0;
    x >= ox as f64 && x < ox as f64 + w as f64 && y >= oy as f64 && y <= oy as f64 + EDGE_PX * scale && (x - centre).abs() <= HALF_WIDTH * scale
}

fn watch(app: AppHandle) {
    let mut dwell = 0u32;
    let mut fired = false;
    let mut clip_seq = crate::media::clip_sequence();
    let mut clip_tick = 0u32;
    loop {
        std::thread::sleep(TICK);
        if WAKE.load(Ordering::SeqCst) {
            let hit = app.cursor_position().ok().and_then(|p| {
                app.available_monitors().ok()?.into_iter().map(|m| (m.position().x, m.position().y, m.size().width, m.scale_factor())).find(|m| at_top_centre(p.x, p.y, *m))
            });
            match hit {
                Some(mon) => {
                    dwell += 1;
                    if dwell >= DWELL_TICKS && !fired {
                        fired = true;
                        if let Ok(mut s) = SCREEN.lock() {
                            *s = Some(mon);
                        }
                        if let Ok(w) = island(&app) {
                            let width = w.outer_size().map(|s| s.width as f64 / mon.3).unwrap_or(440.0);
                            let _ = place(&w, width);
                        }
                        let _ = app.emit_to("island", "island:wake", ());
                    }
                }
                None => {
                    dwell = 0;
                    fired = false;
                }
            }
        }
        // Copied text: checked about every half second.
        clip_tick += 1;
        if clip_tick >= 5 {
            clip_tick = 0;
            let seq = crate::media::clip_sequence();
            if seq != clip_seq {
                clip_seq = seq;
                if CLIP.load(Ordering::SeqCst) {
                    if let Some(text) = crate::media::clip_text_checked() {
                        let _ = app.emit_to("island", "island:clip", serde_json::json!({ "text": text }));
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::at_top_centre;

    #[test]
    fn top_centre_of_each_screen() {
        let main = (0, 0, 2560, 1.25);
        let side = (2560, -200, 1920, 1.0);
        assert!(at_top_centre(1280.0, 0.0, main));
        assert!(at_top_centre(1280.0 + 200.0, 2.0, main));
        assert!(!at_top_centre(1280.0 + 300.0, 0.0, main));
        assert!(!at_top_centre(1280.0, 40.0, main));
        assert!(at_top_centre(2560.0 + 960.0, -200.0, side));
        assert!(!at_top_centre(2560.0 + 960.0, 0.0, side));
    }
}
