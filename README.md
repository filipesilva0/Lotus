# Tomo

A light Windows app that puts your local AI in one place: **chat** (Ollama), **images** (ComfyUI),
**voice** (Voicebox), **deep research** (your local model + public academic databases), and an
always-on-top **floating island** for quick chat, dictation and agent notifications.
Everything runs on your PC. The one exception is Deep Research, which sends short search keywords
to the academic databases you switch on (see *Deep Research* below). Nothing else is uploaded.

Built with **Tauri 2** (Rust + the WebView2 that ships with Windows). There is no bundled Chromium,
so the app itself is small; the engines you connect to bring their own weight.

## What's inside

| Area | What you get |
|---|---|
| **Chat** | Streaming Ollama chat, vision (attach an image), Stop, saved conversations, tokens/sec, local dictation |
| **Images** | ComfyUI text-to-image with your installed checkpoints, aspect ratios, seed, cancel |
| **Voice** | Powered by [Voicebox](https://github.com/jamiepine/voicebox) (see below) |
| **Research** | Scoping wizard, editable plan, expert personas, parallel search agents, live steering, cited report |
| **Engines** | Start/stop Ollama, ComfyUI and Voicebox, "Start with Tomo", model downloads (Ollama and Voicebox), storage/portable info |
| **Island** | Floating pill: peek, chat, dictate, read clipboard aloud, file/image drop, activity pills, Claude Code permission prompts |

### Voice (Voicebox)

Tomo is a second front end for the Voicebox server, so your voices and history are shared with
the Voicebox app.

- **Speak**: nine TTS engines, 23 languages, delivery instructions, seed, effects chain with presets, "speak in character"
- **Voices**: clone from a recording or upload (with one-click local transcription of the reference text), built-in voices, or describe a voice in words; edit, import/export
- **Stories**: multi-voice timeline with drag to retime, trim, split, duplicate, volume, mixed playback and WAV export
- **Dictate**: local Whisper transcription with optional clean-up, copy / speak / send to chat
- **Library**: searchable history with favourites, retry, export
- Voice **models** are downloaded from Engines → Models.

Not included (yet): Voicebox's audio-channel routing, its global push-to-talk hotkey, and its MCP
"give agents voices" server. They keep working inside Voicebox itself.

### Deep Research

A three-panel workspace: project vault and mode switch on the left, an adaptive workspace in the
middle, and an inspector on the right whose tabs change with the mode.

- **Scoping (Mode A):** you state a question; your local model asks 3-5 narrowing questions, drafts a
  plan of parallel sub-topics (edit objectives, add/remove sub-questions) and assembles 3-5 expert
  personas (including a sceptical reviewer). Nothing is searched until you press *Approve & start*.
  Inspector: which repositories to use, search depth / sources per agent / year cutoff, and
  required keywords / excluded domains / language.
- **Live (Mode B):** one agent per sub-topic loops *write queries, search, filter, read abstracts*.
  You see active agents, sources read, tokens (real counts from Ollama), a live query terminal with
  HTTP status and domain credibility, and can **pause, inject instructions, or exclude domains**
  mid-run. Inspector: a live source feed where you can untick poor sources, an agent graph, and
  context-window meters.
- **Report:** a Markdown report with clickable `[n]` citations and an automatic reference list.
  Citations that don't match a real fetched source are stripped, so the model can't cite papers it
  never saw. Copy or save as `.md`.

**Privacy:** Deep Research contacts arXiv, PubMed (NCBI), OpenAlex and Crossref directly from your PC.
Only the keyword queries the agents write are sent; each repository can be switched off (Crossref
starts off). Requests are rate-limited per host (arXiv: one per 3 s) and agents share that budget,
so a run takes a few minutes. The desktop app's network permission is limited to those four hosts
plus `127.0.0.1`.

**Limits:** agents read titles and abstracts only (no PDFs or full text), so the report is a map of
the literature, not a replacement for reading the papers. Quality depends on the model; a 7B model or
larger is recommended. Runs don't survive closing Tomo (partial results are kept and a report can be
written from them).

### Island

| Shortcut | Action |
|---|---|
| Ctrl + Alt + Space | Open the island chat |
| Ctrl + Alt + D | Start / stop dictation |
| Ctrl + Alt + T | Show / hide the island |

**Claude Code**: Settings → Island & Agents → *Connect* adds hooks to `~/.claude/settings.json`
(a backup is saved next to it). The island then shows when a session is working and lets you
**Allow / Deny** permission prompts. If nobody answers within 5 minutes, Claude Code falls back to
its normal terminal prompt. Hooks use the `curl.exe` that ships with Windows and talk only to
`127.0.0.1:17495`.

Not included from Coucou: phone companion, Spotify/GitHub/Stripe pills, weekly recap.

## Installing

**MSI installer** (`Tomo_x64_en-US.msi`) asks you:
- **Just for me** (no admin rights) or **All users**
- Install folder
- Optional features: *Desktop shortcut*, *Start with Windows*, *Portable data*
  (keeps chats, voices and settings inside the install folder instead of your user profile)

**Portable zip** (`Tomo-portable-x64.zip`): unzip anywhere (a USB stick works). The `tomo.portable`
file next to `Tomo.exe` makes Tomo keep everything in `data\` beside it.

An MSI cannot be "portable" in the strict sense, which is why portable is a separate zip.

Requires Windows 10 (1803+) or 11 with the WebView2 Runtime (already present on Windows 11 and
current Windows 10; the installer fetches it if missing).

## Connecting the engines

Install the engines you want, then open **Engines**. Tomo finds Ollama automatically; for
Voicebox, point it once at `voicebox-server.exe`; for ComfyUI, point it at the `.bat`/`.exe` you
use to launch it. Addresses default to `127.0.0.1:11434` (Ollama), `:8188` (ComfyUI), `:17493`
(Voicebox) and can be changed per engine.

## Building from source

Prerequisites: Node 22+, Rust (stable, MSVC toolchain), and on Windows the WebView2 runtime.

```powershell
npm install
npm run tauri dev       # run with hot reload
npm run tauri build     # produces the MSI in src-tauri\target\release\bundle\msi
./scripts/package-portable.ps1   # then builds dist-portable\Tomo-portable-x64.zip
```

No Windows machine? The workflow in `.github/workflows/build-windows.yml` builds both artifacts
on a GitHub runner (run it manually or push a `v*` tag).

`npm run dev` serves the UI in a normal browser for design work; engine calls then use the browser's
`fetch`, so ComfyUI may need `--enable-cors-header`, and desktop-only features (island window,
starting engines, Claude Code hooks) are disabled.

## Upgrading Tauri

The Rust crates (pinned by `src-tauri/Cargo.lock`) and the npm packages (pinned exactly in
`package.json`) must be on the same major.minor release, or `tauri build` refuses to run.
`npm run check:tauri` verifies this (it reads the resolved crate versions from `cargo metadata`, and falls
back to `Cargo.lock` when `cargo` is missing) and CI runs it first. To upgrade, bump both sides together
(`cargo update -p tauri` in `src-tauri`, then `npm install --save-exact @tauri-apps/api@<same minor>`
and the plugins/CLI likewise).

## Project layout

```
src/                 React UI (studio window)
  components/voice/  Speak, Voices, Stories, Dictate, Library
  island/            Floating island (second window, island.html)
  services/          Typed clients: Ollama, ComfyUI, Voicebox
src-tauri/           Rust shell: windows, tray, shortcuts, engine launcher, hook server, portable mode
  wix/main.wxs       Customised MSI template (install scope + optional features)
```

## Status

Verified in a Linux sandbox:
- The TypeScript front end type-checks and builds. The Ollama, ComfyUI and Voicebox clients pass tests against mock servers shaped from the real APIs.
- Deep Research: the arXiv / PubMed / OpenAlex parsers, filtering, de-duplication, pause / resume / stop, steering, citation cleaning, junk-JSON fallbacks, the per-host rate limiter and a full multi-agent run pass tests against fake Ollama and fake repositories; all research views render across every lifecycle state.
- `tauri.conf.json` validates against Tauri's official schema, and the capability file is accepted by the Tauri build step.
- The Rust shell passes `cargo check` with no warnings, and two Rust tests pass: the Claude Code hook installer (keeps your existing `settings.json`, idempotent, backs up, removes only Tomo's hooks) and the approve/deny server (holds the request open until you answer, rejects posts without the `X-Tomo-Hook` header, returns the allow/deny JSON).
- The MSI template renders to valid XML with every component and directory reference resolving.

**Not yet verified** (needs a Windows machine or the CI workflow): the two `#[cfg(windows)]` blocks (registry portable flag, hidden engine console), the actual WiX build and its install-scope dialogs, and the real WebView2 window. The screens were reviewed in screenshots from a headless WebKit browser (same HTML/CSS, different engine than WebView2), including the Tauri-sized layout, dark mode and the island's four states. Also unconfirmed against live services: the real arXiv / PubMed / OpenAlex / Crossref responses (parsers are written from their documented formats), Voicebox's start-up arguments and where its Windows installer puts `voicebox-server.exe`, and Claude Code's exact permission-hook response format.

## Licenses

See `THIRD_PARTY_LICENSES.md`. Choose a license for Tomo itself and put it in `LICENSE` and
`src-tauri/wix/license.rtf` (the installer's license page is a placeholder).
