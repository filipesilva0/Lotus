# Third-party licenses and attributions

Lotus is a front end for local AI engines and borrows ideas from two open-source projects.
No code, artwork, sounds or trademarks from either project are bundled in Lotus.

## Voicebox (integration)

Lotus's Voice workspace talks to the Voicebox server over its local REST API
(`http://127.0.0.1:17493`). Voicebox is not bundled with Lotus and is installed separately.

- Project: https://github.com/jamiepine/voicebox
- License: MIT, Copyright (c) 2026 Voicebox Contributors

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

## Engines Lotus connects to (not bundled)

- Ollama: MIT
- ComfyUI: GPL-3.0 (Lotus only calls its HTTP API)

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
