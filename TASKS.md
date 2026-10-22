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

## Dependency sketch
```
T1 ──► T2 ──► T3 ──┬─► T4
                   ├─► T10, T11
                   └─► (real WebView2 visual pass, a11y audit)
T5 ──► T7, T12            T6, T8, T9, T13: independent (T13 needs the user)
```
