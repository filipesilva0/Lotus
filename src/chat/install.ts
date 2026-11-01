// Model installs proposed by the chat model (session 11).
//
// When the user asks in Chat to install or download a model (chat, image or voice), the model adds a
// fenced ```install block. Lotus shows it as a card with Allow / Deny; nothing is downloaded until the
// user presses Allow. What can be installed is limited on purpose:
//   - chat: any Ollama model tag (Ollama pulls it from its own library, as `ollama pull` would);
//   - images: only the image models Lotus knows how to wire in ComfyUI (setup/catalog.ts IMAGE_PICKS);
//   - voice: the voice models in the catalog, or a model name Voicebox itself offers (checked at install time).
// Pure functions only, so the harness can test them without a DOM.

import type { EngineId } from '../services/engineConfig';
import { CHAT_PICKS, DICTATION_PICK, IMAGE_PICKS, VOICE_PICKS, ChatPick, ImagePick, VoicePick } from '../setup/catalog';

export interface InstallTarget {
  engine: EngineId;
  /** Ollama tag, catalog id, or Voicebox model name. */
  id: string;
  title: string;
  /** Download size when known. */
  diskGb?: number;
  reason?: string;
  pick?: ChatPick | ImagePick | VoicePick;
}

export interface ParsedInstall {
  /** Reply text with the install block removed. */
  text: string;
  target: InstallTarget | null;
  /** The block was there but could not be used; shown on the card instead of Allow. */
  problem: string | null;
  /** True while an ```install block is still streaming in. */
  pending: boolean;
}

const ENGINE_LABEL: Record<EngineId, string> = { ollama: 'Ollama (chat)', comfyui: 'ComfyUI (images)', voicebox: 'Voicebox (voice)' };
export const engineLabel = (e: EngineId) => ENGINE_LABEL[e];

/** Added to the system prompt so models propose installs in a form Lotus can turn into an Allow / Deny card. */
export function installInstructions(): string {
  const images = IMAGE_PICKS.map((p) => `"${p.id}" (${p.title})`).join(', ');
  const voices = [...VOICE_PICKS, DICTATION_PICK].map((p) => `"${p.id}" (${p.title})`).join(', ');
  return '\n\nOnly when the user asks you to install, download or add a model, propose it by adding a fenced code block with the language "install" at the very end of your reply. ' +
    'Its content is JSON: {"engine":"ollama","model":"<Ollama library tag, e.g. gemma4:12b>","reason":"<one short sentence>"} for chat models; ' +
    `{"engine":"comfyui","model":"<id>"} for image models, where id is one of ${images}; ` +
    `{"engine":"voicebox","model":"<id>"} for voice models, where id is one of ${voices}. ` +
    'One model per reply. Lotus asks the user to allow or deny it and does the download itself, so never tell the user to run commands for it, and never claim it is installed.';
}

const OPEN_RE = /(^|\n)[ ]{0,3}(`{3,}|~{3,})[ \t]*install[ \t]*\n/i;
/** Ollama tags: library names (gemma4:12b, qwen3.5:4b), namespaced (user/model:tag) and hf.co/… repos. */
const OLLAMA_TAG = /^(?:hf\.co\/|huggingface\.co\/)?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*){0,2}(?::[a-z0-9][a-z0-9._-]{0,127})?$/i;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

function findPick<T extends { id: string; title: string }>(list: T[], name: string): T | undefined {
  const n = norm(name);
  return list.find((p) => norm(p.id) === n || norm(p.title) === n);
}

/** Turns the model's JSON into something Lotus can install, or explains why it can't. */
export function resolveInstall(raw: unknown): { target: InstallTarget | null; problem: string | null } {
  if (!raw || typeof raw !== 'object') return { target: null, problem: 'The model proposed an install Lotus could not read.' };
  const r = raw as Record<string, unknown>;
  const engineRaw = String(r.engine ?? r.kind ?? r.type ?? '').toLowerCase();
  const engine: EngineId | null = /ollama|chat|llm|text/.test(engineRaw) ? 'ollama' : /comfy|image/.test(engineRaw) ? 'comfyui' : /voice|tts|voicebox|speech|whisper/.test(engineRaw) ? 'voicebox' : null;
  const model = String(r.model ?? r.name ?? r.id ?? r.tag ?? '').trim();
  const reason = typeof r.reason === 'string' ? r.reason.replace(/\s+/g, ' ').trim().slice(0, 200) || undefined : undefined;
  if (!engine) return { target: null, problem: `The model proposed an install for an unknown engine ("${engineRaw || 'none'}").` };
  if (!model) return { target: null, problem: 'The model proposed an install without naming a model.' };

  if (engine === 'ollama') {
    const tag = model.replace(/^ollama\s+(pull|run)\s+/i, '');
    if (!OLLAMA_TAG.test(tag)) return { target: null, problem: `"${model.slice(0, 80)}" is not an Ollama model name.` };
    const pick = CHAT_PICKS.find((p) => p.tag === tag.toLowerCase());
    return { target: { engine, id: tag, title: pick?.title ?? tag, diskGb: pick?.diskGb, reason, pick }, problem: null };
  }
  if (engine === 'comfyui') {
    const pick = findPick(IMAGE_PICKS, model);
    if (!pick) return { target: null, problem: `Lotus can only install the image models it knows how to set up (${IMAGE_PICKS.map((p) => p.title).join(', ')}). For "${model.slice(0, 80)}", use Engines → Models → Download.` };
    return { target: { engine, id: pick.id, title: pick.title, diskGb: pick.diskGb, reason, pick }, problem: null };
  }
  const pick = findPick([...VOICE_PICKS, DICTATION_PICK], model);
  if (pick) return { target: { engine, id: pick.id, title: pick.title, diskGb: pick.diskGb, reason, pick }, problem: null };
  if (!/^[\w.\-/ ]{2,80}$/.test(model)) return { target: null, problem: `"${model.slice(0, 80)}" is not a Voicebox model name.` };
  return { target: { engine, id: model, title: model, reason }, problem: null };
}

/** Finds the ```install block in a reply. */
export function parseInstall(content: string): ParsedInstall {
  const open = OPEN_RE.exec(content);
  if (!open) return { text: content, target: null, problem: null, pending: false };
  const start = open.index + open[1].length;
  const bodyStart = open.index + open[0].length;
  const fence = open[2];
  const close = new RegExp(`\\n[ ]{0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*(\\n|$)`).exec(content.slice(bodyStart - 1));
  if (!close) return { text: content.slice(0, start).trimEnd(), target: null, problem: null, pending: true };
  const body = content.slice(bodyStart, bodyStart - 1 + close.index);
  const after = content.slice(bodyStart - 1 + close.index + close[0].length);
  const text = `${content.slice(0, start).trimEnd()}${after.trim() ? `\n\n${after.trim()}` : ''}`;
  let raw: unknown;
  try { raw = JSON.parse(body.trim()); } catch { return { text, target: null, problem: 'The model proposed an install Lotus could not read.', pending: false }; }
  if (Array.isArray(raw)) raw = raw[0];
  const { target, problem } = resolveInstall(raw);
  return { text, target, problem, pending: false };
}
