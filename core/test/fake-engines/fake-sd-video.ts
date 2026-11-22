// A stand-in for sd-cli's video mode (-M vid_gen): prints sampling bars like the real one and writes
// a real little AVI (made with ffmpeg) to -o. Behaviour is set with environment variables:
//   FAKE_LOG        append each call's arguments (one JSON line per call)
//   FAKE_BUDGET     pixels × frames above which it fails like a card out of memory
//   FAKE_FFMPEG     the ffmpeg to make the clip with
//   FAKE_PNG=1      an older build: writes numbered PNG frames instead of an AVI
//   FAKE_HANG=1     prints one line, then says nothing for a long time
//   FAKE_OLD=1      a build from before video mode (its --help has no vid_gen)
import { appendFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const a = process.argv.slice(2);
if (a.includes('--help')) {
  process.stdout.write(process.env.FAKE_OLD ? 'usage: sd-cli [options]\n  --offload-to-cpu\n' : 'usage: sd-cli [options]\n  -M, --mode [img_gen, vid_gen, convert]\n  --video-frames <int>\n  --max-vram <string>\n  --auto-fit on|off\n  --offload-to-cpu\n  --temporal-tiling\n  --diffusion-fa\n');
  process.exit(0);
}
const val = (n: string) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, `${JSON.stringify(a)}\n`);
const w = Number(val('-W')), h = Number(val('-H')), frames = Number(val('--video-frames') ?? 1), steps = Number(val('--steps') ?? 4);
const out = val('-o')!;
if (process.env.FAKE_HANG) { process.stdout.write('loading\n'); await Bun.sleep(60_000); process.exit(0); }
const budget = Number(process.env.FAKE_BUDGET || 0);
if (budget && w * h * frames > budget) {
  process.stderr.write('[ERROR] ggml_backend_cuda_buffer_type_alloc_buffer: allocating 3120.00 MiB on device 0: cudaMalloc failed: out of memory\n[ERROR] failed to allocate compute buffer\n');
  process.exit(1);
}
for (let s = 1; s <= steps; s++) process.stdout.write(`  |${'='.repeat(s)}>   | ${s}/${steps} - 0.10s/it\r`);
const ffmpeg = process.env.FAKE_FFMPEG || 'ffmpeg';
const src = ['-f', 'lavfi', '-i', `testsrc=size=${w}x${h}:rate=16`, '-frames:v', String(frames)];
if (process.env.FAKE_PNG) {
  // Old builds: frames named like the output, numbered from 0.
  const r = Bun.spawnSync([ffmpeg, '-y', '-v', 'error', ...src, '-start_number', '0', join(dirname(out), 'clip_%d.png')]);
  if (r.exitCode !== 0) process.exit(2);
} else {
  const r = Bun.spawnSync([ffmpeg, '-y', '-v', 'error', ...src, '-c:v', 'mjpeg', '-q:v', '5', out]);
  if (r.exitCode !== 0) process.exit(2);
}
writeFileSync(join(dirname(out), 'done.txt'), 'ok');
process.stdout.write('\nsave result video to done\n');
