# Lotus: Current State

> Snapshot taken at the end of session 1. Evidence legend: ✅ confirmed (command/test output seen) · ⚠️ unverified · 💡 proposed · ❓ unknown.
> **Rule for future sessions:** update this file whenever a claim here changes. Do not mark something ✅ without having run it.

## 0. Session 2 changes (unverified, nothing was built or run)
- ⚠️ Renamed Tomo → Lotus everywhere (UI, installer, tray, identifier `app.lotus.studio`, crate `lotus`/`lotus_lib`, `lotus.portable`, localStorage keys `lotus.*`; `Cargo.lock` root entry and `package-lock.json` name edited by hand). Old `tomo.*` saved data is not migrated.
- ⚠️ New lotus line-art logo (`Logo.tsx`) and regenerated `src-tauri/icons/*`.
- ⚠️ Engine connection: `http()` now sends `Origin` = the engine's own address (needs `unsafe-headers` on `tauri-plugin-http`, added in `Cargo.toml`); new Rust command `engine_ping` + `diagnose()` show *why* an engine looks offline on the Engines cards. Root cause of "Ollama won't connect" is **not confirmed**; the diagnostic message will say.

## 0b. Session 4 changes: App Builder, merged Models, LoRA (⚠️ not built, not run on Windows)

What was asked: (1) an **App Builder** page in the spirit of an agent-first IDE, to build Windows/Mac/iOS/Android/web apps and see them running inside Lotus; (2) merge the new Models page into the old one's place (Engines → Models) and let the user **type any model name/link** to download (language, image, LoRA, voice); (3) a **LoRA** picker in Images, with LoRA downloads in Models.

**Verified here ✅** (commands run in the sandbox):
- Loose TypeScript check of the whole `src/` against hand-written React/Tauri shims (`tsc`, strict + noUnusedLocals on the new files): no errors other than shim noise. ⚠️ Not the real `@types/react`, so JSX prop typing of DOM elements was not checked; run the real `npx tsc --noEmit` first thing.
- `bash handover/verification/run-builder-tests.sh` (**34 tests**, new): action-tag parser (streaming/partial, fenced bodies, path-escape rejection, void/self-closing tags), unified-diff counter, dev-server URL detection, dangerous-command detector, history trimming, all 6 templates (no leftover placeholders, valid JSON, valid icons, workflow `${{ }}` intact), Hugging Face/Civitai link normalising, file-name validation, ComfyUI graph with 0/1/2/6 LoRAs, and the **whole agent loop against a scripted model and in-memory files** (fast mode, plan gate, failed edit → fix, denied command, auto-run vs dangerous, server without address, abort, empty/cut-off reply, step limit). In the sandbox they were run on `tsc`-transpiled output; the runner script uses esbuild like the other suites and has not been run as written.
- The existing suites (`run-tests.sh`, 63 tests) were **not re-run** this session (no esbuild offline); the files they cover were not changed except `comfyService.ts` (LoRA chain; no-LoRA graph is byte-for-byte what it was, asserted in the new tests).

**Written but never compiled or run ⚠️:**
- `src-tauri/src/appbuilder.rs` (project files, processes, static preview server, toolchain probe, adb helpers) and `src-tauri/src/downloads.rs` (model downloader). **No Rust toolchain existed in this sandbox**, so neither was compiled. They use only `std` plus `tauri_plugin_http::reqwest` (assumed re-exported; `Response::chunk()` assumed available) so `Cargo.lock` is unchanged. Expect a few compile errors on the first Windows CI run (see T14).
- `tauri.conf.json` CSP gained `frame-src http://127.0.0.1:* http://localhost:*` (needed for the preview iframe).
- All new UI (`components/builder/*`, `components/models/*`, `LoraPicker`, the merged Models tab) was **never rendered**: no screenshots, no WebView2. Layout at the 980 px minimum width is the main risk (sidebar + centre + 360 px inspector).

**What changed for users**
- Rail: **Models** removed; **App Builder** added (hammer). Models content is now Engines → Models (Library with a model-type list, Arena, Monitor). `ViewMode` `'models'` → `'builder'`.
- Engines → Storage: new "ComfyUI models folder" card (auto-found from the launcher or chosen), plus the Builder projects path.
- Images: LoRA button in the toolbar + LoRA section in the inspector; LoRAs are stored per image (`GeneratedImage.loras`) and restored by "reuse settings".
- Island: new activity kind `build`.
- The Builder stays mounted after first use (hidden on other pages) so dev servers, terminals and an agent run survive page changes.

**New known limitations (B18–B27)**
| ID | Issue |
|---|---|
| B18 | Rust modules above never compiled; `reqwest` re-export and `chunk()` are assumptions. |
| B19 | Builder/Models UI never rendered; narrow-window layout unchecked; no accessibility pass. |
| B20 | Agent quality with real local models is untested. The tag protocol (`builder/protocol.ts`) was chosen because small models are poor at JSON tool calls; expect to tune the system prompt (`agent.ts`). A 7B+ code model with 16K context is the assumed minimum. |
| B21 | "Seeing it run": web/PWA/Capacitor interfaces run in an iframe; dev servers need Node; **Windows desktop apps open in their own window** (not embeddable); Android is a screenshot mirror (~1 fps, adb); **iOS/macOS cannot be built or shown on Windows**: only a phone-frame web preview and a GitHub Actions workflow. |
| B22 | Terminal is non-interactive (no stdin): a command that prompts waits until Stop or the agent's 4-minute limit. Processes inherit the PATH Lotus started with (install Node, then restart Lotus). |
| B23 | Model downloads: no resume, no checksum check (Hugging Face/Civitai give none we use), tokens are not saved, no delete-model-file button. ComfyUI may need a refresh or restart to list new files. |
| B24 | Editor: no syntax colouring, search, or undo beyond the textarea's; files over 2 MB are not opened. |
| B25 | The static preview server follows symlinks inside the project and serves any file in the previewed folder to anything on 127.0.0.1. |
| B26 | Template versions (React 18, Vite 5, Capacitor 6, Tauri 2) were written from memory, not resolved against the registry; `icon.icns` is absent so macOS bundles may warn. The generated workflows are untested. |
| B27 | Agent file edits are not undoable (no checkpoints/diff review yet); only the project folder is protected from path escapes, commands can touch anything the user can. |

## 1. Development stage

**Feature-complete prototype (v0.1.0). Compiles on Windows CI (user-reported); MSI linking fails (§5), and the app has never been run on Windows.** All five product areas have working code that is verified only in a Linux sandbox against mocks and fixtures. **The GitHub Actions Windows build has never succeeded.** The nearest milestone is *first green CI build, then a smoke test on a real Windows machine*.

## 2. What is verified, and how ✅

| Check | Result | How to re-run |
|---|---|---|
| TypeScript type-check | clean | `npx tsc --noEmit` |
| Production web build | succeeds; JS+CSS+HTML 575 KB raw / **163 KB gzipped**, fonts ~398 KB, whole `dist/` ~973 KB | `npm run build` |
| Service clients (Ollama/ComfyUI/Voicebox) vs mock servers | **16/16 pass** (incl. NDJSON split mid-line, thinking tokens hidden, polling, error wording, ComfyUI graph wiring, WAV encoder) | `bash handover/verification/run-tests.sh` |
| Deep Research engine vs fake Ollama + fake arXiv/PubMed/OpenAlex/Crossref | **25/25 pass** (parsers, dedupe, year/domain filters, pause/resume/stop, steering, citation stripping, junk-JSON fallbacks, Ollama-down recovery, shared rate limiter ≥ 3 s on arXiv) | same script |
| Research UI server-side render across all lifecycle states + every inspector tab | **22/22 pass** | same script |
| Rust: `cargo check` | no errors, no warnings (Linux, Rust 1.85) | see `CLAUDE.md` sandbox recipe |
| Rust: `cargo test --lib` | **2/2 pass**: Claude-hook installer (preserves user config & key order, idempotent, one-time backup, removes only ours, no-file case) and the approve/deny HTTP round-trip (holds connection, rejects untokened POST, allow/deny JSON, single answer) | same |
| `tauri.conf.json` vs Tauri's official JSON schema | 0 errors | `node_modules/@tauri-apps/cli/config.schema.json` with a validator |
| Capability file accepted by Tauri build step | yes (`cargo check`) | |
| MSI template (`main.wxs`) rendered with sample data | well-formed XML, every `ComponentRef`/`DirectoryRef` resolves, no duplicate IDs, all components in a feature, `WixUI_Advanced` + scope properties present | `handover/verification/wix-render-check.mjs` (needs `npm i --no-save handlebars fast-xml-parser`) |
| Visual review | Screens captured in **headless WebKitGTK** (not WebView2/Chromium): research (empty, scoping, clarify, plan, live, report, dark), island (strip/peek/chat/approval), Engines first-run, Voice offline, Chat. Desktop layout checked by faking `__TAURI_INTERNALS__`. | `handover/screenshots/*.py` (Linux + Xvfb + `python3-gi gir1.2-webkit2-4.1`) |

## 3. Implemented (code exists; verification level in brackets)

- **Shell (Rust)**: two windows, tray (Open/Show-hide island/Quit), close-to-tray, single instance, global shortcuts, island resize/position, engine supervisor, Claude hook server + settings installer, portable-mode detection. [compiles & unit-tested on Linux; Windows-only code unbuilt]
- **Chat**: real Ollama streaming with Stop, vision attachments, saved sessions, model list from Ollama, tokens/sec from Ollama's final chunk, errors rendered into the reply, optional auto read-aloud, mic dictation through Voicebox `/transcribe`. [mock-tested; UI viewed in WebKit]
- **Images**: ComfyUI txt2img with checkpoint list, aspect presets (SDXL/FLUX vs SD1.5 sizing heuristic), steps, CFG, negative prompt, cancel, elapsed timer, error banners. [mock-tested]
- **Voice**: all five tabs (§ PROJECT_BRIEF). [client mock-tested; tabs type-check/build; Voice offline state viewed; **tabs never rendered against a live Voicebox**]
- **Engines**: live status, start/stop, locate exe, policy "Start with Lotus", Ollama pull with progress, Voicebox model download/load/unload/delete with progress, checkpoint list, Storage tab, setup checklist. [type-check; viewed first-run]
- **Island**: state machine, mascot (original art), chat, file/image drop, dictation, read-aloud, clipboard read-aloud, activity pills, engine-status dots, approval card, live settings sync. [4 states rendered in WebKit; **never run as a transparent always-on-top Tauri window**]
- **Deep Research**: see § ARCHITECTURE 5. [engine + render tested; real LLM quality and real APIs untested]
- **Settings**: Model & Inference, Chat & Formatting, Voice (1 toggle), Island & Agents, Appearance, Licenses. Persisted.
- **Packaging**: custom MSI template, portable zip script, CI workflow, version guard. [see §5]

## 3b. Design pass 1 (applied after session 1) ⚠️ unverified
Tokens/type/radii normalised across `components/` and `App.tsx`; `LeftRail` rewritten (labels, real engine dot, avatar and fake badge removed). **Not run:** `tsc`, `npm run build`, the 63 TS tests and screenshots were all impossible in that session (no dependencies, no network). Run them first, then look at light/dark/desktop screenshots; text moving from 9–11 px to 12 px may overflow in tight spots (badges, session meta, Inspector). Phases 3–5 (Chat layout, Settings page + T6, other workspaces) are not started. Also still present: static footer "Local VRAM inference" in chat messages (should go in Phase 3).

## 3c. In-app updates (session 2) ⚠️ unverified
Code written: `src-tauri/src/updates.rs`, updater plugin registration, `plugins.updater` placeholders in `tauri.conf.json`, release steps in `.github/workflows/build-windows.yml`, `useUpdates` + `UpdatesPanel` (Settings → About & Updates), dot on the rail's Settings icon. Also fixed: the Settings footer showed a hard-coded "v1.0.0"; it now shows the real version. **Not run:** `cargo check` (the crate is not in `Cargo.lock`; the next build must resolve it, then commit the lock), `tsc`, the build, tests. Needs from the user: signing key + 3 Actions secrets, a public repo, and one real tagged release plus one update from an older install to prove the loop. See TASKS T14.

## 4. Known bugs, limitations and unfinished work

IDs are referenced from `TASKS.md`.

| ID | Type | Issue | Evidence |
|---|---|---|---|
| **B1** | ~~Open CI failure~~ **Resolved (session 2, user-reported)**: the later CI run passed `npm ci`, `check:tauri`, the Vite build and the Rust compile on Windows, and failed at WiX instead (§5 failure 4). I have only the user's summary of the log, not the raw log. | Windows build fails on a Tauri version mismatch between Rust crates and npm packages. History in §5. Not reproducible from the shipped zip in the sandbox. | user-reported logs ✅; sandbox guard passes ✅ |
| **B2** | Bug (dead UI) | **13 settings have no behaviour**: `sendOnEnter`, `autoScroll`, `reasoningBlockMode`, `codeCopyLanguage`, `density`, `streamingEnabled`, `lotusFolderPath`, `keepEnginesRunningOnQuit`, `vramCapPercent`, `comfyUiIdleStopMinutes`, `defaultTtsVoice`, `ttsRate`, `whisperLanguage`. The first five still have toggles/buttons in Settings → Chat & Formatting / Appearance that do nothing. | grep of every use ✅ |
| **B3** | Suspected bug | Language filter: UI sends PubMed-style 3-letter codes (`eng`, `ger`…) into OpenAlex's `language:` filter, which expects ISO 639-1 (`en`). Selecting a language probably returns **zero** OpenAlex results. | code read ✅; live API behaviour ⚠️ |
| **B4** | Spec gap | **Personas are not separate agents.** They only appear in the synthesis prompt as a "Critical review" section. The spec wanted STORM-style personas that interrogate the topic during research. | code read ✅ |
| **B5** | Spec gap | No PDF/full-text scraping (abstracts only); no MCP connectors (4 built-in APIs only); "Agent Graph" is a simple SVG; context meters show *largest prompt so far*, not live per-loop usage; supervisor context is estimated as chars/4; ETA is elapsed ÷ progress. | code read ✅ |
| **B6** | Dead hook | `voice:speak-text` has a listener in `VoiceWorkspace` but nothing emits it (no "send to Speak" from the island/chat). | grep ✅ |
| **B7** | Limitation | Research runs and ComfyUI progress are not resumable; a run is lost on app close (partial results kept, can write report). ComfyUI shows elapsed time only (no step progress). Reasoning-model `thinking` tokens are discarded with no UI. | code read ✅ |
| **B8** | Limitation | If the model returns bad JSON twice, plan/questions/personas silently fall back to generic defaults (1 sub-topic) without telling the user. | code + test ✅ |
| **B9** | Limitation | Generated images and chat image attachments are session-only (blob URLs). | code ✅ |
| **B10** | Risk | `localStorage` quota (~5 MB in WebView2, ❓ unmeasured) could be exceeded by many long chats/research projects; errors are swallowed for research, not for chats. | ⚠️ |
| **B11** | Risk | Voicebox server executable name/location on Windows and its start-up args are assumptions; `engine_find` candidate paths are guesses. | ⚠️ |
| **B12** | Risk | Island: primary monitor only; no click-through; hover "peek" relies on pointer events inside a tiny window; transparency/always-on-top under WebView2 untested. | ⚠️ |
| **B13** | Risk | Hook server port 17495 is fixed; if bind fails the only signal is stderr (no UI message). Claude Code hook contract unverified. | ⚠️ |
| **B14** | UX gap | Closing the main window hides to tray with no first-time notice. | code ✅ |
| **B15** | Housekeeping | Licence inconsistency: `Cargo.toml` `license = "MIT"` (I wrote it), `src/App.tsx` header `Apache-2.0` (original template), installer licence page is a placeholder. | ✅ |
| **B16** | Housekeeping | No git repo here, no CHANGELOG; the README "Status" section must be kept in sync with this file. Vite prints a harmless `INEFFECTIVE_DYNAMIC_IMPORT` warning for `lib/bus.ts`. | ✅ |
| **B18** | Risk (found in session 2) | `@tauri-apps/plugin-http 2.7.0` declares `@tauri-apps/api ^2.12.0`, but `package.json` pins api to exactly `2.11.1` (to match the `tauri 2.11.6` crate). npm therefore nests a **second copy, `api 2.12.4`, under plugin-http** (see `package-lock.json`). The CLI's version check only inspects the top-level copy, so it passes, but every `http()` call runs through a different API minor than the Rust core. Probably harmless, ⚠️ unverified at runtime. Options: move crates *and* api to 2.12.x together, or pin an older plugin-http. The guard now prints a `warn` line for this. | `package-lock.json` read ✅; runtime ⚠️ |
| **B17** | Not done | No accessibility audit; no real-WebView2 visual pass; no performance measurement; installer size unmeasured. | ⚠️ |

## 4b. macOS HIG redesign (session 3, ⚠️ unbuilt)
Design layer rewritten; **not compiled, type-checked against React types, or viewed**: the sandbox had no `node_modules` and no network. Only a syntax-only `tsc` pass was run (clean). Run `npm install && npx tsc --noEmit && npm run build && bash handover/verification/run-tests.sh`, then look at the screenshots, before trusting any of it.
- Done: tokens/materials/focus/scrollbars/symbol effects (`index.css`, `theme.ts`); controls (`ui.tsx`, `Toggle`, `Modal`, `PillSlider`); new `Symbol.tsx`, `DataViews.tsx` (Table, OutlineView; **not yet used by any screen**); sidebar + toolbar shell (`LeftRail.tsx`, `App.tsx`); Settings shell + Appearance rewritten; mechanical sweep of radii/colours across all workspaces.
- Removed dead controls (honest UI): Message Layout Density, the fake "Live Component Preview" slider. Bundled Plus Jakarta/Outfit fonts dropped from `fonts.ts` (`package.json` and the lockfile still list them on purpose, so `npm ci` keeps working; remove later with `npm rm` plus a regenerated lock).
- Not done: workspace-by-workspace layout pass (chat composer, Engines, Voice tabs, Research inspector still use old structure with new tokens); Island keeps its own look; Table/OutlineView adoption (e.g. Library, Stories, Engines models); VoiceOver and contrast audit; animated-symbol bundles from the user (none were in the upload).

## 5. CI / build history (important context)

1. **Failure 1:** `tauri.conf.json` → `bundle.windows.wix.license` is not valid in Tauri 2. **Fixed:** moved to top-level `bundle.licenseFile` (config now schema-valid).
2. **Failure 2:** *"Found version mismatched Tauri packages"* (Rust `tauri 2.11.6` etc. vs npm `@tauri-apps/api 2.12.3` etc.). Cause: the shipped `Cargo.lock` had been resolved in the sandbox with Rust 1.85 (older crates via the MSRV-fallback resolver) while npm resolved to newest. **Fixed:** pinned npm packages to exact versions matching the lock (see ARCHITECTURE §8) and added `scripts/check-tauri-versions.mjs` + a CI step.
3. **Failure 3 (current, open, B1):** the user reports CI now fails with the guard's own message ("Tauri crates and npm packages must share the same major.minor…") and points to `Cargo.toml` still saying `tauri = "2"` etc. **We do not have the MISMATCH lines from the log** (❓) and do not know whether the user's repo has a `Cargo.lock` or whether it matches the one in our zip. Because the guard prints that message only after printing at least one `MISMATCH` line, the user's lockfile most likely resolved to newer crates (e.g. someone ran `cargo update`) ⚠️ hypothesis.
   - **Done in the working tree (not yet delivered):** `Cargo.toml` now pins all Tauri crates with `~` requirements to the same minors as npm. Verified here: `cargo check --locked`, `cargo test --lib --locked`, `npm run check:tauri` all pass.
   - **Done in session 2:** `scripts/check-tauri-versions.mjs` now reads `cargo metadata` (direct dependency of `lotus`), falls back to `Cargo.lock` with a printed note, and warns about nested duplicate `@tauri-apps/api` copies (B18). Tested with a **stubbed `cargo`** (match, mismatch, missing lock, failing cargo) and with the real lockfile fallback; **never run against real `cargo metadata`** ⚠️. Also checked by script that every `~` requirement in `Cargo.toml` is satisfied by the shipped `Cargo.lock`.
   - **Not done:** get the actual log lines; confirm the user's lockfile state; decide B18.
   - **The zip currently in `/mnt/user-data/outputs/lotus-studio.zip` from before this handover predates the `Cargo.toml` pins.** The handover bundle supersedes it.
4. **Failure 4 (current, open, session 2):** the user reports the job now fails at `npm run tauri build` during MSI bundling: `failed to bundle project: failed to run ...\WixTools314\light.exe`, exit code 1. This is Tauri's generic wrapper; **the real `LGHT####` / `ICE##` line is ❓ not yet seen.** So the version check, Vite build and Windows Rust compile (incl. the two `#[cfg(windows)]` blocks) got through ✅ (user-reported). Vite also prints an informational `configLoader: 'native'` warning (harmless, future-major notice).
   - **Hypothesis ⚠️ (untested):** ICE38/ICE64. The three shortcut components (Desktop, Start Menu, Uninstall) sit in per-user folders but had `HKMU` key paths. **Changed to `HKCU`** (as in Tauri's stock template) in `src-tauri/wix/main.wxs`; nothing else touched. Not built, since WiX cannot run here.
   - **Session 2, second report:** same failure again (`candle` succeeds, `light` fails; message is only the wrapper). Still no `LGHT/ICE` line ❓, and ❓ unknown whether the run used the zip containing the HKCU change. **Workflow changed** to `tauri build -- --verbose` plus failure-only steps that re-run `light.exe` by hand (prints its full output) and upload the `wix-debug` artifact (rendered `main.wxs`, `.wixobj`, `.wxl`). ⚠️ The diagnostic step's `light.exe` arguments are my reconstruction of what Tauri passes; its output is informative even if they differ slightly.
   - **Third report:** again only a summary (no `LGHT/ICE` text, ❓ unknown whether the run used the diagnostics workflow; repo link was not fetchable, probably private). Workflow extended: the diagnostics step now also writes `light-output.txt` into the `wix-debug` artifact and emits matching lines as `::error` annotations plus the job summary, so the error shows on the run's summary page.
   - **Fourth report (raw build-step log):** shows only Tauri's wrapper (`Running candle` OK, `Running light` then `failed to run light.exe`); no `LGHT/ICE` text and no verbose lines, so that run probably used the older workflow ⚠️. Diagnostics step extended with a second `light.exe -sval` run (skip ICE validation): normal-vs-`-sval` exit codes show whether validation is the failing part, and `unvalidated.msi` lands in the `wix-debug` artifact (**not a release build; unvalidated**).
   - **ROOT CAUSE FOUND (session 2, from the `wix-debug` artifact's `light-output.txt`) ✅:** `main.wxs(128): error LGHT0204: ICE03: Invalid registry path; Table: Registry, Column: Key`. The "Start with Windows" Run key was written `Software\\Microsoft\\Windows\\CurrentVersion\\Run` (doubled backslashes). In this template `\\` is only an escape when it precedes a `{{placeholder}}` (Handlebars); this key has none, so the doubles reached MSI. **Fixed in `src-tauri/wix/main.wxs` to single backslashes; no other key had the problem.** ⚠️ Fix not yet built in CI.
   - Same artifact: a run with `-sval` (validation skipped) produced a 3.7 MB MSI, so the rest of the template links. Remaining light output was **warnings only**: ICE03 string overflow in `DownloadAndInvokeBootstrapper` (stock Tauri), ICE40 REINSTALLMODE, ICE61 upgrade Maximum version, and **ICE57 on `CMP_UninstallShortcut`** (HKCU key path in the install folder; introduced by the HKCU change; harmless warning, could be reverted to HKMU for that one component).
   - The earlier ICE38/ICE64 hypothesis was **not** what failed: the normal run reported no ICE38/ICE64. Whether the HKCU change on the Desktop/Start Menu shortcuts was needed is unknown.
   - If light still fails, the next suspects are other ICE rules from the dual-purpose design (ICE57, ICE91) and `WixUI_Advanced` requirements.
5. Further failures are expected next and **cannot be predicted from here**: the Rust compile on Windows (the two `#[cfg(windows)]` blocks), the WiX compile/link of the custom template, `package-portable.ps1`.

## 6. Environment notes
- The sandbox where this was developed had **no Rust toolchain by default and no Windows**; a Rust 1.85 toolchain was installed from Ubuntu's apt for verification (recipe in `CLAUDE.md`).
- All verification harnesses were originally in `/tmp` and have been copied to `handover/` (import paths rewritten to relative). ✅ `run-tests.sh` was executed from the new location and passes.

- **Session 2 sandbox had no network at all** (`ENOTFOUND registry.npmjs.org`), no `cargo`, and no apt access. `npm ci` could not complete, so **tsc, `npm run build`, the 63 TS tests and the Rust tests were NOT re-run** in session 2. The ✅ results in §2 are from session 1. The docs' claim that the sandbox allow-list includes npm/crates.io/GitHub/apt did not hold this time.

## 7. Missing information ❓
- The real CI log lines for failure 3, and whether `src-tauri/Cargo.lock` is committed in the user's repo.
- Whether the user has a Windows machine for manual testing.
- The user's intended licence, audience, and hardware.
- How Voicebox's Windows installer lays out `voicebox-server.exe`.


## 8. Session 2 addendum: spec coverage pass
Chat, Images, Models (new page) and Voice were rebuilt/extended to the four UI specs. See `SPEC_COVERAGE.md` for what is done, unverified, or deliberately omitted. **None of it has been built, tested or run**: the sandbox had no `node_modules`/network, only a loose type-check with shimmed externals. B2 partly resolved (`sendOnEnter`, `autoScroll`, `reasoningBlockMode` now work); B6 still open; B9 resolved for images (IndexedDB gallery). Existing test harnesses were not updated.
