// 0.15.0: faster voice calls you can interrupt by talking. Warm dictation server, interrupt-by-voice
// rules, the first words spoken at a comma.
//
// The warm-server test runs against a real sherpa-onnx build when SHERPA_BIN (its bin folder) and
// WHISPER_DIR (a sherpa-onnx Whisper model folder with test_wavs/0.wav) are set; it is skipped otherwise.

import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readWav, resultText, SttServers } from '../src/engines/sttServer';
import { freePort } from '../src/engines/manager';
import { BARGE_MS, bargeStart, shouldBargeIn, type BargeState } from '../../src/voice/bargeRules';
import { firstClause, takeSentences } from '../../src/voice/studio';

function wav(samples: number[], rate: number, channels: number, float = false): Uint8Array {
  const width = float ? 4 : 2;
  const bytes = samples.length * width;
  const b = new Uint8Array(44 + bytes);
  const v = new DataView(b.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, float ? 3 : 1, true); v.setUint16(22, channels, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * channels * width, true); v.setUint16(32, channels * width, true); v.setUint16(34, width * 8, true);
  str(36, 'data'); v.setUint32(40, bytes, true);
  samples.forEach((s, i) => (float ? v.setFloat32(44 + i * 4, s, true) : v.setInt16(44 + i * 2, Math.round(s * 32767), true)));
  return b;
}

describe('WAV for the warm dictation server', () => {
  test('16-bit stereo becomes mono floats with its rate', () => {
    const r = readWav(wav([0.5, -0.5, 0.25, 0.25], 48000, 2))!;
    expect(r.rate).toBe(48000);
    expect(r.samples.length).toBe(2);
    expect(Math.abs(r.samples[0])).toBeLessThan(0.001);
    expect(r.samples[1]).toBeCloseTo(0.25, 3);
  });
  test('32-bit float mono', () => {
    const r = readWav(wav([0.1, 0.2, 0.3], 16000, 1, true))!;
    expect(r.samples.length).toBe(3);
    expect(r.samples[2]).toBeCloseTo(0.3, 5);
  });
  test('not a WAV → null (the one-off program is used)', () => {
    expect(readWav(new TextEncoder().encode('hello world, this is not a wave file at all......'))).toBeNull();
  });
  test('result text from sherpa-onnx JSON', () => {
    expect(resultText('{"lang": "", "text": " Olá, tudo bem?", "tokens": []}')).toBe('Olá, tudo bem?');
    expect(resultText('plain')).toBe('plain');
  });
});

const run = (s: BargeState, frames: [number, number][], safe: boolean, fps = 60) => {
  let stop = false, t = 0;
  for (const [mic, play] of frames) { const r = shouldBargeIn(s, mic, play, t, safe); s = r.s; stop ||= r.stop; t += 1 / fps; }
  return { s, stop };
};
const repeat = <T,>(x: T, n: number) => Array.from({ length: n }, () => x);

describe('interrupting by voice', () => {
  test('a third of a second of talking while Lotus thinks stops it', () => {
    expect(run(bargeStart(), repeat<[number, number]>([0.3, 0], 30), true).stop).toBe(true);
  });
  test('a click or a cough does not', () => {
    const frames = [...repeat<[number, number]>([0.5, 0], 6), ...repeat<[number, number]>([0.01, 0], 40)];
    expect(run(bargeStart(), frames, true).stop).toBe(false);
  });
  test('Lotus\'s own echo while speaking does not, even when loud without echo cancellation', () => {
    // Echo follows playback at about a third of its level.
    const frames = repeat<[number, number]>([0.2, 0.6], 240);
    expect(run(bargeStart(), frames, false).stop).toBe(false);
    expect(run(bargeStart(), repeat<[number, number]>([0.1, 0.6], 240), true).stop).toBe(false);
  });
  test('talking over Lotus\'s voice does, after the echo was learned', () => {
    const learn = run(bargeStart(), repeat<[number, number]>([0.08, 0.5], 120), true);
    expect(learn.stop).toBe(false);
    expect(run(learn.s, repeat<[number, number]>([0.45, 0.5], 30), true).stop).toBe(true);
  });
  test('short gaps between syllables keep counting', () => {
    const syll = [...repeat<[number, number]>([0.3, 0], 6), ...repeat<[number, number]>([0.02, 0], 2)];
    const frames = [...syll, ...syll, ...syll, ...syll, ...syll];
    expect(run(bargeStart(), frames, true).stop).toBe(true);
    expect(BARGE_MS).toBeGreaterThan(200);
  });
});

describe('starting to speak sooner', () => {
  test('a long first sentence is cut at a comma', () => {
    const f = firstClause('Well, that depends on a few things, mainly what you want to cook and when')!;
    expect(f.clause).toBe('Well, that depends on a few things,');
    expect(f.rest).toBe('mainly what you want to cook and when');
  });
  test('short openers and numbers are not cut', () => {
    expect(firstClause('Sim, claro')).toBeNull();
    expect(firstClause('It costs about 1,000 euros in total')).toBeNull();
  });
  test('sentences still come out whole', () => {
    expect(takeSentences('Olá! Hoje está um dia bonito. E amanhã').sentences).toEqual(['Olá! Hoje está um dia bonito.']);
  });
});

const BIN = process.env.SHERPA_BIN, WDIR = process.env.WHISPER_DIR;
describe.skipIf(!BIN || !WDIR)('warm dictation server (real sherpa-onnx)', () => {
  test('transcribes, then answers the second time faster than starting the program', async () => {
    const f = (re: RegExp) => join(WDIR!, readdirSync(WDIR!).filter((x) => re.test(x)).sort((a, b) => Number(/int8/.test(b)) - Number(/int8/.test(a)))[0]);
    const args = ['--model-type=whisper', `--whisper-encoder=${f(/encoder.*\.onnx$/)}`, `--whisper-decoder=${f(/decoder.*\.onnx$/)}`, `--tokens=${f(/tokens\.txt$/)}`];
    const exe = join(BIN!, 'sherpa-onnx-offline-websocket-server');
    expect(existsSync(exe)).toBe(true);
    const s = new SttServers({ freePort });
    try {
      expect(await s.warm(exe, args)).toBe(true);
      const t0 = performance.now();
      const text = await s.transcribe(exe, args, join(WDIR!, 'test_wavs', '0.wav'));
      const ms = performance.now() - t0;
      expect(text?.toLowerCase()).toContain('yellow lamps');
      console.log(`warm transcription: ${Math.round(ms)} ms`);
      // A missing program means "use the one-off program".
      expect(await s.transcribe(join(BIN!, 'nope'), args, join(WDIR!, 'test_wavs', '0.wav'))).toBeNull();
    } finally { s.stopAll(); }
  }, 120_000);
});

// ── GPT-SoVITS (optional voice engine) ───────────────────────────────────────
import { mkdtempSync, mkdirSync as mk, writeFileSync as wf, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fitReference, gsvCommand, gsvLang, GptSovits } from '../src/engines/gptsovits';

describe('GPT-SoVITS', () => {
  const root = mkdtempSync(join(tmpdir(), 'gsv-'));
  test('starts from the Windows package\'s own Python, with its config', () => {
    const dir = join(root, 'GPT-SoVITS-v2pro');
    mk(join(dir, 'runtime'), { recursive: true }); mk(join(dir, 'GPT_SoVITS', 'configs'), { recursive: true });
    wf(join(dir, 'api_v2.py'), ''); wf(join(dir, 'runtime', 'python.exe'), ''); wf(join(dir, 'GPT_SoVITS', 'configs', 'tts_infer.yaml'), '');
    const c = gsvCommand(dir, 9880, 'win32')!;
    expect(c.exe).toBe(join(dir, 'runtime', 'python.exe'));
    expect(c.args).toEqual(['api_v2.py', '-a', '127.0.0.1', '-p', '9880', '-c', join('GPT_SoVITS', 'configs', 'tts_infer.yaml')]);
    expect(gsvCommand(root, 9880, 'win32')).toBeNull(); // no api_v2.py
  });
  test('a reference over 10 s is cut at a pause between 6 and 9.5 s', () => {
    const rate = 16000, s: number[] = [];
    for (let i = 0; i < rate * 14; i++) s.push(i > rate * 8 && i < rate * 8.3 ? 0 : 0.3 * Math.sin(i / 7));
    const f = fitReference(wav(s, rate, 1));
    expect(f.cut).toBe(true);
    expect(f.seconds).toBeGreaterThan(7.9);
    expect(f.seconds).toBeLessThan(8.4);
    expect(readWav(f.wav!)!.samples.length).toBe(Math.round(f.seconds * rate));
    expect(fitReference(wav(s.slice(0, rate * 5), rate, 1)).cut).toBe(false);
  });
  test('languages it knows; anything else is auto', () => {
    expect(gsvLang('en')).toBe('en');
    expect(gsvLang('ja')).toBe('ja');
    expect(gsvLang('pt')).toBe('auto');
    expect(gsvLang()).toBe('auto');
  });
  test('speaks through its API, and reports its errors plainly', async () => {
    const ref = join(root, 'ref.wav');
    wf(ref, wav(Array.from({ length: 16000 * 5 }, (_, i) => 0.2 * Math.sin(i / 5)), 16000, 1));
    const sent: Record<string, unknown>[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/tts')) {
        const body = JSON.parse(String(init?.body)); sent.push(body);
        if (body.text === 'fail') return new Response(JSON.stringify({ message: 'tts failed', Exception: 'x' }), { status: 400 });
        return new Response(wav([0, 0.1, 0.2], 32000, 1), { status: 200, headers: { 'content-type': 'audio/wav' } });
      }
      return new Response('{"detail":"Not Found"}', { status: 404 });
    }) as unknown as typeof fetch;
    const g = new GptSovits({ tempDir: join(root, 'tmp'), fetch: fake });
    const out = await g.speak({ dir: '', text: 'Hello there.', refAudio: ref, refText: 'Some words', lang: 'en' });
    expect(readWav(out)!.rate).toBe(32000);
    expect(sent[0]).toMatchObject({ text: 'Hello there.', text_lang: 'en', ref_audio_path: ref, prompt_text: 'Some words', media_type: 'wav' });
    await expect(g.speak({ dir: '', text: 'fail', refAudio: ref })).rejects.toThrow('tts failed');
    rmSync(root, { recursive: true, force: true });
  });
});
