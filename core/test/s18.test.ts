// 0.8.2: the Voice page with Lotus's own engine does everything Voicebox did: voice cloning
// (PocketTTS, ZipVoice), your voices, effects settings, stories from scripts, long texts in parts.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Builtins } from '../src/engines/manager';
import { entryById } from '../../src/models/library';
import {
  EFFECT_PRESETS, NO_EFFECTS, chunkText, effectsNeutral, layoutStory, parseScript, pickVoice, pitchRate, presetOf, scriptSpeakers, storyLength, voiceOptions, withEffects,
  type MyVoice, type VoiceModel,
} from '../../src/voice/studio';

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'lotus-s18-')); dirs.push(d); return d; };
afterAll(() => dirs.forEach((d) => { try { rmSync(d, { recursive: true, force: true }); } catch { /* Windows */ } }));
const files = (root: string, list: string[]) => { for (const f of list) { mkdirSync(join(root, f, '..'), { recursive: true }); writeFileSync(join(root, f), 'x'); } return root; };
const builtins = () => new Builtins({ studio: tmp(), broadcast: () => undefined, kvGet: () => null, kvSet: () => undefined, fetch, log: () => undefined } as never);

describe('cloning models in the catalog', () => {
  test('PocketTTS and ZipVoice are built-in voices that clone; ZipVoice brings its vocoder', () => {
    const p = entryById('pocket-tts')!, z = entryById('zipvoice')!;
    expect([p.kind, p.voice?.engine, p.voice?.clones, p.voice?.needsReferenceText]).toEqual(['voice', 'pocket', true, undefined]);
    expect(p.builtin!.files![0].url).toBe('https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-pocket-tts-int8-2026-01-26.tar.bz2');
    expect([z.voice?.clones, z.voice?.needsReferenceText]).toEqual([true, true]);
    // The archive first (it replaces the folder), then the vocoder into the same folder.
    expect(z.builtin!.files!.map((f) => [f.path, !!f.archive])).toEqual([['voice/zipvoice', true], ['voice/zipvoice/vocos_24khz.onnx', false]]);
    expect(z.builtin!.files![1].url).toBe('https://github.com/k2-fsa/sherpa-onnx/releases/download/vocoder-models/vocos_24khz.onnx');
  });
});

describe('sherpa-onnx arguments for cloning', () => {
  const b = builtins();
  const pocket = files(tmp(), ['m/lm_flow.int8.onnx', 'm/lm_main.int8.onnx', 'm/encoder.onnx', 'm/decoder.int8.onnx', 'm/text_conditioner.onnx', 'm/vocab.json', 'm/token_scores.json']);
  const zip = files(tmp(), ['z/encoder.int8.onnx', 'z/decoder.int8.onnx', 'z/espeak-ng-data/phontab', 'z/lexicon.txt', 'z/tokens.txt', 'vocos_24khz.onnx']);

  test('PocketTTS: every model file, the reference recording and quality steps', () => {
    const a = b.ttsArgs(pocket, 'Hello', '/o.wav', 0, 1, { audio: '/ref.wav', steps: 3 });
    expect(a).toContain(`--pocket-lm-main=${join(pocket, 'm/lm_main.int8.onnx')}`);
    expect(a).toContain(`--pocket-encoder=${join(pocket, 'm/encoder.onnx')}`);
    expect(a).toContain(`--pocket-decoder=${join(pocket, 'm/decoder.int8.onnx')}`);
    expect(a).toContain(`--pocket-token-scores-json=${join(pocket, 'm/token_scores.json')}`);
    expect(a).toContain('--reference-audio=/ref.wav');
    expect(a).toContain('--num-steps=3');
    expect(a.at(-1)).toBe('Hello');
    expect(a.some((x) => x.startsWith('--sid'))).toBe(false);
  });
  test('PocketTTS without a recording says how to fix it', () => {
    expect(() => b.ttsArgs(pocket, 'Hi', '/o.wav')).toThrow(/copies a voice from a recording/);
  });
  test('ZipVoice: recording, its words, vocoder and espeak data', () => {
    const a = b.ttsArgs(zip, 'Olá', '/o.wav', 0, 1, { audio: '/r.wav', text: ' hello   there ' });
    expect(a).toContain(`--zipvoice-encoder=${join(zip, 'z/encoder.int8.onnx')}`);
    expect(a).toContain(`--zipvoice-vocoder=${join(zip, 'vocos_24khz.onnx')}`);
    expect(a).toContain(`--zipvoice-data-dir=${join(zip, 'z/espeak-ng-data')}`);
    expect(a).toContain('--reference-text=hello there');
    expect(a).toContain('--num-steps=4');
    expect(() => b.ttsArgs(zip, 'x', '/o.wav', 0, 1, { audio: '/r.wav' })).toThrow(/needs the words spoken/);
  });
  test('Kokoro and Piper are unchanged', () => {
    const k = files(tmp(), ['k/model.onnx', 'k/voices.bin', 'k/tokens.txt']);
    expect(b.ttsArgs(k, 'x', '/o.wav', 3, 1)).toContain('--sid=3');
    const p = files(tmp(), ['p/en_US-lessac-medium.onnx', 'p/tokens.txt']);
    expect(b.ttsArgs(p, 'x', '/o.wav').some((x) => x.startsWith('--vits-model='))).toBe(true);
  });
});

describe('your voices and the picker', () => {
  const models: VoiceModel[] = [
    { id: 'kokoro', title: 'Kokoro', speakers: [{ id: 0, name: 'af_alloy' }, { id: 1, name: 'bm_george' }], clones: false, needsReferenceText: false },
    { id: 'pocket-tts', title: 'PocketTTS (voice cloning)', speakers: [], clones: true, needsReferenceText: false },
    { id: 'zipvoice', title: 'ZipVoice (voice cloning)', speakers: [], clones: true, needsReferenceText: true },
  ];
  const mine: MyVoice[] = [
    { id: 'v1', name: 'Grandpa', model: 'pocket-tts', reference: 'Audio/g.wav', created: 1 },
    { id: 'v2', name: 'Half done', model: 'zipvoice', reference: 'Audio/h.wav', created: 2 },
    { id: 'v3', name: 'Gone', model: 'f5', reference: 'Audio/x.wav', created: 3 },
  ];
  const opts = voiceOptions(models, mine);
  test('yours first, then every built-in speaker; cloning models are not speakers', () => {
    expect(opts.map((o) => o.id)).toEqual(['v1', 'v2', 'v3', 'preset:kokoro:0', 'preset:kokoro:1']);
    expect(opts[3].name).toBe('Alloy · US English, female');
    expect(opts[0]).toMatchObject({ ready: true, model: 'pocket-tts', reference: 'Audio/g.wav', detail: 'Your voice · PocketTTS' });
  });
  test('voices that cannot speak say why, and are never picked', () => {
    expect(opts[1].why).toMatch(/words spoken/);
    expect(opts[2].why).toMatch(/isn’t downloaded/);
    expect(pickVoice(opts, 'v2')!.id).toBe('v1');
    expect(pickVoice(opts, 'preset:kokoro:1')!.id).toBe('preset:kokoro:1');
    expect(pickVoice([], 'x')).toBeNull();
  });
});

describe('effects', () => {
  test('presets are recognised, neutral settings are skipped', () => {
    expect(effectsNeutral({})).toBe(true);
    expect(effectsNeutral({ room: 0.2 })).toBe(false);
    expect(presetOf(withEffects(EFFECT_PRESETS.find((p) => p.id === 'phone')!.fx))).toBe('phone');
    expect(presetOf({ ...NO_EFFECTS, room: 0.33 })).toBeNull();
    expect(presetOf({})).toBe('none');
    expect(pitchRate(12)).toBeCloseTo(2);
    expect(pitchRate(-12)).toBeCloseTo(0.5);
  });
});

describe('stories', () => {
  test('a script becomes lines with speakers and voices', () => {
    const s = 'Narrator: It was night.\n\nAna: Hello?\nStill Ana here.\nleo: Hi!\nSee https://x.y';
    expect(scriptSpeakers(s)).toEqual(['Narrator', 'Ana', 'leo']);
    expect(parseScript(s, { narrator: 'n', ANA: 'a' }, 'f')).toEqual([
      { speaker: 'Narrator', voice: 'n', text: 'It was night.' },
      { speaker: 'Ana', voice: 'a', text: 'Hello?' },
      { speaker: 'Ana', voice: 'a', text: 'Still Ana here.' },
      { speaker: 'leo', voice: 'f', text: 'Hi!' },
      { speaker: 'leo', voice: 'f', text: 'See https://x.y' },
    ]);
  });
  test('lines follow each other with the gap; fixed starts and other tracks overlap', () => {
    const items = [
      { id: 'a', voice: 'x', text: '', duration: 2, track: 0, start: null, gain: 1 },
      { id: 'b', voice: 'x', text: '', duration: 1, track: 0, start: null, gain: 1 },
      { id: 'c', voice: 'x', text: '', duration: 3, track: 1, start: 0.5, gain: 1 },
      { id: 'd', voice: 'x', text: '', track: 0, start: null, gain: 1 },
    ];
    expect(layoutStory({ items, gap: 0.5 })).toEqual([
      { id: 'a', start: 0, end: 2, track: 0 }, { id: 'b', start: 2.5, end: 3.5, track: 0 }, { id: 'c', start: 0.5, end: 3.5, track: 1 }, { id: 'd', start: 4, end: 4, track: 0 },
    ]);
    expect(storyLength({ items, gap: 0.5 })).toBe(4);
  });
});

describe('long texts', () => {
  test('split at sentences, never over the limit, nothing lost', () => {
    const t = 'One. Two two! Three three three? ' + 'x'.repeat(30);
    const parts = chunkText(t, 20);
    expect(parts.every((p) => p.length <= 20)).toBe(true);
    expect(parts.join(' ').replace(/\s+/g, '')).toBe(t.replace(/\s+/g, ''));
    expect(chunkText('  short  ')).toEqual(['short']);
    expect(chunkText('   ')).toEqual([]);
  });
});
