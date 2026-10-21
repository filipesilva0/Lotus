# Tomo: Decisions

> "Who" = **User** (explicitly requested), **Me** (Claude's design choice, user did not object), **Constraint** (external fact).
> Evidence legend: ✅ confirmed · ⚠️ unverified · 💡 proposed · ❓ unknown.
> Do not reverse a decision here without telling the user and updating this file.

## 1. Product decisions

| ID | Decision | Who | Rationale |
|---|---|---|---|
| P1 | Windows desktop app, **not Electron**; keep it as light as possible. | User | Stated directly. Drives D1. |
| P2 | Use the supplied website export as the **visual base** (bento panel, rail, pastel palettes, Plus Jakarta Sans); keep the brand "Tomo". | User | "use this website as a base". A redesign is not a rebrand. |
| P3 | Integrate **Voicebox** as the voice engine ("complete package") and the **Coucou-style floating island** connected to local AI ("same functionality"). | User | Stated. Scope trimmed explicitly (PROJECT_BRIEF §4). |
| P4 | MSI must **ask about install type** (portable vs local "etc."). Delivered as: scope choice in the MSI + optional features, plus a **separate portable zip**. | User + Me | An MSI cannot be strictly portable; this satisfies the intent. User was told. |
| P5 | Add **Deep Research** per the supplied spec, powered by the local model. | User | `Deep_Research_Page.txt`. Interpreted as a fifth workspace. |
| P6 | **Honest UI:** no simulated data or fake controls. Removed: mock chats, fake hardware scan, fake logs, fake pull timers, first-run wizard, hard-coded "~48.2 tok/s", unused marketing components, stale avatar image. | Me | A control or number that is not real misleads users. (B2 shows the rule is not yet fully applied.) |
| P7 | **Privacy stance:** nothing leaves the PC except Deep Research keyword queries to repositories the user enabled (Crossref off by default); disclosed at the approve button and in the README. | Me | Local-first product. User did not object. |
| P8 | **Plan approval before searching** (Mode A → explicit *Approve & start*). | User (spec) | Human-in-the-loop requirement in the spec. |
| P9 | Closing the main window **hides to tray**; Quit via tray. | Me | Island/hook server must keep running. No user notice yet (B14). |
| P10 | A permission prompt from Claude Code **always becomes visible**, even if the island is switched off (it is shown, then hidden again). | Me | Otherwise Claude Code would hang until the 5-minute timeout. |
| P11 | Installer **licence page is a neutral placeholder**; I must not choose a licence for the user. | Me (corrected mid-project) | I first wrote "MIT" there, then reversed it. **`Cargo.toml` still says MIT, unresolved (B15).** |

## 2. Technical decisions

| ID | Decision | Who | Rationale / consequence |
|---|---|---|---|
| D1 | **Tauri 2 + system WebView2**; release profile tuned for size (`opt-level="s"`, LTO, `codegen-units=1`, `panic="abort"`, `strip`). | Me (from P1) | ~10 MB-class shell vs ~150 MB Electron. ⚠️ final size unmeasured. |
| D2 | **All engine/API HTTP goes through the Rust `plugin-http`** (`lib/http.ts`), with a loopback + 4-host allow-list. | Me | Bypasses CORS (ComfyUI rejects cross-origin). Consequence: custom hosts need a capability edit. |
| D3 | **Voicebox integrated through its REST API**, not re-implemented or bundled. Tomo can start `voicebox-server` (`--port`, `--data-dir`, `--parent-pid`) but does not ship it. | Me | Shares voices/history with the Voicebox app; avoids huge ML dependencies. API shapes were read from its repository source (⚠️ version at clone time unrecorded). |
| D4 | **Single source of truth for models = Engines → Models.** Voice/Chat link to it instead of duplicating download UIs. | Me | Avoids three inconsistent model managers. |
| D5 | **WebAudio/Web APIs for mic and WAV:** record with `MediaRecorder`, **convert to 16-bit PCM WAV in the browser** before upload. | Me | Voicebox's own app does the same; WebM is not reliably decodable server-side. |
| D6 | **Island = separate transparent always-on-top window**; the web layer decides sizes; Rust clamps/centres. Window **grows first, shrinks after** the CSS transition. | Me | Avoids per-frame IPC and cursor polling. Cost: window area outside the pill is only as large as needed, so no click-through is required. ⚠️ untested under WebView2. |
| D7 | **Claude Code bridge:** `curl.exe` hook → loopback HTTP (`:17495`) with `X-Tomo-Hook: 1`; held connection for permission prompts; 5-minute timeout returns `{}`; six events; `settings.json` edited with backup and `preserve_order`. | Me | No custom hook binary; Windows ships `curl.exe`; custom header blocks browser-origin spam. ✅ Rust-tested. ⚠️ Claude Code's contract unverified. |
| D8 | **Persistence in `localStorage`**, no database; images and attachments session-only. | Me | Simple, shared by both windows, relocatable in portable mode. Quota risk B10. |
| D9 | **Fonts bundled** (`@fontsource-variable`); no Google Fonts. | Me | Offline + privacy. |
| D10 | **MSI**: custom WiX template from Tauri's stock one; `WixUI_Advanced`; dual-purpose package (default **per-user**); `HKMU` roots; features Desktop shortcut / Start with Windows / Portable data. Bundle target is **MSI only**. | Me + User (P4) | Per-user default needs no admin. ⚠️ never built. |
| D10c | In `main.wxs`, `\\` is a literal-backslash escape only directly before `{{…}}`; registry keys without a placeholder must use single backslashes. (Run-key bug, found via LGHT0204.) | Me | Lesson from CI failure 4. |
| D10b | **Shortcut components use `HKCU` key paths** (Desktop, Start Menu, Uninstall); install-folder components keep `HKMU`. Added after `light.exe` failed; ⚠️ hypothesis (ICE38/ICE64), unconfirmed. | Me | Per-user folders require an HKCU key path. |
| D11 | **Portable mode** = `tomo.portable` marker beside the exe **or** registry `PortableData=1`; sets `WEBVIEW2_USER_DATA_FOLDER` before windows exist. | Me | Gives both the portable zip and the MSI "Portable data" option the same mechanism. |
| D12 | **WebView2 `downloadBootstrapper`** install mode. | Me | Keeps the MSI small; runtime is already on Windows 11. |
| D13 | Deep Research uses **only the local Ollama model**; free keyless sources (arXiv, PubMed, OpenAlex, Crossref); **abstracts only**. | Me | Local-first; PDFs are heavy/unreliable. Clearly disclosed in the UI. |
| D14 | **Shared per-host rate limiter** (arXiv 3.1 s, NCBI 0.4 s, OpenAlex/Crossref 0.12 s). | Me | arXiv API terms; NCBI limits. ✅ tested. |
| D15 | **Citation safety:** the reference list is generated by code from fetched sources; any `[n]` that does not map to a real source is stripped. Rejected-by-user sources are excluded. | Me | Prevents the model citing papers it never saw. ✅ tested. |
| D16 | **LLM JSON handling:** Ollama `format: json` + tolerant brace-matching parser + one retry + deterministic fallback. | Me | Small local models produce bad JSON. Fallback is silent (B8). |
| D17 | Source **domain/credibility comes from the publisher landing page**, not the `doi.org` link. | Me | Otherwise excluded-domain filters and ratings never see the real publisher. Found by a failing test. |
| D18 | Steering is applied by **reading project state fresh at each step** (limits, injected instructions, rejections), not by restarting agents. | Me | Simple, immediate effect on next round. |
| D19 | **Version alignment:** exact npm pins for Tauri packages, tilde pins for the matching crates, commit `Cargo.lock`, guard script in CI. | Me | Tauri CLI refuses mismatched minors. Third CI failure shows it is not yet closed (B1). |
| D20 | UI conventions: type scale 11/12/14/18 px, two weights (500/600), radii 10/16, accent via CSS variables, shared primitives in `components/common/ui.tsx`, **named Tailwind breakpoints (`xl:`) rather than arbitrary `min-[…]:`** (arbitrary variants were ordered ahead of `lg:` in the generated CSS and lost). | Me | Observed in screenshots. |
| D23 | **Design pass 1 (UI/UX audit):** semantic tokens only (`--color-bg-panel/card/sidebar`, `--color-border-subtle`, `--color-text-main/muted`); type floor 12 px, chat body 14 px; radii 8/12/16; rail has text labels, **no avatar, no badge**, and the Engines icon carries a dot derived from measured engine state (`engineHealth()` in `LeftRail.tsx`: checking / ok / attention / idle; red only when an engine Tomo is meant to run is down). Island window not touched. | Me (user approved the plan) | Fixes contrast (old `#9CA3AF` ≈ 2.5:1), off-scale 9–11 px text, a fake default badge, and engine health being visible only in Chat. ⚠️ unverified: not type-checked, built or viewed (no node_modules/network in that session). |
| D24 | **In-app updates (reverses the original "no auto-update")**: `tauri-plugin-updater` driven by our own commands `update_check` / `update_install` (no npm twin, so no new version pair). Update source = the repo's GitHub Releases `latest.json`; the endpoint and public key are injected by CI at release time (`ci-release.conf.json`), the committed `tauri.conf.json` holds placeholders. A pushed `v*` tag builds, signs (minisign key in Actions secrets), and publishes a draft release, attaches `latest.json`, then un-drafts it. Check is **manual by default**; launch check is an opt-in toggle (`tomo.updates.v1`). Portable copies can check but are told to replace the folder. The repo must be public. | User (asked) + Me (design) | Keeps P7: the request to GitHub happens only on user action or explicit opt-in. ⚠️ Never built or run: Rust API use, `tauri.conf` placeholders at plugin init, signed-artifact build, release script, and the `Cargo.lock` entry for `tauri-plugin-updater` are all unverified. |
| D21 | Layout in the desktop app uses a definite-height container; rail uses `self-stretch` (not `h-full`), so browser preview and Tauri look the same. | Me | Found via screenshots. |
| D22 | Verification strategy without Windows: Linux Rust 1.85 from apt + MSRV-fallback resolver for `cargo check/test`; TS tests via esbuild against mocks; headless WebKitGTK screenshots with an **ephemeral** web context. | Me | Only option available in the dev sandbox. |

## 3. Rejected approaches (do not revive without cause)

| Rejected | Why |
|---|---|
| **Electron** or bundling Chromium | Violates P1 (weight). |
| Re-implementing Voicebox's TTS/STT engines inside Tomo | Enormous; duplicates a maintained project; D3. |
| Shipping Voicebox or Coucou **code, name, Mochi mascot, icons, sounds** | Coucou's `LICENSE-ASSETS.md` forbids redistribution of its name/character/art/sounds; Voicebox is installed separately. Tomo's mascot and island were drawn/written from scratch. |
| A custom hook binary or Windows **named pipe** for Claude hooks (Coucou's approach) | More native code to compile and ship; D7 needs only `curl.exe`. |
| **Per-frame cursor polling** for click-through (Coucou ~16 ms) | Complexity/CPU; D6 sizes the window to the pill instead. |
| `sysinfo`/native hardware monitoring (RAM, CPU, temperature, power) | Heavy dependency/unverifiable code; the mock UI was removed instead (P6). GPU/VRAM is shown only when an engine reports it. |
| Falling back to a **simulated reply** when Ollama is offline | Dishonest; replaced by explicit error + recovery action. |
| Reading **PDFs/full text** in Deep Research v1 | Heavy, unreliable, large context cost; abstracts only. |
| **Cloud LLMs** for research | Contradicts local-first. |
| A "portable MSI" | Not a thing; separate zip instead (P4). |
| Google Fonts CDN | Privacy/offline (D9). |
| Choosing a licence for the user | P11 (not yet fully cleaned up). |
| Keeping dead settings "for later" | Violates P6; planned removal (T6). |
| Persisting generated images as blob URLs | They do not survive restarts. |

## 4. Assumptions that remain unverified ⚠️

| ID | Assumption | Impact if wrong | How to verify |
|---|---|---|---|
| A1 | Target users are technical Windows 10/11 users with local engines (❓ never stated). | Wrong priorities. | Ask the user. |
| A2 | WebView2 honours `transparent` + undecorated + always-on-top for the island, and `set_size/position` from JS-driven sizes behaves smoothly. | Island unusable. | T3. |
| A3 | Claude Code's `PermissionRequest` hook accepts the `hookSpecificOutput.decision.behavior` JSON we return and runs `curl.exe … @-` from its Windows hook shell. | Approvals do nothing. | Run against real Claude Code. |
| A4 | Voicebox's Windows `voicebox-server.exe` exists, accepts `--port/--data-dir/--parent-pid`, and its REST shapes match what we read from its repository (default branch at clone time; version ❓). | Voice tab fails. | T4. |
| A5 | arXiv/PubMed/OpenAlex/Crossref responses match our parsers; OpenAlex `language:` takes 2-letter codes (B3). | Empty/garbled research results. | T5. |
| A6 | Local ~7B models produce plans/queries/reports of acceptable quality with this prompting; `format: json` is respected. | Poor research output. | T5. |
| A7 | Custom `main.wxs` builds with the WiX 3 toolchain bundled by Tauri and the Advanced UI shows the scope page via "Customize". | MSI fails or scope choice hidden. | T2/T3. |
| A8 | `winreg 0.55` registry check and `CREATE_NO_WINDOW` code compile and behave on Windows. | Portable flag/console flashes. | T2/T3. |
| A9 | Voicebox / Ollama / ComfyUI default ports (17493 / 11434 / 8188) are what users have. | Connection errors (mitigated by editable addresses). | T4. |
| A10 | `localStorage` capacity in WebView2 is adequate. | Silent data loss for long chats. | Measure (T11). |
| A11 | Deep Research UI is usable in the real WebView2 window at 980 px wide (inspector auto-hidden < 1240 px). | Cramped layout. | T3 visual pass. |
