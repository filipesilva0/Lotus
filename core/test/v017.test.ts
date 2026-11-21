// 0.17.0: licence and voice safety. The "Made with Lotus" WAV tag, model licence badges, the voice
// consent rule, and what crash reports / Copy diagnostics may contain.
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { LOTUS_TAG, readWavInfo, tagWav } from '../../src/lib/wavTag';
import { LIBRARY, licenceUse } from '../../src/models/library';
import { canCloneVoice, VOICE_CONSENT } from '../../src/voice/studio';
import { buildDiagnostics, crashIssueUrl, redact } from '../../src/lib/diagnosticsText';

const ROOT = join(import.meta.dir, '..', '..');

/** A tiny 16-bit mono WAV, written the way encodeWav does. */
function wav(samples: number[], rate = 16000): Uint8Array {
  const data = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(data.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => v.setInt16(44 + i * 2, s, true));
  return data;
}
const dataOf = (b: Uint8Array) => {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let o = 12; o + 8 <= b.length;) {
    const id = String.fromCharCode(...b.subarray(o, o + 4)); const size = v.getUint32(o + 4, true);
    if (id === 'data') return b.subarray(o + 8, o + 8 + size);
    o += 8 + size + (size & 1);
  }
  return null;
};

describe('Made with Lotus tag', () => {
  test('adds INFO fields before the audio and keeps the sound and sizes right', () => {
    const plain = wav([0, 1000, -1000, 32767, -32768]);
    const tagged = tagWav(plain);
    expect(tagged.length).toBeGreaterThan(plain.length);
    expect(readWavInfo(tagged)).toEqual({ ...LOTUS_TAG });
    expect(new DataView(tagged.buffer).getUint32(4, true)).toBe(tagged.length - 8);
    expect([...dataOf(tagged)!]).toEqual([...dataOf(plain)!]);
    expect(String.fromCharCode(...tagged.subarray(0, 4))).toBe('RIFF');
  });
  test('tagging twice does nothing more, and other files are left alone', () => {
    const once = tagWav(wav([1, 2, 3]));
    expect(tagWav(once)).toBe(once);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(tagWav(png)).toBe(png);
    expect(readWavInfo(png)).toEqual({});
  });
  test('odd-length text is padded so later chunks stay aligned', () => {
    const t = tagWav(wav([5, 6]), { ISFT: 'abc', ICMT: 'odd' });
    expect(readWavInfo(t)).toEqual({ ISFT: 'abc', ICMT: 'odd' });
    expect([...dataOf(t)!]).toEqual([...dataOf(wav([5, 6]))!]);
  });
});

describe('model licences', () => {
  test('reads what a licence allows', () => {
    expect(licenceUse('FLUX Non-Commercial')).toBe('non-commercial');
    expect(licenceUse('CC-BY-NC-4.0')).toBe('non-commercial');
    expect(licenceUse('CreativeML Open RAIL++-M')).toBe('limits');
    expect(licenceUse('Llama 3.2 licence')).toBe('limits');
    expect(licenceUse('Varies by voice')).toBe('varies');
    for (const l of ['Apache-2.0', 'MIT', 'NVIDIA Open Model', 'OpenMDW-1.1', 'MIT code, CC-BY-4.0 weights']) expect(licenceUse(l)).toBe('open');
  });
  test('FLUX.2 Klein 9B shows the Non-commercial badge, and every model names its licence', () => {
    expect(licenceUse(LIBRARY.find((e) => e.id === 'flux2-klein-9b-q4')!.licence)).toBe('non-commercial');
    for (const e of LIBRARY) expect(e.licence.trim().length).toBeGreaterThan(1);
    // Anything tagged non-commercial must also get the badge.
    for (const e of LIBRARY.filter((x) => x.tags.some((t) => /non-commercial/i.test(t)))) expect(licenceUse(e.licence)).toBe('non-commercial');
  });
});

describe('voice consent', () => {
  test('a voice is copied only with a recording and the promise ticked', () => {
    expect(canCloneVoice({ hasSample: true, consent: false })).toBe(false);
    expect(canCloneVoice({ hasSample: false, consent: true })).toBe(false);
    expect(canCloneVoice({ hasSample: true, consent: true })).toBe(true);
    expect(VOICE_CONSENT).toMatch(/my voice.*permission/i);
  });
  test('no voice presets named after real or famous people', () => {
    const famous = /obama|trump|biden|morgan freeman|taylor swift|elon|attenborough|scarlett|celebrity/i;
    for (const e of LIBRARY.filter((x) => x.kind === 'voice')) expect(`${e.title} ${e.blurb}`).not.toMatch(famous);
  });
});

describe('diagnostics and crash reports', () => {
  test('redact cuts user names, e-mail addresses and keys', () => {
    expect(redact('C:\\Users\\Ana\\Desktop\\Lotus Studio\\x.gguf')).toBe('C:\\Users\\…\\Desktop\\Lotus Studio\\x.gguf');
    expect(redact('/home/ana/.lotus and /Users/bob/Library')).toBe('/home/…/.lotus and /Users/…/Library');
    expect(redact('mail me at someone@example.com')).toBe('mail me at [email]');
    expect(redact('Authorization: Bearer abcdefghijklmnop')).toContain('[hidden]');
    expect(redact('key sk-abcdefghijklmnopqrstuvwxyz')).not.toContain('abcdefghijklmnop');
  });
  test('the report holds facts and errors, never content', () => {
    const text = buildDiagnostics({
      appVersion: '0.17.0', coreVersion: '1.2.3', os: 'windows', arch: 'x64', gpu: 'NVIDIA GeForce RTX 4060', vramGb: 8, ramGb: 32,
      engines: [{ name: 'llama.cpp', version: 'b7000', flavour: 'cuda', installed: true }, { name: 'sherpa-onnx', version: null, installed: false }],
      models: [{ title: 'Qwen 3.5 4B', kind: 'chat' }, { title: 'my-secret-finetune.gguf', kind: 'chat', custom: true }],
      chatEngine: 'builtin', errors: [{ at: 0, where: 'window', message: 'Cannot read x of C:\\Users\\Ana\\Lotus Studio', stack: 'at f (C:\\Users\\Ana\\app.js:1)' }],
      now: new Date(0),
    });
    expect(text).toContain('0.17.0');
    expect(text).toContain('RTX 4060, 8 GB');
    expect(text).toContain('llama.cpp: b7000 (cuda)');
    expect(text).toContain('sherpa-onnx: not installed');
    expect(text).toContain('Qwen 3.5 4B (chat)');
    expect(text).toContain('1 added by link');
    expect(text).not.toContain('my-secret-finetune');
    expect(text).not.toContain('Ana');
  });
  test('the issue link opens a filled-in GitHub issue and stays short enough', () => {
    const url = crashIssueUrl('x'.repeat(20000));
    expect(url.startsWith('https://github.com/filipesilva0/Lotus/issues/new?')).toBe(true);
    expect(decodeURIComponent(url).length).toBeLessThan(6500);
    expect(new URL(url).searchParams.get('body')).toContain('(cut to fit)');
  });
});

describe('licence files', () => {
  test('one FSL licence, and the old MIT/Apache markers are gone', () => {
    expect(readFileSync(join(ROOT, 'LICENSE'), 'utf8')).toContain('FSL-1.1-ALv2');
    expect(readFileSync(join(ROOT, 'src-tauri', 'Cargo.toml'), 'utf8')).not.toMatch(/license\s*=\s*"MIT"/);
    expect(readFileSync(join(ROOT, 'src', 'App.tsx'), 'utf8')).not.toContain('Apache-2.0');
    for (const f of ['TERMS.md', 'PRIVACY.md', 'engine-licences.md']) expect(existsSync(join(ROOT, 'docs', 'legal', f))).toBe(true);
  });
  test('no Coucou artwork or sounds ship with Lotus', () => {
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
    const shipped = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'src-tauri', 'icons')), ...walk(join(ROOT, 'docs', 'assets'))];
    expect(shipped.filter((p) => /\.(mp3|wav|ogg|m4a|aiff?)$/i.test(p))).toEqual([]);
    expect(shipped.filter((p) => /coucou|mochi/i.test(p))).toEqual([]);
  });
});
