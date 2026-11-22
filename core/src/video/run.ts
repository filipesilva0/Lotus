// Runs ffmpeg and ffprobe for the video tools (0.21). See video/ffmpeg.ts for the commands.

import { parseProbe, probeArgs, progressSeconds, renderArgs, usableEncoders, type Encoder, type RenderPlan, type VideoInfo } from './ffmpeg';

export interface VideoTools { ffmpeg: string; ffprobe: string | null }

/** Runs a program; rejects with the last lines it printed when it fails. */
export async function runProgram(exe: string, args: string[], o: { signal?: AbortSignal; onLine?: (line: string) => void } = {}): Promise<{ stdout: string; stderr: string }> {
  const p = Bun.spawn([exe, ...args], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', windowsHide: true });
  const kill = () => { try { p.kill(); } catch { /* gone */ } };
  o.signal?.addEventListener('abort', kill, { once: true });
  let stderr = '';
  const readErr = (async () => {
    const dec = new TextDecoder();
    for await (const chunk of p.stderr as unknown as AsyncIterable<Uint8Array>) {
      const s = dec.decode(chunk, { stream: true });
      stderr = (stderr + s).slice(-20000);
      if (o.onLine) for (const l of s.split(/[\r\n]+/)) if (l.trim()) o.onLine(l);
    }
  })();
  const stdout = await new Response(p.stdout).text();
  await readErr;
  const code = await p.exited;
  o.signal?.removeEventListener('abort', kill);
  if (o.signal?.aborted) throw new DOMException('Stopped', 'AbortError');
  if (code !== 0) {
    const why = stderr.split('\n').map((l) => l.trim()).filter((l) => l && !/^frame=|^size=/.test(l)).slice(-3).join(' ');
    throw new Error(why || `${exe.split(/[\\/]/).pop()} stopped with code ${code}.`);
  }
  return { stdout, stderr };
}

/** Length, size and sound of a video or picture. Uses ffprobe, or ffmpeg's own report without it. */
export async function probe(t: VideoTools, file: string, signal?: AbortSignal): Promise<VideoInfo> {
  if (t.ffprobe) {
    const { stdout } = await runProgram(t.ffprobe, probeArgs(file), { signal });
    return parseProbe(JSON.parse(stdout || '{}'));
  }
  // ffmpeg -i prints the streams and exits with an error (no output given); read what it printed.
  const p = Bun.spawn([t.ffmpeg, '-hide_banner', '-i', file], { stdout: 'ignore', stderr: 'pipe', windowsHide: true });
  const err = await new Response(p.stderr).text();
  await p.exited;
  const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err);
  const v = /Stream #.*Video:.*?(\d{2,5})x(\d{2,5})/.exec(err);
  const fps = /(\d+(?:\.\d+)?) fps/.exec(err);
  return { duration: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0, width: v ? Number(v[1]) : 0, height: v ? Number(v[2]) : 0, fps: fps ? Number(fps[1]) : 0, hasVideo: !!v, hasAudio: /Stream #.*Audio:/.test(err) };
}

const encoderCache = new Map<string, Encoder[]>();
/** The encoders this ffmpeg has, best first (asked once per ffmpeg). */
export async function encodersOf(ffmpeg: string): Promise<Encoder[]> {
  const hit = encoderCache.get(ffmpeg);
  if (hit) return hit;
  const { stdout } = await runProgram(ffmpeg, ['-hide_banner', '-encoders']);
  const list = usableEncoders(stdout);
  encoderCache.set(ffmpeg, list);
  return list;
}

/**
 * Renders a plan with the best encoder that works. A hardware encoder can be listed and still fail
 * (an old driver, another program using it), so Lotus tries the next one.
 */
export async function render(t: VideoTools, plan: Omit<RenderPlan, 'encoder' | 'out'> & { out: (container: 'mp4' | 'webm') => string }, o: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void; prefer?: string } = {}): Promise<{ file: string; encoder: string }> {
  let list = await encodersOf(t.ffmpeg);
  if (o.prefer) list = [...list.filter((e) => e.name === o.prefer), ...list.filter((e) => e.name !== o.prefer)];
  if (!list.length) throw new Error('This FFmpeg can\'t make videos (it has no video encoder Lotus knows). Install Lotus\'s FFmpeg in Settings → Models.');
  const total = plan.scenes.reduce((s, x) => s + x.duration, 0);
  const errors: string[] = [];
  for (const enc of list.slice(0, 4)) {
    const file = plan.out(enc.container);
    try {
      await runProgram(t.ffmpeg, renderArgs({ ...plan, encoder: enc, out: file }), { signal: o.signal, onLine: (l) => { const s = progressSeconds(l); if (s !== null) o.onProgress?.(Math.min(s, total), total); } });
      return { file, encoder: enc.name };
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      errors.push(`${enc.name}: ${(e as Error).message}`);
    }
  }
  throw new Error(`FFmpeg couldn't make the video. ${errors.join(' · ').slice(0, 600)}`);
}
