//! Portable vs. installed data locations.
//!
//! Portable mode is on when any of these is true:
//!   1. a file named `lotus.portable` sits next to the executable (the portable .zip ships one), or
//!   2. the MSI "Portable data" option was ticked (it writes `PortableData=1` under
//!      `Software\Lotus\Lotus` in HKCU or HKLM).
//! In portable mode everything (WebView2 profile, settings, engine data) lives in `<exe dir>\data`.

use serde::Serialize;
use std::path::PathBuf;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppPaths {
    pub portable: bool,
    pub data_dir: String,
    pub exe_dir: String,
}

fn exe_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}

#[cfg(windows)]
fn registry_flag() -> bool {
    use winreg::{enums::*, RegKey};
    [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE].iter().any(|hive| {
        RegKey::predef(*hive)
            .open_subkey(r"Software\Lotus\Lotus")
            .and_then(|k| k.get_value::<u32, _>("PortableData"))
            .map(|v| v == 1)
            .unwrap_or(false)
    })
}

#[cfg(not(windows))]
fn registry_flag() -> bool {
    false
}

pub fn is_portable() -> bool {
    exe_dir().join("lotus.portable").exists() || registry_flag()
}

/// Data directory for portable mode (`<exe dir>\data`).
pub fn portable_data_dir() -> PathBuf {
    exe_dir().join("data")
}

/// Must run before any window is created so WebView2 keeps its profile in the data folder.
pub fn apply_portable_env() {
    if is_portable() {
        let web = portable_data_dir().join("webview");
        let _ = std::fs::create_dir_all(&web);
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", web);
    }
}

pub fn describe(installed_data_dir: PathBuf) -> AppPaths {
    let portable = is_portable();
    AppPaths {
        portable,
        data_dir: if portable { portable_data_dir() } else { installed_data_dir }
            .to_string_lossy()
            .into_owned(),
        exe_dir: exe_dir().to_string_lossy().into_owned(),
    }
}
