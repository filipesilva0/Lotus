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
`app_paths`, `main_ready`, `open_main(view?)`, `quit_app`, `island_resize/show/hide/focus/visible`, `hook_answer`, `hooks_installed/install/uninstall`, `engine_start/stop/supervised/find`, `engine_ping`; **session 4:** `download_start/cancel`, `comfy_models_dir`, `list_model_files` (`downloads.rs`); `proj_create/tree/read/write/mkdir/delete/rename`, `proc_spawn/kill/running`, `preview_serve/stop`, `toolchain_check`, `android_paths`, `adb_devices/screenshot/tap/swipe/key`, `emulator_avds` (`appbuilder.rs`); **session 5:** `hw_snapshot`, `ctx_discover`, `mem_*`, `memories_*`, `skills_*`; **session 7:** `ctx_read_folder(root, maxFiles?, maxChars?)` (`context_files.rs`, read-only folder walk for Attach a folder).

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
| `download:progress` | Rust `download_start` → Models UI | `{id,received,total,done,error,path}` |
| `proc:output`, `proc:exit` | Rust `proc_spawn` → `main` window only | `{id,stream,data}` / `{id,code}` |
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

## 5b. App Builder (session 4) ⚠️ unbuilt

```
components/builder/BuilderWorkspace  (kept mounted after first visit; `active` prop hides its toolbar)
  hooks (src/builder/): useProjects · useFiles · useTerminal · usePreview · useAgent
  agent.ts   runAgent(): stream turn → protocol.parseTurn → execute actions → feed results back (≤14 steps)
             AgentIO (tree/read/write/remove/stream) is injectable; commands/servers/preview come from the hooks via AgentCtx
  protocol.ts  <write_file>/<replace_in_file>/<read_file>/<list_files>/<delete_path>/<run_command>/<start_server>/<preview>/<plan>/<done>
  templates.ts website · React+Vite · PWA · Tauri desktop · Capacitor mobile · blank (+ GitHub workflows, base64 icons)
  projectFs.ts invoke wrappers for appbuilder.rs
Rust (appbuilder.rs, std only): safe_join() path guard; proc_spawn via cmd /D /S /C (raw_arg) with output events and taskkill /T;
  static preview server (127.0.0.1:0, GET/HEAD, mime table, reload script injected into HTML, /__lotus/reload = newest mtime);
  toolchain probe (8 s timeout, parallel); adb via the Android SDK found by env or %LOCALAPPDATA%\Android\Sdk (also added to PATH of spawned commands).
Preview: iframe sandbox (allow-scripts/forms/same-origin/popups/modals), CSP frame-src loopback only; phone/tablet frames scale to fit.
```
Agent conversation per project is stored in IndexedDB (`lotus.builder.chat.<projectId>`).

## 5c. Session 5: local agent layer ⚠️ unbuilt
```
src/hardware/scaler.ts      pure VRAM maths: KV bytes/token from GGUF metadata, context steps, agents, model fit (tested)
src/hardware/monitor.ts     polls Rust hw_snapshot (nvidia-smi → amdgpu sysfs → Windows counters) or ComfyUI; Ollama /api/show, /api/ps, /api/tags; keeps ScalePlan
src/agents/pool.ts          background-agent semaphore; limit = plan.maxSubagents (re-read before every start); priorities 0/1/2; housekeeping waits while chat streams
src/services/llm.ts         facade: Ollama or llama.cpp (llamacppService.ts, OpenAI-compatible SSE); extractJson
src/chat/thinking.ts        Thinking mode passes (analyse → draft → check → final, native `think` when the model reports it)
src/chat/webSearch.ts       DuckDuckGo HTML / SearXNG JSON, page reader, numbered context block
src/lib/gfm.ts              GitHub Flavored Markdown parser → tree; lib/markdownLite.tsx renders it (no innerHTML)
src/memory/store.ts         memory items, skills, chat index: Rust SQLite+FTS5 in the app, localStorage fallback in a browser
src/memory/recall.ts        what memory adds to a request (memories, past-chat snippets, skills, project files)
src/memory/learn.ts         reflect() (adaptive memory), considerSkill()/refineSkill() (skill loop), validators
src/context/discover.ts     project context files (Rust ctx_discover) → system-prompt block; used by Chat (workspace folder) and App Builder (project)
src/tasks/kanban.ts|cron.ts pure board rules (links, cycles, blocked, ordering) and cron parser/next-run (tested)
src/tasks/runner.ts         task agent (plan → steps → write-up); tasks/store.ts board + routines + scheduler + auto-runner
src/lib/liveSettings.ts     current settings for code outside React (set from App render, listeners notified after render)
src-tauri/src/hardware.rs   hw_snapshot          src-tauri/src/context_files.rs  ctx_discover
src-tauri/src/memory_db.rs  mem_status|index|forget_session|wipe_history|search, memories_list|put|delete|search, skills_list|put|delete|search
```
Request assembly in chat (`hooks/useChat.ts generate`): system prompt + date → recall block (≤ 50 % of the plan's context budget) → mounted files (trimmed to what is left) → academic/web sources → history. `num_ctx` = the plan's context when auto-scaling is on. After a reply (memory on only): index the exchange, `reflect()` every 3rd user turn or when the user talks about themselves, `considerSkill()` for complex exchanges; a correction after a skill-assisted reply runs `refineSkill()`.
No new cross-window events. Tasks/routines report progress through the existing `activity` event (island pills).

## 5d. Session 7 map ⚠️ not run on Windows
- **Choices**: `chat/choices.ts` (parser, instructions, answer text) → `components/chat/ChoiceCard.tsx`, rendered by `ChatStream`; `useChat.answerPoll` records `pollAnswer` and sends the answer.
- **Plugins**: `plugins/store.ts` (types, validation, store, `pluginSystemBlock` added to the system prompt after the choices instructions, `pluginCommands` for the composer), `plugins/creator.ts` (`draftPlugin`, agent pool priority 0), UI in `components/library/LibrarySheet.tsx` (Plugins tab).
- **Library**: `components/library/LibrarySheet.tsx` + `library/docs.ts` (SKILL.md / memory.md / soul text) + `skills/system.ts` (system skills).
- **Background model / rename**: `agents/pool.ts modelForJob` (`memory|skill|rename` → `settings.backgroundModel`), `chat/rename.ts` (`suggestTitle`, job kind `rename`, priority 2), called from `useChat` after the first reply.
- **Usage**: `analytics/usage.ts` (pure) → `components/account/UsageDashboard.tsx` in the profile sheet (`AccountModal` view `profile`, shown signed in or not).
- **Folder attach**: composer + menu → `ChatWorkspace.attachFolder` → `chat/folder.ts` (`pickAndReadFolder` → Rust `ctx_read_folder`, or `readPickedFiles` in the browser) → one context item per file.
- **Styling**: petal/chart tokens and `.material-frosted`/`.material-titlebar`/island classes in `index.css`.

## 6. Persistence map ✅ (all `localStorage`, shared by both windows)

`lotus.settings.v1`, `lotus.sessions.v1` (≤ 60 chats; blob attachments stripped), `lotus.activeSession.v1`, `lotus.engineUrls.v1`, `lotus.engine.<id>.exe`, `lotus.engine.<id>.policy`, `lotus.setup.dismissed`, `lotus.voice.profile|tab|story`, `lotus.dictate.lang`, `lotus.image.checkpoint`, `lotus.island.v1`, `lotus.island.chat.v1`, `lotus.research.v1` (≤ 40 projects, debounced, quota failures swallowed), `lotus.research.limits.v1`.
Session 5 keys: `lotus.tasks.v1`, `lotus.routines.v1`, `lotus.tasks.tab.v1`, `lotus.skills.meta.v1` (skill change notes), `lotus.memory.backfilled.v1`; in a plain browser only: `lotus.memory.v1` (also the legacy key, migrated into `lotus.db` and removed on first desktop run) and `lotus.skills.v1`. `lotus.settings.v1` gained `llmBackend, llamacppUrl, autoScale, vramReserveMb, maxSubagents, webSearchProvider, searxngUrl, webPagesToRead, autoMemory, autoSkills, sessionRecall`; chat sessions gained `memoryOff, thinking, webSearch, folder, folderOff`; messages gained `recall, mode`. Accounts (session 6): `lotus.account.v1` (signed-in session: tokens + name/email/avatar), `lotus.account.server.v1` (sync server URL + anon key), `lotus.sidebar.v1`. Synced to the account server (`user_state` table, see `sync-server/`): `profile.avatar`. On disk: `<data>/lotus.db` (SQLite, WAL) and `<data>/skills/<slug>/SKILL.md`.
Session 7 keys: `lotus.plugins.v1` (installed plugins). `lotus.settings.v1` gained `backgroundModel, autoRename`; chat sessions gained `autoTitle`; messages gained `pollAnswer`.
Session 4 keys: `lotus.comfy.modelsDir.v1` (ComfyUI models folder), `lotus.models.mode.v1`, `lotus.models.kind.v1`, `lotus.builder.projects.v1`, `lotus.builder.active.v1`, `lotus.builder.view.v1|term.v1|mode.v1|ctx.v1|model.v1`; `lotus.image.params.v1` gained optional `loras`.
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
