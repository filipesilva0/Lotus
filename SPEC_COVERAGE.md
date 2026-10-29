# Spec coverage: Chat, Images, Models, Voice

Evidence: ✅ written and type-checked loosely in the sandbox (no `node_modules`, so no real `tsc`/build/tests were run) · ⚠️ needs a live engine to confirm · ❌ deliberately not built (reason given).
**Nothing here has been built or run on Windows.** Run `npm install && npx tsc --noEmit && npm run build && bash handover/verification/run-tests.sh` first.

## Chat (Chat_Page.txt)
| Spec item | Status |
|---|---|
| Collapsed icon rail on entering a module | ✅ rail auto-collapses when opening Chat, Images, Voice, Models (toggle still works) |
| New chat, projects/folders, pinned, date-grouped history, rename/delete, search | ✅ `components/chat/ChatSidebar.tsx` |
| Model selector, context-token meter, incognito | ✅ meter uses Ollama's real token counts after a reply, an estimate before; incognito threads are never saved and make no memories |
| Mid-stream steering | ✅ sending while a reply streams stops it, keeps the partial text, continues from the new message |
| Thinking drawer with timer and tool calls | ✅ reasoning tokens now captured (they were dropped before); source-search steps appear as tool calls |
| Inline citations | ✅ `[n]` become clickable chips when "Search sources" is on (OpenAlex/arXiv/PubMed keywords leave the PC; off by default) |
| Conditional thumbs up/down | ✅ only appears when the user says "remember …" / "from now on …" (saved fact or rule; 👍 keep, 👎 forget). Deterministic phrases, not model inference |
| Hover: edit prompt, copy, regenerate, `< 1 / 3 >` branches | ✅ `chat/branching.ts` |
| Attachment dock, slash commands, @ mentions, dictation, Send/Stop/Steer | ✅ images → vision; text/code files → mounted context. `/new /clear /incognito /search /model /temp /seed /system /pin`; `@model` (one-off model) and `@file` |
| PDFs | ❌ no PDF parser is bundled; the composer says so |
| Artifacts panel | ✅ code blocks listed, editable, copy/download; HTML/SVG preview in a script-free sandbox. ❌ JavaScript in artifacts does not run (app CSP) |
| Context manager with chunk toggles | ✅ files only. ❌ web URLs: the app may only reach loopback + 4 research hosts |
| Research tab | ✅ queries, results, source cards |
| Parameters & developer inspector | ✅ temperature, top-P, top-K, frequency/presence penalty, stop sequences, seed, max tokens, context window, system prompt, raw request/response JSON. ❌ logit bias and token-confidence maps (not part of the request Lotus sends) |

## Images (Image_Gen_Page.txt)
| Spec item | Status |
|---|---|
| Gallery sidebar: new generation, search (prompt/seed), projects, pinned, date groups, thumbnails | ✅ gallery now persists in IndexedDB (fixes B9 for images) |
| Header model selector | ✅ checkpoint selector. "Credits meter" → ✅ replaced by a real GPU-memory meter (no credits exist locally) |
| Progress overlay | ✅ elapsed time, size, steps, checkpoint, cancel. ❌ live step counter (needs a WebSocket the CSP/ComfyUI origin check may refuse); ❌ "cryptographic model signature" (ComfyUI exposes none) |
| Hover actions: download, upscale ×2/×4, variations, inpaint/outpaint, copy prompt | ✅ ⚠️ upscale is a Lanczos resize (no AI upscaler model). Inpaint (brush mask editor), outpaint (extend 25%), variations (img2img) built on ComfyUI nodes, never run against a live ComfyUI |
| `< 1 / 4 >` versions + thumbnail strip | ✅ |
| Prompt deck, reference dock (img2img), `/ar /seed /steps /cfg /count /neg`, `@Style` saved styles, Generate↔Stop | ✅ |
| Parameters: aspect (incl. custom), count 1/2/4/8, negative, CFG, steps, sampler+scheduler (from ComfyUI), seed | ✅ |

## Models (Models_Page.txt): new "Models" page in the rail
| Spec item | Status |
|---|---|
| Import/Download, search, mode switcher | ✅ Ollama names or `hf.co/user/repo:QUANT`. ❌ importing a local GGUF file (needs multi-GB hashing/upload) |
| Hub: catalog cards, tags, quant selector with VRAM estimate, progress/verify, Load / Delete | ✅ catalog is a hand-picked list, not a live listing. Quant tags exist only where the Ollama library names them predictably; others disable the selector. "Fits your GPU" uses ComfyUI's GPU total |
| Arena: 2–3 models, same prompt, TTFT / tok/s / total, voting, blind mode, history + leaderboard | ✅ ⚠️ parallel requests may be loaded in turn by Ollama |
| Monitor: VRAM, RAM, engine status | ✅ VRAM/RAM come from ComfyUI's `system_stats`; Ollama's loaded models from `/api/ps`; Voicebox from `/health` |
| CPU load / temperature, engine process logs | ❌ no engine reports them; engines Lotus starts have output discarded. A request log of Lotus's own calls is shown instead |

## Voice (TTS_Voicebox_Page.txt)
| Spec item | Status |
|---|---|
| 3-panel layout, mode switcher (Profiles, Speech, Captures, Stories + History), contextual New button, feed | ✅ `VoiceSidebar` |
| Clone: file / mic / **system audio** capture | ✅ ⚠️ system capture uses `getDisplayMedia`; WebView2 behaviour untested |
| Sample health check (duration, rate, SNR estimate, clipping) and trimmer | ✅ numeric trim (start/end), not a drag waveform |
| Persona (≤2000 chars), Compose | ✅ ⚠️ Compose calls Voicebox's persona speech path, unverified |
| Engine compatibility grid | ⚠️ from Voicebox's documentation, not queried live |
| Speech: expression chips, 50k counter, chunking, effects, speed, seed, RTF + VRAM readout | ✅ playback speed 0.75–2×; RTF shown after each generation. Pitch-shift/effects live in the existing card beside the script rather than a separate inspector |
| Captures: raw vs refined, STT model manager, API panel | ✅ STT/API in the inspector. ❌ global auto-paste hotkey and MCP agent-voice bindings (Voicebox's own app) |
| Stories DAW | ✅ existing timeline (retime/trim/split/volume/export WAV). ❌ pan, per-track EQ, LUFS targeting, stem export, cue-sheet export, loop transport: not offered by the Voicebox API Lotus uses |

## Known follow-ups
Real build + tests (`handover/verification` harnesses were not updated for the new Chat/Image modules and were not run); a live pass for Images edit tools and Voice additions; add tests for `chat/branching.ts` and `chat/helpers.ts`.
