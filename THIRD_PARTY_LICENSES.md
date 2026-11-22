# Third-party licenses and attributions

Lotus itself is source-available under the Functional Source License 1.1, Apache 2.0 future licence
(FSL-1.1-ALv2); see LICENSE. The projects below keep their own licences, and their notices are kept
here as those licences require. The engine licence check is in docs/legal/engine-licences.md.

Lotus is a front end for local AI engines and borrows ideas from two open-source projects,
Voicebox and Coucou (both MIT; notices below). No artwork, sounds or trademarks from either project
are bundled in Lotus. Third-party code that ships inside Lotus (Bun, blobatar, fflate, pdf.js,
SQLite, fonts) is listed below; engines and models are downloaded only when you ask.

## Bun (bundled inside lotusd)

lotusd, Lotus's background core, is compiled with `bun build --compile`, which puts the Bun runtime
inside the `lotusd` executable. Lotus ships that executable next to the app. lotusd itself uses only
Bun's built-in modules (no third-party npm packages at run time).

- Project: https://github.com/oven-sh/bun
- License: MIT, Copyright (c) Oven and Bun contributors. Bun statically links other open-source
  components, listed at https://bun.sh/docs/project/licensing, including JavaScriptCore/WebKit
  (LGPL-2; Bun publishes the WebKit source it builds from at https://github.com/oven-sh/WebKit)
  and SQLite (public domain). ⚠️ Not reviewed by a lawyer; check before selling Lotus.

## blobatar (bundled source, session 16)

Petal (Lotus's mascot) and every agent's face are drawn by blobatar 2.7.0, whose source is copied
into `src/vendor/blobatar` (with its LICENSE) so the Lotus core can design new faces.

- Project: https://github.com/Alain00/blobatar
- License: MIT, Copyright (c) 2026 Alain

## Voicebox (integration)

Lotus's Voice workspace talks to the Voicebox server over its local REST API
(`http://127.0.0.1:17493`). Voicebox is not bundled with Lotus and is installed separately.

- Project: https://github.com/jamiepine/voicebox
- License: MIT, Copyright (c) 2026 Voicebox Contributors

## Built-in plugins brought over from Claude's skills (0.21)

Lotus ships built-in plugins (Tasks → Plugins → Built into Lotus) with skills adapted from the skills
and plugins Claude uses. Three come from MIT projects and are adapted (shortened and reworded for
small local models and Lotus's tools); their notices are kept here as the MIT licence requires. The
full MIT licence text is under "MIT License text" below.

- **Superpowers** (`src/plugins/builtin/superpowers.ts`), adapted from superpowers 7.0.2.
  https://github.com/obra/superpowers · License: MIT, Copyright (c) 2025 Jesse Vincent
- **Caveman** (`src/plugins/builtin/community.ts`), adapted from caveman 1.1.2.
  https://github.com/akramsystems/caveman · License: MIT, Copyright (c) 2026 Ali Akram
- **Site Audit** (`src/plugins/builtin/community.ts`), adapted from claude-site-audit 1.0.0.
  https://github.com/rjspence3/claude-site-audit · License: MIT (as declared in its plugin
  manifest), Copyright (c) Rob Spence. Its PDF script and reference files are not included.

The other built-in plugins (Design, Documents, Writing, Code Quality, Toolkit) are written from
scratch for Lotus. They do the same jobs as Anthropic's design, document, humanizer, research and
code-review skills, but no text from those (proprietary or unclearly licensed) sources is copied.
The **Video** plugin (0.21) is also written from scratch. The user pointed at onetake
(https://github.com/feitangyuan/onetake, Copyright (c) 2026 Patrick) as an example; onetake is under
the PolyForm Noncommercial License 1.0.0, which does not allow commercial use, so none of its text,
scripts, templates or move library are in Lotus.
⚠️ Not reviewed by a lawyer; check before selling Lotus.

## fflate (bundled inside lotusd, session 17; in the app since 0.11.0)
- **What:** zip unpacking for the built-in engines' downloads, and (0.11.0) reading Word, Excel, PowerPoint, OpenDocument and EPUB attachments. **Licence:** MIT. https://github.com/101arrowz/fflate

## Word and PowerPoint writers (bundled inside lotusd, 0.21)
Work mode saves real .docx and .pptx files with these libraries. All are permissive licences that allow
selling Lotus under the FSL; each needs only its copyright notice kept (the MIT text is below).
- **docx** 9.16.0, Copyright Dolan Miu. **Licence:** MIT. https://github.com/dolanmiu/docx. Uses **nanoid** (MIT, Andrey Sitnik).
- **PptxGenJS** 4.0.1, Copyright Brent Ely. **Licence:** MIT. https://github.com/gitbrent/PptxGenJS. Uses:
  - **JSZip** 3.10.2, dual-licensed MIT or GPL-3.0; Lotus uses it under **MIT** (Stuart Knightley and contributors).
  - **pako** 1.0.11, MIT and Zlib (Andrei Tuputcyn, Vitaly Puzrin; zlib by Jean-loup Gailly and Mark Adler).
  - **image-size** (MIT), **https** (ISC), **lie**, **immediate**, **setimmediate**, **queue**, **readable-stream**, **string_decoder**, **safe-buffer**, **core-util-is**, **isarray**, **process-nextick-args**, **util-deprecate** (all MIT) and **inherits** (ISC).
- Excel (.xlsx) files are written by Lotus's own code (core/src/tools/office.ts) on fflate, with no other library.
⚠️ Not reviewed by a lawyer; check before selling Lotus.

## pdf.js (pdfjs-dist, bundled in the app since 0.11.0)
- **What:** reads the text of attached PDFs on this computer; loaded only when a PDF is attached. **Licence:** Apache-2.0, Copyright Mozilla Foundation. https://github.com/mozilla/pdf.js

## Lotus's own engines (session 17; downloaded on request, not bundled)
Downloaded from each project's GitHub releases into `Lotus Studio/Engines` when the user installs them (Models page or the first-run guide). Lotus finds the release through `api.github.com` and downloads from `github.com`.
- **llama.cpp** (llama-server, chat): MIT. https://github.com/ggml-org/llama.cpp (NVIDIA builds come with NVIDIA's CUDA runtime libraries, under NVIDIA's own licence terms, as published by the project).
- **stable-diffusion.cpp** (sd-cli, images and AI video): MIT. https://github.com/leejet/stable-diffusion.cpp
- **sherpa-onnx** (speech and dictation): Apache-2.0. https://github.com/k2-fsa/sherpa-onnx. Its 1.x speech programs, which Lotus uses, include espeak-ng (GPL-3.0, https://github.com/espeak-ng/espeak-ng) to pronounce Kokoro and Piper voices; Lotus runs them as separate programs and doesn't ship them. Lotus plays Piper *voice files* with sherpa-onnx and doesn't use the Piper program (whose newer releases are GPL-3.0). GPT-SoVITS (MIT, https://github.com/RVC-Boss/GPT-SoVITS) is installed by the user, not by Lotus; its voice and Whisper model archives come from the same project's `tts-models` and `asr-models` releases (Kokoro: Apache-2.0; Piper voices: MIT, each voice with its own dataset licence; Whisper: MIT). Voice cloning (0.8.2): PocketTTS by Kyutai (code MIT, weights CC-BY-4.0, `tts-models`), ZipVoice by k2-fsa (Apache-2.0, `tts-models`) with the Vocos 24 kHz vocoder (MIT, `vocoder-models`).
- **FFmpeg** (0.21, videos): LGPL-2.1-or-later. https://ffmpeg.org · builds from https://github.com/BtbN/FFmpeg-Builds (the `lgpl` builds, without GPL-only libraries such as x264 and x265). Lotus runs it as a separate program. A Mac, or a computer that already has FFmpeg, uses its own FFmpeg (which may be a GPL build; that is the user's own copy, not shipped by Lotus).
- Chat models in GGUF from Hugging Face (unsloth repositories, each model under its maker's licence, shown on the Models page), image models from huggingface.co (Comfy-Org, stabilityai, stable-diffusion-v1-5, madebyollin), and the Wan video models (Apache-2.0: Comfy-Org repackages, city96 umt5 GGUF, QuantStack GGUF conversions of Wan-AI's releases).

## Coucou (inspiration for the floating island)

The island's behaviour (a collapsible pill with peek, chat and approval states, agent
permission prompts, dictation, file drop) was inspired by Coucou for macOS and Windows.
Lotus's island is an independent implementation with its own mascot and visuals.

- Project: https://github.com/Louis-CFM/coucou
- Code license: MIT, Copyright (c) 2026 Louis Raillé
- Coucou's name, "Mochi" character, icons and sounds are NOT licensed for redistribution
  (see its LICENSE-ASSETS.md) and are not used here.

## Public data sources used by Deep Research (not bundled)

Update checks and downloads use the project's own GitHub Releases (github.com and its release-asset host), only when the user asks.

arXiv API, NCBI PubMed E-utilities, OpenAlex and Crossref are queried over HTTPS with short keyword
queries. Please follow each service's terms of use; Lotus rate-limits its requests accordingly.

## Model downloads (not bundled)

Engines → Models downloads the model file at the https link the user pastes (Hugging Face and Civitai links are recognised). Each model has its own licence; check it before use.

## Engines Lotus connects to (not bundled)

- Ollama: MIT
- ComfyUI: GPL-3.0 (Lotus only calls its HTTP API)

## Bundled libraries added in session 5
- **rusqlite** (MIT) with **SQLite** (public domain; compiled in through rusqlite's `bundled` feature, FTS5 enabled). Used for the local memory database `lotus.db`.

## Web search (session 5, only when the user turns it on; not bundled)
- **DuckDuckGo** HTML results page (`https://html.duckduckgo.com/html/`), queried with the user's question.
- **SearXNG** (AGPL-3.0, not bundled): any instance the user configures, via its JSON API.
- The top result pages are fetched from their own websites to read their text. The desktop app's HTTP permission therefore allows any `https://` host; requests are only made by Web search, a task or a routine with "Search the web first" ticked.

## Bundled fonts (via Fontsource)

Plus Jakarta Sans, Inter, Outfit, JetBrains Mono: SIL Open Font License 1.1.

## MIT License text

Permission is hereby granted, free of charge, to any person obtaining a copy of this software
and associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions: The above copyright notice and this
permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.

## Engines and models offered by the setup guide (not bundled)

Lotus never ships an engine or a model. When the user opts in, it downloads the official installer
from the project's own release host and opens it, so the user accepts that project's terms there.

- Ollama: MIT, https://github.com/ollama/ollama (installers from its GitHub Releases)
- ComfyUI: GPL-3.0, https://github.com/comfyanonymous/ComfyUI; Comfy Desktop from https://www.comfy.org/download (Comfy's terms: https://www.comfy.org/terms-of-service)
- Voicebox: MIT, https://github.com/jamiepine/voicebox (installers from its GitHub Releases)

Recommended models, each under its own licence: Qwen 3.5 (Apache-2.0), Gemma 4 (Gemma Terms of Use),
FLUX.2 Klein 4B (Apache-2.0), Z-Image Turbo (Apache-2.0), Qwen-Image (Apache-2.0), Kokoro (Apache-2.0),
Chatterbox Turbo (MIT), Qwen3-TTS (Apache-2.0), Whisper (MIT). Image model files come from the
Comfy-Org repositories on Hugging Face.
