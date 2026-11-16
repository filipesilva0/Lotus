# Third-party licenses and attributions

Lotus is a front end for local AI engines and borrows ideas from two open-source projects.
No code, artwork, sounds or trademarks from either project are bundled in Lotus. The one bundled
third-party runtime is Bun, inside lotusd (below).

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

## fflate (bundled inside lotusd, session 17)
- **What:** zip unpacking for the built-in engines' downloads. **Licence:** MIT. https://github.com/101arrowz/fflate

## Lotus's own engines (session 17; downloaded on request, not bundled)
Downloaded from each project's GitHub releases into `Lotus Studio/Engines` when the user installs them (Models page or the first-run guide). Lotus finds the release through `api.github.com` and downloads from `github.com`.
- **llama.cpp** (llama-server, chat): MIT. https://github.com/ggml-org/llama.cpp (NVIDIA builds come with NVIDIA's CUDA runtime libraries, under NVIDIA's own licence terms, as published by the project).
- **stable-diffusion.cpp** (sd-cli, images): MIT. https://github.com/leejet/stable-diffusion.cpp
- **sherpa-onnx** (speech and dictation): Apache-2.0. https://github.com/k2-fsa/sherpa-onnx; its voice and Whisper model archives come from the same project's `tts-models` and `asr-models` releases (Kokoro: Apache-2.0; Piper voices: MIT, each voice with its own dataset licence; Whisper: MIT).
- Chat models in GGUF from Hugging Face (unsloth repositories, each model under its maker's licence, shown on the Models page), image models from huggingface.co (Comfy-Org, stabilityai, stable-diffusion-v1-5, madebyollin).

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

The App Builder's starter projects reference public packages that are installed only when the user runs "Install packages": React, Vite, @vitejs/plugin-react (MIT), Tauri (MIT or Apache-2.0), Capacitor (MIT). The generated GitHub workflows use actions from actions/*, dtolnay/rust-toolchain and tauri-apps (MIT or Apache-2.0).

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
