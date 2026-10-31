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

// ── Attach a folder to a chat (session 6) ──────────────────────────────────
// Reads the text and code files of a folder the user picked, so they can be mounted as chat
// context. Read-only. Skips dependency/build folders, binaries and very large files, and stops at
// a total budget so a huge repository cannot freeze the app or flood the context window.

/// Folders never walked into.
const SKIP_DIRS: &[&str] = &[
    ".git", ".hg", ".svn", "node_modules", "target", "dist", "build", "out", ".next", ".nuxt", ".svelte-kit",
    "__pycache__", ".venv", "venv", "env", ".tox", ".mypy_cache", ".pytest_cache", "vendor", ".idea", ".vs",
    ".vscode", "bin", "obj", ".gradle", ".dart_tool", "Pods", ".cache", "coverage", ".turbo", ".parcel-cache",
];

/// Extensions read as text (lower-case, without the dot). Files with no extension are read when
/// they look like text (README, LICENSE, Makefile, Dockerfile…).
const TEXT_EXTS: &[&str] = &[
    "txt", "md", "markdown", "mdx", "mdc", "rst", "json", "jsonc", "csv", "tsv", "log", "yaml", "yml", "toml", "ini", "cfg",
    "conf", "env.example", "xml", "html", "htm", "css", "scss", "sass", "less", "js", "jsx", "mjs", "cjs", "ts", "tsx",
    "vue", "svelte", "py", "rs", "go", "java", "kt", "kts", "swift", "c", "h", "cpp", "hpp", "cc", "cs", "rb", "php",
    "sh", "bash", "zsh", "ps1", "bat", "cmd", "sql", "tex", "lua", "dart", "r", "scala", "gradle", "proto", "graphql",
    "gql", "tf", "nix", "zig", "ex", "exs", "erl", "hs", "ml", "clj", "el", "vim", "dockerfile", "gitignore", "editorconfig",
];

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FolderFile {
    pub rel: String,
    pub content: String,
    pub truncated: bool,
}

#[derive(Serialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct FolderRead {
    pub name: String,
    pub files: Vec<FolderFile>,
    /// Files seen but not read: binary, too large, or past the limits.
    pub skipped: u32,
    /// True when the walk stopped early because a limit was reached.
    pub limited: bool,
}

fn looks_textual(name: &str) -> bool {
    let l = name.to_lowercase();
    if let Some(dot) = l.rfind('.') {
        if dot > 0 {
            return TEXT_EXTS.contains(&&l[dot + 1..]);
        }
        // ".gitignore", ".editorconfig" style names
        return TEXT_EXTS.contains(&&l[1..]);
    }
    matches!(l.as_str(), "readme" | "license" | "licence" | "makefile" | "dockerfile" | "procfile" | "gemfile" | "rakefile" | "changelog" | "authors" | "notice")
}

pub fn read_folder(root: &Path, max_files: usize, max_file_bytes: usize, max_total: usize) -> FolderRead {
    let mut out = FolderRead { name: root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "folder".into()), ..Default::default() };
    let mut total = 0usize;
    let mut stack = vec![root.to_path_buf()];
    let mut visited_dirs = 0usize;
    while let Some(dir) = stack.pop() {
        visited_dirs += 1;
        if visited_dirs > 5000 {
            out.limited = true;
            break;
        }
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        let mut entries: Vec<_> = rd.flatten().collect();
        entries.sort_by_key(|e| e.file_name());
        let mut subdirs = Vec::new();
        for e in entries {
            let name = e.file_name().to_string_lossy().into_owned();
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_symlink() {
                continue; // never follow links out of the folder
            }
            if ft.is_dir() {
                if !SKIP_DIRS.iter().any(|d| d.eq_ignore_ascii_case(&name)) {
                    subdirs.push(e.path());
                }
                continue;
            }
            if !ft.is_file() {
                continue;
            }
            if !looks_textual(&name) || out.files.len() >= max_files || total >= max_total {
                out.skipped += 1;
                if out.files.len() >= max_files || total >= max_total {
                    out.limited = true;
                }
                continue;
            }
            let Ok(meta) = e.metadata() else { continue };
            if meta.len() as usize > max_file_bytes * 4 {
                out.skipped += 1;
                continue;
            }
            let Ok(bytes) = std::fs::read(e.path()) else { out.skipped += 1; continue };
            if bytes.iter().take(4096).any(|b| *b == 0) {
                out.skipped += 1; // binary
                continue;
            }
            let cap = max_file_bytes.min(max_total - total);
            let truncated = bytes.len() > cap;
            let mut text = String::from_utf8_lossy(&bytes[..bytes.len().min(cap)]).into_owned();
            if truncated {
                if let Some(i) = text.rfind('\n') {
                    text.truncate(i);
                }
            }
            if text.trim().is_empty() {
                continue;
            }
            total += text.len();
            let rel = e.path().strip_prefix(root).map(|p| p.to_string_lossy().replace('\\', "/")).unwrap_or(name);
            out.files.push(FolderFile { rel, content: text, truncated });
        }
        // Depth-first in name order: push in reverse so the first sub-folder is read first.
        subdirs.reverse();
        stack.extend(subdirs);
    }
    out
}

#[tauri::command]
pub async fn ctx_read_folder(root: String, max_files: Option<usize>, max_chars: Option<usize>) -> Result<FolderRead, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = Path::new(&root);
        if !p.is_dir() {
            return Err(format!("The folder {root} does not exist."));
        }
        Ok(read_folder(p, max_files.unwrap_or(200).min(1000), 200 * 1024, max_chars.unwrap_or(1_500_000).min(8_000_000)))
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

    #[test]
    fn reads_text_files_and_skips_noise() {
        let d = std::env::temp_dir().join(format!("lotus-foldertest-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("src/deep")).unwrap();
        std::fs::create_dir_all(d.join("node_modules/pkg")).unwrap();
        std::fs::write(d.join("README.md"), "# Hi").unwrap();
        std::fs::write(d.join("src/main.rs"), "fn main() {}").unwrap();
        std::fs::write(d.join("src/deep/notes.txt"), "deep").unwrap();
        std::fs::write(d.join("node_modules/pkg/index.js"), "module.exports = 1").unwrap();
        std::fs::write(d.join("logo.png"), [137u8, 80, 78, 71, 0, 0]).unwrap();
        std::fs::write(d.join("data.json"), [123u8, 0, 125]).unwrap();
        let r = read_folder(&d, 100, 1024, 10_000);
        let rels: Vec<&str> = r.files.iter().map(|f| f.rel.as_str()).collect();
        assert_eq!(rels, vec!["README.md", "src/main.rs", "src/deep/notes.txt"]);
        assert_eq!(r.skipped, 2, "png (not text) and json with NUL bytes");
        let capped = read_folder(&d, 1, 1024, 10_000);
        assert_eq!(capped.files.len(), 1);
        assert!(capped.limited);
        let _ = std::fs::remove_dir_all(d);
    }
}
