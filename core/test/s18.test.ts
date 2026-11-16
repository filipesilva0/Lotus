// 0.8.2: the Voice page with Lotus's own engine does everything Voicebox did: voice cloning
// (PocketTTS, ZipVoice), your voices, effects settings, stories from scripts, long texts in parts.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Builtins, failureLines, needsShortPath } from '../src/engines/manager';
import { filesEdit } from '../src/tools/files';
import { RETHINK_CHOICES, canRethink, draftLabel, rethinkRequest, rethinkRounds } from '../../src/chat/rethink';
import { readFileSync } from 'node:fs';
import { entryById } from '../../src/models/library';
import {
  EFFECT_PRESETS, NO_EFFECTS, TRANSCRIPT_ACTIONS, chunkText, clock, splitPoints, toSrt, transcriptText, effectsNeutral, layoutStory, parseScript, pickVoice, pitchRate, presetOf, scriptSpeakers, storyLength, voiceOptions, withEffects,
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

describe('speech to text for long recordings', () => {
  // 70 s at 1 kHz: speech everywhere except short silences at 22 s and 47 s.
  const rate = 1000, n = 70 * rate;
  const samples = new Float32Array(n).map((_, i) => (Math.abs(i / rate - 22) < 0.3 || Math.abs(i / rate - 47) < 0.3 ? 0 : Math.sin(i) * 0.5));
  test('cuts at the quiet moments, never longer than Whisper can hear', () => {
    const cuts = splitPoints(samples, rate);
    expect(cuts.at(-1)).toBe(n);
    expect(Math.abs(cuts[0] / rate - 22)).toBeLessThan(0.35);
    expect(Math.abs(cuts[1] / rate - 47)).toBeLessThan(0.35);
    let prev = 0;
    for (const c of cuts) { expect((c - prev) / rate).toBeLessThanOrEqual(28); prev = c; }
  });
  test('short audio is one part; silence everywhere still splits under the limit', () => {
    expect(splitPoints(new Float32Array(20 * rate), rate)).toEqual([20 * rate]);
    const cuts = splitPoints(new Float32Array(100 * rate), rate);
    let prev = 0;
    for (const c of cuts) { expect((c - prev) / rate).toBeLessThanOrEqual(28); expect((c - prev) / rate).toBeGreaterThan(0); prev = c; }
  });
  test('times, plain text and subtitles', () => {
    const segs = [{ start: 0, end: 21.5, text: ' Hello there. ' }, { start: 21.5, end: 3725.25, text: 'Bye.' }, { start: 3725.25, end: 3726, text: '' }];
    expect(clock(75.9)).toBe('1:15');
    expect(clock(3725)).toBe('1:02:05');
    expect(transcriptText(segs)).toBe('Hello there. Bye.');
    expect(transcriptText(segs, true)).toBe('[0:00] Hello there.\n[0:21] Bye.');
    expect(toSrt(segs)).toBe('1\n00:00:00,000 --> 00:00:21,500\nHello there.\n\n2\n00:00:21,500 --> 01:02:05,250\nBye.\n');
  });
  test('every Open in Chat action asks something, except Ask About It', () => {
    expect(TRANSCRIPT_ACTIONS.filter((a) => !a.prompt).map((a) => a.id)).toEqual(['ask']);
  });
});

describe('sherpa-onnx errors and Windows paths (0.9.1)', () => {
  test('the cause is shown, not only the last line', () => {
    const out = [
      'D:\\a\\sherpa-onnx\\sherpa-onnx\\sherpa-onnx/csrc/piper-phonemize-lexicon.cc:ConvertTextToTokenIdsVits:77 Failed to phonemize with espeak-ng voice \'pt\': voice not found',
      'D:\\a\\sherpa-onnx\\sherpa-onnx\\sherpa-onnx/csrc/offline-tts-vits-impl.h:Generate:112 Failed to convert \'bom dia\' to token IDs',
      'Error in generating audio. Please read previous error messages.',
      'num threads: 4',
    ].join('\n');
    const msg = failureLines(out);
    expect(msg).toContain("Failed to phonemize with espeak-ng voice 'pt': voice not found");
    expect(msg).not.toContain('D:\\a\\sherpa-onnx');
    expect(msg).not.toContain('num threads');
    expect(failureLines('just one line')).toBe('just one line');
  });
  test('short paths only for folders with spaces or accents', () => {
    expect(needsShortPath('C:\\Users\\Ana\\Documents\\Lotus Studio\\Models')).toBe(true);
    expect(needsShortPath('C:\\Users\\João\\Documents')).toBe(true);
    expect(needsShortPath('C:\\Users\\ANA~1\\DOCUME~1\\LOTUSS~1')).toBe(false);
  });
});

describe('files.edit (0.9.1)', () => {
  const root = tmp();
  const ctx = { folders: [root] } as never;
  test('changes one exact passage and keeps the rest', async () => {
    writeFileSync(join(root, 'g.txt'), 'oat milk\napples\neggs\n');
    const r = await filesEdit.run({ path: 'g.txt', find: 'apples', replace: 'pears' }, ctx);
    expect(r.ok).toBe(true);
    expect(readFileSync(join(root, 'g.txt'), 'utf8')).toBe('oat milk\npears\neggs\n');
  });
  test('Windows line endings still match a passage written with \\n', async () => {
    writeFileSync(join(root, 'w.md'), '# Title\r\nline one\r\nline two\r\n');
    expect((await filesEdit.run({ path: 'w.md', find: 'line one\nline two', replace: 'only line' }, ctx)).ok).toBe(true);
    expect(readFileSync(join(root, 'w.md'), 'utf8')).toBe('# Title\r\nonly line\r\n');
  });
  test('refuses missing, repeated or outside passages with a way forward', async () => {
    writeFileSync(join(root, 'r.txt'), 'a b a');
    expect((await filesEdit.run({ path: 'r.txt', find: 'zzz', replace: 'x' }, ctx)).text).toMatch(/isn't in r.txt/);
    expect((await filesEdit.run({ path: 'r.txt', find: 'a', replace: 'x' }, ctx)).text).toMatch(/appears 2 times/);
    expect((await filesEdit.run({ path: 'r.txt', find: 'a', replace: 'x', all: true }, ctx)).ok).toBe(true);
    expect(readFileSync(join(root, 'r.txt'), 'utf8')).toBe('x b x');
    expect((await filesEdit.run({ path: '/etc/hostname', find: 'a', replace: 'b' }, ctx)).ok).toBe(false);
    expect((await filesEdit.run({ path: 'nope.txt', find: 'a', replace: 'b' }, ctx)).text).toMatch(/isn't a file/);
  });
  test('replacement text with $ signs is kept as written', async () => {
    writeFileSync(join(root, 'p.txt'), 'price: X');
    await filesEdit.run({ path: 'p.txt', find: 'X', replace: '$& $1 $$' }, ctx);
    expect(readFileSync(join(root, 'p.txt'), 'utf8')).toBe('price: $& $1 $$');
  });
});

describe('rethink for Nemotron (0.9.1)', () => {
  test('only Nemotron models rethink, 1 to 4 answers', () => {
    expect(canRethink('nemotron-3-nano-4b')).toBe(true);
    expect(canRethink('qwen3-8b')).toBe(false);
    expect(rethinkRounds('qwen3-8b', 3)).toBe(1);
    expect(rethinkRounds('Nemotron 3 Nano', 3)).toBe(3);
    expect(rethinkRounds('nemotron', 9)).toBe(4);
    expect(rethinkRounds('nemotron', undefined)).toBe(1);
    expect(RETHINK_CHOICES.map((c) => c.rounds)).toEqual([1, 2, 3, 4]);
  });
  test('each request says which review it is, and the last is final', () => {
    expect(rethinkRequest(2, 4)).toMatch(/review 1 of 3/);
    expect(rethinkRequest(2, 4)).not.toMatch(/final version/);
    expect(rethinkRequest(4, 4)).toMatch(/review 3 of 3.*final version/);
    expect(rethinkRequest(3, 3)).toMatch(/do not mention this review/);
  });
  test('earlier versions are labelled', () => {
    expect([0, 1, 2].map((i) => draftLabel(i, 4))).toEqual(['First answer', 'Rethink 1 of 3', 'Rethink 2 of 3']);
  });
});
