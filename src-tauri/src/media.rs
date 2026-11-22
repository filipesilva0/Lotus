//! 0.23 island helpers on Windows: what's playing (the system media controls, the same ones behind the
//! volume pop-up) and copied text. Other systems answer "nothing" so the island simply hides these.

use serde::Serialize;

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    title: String,
    artist: String,
    app: String,
    playing: bool,
    can_next: bool,
    can_prev: bool,
}

/// A friendly name for the app that plays: "Spotify.exe" / "SpotifyAB.SpotifyMusic_…!Spotify" → "Spotify".
pub fn app_name(id: &str) -> String {
    let tail = id.rsplit('!').next().unwrap_or(id);
    let tail = tail.rsplit(['\\', '/']).next().unwrap_or(tail);
    let tail = tail.strip_suffix(".exe").or_else(|| tail.strip_suffix(".EXE")).unwrap_or(tail);
    let known = [("msedge", "Edge"), ("chrome", "Chrome"), ("firefox", "Firefox"), ("spotify", "Spotify"), ("vlc", "VLC"), ("zunemusic", "Media Player"), ("microsoft.media.player", "Media Player")];
    let low = tail.to_lowercase();
    for (k, v) in known {
        if low.contains(k) {
            return v.to_string();
        }
    }
    tail.split(['.', '_']).next().unwrap_or(tail).to_string()
}

#[cfg(windows)]
mod win {
    use super::{app_name, NowPlaying};
    use windows::Media::Control::{GlobalSystemMediaTransportControlsSession as Session, GlobalSystemMediaTransportControlsSessionManager as Manager, GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status};

    fn session() -> Option<Session> {
        Manager::RequestAsync().ok()?.get().ok()?.GetCurrentSession().ok()
    }

    pub fn now() -> Option<NowPlaying> {
        let s = session()?;
        let props = s.TryGetMediaPropertiesAsync().ok()?.get().ok()?;
        let info = s.GetPlaybackInfo().ok()?;
        let controls = info.Controls().ok();
        Some(NowPlaying {
            title: props.Title().map(|t| t.to_string()).unwrap_or_default(),
            artist: props.Artist().map(|t| t.to_string()).unwrap_or_default(),
            app: s.SourceAppUserModelId().map(|t| app_name(&t.to_string())).unwrap_or_default(),
            playing: info.PlaybackStatus().map(|p| p == Status::Playing).unwrap_or(false),
            can_next: controls.as_ref().and_then(|c| c.IsNextEnabled().ok()).unwrap_or(false),
            can_prev: controls.as_ref().and_then(|c| c.IsPreviousEnabled().ok()).unwrap_or(false),
        })
    }

    pub fn control(action: &str) -> Result<bool, String> {
        let s = session().ok_or("Nothing is playing.")?;
        let op = match action {
            "toggle" => s.TryTogglePlayPauseAsync(),
            "play" => s.TryPlayAsync(),
            "pause" => s.TryPauseAsync(),
            "next" => s.TrySkipNextAsync(),
            "prev" => s.TrySkipPreviousAsync(),
            _ => return Err(format!("Unknown media action {action}.")),
        };
        op.and_then(|o| o.get()).map_err(|e| e.to_string())
    }

    pub fn pause_if_playing() -> bool {
        let Some(s) = session() else { return false };
        let playing = s.GetPlaybackInfo().and_then(|i| i.PlaybackStatus()).map(|p| p == Status::Playing).unwrap_or(false);
        playing && s.TryPauseAsync().and_then(|o| o.get()).unwrap_or(false)
    }

    use windows::core::w;
    use windows::Win32::Foundation::{HANDLE, HGLOBAL};
    use windows::Win32::System::DataExchange::{CloseClipboard, GetClipboardData, GetClipboardSequenceNumber, IsClipboardFormatAvailable, OpenClipboard, RegisterClipboardFormatW};
    use windows::Win32::System::Memory::{GlobalLock, GlobalUnlock};
    use windows::Win32::System::Ole::CF_UNICODETEXT;

    /// Text copied inside Lotus itself (an answer you copied) needs no "do something with it" peek.
    pub fn copied_in_lotus() -> bool {
        use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
        unsafe {
            let mut pid = 0u32;
            GetWindowThreadProcessId(GetForegroundWindow(), Some(&mut pid));
            pid == std::process::id()
        }
    }

    pub fn sequence() -> u32 {
        unsafe { GetClipboardSequenceNumber() }
    }

    /// The copied text, or None when there is none or the app that copied it asked not to be watched
    /// (password managers set these formats: https://learn.microsoft.com/windows/win32/dataxchg/clipboard-formats#cloud-clipboard-and-clipboard-history-formats).
    pub fn text(checked: bool) -> Option<String> {
        unsafe {
            if checked {
                for f in [w!("ExcludeClipboardContentFromMonitorProcessing"), w!("CanIncludeInClipboardHistory"), w!("Clipboard Viewer Ignore")] {
                    let id = RegisterClipboardFormatW(f);
                    if id != 0 && IsClipboardFormatAvailable(id).is_ok() {
                        return None;
                    }
                }
            }
            if IsClipboardFormatAvailable(CF_UNICODETEXT.0 as u32).is_err() {
                return None;
            }
            let mut opened = false;
            for _ in 0..5 {
                if OpenClipboard(None).is_ok() {
                    opened = true;
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(30));
            }
            if !opened {
                return None;
            }
            let out = (|| {
                let h: HANDLE = GetClipboardData(CF_UNICODETEXT.0 as u32).ok()?;
                let g = HGLOBAL(h.0);
                let p = GlobalLock(g) as *const u16;
                if p.is_null() {
                    return None;
                }
                let mut len = 0usize;
                while *p.add(len) != 0 && len < 200_000 {
                    len += 1;
                }
                let s = String::from_utf16_lossy(std::slice::from_raw_parts(p, len));
                let _ = GlobalUnlock(g);
                Some(s)
            })();
            let _ = CloseClipboard();
            out
        }
    }
}

#[cfg(windows)]
pub fn clip_sequence() -> u32 {
    win::sequence()
}
#[cfg(not(windows))]
pub fn clip_sequence() -> u32 {
    0
}

/// Copied text for the "Copied" peek: skips anything the copying app marked as private.
#[cfg(windows)]
pub fn clip_text_checked() -> Option<String> {
    if win::copied_in_lotus() {
        return None;
    }
    win::text(true)
}
#[cfg(not(windows))]
pub fn clip_text_checked() -> Option<String> {
    None
}

#[tauri::command]
pub async fn media_now() -> Option<NowPlaying> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(win::now).await.ok().flatten()
    }
    #[cfg(not(windows))]
    {
        None
    }
}

#[tauri::command]
pub async fn media_control(action: String) -> Result<bool, String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || win::control(&action)).await.map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = action;
        Ok(false)
    }
}

/// Pauses whatever is playing; true if it was playing (so the island knows to play it again later).
#[tauri::command]
pub async fn media_pause_if_playing() -> bool {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(win::pause_if_playing).await.unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// The text on the clipboard, for the island's "Summarise" and "Read" buttons (asked for by the user,
/// so the privacy marks are not checked here; the web layer falls back to the browser clipboard).
#[tauri::command]
pub fn clip_text() -> Option<String> {
    #[cfg(windows)]
    {
        win::text(false)
    }
    #[cfg(not(windows))]
    {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::app_name;

    #[test]
    fn friendly_app_names() {
        assert_eq!(app_name("Spotify.exe"), "Spotify");
        assert_eq!(app_name("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify"), "Spotify");
        assert_eq!(app_name("MSEdge"), "Edge");
        assert_eq!(app_name("Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic"), "Media Player");
        assert_eq!(app_name("C:\\Apps\\foobar2000.exe"), "foobar2000");
    }
}
