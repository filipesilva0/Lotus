# Lotus: Tasks

> Bug/limitation IDs (B1…B17) refer to `CURRENT_STATE.md`. Evidence legend: ✅ confirmed · ⚠️ unverified · 💡 proposed · ❓ unknown.
> Priorities: **P0** unblocks everything · **P1** correctness against real services · **P2** quality/polish · **P3** ideas.

## Next three recommended tasks (in order)

### ✔ 1. T1: Resolve the Tauri version-mismatch CI failure (B1)  *DONE in session 2 (user-reported CI passes `check:tauri` and compiles)*
Why first: the Windows build has never passed, and every other risk (Rust on Windows, WiX, installer behaviour) is hidden behind it.
1. **Ask the user for the CI log lines** that start with `MISMATCH` (they print the exact crate/npm versions) and whether `src-tauri/Cargo.lock` is committed in their repo and matches ours. (❓ both unknown.)
2. Change `scripts/check-tauri-versions.mjs` to read versions from `cargo metadata --format-version 1 --manifest-path src-tauri/Cargo.toml` (CI has Rust installed before this step), falling back to parsing `Cargo.lock` only if `cargo` is missing. This makes a missing/stale lock harmless. Keep the clear error message.
3. Make sure the user receives the **`Cargo.toml` tilde pins** (already edited in the working tree; they were verified locally but never reached the user) and a matching `Cargo.lock`. Re-run `cargo check --locked`, `cargo test --lib --locked`, `npm run check:tauri`.
4. Update README "Upgrading Tauri" if behaviour changed.
**Progress (session 2):** step 2 done (guard reads `cargo metadata`, lockfile fallback, stub-tested, not run against real cargo). Step 3: zip contains the `~` pins and a lockfile that satisfies them (checked statically; `cargo check/test` not re-run, no cargo). Step 4 README updated. **Still open:** step 1 (user's log lines), plus new finding **B18** (nested `@tauri-apps/api 2.12.4` under plugin-http), which needs a decision.
**Done when:** the CI steps `npm ci`, `npm run check:tauri` and the Tauri CLI's own version check all pass on `windows-latest`.

### ▶ 2. T2: Get the first green Windows build  *P0 — IN PROGRESS: `light.exe` (WiX link) fails; need the real `LGHT/ICE` line*
**Session 2 result: root cause found (Run key with doubled backslashes, LGHT0204) and fixed; awaiting the next CI run.** Earlier attempt: shortcut components' key paths changed `HKMU`→`HKCU` (ICE38/ICE64 hypothesis, untested). Ask the user for the lines containing `error LGHT` / `ICE` in the CI log (search the log for `LGHT`). **Workflow now prints them** (verbose build + "WiX diagnostics" step) and uploads a `wix-debug` artifact: ask for the text of the "=== light.exe output ===" section, or the artifact's `main.wxs`.
Expect and fix, one at a time, whatever fails next. Most likely suspects (all ⚠️ never built): the two `#[cfg(windows)]` blocks (`paths.rs` registry flag using `winreg 0.55`; `engines.rs` `creation_flags`), WiX compile/link of `src-tauri/wix/main.wxs` (custom `WixUI_Advanced` layout, `HKMU` components, `ConfigurableDirectory`), `scripts/package-portable.ps1`.
Method: user pastes the failing log → reproduce what is reproducible locally (Rust unit tests, template render check) → fix → ask for the next log. Keep each fix minimal and re-run the full verification set (`CLAUDE.md`).
**Done when:** the workflow uploads `Lotus-windows` containing an `.msi` and `Lotus-portable-x64.zip`.

### ▶ 3. T3: Smoke-test the real app on Windows  *P0/P1, depends on T2, needs the user's machine ❓*
Give the user a short manual checklist and collect results:
- MSI: "Install" vs "Customize" path; **Just for me / All users** page appears and works; install-folder page; features (Desktop shortcut, Start with Windows, Portable data) install/uninstall cleanly; upgrade install.
- Portable zip: runs from a writable folder; creates `data\` next to the exe; no writes to the user profile.
- App: starts without a white flash; tray icon/menu; close-to-tray; single-instance; **island** shows (transparent, always on top, correct position, hover peek, chat focus, resize animation); global shortcuts; engine Start/Stop; Windows-specific hidden console on spawned engines.
- Report each failure with a screenshot/log; fix by priority.
**Done when:** the checklist is complete and the findings are triaged into this file.

## Full backlog

### P0 / P1: unblock and verify against reality
| ID | Task | Depends on | Notes |
|---|---|---|---|
| T1 | Fix CI version mismatch | none | see above |
| T2 | First green Windows build | T1 | see above |
| T3 | Windows smoke test | T2 | see above |
| T4 | **Live-engine pass**: real Ollama chat/pull, ComfyUI generate, Voicebox start/generate/clone/stories/dictation. Correct the assumptions in B11 (server exe path, args, port). | T3 (or any Windows box with the engines) | Fix `engine_find` candidates and README "Connecting the engines" with facts. |
| T5 | **Live academic-API pass**: run one real Deep Research task with a 7B+ model. Verify arXiv/PubMed/OpenAlex/Crossref parsers on real responses, rate limiting, quality of plan/queries/report. **Fix B3** (OpenAlex needs `en`, PubMed `eng`: map per repo). | network + Ollama (not possible in the dev sandbox: its allow-list excludes these hosts) | Add real-response fixtures to `handover/verification/rtest.ts` afterwards. |
| T6 | Resolve dead settings (B2): implement `sendOnEnter` and `autoScroll` (cheap), **remove** controls/fields for the rest, or implement them deliberately. Never leave a control that does nothing. | none | Small, safe, independent. Good warm-up task. |

### P2: product gaps and robustness
| ID | Task | Depends on | Notes |
|---|---|---|---|
| T7 | Persona agents per spec (B4, STORM-style): personas ask questions/critique during research, not only in the final prompt. 💡 needs a design decision from the user (cost: more LLM calls). | T5 (to judge quality first) | |
| T8 | Tell the user when JSON fallback kicks in (B8); ComfyUI step progress via WebSocket (B7); optional display of reasoning (`thinking`) tokens. | none | WebSocket needs `@tauri-apps/plugin-websocket` + capability + matching crate/npm minor (see guard). |
| T9 | Wire `voice:speak-text` (B6): "Speak this" on chat messages / island answers → Voice → Speak. | none | |
| T10 | First-time "Lotus is still running in the tray" notice (B14); visible error if hook port 17495 cannot bind (B13). | T3 | |
| T11 | Storage robustness (B10): measure `localStorage` limits; if needed move chats/research to IndexedDB or files under the data dir. | T3 | Portable mode already relocates the WebView2 profile. |
| T12 | Spec parity items (B5): MCP/connector toggles (decide scope), richer Agent Graph, live per-loop context usage. | T5 | Ask the user which matter. |
| T13 | **Licence decision** (B15): ask the user; then set `LICENSE`, `Cargo.toml`, `src/App.tsx` header, `wix/license.rtf`, README, `THIRD_PARTY_LICENSES.md`. | none (needs user) | |

### Updates (session 2)
| ID | Task | Depends on | Notes |
|---|---|---|---|
| T14 | **Prove the update loop**: after T2, run `cargo check` (resolves `tauri-plugin-updater`, commit `Cargo.lock`); create the signing key and the 3 secrets (README "Publishing an update"); push tag `v0.1.1`, install the MSI from `v0.1.0`, press Check → Download and restart. Verify per-user vs per-machine install behaviour, the signature-failure message, and that portable copies are not offered the installer. | T2, user's repo/keys | Never run. If `updater()` fails at startup with the placeholder config, change the registration to build the plugin only when `plugins.updater.pubkey` is real. |

### P3: later / ideas 💡
- Island: multi-monitor placement, click-through outside the pill, user-chosen position.
- Code signing, auto-update, installer-size/perf measurement (B17), accessibility audit, real WebView2 visual pass.
- Git repo hygiene and `CHANGELOG.md` (B16); keep README status in sync with `CURRENT_STATE.md`.
- Voicebox: audio channels, push-to-talk hotkey, MCP agent voices. Coucou parity items listed as out of scope in `PROJECT_BRIEF.md`.
- Research: full-text/PDF reading, resumable runs, evidence-matrix export, auto-tags.

## Session 11 additions (main window on macOS/Linux, island off, remote engines)
| # | Task | Priority | Notes |
|---|---|---|---|
| T27 | **macOS and Linux launch check**: a fresh install opens the main window with the setup guide and no island; an install that had the island on also starts without it; closing the window to the tray and waiting does not reopen it (the 1.5 s fallback fires only once). | P0 | D32, D33. |
| T28 | **Remote engines for real**: Ollama on another PC (`OLLAMA_HOST=0.0.0.0`), ComfyUI `--listen`, Voicebox `--host 0.0.0.0`; connect from the guide and from Engines → Change; chat, image and voice generation, model pulls on the remote Ollama, Voicebox audio playback. Also once behind an https reverse proxy with an access key. | P1 | D34, A14. |
| T30 | **Chat installs for real**: ask Qwen 3.5 4B / Gemma 4 12B to "install a better chat model", "get me an image model", "add a voice model"; check they emit the ```install block, Allow pulls the model, Deny does nothing, the new model appears in the model menu. If small models ignore the block, add a fallback (e.g. detect "install <tag>" in the user's own message). | P1 | D35. |
| T29 | Remote ComfyUI: the Images model downloads still save to a folder on this computer. Consider a "download on that computer" path (e.g. ComfyUI-Manager's API) or hide Download for remote ComfyUI. | P2 | |

## Session 12 additions (guide, traffic lights, full-screen images)
| # | Task | Priority | Notes |
|---|---|---|---|
| T31 | **Mac check of session 12**: traffic lights level with Back / Forward after launch, resize, switching apps, light/dark change and leaving full screen; a Mac that ran 0.3.0 now shows the guide (if no chat has messages); full-screen viewer enters and leaves macOS full screen cleanly. If the lights still sit at the top, log the button frames from `mac_chrome.rs` (macOS 26 may lay the title bar out differently). | P0 | D36. |

## Dependency sketch
```
T1 ──► T2 ──► T3 ──┬─► T4
                   ├─► T10, T11
                   └─► (real WebView2 visual pass, a11y audit)
T5 ──► T7, T12            T6, T8, T9, T13: independent (T13 needs the user)
```

## Session 4 additions (App Builder, merged Models, LoRA)

| ID | Task | Priority | Notes |
|---|---|---|---|
| T14 | **First CI run will compile `appbuilder.rs` and `downloads.rs` for the first time.** Fix compile errors one by one (likely suspects: `tauri_plugin_http::reqwest` path, `Response::chunk`, `emit_to` payload bounds, `raw_arg`, `matches!` on `try_wait`). Run `cargo clippy` after. | P0 (with T2) | Never compiled; no Rust in the last sandbox. |
| T15 | Real `npx tsc --noEmit`, `npm run build`, `run-tests.sh` and the new `run-builder-tests.sh` on a machine with `npm install`. | P0 | Only shim-checked so far. |
| T16 | **Builder smoke test on Windows**: create each template; static preview + auto reload; npm install and dev server detection (needs Node); phone/tablet frame; agent (try qwen2.5-coder 7B/14B) build a to-do app in Plan and Direct mode; stop; approval card; terminal; "Remove from list". Record how often a 7B model breaks the tag protocol and tune `systemPrompt()` in `builder/agent.ts`. | P1 | Core acceptance test. |
| T17 | **Downloads smoke test**: a small LoRA from Hugging Face and a Civitai file with a token; cancel; existing-file error; ComfyUI lists it after refresh; LoRA applied in Images (check the generated image changes). | P1 | |
| T18 | Android: install Android Studio, create an AVD, build the Capacitor template (`gradlew.bat assembleDebug`), install, and check the mirror (screenshot rate, tap mapping, swipe). Check JAVA_HOME handling. | P2 | |
| T19 | Visual pass of Builder and Engines → Models at 980 px and 1280 px, light/dark; fix cramped layouts (consider a collapsible agent panel). | P1 | |
| T20 | Builder improvements: syntax colouring (small tokenizer or CodeMirror loaded lazily), search in files, undo checkpoints / diff review of agent edits, stdin for the terminal, run-as-app log capture for Tauri projects, open an existing project's `package.json` scripts as run buttons, GitHub push helper. | P2/P3 | |
| T21 | Models: delete downloaded checkpoint/LoRA files from the UI, show file sizes, resume interrupted downloads, optional checksum entry, HF repo browser. | P2 | |

## Session 5 additions (memory, skills, tasks, VRAM auto-scaling, Think/Web, GFM)

| ID | Task | Priority | Notes |
|---|---|---|---|
| T17 | **First real build of session 5**: `npm install`, real `npx tsc --noEmit`, `npm run build`, all four TS suites (`run-s5-tests.sh` new). Let CI resolve `rusqlite`, then commit `Cargo.lock`; run `cargo test --lib` (9 tests incl. 4 memory-db tests against real SQLite). | P0 (with T2/T14) | Only stand-in-checked so far. |
| T18 | **VRAM smoke test on Windows**: Models → Monitor scaling card on an NVIDIA PC (nvidia-smi) and an AMD/Intel PC (PowerShell counter). Compare its "free" with Task Manager; load a model and confirm context/agents change; start Ollama with `OLLAMA_NUM_PARALLEL=3` and run 3 Lotus tasks to confirm no out-of-memory. | P1 | B29–B31 |
| T19 | **Think / Web live pass**: qwen3 (native thinking) and llama3.1 (no thinking) in Thinking mode; Web with DuckDuckGo and with a local SearXNG; check citations and the "Reading …" tool rows. | P1 | B32–B33 |
| T20 | **Memory loop live pass**: talk for ~10 turns about yourself, confirm learned items appear and are sensible; pause Memory and confirm nothing is recalled or added; incognito; delete a learned item; restart and check `lotus.db`. Skill: finish a multi-step task, check Tasks → Skills and `skills/<name>/SKILL.md`, then correct it and check version 2. | P1 | B34 |
| T21 | Board polish: keyboard move between columns (today: Status select in the inspector), task templates, due-date reminders through the island. | P2 | |
| T22 | Optional: let task agents use tools (read project files via `proj_*`, run approved commands) by reusing the App Builder's tag protocol and approval card. Needs a decision (safety). | P3 | B35 |

## Session 7 additions (choices, usage, Library, plugins, background model, island, frosted glass)

| ID | Task | Priority | Notes |
|---|---|---|---|
| T23 | **Live pass with Ollama**: ask a llama3.1 8B and a 3B model to "ask me 3 questions to plan X"; check the ```choices block appears and the card answers correctly; check the list fallback on a model that ignores it. Draft two plugins with the creator and run their commands. Confirm chat titles appear after the first reply with a small background model (e.g. gemma3:1b). | P1 | B38, B42, B43 |
| T24 | **WebView2 visual pass** of the frosted surfaces (Settings, sheets, menus, title bar) over the acrylic window, and of the island rim while working; check GPU use with the island idle and working. | P1 | B44; the blur never worked before this session |
| T25 | Attach a large real repository (e.g. Lotus itself) and time `ctx_read_folder`; confirm skipped counts and that the chat stays responsive. | P2 | B41 |
| T26 | Plugins: sync through the account server (`user_state`), mirror to `<data>/plugins/*.json`, and an optional "share" export with a checksum. | P2 | B40 |
| T27 | Store the model per assistant message so usage and the Models chart attribute `@model` overrides correctly. | P3 | B39 |

## Session 10 additions (installer, guide, models, per-OS chrome)
| # | Task | Priority | Notes |
|---|---|---|---|
| T23 | **First MSI build of the new template**: watch for ICE errors (most likely ICE38/ICE64/ICE91 around the per-user folder, or `WixUIValidatePath`/`InvalidDirDlg` refs). Install: folder defaults to Documents\Lotus Studio, Engines page shows "already on this PC" for installed engines, Options toggles work, `HKCU\Software\Lotus\Lotus\SetupEngines` is written, uninstall leaves Engines/Projects/Exports. Upgrade from an older (per-machine) MSI: check both copies don't coexist. | P0 | Template rendered and checked here only. |
| T24 | **Guide on Windows**: real Ollama/ComfyUI/Voicebox installer downloads, the opened installers, detection while waiting, ComfyUI Desktop port 8000, Gemma pull, Z-Image files into ComfyUI's models folder, Voicebox model names match. | P0 | A12, A13. |
| T25 | **Mac pass**: traffic lights centred in the 38 px bar (tune `trafficLightPosition`), menu bar items work (⌘N, ⌘,, ⌘⌥S), Edit copy/paste in fields, Dock reopen, DMG window layout, vibrancy behind the guide. | P1 | |
| T26 | Generate images once with each recommended model in Images (Klein, Z-Image, Qwen-Image) and confirm the graphs run. | P1 | |
