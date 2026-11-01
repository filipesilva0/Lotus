//! macOS only: keep the traffic lights (close / minimise / zoom) centred in Lotus's own 38 px title
//! bar, level with the back / forward buttons drawn by the web layer (TitleBar.tsx, `h-[38px]`).
//!
//! `trafficLightPosition` in tauri.macos.conf.json is applied by tao only when its own content view
//! redraws. In Lotus that view sits under the web view and is rarely redrawn, and AppKit lays the
//! buttons out again on show, resize, focus and theme changes, so on a real Mac the lights stayed at
//! the system's default spot near the top edge (user report, session 12). This places them again
//! ourselves every time one of those things happens.

use tauri::AppHandle;

/// Height of the web title bar on macOS (keep in step with TitleBar.tsx).
pub const BAR_HEIGHT: f64 = 38.0;
/// Distance from the window's left edge to the close button.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub const LEFT: f64 = 16.0;

/// Top margin that centres a button of height `button` in the bar.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn top_margin(button: f64) -> f64 {
    ((BAR_HEIGHT - button) / 2.0).max(0.0).round()
}

/// Button y in its superview's coordinates, so its top edge sits `top` points below the window top.
/// AppKit views count from the bottom unless they are flipped.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn button_y(superview_height: f64, button: f64, top: f64, flipped: bool) -> f64 {
    if flipped { top } else { (superview_height - top - button).max(0.0) }
}

#[cfg(target_os = "macos")]
pub fn place_traffic_lights(app: &AppHandle) {
    use tauri::Manager;
    let Some(win) = app.get_webview_window("main") else { return };
    let w = win.clone();
    let _ = win.run_on_main_thread(move || {
        let Ok(ptr) = w.ns_window() else { return };
        if ptr.is_null() {
            return;
        }
        // SAFETY: Tauri hands out the window's live NSWindow; we are on the main thread.
        #[allow(unused_unsafe)]
        unsafe {
            use objc2_app_kit::{NSWindow, NSWindowButton, NSWindowStyleMask};
            use objc2_foundation::NSPoint;
            let ns: &NSWindow = &*(ptr as *const NSWindow);
            // Full screen shows the lights in the slide-down bar; leave them to the system there.
            if ns.styleMask().contains(NSWindowStyleMask::FullScreen) {
                return;
            }
            let (Some(close), Some(mini), Some(zoom)) = (
                ns.standardWindowButton(NSWindowButton::CloseButton),
                ns.standardWindowButton(NSWindowButton::MiniaturizeButton),
                ns.standardWindowButton(NSWindowButton::ZoomButton),
            ) else {
                return;
            };
            let Some(titlebar) = close.superview() else { return };
            let Some(container) = titlebar.superview() else { return };

            let h = close.frame().size.height;
            let top = top_margin(h);
            // The title-bar container hangs from the top of the window; make it just tall enough.
            let mut r = container.frame();
            r.size.height = h + top;
            r.origin.y = ns.frame().size.height - r.size.height;
            container.setFrame(r);

            let gap = {
                let g = mini.frame().origin.x - close.frame().origin.x;
                if g > 0.0 { g } else { 20.0 }
            };
            let sv = titlebar.frame().size.height;
            let y = button_y(sv, h, top, titlebar.isFlipped());
            for (i, b) in [close, mini, zoom].iter().enumerate() {
                b.setFrameOrigin(NSPoint::new(LEFT + i as f64 * gap, y));
            }
        }
    });
}

#[cfg(not(target_os = "macos"))]
pub fn place_traffic_lights(_app: &AppHandle) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lights_are_centred_in_the_bar() {
        // 14 pt buttons (macOS 11–15) and 16 pt ones: the button's middle lands on the bar's middle (19).
        for h in [14.0, 16.0] {
            let top = top_margin(h);
            assert!((top + h / 2.0 - BAR_HEIGHT / 2.0).abs() <= 0.5, "h={h} top={top}");
        }
        // Same top edge whichever way the superview counts.
        let top = top_margin(14.0);
        assert_eq!(button_y(26.0, 14.0, top, true), 12.0);
        assert_eq!(button_y(26.0, 14.0, top, false), 0.0);
        assert_eq!(button_y(38.0, 14.0, top, false), 12.0);
    }
}
