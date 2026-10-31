//! Reads how much video memory (VRAM) and system memory is free right now, so the web layer can
//! decide how many background agents, how large a context window and which model size are safe.
//!
//! Sources, tried in order (the first that answers wins):
//!   1. `nvidia-smi` (NVIDIA, Windows and Linux; ships with the driver)
//!   2. Linux `amdgpu` sysfs counters (`mem_info_vram_total` / `mem_info_vram_used`)
//!   3. Windows: adapter size from the display-class registry key + the "GPU Adapter Memory"
//!      performance counter via PowerShell (works for AMD and Intel too; slower, ~1 s)
//!
//! Nothing here is guessed: if every source fails the result says so (`source: "none"`).
//! Plain `std` only (plus `winreg`, already a dependency, on Windows).

use serde::Serialize;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Gpu {
    pub name: String,
    pub total_mb: u64,
    pub used_mb: u64,
    pub free_mb: u64,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct HardwareSnapshot {
    /// "nvidia-smi" | "amdgpu-sysfs" | "windows-counters" | "none"
    pub source: String,
    pub gpus: Vec<Gpu>,
    pub ram_total_mb: u64,
    pub ram_free_mb: u64,
    /// Why a source failed (only filled when `source` is "none").
    pub note: String,
}

fn hide_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    #[cfg(not(windows))]
    {
        let _ = cmd;
    }
}

/// Runs a program and returns stdout, giving up after `secs`.
fn run_with_timeout(program: &str, args: &[&str], secs: u64) -> Option<String> {
    let program = program.to_string();
    let args: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut c = Command::new(&program);
        c.args(&args).stdin(Stdio::null()).stderr(Stdio::null());
        hide_window(&mut c);
        let _ = tx.send(c.output());
    });
    match rx.recv_timeout(Duration::from_secs(secs)) {
        Ok(Ok(o)) if o.status.success() => Some(String::from_utf8_lossy(&o.stdout).into_owned()),
        _ => None,
    }
}

/// Parses `nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free --format=csv,noheader,nounits`.
pub fn parse_nvidia_smi(out: &str) -> Vec<Gpu> {
    out.lines()
        .filter_map(|line| {
            let cols: Vec<&str> = line.split(',').map(|c| c.trim()).collect();
            if cols.len() < 4 {
                return None;
            }
            let num = |s: &str| s.parse::<f64>().ok().map(|v| v.max(0.0) as u64);
            let (total, used, free) = (num(cols[1])?, num(cols[2])?, num(cols[3])?);
            if total == 0 {
                return None;
            }
            Some(Gpu { name: cols[0].to_string(), total_mb: total, used_mb: used, free_mb: free })
        })
        .collect()
}

fn from_nvidia() -> Option<Vec<Gpu>> {
    let out = run_with_timeout(
        "nvidia-smi",
        &["--query-gpu=name,memory.total,memory.used,memory.free", "--format=csv,noheader,nounits"],
        4,
    )?;
    let gpus = parse_nvidia_smi(&out);
    if gpus.is_empty() {
        None
    } else {
        Some(gpus)
    }
}

#[cfg(target_os = "linux")]
fn from_amdgpu_sysfs() -> Option<Vec<Gpu>> {
    let mut gpus = Vec::new();
    let rd = std::fs::read_dir("/sys/class/drm").ok()?;
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if !name.starts_with("card") || name.contains('-') {
            continue;
        }
        let dev = e.path().join("device");
        let read = |f: &str| std::fs::read_to_string(dev.join(f)).ok().and_then(|s| s.trim().parse::<u64>().ok());
        if let (Some(total), Some(used)) = (read("mem_info_vram_total"), read("mem_info_vram_used")) {
            if total > 0 {
                let mb = 1024 * 1024;
                gpus.push(Gpu { name: format!("AMD GPU ({name})"), total_mb: total / mb, used_mb: used / mb, free_mb: total.saturating_sub(used) / mb });
            }
        }
    }
    if gpus.is_empty() {
        None
    } else {
        Some(gpus)
    }
}

#[cfg(not(target_os = "linux"))]
fn from_amdgpu_sysfs() -> Option<Vec<Gpu>> {
    None
}

/// Windows, any vendor: dedicated memory size per adapter from the registry, and the sum of
/// "Dedicated Usage" from the GPU Adapter Memory performance counter (Windows 10 1709+).
#[cfg(windows)]
fn from_windows_counters() -> Option<Vec<Gpu>> {
    use winreg::{enums::*, RegKey};
    let class = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(r"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}")
        .ok()?;
    let mut best: Option<(String, u64)> = None;
    for sub in class.enum_keys().flatten() {
        if sub.len() != 4 {
            continue; // "0000", "0001", … (skip "Properties")
        }
        if let Ok(k) = class.open_subkey(&sub) {
            // Newer drivers write a QWORD; older ones only a DWORD (capped at 4 GB).
            let size: u64 = k
                .get_value::<u64, _>("HardwareInformation.qwMemorySize")
                .or_else(|_| k.get_value::<u32, _>("HardwareInformation.MemorySize").map(u64::from))
                .unwrap_or(0);
            let name: String = k.get_value("DriverDesc").unwrap_or_default();
            if size > best.as_ref().map(|b| b.1).unwrap_or(0) {
                best = Some((name, size));
            }
        }
    }
    let (name, total_bytes) = best?;
    let script = "(Get-Counter '\\GPU Adapter Memory(*)\\Dedicated Usage' -ErrorAction SilentlyContinue).CounterSamples | Measure-Object -Property CookedValue -Maximum | ForEach-Object { [int64]$_.Maximum }";
    let used_bytes: u64 = run_with_timeout("powershell", &["-NoProfile", "-NonInteractive", "-Command", script], 6)
        .and_then(|s| s.trim().parse::<u64>().ok())
        .unwrap_or(0);
    let mb = 1024 * 1024;
    let total = total_bytes / mb;
    let used = (used_bytes / mb).min(total);
    Some(vec![Gpu { name, total_mb: total, used_mb: used, free_mb: total - used }])
}

#[cfg(not(windows))]
fn from_windows_counters() -> Option<Vec<Gpu>> {
    None
}

/// Parses `/proc/meminfo` into (total MB, available MB).
/// Only the non-Windows `system_ram` (and the unit test) use it; Windows asks the OS directly.
#[cfg(any(not(windows), test))]
pub fn parse_meminfo(s: &str) -> (u64, u64) {
    let field = |key: &str| {
        s.lines()
            .find(|l| l.starts_with(key))
            .and_then(|l| l.split_whitespace().nth(1))
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(0)
    };
    (field("MemTotal:") / 1024, field("MemAvailable:") / 1024)
}

#[cfg(windows)]
fn system_ram() -> (u64, u64) {
    #[repr(C)]
    struct MemoryStatusEx {
        length: u32,
        memory_load: u32,
        total_phys: u64,
        avail_phys: u64,
        total_page_file: u64,
        avail_page_file: u64,
        total_virtual: u64,
        avail_virtual: u64,
        avail_extended_virtual: u64,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GlobalMemoryStatusEx(buf: *mut MemoryStatusEx) -> i32;
    }
    let mut m = MemoryStatusEx {
        length: std::mem::size_of::<MemoryStatusEx>() as u32,
        memory_load: 0,
        total_phys: 0,
        avail_phys: 0,
        total_page_file: 0,
        avail_page_file: 0,
        total_virtual: 0,
        avail_virtual: 0,
        avail_extended_virtual: 0,
    };
    // SAFETY: `m` is a correctly sized, initialised MEMORYSTATUSEX with `length` set.
    let ok = unsafe { GlobalMemoryStatusEx(&mut m) };
    if ok == 0 {
        return (0, 0);
    }
    (m.total_phys / (1024 * 1024), m.avail_phys / (1024 * 1024))
}

#[cfg(not(windows))]
fn system_ram() -> (u64, u64) {
    std::fs::read_to_string("/proc/meminfo").map(|s| parse_meminfo(&s)).unwrap_or((0, 0))
}

type Reader = fn() -> Option<Vec<Gpu>>;

fn snapshot() -> HardwareSnapshot {
    let (ram_total_mb, ram_free_mb) = system_ram();
    let tries: [(&str, Reader); 3] =
        [("nvidia-smi", from_nvidia), ("amdgpu-sysfs", from_amdgpu_sysfs), ("windows-counters", from_windows_counters)];
    for (source, f) in tries {
        if let Some(gpus) = f() {
            return HardwareSnapshot { source: source.to_string(), gpus, ram_total_mb, ram_free_mb, note: String::new() };
        }
    }
    HardwareSnapshot {
        source: "none".to_string(),
        gpus: vec![],
        ram_total_mb,
        ram_free_mb,
        note: "No GPU memory reader answered (nvidia-smi, amdgpu sysfs, Windows GPU counters).".to_string(),
    }
}

/// Current GPU and system memory. Runs off the UI thread.
#[tauri::command]
pub async fn hw_snapshot() -> Result<HardwareSnapshot, String> {
    tauri::async_runtime::spawn_blocking(snapshot).await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_nvidia_smi_rows() {
        let out = "NVIDIA GeForce RTX 4070, 12282, 3120, 9010\nNVIDIA RTX A2000, 6138, 0, 6138\nbad line\n";
        let g = parse_nvidia_smi(out);
        assert_eq!(g.len(), 2);
        assert_eq!(g[0].name, "NVIDIA GeForce RTX 4070");
        assert_eq!((g[0].total_mb, g[0].used_mb, g[0].free_mb), (12282, 3120, 9010));
        assert_eq!(g[1].free_mb, 6138);
    }

    #[test]
    fn parses_meminfo() {
        let s = "MemTotal:       32768000 kB\nMemFree:  100 kB\nMemAvailable:   16384000 kB\n";
        assert_eq!(parse_meminfo(s), (32000, 16000));
    }
}
