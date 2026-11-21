// "Made with Lotus" tag inside WAV files (0.17.0). Every voice clip, story or read-aloud file that
// Lotus makes gets a standard RIFF LIST/INFO chunk, which audio players and editors show as the
// file's software and comment. It doesn't change the sound. Pure (no DOM, no Node): used by the app
// (voice/render.ts, exports) and by the core (engines/rpc.ts) when it saves speech.

export const LOTUS_TAG = { ISFT: 'Lotus', ICMT: 'Made with Lotus (AI-generated voice)' } as const;

const ascii = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0) & 0x7f));
const fourcc = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

/** The LIST/INFO chunk for `info` (each value NUL-terminated and padded to an even length). */
function infoChunk(info: Record<string, string>): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const [id, value] of Object.entries(info)) {
    const text = ascii(value);
    const size = text.length + 1;
    const sub = new Uint8Array(8 + size + (size & 1));
    sub.set(ascii(id.padEnd(4).slice(0, 4)), 0);
    new DataView(sub.buffer).setUint32(4, size, true);
    sub.set(text, 8);
    parts.push(sub);
  }
  const body = 4 + parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(8 + body);
  out.set(ascii('LIST'), 0);
  new DataView(out.buffer).setUint32(4, body, true);
  out.set(ascii('INFO'), 8);
  let o = 12;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** The INFO fields of a WAV file ({} when it has none or isn't a WAV). */
export function readWavInfo(bytes: Uint8Array): Record<string, string> {
  const found: Record<string, string> = {};
  if (bytes.length < 12 || fourcc(bytes, 0) !== 'RIFF' || fourcc(bytes, 8) !== 'WAVE') return found;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let o = 12; o + 8 <= bytes.length;) {
    const id = fourcc(bytes, o);
    const size = v.getUint32(o + 4, true);
    if (id === 'LIST' && o + 12 <= bytes.length && fourcc(bytes, o + 8) === 'INFO') {
      const end = Math.min(bytes.length, o + 8 + size);
      for (let p = o + 12; p + 8 <= end;) {
        const sid = fourcc(bytes, p);
        const ssize = v.getUint32(p + 4, true);
        const raw = bytes.subarray(p + 8, Math.min(end, p + 8 + ssize));
        found[sid] = String.fromCharCode(...raw).replace(/\0+$/, '');
        p += 8 + ssize + (ssize & 1);
      }
    }
    o += 8 + size + (size & 1);
  }
  return found;
}

/**
 * The same WAV with Lotus's INFO chunk placed before its audio data. Anything that isn't a plain
 * RIFF/WAVE file, or a file already tagged by Lotus, comes back unchanged.
 */
export function tagWav(bytes: Uint8Array, info: Record<string, string> = LOTUS_TAG): Uint8Array {
  if (bytes.length < 12 || fourcc(bytes, 0) !== 'RIFF' || fourcc(bytes, 8) !== 'WAVE') return bytes;
  if (readWavInfo(bytes).ISFT === info.ISFT) return bytes;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = -1;
  for (let o = 12; o + 8 <= bytes.length;) {
    if (fourcc(bytes, o) === 'data') { at = o; break; }
    const size = v.getUint32(o + 4, true);
    o += 8 + size + (size & 1);
  }
  if (at < 0) return bytes;
  const chunk = infoChunk(info);
  const out = new Uint8Array(bytes.length + chunk.length);
  out.set(bytes.subarray(0, at), 0);
  out.set(chunk, at);
  out.set(bytes.subarray(at), at + chunk.length);
  new DataView(out.buffer).setUint32(4, out.length - 8, true);
  return out;
}

/** tagWav for a Blob (the app's audio is mostly Blobs). Non-WAV blobs come back as they were. */
export async function tagWavBlob(blob: Blob): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const tagged = tagWav(bytes);
  return tagged === bytes ? blob : new Blob([tagged as Uint8Array<ArrayBuffer>], { type: blob.type || 'audio/wav' });
}
