# Lotus

A light Windows app that puts your local AI in one place: **chat** (Ollama), **images** (ComfyUI),
**voice** (Voicebox), **deep research** (your local model + public academic databases), and an
always-on-top **floating island** for quick chat, dictation and agent notifications.
Everything runs on your PC. The exceptions are things you switch on yourself: Deep Research and
source search send short keywords to the academic databases you choose, and **Web search** (the globe
button in chat, or a task/routine set to search the web) sends your question to DuckDuckGo or your
own SearXNG and reads the top result pages. Nothing else is uploaded.

Built with **Tauri 2** (Rust + the WebView2 that ships with Windows). There is no bundled Chromium,
so the app itself is small; the engines you connect to bring their own weight.

## What's inside

| Area | What you get |
|---|---|
| **Chat** | Streaming chat with Ollama **or llama.cpp**, vision, Stop, saved conversations, local dictation, **GitHub Flavored Markdown** in replies and in the message box (with a preview), **Think** (several passes: analyse, draft, check) and **Web** (search the current web and read the top pages) buttons |
| **Memory & skills** | Memory is on for every chat; the **Memory** button next to Incognito pauses it for one chat. Lotus recalls past conversations (SQLite full-text search), remembers what you ask it to, learns lasting facts as you talk, and writes **skills** (reusable procedures) after complex work, improving them when you correct it. Project files such as `SOUL.md`, `memory.md`, `AGENTS.md`, `.cursorrules` are found and applied automatically when you open a folder |
| **Tasks** | A **Kanban board** shared by you and Lotus (assign a task to Lotus and its local agent plans the steps, works through them and puts the result in Review; tasks can block each other), **routines** on a cron schedule, and the **skills** library |
| **Images** | ComfyUI text-to-image with your installed checkpoints, optional **LoRAs** (up to four, each with a strength), aspect ratios, seed, cancel |
| **Voice** | Powered by [Voicebox](https://github.com/jamiepine/voicebox) (see below) |
| **Research** | Scoping wizard, editable plan, expert personas, parallel search agents, live steering, cited report |
| **App Builder** | Describe an app; a local-model agent writes the files and runs the commands while you watch it run in a built-in preview. Websites, web apps, installable phone web apps, Windows/macOS/Linux desktop apps and Android/iPhone apps (see *App Builder*) |
| **Local engine & VRAM** | Lotus measures free video memory every few seconds and sizes the context window, file chunks, model choice and how many background agents may run at once, so nothing runs out of memory (Settings → Local Engine & VRAM, Models → Monitor) |
| **Engines** | Start/stop Ollama, ComfyUI and Voicebox, "Start with Lotus", **Models** (language, image, LoRA and voice models, download by name or link, Arena, hardware monitor), storage/portable info |
| **Island** | Floating pill: peek, chat, dictate, read clipboard aloud, file/image drop, activity pills, Claude Code permission prompts |

### Voice (Voicebox)

Lotus is a second front end for the Voicebox server, so your voices and history are shared with
the Voicebox app.

- **Speak**: nine TTS engines, 23 languages, delivery instructions, seed, effects chain with presets, "speak in character"
- **Voices**: clone from a recording or upload (with one-click local transcription of the reference text), built-in voices, or describe a voice in words; edit, import/export
- **Stories**: multi-voice timeline with drag to retime, trim, split, duplicate, volume, mixed playback and WAV export
- **Dictate**: local Whisper transcription with optional clean-up, copy / speak / send to chat
- **Library**: searchable history with favourites, retry, export
- Voice **models** are downloaded from Engines → Models → Voice models (by list, or by typing a model name).

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

**Privacy:** Update checks (only when you ask, or at launch if you enable it) contact GitHub; see *Updating Lotus*.
Deep Research contacts arXiv, PubMed (NCBI), OpenAlex and Crossref directly from your PC.
Model file downloads (Engines → Models) connect to the https address you paste (usually huggingface.co or civitai.com) only when you press Download.
Only the keyword queries the agents write are sent; each repository can be switched off (Crossref
starts off). Requests are rate-limited per host (arXiv: one per 3 s) and agents share that budget,
so a run takes a few minutes. The desktop app's network permission is limited to those four hosts
plus `127.0.0.1`.

**Limits:** agents read titles and abstracts only (no PDFs or full text), so the report is a map of
the literature, not a replacement for reading the papers. Quality depends on the model; a 7B model or
larger is recommended. Runs don't survive closing Lotus (partial results are kept and a report can be
written from them).

### Models (Engines → Models)

One place for every model Lotus uses, with a **model type** list in its sidebar:

- **Language models** (Ollama): catalogue, quantisation picker with a VRAM estimate, load/unload, delete. **Add model…** takes *any* Ollama name (`qwen2.5-coder:7b`) or a Hugging Face GGUF (`hf.co/user/repo:Q4_K_M`).
- **Image checkpoints** and **LoRAs** (ComfyUI): lists what ComfyUI sees and **downloads new files** from a Hugging Face or Civitai link into ComfyUI's `models/checkpoints` or `models/loras` folder (Lotus finds the folder from the launcher you located, or you choose it once). Gated or login-only files take an access token, used for that download only and never saved. `.safetensors` is recommended; `.ckpt/.pt/.pth/.bin` files can contain code and the dialog says so.
- **Voice models** (Voicebox): download, load, unload, delete, or download a model by name.
- **Arena & Benchmark** and **Hardware & Runtime** (from the earlier Models page) are here too.

In **Images**, the **LoRA** button (and the LoRA section of the inspector) lets you stack up to four LoRAs, each with its own strength. A LoRA has to match the checkpoint family (an SDXL LoRA needs an SDXL checkpoint).

### App Builder

A page for building real apps with your local model, in the spirit of an agent-first IDE:

- **Projects** are folders on your PC (default: `<Lotus data folder>\projects`); start from a template (website, React web app, installable phone web app, Tauri desktop app, Capacitor Android/iPhone app, or empty) or open any folder.
- **Agent** (right): you describe what you want; with *Plan first* it proposes an editable checklist you approve, then it writes files, edits them, runs commands and fixes errors until the app works. You see every action (files changed with +/- lines, command output) and can stop at any time. Commands ask for your approval unless you switch on "Run commands without asking" for that project; commands that look destructive always ask.
- **Editor, files, terminal**: a plain code editor (no syntax colouring yet), a file tree, and a terminal that shows every command, yours or the agent's.
- **Preview**: static sites are served by Lotus itself (no Node needed) and reload when you save; dev servers (Vite etc.) are detected and shown. Switch between full width, **phone** and **tablet** frames. **Android**: a connected phone or emulator is mirrored in the preview (screenshots about once a second; taps and swipes work).
- **Building**: the *Build* tab lists what each project type can run (install, dev server, build) and checks which tools are installed (Node, Rust, Java, Android SDK…). Windows and Android builds run on your PC. **macOS, Linux and iPhone apps cannot be built on Windows**, so those templates include a GitHub Actions workflow (`.github/workflows/build.yml`): push the folder to GitHub and run it there.
- Needs a model that can follow instructions and write code; a code-tuned model of 7B or more works best, with a context of at least 16K (the default for the Builder).

**Privacy:** the Builder itself sends nothing anywhere. Commands you or the agent run (for example `npm install`) use the network the way they normally do.

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

### Memory, skills and tasks (session 5)
- **Memory toggle**: in the chat header, next to Incognito. On by default. Off for a chat means nothing is recalled (no past chats, facts, skills or project memory files) and nothing is learned or indexed until you turn it back on. Incognito always means off.
- **Where it lives**: `lotus.db` (SQLite with FTS5 full-text search) in the Lotus data folder; skills are also written as `skills/<name>/SKILL.md` there so you can read or edit them by hand. Nothing is synced anywhere.
- **Learning**: every few messages a background agent proposes small changes to what Lotus knows about you (it never edits what you saved yourself, and refuses passwords, keys and account numbers). Learned items are marked "learned" in Chat → Context; delete anything wrong.
- **Skills**: written after a long, structured answer, a Thinking-mode reply or a finished board task; used when a later request matches; rewritten when you say it didn't work. Manage them in Tasks → Skills (switch off, edit, delete, see the change history).
- **Background agents** (task steps, routines, learning) never exceed the limit the VRAM auto-scaler allows; learning waits while a chat reply is streaming. For agents to really run side by side, start Ollama with `OLLAMA_NUM_PARALLEL` set to that number (otherwise they queue, which is safe).
- **Routines** run only while Lotus is open (also when hidden in the tray). "Catch up if missed" runs a missed one once at start-up.

## Installing

**MSI installer** (`Lotus_x64_en-US.msi`) asks you:
- **Just for me** (no admin rights) or **All users**
- Install folder
- Optional features: *Desktop shortcut*, *Start with Windows*, *Portable data*
  (keeps chats, voices and settings inside the install folder instead of your user profile)

**Portable zip** (`Lotus-portable-x64.zip`): unzip anywhere (a USB stick works). The `lotus.portable`
file next to `Lotus.exe` makes Lotus keep everything in `data\` beside it.

An MSI cannot be "portable" in the strict sense, which is why portable is a separate zip.

Requires Windows 10 (1803+) or 11 with the WebView2 Runtime (already present on Windows 11 and
current Windows 10; the installer fetches it if missing).

## Updating Lotus

**Settings → About & Updates** has a *Check for updates* button. When a newer version exists it shows
the release notes and a *Download and restart* button; Lotus downloads the installer, verifies its
signature, installs it and reopens. A dot appears on the Settings icon once an update has been found.
Checking contacts GitHub (it sees your IP address and the request, nothing else) and happens only when
you press the button, or at launch if you switch on *Check when Lotus starts* (off by default).
Portable copies can check, but you replace the folder yourself: the installer would add a second copy.

### Publishing an update (maintainer)

One-time setup:
1. `npx tauri signer generate -w lotus-updater.key` and choose a password. Keep the `.key` file private and
   backed up: installed copies only accept updates signed by it, so losing it means a reinstall for everyone.
2. In the GitHub repo: *Settings → Secrets and variables → Actions*, add `TAURI_SIGNING_PRIVATE_KEY` (the
   `.key` file's contents), `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, and `TAURI_UPDATER_PUBKEY` (the `.pub` file's contents).
3. The repository must be **public**: installed copies fetch `latest.json` anonymously.

Each release: `git tag v0.2.0 && git push origin v0.2.0`. The workflow takes the version from the tag,
builds and signs the MSI, and publishes a GitHub Release with the MSI, its signature, the portable zip and
`latest.json`. Without the three secrets, a tag build still works but makes no updater files. The first
version that contains the updater has to be installed by hand once.

## Connecting the engines

Install the engines you want, then open **Engines**. Lotus finds Ollama automatically; for
Voicebox, point it once at `voicebox-server.exe`; for ComfyUI, point it at the `.bat`/`.exe` you
use to launch it. Addresses default to `127.0.0.1:11434` (Ollama), `:8188` (ComfyUI), `:17493`
(Voicebox) and can be changed per engine.

## Building from source

Prerequisites: Node 22+, Rust (stable, MSVC toolchain), and on Windows the WebView2 runtime.

```powershell
npm install
npm run tauri dev       # run with hot reload
npm run tauri build     # produces the MSI in src-tauri\target\release\bundle\msi
./scripts/package-portable.ps1   # then builds dist-portable\Lotus-portable-x64.zip
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

**Session 7 (options cards, usage charts, Library, plugins + plugin creator, background tasks model, in-chat model picker, folder attach, island redesign, frosted glass)** type-checks and builds with the real dependencies; all earlier test suites pass, plus 27 new logic tests and 11 render tests; screens were checked in Chromium (light and dark). It has not run on Windows or against a live Ollama yet. This session also fixed a CSS ordering bug that had removed the blur from every glass surface in the built app. See `CURRENT_STATE.md` §0e.

**Session 5 (memory, skills, tasks, VRAM auto-scaling, Think/Web, GFM) is not built yet.** Checked in a sandbox without package-registry access: every new TypeScript file type-checks against stand-in type definitions and bundles; 56 logic/flow tests (VRAM maths, Markdown parser, cron, Kanban rules, memory and skill learning, Thinking mode and the task agent against a fake Ollama) and 13 render tests pass; the new screens were looked at in Chromium screenshots (light/dark, 980 px). The Rust GPU reader and context-file finder compile and pass their tests against stand-ins for serde/tauri; the SQLite statements were run against real SQLite FTS5. `rusqlite` itself has never been compiled here, and nothing has run against a real GPU, Ollama, llama.cpp, DuckDuckGo or SearXNG. See `CURRENT_STATE.md` §0c.

Verified in a Linux sandbox:
- The TypeScript front end type-checks and builds. The Ollama, ComfyUI and Voicebox clients pass tests against mock servers shaped from the real APIs.
- Deep Research: the arXiv / PubMed / OpenAlex parsers, filtering, de-duplication, pause / resume / stop, steering, citation cleaning, junk-JSON fallbacks, the per-host rate limiter and a full multi-agent run pass tests against fake Ollama and fake repositories; all research views render across every lifecycle state.
- `tauri.conf.json` validates against Tauri's official schema, and the capability file is accepted by the Tauri build step.
- The Rust shell passes `cargo check` with no warnings, and two Rust tests pass: the Claude Code hook installer (keeps your existing `settings.json`, idempotent, backs up, removes only Lotus's hooks) and the approve/deny server (holds the request open until you answer, rejects posts without the `X-Lotus-Hook` header, returns the allow/deny JSON).
- The MSI template renders to valid XML with every component and directory reference resolving.

**Not yet verified** (needs a Windows machine or the CI workflow): the two `#[cfg(windows)]` blocks (registry portable flag, hidden engine console), the actual WiX build and its install-scope dialogs, and the real WebView2 window. The screens were reviewed in screenshots from a headless WebKit browser (same HTML/CSS, different engine than WebView2), including the Tauri-sized layout, dark mode and the island's four states. Also unconfirmed against live services: the real arXiv / PubMed / OpenAlex / Crossref responses (parsers are written from their documented formats), Voicebox's start-up arguments and where its Windows installer puts `voicebox-server.exe`, and Claude Code's exact permission-hook response format.

## Licenses

See `THIRD_PARTY_LICENSES.md`. Choose a license for Lotus itself and put it in `LICENSE` and
`src-tauri/wix/license.rtf` (the installer's license page is a placeholder).
