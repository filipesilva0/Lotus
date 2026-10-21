# CLAUDE.md: Tomo

Tomo is a **lightweight Windows desktop app (Tauri 2 + React 19 + TypeScript)** that fronts local AI engines: chat (Ollama), images (ComfyUI), voice (Voicebox), Deep Research (local LLM + public academic APIs), plus an always-on-top **floating island**. Local-first and private. **Stage: feature-complete prototype that has never been built on Windows; the CI build is currently failing (B1).**

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
cd src-tauri && cargo test --lib --locked # 2 Rust tests (hook installer, approve/deny server)
npm run tauri dev | tauri build           # needs Windows (or Linux libs) + Rust
pwsh scripts/package-portable.ps1         # after tauri build (Windows only)
```
**Expected today:** tsc clean; build OK; 63/63 TS tests; 2/2 Rust tests.

### Sandbox recipes (the dev sandbox has no Windows/Rust by default)
- **Rust:** `apt-get install -y --no-install-recommends rustc-1.85 cargo-1.85 build-essential pkg-config libssl-dev libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev`, then
  `export RUSTC=rustc-1.85 CARGO_TARGET_DIR=/tmp/tgt CARGO_RESOLVER_INCOMPATIBLE_RUST_VERSIONS=fallback` and use `cargo-1.85 check|test --locked` in `src-tauri/`. First compile takes ~5 min: **run in chunks with `timeout 280` and redirect output to a file** (commands are killed at 300 s). Newest crates need Rust > 1.85, hence the fallback resolver; never regenerate `Cargo.lock` casually (see Constraints).
- **Visual checks:** `apt-get install -y xvfb python3-gi gir1.2-webkit2-4.1 gir1.2-gtk-3.0 fonts-dejavu-core`; `npm run build`; in the **same command** start `(timeout 100 python3 -m http.server 8123 --directory dist &)` then `mkdir -p /tmp/shots && xvfb-run -a python3 handover/screenshots/shoot-research.py` (or `shoot-island-and-app.py`); view the PNGs. Scripts fake `__TAURI_INTERNALS__` for desktop layout and use an **ephemeral web context** (a persistent one served stale bundles). This is WebKit, not WebView2.
- **Gotchas:** background processes die when a command ends and `wait` can hang forever, so give servers their own `timeout`. The bash network allow-list includes npm, crates.io, GitHub, apt, **not** the research APIs (arXiv/PubMed/…) or static.rust-lang.org. Run UI render tests from inside the project dir (a second copy of React breaks `renderToString`). SSR output escapes `'` and inserts `<!-- -->`; normalise before matching.

## Conventions
- **TypeScript:** strict; function components + hooks; no `any` unless parsing external JSON; no `dangerouslySetInnerHTML` (use `lib/markdownLite.tsx` / `ReportMarkdown`).
- **All HTTP** goes through `http()` in `src/lib/http.ts` (Rust-backed, no CORS). Engine addresses come from `services/engineConfig.ts`. Wrap failures in `EngineError` with a message that says **what happened and how to recover**.
- **Cross-window messaging** only via `src/lib/bus.ts` (`emitEvent/onEvent/invokeNative/reportActivity`). Add new events to the table in `ARCHITECTURE.md`.
- **Persistence:** `localStorage` keys prefixed `tomo.`, versioned (`.v1`); list new keys in `ARCHITECTURE.md §6`. No blob URLs in persisted data.
- **UI:** Tailwind 4 with CSS variables (`--color-accent-vibrant|pastel|hover`); reuse `components/common/ui.tsx` primitives; type scale **12 (captions/labels, the minimum) / 14 (body, chat) / 18 (titles)**, weights 500/600, radii **8/12/16** (`rounded-lg/xl/2xl`); colours only via `var(--color-*)` tokens (never hard-coded hex, never a grey lighter than `--color-text-muted`); every control labelled; handle empty/loading/error states; verify dark mode. Use **named breakpoints (`lg:`, `xl:`)**, not arbitrary `min-[…]:` (ordering bug seen). Prefer `self-stretch` over `h-full` in flex rows.
- **Rust:** plain `std` where possible; no new crates without a reason; register commands in `lib.rs`; keep `#[cfg(windows)]` blocks tiny; any new outbound host must be added to `capabilities/default.json`, the README privacy section and `THIRD_PARTY_LICENSES.md`.
- Copy tone: plain, specific, no jargon; no emoji in the product UI.

## Critical constraints
1. **Light and local-first.** No Electron/Chromium, no CDN assets, no telemetry. The only external traffic is Deep Research queries to the four listed APIs.
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
Update `CURRENT_STATE.md` (statuses, bug table, CI history), `TASKS.md`, and `DECISIONS.md` for any new decision/assumption; keep the README "Status" section consistent; rebuild the zip excluding `node_modules/ dist/ src-tauri/target/ src-tauri/gen/`.
