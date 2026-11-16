// Images proposed in Chat (0.10.1).
//
// When the user asks Chat for an image (or a prompt for one), the model writes the prompt and adds a
// fenced ```image block with every setting it chose: model, shape, resolution, negative prompt, steps,
// guidance, sampler, how many. Lotus shows a card asking "Create it now?" with Yes / No; Yes opens
// Images with those settings and starts generating. Nothing is generated without the click.
// Pure functions only, so the core's tests can import them.

import { FAMILIES, settingsFor, type ImageFamily, type ImageProfile } from '../models/imageProfiles';

export interface ImageProposal {
  prompt: string;
  negative?: string;
  /** "16:9", "1:1"… or "WxH". */
  aspect: string;
  /** Side of a square with the same area; 0 = the model's own size. */
  resolution: number;
  count: number;
  steps?: number;
  cfg?: number;
  sampler?: string;
  scheduler?: string;
  seed?: number | null;
  /** The image setup (built-in engine) or checkpoint (ComfyUI) to use, as Lotus listed it. */
  model?: string;
  /** Short title for the card. */
  title?: string;
  /** One sentence on why these settings. */
  why?: string;
}

export interface ParsedImageProposal { text: string; proposal: ImageProposal | null; problem: string | null; pending: boolean }

/** What the model can pick from: the image setups or checkpoints that are ready. */
export interface ImageChoice { name: string; family?: ImageFamily }

const ASPECTS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'];
const SAMPLERS = ['euler', 'euler_ancestral', 'dpmpp_2m', 'dpmpp_2m_sde', 'dpmpp_sde', 'res_multistep', 'heun', 'ddim', 'uni_pc'];
const SCHEDULERS = ['normal', 'karras', 'simple', 'sgm_uniform', 'exponential', 'beta'];

/** Added to the chat's system prompt. Lists the image models that are ready and what suits each. */
export function imageInstructions(models: ImageChoice[]): string {
  const list = models.length
    ? models.map((m) => {
      const f = m.family ? FAMILIES[m.family] : null;
      return f ? `"${m.name}" (${f.label}: made for ${f.base}×${f.base}, ${f.locked ? `fixed ${f.steps} steps and guidance ${f.cfg}, don't set steps/cfg/sampler` : `about ${f.steps} steps, guidance ${f.cfg}, sampler ${f.sampler}`}${f.negative === 'zero' ? ', ignores negative prompts' : ''})` : `"${m.name}"`;
    }).join('; ')
    : 'none is ready yet (Lotus will tell the user to get one)';
  return '\n\nWhen the user asks you to make, draw or create an image, or to write a prompt for an image, write the prompt in your reply as usual, then add a fenced code block with the language "image" at the very end of your reply. ' +
    'Lotus shows it as a card asking the user whether to create it now in Images (Yes / No), so never claim the image was made, and don\'t call the image.generate tool for it. ' +
    'Its content is JSON with the best settings for that picture: {"title":"<2-5 words>","prompt":"<the full prompt, rich in subject, style, lighting, composition and detail>","negative":"<what to avoid>","model":"<one of the models below>","aspect":"<1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3 or 21:9 to suit the subject>","resolution":0,"count":1,"steps":<number>,"cfg":<number>,"sampler":"<sampler>","why":"<one short sentence on the choices>"}. ' +
    'Use resolution 0 (the model\'s own size) unless the user asks for a bigger or smaller image (512 to 2048). Use count 1 unless the user wants options (up to 4). ' +
    `Image models ready on this computer: ${list}. One image block per reply.`;
}

const OPEN_RE = /(^|\n)[ ]{0,3}(`{3,}|~{3,})[ \t]*image[ \t]*\n/i;
const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Checks the model's JSON and keeps every value in a range Lotus can use. */
export function resolveProposal(raw: unknown): { proposal: ImageProposal | null; problem: string | null } {
  if (!raw || typeof raw !== 'object') return { proposal: null, problem: 'The model suggested an image Lotus could not read.' };
  const r = raw as Record<string, unknown>;
  const prompt = String(r.prompt ?? r.positive ?? '').replace(/\s+/g, ' ').trim().slice(0, 2000);
  if (!prompt) return { proposal: null, problem: 'The model suggested an image without a prompt.' };
  const aspectRaw = String(r.aspect ?? r.aspect_ratio ?? r.ratio ?? '1:1').replace(/\s+/g, '').replace('×', 'x');
  const size = /^(\d{3,4})x(\d{3,4})$/i.exec(aspectRaw);
  const aspect = ASPECTS.includes(aspectRaw) ? aspectRaw : size ? `${clamp(+size[1], 256, 2048)}x${clamp(+size[2], 256, 2048)}` : '1:1';
  const res = num(r.resolution);
  const steps = num(r.steps), cfg = num(r.cfg ?? r.guidance), count = num(r.count ?? r.images ?? 1), seed = num(r.seed);
  const sampler = typeof r.sampler === 'string' && SAMPLERS.includes(r.sampler.toLowerCase()) ? r.sampler.toLowerCase() : undefined;
  const scheduler = typeof r.scheduler === 'string' && SCHEDULERS.includes(r.scheduler.toLowerCase()) ? r.scheduler.toLowerCase() : undefined;
  const text = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, n) : undefined);
  return {
    problem: null,
    proposal: {
      prompt, aspect, sampler, scheduler,
      negative: text(r.negative ?? r.negative_prompt, 600),
      resolution: Number.isFinite(res) && res >= 256 ? clamp(Math.round(res / 64) * 64, 512, 2048) : 0,
      count: Number.isFinite(count) ? clamp(Math.round(count), 1, 4) : 1,
      steps: Number.isFinite(steps) ? clamp(Math.round(steps), 1, 80) : undefined,
      cfg: Number.isFinite(cfg) ? clamp(Math.round(cfg * 10) / 10, 1, 20) : undefined,
      seed: Number.isFinite(seed) && seed >= 0 ? Math.floor(seed) : null,
      model: text(r.model ?? r.checkpoint ?? r.setup, 200),
      title: text(r.title, 60),
      why: text(r.why ?? r.reason, 240),
    },
  };
}

/** Finds the ```image block in a reply. */
export function parseImageProposal(content: string): ParsedImageProposal {
  const open = OPEN_RE.exec(content);
  if (!open) return { text: content, proposal: null, problem: null, pending: false };
  const start = open.index + open[1].length;
  const bodyStart = open.index + open[0].length;
  const fence = open[2];
  const close = new RegExp(`\\n[ ]{0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*(\\n|$)`).exec(content.slice(bodyStart - 1));
  if (!close) return { text: content.slice(0, start).trimEnd(), proposal: null, problem: null, pending: true };
  const body = content.slice(bodyStart, bodyStart - 1 + close.index);
  const after = content.slice(bodyStart - 1 + close.index + close[0].length);
  const text = `${content.slice(0, start).trimEnd()}${after.trim() ? `\n\n${after.trim()}` : ''}`;
  let raw: unknown;
  try { raw = JSON.parse(body.trim()); } catch { return { text, proposal: null, problem: 'The model suggested an image Lotus could not read.', pending: false }; }
  if (Array.isArray(raw)) raw = raw[0];
  return { text, pending: false, ...resolveProposal(raw) };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** The ready setup the proposal names (by name or file), else the first ready one. */
export function pickProfile(p: ImageProposal, profiles: ImageProfile[]): ImageProfile | undefined {
  if (p.model) {
    const n = norm(p.model);
    const hit = profiles.find((x) => norm(x.name) === n) ?? profiles.find((x) => norm(x.files.model ?? '').includes(n) || (norm(x.name).length >= 4 && n.includes(norm(x.name))));
    if (hit) return hit;
  }
  return profiles[0];
}

/**
 * The Images page settings for a proposal. Distilled models keep their fixed settings; anything the
 * model left out gets what suits the chosen model.
 */
export function proposalParams<T extends { aspect: string; count: number; negative: string; cfg: number; steps: number; sampler: string; scheduler: string; seed: number | null; profile?: string; checkpoint: string; resolution?: number }>(
  base: T, p: ImageProposal, o: { profile?: ImageProfile; checkpoints?: string[] },
): T {
  const out: T = { ...base, aspect: p.aspect, resolution: p.resolution, count: p.count, seed: p.seed ?? null };
  if (p.negative !== undefined) out.negative = p.negative;
  if (o.profile) {
    const st = settingsFor(o.profile);
    out.profile = o.profile.id;
    out.steps = st.locked ? st.steps : (p.steps ?? st.steps);
    out.cfg = st.locked ? st.cfg : (p.cfg ?? st.cfg);
    out.sampler = st.locked ? st.sampler : (p.sampler ?? st.sampler);
    out.scheduler = st.locked ? st.scheduler : (p.scheduler ?? st.scheduler);
    return out;
  }
  if (o.checkpoints?.length) {
    const n = p.model ? norm(p.model) : '';
    const stem = (c: string) => norm(c.replace(/\.[a-z]+$/i, ''));
    out.checkpoint = (n && (o.checkpoints.find((c) => norm(c).includes(n)) ?? o.checkpoints.find((c) => stem(c).length >= 4 && n.includes(stem(c))))) || (o.checkpoints.includes(base.checkpoint) ? base.checkpoint : o.checkpoints[0]);
  }
  if (p.steps) out.steps = p.steps;
  if (p.cfg) out.cfg = p.cfg;
  if (p.sampler) out.sampler = p.sampler;
  if (p.scheduler) out.scheduler = p.scheduler;
  return out;
}
