# Lotus: Architecture

> Evidence legend: ✅ confirmed in source/tests · ⚠️ unverified · 💡 proposed · ❓ unknown. See `CURRENT_STATE.md` for what has actually been run.

## 1. Stack ✅

| Layer | Technology (versions from `package.json` / `Cargo.lock`) |
|---|---|
| Desktop shell | **Tauri 2.11.6** (Rust 2021 edition), system **WebView2** on Windows. Plugins: `http` 2.7.0, `dialog` 2.7.3, `opener` 2.5.5, `global-shortcut` 2.3.2, `single-instance` 2.4.5. Extra crates: `serde`, `serde_json` (`preserve_order`), `winreg` 0.55 (Windows only). |
| UI | **React 19**, **TypeScript 7**, **Vite 8** (two HTML entry points), **Tailwind CSS 4** (`@tailwindcss/vite`), `lucide-react`. Fonts bundled via `@fontsource-variable/*` (no CDN). |
| Persistence | **Browser `localStorage`** (WebView2 profile). **No database of our own.** Voicebox manages its own data. |
| Packaging | Tauri bundler → **WiX v3 MSI** using a customised template (`src-tauri/wix/main.wxs`); separate **portable zip** via `scripts/package-portable.ps1`; **GitHub Actions** (`windows-latest`). |
| Auth | None. Single local user. No accounts, no cloud. |
| Backend | **None of our own.** The "backend" is three external engines on loopback (below) plus Rust helpers inside the app. |

No git repository exists in the working directory; the user presumably keeps the project in GitHub (❓ repo state unknown).

## 2. Repository layout ✅

```
index.html / island.html          two Vite entry pages (studio window, island window)
src/
  main.tsx, App.tsx               studio entry; owns settings, chat sessions, image state, engine state wiring
  fonts.ts, index.css             bundled fonts; CSS variables, mascot keyframes
  styles/theme.ts                 palettes/fonts → CSS variables (applyThemeToDocument)
  types/lotus.ts                   ViewMode, LotusSettings, ChatSession, GeneratedImage…
  lib/
    http.ts                       http() = Rust-backed fetch in Tauri, normal fetch in browser; EngineError; isTauri
    bus.ts                        cross-window events (Tauri events / BroadcastChannel); invokeNative(); reportActivity()
    audio.ts                      MicRecorder, WAV encoding, waveform peaks, downloadBlob
    open.ts, markdownLite.tsx     open URL / reveal path; tiny safe markdown renderer (no innerHTML)
  services/
    engineConfig.ts               engine URLs (localStorage)
    ollamaService.ts              chat stream, chatOnce (token counts), tags, pull, delete, version
    comfyService.ts               txt2img graph, polling, checkpoints, stats
    voicebox.ts                   typed client for the Voicebox REST API
    engineControl.ts              start/stop/locate engines via Tauri commands
  hooks/useEngines.ts             polls the 3 engines; start/stop/policy; "start with Lotus"
  components/
    rail/LeftRail.tsx             icon rail (Chat, Images, Voice, Research | theme, Engines, Settings)
    common/ (ui.tsx, Modal, Toggle, PillSlider, Logo)   shared primitives
    workspaces/ (Chat, Image, Voice, Engines)
    voice/                        Speak, Voices(+VoiceEditor), Stories, Dictate, Library, EffectsChain, AudioPlayer, useVoiceData
    research/                     ResearchWorkspace (3 panels), ScopingView, LiveView, ReportView, Inspector, bits
    modals/ (SettingsModal, IslandSettingsPanel)
  island/                         Island (state machine + window sizing), IslandChat, ApprovalCard, Mascot, hooks, state
  research/                       types, repos (API connectors), llm (prompts/JSON), engine (orchestrator), store (React hook)
src-tauri/
  tauri.conf.json                 2 windows, CSP, bundle (msi), licenseFile
  capabilities/default.json       permissions incl. http allow-list
  src/ lib.rs paths.rs island.rs hooks.rs engines.rs main.rs
  wix/ main.wxs license.rtf       custom MSI template; placeholder licence page
  Cargo.toml / Cargo.lock         crate pins (see §8)
scripts/                          package-portable.ps1, check-tauri-versions.mjs
.github/workflows/build-windows.yml
handover/                         verification harnesses + screenshot scripts (see CLAUDE.md)
```

## 3. Process and window model ✅

Two WebView windows, one Rust process.

- **`main`**: the studio (1280×820, min 980×640, native decorations, starts hidden; the web layer calls `main_ready` after first paint so there is no white flash). Closing it **hides to tray**; Quit is in the tray menu.
- **`island`**: transparent, undecorated, always-on-top, skip-taskbar, starts hidden (config 420×64). The web layer owns animation and requests exact native sizes through `island_resize`; Rust clamps and centres it at the top of the **primary monitor only**. Current target sizes (`Island.tsx`): strip `(56+44+100·pills+12) × 36`, peek `max(340, 120+100·pills) × 96`, chat `460 × (500 | 214 when empty)`, approval `480 × 236`. The window grows first, then shrinks 340 ms after the CSS animation.
- Both windows share **one origin**, so `localStorage` is shared and `storage` events propagate settings (e.g. the island reacts to `lotus.island.v1`).
- `single-instance` plugin: a second launch just shows `main`.

### Rust Tauri commands ✅ (`lib.rs` handler list)
`app_paths`, `main_ready`, `open_main(view?)`, `quit_app`, `island_resize/show/hide/focus/visible`, `hook_answer`, `hooks_installed/install/uninstall`, `engine_start/stop/supervised/find`.

### Global shortcuts ✅ (registered in `lib.rs`, failures ignored)
Ctrl+Alt+Space → `island:open-chat`; Ctrl+Alt+D → `island:dictate`; Ctrl+Alt+T → `island:toggle`.

### Cross-window event contract ✅
| Event | Emitter → listener | Payload |
|---|---|---|
| `main:navigate` | Rust `open_main` → App | view name |
| `chat:prefill` | DictateTab → App | text |
| `chat:import` | IslandChat → App | `{role,content}[]` |
| `activity` | any window (`reportActivity`) → Island | `{id,kind,label,progress?,done?}`; kinds `image\|voice\|chat\|download\|research` |
| `island:toggle/open-chat/dictate` | Rust (tray/shortcuts) → Island | none |
| `agent:event`, `agent:permission`, `agent:permission-done` | Rust hook server → Island | Claude Code hook JSON (+`request_id`) |
| `voice:speak-text` | **nobody emits it**; `VoiceWorkspace` listens | text (dead hook, see CURRENT_STATE B6) |

Outside Tauri (plain browser dev), `bus.ts` falls back to `BroadcastChannel('lotus-bus')`.

## 4. Network and integrations

### 4.1 HTTP strategy ✅
All engine/API calls go through `http()` in `lib/http.ts`: inside Tauri it uses `@tauri-apps/plugin-http` (Rust `reqwest`), which **bypasses CORS**. This matters because ComfyUI rejects cross-origin requests by default. The capability file allows only `127.0.0.1:*`, `localhost:*`, and four HTTPS hosts (`export.arxiv.org`, `eutils.ncbi.nlm.nih.gov`, `api.openalex.org`, `api.crossref.org`). CSP forbids anything else. Custom engine addresses on other hosts (e.g. a LAN GPU box) are therefore **blocked** until the capability file is edited. ⚠️ Not tested against a real WebView2.

### 4.2 Engines ✅ (clients written from the engines' source/docs; tested against mocks only)
- **Ollama** `127.0.0.1:11434`: `/api/chat` (NDJSON stream; `thinking` tokens are dropped, not shown), `/api/chat` non-stream with real `prompt_eval_count/eval_count` (`chatOnce`, used by research), `/api/tags`, `/api/version`, `/api/ps`, `/api/delete`, `/api/pull` (progress stream).
- **ComfyUI** `127.0.0.1:8188`: builds a fixed 7-node txt2img graph (CheckpointLoaderSimple→CLIPTextEncode×2→EmptyLatentImage→KSampler→VAEDecode→SaveImage), `POST /prompt`, polls `/history/{id}`, fetches `/view`; `/object_info/CheckpointLoaderSimple` for checkpoints; `/system_stats`; `/interrupt`. No WebSocket (progress is elapsed time only).
- **Voicebox** `127.0.0.1:17493`: a typed client over its FastAPI server (read from the repository source, not a live server). Generation is **async**: `POST /generate` → poll `GET /history/{id}` → `GET /audio/{id}`. Also profiles/samples, presets, effects, stories, models (+`/tasks/active` for download progress), `/transcribe`, `/captures`, `/speak`. Lotus starts it with `--port <port> --data-dir <dataDir>\voicebox`, and Rust appends `--parent-pid <lotus pid>` so the server exits if Lotus dies. ⚠️ Default port 8000 in Voicebox's own CLI; 17493 is what its desktop app uses. Exact server executable name/location on Windows is unconfirmed.
- Ports are user-editable (`lotus.engineUrls.v1`).

### 4.3 Claude Code hook bridge ✅ (Rust, tested on Linux)
`hooks.rs` runs a plain-`std` HTTP server on `127.0.0.1:17495`. **Connect** (Settings → Island & Agents) edits `~/.claude/settings.json`, adding six hook events (`PermissionRequest`, `UserPromptSubmit`, `Stop`, `Notification`, `SessionStart`, `SessionEnd`), each running `curl.exe … -H "X-Lotus-Hook: 1" --data-binary @- http://127.0.0.1:17495/hook/claude`. For a `PermissionRequest` the connection is **held open** until the island's Allow/Deny arrives (`hook_answer`), then answered with `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"|"deny",…}}}`; after 5 minutes it returns `{}` so Claude Code falls back to its terminal prompt. Posts without the `X-Lotus-Hook` header are rejected (stops web-page spam). Existing user settings are preserved; a one-time `settings.json.lotus-backup` is written. ⚠️ The decision-JSON shape was copied from knowledge of Claude Code's hook contract, not verified against a live Claude Code.

### 4.4 Deep Research sources ✅ (parsers tested on fixtures, not live)
`research/repos.ts`: arXiv (Atom XML via regex), PubMed (esearch + efetch XML), OpenAlex (JSON, rebuilds abstract from inverted index), Crossref (JSON). Only titles/abstracts/metadata are read. Domain/credibility come from the **publisher landing page** when known (not `doi.org`). A shared per-host rate limiter (arXiv 3.1 s, NCBI 0.4 s, OpenAlex/Crossref 0.12 s) is used by all agents.

## 5. Deep Research pipeline ✅ (`src/research/`)

```
ResearchWorkspace ── useResearch (store.ts: persistence, steering actions, island activity)
   Mode A: proposeQuestions → proposePlan → proposePersonas          (llm.ts; JSON mode + tolerant parser + 1 retry + fallbacks)
   Approve → runResearch (engine.ts)
       supervisor starts one agent per sub-topic, ≤ parallelAgents at once
       agent loop (≤ maxDepth rounds):  proposeQueries → searchRepo × enabled repos → filter/dedupe/rank
                                       → extractFindings (4 abstracts per LLM call) → notes feed the next round
       synthesize: numbered evidence (≤ 40 refs) → streamed report → cleanCitations → append real reference list
   Steering reads Project state fresh each step: pause/resume/stop (RunControl), injected instructions, excluded domains, rejected sources
```
All state is one `Project` object (`research/types.ts`), mutated only via `api.patch`. Runs **do not survive closing the app**: on load, `running/synthesizing` projects become `stopped` with a note and partial results kept. Hallucination guard: citations that do not map to a fetched source are stripped; the reference list is generated by code, not by the model.

## 6. Persistence map ✅ (all `localStorage`, shared by both windows)

`lotus.settings.v1`, `lotus.sessions.v1` (≤ 60 chats; blob attachments stripped), `lotus.activeSession.v1`, `lotus.engineUrls.v1`, `lotus.engine.<id>.exe`, `lotus.engine.<id>.policy`, `lotus.setup.dismissed`, `lotus.voice.profile|tab|story`, `lotus.dictate.lang`, `lotus.image.checkpoint`, `lotus.island.v1`, `lotus.island.chat.v1`, `lotus.research.v1` (≤ 40 projects, debounced, quota failures swallowed), `lotus.research.limits.v1`.
Generated images are **session-only** (blob URLs). Portable mode relocates the WebView2 profile (hence localStorage) to `<exe dir>\data\webview`.

## 7. Install/packaging architecture

- **Scope choice**: custom WiX template based on Tauri's stock (dev-branch) `main.wxs`; swapped `WixUI_InstallDir` for `WixUI_Advanced`; dual-purpose package (`ALLUSERS=2`, `MSIINSTALLPERUSER=1`, default per-user); registry roots changed to `HKMU`; features: Desktop shortcut, Start with Windows (HKMU Run), Portable data (writes `HKMU\Software\Lotus\Lotus\PortableData=1`). ✅ Renders to valid XML with all refs resolving; ⚠️ never built by WiX.
- **Portable mode** (`paths.rs`): on if `lotus.portable` sits beside the exe **or** the registry flag is set. Sets `WEBVIEW2_USER_DATA_FOLDER` before any window exists; data dir = `<exe dir>\data`. ✅ Logic reviewed; registry branch ⚠️ unbuilt (Windows-only code).
- **WebView2**: `downloadBootstrapper` install mode (small installer; fetches runtime only if missing).
- **License page**: `bundle.licenseFile` → `wix/license.rtf` (placeholder).

## 8. Version-alignment architecture (currently the open problem)

Tauri's CLI refuses to build when a crate and its npm twin differ in major.minor. Three mechanisms now exist:
1. `package.json` pins `@tauri-apps/api 2.11.1`, `plugin-dialog 2.7.3`, `plugin-http 2.7.0`, `plugin-opener 2.5.5`, CLI `2.11.5` **exactly**.
2. `Cargo.toml` now uses tilde requirements (`tauri ~2.11.6`, `http ~2.7.0`, `dialog ~2.7.3`, `opener ~2.5.5`, `global-shortcut ~2.3.2`, `single-instance ~2.4.5`, `tauri-build ~2.6.3`) so any resolution stays on matching minors. ✅ Edited and verified locally with `cargo check --locked` + `cargo test`; ⚠️ **not yet released to the user or run in CI**.
3. `scripts/check-tauri-versions.mjs` compares `Cargo.lock` with `package.json` and runs in CI after `npm ci`. 💡 Planned improvement (not done): read versions from `cargo metadata` so a missing/stale lock cannot cause a false mismatch.

## 9. Key technical decisions (rationale in `DECISIONS.md`)
Tauri over Electron; Rust-side HTTP to avoid CORS; integrate Voicebox through its API instead of re-implementing; island as a separate always-on-top window sized from the web layer; curl+loopback HTTP for Claude hooks (no custom binary); `localStorage` instead of a database; one Models screen (Engines) as source of truth; Deep Research limited to abstracts with sanitized citations; exact version pins.
