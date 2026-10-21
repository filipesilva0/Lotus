# Tomo: Current State

> Snapshot taken at the end of session 1. Evidence legend: ✅ confirmed (command/test output seen) · ⚠️ unverified · 💡 proposed · ❓ unknown.
> **Rule for future sessions:** update this file whenever a claim here changes. Do not mark something ✅ without having run it.

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
- **Engines**: live status, start/stop, locate exe, policy "Start with Tomo", Ollama pull with progress, Voicebox model download/load/unload/delete with progress, checkpoint list, Storage tab, setup checklist. [type-check; viewed first-run]
- **Island**: state machine, mascot (original art), chat, file/image drop, dictation, read-aloud, clipboard read-aloud, activity pills, engine-status dots, approval card, live settings sync. [4 states rendered in WebKit; **never run as a transparent always-on-top Tauri window**]
- **Deep Research**: see § ARCHITECTURE 5. [engine + render tested; real LLM quality and real APIs untested]
- **Settings**: Model & Inference, Chat & Formatting, Voice (1 toggle), Island & Agents, Appearance, Licenses. Persisted.
- **Packaging**: custom MSI template, portable zip script, CI workflow, version guard. [see §5]

## 4. Known bugs, limitations and unfinished work

IDs are referenced from `TASKS.md`.

| ID | Type | Issue | Evidence |
|---|---|---|---|
| **B1** | ~~Open CI failure~~ **Resolved (session 2, user-reported)**: the later CI run passed `npm ci`, `check:tauri`, the Vite build and the Rust compile on Windows, and failed at WiX instead (§5 failure 4). I have only the user's summary of the log, not the raw log. | Windows build fails on a Tauri version mismatch between Rust crates and npm packages. History in §5. Not reproducible from the shipped zip in the sandbox. | user-reported logs ✅; sandbox guard passes ✅ |
| **B2** | Bug (dead UI) | **13 settings have no behaviour**: `sendOnEnter`, `autoScroll`, `reasoningBlockMode`, `codeCopyLanguage`, `density`, `streamingEnabled`, `tomoFolderPath`, `keepEnginesRunningOnQuit`, `vramCapPercent`, `comfyUiIdleStopMinutes`, `defaultTtsVoice`, `ttsRate`, `whisperLanguage`. The first five still have toggles/buttons in Settings → Chat & Formatting / Appearance that do nothing. | grep of every use ✅ |
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

## 5. CI / build history (important context)

1. **Failure 1:** `tauri.conf.json` → `bundle.windows.wix.license` is not valid in Tauri 2. **Fixed:** moved to top-level `bundle.licenseFile` (config now schema-valid).
2. **Failure 2:** *"Found version mismatched Tauri packages"* (Rust `tauri 2.11.6` etc. vs npm `@tauri-apps/api 2.12.3` etc.). Cause: the shipped `Cargo.lock` had been resolved in the sandbox with Rust 1.85 (older crates via the MSRV-fallback resolver) while npm resolved to newest. **Fixed:** pinned npm packages to exact versions matching the lock (see ARCHITECTURE §8) and added `scripts/check-tauri-versions.mjs` + a CI step.
3. **Failure 3 (current, open, B1):** the user reports CI now fails with the guard's own message ("Tauri crates and npm packages must share the same major.minor…") and points to `Cargo.toml` still saying `tauri = "2"` etc. **We do not have the MISMATCH lines from the log** (❓) and do not know whether the user's repo has a `Cargo.lock` or whether it matches the one in our zip. Because the guard prints that message only after printing at least one `MISMATCH` line, the user's lockfile most likely resolved to newer crates (e.g. someone ran `cargo update`) ⚠️ hypothesis.
   - **Done in the working tree (not yet delivered):** `Cargo.toml` now pins all Tauri crates with `~` requirements to the same minors as npm. Verified here: `cargo check --locked`, `cargo test --lib --locked`, `npm run check:tauri` all pass.
   - **Done in session 2:** `scripts/check-tauri-versions.mjs` now reads `cargo metadata` (direct dependency of `tomo`), falls back to `Cargo.lock` with a printed note, and warns about nested duplicate `@tauri-apps/api` copies (B18). Tested with a **stubbed `cargo`** (match, mismatch, missing lock, failing cargo) and with the real lockfile fallback; **never run against real `cargo metadata`** ⚠️. Also checked by script that every `~` requirement in `Cargo.toml` is satisfied by the shipped `Cargo.lock`.
   - **Not done:** get the actual log lines; confirm the user's lockfile state; decide B18.
   - **The zip currently in `/mnt/user-data/outputs/tomo-studio.zip` from before this handover predates the `Cargo.toml` pins.** The handover bundle supersedes it.
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
