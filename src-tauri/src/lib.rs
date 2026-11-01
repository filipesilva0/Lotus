mod appbuilder;
mod context_files;
mod downloads;
mod engines;
mod hardware;
mod hooks;
mod island;
mod mac_chrome;
mod memory_db;
mod paths;
mod setup;
mod updates;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, ShortcutState};

/// Set once the main window has been shown at startup (by the web layer, or by the fallback below).
static MAIN_SHOWN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn started_minimized() -> bool {
    std::env::args().any(|a| a == "--minimized")
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
    mac_chrome::place_traffic_lights(app);
}

#[tauri::command]
fn app_paths(app: AppHandle) -> paths::AppPaths {
    let installed = app.path().app_data_dir().unwrap_or_default();
    let studio = setup::studio_dir(&app);
    paths::describe(installed, studio)
}

/// The main window starts hidden to avoid a white flash; the web layer calls this once it has painted.
/// Only the first call (or the startup fallback) shows it, so a late call never re-opens a window the
/// user has already closed to the tray.
#[tauri::command]
fn main_ready(app: AppHandle) {
    reveal_main_once(&app);
}

fn reveal_main_once(app: &AppHandle) {
    use std::sync::atomic::Ordering;
    if started_minimized() || MAIN_SHOWN.swap(true, Ordering::SeqCst) {
        return;
    }
    show_main(app);
}

/// Bring the studio forward, optionally on a specific view (chat, image, voice, engines).
#[tauri::command]
fn open_main(app: AppHandle, view: Option<String>) {
    show_main(&app);
    let _ = app.emit_to("main", "main:navigate", view);
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

pub fn run() {
    paths::apply_portable_env();

    let mut builder = tauri::Builder::default();

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        // A second launch just brings the first one forward.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)));
    }

    let app = builder
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(engines::Engines::default())
        .manage(appbuilder::AppBuilder::default())
        .manage(downloads::Downloads::default())
        .manage(hooks::Pending::default())
        .manage(memory_db::MemoryDb::default())
        .invoke_handler(tauri::generate_handler![
            app_paths,
            main_ready,
            open_main,
            quit_app,
            island::island_resize,
            island::island_show,
            island::island_hide,
            island::island_focus,
            island::island_visible,
            hooks::hook_answer,
            hooks::hooks_installed,
            hooks::hooks_install,
            hooks::hooks_uninstall,
            engines::engine_start,
            engines::engine_stop,
            engines::engine_supervised,
            engines::engine_find,
            engines::engine_ping,
            downloads::download_start,
            downloads::download_cancel,
            downloads::comfy_models_dir,
            downloads::list_model_files,
            downloads::installer_download,
            downloads::comfy_models_guess,
            setup::setup_info,
            setup::setup_prepare,
            setup::engine_detect,
            setup::installer_open,
            appbuilder::proj_create,
            appbuilder::proj_tree,
            appbuilder::proj_read,
            appbuilder::proj_write,
            appbuilder::proj_mkdir,
            appbuilder::proj_delete,
            appbuilder::proj_rename,
            appbuilder::proc_spawn,
            appbuilder::proc_kill,
            appbuilder::proc_running,
            appbuilder::preview_serve,
            appbuilder::preview_stop,
            appbuilder::toolchain_check,
            appbuilder::android_paths,
            appbuilder::adb_devices,
            appbuilder::emulator_avds,
            appbuilder::adb_screenshot,
            appbuilder::adb_tap,
            appbuilder::adb_swipe,
            appbuilder::adb_key,
            hardware::hw_snapshot,
            context_files::ctx_discover,
            context_files::ctx_read_folder,
            memory_db::mem_status,
            memory_db::mem_index,
            memory_db::mem_forget_session,
            memory_db::mem_wipe_history,
            memory_db::mem_search,
            memory_db::memories_list,
            memory_db::memories_put,
            memory_db::memories_delete,
            memory_db::memories_search,
            memory_db::skills_list,
            memory_db::skills_put,
            memory_db::skills_delete,
            memory_db::skills_search,
            updates::update_check,
            updates::update_install,
        ])
        .on_window_event(|window, event| {
            // Closing the studio keeps Lotus (and the island) running in the tray.
            if window.label() == "main" {
                match event {
                    WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                    // macOS lays the traffic lights out again on these; put them back in our bar.
                    WindowEvent::Resized(_) | WindowEvent::Focused(_) | WindowEvent::ThemeChanged(_) | WindowEvent::ScaleFactorChanged { .. } => {
                        mac_chrome::place_traffic_lights(window.app_handle());
                    }
                    _ => {}
                }
            }
        })
        .setup(|app| {
            // Tray
            let open = MenuItem::with_id(app, "open", "Open Lotus", true, None::<&str>)?;
            let island = MenuItem::with_id(app, "island", "Show / hide island", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Lotus", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &island, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .tooltip("Lotus")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "island" => {
                        let _ = app.emit_to("island", "island:toggle", ());
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        show_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            // Global shortcuts (failures are ignored: another app may already own a combo)
            let ca = Modifiers::CONTROL | Modifiers::ALT;
            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(move |app, sc, ev| {
                        if ev.state() != ShortcutState::Pressed {
                            return;
                        }
                        if sc.matches(ca, Code::Space) {
                            let _ = app.emit_to("island", "island:open-chat", ());
                        } else if sc.matches(ca, Code::KeyD) {
                            let _ = app.emit_to("island", "island:dictate", ());
                        } else if sc.matches(ca, Code::KeyT) {
                            let _ = app.emit_to("island", "island:toggle", ());
                        }
                    })
                    .build(),
            )?;
            let gs = app.global_shortcut();
            for code in [Code::Space, Code::KeyD, Code::KeyT] {
                let _ = gs.register(tauri_plugin_global_shortcut::Shortcut::new(Some(ca), code));
            }

            hooks::start(app.handle().clone());
            mac_chrome::place_traffic_lights(app.handle());

            // Safety net: macOS (WKWebView) and Linux (WebKitGTK) can pause a hidden page, so the web
            // layer's main_ready may never arrive and only the island would be visible. Show the main
            // window anyway after a short wait.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(1500));
                let h = handle.clone();
                let _ = handle.run_on_main_thread(move || reveal_main_once(&h));
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Lotus");

    app.run(|handle, event| match event {
        RunEvent::Exit => {
            engines::kill_all(&handle.state::<engines::Engines>());
            appbuilder::kill_all(&handle.state::<appbuilder::AppBuilder>());
        }
        // macOS: clicking the Dock icon after closing the window (Lotus keeps running) brings it back.
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => show_main(handle),
        _ => {}
    });
}
