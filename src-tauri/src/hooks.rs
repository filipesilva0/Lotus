//! Receives Claude Code hook events on 127.0.0.1 and lets the island answer permission prompts.
//!
//! No custom hook binary is needed: Claude Code runs `curl.exe` (ships with Windows 10/11),
//! which POSTs the hook's JSON to us. For a PermissionRequest we keep the connection open
//! until the user taps Allow/Deny in the island, then reply with Claude Code's decision JSON.
//! If nobody answers within five minutes we reply `{}`, and Claude Code falls back to its
//! normal terminal prompt.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

pub const PORT: u16 = 17495;
const MARKER: &str = "127.0.0.1:17495/hook";
const ANSWER_TIMEOUT: Duration = Duration::from_secs(300);
const EVENTS: [&str; 6] =
    ["PermissionRequest", "UserPromptSubmit", "Stop", "Notification", "SessionStart", "SessionEnd"];

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

type Answer = (bool, Option<String>);

#[derive(Default)]
pub struct Pending(Mutex<HashMap<u64, mpsc::Sender<Answer>>>);

pub fn start<R: tauri::Runtime>(app: AppHandle<R>) {
    thread::spawn(move || {
        let listener = match TcpListener::bind(("127.0.0.1", PORT)) {
            Ok(l) => l,
            Err(e) => {
                eprintln!("lotus: hook server could not bind port {PORT}: {e}");
                return;
            }
        };
        for stream in listener.incoming().flatten() {
            let app = app.clone();
            thread::spawn(move || {
                let _ = handle(app, stream);
            });
        }
    });
}

fn reply(mut s: TcpStream, status: &str, body: &str) {
    let _ = write!(
        s,
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
}

fn handle<R: tauri::Runtime>(app: AppHandle<R>, stream: TcpStream) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    let mut reader = BufReader::new(stream.try_clone()?);

    let mut request_line = String::new();
    reader.read_line(&mut request_line)?;
    let mut content_length = 0usize;
    let mut has_token = false;
    loop {
        let mut line = String::new();
        reader.read_line(&mut line)?;
        let line = line.trim();
        if line.is_empty() {
            break;
        }
        let lower = line.to_ascii_lowercase();
        if let Some(v) = lower.strip_prefix("content-length:") {
            content_length = v.trim().parse().unwrap_or(0);
        }
        // Browsers cannot attach this header cross-origin without a preflight we never answer,
        // so a random web page cannot spam the island with fake prompts.
        if lower.starts_with("x-lotus-hook:") {
            has_token = true;
        }
    }

    if request_line.starts_with("GET /health") {
        reply(stream, "200 OK", "{\"ok\":true}");
        return Ok(());
    }
    if !request_line.starts_with("POST /hook/claude") || !has_token || content_length > 1_000_000 {
        reply(stream, "400 Bad Request", "{}");
        return Ok(());
    }

    let mut body = vec![0u8; content_length];
    reader.read_exact(&mut body)?;
    let payload: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
    let event = payload.get("hook_event_name").and_then(Value::as_str).unwrap_or("").to_string();

    if event != "PermissionRequest" {
        let _ = app.emit("agent:event", &payload);
        reply(stream, "200 OK", "{}");
        return Ok(());
    }

    // Permission prompt: hold the connection until the island answers.
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = mpsc::channel::<Answer>();
    {
        let pending: State<Pending> = tauri::Manager::state(&app);
        pending.0.lock().unwrap().insert(id, tx);
    }
    let mut ev = payload.clone();
    if let Some(o) = ev.as_object_mut() {
        o.insert("request_id".into(), json!(id));
    }
    let _ = app.emit("agent:permission", ev);

    let answer = rx.recv_timeout(ANSWER_TIMEOUT);
    {
        let pending: State<Pending> = tauri::Manager::state(&app);
        pending.0.lock().unwrap().remove(&id);
    }
    let _ = app.emit("agent:permission-done", json!({ "request_id": id }));

    let out = match answer {
        Ok((true, _)) => json!({"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}),
        Ok((false, msg)) => json!({"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{
            "behavior":"deny","message": msg.unwrap_or_else(|| "Denied from the Lotus island".into())}}}),
        Err(_) => json!({}),
    };
    reply(stream, "200 OK", &out.to_string());
    Ok(())
}

#[tauri::command]
pub fn hook_answer(pending: State<Pending>, request_id: u64, allow: bool, message: Option<String>) -> bool {
    pending.0.lock().unwrap().remove(&request_id).map(|tx| tx.send((allow, message)).is_ok()).unwrap_or(false)
}

// ── ~/.claude/settings.json management ──────────────────────────────────────

fn settings_path() -> Result<PathBuf, String> {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).ok_or("no home directory")?;
    Ok(PathBuf::from(home).join(".claude").join("settings.json"))
}

fn command_line() -> String {
    format!(
        "curl.exe -s -m 310 -X POST -H \"Content-Type: application/json\" -H \"X-Lotus-Hook: 1\" --data-binary @- http://127.0.0.1:{PORT}/hook/claude"
    )
}

fn read_settings(path: &PathBuf) -> Result<Value, String> {
    match std::fs::read_to_string(path) {
        Ok(t) if t.trim().is_empty() => Ok(json!({})),
        Ok(t) => serde_json::from_str(&t).map_err(|e| format!("settings.json is not valid JSON: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
        Err(e) => Err(e.to_string()),
    }
}

fn is_ours(entry: &Value) -> bool {
    entry
        .get("hooks")
        .and_then(Value::as_array)
        .map(|hs| hs.iter().any(|h| h.get("command").and_then(Value::as_str).map_or(false, |c| c.contains(MARKER))))
        .unwrap_or(false)
}

fn write_settings(path: &PathBuf, v: &Value) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let backup = path.with_file_name("settings.json.lotus-backup");
    if path.exists() && !backup.exists() {
        let _ = std::fs::copy(path, &backup);
    }
    std::fs::write(path, serde_json::to_string_pretty(v).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn hooks_installed() -> bool {
    settings_path()
        .and_then(|p| read_settings(&p))
        .map(|v| {
            v.pointer("/hooks/PermissionRequest").and_then(Value::as_array).map_or(false, |a| a.iter().any(is_ours))
        })
        .unwrap_or(false)
}

#[tauri::command]
pub fn hooks_install() -> Result<(), String> {
    let path = settings_path()?;
    let mut root = read_settings(&path)?;
    let obj = root.as_object_mut().ok_or("settings.json must be a JSON object")?;
    let hooks = obj.entry("hooks").or_insert_with(|| json!({}));
    let hooks = hooks.as_object_mut().ok_or("\"hooks\" in settings.json must be an object")?;
    for ev in EVENTS {
        let list = hooks.entry(ev).or_insert_with(|| json!([]));
        let list = list.as_array_mut().ok_or("hook list must be an array")?;
        list.retain(|e| !is_ours(e));
        let mut entry = json!({ "hooks": [{ "type": "command", "command": command_line(), "timeout": 310 }] });
        if ev == "PermissionRequest" {
            entry["matcher"] = json!("*");
        }
        list.push(entry);
    }
    write_settings(&path, &root)
}

#[tauri::command]
pub fn hooks_uninstall() -> Result<(), String> {
    let path = settings_path()?;
    let mut root = read_settings(&path)?;
    if let Some(hooks) = root.get_mut("hooks").and_then(Value::as_object_mut) {
        for ev in EVENTS {
            if let Some(list) = hooks.get_mut(ev).and_then(Value::as_array_mut) {
                list.retain(|e| !is_ours(e));
            }
        }
        hooks.retain(|_, v| v.as_array().map_or(true, |a| !a.is_empty()));
    }
    write_settings(&path, &root)
}

#[cfg(test)]
mod tests {
    use super::*;

    // One test so the HOME/USERPROFILE override cannot race with another test.
    #[test]
    fn install_is_idempotent_preserves_user_config_and_uninstalls_cleanly() {
        let dir = std::env::temp_dir().join(format!("lotus-hooks-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".claude")).unwrap();
        std::env::set_var("USERPROFILE", &dir);
        std::env::set_var("HOME", &dir);
        let path = dir.join(".claude").join("settings.json");
        let original = r#"{
  "model": "opus",
  "permissions": { "allow": ["Bash(git status)"] },
  "hooks": { "Stop": [ { "hooks": [ { "type": "command", "command": "echo mine" } ] } ] }
}"#;
        std::fs::write(&path, original).unwrap();

        assert!(!hooks_installed());
        hooks_install().unwrap();
        hooks_install().unwrap(); // twice: must not duplicate
        assert!(hooks_installed());

        let v: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(v["model"], "opus", "user settings survive");
        assert_eq!(v["permissions"]["allow"][0], "Bash(git status)");
        let stop = v["hooks"]["Stop"].as_array().unwrap();
        assert_eq!(stop.len(), 2, "user's own Stop hook + exactly one of ours");
        assert!(stop[0]["hooks"][0]["command"].as_str().unwrap().contains("echo mine"));
        assert_eq!(v["hooks"]["PermissionRequest"].as_array().unwrap().len(), 1);
        assert_eq!(v["hooks"]["PermissionRequest"][0]["matcher"], "*");
        for ev in EVENTS {
            assert!(v["hooks"][ev].is_array(), "{ev} registered");
        }
        assert!(
            v["hooks"]["PermissionRequest"][0]["hooks"][0]["command"].as_str().unwrap().contains("X-Lotus-Hook"),
            "request carries the anti-CSRF header"
        );
        // key order of the user's file is kept (preserve_order)
        let keys: Vec<_> = v.as_object().unwrap().keys().cloned().collect();
        assert_eq!(keys, ["model", "permissions", "hooks"]);
        // backup of the original was written once
        assert_eq!(std::fs::read_to_string(dir.join(".claude").join("settings.json.lotus-backup")).unwrap(), original);

        hooks_uninstall().unwrap();
        assert!(!hooks_installed());
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(v["hooks"]["Stop"].as_array().unwrap().len(), 1, "only ours removed");
        assert!(v["hooks"].get("PermissionRequest").is_none(), "empty lists pruned");

        // fresh machine: no settings file at all
        let _ = std::fs::remove_dir_all(dir.join(".claude"));
        hooks_install().unwrap();
        assert!(hooks_installed());
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn post(path: &str, token: bool, body: &str) -> String {
        use std::io::{Read, Write};
        let mut s = TcpStream::connect(("127.0.0.1", PORT)).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
        let tok = if token { "X-Lotus-Hook: 1\r\n" } else { "" };
        write!(s, "POST {path} HTTP/1.1\r\nHost: x\r\n{tok}Content-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}", body.len()).unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).unwrap();
        out
    }

    #[test]
    fn permission_round_trip_blocks_until_answered_and_rejects_untokened_posts() {
        use tauri::{test::mock_app, Listener, Manager};
        let app = mock_app();
        app.manage(Pending::default());
        let handle = app.handle().clone();
        start(handle.clone());
        thread::sleep(Duration::from_millis(300));

        let (tx, rx) = mpsc::channel::<String>();
        handle.listen("agent:permission", move |e| {
            let _ = tx.send(e.payload().to_string());
        });

        // A browser page (no custom header) is refused and produces no prompt.
        let refused = post("/hook/claude", false, r#"{"hook_event_name":"PermissionRequest"}"#);
        assert!(refused.starts_with("HTTP/1.1 400"), "{refused}");
        assert!(rx.recv_timeout(Duration::from_millis(300)).is_err(), "no prompt for untokened post");

        // Real request: stays open until we answer.
        let client = thread::spawn(|| {
            post(
                "/hook/claude",
                true,
                r#"{"hook_event_name":"PermissionRequest","session_id":"s1","cwd":"C:\\code\\app","tool_name":"Bash","tool_input":{"command":"npm test"}}"#,
            )
        });
        let payload: Value = serde_json::from_str(&rx.recv_timeout(Duration::from_secs(5)).expect("island got the prompt")).unwrap();
        assert_eq!(payload["tool_name"], "Bash");
        assert_eq!(payload["tool_input"]["command"], "npm test");
        let id = payload["request_id"].as_u64().unwrap();
        thread::sleep(Duration::from_millis(200));
        assert!(!client.is_finished(), "connection is held open while the user decides");

        assert!(hook_answer(handle.state::<Pending>(), id, true, None));
        let resp = client.join().unwrap();
        assert!(resp.starts_with("HTTP/1.1 200"), "{resp}");
        assert!(resp.contains(r#""hookEventName":"PermissionRequest""#) && resp.contains(r#""behavior":"allow""#), "{resp}");
        assert!(!hook_answer(handle.state::<Pending>(), id, true, None), "an answered request cannot be answered twice");

        // Deny carries a message back to Claude.
        let (tx2, rx2) = mpsc::channel::<String>();
        handle.listen("agent:permission", move |e| { let _ = tx2.send(e.payload().to_string()); });
        let client = thread::spawn(|| post("/hook/claude", true, r#"{"hook_event_name":"PermissionRequest","tool_name":"Write","tool_input":{"file_path":"a.txt"}}"#));
        let id = serde_json::from_str::<Value>(&rx2.recv_timeout(Duration::from_secs(5)).unwrap()).unwrap()["request_id"].as_u64().unwrap();
        assert!(hook_answer(handle.state::<Pending>(), id, false, Some("no thanks".into())));
        let resp = client.join().unwrap();
        assert!(resp.contains(r#""behavior":"deny""#) && resp.contains("no thanks"), "{resp}");

        // Non-permission events answer immediately with {}.
        let ev = post("/hook/claude", true, r#"{"hook_event_name":"UserPromptSubmit","session_id":"s1"}"#);
        assert!(ev.ends_with("{}"), "{ev}");
    }
}
