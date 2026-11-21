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
    /// Installed from the Microsoft Store (the MSIX package ships a `lotus.store` marker). The Store
    /// keeps this copy up to date, so the built-in updater stays out of the way.
    pub store: bool,
    pub data_dir: String,
    pub exe_dir: String,
    /// Documents/Lotus Studio (or the folder chosen in the installer); see setup.rs.
    pub studio_dir: String,
    /// Where an older Lotus kept its data (the OS app-data folder), read once to move it (session 17).
    pub legacy_data_dir: String,
}

pub fn exe_dir() -> PathBuf {
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

/// The Microsoft Store package (MSIX) puts an empty `lotus.store` file next to Lotus.exe; see the
/// "Microsoft Store package" step in .github/workflows/build-windows.yml.
pub fn is_store() -> bool {
    exe_dir().join("lotus.store").exists()
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

/// Session 17: everything Lotus keeps lives in the Lotus Studio folder, so the data folder is
/// `<Lotus Studio>/Data` (portable: `<exe dir>/data`, as before). Older installs kept it in the OS
/// app-data folder; the core copies it over once (`--legacy-data`).
pub fn data_dir_for(portable: bool, installed_data_dir: &std::path::Path, studio_dir: &std::path::Path) -> PathBuf {
    if portable {
        portable_data_dir()
    } else if studio_dir.as_os_str().is_empty() {
        installed_data_dir.to_path_buf()
    } else {
        studio_dir.join("Data")
    }
}

pub fn describe(installed_data_dir: PathBuf, studio_dir: PathBuf) -> AppPaths {
    let portable = is_portable();
    AppPaths {
        portable,
        store: is_store(),
        data_dir: data_dir_for(portable, &installed_data_dir, &studio_dir).to_string_lossy().into_owned(),
        exe_dir: exe_dir().to_string_lossy().into_owned(),
        studio_dir: studio_dir.to_string_lossy().into_owned(),
        legacy_data_dir: installed_data_dir.to_string_lossy().into_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn data_lives_in_the_studio_folder() {
        let installed = PathBuf::from("/home/u/.local/share/com.lotus.app");
        let studio = PathBuf::from("/home/u/Documents/Lotus Studio");
        assert_eq!(data_dir_for(false, &installed, &studio), studio.join("Data"));
        assert_eq!(data_dir_for(false, &installed, &PathBuf::new()), installed);
        assert_eq!(data_dir_for(true, &installed, &studio), portable_data_dir());
    }
}
