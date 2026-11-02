# CLAUDE.md: Lotus

Lotus is a **lightweight desktop app for Windows, macOS and Linux (Tauri 2 + React 19 + TypeScript)** that fronts local AI engines: chat (Ollama), images (ComfyUI), voice (Voicebox), Deep Research (local LLM + public academic APIs), plus an always-on-top **floating island**. Local-first and private. **Stage: feature-complete prototype that has never been built on Windows; the CI build is currently failing (B1).**

## Read first (in this order)
1. `CURRENT_STATE.md` — what is verified, known bugs (B1…B17), CI history. **Start here.**
2. `TASKS.md` — prioritized work; the **next three tasks are T1, T2, T3**.
3. `ARCHITECTURE.md` — structure, windows/events, integrations, version-alignment.
4. `DECISIONS.md` — what was decided, what was rejected, what is still an unverified assumption.
5. `PROJECT_BRIEF.md` — purpose, workflows, requirements. `README.md` is the user-facing doc.

## Start-of-session checklist
- Do **not** assume the CI problem is fixed. Ask the user for the CI log lines starting with `MISMATCH` and whether `src-tauri/Cargo.lock` is committed (TASKS T1).
- The ZIP the user last received predates the `Cargo.toml` tilde pins and the `handover/` folder. Deliver a fresh zip after changes.
- Verify the environment before trusting any status in these docs: run the commands below.

## Commands
```bash
npm install                       # Node 22+
npx tsc --noEmit                  # type-check (must be clean)
npm run build                     # vite build → dist/ (two pages: index.html, island.html)
npm run check:tauri               # Rust-crate vs npm-package minor alignment (also runs in CI)
bash handover/verification/run-tests.sh   # 63 TS tests: research engine 25 · UI render 22 · service clients 16
bash handover/verification/run-builder-tests.sh   # 34 TS tests (session 4): builder protocol/agent loop/templates, download links, LoRA graph
bash handover/verification/run-s5-tests.sh        # 56 logic/flow + 24 render tests (session 5; session 8 added 11): VRAM scaler, GFM, cron, Kanban, memory/skills, Thinking, task agent
bash handover/verification/run-s7-tests.sh        # 27 logic/flow + 11 render tests (session 7): choices, plugins, creator, background model, rename, usage, folder attach, Library
bash handover/verification/run-s10-tests.sh       # 22 tests (session 10): engine installers, recommended models, ComfyUI recipes, guide flow, macOS menu, island default
bash handover/verification/run-s12-tests.sh       # 3 tests (session 12): first-run guide not skipped by an empty saved chat
bash handover/verification/run-s13-tests.sh       # 10 tests (session 13): menu shortcuts per OS, page commands, Undo/alerts, reply feedback, engine notice, Settings panes, reply actions
bash handover/verification/run-s11-tests.sh       # 12 tests (session 11): remote engine addresses, access keys, connection test, guide with remote engines, island reset, chat install proposals
node handover/verification/wix-render-check.mjs   # renders main.wxs with sample data; checks refs + per-user rules (npm i --no-save handlebars fast-xml-parser)
node handover/screenshots/shoot-s7.mjs            # Chromium screenshots (serve dist on :8123 first, same command); PNGs in /tmp/shots
node handover/screenshots/shoot-s8.mjs            # session 8: page accents, panels, chat bar, Auto appearance
node handover/screenshots/shoot-s10.mjs           # session 10: every first-run guide step, Windows + macOS layouts, light + dark
node handover/screenshots/shoot-s11.mjs           # session 11: remote engines in the guide and Engines → Change (browser mode, faked engines)
node handover/screenshots/shoot-s13.mjs           # session 13: menus, Undo note, Settings panes, Tasks, Voice, Engines (light + dark); prints Find/Undo/Esc checks
node handover/screenshots/shoot-s11-install.mjs   # session 11: chat install card (ask, running, done) with a fake Ollama
cd src-tauri && cargo test --lib          # 15 Rust tests (session 12: mac traffic-light maths): hook installer, approve/deny server, GPU parsers 2, context files 1, memory db 4, folder reader 1, session 10 setup 3 + installer allow-list 1
npm run tauri dev | tauri build           # needs Windows (or Linux libs) + Rust
pwsh scripts/package-portable.ps1         # after tauri build (Windows only)
```
**Expected today:** tsc clean; build OK; 63/63 TS tests; 34/34 builder tests; 56 + 24 session 5 tests; 27 + 11 session 7 tests; 22 session 10 tests; 12 session 11 tests; 3 session 12 tests; 10 session 13 tests; 15 Rust tests; `cargo check --locked` clean (session 12, Linux sandbox). The WiX MSI, macOS build and real engine installs are still unverified.

### Sandbox recipes (the dev sandbox has no Windows/Rust by default)
- **Rust:** `apt-get install -y --no-install-recommends rustc-1.85 cargo-1.85 build-essential pkg-config libssl-dev libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev`, then
  `export RUSTC=rustc-1.85 CARGO_TARGET_DIR=/tmp/tgt CARGO_RESOLVER_INCOMPATIBLE_RUST_VERSIONS=fallback` and use `cargo-1.85 check|test --locked` in `src-tauri/`. First compile takes ~5 min: **run in chunks with `timeout 280` and redirect output to a file** (commands are killed at 300 s). Newest crates need Rust > 1.85, hence the fallback resolver; never regenerate `Cargo.lock` casually (see Constraints).
- **Visual checks:** `apt-get install -y xvfb python3-gi gir1.2-webkit2-4.1 gir1.2-gtk-3.0 fonts-dejavu-core`; `npm run build`; in the **same command** start `(timeout 100 python3 -m http.server 8123 --directory dist &)` then `mkdir -p /tmp/shots && xvfb-run -a python3 handover/screenshots/shoot-research.py` (or `shoot-island-and-app.py`); view the PNGs. Scripts fake `__TAURI_INTERNALS__` for desktop layout and use an **ephemeral web context** (a persistent one served stale bundles). This is WebKit, not WebView2.
- **Gotchas:** background processes die when a command ends and `wait` can hang forever, so give servers their own `timeout`. The bash network allow-list includes npm, crates.io, GitHub, apt, **not** the research APIs (arXiv/PubMed/…) or static.rust-lang.org. Run UI render tests from inside the project dir (a second copy of React breaks `renderToString`). SSR output escapes `'` and inserts `<!-- -->`; normalise before matching.

## Session 13 map (Apple HIG pass, all OSes)
- Menus live in App's `menus`: `shortcut` is the Windows/Linux key (one handler runs them all), `mac` is the Mac key equivalent. On the Mac only the native menu handles keys. Page commands (File › New Image…) go through `lib/commands.ts` (`runCommand` / `useCommand`).
- Never use `window.confirm`: `confirmAlert` for things that can't be undone, `offerUndo` for deletes that can (`components/common/Alerts.tsx`).
- Engine offline states use `<EngineNotice id purpose />`, never a banner with an address.
- Button labels are Title Case; tooltips and descriptions sentence case; no ALL CAPS, no `cursor-pointer`, no text under 12 px. Say "this computer", not "this PC".
- Settings pane names are short nouns; link to them as "Settings → Engines".

## Session 12 map (guide, traffic lights, image viewer)
- macOS traffic lights are placed by `src-tauri/src/mac_chrome.rs` (keep `BAR_HEIGHT` in step with TitleBar's `h-[38px]`). Call `place_traffic_lights` after anything that shows or re-lays out the main window.
- `loadSetup`: only chats with messages skip the guide (`hasRealChats`).
- Full-screen images: `components/images/ImageViewer.tsx` (portal, window full screen while open).

## Session 11 map (launch on macOS/Linux, island off, remote engines)
- The main window is revealed by `main_ready` (timer + rAF in App) and by a one-shot Rust fallback in `lib.rs` (`reveal_main_once`). Never rely on `requestAnimationFrame` alone in a hidden window.
- Chat installs: the model proposes with a ```install block (`chat/install.ts`), the user must press Allow on `InstallCard`; never install anything from chat without that click, and keep image installs limited to the catalog.
- Engine addresses may be on another computer: check `isRemote(id)` before anything that starts, stops, installs or reads local files for an engine. Access keys live in `lotus.engineAuth.v1` and are added by `http()` only for that engine's own address.

## Session 10 map (installer, Lotus Studio folder, first-run guide, per-OS chrome)
- Map: `ARCHITECTURE.md` §5e. The MSI is per-user into Documents\Lotus Studio; every component needs an HKCU key path (never a file key path) or ICE38 fails.
- Engines are only ever installed by their own installers after the user opts in (DECISIONS D27). Add new installer hosts to `INSTALLER_HOSTS` in `downloads.rs` and to the README privacy section.
- Recommended models live in `setup/catalog.ts`; image picks need a recipe that matches ComfyUI's official template exactly.
- The guide's look is deliberately plain (D31): no cards, gradients or badges; one question per screen.
- macOS: no in-window menus or caption buttons; add new menu items to App's `menus` and they reach the menu bar. Island starts off everywhere.

## Session 8 map (petals, panels, chat bar, appearance)
- Five pages = the five petals of the user's icon (Chat blue, Images red, Voice orange, App Builder yellow, Tasks green): `styles/theme.ts PAGE_PALETTE / PETAL_ORDER`. **Never redraw the logo** (`assets/lotus-petals.png`, `src-tauri/icons/*`). A new feature goes inside an existing page, not a sixth page.
- Deep Research is a mode of Chat (`components/research/ResearchWorkspace.tsx` exports `ResearchView`; state from `useResearch` in App).
- Every place you type to a model uses `components/common/PromptBox.tsx` (box on a tray, edge meter, ModeButton, TrayButton/TrayToggle, round SendButton).
- Left/right panels: `lib/panels.tsx` + `SidebarPane`/`InspectorPane` (use `pinned` for main content styled as a pane). Never add a per-page inspector button; the title bar owns it.
- Appearance: `settings.appearance` ('auto' | 'light' | 'dark'); App computes `dark`. Use `lib/glass.ts` for anything that needs the OS theme.
- Tips on icon-only controls: `className="tip" data-tip="…"` (+ `data-tip-side="right" | "below"`). Keep an `aria-label` too.
- The title bar must stay transparent with no `backdrop-filter` (see DECISIONS, session 8).

## Session 7 map (choices, plugins, Library, usage, background model, island, frosted glass)
- Map: `ARCHITECTURE.md` §5d. Options cards: `chat/choices.ts` + `ChoiceCard.tsx`. Plugins: `plugins/*` (data only, validated; never execute anything). Library: `components/library/LibrarySheet.tsx`. Usage: `analytics/usage.ts` (pure, tested).
- Background housekeeping (memory, skills, titles) uses `settings.backgroundModel` via `agents/pool.ts modelForJob`; add new housekeeping job kinds to `BACKGROUND_KINDS`.
- **CSS gotcha:** write `-webkit-backdrop-filter` BEFORE `backdrop-filter`; the minifier keeps only the last, and WebView2 ignores the prefixed one.
- Chart colours: `--chart-1…5` (validated order). Never use `--petal-yellow` for chart marks.

## Session 5 map (memory, skills, tasks, VRAM auto-scaling, Think/Web, GFM)
- Map and request flow: `ARCHITECTURE.md` §5c. All background model work goes through `agents/pool.ts` (never call the model in a loop outside it), and through `services/llm.ts` (so llama.cpp works too).
- Memory must stay off when `session.incognito || session.memoryOff` (`memoryOnFor` in `useChat.ts`): no recall, no indexing, no learning. Keep it that way for anything new that reads or writes memory.
- Markdown: `lib/gfm.ts` (parser, tested) + `lib/markdownLite.tsx` (renderer). Never render model output any other way.
- `rusqlite` was added without registry access: the first CI build resolves it; commit the updated `Cargo.lock`.

## Session 4 map (App Builder, Models, LoRA)
- Builder code: `src/builder/*` (logic, testable) and `src/components/builder/*` (UI); Rust in `src-tauri/src/appbuilder.rs`. The agent's tag protocol is in `builder/protocol.ts`, its prompt in `builder/agent.ts` (`systemPrompt`). Keep file/model access behind `AgentIO` so `builder-tests.cjs` can drive the loop.
- Models UI: `components/workspaces/ModelsWorkspace.tsx` (shell, Language hub, Arena, Monitor) + `components/models/*`; it is rendered by Engines → Models. File downloads: `services/downloadService.ts` + `src-tauri/src/downloads.rs`.
- Project files must only be touched through `proj_*` commands (they enforce the project root). New Builder events go in the ARCHITECTURE event table.

## Conventions
- **TypeScript:** strict; function components + hooks; no `any` unless parsing external JSON; no `dangerouslySetInnerHTML` (use `lib/markdownLite.tsx` / `ReportMarkdown`).
- **All HTTP** goes through `http()` in `src/lib/http.ts` (Rust-backed, no CORS). Engine addresses come from `services/engineConfig.ts`. Wrap failures in `EngineError` with a message that says **what happened and how to recover**.
- **Cross-window messaging** only via `src/lib/bus.ts` (`emitEvent/onEvent/invokeNative/reportActivity`). Add new events to the table in `ARCHITECTURE.md`.
- **Persistence:** `localStorage` keys prefixed `lotus.`, versioned (`.v1`); list new keys in `ARCHITECTURE.md §6`. No blob URLs in persisted data.
- **UI:** Tailwind 4 with CSS variables (`--color-accent-vibrant|pastel|hover`); reuse `components/common/ui.tsx` primitives; type scale **12 (captions/labels, the minimum) / 14 (body, chat) / 18 (titles)**, weights 500/600, radii **8/12/16** (`rounded-lg/xl/2xl`); colours only via `var(--color-*)` tokens (never hard-coded hex, never a grey lighter than `--color-text-muted`); every control labelled; handle empty/loading/error states; verify dark mode. Use **named breakpoints (`lg:`, `xl:`)**, not arbitrary `min-[…]:` (ordering bug seen). Prefer `self-stretch` over `h-full` in flex rows.
- **Rust:** plain `std` where possible; no new crates without a reason; register commands in `lib.rs`; keep `#[cfg(windows)]` blocks tiny; any new outbound host must be added to `capabilities/default.json`, the README privacy section and `THIRD_PARTY_LICENSES.md`.
- Copy tone: plain, specific, no jargon; no emoji in the product UI.

## Critical constraints
1. **Light and local-first.** No Electron/Chromium, no CDN assets, no telemetry. The only external traffic is Deep Research/source-search queries to the four listed APIs, **Web search when the user turns it on** (DuckDuckGo or their SearXNG, plus fetching the top result pages; session 5 widened the HTTP capability to `https://*/*` for this), and, on the user's click (or the opt-in launch check), the update check/download from the project's GitHub Releases (`src-tauri/src/updates.rs`). Since session 11, engine requests also go to **another computer when the user sets an engine's address to one** (D34). Memory, skills and tasks never leave the PC.
2. **No fake UI.** Never ship a control, number or screen that is simulated or does nothing (B2 is the known violation; fix it, don't add to it).
3. **Tauri alignment:** `tauri`/plugin **crates and `@tauri-apps/*` npm packages must share major.minor** (npm pinned exactly, crates `~`-pinned, `Cargo.lock` committed). Bump both sides together and run `npm run check:tauri`.
4. **Licences:** do **not** pick a licence for the user (open decision B15). Do **not** use Coucou's name, "Mochi" mascot, icons or sounds (see `THIRD_PARTY_LICENSES.md`).
5. **Never mark something ✅ without running it.** Windows-only Rust, the WiX MSI, the real WebView2 window, and live engines/APIs are **unverified**; say so.
6. **Do not remove** `handover/` (it holds the only test harnesses) or edit application code during pure documentation tasks.
7. Deep Research: keep the per-host rate limiter; keep citation sanitising; do not read PDFs without a new decision.

## Testing requirements
- Before declaring any change done: `npx tsc --noEmit`, `npm run build`, `bash handover/verification/run-tests.sh`; if Rust changed also `cargo check --locked` (no warnings) and `cargo test --lib --locked`.
- New logic needs a test in the matching harness (`rtest.ts` research engine, `test.ts` + `mock.mjs` service clients, `ui.tsx` render smoke) or a Rust unit test.
- UI changes: regenerate screenshots and **look at them** (light, dark, and the Tauri-sized desktop layout).
- A failing test must be explained as either a real bug or a stale expectation, with evidence.

## When you finish a session
- **Auto commit (user's choice):** when a session's changes pass the testing requirements, commit them straight to `main` and push to `origin` (github.com/filipesilva0/Lotus). End the message with the session's attribution lines. If the push is refused, say so and give the user the commands to push from their own folder.
Update `CURRENT_STATE.md` (statuses, bug table, CI history), `TASKS.md`, and `DECISIONS.md` for any new decision/assumption; keep the README "Status" section consistent; rebuild the zip excluding `node_modules/ dist/ src-tauri/target/ src-tauri/gen/`.
