// Microphone on Windows (0.14.1, T63).
//
// WebView2 asks its host before a page may use the microphone. wry (Tauri's webview layer) answers
// only clipboard requests, so a microphone request was left to WebView2's own prompt, which never
// showed in Lotus's frameless, transparent windows: the request ended inside WebView2, Lotus never
// reached Windows (it didn't even appear under Settings → Privacy → Microphone), and the app said it
// couldn't find a microphone. Here Lotus answers itself: its own pages may use the microphone; Windows'
// privacy settings still decide whether desktop apps get it at all. Nothing else is granted.

/// Whether a page address is one of Lotus's own pages (the app's built-in pages; the dev server only in
/// debug builds). Pages from anywhere else get WebView2's default answer.
#[cfg_attr(not(windows), allow(dead_code))] // used by the Windows handler and the tests
pub fn is_own_page(uri: &str) -> bool {
    let u = uri.to_ascii_lowercase();
    let starts = |p: &str| u == p || u.starts_with(&format!("{p}/"));
    if starts("http://tauri.localhost") || starts("https://tauri.localhost") || starts("tauri://localhost") {
        return true;
    }
    cfg!(debug_assertions) && (starts("http://localhost:3000") || starts("http://127.0.0.1:3000"))
}

/// Lets Lotus's own pages in this window use the microphone (Windows; does nothing elsewhere).
#[cfg(windows)]
pub fn allow_microphone(window: &tauri::WebviewWindow) {
    let label = window.label().to_string();
    let r = window.with_webview(move |wv| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_PERMISSION_KIND, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
        };
        use webview2_com::PermissionRequestedEventHandler;
        let core = match wv.controller().CoreWebView2() {
            Ok(c) => c,
            Err(e) => { eprintln!("lotus: microphone permission for {label}: no WebView2 ({e})"); return; }
        };
        let handler = PermissionRequestedEventHandler::create(Box::new(|_, args| {
            let Some(args) = args else { return Ok(()) };
            let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
            args.PermissionKind(&mut kind)?;
            if kind != COREWEBVIEW2_PERMISSION_KIND_MICROPHONE {
                return Ok(());
            }
            let mut uri = windows_core::PWSTR::null();
            args.Uri(&mut uri)?;
            if is_own_page(&webview2_com::take_pwstr(uri)) {
                args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
            }
            Ok(())
        }));
        let mut token = 0i64;
        if let Err(e) = core.add_PermissionRequested(&handler, &mut token) {
            eprintln!("lotus: microphone permission for {label}: {e}");
        }
    });
    if let Err(e) = r {
        eprintln!("lotus: microphone permission for {}: {e}", window.label());
    }
}

#[cfg(not(windows))]
pub fn allow_microphone(_window: &tauri::WebviewWindow) {}

#[cfg(test)]
mod tests {
    use super::is_own_page;

    #[test]
    fn only_lotus_pages() {
        assert!(is_own_page("http://tauri.localhost/index.html"));
        assert!(is_own_page("http://tauri.localhost"));
        assert!(is_own_page("https://tauri.localhost/island.html"));
        assert!(is_own_page("tauri://localhost/index.html"));
        assert!(!is_own_page("http://tauri.localhost.evil.com/"));
        assert!(!is_own_page("https://example.com/"));
        assert!(!is_own_page("http://127.0.0.1:8188/"));
        assert_eq!(is_own_page("http://localhost:3000/"), cfg!(debug_assertions));
    }
}
