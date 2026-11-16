// Voice studio with Lotus's own voice engine (0.8.2): everything Voicebox did, without Voicebox.
//   voices   built-in speakers (Kokoro, Piper) and your own voices: a cloning model (PocketTTS,
//            ZipVoice) plus a reference recording kept in Lotus Studio, or a built-in speaker you
//            saved with your own settings and effects
//   effects  applied after speaking, in the window (Web Audio), with presets for a low start
//   stories  a script ("Ana: Hello") turned into clips on tracks, played and exported as one file
// Pure (no DOM, no kv): shared by the Voice page, the island/notices and handover/verification/s18-tests.ts.

// ── Voices ─────────────────────────────────────────────────────────────────

/** A downloaded voice model as the core lists it (lib/builtins.ts). */
export interface VoiceModel { id: string; title: string; entryId?: string; speakers: { id: number; name: string }[]; clones: boolean; needsReferenceText: boolean }

/** A voice you made: a cloning model + a recording, or a built-in speaker with your own settings. */
export interface MyVoice {
  id: string;
  name: string;
  /** Installed voice model id. */
  model: string;
  speaker?: number;
  /** Media path of the reference recording (cloning models). */
  reference?: string;
  /** Words spoken in the reference recording (ZipVoice needs them; Lotus fills them in with Whisper). */
  referenceText?: string;
  /** Quality steps for cloning models (more = slower, cleaner). */
  steps?: number;
  speed?: number;
  effects?: Effects;
  notes?: string;
  created: number;
}

/** One entry in the voice picker. `id` is `preset:<model>:<speaker>` or a MyVoice id. */
export interface VoiceOption { id: string; name: string; detail: string; mine: boolean; ready: boolean; model: string; speaker: number; reference?: string; referenceText?: string; steps?: number; speed?: number; effects?: Effects; why?: string }

/** Kokoro voice ids ("af_heart") → "Heart · US English, female". */
export const speakerLabel = (n: string) => { const m = /^([ab])([fm])_(\w+)$/.exec(n); return m ? `${m[3][0].toUpperCase()}${m[3].slice(1)} · ${m[1] === 'a' ? 'US' : 'UK'} English, ${m[2] === 'f' ? 'female' : 'male'}` : n; };

/** Every voice you can speak with right now: yours first, then each built-in speaker. */
export function voiceOptions(models: VoiceModel[], mine: MyVoice[]): VoiceOption[] {
  const byId = new Map(models.map((m) => [m.id, m]));
  const own = mine.map((v): VoiceOption => {
    const m = byId.get(v.model);
    const why = !m ? 'Its voice model isn’t downloaded.' : m.clones && !v.reference ? 'It has no recording yet.' : m.needsReferenceText && !v.referenceText?.trim() ? 'Add the words spoken in its recording.' : undefined;
    return { id: v.id, name: v.name, detail: m ? (m.clones ? `Your voice · ${m.title.replace(/\s*\(.*\)$/, '')}` : `Your voice · ${m.title}`) : 'Your voice', mine: true, ready: !why, why,
      model: v.model, speaker: v.speaker ?? 0, reference: v.reference, referenceText: v.referenceText, steps: v.steps, speed: v.speed, effects: v.effects };
  });
  const presets = models.filter((m) => !m.clones).flatMap((m) => (m.speakers.length ? m.speakers : [{ id: 0, name: m.title }]).map((s): VoiceOption => ({
    id: `preset:${m.id}:${s.id}`, name: m.speakers.length > 1 ? speakerLabel(s.name) : m.title, detail: m.speakers.length > 1 ? m.title : 'Built-in voice', mine: false, ready: true, model: m.id, speaker: s.id,
  })));
  return [...own, ...presets];
}

/** The option to use: the chosen one if it still exists and works, else the first that works. */
export function pickVoice(options: VoiceOption[], chosen: string | null | undefined): VoiceOption | null {
  return options.find((o) => o.id === chosen && o.ready) ?? options.find((o) => o.ready) ?? null;
}

/** Short lines people can read aloud for a clone: varied sounds, about 8–12 seconds. */
export const READING_SCRIPTS = [
  'The quick brown fox jumps over the lazy dog, while a gentle breeze carries the smell of fresh bread across the quiet village square.',
  'On Sunday mornings I like to walk by the river, drink a warm coffee and listen to the birds before the city wakes up.',
  'Please remember to bring your notebook, a pencil and a bottle of water; we will start exactly at nine o’clock.',
];

// ── Effects ────────────────────────────────────────────────────────────────

export interface Effects {
  /** Loudness change in dB (−12…+12). */
  volume: number;
  /** Low shelf at 200 Hz in dB (−12…+12): warmth. */
  bass: number;
  /** High shelf at 4 kHz in dB (−12…+12): clarity. */
  treble: number;
  /** Tape-style pitch in semitones (−6…+6). Also changes the pace, like a tape. */
  pitch: number;
  /** Room size 0…1 (reverb). */
  room: number;
  /** Echo amount 0…1. */
  echo: number;
  /** Narrow band like a phone or radio: 'off' | 'phone' | 'radio'. */
  band: 'off' | 'phone' | 'radio';
  /** Robot voice amount 0…1 (ring modulation). */
  robot: number;
  /** Fade in / out in seconds. */
  fadeIn: number;
  fadeOut: number;
  /** Bring the loudest point to −1 dB. */
  normalize: boolean;
}

export const NO_EFFECTS: Effects = { volume: 0, bass: 0, treble: 0, pitch: 0, room: 0, echo: 0, band: 'off', robot: 0, fadeIn: 0, fadeOut: 0, normalize: false };

export const EFFECT_PRESETS: { id: string; label: string; fx: Partial<Effects> }[] = [
  { id: 'none', label: 'Natural', fx: {} },
  { id: 'narrator', label: 'Warm Narrator', fx: { bass: 4, treble: 2, room: 0.15, normalize: true } },
  { id: 'podcast', label: 'Podcast', fx: { bass: 2, treble: 3, normalize: true } },
  { id: 'phone', label: 'Phone Call', fx: { band: 'phone', volume: -2 } },
  { id: 'radio', label: 'Old Radio', fx: { band: 'radio', room: 0.1 } },
  { id: 'hall', label: 'Big Hall', fx: { room: 0.7, echo: 0.15 } },
  { id: 'cave', label: 'Cave Echo', fx: { room: 0.4, echo: 0.5 } },
  { id: 'deep', label: 'Deep Voice', fx: { pitch: -3, bass: 3 } },
  { id: 'chipmunk', label: 'Chipmunk', fx: { pitch: 5 } },
  { id: 'robot', label: 'Robot', fx: { robot: 0.7, treble: 2 } },
];

export const withEffects = (fx?: Partial<Effects> | null): Effects => ({ ...NO_EFFECTS, ...(fx ?? {}) });
/** True when rendering would change nothing (skip the extra pass). */
export const effectsNeutral = (fx?: Partial<Effects> | null): boolean => { const e = withEffects(fx); return (Object.keys(NO_EFFECTS) as (keyof Effects)[]).every((k) => e[k] === NO_EFFECTS[k]); };
/** Which preset these settings match, if any. */
export const presetOf = (fx?: Partial<Effects> | null): string | null => { const e = withEffects(fx); return EFFECT_PRESETS.find((p) => (Object.keys(NO_EFFECTS) as (keyof Effects)[]).every((k) => withEffects(p.fx)[k] === e[k]))?.id ?? null; };
/** Playback rate for a tape pitch shift of `semi` semitones. */
export const pitchRate = (semi: number) => Math.pow(2, Math.max(-12, Math.min(12, semi)) / 12);
/** Seconds the effects add after the speech ends (reverb and echo tails). */
export const effectTail = (fx: Effects) => (fx.room > 0 ? 0.4 + fx.room * 2.6 : 0) + (fx.echo > 0 ? 0.3 + fx.echo * 2 : 0);

// ── Stories ────────────────────────────────────────────────────────────────

export interface StoryItem {
  id: string;
  /** Who says it (a voice option id), and what. */
  voice: string;
  text: string;
  /** The spoken clip (media path) once made. */
  clip?: string;
  /** Clip length in seconds once made. */
  duration?: number;
  /** Track 0…3 (lines on different tracks can overlap). */
  track: number;
  /** Start time in seconds; null = right after the previous line (plus the story's gap). */
  start: number | null;
  /** Volume 0…2. */
  gain: number;
}

export interface Story { id: string; name: string; items: StoryItem[]; gap: number; created: number; updated: number }

/**
 * Reads a script: one line per sentence, "Name: what they say" picks the speaker. Lines without a
 * name keep the previous speaker. Blank lines are skipped. Names are matched to `cast` (name →
 * voice option id) case-insensitively; unknown names get `fallback`.
 */
export function parseScript(script: string, cast: Record<string, string>, fallback: string): { speaker: string; voice: string; text: string }[] {
  const lc = Object.fromEntries(Object.entries(cast).map(([k, v]) => [k.trim().toLowerCase(), v]));
  const out: { speaker: string; voice: string; text: string }[] = [];
  let speaker = '';
  for (const raw of script.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // "Name: text" — but not a link ("See https://…").
    const m = /^([^:]{1,32}):(?!\/\/)\s*(.+)$/.exec(line);
    if (m) { speaker = m[1].trim(); out.push({ speaker, voice: lc[speaker.toLowerCase()] ?? fallback, text: m[2].trim() }); }
    else out.push({ speaker, voice: lc[speaker.toLowerCase()] ?? fallback, text: line });
  }
  return out;
}

/** The speaker names in a script, in order of appearance. */
export const scriptSpeakers = (script: string): string[] => [...new Set(parseScript(script, {}, '').map((l) => l.speaker).filter(Boolean))];

/** Where each line plays: explicit starts stay, the rest follow the previous line on any track. */
export function layoutStory(s: Pick<Story, 'items' | 'gap'>): { id: string; start: number; end: number; track: number }[] {
  let cursor = 0;
  return s.items.map((it) => {
    const start = it.start ?? cursor;
    const end = start + (it.duration ?? 0);
    cursor = Math.max(cursor, end + (it.duration ? s.gap : 0));
    return { id: it.id, start, end, track: it.track };
  });
}

export const storyLength = (s: Pick<Story, 'items' | 'gap'>): number => layoutStory(s).reduce((m, x) => Math.max(m, x.end), 0);

/** Text split into chunks the engine handles well (sentences, ≤ max characters each). */
export function chunkText(text: string, max = 600): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean ? [clean] : [];
  const sentences = clean.match(/[^.!?…]+[.!?…]+["'”’)]*\s*|[^.!?…]+$/g) ?? [clean];
  const out: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if ((cur + s).length > max && cur) { out.push(cur.trim()); cur = ''; }
    if (s.length > max) { for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max).trim()); continue; }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
