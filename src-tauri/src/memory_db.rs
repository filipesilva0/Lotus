//! Local long-term memory: a single SQLite file (`lotus.db` in the Lotus data folder) with
//! full-text search (SQLite FTS5) over
//!   * past chat messages  (session recall: "we talked about this last week"),
//!   * memory items        (facts and standing instructions, written by the user or learned),
//!   * skills              (procedures Lotus wrote for itself after finishing complex work).
//!
//! Skills are also mirrored to `<data>/skills/<slug>/SKILL.md` so they can be read and edited by hand.
//!
//! Nothing here leaves the PC. If the SQLite build lacks FTS5 (it should not: the bundled build
//! enables it) the same tables are created as plain tables and search falls back to LIKE.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

struct Db {
    conn: Connection,
    fts: bool,
    dir: PathBuf,
}

#[derive(Default)]
pub struct MemoryDb(Mutex<Option<Db>>);

// ── types shared with the web layer ─────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedMsg {
    pub id: String,
    pub session_id: String,
    pub title: String,
    pub role: String,
    pub content: String,
    pub ts: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    pub id: String,
    pub session_id: String,
    pub title: String,
    pub role: String,
    pub snippet: String,
    pub ts: i64,
    pub score: f64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MemoryRow {
    pub id: String,
    pub kind: String,
    pub text: String,
    pub source: String,
    #[serde(default)]
    pub uses: i64,
    pub ts: i64,
    #[serde(default)]
    pub updated: i64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SkillRow {
    pub id: String,
    pub name: String,
    pub description: String,
    pub when_to_use: String,
    pub body: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default = "one")]
    pub version: i64,
    #[serde(default)]
    pub uses: i64,
    #[serde(default)]
    pub wins: i64,
    #[serde(default = "yes")]
    pub enabled: bool,
    pub origin: String,
    pub created: i64,
    pub updated: i64,
}
fn one() -> i64 {
    1
}
fn yes() -> bool {
    true
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub fts5: bool,
    pub path: String,
    pub messages: i64,
    pub memories: i64,
    pub skills: i64,
}

// ── query helpers ───────────────────────────────────────────────────────────

const STOP: &[&str] = &[
    "the", "and", "for", "are", "but", "not", "you", "your", "with", "this", "that", "was", "what", "how", "can", "could",
    "would", "should", "have", "has", "had", "from", "they", "them", "then", "than", "there", "here", "about", "into",
    "just", "like", "please", "want", "need", "make", "does", "did", "its", "it's", "our", "out", "who", "why", "when",
    "where", "which", "will", "all", "any", "some", "one", "get", "got", "use", "using", "me", "my", "is", "it", "to",
    "of", "in", "on", "a", "an", "be", "do", "so", "if", "or", "as", "at", "by", "we", "i",
];

/// Turns free text into a safe FTS5 query: up to 12 distinct words, each a quoted prefix term,
/// joined with OR. Quotes and FTS operators in the input can never reach the query syntax.
pub fn fts_query(text: &str) -> Option<String> {
    let mut seen: Vec<String> = Vec::new();
    for raw in text.split(|c: char| !c.is_alphanumeric()) {
        let w = raw.to_lowercase();
        if w.chars().count() < 2 || STOP.contains(&w.as_str()) || seen.contains(&w) {
            continue;
        }
        seen.push(w);
        if seen.len() == 12 {
            break;
        }
    }
    if seen.is_empty() {
        None
    } else {
        Some(seen.iter().map(|w| format!("\"{w}\"*")).collect::<Vec<_>>().join(" OR "))
    }
}

/// Words for the LIKE fallback (same filtering as `fts_query`).
fn like_words(text: &str) -> Vec<String> {
    fts_query(text)
        .map(|q| q.split(" OR ").map(|t| t.trim_matches(|c| c == '"' || c == '*').to_string()).collect())
        .unwrap_or_default()
}

pub fn slug(name: &str) -> String {
    let mut s = String::new();
    for c in name.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            s.push(c);
        } else if !s.ends_with('-') && !s.is_empty() {
            s.push('-');
        }
    }
    let s = s.trim_matches('-').chars().take(60).collect::<String>();
    if s.is_empty() {
        "skill".to_string()
    } else {
        s
    }
}

/// SKILL.md text (YAML front matter + body), the format used by agent-skill folders.
pub fn skill_markdown(s: &SkillRow) -> String {
    let esc = |v: &str| v.replace('\n', " ").replace('"', "'");
    format!(
        "---\nname: \"{}\"\ndescription: \"{}\"\nwhen_to_use: \"{}\"\nversion: {}\ntags: [{}]\norigin: {}\n---\n\n{}\n",
        esc(&s.name),
        esc(&s.description),
        esc(&s.when_to_use),
        s.version,
        s.tags.iter().map(|t| format!("\"{}\"", esc(t))).collect::<Vec<_>>().join(", "),
        esc(&s.origin),
        s.body.trim()
    )
}

// ── opening ─────────────────────────────────────────────────────────────────

fn data_dir(app: &AppHandle) -> PathBuf {
    let installed = app.path().app_data_dir().unwrap_or_default();
    PathBuf::from(crate::paths::describe(installed).data_dir)
}

fn create_schema(conn: &Connection) -> Result<bool, String> {
    // journal_mode returns a row, so it is read with query_row (a batch would reject it). Best effort.
    let _ = conn.query_row("PRAGMA journal_mode=WAL", [], |r| r.get::<_, String>(0));
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS memories(id TEXT PRIMARY KEY, kind TEXT, text TEXT, source TEXT, uses INTEGER, ts INTEGER, updated INTEGER);
         CREATE TABLE IF NOT EXISTS skills(id TEXT PRIMARY KEY, json TEXT NOT NULL, updated INTEGER);",
    )
    .map_err(|e| e.to_string())?;
    let fts = conn
        .execute_batch(
            "CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(msg_id UNINDEXED, session_id UNINDEXED, title, role UNINDEXED, content, ts UNINDEXED, tokenize='unicode61 remove_diacritics 2');
             CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(id UNINDEXED, text, tokenize='unicode61 remove_diacritics 2');
             CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts USING fts5(id UNINDEXED, name, description, when_to_use, body, tokenize='unicode61 remove_diacritics 2');",
        )
        .is_ok();
    if !fts {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS messages_fts(msg_id TEXT, session_id TEXT, title TEXT, role TEXT, content TEXT, ts INTEGER);
             CREATE TABLE IF NOT EXISTS memories_fts(id TEXT, text TEXT);
             CREATE TABLE IF NOT EXISTS skills_fts(id TEXT, name TEXT, description TEXT, when_to_use TEXT, body TEXT);",
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(fts)
}

fn open_at(dir: &Path) -> Result<Db, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("Could not create the data folder {}: {e}", dir.display()))?;
    let conn = Connection::open(dir.join("lotus.db")).map_err(|e| format!("Could not open the memory database: {e}"))?;
    let fts = create_schema(&conn)?;
    Ok(Db { conn, fts, dir: dir.to_path_buf() })
}

/// Runs `f` with the database open, off the UI thread.
async fn with_db<T, F>(app: AppHandle, f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&Db) -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<MemoryDb>();
        let mut guard = state.0.lock().map_err(|_| "The memory database is busy.".to_string())?;
        if guard.is_none() {
            *guard = Some(open_at(&data_dir(&app))?);
        }
        f(guard.as_ref().expect("opened above"))
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── messages (session recall) ───────────────────────────────────────────────

fn index_messages(db: &Db, msgs: &[IndexedMsg]) -> Result<usize, String> {
    let tx = db.conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for m in msgs {
        tx.execute("DELETE FROM messages_fts WHERE msg_id = ?1", params![m.id]).map_err(|e| e.to_string())?;
        if m.content.trim().is_empty() {
            continue;
        }
        let content: String = m.content.chars().take(20_000).collect();
        tx.execute(
            "INSERT INTO messages_fts(msg_id, session_id, title, role, content, ts) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![m.id, m.session_id, m.title, m.role, content, m.ts],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(msgs.len())
}

fn snippet_of(content: &str, words: &[String]) -> String {
    let lower = content.to_lowercase();
    let at = words.iter().filter_map(|w| lower.find(w.as_str())).min().unwrap_or(0);
    let start = content.char_indices().map(|(i, _)| i).rfind(|i| *i <= at.saturating_sub(80)).unwrap_or(0);
    let s: String = content[start..].chars().take(220).collect();
    format!("{}{}…", if start > 0 { "…" } else { "" }, s.trim())
}

fn search_messages(db: &Db, query: &str, exclude: &str, limit: i64) -> Result<Vec<Hit>, String> {
    let mut out = Vec::new();
    if db.fts {
        let Some(q) = fts_query(query) else { return Ok(out) };
        let mut st = db
            .conn
            .prepare(
                "SELECT msg_id, session_id, title, role, snippet(messages_fts, 4, '', '', '…', 24), ts, bm25(messages_fts) AS r
                 FROM messages_fts WHERE messages_fts MATCH ?1 AND session_id != ?2 ORDER BY r LIMIT ?3",
            )
            .map_err(|e| e.to_string())?;
        let rows = st
            .query_map(params![q, exclude, limit], |r| {
                Ok(Hit { id: r.get(0)?, session_id: r.get(1)?, title: r.get(2)?, role: r.get(3)?, snippet: r.get(4)?, ts: r.get(5)?, score: -r.get::<_, f64>(6)? })
            })
            .map_err(|e| e.to_string())?;
        for h in rows.flatten() {
            out.push(h);
        }
    } else {
        let words = like_words(query);
        if words.is_empty() {
            return Ok(out);
        }
        let mut st = db
            .conn
            .prepare("SELECT msg_id, session_id, title, role, content, ts FROM messages_fts WHERE session_id != ?1 ORDER BY ts DESC LIMIT 4000")
            .map_err(|e| e.to_string())?;
        let rows = st
            .query_map(params![exclude], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, String>(4)?, r.get::<_, i64>(5)?)))
            .map_err(|e| e.to_string())?;
        for (id, session_id, title, role, content, ts) in rows.flatten() {
            let lower = content.to_lowercase();
            let score = words.iter().filter(|w| lower.contains(w.as_str())).count() as f64;
            if score > 0.0 {
                out.push(Hit { id, session_id, title, role, snippet: snippet_of(&content, &words), ts, score });
            }
        }
        out.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        out.truncate(limit.max(0) as usize);
    }
    Ok(out)
}

#[tauri::command]
pub async fn mem_status(app: AppHandle) -> Result<Status, String> {
    with_db(app, |db| {
        let count = |sql: &str| db.conn.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap_or(0);
        Ok(Status {
            fts5: db.fts,
            path: db.dir.join("lotus.db").to_string_lossy().into_owned(),
            messages: count("SELECT count(*) FROM messages_fts"),
            memories: count("SELECT count(*) FROM memories"),
            skills: count("SELECT count(*) FROM skills"),
        })
    })
    .await
}

#[tauri::command]
pub async fn mem_index(app: AppHandle, messages: Vec<IndexedMsg>) -> Result<usize, String> {
    with_db(app, move |db| index_messages(db, &messages)).await
}

#[tauri::command]
pub async fn mem_forget_session(app: AppHandle, session_id: String) -> Result<(), String> {
    with_db(app, move |db| {
        db.conn.execute("DELETE FROM messages_fts WHERE session_id = ?1", params![session_id]).map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn mem_wipe_history(app: AppHandle) -> Result<(), String> {
    with_db(app, |db| db.conn.execute("DELETE FROM messages_fts", []).map(|_| ()).map_err(|e| e.to_string())).await
}

#[tauri::command]
pub async fn mem_search(app: AppHandle, query: String, exclude_session: Option<String>, limit: Option<i64>) -> Result<Vec<Hit>, String> {
    with_db(app, move |db| search_messages(db, &query, exclude_session.as_deref().unwrap_or(""), limit.unwrap_or(6))).await
}

// ── memory items ────────────────────────────────────────────────────────────

fn put_memory(db: &Db, m: &MemoryRow) -> Result<(), String> {
    db.conn
        .execute(
            "INSERT INTO memories(id, kind, text, source, uses, ts, updated) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, text = excluded.text, source = excluded.source, uses = excluded.uses, updated = excluded.updated",
            params![m.id, m.kind, m.text, m.source, m.uses, m.ts, m.updated],
        )
        .map_err(|e| e.to_string())?;
    db.conn.execute("DELETE FROM memories_fts WHERE id = ?1", params![m.id]).map_err(|e| e.to_string())?;
    db.conn.execute("INSERT INTO memories_fts(id, text) VALUES (?1, ?2)", params![m.id, m.text]).map_err(|e| e.to_string())?;
    Ok(())
}

fn list_memories(db: &Db) -> Result<Vec<MemoryRow>, String> {
    let mut st = db.conn.prepare("SELECT id, kind, text, source, uses, ts, updated FROM memories ORDER BY ts").map_err(|e| e.to_string())?;
    let rows = st
        .query_map([], |r| Ok(MemoryRow { id: r.get(0)?, kind: r.get(1)?, text: r.get(2)?, source: r.get(3)?, uses: r.get(4)?, ts: r.get(5)?, updated: r.get(6)? }))
        .map_err(|e| e.to_string())?;
    let v: Vec<MemoryRow> = rows.flatten().collect();
    Ok(v)
}

#[tauri::command]
pub async fn memories_list(app: AppHandle) -> Result<Vec<MemoryRow>, String> {
    with_db(app, list_memories).await
}

#[tauri::command]
pub async fn memories_put(app: AppHandle, items: Vec<MemoryRow>) -> Result<(), String> {
    with_db(app, move |db| {
        for m in &items {
            put_memory(db, m)?;
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn memories_delete(app: AppHandle, id: String) -> Result<(), String> {
    with_db(app, move |db| {
        db.conn.execute("DELETE FROM memories WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
        db.conn.execute("DELETE FROM memories_fts WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
}

/// Ids of memory items that match `query`, best first.
#[tauri::command]
pub async fn memories_search(app: AppHandle, query: String, limit: Option<i64>) -> Result<Vec<String>, String> {
    with_db(app, move |db| {
        let limit = limit.unwrap_or(8);
        if db.fts {
            let Some(q) = fts_query(&query) else { return Ok(vec![]) };
            let mut st = db.conn.prepare("SELECT id FROM memories_fts WHERE memories_fts MATCH ?1 ORDER BY bm25(memories_fts) LIMIT ?2").map_err(|e| e.to_string())?;
            let rows = st.query_map(params![q, limit], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
            let v: Vec<String> = rows.flatten().collect();
            Ok(v)
        } else {
            let words = like_words(&query);
            let mut scored: Vec<(usize, String)> = list_memories(db)?
                .into_iter()
                .map(|m| (words.iter().filter(|w| m.text.to_lowercase().contains(w.as_str())).count(), m.id))
                .filter(|(n, _)| *n > 0)
                .collect();
            scored.sort_by_key(|x| std::cmp::Reverse(x.0));
            Ok(scored.into_iter().take(limit as usize).map(|(_, id)| id).collect())
        }
    })
    .await
}

// ── skills ──────────────────────────────────────────────────────────────────

fn skill_dir(db: &Db, s: &SkillRow) -> PathBuf {
    db.dir.join("skills").join(slug(&s.name))
}

fn get_skill(db: &Db, id: &str) -> Result<Option<SkillRow>, String> {
    let json: Option<String> =
        db.conn.query_row("SELECT json FROM skills WHERE id = ?1", params![id], |r| r.get(0)).optional().map_err(|e| e.to_string())?;
    Ok(json.and_then(|j| serde_json::from_str(&j).ok()))
}

#[tauri::command]
pub async fn skills_list(app: AppHandle) -> Result<Vec<SkillRow>, String> {
    with_db(app, |db| {
        let mut st = db.conn.prepare("SELECT json FROM skills ORDER BY updated DESC").map_err(|e| e.to_string())?;
        let rows = st.query_map([], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
        let v: Vec<SkillRow> = rows.flatten().filter_map(|j| serde_json::from_str(&j).ok()).collect();
        Ok(v)
    })
    .await
}

/// Saves a skill and mirrors it to `skills/<slug>/SKILL.md`. Returns the file path.
#[tauri::command]
pub async fn skills_put(app: AppHandle, skill: SkillRow) -> Result<String, String> {
    with_db(app, move |db| {
        // A rename moves the folder: remove the old one first.
        if let Some(old) = get_skill(db, &skill.id)? {
            if slug(&old.name) != slug(&skill.name) {
                let _ = std::fs::remove_dir_all(skill_dir(db, &old));
            }
        }
        let json = serde_json::to_string(&skill).map_err(|e| e.to_string())?;
        db.conn
            .execute(
                "INSERT INTO skills(id, json, updated) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated = excluded.updated",
                params![skill.id, json, skill.updated],
            )
            .map_err(|e| e.to_string())?;
        db.conn.execute("DELETE FROM skills_fts WHERE id = ?1", params![skill.id]).map_err(|e| e.to_string())?;
        db.conn
            .execute(
                "INSERT INTO skills_fts(id, name, description, when_to_use, body) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![skill.id, skill.name, skill.description, skill.when_to_use, skill.body],
            )
            .map_err(|e| e.to_string())?;
        let dir = skill_dir(db, &skill);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let file = dir.join("SKILL.md");
        std::fs::write(&file, skill_markdown(&skill)).map_err(|e| format!("Saved, but could not write {}: {e}", file.display()))?;
        Ok(file.to_string_lossy().into_owned())
    })
    .await
}

#[tauri::command]
pub async fn skills_delete(app: AppHandle, id: String) -> Result<(), String> {
    with_db(app, move |db| {
        if let Some(old) = get_skill(db, &id)? {
            let _ = std::fs::remove_dir_all(skill_dir(db, &old));
        }
        db.conn.execute("DELETE FROM skills WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
        db.conn.execute("DELETE FROM skills_fts WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
}

/// Ids of skills that match `query`, best first.
#[tauri::command]
pub async fn skills_search(app: AppHandle, query: String, limit: Option<i64>) -> Result<Vec<String>, String> {
    with_db(app, move |db| {
        let limit = limit.unwrap_or(3);
        if db.fts {
            let Some(q) = fts_query(&query) else { return Ok(vec![]) };
            // Weight the name and "when to use" above the body.
            let mut st = db
                .conn
                .prepare("SELECT id FROM skills_fts WHERE skills_fts MATCH ?1 ORDER BY bm25(skills_fts, 0.0, 6.0, 3.0, 4.0, 1.0) LIMIT ?2")
                .map_err(|e| e.to_string())?;
            let rows = st.query_map(params![q, limit], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
            let v: Vec<String> = rows.flatten().collect();
            Ok(v)
        } else {
            let words = like_words(&query);
            let mut st = db.conn.prepare("SELECT id, name || ' ' || description || ' ' || when_to_use FROM skills_fts").map_err(|e| e.to_string())?;
            let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))).map_err(|e| e.to_string())?;
            let mut scored: Vec<(usize, String)> = rows
                .flatten()
                .map(|(id, t)| (words.iter().filter(|w| t.to_lowercase().contains(w.as_str())).count(), id))
                .filter(|(n, _)| *n > 0)
                .collect();
            scored.sort_by_key(|x| std::cmp::Reverse(x.0));
            Ok(scored.into_iter().take(limit as usize).map(|(_, id)| id).collect())
        }
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("lotus-memtest-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn query_is_sanitised() {
        assert_eq!(fts_query("How do I deploy the \"app\" to Vercel?"), Some("\"deploy\"* OR \"app\"* OR \"vercel\"*".to_string()));
        assert_eq!(fts_query("the and of"), None);
        assert_eq!(fts_query("NEAR(a b) OR x:y"), Some("\"near\"*".to_string()));
    }

    #[test]
    fn slugs_are_folder_safe() {
        assert_eq!(slug("Deploy a Vite app → GitHub Pages!"), "deploy-a-vite-app-github-pages");
        assert_eq!(slug("../../etc"), "etc");
        assert_eq!(slug("…"), "skill");
    }

    #[test]
    fn index_and_search_round_trip() {
        let dir = temp_dir("rt");
        let db = open_at(&dir).unwrap();
        let msgs = vec![
            IndexedMsg { id: "m1".into(), session_id: "s1".into(), title: "Router".into(), role: "user".into(), content: "My TP-Link router keeps dropping wifi at night".into(), ts: 1 },
            IndexedMsg { id: "m2".into(), session_id: "s2".into(), title: "Cake".into(), role: "user".into(), content: "A lemon drizzle cake recipe".into(), ts: 2 },
        ];
        index_messages(&db, &msgs).unwrap();
        let hits = search_messages(&db, "why does my wifi drop?", "", 5).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].session_id, "s1");
        // The current session is excluded.
        assert!(search_messages(&db, "wifi", "s1", 5).unwrap().is_empty());
        // Re-indexing replaces instead of duplicating.
        index_messages(&db, &msgs).unwrap();
        assert_eq!(search_messages(&db, "lemon", "", 5).unwrap().len(), 1);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn skill_markdown_has_front_matter() {
        let s = SkillRow {
            id: "k".into(), name: "Fix \"npm\" EPERM".into(), description: "d".into(), when_to_use: "w".into(), body: "1. step".into(),
            tags: vec!["npm".into()], version: 2, uses: 0, wins: 0, enabled: true, origin: "auto".into(), created: 0, updated: 0,
        };
        let md = skill_markdown(&s);
        assert!(md.starts_with("---\nname: \"Fix 'npm' EPERM\""));
        assert!(md.contains("version: 2"));
        assert!(md.trim_end().ends_with("1. step"));
    }
}
