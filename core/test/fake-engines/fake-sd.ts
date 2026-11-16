// A stand-in for sd-cli: prints progress like the real one and writes a tiny PNG per image to -o.
import { writeFileSync } from 'node:fs';
const a = process.argv.slice(2);
// Like current sd-cli builds (since July 2026), the help lists --auto-fit and --max-vram.
if (a.includes('--help')) { process.stdout.write('usage: sd-cli [options]\n  --max-vram <string>\n  --auto-fit on|off\n  --offload-to-cpu\n'); process.exit(0); }
const val = (n: string) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
const out = val('-o')!;
const n = Number(val('-b') ?? 1);
const steps = Number(val('--steps') ?? 4);
if (process.env.FAKE_LOG) writeFileSync(process.env.FAKE_LOG, JSON.stringify(a));
for (let s = 1; s <= steps; s++) process.stdout.write(`  |${'='.repeat(s)}>   | ${s}/${steps} - 0.10s/it\r`);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
for (let i = 0; i < n; i++) writeFileSync(i === 0 ? out : out.replace(/\.png$/, `_${i + 1}.png`), png);
process.stdout.write('\nsave result image to done\n');
