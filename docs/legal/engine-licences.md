# Engine licence check (Lotus 0.17.0)

Checked 21 November 2026 against Lotus's own licence, FSL-1.1-ALv2. Not legal advice and not reviewed by a lawyer.

## The key fact

Lotus does **not** ship any AI engine inside its installer. When you ask, it downloads each engine from that project's own GitHub release page into `Lotus Studio/Engines`, and runs it as a separate program that Lotus talks to over the command line or a local web address. Lotus's code is never linked into an engine, and an engine's code is never linked into Lotus. That keeps each engine's licence separate from Lotus's licence, including for engines under the GPL.

The only third-party program Lotus does ship is the Bun runtime inside `lotusd` (see the end of this page).

## Engines

| Engine | Used for | How Lotus gets it | Licence | Fits FSL? |
| --- | --- | --- | --- | --- |
| llama.cpp (`llama-server`) | Chat | Downloaded on request from ggml-org/llama.cpp releases | MIT. NVIDIA builds include NVIDIA's CUDA runtime files under NVIDIA's own redistribution terms, added by the llama.cpp project | Yes |
| stable-diffusion.cpp (`sd-cli`) | Images | Downloaded on request from leejet/stable-diffusion.cpp releases | MIT (CUDA builds as above) | Yes |
| sherpa-onnx 1.x | Read-aloud voices, dictation, voice cloning | Downloaded on request from k2-fsa/sherpa-onnx releases. Lotus keeps to 1.x | Apache-2.0, with ONNX Runtime (MIT). **The 1.x speech programs also contain espeak-ng, which is GPL-3.0**, used to turn text into sounds for Kokoro and Piper voices | Yes, because Lotus doesn't ship it and runs it as a separate program. See "Watch out" below |
| Piper | Read-aloud voices | **Lotus does not use the Piper program.** It downloads Piper *voice files* (from sherpa-onnx's model page) and plays them with sherpa-onnx | The old Piper program was MIT; the project's newer releases (piper1-gpl) are GPL-3.0. That doesn't apply here. The voice files are MIT, but **each voice is also bound by the licence of the recordings it was trained on**, which differs per voice | Yes for the engine. Voice-by-voice licences still to verify (below) |
| GPT-SoVITS | Optional, very natural cloned voices | **Not downloaded by Lotus.** The user installs it and picks its folder; Lotus starts its local server | MIT. Its Windows package includes its own Python and other tools under their own licences | Yes |
| Ollama, ComfyUI, Voicebox | Optional outside engines | Installed by the user from their own sites; Lotus only talks to their local web address | MIT, GPL-3.0, MIT | Yes |

## Models

Lotus never redistributes model weights. Each model is downloaded from its maker's page, and the Models page shows its licence. Models that forbid commercial use show a **Non-commercial** badge (in 0.17.0: FLUX.2 Klein 9B). Stable Diffusion 1.5 and XL use the CreativeML OpenRAIL licences, which allow commercial use but forbid some uses; their cards say "Use limits".

## Watch out

1. **If Lotus ever puts sherpa-onnx 1.x inside its own installer** (for example the Microsoft Store package in 0.19), Lotus would then be *distributing* GPL-3.0 code (espeak-ng). That is allowed, and it still doesn't change Lotus's own licence, but the package must then include the GPL licence text and a way to get espeak-ng's source code. Keeping engines as downloads avoids this.
2. **Piper voice recordings.** Each Piper voice's `MODEL_CARD` names the recording set it was trained on. Some of those sets may have non-commercial or research-only terms. These cards couldn't be read from this check's network, so the Models page shows "Varies by voice" until each one is checked. To do before Lotus Pro goes on sale.
3. **Pocket TTS weights are CC-BY-4.0**, which requires credit. THIRD_PARTY_LICENSES.md and the model card give it.

## Bundled with Lotus

- **Bun** (inside `lotusd`): MIT. Bun includes JavaScriptCore from WebKit under the LGPL-2; Bun publishes the WebKit source it uses at https://github.com/oven-sh/WebKit. The LGPL allows this inside a program under any licence, as long as the notice and source link stay available, which THIRD_PARTY_LICENSES.md provides.
- **fflate** (MIT), **pdf.js** (Apache-2.0), **blobatar** (MIT), **rusqlite/SQLite** (MIT/public domain), fonts (SIL OFL 1.1). All fit FSL.
