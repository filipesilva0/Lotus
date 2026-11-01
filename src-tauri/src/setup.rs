//! First-run setup (session 10).
//!
//! - The **Lotus Studio folder**: `Documents/Lotus Studio` on every OS (Windows: the MSI installs the
//!   app into it and records the folder as `StudioDir`; portable copies use the folder Lotus.exe sits in).
//!   Lotus keeps its own working folders there: Engines, Models, Projects, Exports.
//! - What the **MSI asked for**: the installer's engine checkboxes are written to
//!   `HKCU\Software\Lotus\Lotus\SetupEngines` as `ollama=1;comfyui=;voicebox=1`; the Welcome guide
//!   pre-ticks those. macOS and Linux have no installer pages, so the guide asks there.
//! - **Engine detection** (`engines::find_blocking` plus the desktop apps' own install locations).
//! - **Opening an engine's own installer** after the web layer downloaded it with `installer_download`.
//!   Lotus never installs an engine silently: the vendor's installer opens and shows its own terms.

use serde::Serialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub const STUDIO_FOLDER: &str = "Lotus Studio";
pub const SUBFOLDERS: [&str; 4] = ["Engines", "Models", "Projects", "Exports"];

#[derive(Serialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct InstallerChoices {
    pub ollama: bool,
    pub comfyui: bool,
    pub voicebox: bool,
}

/// Parses the MSI's `SetupEngines` value (`ollama=1;comfyui=;voicebox=1`). Unknown keys are ignored;
/// a value that names none of the three engines gives None (nothing was asked).
pub fn parse_choices(raw: &str) -> Option<InstallerChoices> {
    let mut c = InstallerChoices::default();
    let mut seen = false;
    for part in raw.split(';') {
        let mut kv = part.splitn(2, '=');
        let key = kv.next().unwrap_or("").trim().to_ascii_lowercase();
        let on = matches!(kv.next().map(str::trim), Some("1") | Some("yes") | Some("true"));
        match key.as_str() {
            "ollama" => c.ollama = on,
            "comfyui" => c.comfyui = on,
            "voicebox" => c.voicebox = on,
            _ => continue,
        }
        seen = true;
    }
    seen.then_some(c)
}

#[cfg(windows)]
fn reg_string(name: &str) -> Option<String> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Software\Lotus\Lotus")
        .and_then(|k| k.get_value::<String, _>(name))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

#[cfg(not(windows))]
fn reg_string(_name: &str) -> Option<String> {
    None
}

/// `Documents/Lotus Studio` (OneDrive-redirected Documents and XDG_DOCUMENTS_DIR are honoured by Tauri).
pub fn default_studio_dir(app: &AppHandle) -> PathBuf {
    let docs = app
        .path()
        .document_dir()
        .ok()
        .or_else(|| app.path().home_dir().ok().map(|h| h.join("Documents")))
        .unwrap_or_else(|| PathBuf::from("."));
    docs.join(STUDIO_FOLDER)
}

/// Where Lotus keeps engines, models, projects and exports.
pub fn studio_dir(app: &AppHandle) -> PathBuf {
    if crate::paths::is_portable() {
        return crate::paths::exe_dir();
    }
    if let Some(dir) = chosen_dir(app) {
        return dir;
    }
    if let Some(dir) = reg_string("StudioDir") {
        return PathBuf::from(dir.trim_end_matches(['\\', '/']));
    }
    default_studio_dir(app)
}

/// A folder the user picked in the Welcome guide (stored in the app's config folder, one line).
fn chosen_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("studio-dir.txt"))
}

fn chosen_dir(app: &AppHandle) -> Option<PathBuf> {
    let raw = std::fs::read_to_string(chosen_file(app)?).ok()?;
    let p = PathBuf::from(raw.trim());
    (p.is_absolute()).then_some(p)
}

/// Creates the folder and its working subfolders. Never touches anything else in it.
pub fn prepare(dir: &Path) -> Result<(), String> {
    for sub in SUBFOLDERS {
        std::fs::create_dir_all(dir.join(sub)).map_err(|e| format!("Could not create {}: {e}", dir.join(sub).display()))?;
    }
    std::fs::create_dir_all(dir.join("Engines").join("Installers")).map_err(|e| e.to_string())?;
    Ok(())
}

fn env_path(var: &str, rest: &str) -> Option<PathBuf> {
    std::env::var_os(var).map(|b| PathBuf::from(b).join(rest))
}

/// Desktop apps that count as "installed" even when there is no server binary to start directly.
fn app_candidates(name: &str, studio: &Path) -> Vec<PathBuf> {
    let mut c: Vec<Option<PathBuf>> = Vec::new();
    match name {
        "comfyui" => {
            c.push(env_path("LOCALAPPDATA", r"Programs\@comfyorgcomfyui-electron\ComfyUI.exe"));
            c.push(env_path("LOCALAPPDATA", r"Programs\ComfyUI\ComfyUI.exe"));
            c.push(env_path("LOCALAPPDATA", r"Programs\comfyui-electron\ComfyUI.exe"));
            if cfg!(target_os = "macos") {
                c.push(Some(PathBuf::from("/Applications/ComfyUI.app/Contents/MacOS/ComfyUI")));
                c.push(env_path("HOME", "Applications/ComfyUI.app/Contents/MacOS/ComfyUI"));
            }
            if cfg!(target_os = "linux") {
                c.push(Some(PathBuf::from("/opt/ComfyUI/comfyui-electron")));
                c.push(Some(PathBuf::from("/usr/bin/comfyui-electron")));
                for dir in [studio.join("Engines").join("comfyui"), env_path("HOME", "Applications").unwrap_or_default()] {
                    if let Ok(rd) = std::fs::read_dir(&dir) {
                        for e in rd.flatten() {
                            let n = e.file_name().to_string_lossy().to_lowercase();
                            if n.contains("comfy") && n.ends_with(".appimage") {
                                c.push(Some(e.path()));
                            }
                        }
                    }
                }
            }
        }
        "voicebox" => {
            c.push(env_path("LOCALAPPDATA", r"Voicebox\voicebox.exe"));
            c.push(env_path("LOCALAPPDATA", r"Programs\Voicebox\voicebox.exe"));
            c.push(env_path("ProgramFiles", r"Voicebox\voicebox.exe"));
            if cfg!(target_os = "macos") {
                c.push(Some(PathBuf::from("/Applications/Voicebox.app/Contents/MacOS/voicebox")));
            }
        }
        "ollama" => {
            if cfg!(target_os = "macos") {
                c.push(Some(PathBuf::from("/Applications/Ollama.app/Contents/MacOS/Ollama")));
            }
            let exe = if cfg!(windows) { "ollama.exe" } else { "ollama" };
            c.push(Some(studio.join("Engines").join("ollama").join("bin").join(exe)));
            c.push(Some(studio.join("Engines").join("ollama").join(exe)));
        }
        _ => {}
    }
    c.into_iter().flatten().collect()
}

/// Path of an installed engine (its server binary if Lotus can start it, else its desktop app), or None.
pub fn detect(name: &str, studio: &Path, data_dir: Option<String>) -> Option<String> {
    if let Some(p) = crate::engines::find_blocking(name.to_string(), data_dir) {
        return Some(p);
    }
    app_candidates(name, studio)
        .into_iter()
        .find(|p| p.is_file())
        .map(|p| p.to_string_lossy().into_owned())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupInfo {
    pub studio_dir: String,
    pub default_studio_dir: String,
    pub os: String,
    pub arch: String,
    /// What the MSI's engine page asked for (Windows only).
    pub installer: Option<InstallerChoices>,
    /// Engine name → path, or null when not found.
    pub found: BTreeMap<String, Option<String>>,
}

#[tauri::command]
pub async fn setup_info(app: AppHandle) -> SetupInfo {
    let studio = studio_dir(&app);
    let default = default_studio_dir(&app);
    let data_dir = app.path().app_data_dir().ok().map(|p| p.to_string_lossy().into_owned());
    let s2 = studio.clone();
    let found = tauri::async_runtime::spawn_blocking(move || {
        ["ollama", "comfyui", "voicebox"]
            .iter()
            .map(|n| (n.to_string(), detect(n, &s2, data_dir.clone())))
            .collect::<BTreeMap<_, _>>()
    })
    .await
    .unwrap_or_default();
    SetupInfo {
        studio_dir: studio.to_string_lossy().into_owned(),
        default_studio_dir: default.to_string_lossy().into_owned(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        installer: reg_string("SetupEngines").and_then(|v| parse_choices(&v)),
        found,
    }
}

/// Creates the chosen Lotus Studio folder and its subfolders; returns the folder.
/// Remembers it, so downloads and engine lookups use it from now on.
#[tauri::command]
pub fn setup_prepare(app: AppHandle, dir: String) -> Result<String, String> {
    let d = PathBuf::from(dir.trim());
    if d.as_os_str().is_empty() || !d.is_absolute() {
        return Err("Choose a full folder path, for example your Documents folder.".into());
    }
    prepare(&d)?;
    if !crate::paths::is_portable() {
        if let Some(f) = chosen_file(&app) {
            if let Some(parent) = f.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            std::fs::write(&f, d.to_string_lossy().as_bytes()).map_err(|e| format!("Could not remember the folder: {e}"))?;
        }
    }
    Ok(d.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn engine_detect(app: AppHandle, name: String) -> Option<String> {
    let studio = studio_dir(&app);
    let data_dir = app.path().app_data_dir().ok().map(|p| p.to_string_lossy().into_owned());
    tauri::async_runtime::spawn_blocking(move || detect(&name, &studio, data_dir)).await.ok().flatten()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    /// "opened": the vendor's installer or disk image is now on screen; wait for the user.
    /// "ready": nothing more to do (Linux AppImage made executable, or the Ollama archive unpacked).
    pub kind: String,
    /// Program to start for "ready" results.
    pub path: Option<String>,
}

fn lower_name(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default()
}

/// Opens an installer that `installer_download` saved in `<Lotus Studio>/Engines/Installers`.
#[tauri::command]
pub async fn installer_open(app: AppHandle, path: String) -> Result<Opened, String> {
    let studio = studio_dir(&app);
    let p = PathBuf::from(&path);
    let inside = p.parent().map(|d| d == studio.join("Engines").join("Installers")).unwrap_or(false);
    if !inside || !p.is_file() {
        return Err("Lotus only opens installers it downloaded into Lotus Studio\\Engines\\Installers.".into());
    }
    let name = lower_name(&p);
    if name.ends_with(".appimage") {
        return ready_appimage(&studio, &p);
    }
    if name.ends_with(".tar.zst") || name.ends_with(".tgz") || name.ends_with(".tar.gz") {
        return unpack_archive(&studio, &p).await;
    }
    tauri_plugin_opener::open_path(&p, None::<&str>).map_err(|e| format!("Could not open the installer: {e}"))?;
    Ok(Opened { kind: "opened".into(), path: None })
}

#[cfg(unix)]
fn make_executable(p: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let mut perm = std::fs::metadata(p).map_err(|e| e.to_string())?.permissions();
    perm.set_mode(0o755);
    std::fs::set_permissions(p, perm).map_err(|e| e.to_string())
}
#[cfg(not(unix))]
fn make_executable(_p: &Path) -> Result<(), String> {
    Ok(())
}

/// An AppImage is the program itself: move it to Engines/comfyui and mark it executable.
fn ready_appimage(studio: &Path, p: &Path) -> Result<Opened, String> {
    let dir = studio.join("Engines").join("comfyui");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let target = dir.join(p.file_name().unwrap_or_default());
    if target != p {
        std::fs::rename(p, &target).or_else(|_| std::fs::copy(p, &target).map(|_| ())).map_err(|e| format!("Could not move the AppImage: {e}"))?;
    }
    make_executable(&target)?;
    Ok(Opened { kind: "ready".into(), path: Some(target.to_string_lossy().into_owned()) })
}

/// Ollama on Linux ships as a .tar.zst with bin/ and lib/. Unpacked into Engines/ollama, no sudo needed.
async fn unpack_archive(studio: &Path, p: &Path) -> Result<Opened, String> {
    let dir = studio.join("Engines").join("ollama");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let zst = lower_name(p).ends_with(".zst");
    let (src, dst) = (p.to_path_buf(), dir.clone());
    let out = tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = std::process::Command::new("tar");
        if zst {
            cmd.arg("--zstd");
        }
        cmd.arg("-xf").arg(&src).arg("-C").arg(&dst).output()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("Could not run tar: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!(
            "Could not unpack the Ollama archive ({}). Install the \"zstd\" package and press Retry, or install Ollama with its official script: curl -fsSL https://ollama.com/install.sh | sh",
            err.trim()
        ));
    }
    let exe = dir.join("bin").join("ollama");
    if !exe.is_file() {
        return Err("The archive did not contain bin/ollama. Press Retry, or install Ollama with its official script.".into());
    }
    make_executable(&exe)?;
    Ok(Opened { kind: "ready".into(), path: Some(exe.to_string_lossy().into_owned()) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_msi_engine_choices() {
        assert_eq!(
            parse_choices("ollama=1;comfyui=;voicebox=1"),
            Some(InstallerChoices { ollama: true, comfyui: false, voicebox: true })
        );
        assert_eq!(parse_choices(" OLLAMA = 1 ; extra=1"), Some(InstallerChoices { ollama: true, ..Default::default() }));
        assert_eq!(parse_choices("ollama=;comfyui=;voicebox="), Some(InstallerChoices::default()));
        assert_eq!(parse_choices(""), None);
        assert_eq!(parse_choices("something=1"), None);
    }

    #[test]
    fn prepare_creates_working_folders_only() {
        let root = std::env::temp_dir().join(format!("lotus-studio-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("keep.txt"), "mine").unwrap();
        prepare(&root).unwrap();
        for s in SUBFOLDERS {
            assert!(root.join(s).is_dir(), "{s} missing");
        }
        assert!(root.join("Engines").join("Installers").is_dir());
        assert_eq!(std::fs::read_to_string(root.join("keep.txt")).unwrap(), "mine");
        prepare(&root).unwrap(); // idempotent
        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn appimage_is_moved_and_made_executable() {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(format!("lotus-appimage-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        prepare(&root).unwrap();
        let src = root.join("Engines").join("Installers").join("ComfyUI-x86_64.AppImage");
        std::fs::write(&src, b"#!/bin/sh\n").unwrap();
        let o = ready_appimage(&root, &src).unwrap();
        let target = PathBuf::from(o.path.unwrap());
        assert_eq!(target, root.join("Engines").join("comfyui").join("ComfyUI-x86_64.AppImage"));
        assert!(!src.exists());
        assert_eq!(std::fs::metadata(&target).unwrap().permissions().mode() & 0o111, 0o111);
        let _ = std::fs::remove_dir_all(&root);
    }
}
