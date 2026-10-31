# Lotus: Decisions

> "Who" = **User** (explicitly requested), **Me** (Claude's design choice, user did not object), **Constraint** (external fact).
> Evidence legend: ✅ confirmed · ⚠️ unverified · 💡 proposed · ❓ unknown.
> Do not reverse a decision here without telling the user and updating this file.

## 1. Product decisions

| ID | Decision | Who | Rationale |
|---|---|---|---|
| P1 | Windows desktop app, **not Electron**; keep it as light as possible. | User | Stated directly. Drives D1. |
| P2 | Use the supplied website export as the **visual base** (bento panel, rail, pastel palettes, Plus Jakarta Sans); keep the brand "Lotus". | User | "use this website as a base". A redesign is not a rebrand. |
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
| D3 | **Voicebox integrated through its REST API**, not re-implemented or bundled. Lotus can start `voicebox-server` (`--port`, `--data-dir`, `--parent-pid`) but does not ship it. | Me | Shares voices/history with the Voicebox app; avoids huge ML dependencies. API shapes were read from its repository source (⚠️ version at clone time unrecorded). |
| D4 | **Single source of truth for models = Engines → Models.** Voice/Chat link to it instead of duplicating download UIs. | Me | Avoids three inconsistent model managers. |
| D5 | **WebAudio/Web APIs for mic and WAV:** record with `MediaRecorder`, **convert to 16-bit PCM WAV in the browser** before upload. | Me | Voicebox's own app does the same; WebM is not reliably decodable server-side. |
| D6 | **Island = separate transparent always-on-top window**; the web layer decides sizes; Rust clamps/centres. Window **grows first, shrinks after** the CSS transition. | Me | Avoids per-frame IPC and cursor polling. Cost: window area outside the pill is only as large as needed, so no click-through is required. ⚠️ untested under WebView2. |
| D7 | **Claude Code bridge:** `curl.exe` hook → loopback HTTP (`:17495`) with `X-Lotus-Hook: 1`; held connection for permission prompts; 5-minute timeout returns `{}`; six events; `settings.json` edited with backup and `preserve_order`. | Me | No custom hook binary; Windows ships `curl.exe`; custom header blocks browser-origin spam. ✅ Rust-tested. ⚠️ Claude Code's contract unverified. |
| D8 | **Persistence in `localStorage`**, no database; images and attachments session-only. | Me | Simple, shared by both windows, relocatable in portable mode. Quota risk B10. |
| D9 | **Fonts bundled** (`@fontsource-variable`); no Google Fonts. | Me | Offline + privacy. |
| D10 | **MSI**: custom WiX template from Tauri's stock one; `WixUI_Advanced`; dual-purpose package (default **per-user**); `HKMU` roots; features Desktop shortcut / Start with Windows / Portable data. Bundle target is **MSI only**. | Me + User (P4) | Per-user default needs no admin. ⚠️ never built. |
| D10c | In `main.wxs`, `\\` is a literal-backslash escape only directly before `{{…}}`; registry keys without a placeholder must use single backslashes. (Run-key bug, found via LGHT0204.) | Me | Lesson from CI failure 4. |
| D10b | **Shortcut components use `HKCU` key paths** (Desktop, Start Menu, Uninstall); install-folder components keep `HKMU`. Added after `light.exe` failed; ⚠️ hypothesis (ICE38/ICE64), unconfirmed. | Me | Per-user folders require an HKCU key path. |
| D11 | **Portable mode** = `lotus.portable` marker beside the exe **or** registry `PortableData=1`; sets `WEBVIEW2_USER_DATA_FOLDER` before windows exist. | Me | Gives both the portable zip and the MSI "Portable data" option the same mechanism. |
| D12 | **WebView2 `downloadBootstrapper`** install mode. | Me | Keeps the MSI small; runtime is already on Windows 11. |
| D13 | Deep Research uses **only the local Ollama model**; free keyless sources (arXiv, PubMed, OpenAlex, Crossref); **abstracts only**. | Me | Local-first; PDFs are heavy/unreliable. Clearly disclosed in the UI. |
| D14 | **Shared per-host rate limiter** (arXiv 3.1 s, NCBI 0.4 s, OpenAlex/Crossref 0.12 s). | Me | arXiv API terms; NCBI limits. ✅ tested. |
| D15 | **Citation safety:** the reference list is generated by code from fetched sources; any `[n]` that does not map to a real source is stripped. Rejected-by-user sources are excluded. | Me | Prevents the model citing papers it never saw. ✅ tested. |
| D16 | **LLM JSON handling:** Ollama `format: json` + tolerant brace-matching parser + one retry + deterministic fallback. | Me | Small local models produce bad JSON. Fallback is silent (B8). |
| D17 | Source **domain/credibility comes from the publisher landing page**, not the `doi.org` link. | Me | Otherwise excluded-domain filters and ratings never see the real publisher. Found by a failing test. |
| D18 | Steering is applied by **reading project state fresh at each step** (limits, injected instructions, rejections), not by restarting agents. | Me | Simple, immediate effect on next round. |
| D19 | **Version alignment:** exact npm pins for Tauri packages, tilde pins for the matching crates, commit `Cargo.lock`, guard script in CI. | Me | Tauri CLI refuses mismatched minors. Third CI failure shows it is not yet closed (B1). |
| D20 | UI conventions: type scale 11/12/14/18 px, two weights (500/600), radii 10/16, accent via CSS variables, shared primitives in `components/common/ui.tsx`, **named Tailwind breakpoints (`xl:`) rather than arbitrary `min-[…]:`** (arbitrary variants were ordered ahead of `lg:` in the generated CSS and lost). | Me | Observed in screenshots. |
| D23 | **Design pass 1 (UI/UX audit):** semantic tokens only (`--color-bg-panel/card/sidebar`, `--color-border-subtle`, `--color-text-main/muted`); type floor 12 px, chat body 14 px; radii 8/12/16; rail has text labels, **no avatar, no badge**, and the Engines icon carries a dot derived from measured engine state (`engineHealth()` in `LeftRail.tsx`: checking / ok / attention / idle; red only when an engine Lotus is meant to run is down). Island window not touched. | Me (user approved the plan) | Fixes contrast (old `#9CA3AF` ≈ 2.5:1), off-scale 9–11 px text, a fake default badge, and engine health being visible only in Chat. ⚠️ unverified: not type-checked, built or viewed (no node_modules/network in that session). |
| D24 | **In-app updates (reverses the original "no auto-update")**: `tauri-plugin-updater` driven by our own commands `update_check` / `update_install` (no npm twin, so no new version pair). Update source = the repo's GitHub Releases `latest.json`; the endpoint and public key are injected by CI at release time (`ci-release.conf.json`), the committed `tauri.conf.json` holds placeholders. A pushed `v*` tag builds, signs (minisign key in Actions secrets), and publishes a draft release, attaches `latest.json`, then un-drafts it. Check is **manual by default**; launch check is an opt-in toggle (`lotus.updates.v1`). Portable copies can check but are told to replace the folder. The repo must be public. | User (asked) + Me (design) | Keeps P7: the request to GitHub happens only on user action or explicit opt-in. ⚠️ Never built or run: Rust API use, `tauri.conf` placeholders at plugin init, signed-artifact build, release script, and the `Cargo.lock` entry for `tauri-plugin-updater` are all unverified. |
| D21 | Layout in the desktop app uses a definite-height container; rail uses `self-stretch` (not `h-full`), so browser preview and Tauri look the same. | Me | Found via screenshots. |
| D22 | Verification strategy without Windows: Linux Rust 1.85 from apt + MSRV-fallback resolver for `cargo check/test`; TS tests via esbuild against mocks; headless WebKitGTK screenshots with an **ephemeral** web context. | Me | Only option available in the dev sandbox. |

| D23 | **macOS HIG visual language** (user request): translucent source-list sidebar + unified toolbar split view; semantic tokens in `styles/theme.ts` + `index.css`; radius scale 4/6/10/12 only; accent = macOS system colours (same palette keys); system font stack (`-apple-system`, `Segoe UI Variable` fallback); 3 px focus ring; reduced-motion + contrast media queries. Controls live in `components/common/ui.tsx`, `DataViews.tsx`, `Symbol.tsx`. | User + Me | Native-looking on a Windows/Tauri shell with no new dependency. |
| D24 | **Icons go through `Symbol.tsx`** (Lucide, ISC) with SF-Symbols vocabulary (weight, scale, rendering mode, effects). **SF Symbols and SF fonts are NOT bundled**: Apple's licence limits them to Apple-platform apps; Lotus ships on Windows. | Me | Swap only the renderer in `Symbol.tsx` if a macOS build is ever made. |
| D25 | Window translucency is **in-app only** (`backdrop-filter`). Real Mica/Acrylic via Tauri `windowEffects` is 💡 not enabled: needs a transparent main window, untestable here. | Me | See A12. |

## 3. Rejected approaches (do not revive without cause)

| Rejected | Why |
|---|---|
| **Electron** or bundling Chromium | Violates P1 (weight). |
| Re-implementing Voicebox's TTS/STT engines inside Lotus | Enormous; duplicates a maintained project; D3. |
| Shipping Voicebox or Coucou **code, name, Mochi mascot, icons, sounds** | Coucou's `LICENSE-ASSETS.md` forbids redistribution of its name/character/art/sounds; Voicebox is installed separately. Lotus's mascot and island were drawn/written from scratch. |
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
| A12 | `backdrop-filter` blur and `color-mix()` render correctly in the user's WebView2 (Chromium 105+ target; `color-mix` needs 111+). | Flat/untinted surfaces if unsupported (fallbacks exist for blur only). | Run the app on Windows (T3). |

## 5. Shell layout (Oct 2026)
| ID | Decision | Who | Rationale |
|---|---|---|---|
| D23 | Shell follows the user's reference screenshot (frosted sidebar + one floating white content pane), expressed in macOS HIG terms: sidebar sits on the window field (`--color-bg-base`), 36 px rows, selected row is a raised white item, content pane is inset 8 px with 12 px radius, section sub-navigation uses underline `Tabs` (`components/common/ui.tsx`). Only one panel, no nested boxes, no capsules. | User (look) + Me (mapping) | ⚠️ Edited without a build or screenshot (sandbox had no network): run `npx tsc --noEmit` and `npm run build`, then look at it. Real wallpaper translucency needs a transparent window plus Mica/Acrylic (Rust/config change, not done). |
| D24 | Closer match to the reference: ambient wallpaper (`--backdrop`) behind a 10 px rim, one frosted rounded window (`.lotus-window`) with the sidebar as the glass, 44 px sidebar rows, section tabs moved into the single window toolbar via `ToolbarSlot`, Chat's conversation list moved to a right-hand column with a real search field. Falls back to solid colours under `prefers-reduced-transparency`. | User (look) + Me | ⚠️ Still unbuilt/unseen: needs `tsc`, `npm run build` and a visual check on Windows. |
| D25 | **Supersedes the painted wallpaper in D24.** No faked backdrop or frosted wrapper: the main window is `transparent` with Windows acrylic (`windowEffects` in `tauri.conf.json`, tint switched at runtime by `lib/glass.ts` with `setEffects`/`setTheme`; permissions `core:window:allow-set-effects` and `allow-set-theme`). The sidebar has no fill so the user's own wallpaper shows through; the content pane is the only opaque surface. `.no-glass` gives an opaque fallback. Nested boxes removed (logo tile, bordered conversation cards). | User | ⚠️ Windows-only, never built. If acrylic lags when dragging on Windows 10, switch the effect to `mica` (subtler, no blur). |

## 6. Session 4 decisions (App Builder, merged Models, LoRA)

| ID | Decision | Who | Why / consequence |
|---|---|---|---|
| S4-1 | **Models page merged into Engines → Models**; the rail item was removed and replaced by App Builder. | User | "merge … keep it in the old one's place". |
| S4-2 | Add-model dialog covers four kinds. Ollama/Voicebox download by **name**; ComfyUI checkpoints and LoRAs by **https link** (ComfyUI has no registry or download API). | Me | A name cannot identify a file for ComfyUI; HF/Civitai links are normalised. |
| S4-3 | **File downloads run in Rust** (`downloads.rs`), https only, to `<name>.lotus-part` then rename, user-initiated, with cancel and progress events; **any https host** is allowed because the user supplies the link and the host is shown before download. Tokens are per-download and never stored. | Me | Not subject to the web layer's HTTP allow-list (D2) because that list is for automatic traffic; this is explicit user action. Documented in README privacy and THIRD_PARTY_LICENSES. Revisit if a host allow-list is preferred. |
| S4-4 | LoRAs are chained `LoraLoader` nodes (ids 20–23, max 4) between checkpoint and sampler/encoders; no LoRA = unchanged graph. | Me | Tested. |
| S4-5 | **App Builder agent speaks plain tags** (`<write_file>`, `<replace_in_file>`, `<run_command>`…), not Ollama tool-calling or JSON. | Me | Works with any model, no JSON escaping of code, lets us show file writes while streaming. Cost: depends on the model following the format. |
| S4-6 | Agent runs a loop of: stream a turn → parse actions → execute → feed results back (max 14 steps). **Plan first** (default) gates all changes behind an approved, editable checklist. | Me (modelled on Antigravity's plan/execute split) | Human-in-the-loop, like P8. |
| S4-7 | **Commands need approval** unless the project is set to auto-run; destructive-looking commands always ask (a heuristic list, not a sandbox). File actions can only touch the project folder (`safe_join` in Rust). | Me | The honest limit: approved commands run with the user's rights. |
| S4-8 | **No new crates/npm packages.** Project files, processes, preview server, toolchain probe and adb are plain `std` Rust; the editor is a textarea (no Monaco). Base64 is hand-written. | Me | Keeps D1 (light) and avoids lockfile edits that cannot be resolved offline. |
| S4-9 | Preview: Lotus's own static server (127.0.0.1, random port, auto-reload by a tiny injected script) for HTML projects; dev-server URLs are detected from output; iframe sandboxed; CSP `frame-src` limited to loopback. | Me | Zero-install preview for sites/PWAs/Capacitor/Tauri front-ends. |
| S4-10 | **Targets are honest about Windows**: Windows/Android build locally; macOS/Linux/iOS builds are delegated to a generated GitHub Actions workflow; iOS/macOS are previewed as web only. | Me | Apple's toolchain only runs on macOS. |
| S4-11 | Builder state (terminals, dev servers, agent) lives in a component kept mounted after first visit. Quit kills all child processes. | Me | Otherwise leaving the page would orphan servers. |
| S4-12 | Agent file/model access is injected (`AgentIO`) so the loop is testable without a PC. | Me | Enabled the 12 loop tests. |

Rejected this session: Monaco/CodeMirror (weight, workers vs CSP); Ollama native tool-calling as the only protocol; embedding native Windows app windows in the page; screen-sharing/`scrcpy` for Android (extra binary); iOS simulator streaming (macOS only); suggesting specific model download links in the UI (could not be verified offline).

## 7. Session 5 decisions (memory, skills, tasks, VRAM auto-scaling, Think/Web, GFM)
- **SQLite + FTS5 via `rusqlite` (bundled)** for memory, skills and the chat index, because the user asked for FTS5 session search and it needs real full-text ranking. New crate justified under the "no new crates without a reason" rule; it adds a C build and ~1 MB. Falls back to LIKE search if FTS5 is missing. Board/routines stay in localStorage (small, no search needed).
- **Skills are stored twice on purpose**: the DB (search) and `skills/<slug>/SKILL.md` (front matter + Markdown, the common agent-skill format) so the user can read/edit/back them up. The DB is the source of truth.
- **Memory toggle semantics**: per chat, default on; off = no recall (facts, past chats, skills, project memory files) and no writes (index, explicit "remember", learning). Project *soul/rules* files still apply when memory is off because they are configuration of the folder, not memory. Incognito implies off.
- **Learning only edits learned items**; what the user saved is never changed by a model. A deterministic filter rejects secrets/IDs regardless of what the model proposes.
- **One agent pool** for every background model job, limited by the VRAM plan and re-read before each start; housekeeping (learning) yields to an active chat. Background agents use the chat model and the same `num_ctx` when it fits, because changing `num_ctx` or loading a second model is what causes reloads and out-of-memory.
- **VRAM source order** nvidia-smi → amdgpu sysfs → Windows counters → ComfyUI → none (honest "not measured", manual settings). No new crates (no NVML/DXGI bindings).
- **llama.cpp support** is chat/agents only through an OpenAI-compatible client; Images/Voice/Research/App Builder keep their engines. Its context/slots are read, never changed.
- **Own GFM parser** instead of `react-markdown` + `remark-gfm`: no registry access to add them to the lockfile, and the app's light-weight rule; the parser is tested and never emits HTML. Remote images are shown as links (displaying a reply must not contact third parties).
- **Web search providers**: DuckDuckGo HTML (no key) and SearXNG (self-hosted). Only on when the user turns it on. This widens the HTTP capability to any HTTPS host (page reading); documented in README and THIRD_PARTY_LICENSES.
- **Thinking mode = multi-pass deliberation** (analyse, draft, check, final) plus native `think` where Ollama reports the capability, so it works with any model.
- **Routines run in-app** (timer in the main window, which stays alive in the tray), not as OS scheduled tasks: simpler and honest about when they run. "Catch up if missed" is opt-in.
- **Rejected**: storing memory in localStorage (no FTS, size limits); letting the model rewrite user-saved memories; automatic writes into the user's `memory.md` (Lotus never writes to project files).


## Session 6: title bar, accounts, sheets
- **Custom title bar** (`decorations: false`, `components/common/TitleBar.tsx`): back/forward, sidebar toggle, File/Edit/View/Help menus, own window controls. Loses Windows 11 snap-layout flyout on the maximise button. Unverified on WebView2.
- **Accounts use Supabase-compatible APIs** (`services/account.ts`, `services/sync.ts`, `sync-server/schema.sql`): GoTrue for auth, PostgREST for a per-user key/value `user_state` table with row-level security. Chosen because it is free to start, self-hostable, and needs no server code of ours. The user brings the server (sign-in sheet → Sync server) until an official one is set via `VITE_LOTUS_SYNC_URL/KEY`. Assumption: tokens in localStorage are acceptable for now (keyring later).
- **Profile button** under Settings in the sidebar: menu rises upward with Log in / profile, Settings, Models, Log out.
- **Settings and Models open as sheets** sharing the profile sheet's shell (top-aligned, 44 px header, flat sections, no nested cards). Engines → Models page unchanged.
- **App mark** is the coloured lotus petals (`src/assets/lotus-petals.png`, cut from the app icon without its dark square); the old line-art `Logo.tsx` is no longer used.
