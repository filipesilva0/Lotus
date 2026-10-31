//! Finds project context files in a folder Lotus opens (a chat workspace folder or an App Builder
//! project): persona, memory and rules files that other agent tools also read.
//! Read-only: Lotus never writes to these files.

use serde::Serialize;
use std::path::Path;

/// File names looked for at the folder root (case-insensitive), with what they are used for.
/// kind: "soul" (persona/voice), "memory" (facts about the project/user), "rules" (instructions).
const ROOT_FILES: &[(&str, &str)] = &[
    ("soul.md", "soul"),
    ("persona.md", "soul"),
    ("memory.md", "memory"),
    ("user.md", "memory"),
    ("agents.md", "rules"),
    ("claude.md", "rules"),
    ("gemini.md", "rules"),
    ("hermes.md", "rules"),
    (".hermes.md", "rules"),
    ("lotus.md", "rules"),
    (".lotus.md", "rules"),
    (".cursorrules", "rules"),
    (".windsurfrules", "rules"),
    (".clinerules", "rules"),
    ("conventions.md", "rules"),
];

/// Folders whose Markdown files are all context (`.lotus/*.md`, `.cursor/rules/*.mdc`, …).
const DIRS: &[(&str, &str)] = &[(".lotus", "rules"), (".hermes", "rules"), (".cursor/rules", "rules"), (".clinerules", "rules")];

/// Single files in sub-folders.
const NESTED: &[(&str, &str)] = &[(".github/copilot-instructions.md", "rules"), (".lotus/soul.md", "soul"), (".lotus/memory.md", "memory")];

const MAX_BYTES: usize = 24 * 1024;
const MAX_FILES: usize = 24;

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ContextFile {
    /// Path relative to the folder, with forward slashes.
    pub rel: String,
    pub kind: String,
    pub content: String,
    pub truncated: bool,
    pub bytes: u64,
    pub modified: u64,
}

fn read_capped(path: &Path) -> Option<(String, bool, u64, u64)> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    let truncated = bytes.len() > MAX_BYTES;
    let mut text = String::from_utf8_lossy(&bytes[..bytes.len().min(MAX_BYTES)]).into_owned();
    if truncated {
        // Do not end mid-line.
        if let Some(i) = text.rfind('\n') {
            text.truncate(i);
        }
    }
    let modified = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
    Some((text, truncated, meta.len(), modified))
}

fn kind_for_name(name: &str, default: &str) -> String {
    let n = name.to_lowercase();
    if n.starts_with("soul") || n.starts_with("persona") {
        "soul".into()
    } else if n.starts_with("memory") || n.starts_with("user") {
        "memory".into()
    } else {
        default.into()
    }
}

fn push(rel: String, kind: String, path: &Path, out: &mut Vec<ContextFile>) {
    if out.len() >= MAX_FILES || out.iter().any(|f| f.rel.eq_ignore_ascii_case(&rel)) {
        return;
    }
    if let Some((content, truncated, bytes, modified)) = read_capped(path) {
        if !content.trim().is_empty() {
            out.push(ContextFile { rel, kind, content, truncated, bytes, modified });
        }
    }
}

pub fn discover(root: &Path) -> Vec<ContextFile> {
    let mut out: Vec<ContextFile> = Vec::new();
    // Root files: match case-insensitively against what is really there (SOUL.md, Memory.md…).
    if let Ok(rd) = std::fs::read_dir(root) {
        let mut names: Vec<String> = rd.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        for (want, kind) in ROOT_FILES {
            if let Some(real) = names.iter().find(|n| n.eq_ignore_ascii_case(want)) {
                push(real.clone(), kind.to_string(), &root.join(real), &mut out);
            }
        }
    }
    for (rel, kind) in NESTED {
        push(rel.to_string(), kind.to_string(), &root.join(rel), &mut out);
    }
    for (dir, kind) in DIRS {
        let d = root.join(dir);
        if let Ok(rd) = std::fs::read_dir(&d) {
            let mut files: Vec<String> = rd
                .flatten()
                .filter(|e| e.path().is_file())
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .filter(|n| {
                    let l = n.to_lowercase();
                    l.ends_with(".md") || l.ends_with(".mdc") || l.ends_with(".txt")
                })
                .collect();
            files.sort();
            for f in files {
                let k = kind_for_name(&f, kind);
                push(format!("{dir}/{f}"), k, &d.join(&f), &mut out);
            }
        }
    }
    out
}

#[tauri::command]
pub async fn ctx_discover(root: String) -> Result<Vec<ContextFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = Path::new(&root);
        if !p.is_dir() {
            return Err(format!("The folder {root} does not exist."));
        }
        Ok(discover(p))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_known_files_case_insensitively() {
        let d = std::env::temp_dir().join(format!("lotus-ctxtest-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join(".cursor/rules")).unwrap();
        std::fs::create_dir_all(d.join(".lotus")).unwrap();
        std::fs::write(d.join("SOUL.md"), "You are calm.").unwrap();
        std::fs::write(d.join("Memory.md"), "- Uses pnpm").unwrap();
        std::fs::write(d.join(".cursorrules"), "No semicolons").unwrap();
        std::fs::write(d.join(".cursor/rules/style.mdc"), "Tabs").unwrap();
        std::fs::write(d.join(".lotus/memory.md"), "- deploys to Fly").unwrap();
        std::fs::write(d.join("empty.md"), "").unwrap();
        std::fs::write(d.join("AGENTS.md"), "   ").unwrap();
        let f = discover(&d);
        let rels: Vec<&str> = f.iter().map(|x| x.rel.as_str()).collect();
        assert!(rels.contains(&"SOUL.md"));
        assert!(rels.contains(&"Memory.md"));
        assert!(rels.contains(&".cursorrules"));
        assert!(rels.contains(&".cursor/rules/style.mdc"));
        assert!(rels.contains(&".lotus/memory.md"));
        assert!(!rels.contains(&"AGENTS.md"), "blank files are skipped");
        assert_eq!(f.iter().find(|x| x.rel == "SOUL.md").unwrap().kind, "soul");
        assert_eq!(f.iter().find(|x| x.rel == ".lotus/memory.md").unwrap().kind, "memory");
        let _ = std::fs::remove_dir_all(d);
    }
}
