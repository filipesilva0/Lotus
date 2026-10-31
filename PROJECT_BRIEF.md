# Lotus: Project Brief

> Handover document. Read `CLAUDE.md` first, then this file, then `CURRENT_STATE.md`.
> **Evidence legend** used across all handover docs:
> ✅ **Confirmed** (seen in source or in a test/command run) · ⚠️ **Unverified** (written but never run, or inferred) · 💡 **Proposed** (idea, not built) · ❓ **Unknown** (information missing)

## 1. What Lotus is

Lotus is a **lightweight Windows desktop app that puts a person's local AI in one place**: chat (Ollama), image generation (ComfyUI), voice (Voicebox), a Deep Research workspace (local LLM + public academic databases), and an always-on-top **floating island** for quick chat, dictation and notifications. Everything runs on the user's PC; the only outbound traffic is Deep Research's keyword queries to four academic APIs (user-controlled).

It is **not** a model runner itself. It is a front end and supervisor for three separately installed engines.

### Origin and intent ✅ (from the conversation)
- The user supplied a Vite/React "website" export (`tomo-local-ai-studio.zip`, an AI Studio export) as the **design base**: white rounded bento panel, slim left rail, pastel accent palettes, Plus Jakarta Sans. It already had Chat/Images/Voice/Engines screens, but **all backend behavior was simulated**.
- The user asked for a Windows app that connects to Ollama, image-gen AI and TTS; integrates the functionality of **Voicebox** (`github.com/jamiepine/voicebox`, MIT, a local voice studio) ("I want the complete package"); and the **floating island** from **Coucou** (`github.com/Louis-CFM/coucou`, MIT code) connected to the local AI "with the same functionality".
- Later the user supplied `Deep_Research_Page.txt`, a UI/UX spec for a three-panel Deep Research view.
- User-stated constraints: **avoid Electron, keep the app as light as possible** ("if you can avoid electron, it would be perfect"); the **.msi installer should ask** about portable vs local install "etc."

### Target users ❓
Never stated by the user. **Working assumption ⚠️:** a technically comfortable Windows 10/11 user (likely with a discrete GPU) who already runs, or is willing to install, Ollama / ComfyUI / Voicebox and wants one privacy-respecting UI. The user is evidently also a developer (uses GitHub Actions, reads CI logs). Confirm with the user before making product-level assumptions.

## 2. Main features and workflows

Status here is a pointer only; see `CURRENT_STATE.md` for evidence.

| Area | Workflow |
|---|---|
| **First run** | App opens on Engines (if no saved sessions and setup not dismissed) → "Get set up" checklist → install/locate/start engines → download a model. |
| **Chat** | Pick an Ollama model → stream a reply (Stop supported) → optional image attachment (vision) → conversations saved locally → local dictation → optional read-aloud via Voicebox. |
| **Images** | Pick a ComfyUI checkpoint → prompt/negative/steps/CFG/aspect → generate (cancel supported) → gallery for the session. |
| **Voice (Voicebox front end)** | **Speak** (text→speech, engine/language/delivery/seed/effects), **Voices** (clone from record/upload with auto-transcribed reference text, built-in voices, or "described" voices; import/export), **Stories** (multi-voice timeline: retime/trim/split/volume/mix/export WAV), **Dictate** (local Whisper via Voicebox, optional clean-up), **Library** (history search/favourite/retry/export). |
| **Deep Research** | State a question → local model asks 3-5 scoping questions → drafts an **editable plan** of sub-topics + expert personas → **user approves** → parallel agents search arXiv/PubMed/OpenAlex/(Crossref), filter, read abstracts → live steering (pause, inject instruction, exclude domain, untick sources) → cited Markdown report (copy / save `.md`). |
| **App Builder** (session 4) | Project folder → agent (Plan first or direct) writes files and runs approved commands → built-in preview (static server, dev servers, phone/tablet frames, Android mirror) → build per target; macOS/Linux/iOS via a generated GitHub workflow. |
| **Models** (Engines → Models) | Language / image / LoRA / voice models; download any Ollama name, Hugging Face GGUF, or checkpoint/LoRA link; Arena; Monitor. |
| **Island** | Idle pill with engine-status dots + activity pills → hover "peek" (Chat, Dictate, Read aloud clipboard, Open Lotus) → chat (Ollama stream, file/image drop, dictation, read-aloud) → **Claude Code permission prompts** (Allow/Deny) and session activity. Shortcuts: Ctrl+Alt+Space / D / T. |
| **Engines** | Per-engine Start/Stop (only for processes Lotus started), "Start with Lotus", editable address, locate executable; Models tab (Ollama pull/delete with progress, Voicebox model download/load/unload/delete, ComfyUI checkpoint list); Storage tab (data folder, portable vs installed). |
| **Memory & skills (session 5)** | Memory on by default (header toggle per chat) → recall of facts, past chats (FTS5) and skills in each reply → background learning of facts and skills → manage in Chat → Context and Tasks → Skills. |
| **Tasks (session 5)** | Board: create → assign to me or Lotus → link (blocks/relates) → Lotus plans steps, works through them (VRAM-limited agents) → Review → Done. Routines: cron schedule → result kept, posted as a card, or turned into a Lotus task. |
| **Install / distribution** | **MSI** asks: Just-for-me (default, no admin) vs All users; install folder; optional features (Desktop shortcut, Start with Windows, "Portable data"). Separate **portable zip** (marker file `lotus.portable`). Built by GitHub Actions on `windows-latest`. |

## 3. Requirements

### Functional ✅ (derived from user requests and spec)
- FR1. Connect to Ollama, ComfyUI and Voicebox over local HTTP; show live status; start/stop engines Lotus launched.
- FR2. Real streaming chat (not simulated), vision attachments, persisted conversations.
- FR3. Real text-to-image through ComfyUI with checkpoint selection and cancel.
- FR4. Voicebox feature coverage: generate, clone, preset/designed voices, effects, stories, dictation, history, model management.
- FR5. Floating island with chat, dictation, file drop, activity pills, and Claude Code approval prompts.
- FR6. Deep Research per `Deep_Research_Page.txt`: scoping wizard + plan approval + personas (Mode A); live agents, query terminal, steering (Mode B); adaptive right inspector.
- FR7. Windows MSI with install-scope choice and optional features; separate portable build; portable data mode.
- FR8. Settings persist across launches.

### Non-functional
- NFR1 **Lightweight** ✅ *(user-stated)*: no Electron/bundled Chromium; Tauri + system WebView2; size-tuned Rust release profile (`opt-level="s"`, LTO, strip, `panic="abort"`). Web layer measured at the end of session 1: JS+CSS+HTML **575 KB raw / 163 KB gzipped**, plus **~398 KB of bundled fonts**, **~973 KB total** `dist/` (✅ measured with Deep Research included). Final installer size ⚠️ unmeasured.
- NFR2 **Local-first / private** ✅ *(inferred from product intent, stated in README)*: no telemetry, no CDN fonts, loopback-only engine traffic. Sole exception: Deep Research keyword queries to arXiv, PubMed, OpenAlex, Crossref (opt-in per repo; Tauri HTTP permission limited to those hosts + loopback).
- NFR3 **Platform**: Windows 10 (1803+) / 11 with WebView2. ❓ Other OSes not targeted (Rust code has non-Windows fallbacks only so it compiles on Linux for testing).
- NFR4 **Honest UI** ✅ *(my own working rule, adopted during the project)*: no simulated data presented as real; errors say what happened and how to recover.
- NFR5 **Responsible API use**: arXiv ≤ 1 request / 3 s, NCBI ≤ ~3/s; shared per-host rate limiter. ✅ implemented and tested.
- NFR6 **Accessibility**: labelled controls, `role` attributes, focus rings, reduced-motion handling for the mascot. ⚠️ No audit performed.
- NFR7 **Reproducible builds**: Tauri crates and npm packages must stay on the same minor (enforced by `npm run check:tauri`; see `CURRENT_STATE.md` for the open CI problem).

## 4. Explicitly out of scope / not included ✅
- Voicebox: audio-channel routing, its global push-to-talk hotkey, its MCP "voices for agents" server.
- Coucou: phone companion, Spotify/GitHub/Stripe pills, weekly recap, its mascot/art/sounds (not licensed for reuse).
- Deep Research: PDF / full-text reading (abstracts only), cloud LLMs, evidence-matrix files.
- Hardware monitoring (RAM/CPU/temperature/power): removed because it cannot be measured without extra native code.
- Code signing (Authenticode) and telemetry. *(Auto-update was originally out of scope; the user asked for it in session 2, see DECISIONS D24.)*

## 5. Missing information ❓
- Target audience and distribution plan (private use vs public release).
- **Licence for Lotus itself** (installer licence page is a neutral placeholder; `Cargo.toml` says `MIT`, which I wrote without the user choosing; `src/App.tsx` header says Apache-2.0 from the original template). Needs a user decision.
- Whether the user wants a different product name/branding ("Lotus" came from the supplied template's logo).
- Minimum hardware/GPU assumptions; expected model sizes.
- Whether the user has a Windows machine to test on, or relies solely on GitHub Actions.
