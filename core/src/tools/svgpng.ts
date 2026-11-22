// SVG to PNG (0.21, logo design skill): turns an SVG artifact into PNG files at exact sizes, plus an
// optional favicon.ico, in the same work folder. Lotus had no way to do this before: artifact.write
// saves text only, and browser.screenshot captures a whole page.
//
// It runs the user's Chrome or Edge headless (the same browsers browser.* finds), with a throwaway
// profile and no network, once for all sizes: a small page draws the SVG onto a canvas at each size
// and prints the PNGs, which Chrome hands back with --dump-dom. No new dependency.
//
//   artifact.png   filename (an .svg artifact), sizes [16, 32, …], padding %, background, favicon

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Tool } from '../agent/types';
import { chromeCandidates } from './browser';
import { listArtifacts, safeName } from './work';

export const PNG_MIN = 8;
export const PNG_MAX = 2048;
const MARK = 'LOTUS_PNG_OUT:';

/** Sizes a model sent ("16, 32", [16,"32"], 300.4) → whole, unique, in range, small to large. */
export function cleanSizes(raw: unknown): number[] {
  const list = Array.isArray(raw) ? raw : String(raw ?? '').split(/[^0-9.]+/);
  const out = new Set<number>();
  for (const v of list) {
    const n = Math.round(Number(v));
    if (Number.isFinite(n) && n >= PNG_MIN && n <= PNG_MAX) out.add(n);
  }
  return [...out].sort((a, b) => a - b).slice(0, 24);
}

/** Width ÷ height of an SVG, from its viewBox or width/height (1 when unknown). */
export function svgAspect(svg: string): number {
  const tag = svg.match(/<svg\b[^>]*>/i)?.[0] ?? '';
  const vb = tag.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (vb && Number(vb[1]) > 0 && Number(vb[2]) > 0) return Number(vb[1]) / Number(vb[2]);
  const w = Number(tag.match(/\bwidth\s*=\s*["']\s*([\d.]+)/i)?.[1]);
  const h = Number(tag.match(/\bheight\s*=\s*["']\s*([\d.]+)/i)?.[1]);
  return w > 0 && h > 0 ? w / h : 1;
}

/** An SVG a browser will load as an image: it needs the SVG namespace. */
export function loadableSvg(svg: string): string {
  return /<svg\b[^>]*\bxmlns\s*=/i.test(svg) ? svg : svg.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
}

export interface DrawOpts { padding?: number; background?: string }

/** The page Chrome runs: each size is a square PNG with the SVG centred and fitted inside the padding. */
export function rasterPage(svg: string, sizes: number[], o: DrawOpts = {}): string {
  const ratio = svgAspect(svg);
  const pad = Math.min(40, Math.max(0, Number(o.padding) || 0)) / 100;
  const bg = /^#[0-9a-f]{3,8}$/i.test(o.background ?? '') ? o.background! : '';
  const b64 = Buffer.from(loadableSvg(svg), 'utf8').toString('base64');
  return `<!doctype html><meta charset="utf-8"><body><script>
const sizes = ${JSON.stringify(sizes)}, ratio = ${ratio}, pad = ${pad}, bg = ${JSON.stringify(bg)};
const done = (o) => { const p = document.createElement('pre'); p.textContent = ['LOTUS', 'PNG', 'OUT:'].join('_') + JSON.stringify(o); document.body.appendChild(p); };
const img = new Image();
img.onload = () => {
  const out = {};
  for (const s of sizes) {
    const c = document.createElement('canvas'); c.width = c.height = s;
    const x = c.getContext('2d');
    if (bg) { x.fillStyle = bg; x.fillRect(0, 0, s, s); }
    const box = s * (1 - 2 * pad);
    const w = ratio >= 1 ? box : box * ratio, h = ratio >= 1 ? box / ratio : box;
    x.drawImage(img, (s - w) / 2, (s - h) / 2, w, h);
    out[s] = c.toDataURL('image/png').split(',')[1];
  }
  done(out);
};
img.onerror = () => done({ error: 'The SVG could not be drawn. Check it is a complete, valid <svg> file.' });
img.src = 'data:image/svg+xml;base64,${b64}';
</script>`;
}

/** Reads Chrome's --dump-dom output back into PNG bytes per size. */
export function parseRasterOutput(dom: string): Map<number, Uint8Array> {
  const i = dom.lastIndexOf(MARK);
  if (i < 0) throw new Error('The browser did not draw the SVG (it may have timed out).');
  const json = dom.slice(i + MARK.length).split('<')[0].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const o = JSON.parse(json) as Record<string, string>;
  if (o.error) throw new Error(o.error);
  return new Map(Object.entries(o).map(([k, v]) => [Number(k), new Uint8Array(Buffer.from(v, 'base64'))]));
}

/** A .ico file holding PNG images (Windows Vista+ and every current browser read these). */
export function buildIco(pngs: { size: number; png: Uint8Array }[]): Uint8Array {
  const head = 6 + 16 * pngs.length;
  const out = new Uint8Array(head + pngs.reduce((n, p) => n + p.png.length, 0));
  const v = new DataView(out.buffer);
  v.setUint16(2, 1, true); // type: icon
  v.setUint16(4, pngs.length, true);
  let off = head;
  pngs.forEach((p, i) => {
    const e = 6 + 16 * i;
    out[e] = p.size >= 256 ? 0 : p.size;
    out[e + 1] = p.size >= 256 ? 0 : p.size;
    v.setUint16(e + 4, 1, true); // colour planes
    v.setUint16(e + 6, 32, true); // bits per pixel
    v.setUint32(e + 8, p.png.length, true);
    v.setUint32(e + 12, off, true);
    out.set(p.png, off);
    off += p.png.length;
  });
  return out;
}

/** Runs Chrome/Edge headless on the page and returns its DOM. */
async function runHeadless(exe: string, html: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'lotus-svgpng-'));
  try {
    const page = join(dir, 'draw.html');
    writeFileSync(page, html, 'utf8');
    const args = [exe, '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
      `--user-data-dir=${join(dir, 'profile')}`, '--proxy-server=127.0.0.1:9', '--virtual-time-budget=10000', '--dump-dom', pathToFileURL(page).href];
    if (process.platform === 'linux' && process.getuid?.() === 0) args.splice(1, 0, '--no-sandbox');
    const p = Bun.spawn(args, { stdout: 'pipe', stderr: 'ignore' });
    const kill = setTimeout(() => p.kill(), 45_000);
    const dom = await new Response(p.stdout).text();
    clearTimeout(kill);
    await p.exited;
    return dom;
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows may hold the profile a moment */ }
  }
}

export interface ExportResult { files: string[]; favicon?: string }

/** Draws `svg` at each size into `dir` as <base>-<size>.png (and favicon.ico from 16/32/48). */
export async function exportPngs(svg: string, base: string, sizes: number[], dir: string, o: DrawOpts & { favicon?: boolean; exe?: string } = {}): Promise<ExportResult> {
  const exe = o.exe ?? chromeCandidates().find((p) => existsSync(p));
  if (!exe) throw new Error('Making PNGs needs Google Chrome or Microsoft Edge on this computer, and neither was found. The SVG files are ready; the user can open one in a browser or design app and export PNGs from there.');
  const want = cleanSizes([...sizes, ...(o.favicon ? [16, 32, 48] : [])]);
  const drawn = parseRasterOutput(await runHeadless(exe, rasterPage(svg, want, o)));
  mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  for (const s of cleanSizes(sizes)) {
    const png = drawn.get(s);
    if (!png) continue;
    const f = `${base}-${s}.png`;
    writeFileSync(join(dir, f), png);
    files.push(f);
  }
  let favicon: string | undefined;
  if (o.favicon) {
    const parts = [16, 32, 48].map((s) => ({ size: s, png: drawn.get(s)! })).filter((p) => p.png);
    writeFileSync(join(dir, 'favicon.ico'), buildIco(parts));
    favicon = 'favicon.ico';
  }
  return { files, favicon };
}

export const artifactPng: Tool = {
  name: 'artifact.png', label: 'Making PNG files', risk: 'write',
  description: 'Turn an .svg artifact you saved into square PNG files at exact pixel sizes (and a favicon.ico), saved next to it. Use for logos and icons after the SVG is final.',
  parameters: { type: 'object', properties: {
    filename: { type: 'string', description: 'The .svg artifact, e.g. logo.svg.' },
    sizes: { type: 'array', items: { type: 'integer' }, description: 'Pixel sizes, e.g. [16, 32, 64, 128, 256, 512].' },
    padding: { type: 'number', description: 'Empty space around the logo, in % of each side (0–40). Default 0.' },
    background: { type: 'string', description: 'Fill colour like #ffffff. Leave out for a transparent background.' },
    favicon: { type: 'boolean', description: 'Also make favicon.ico (16, 32 and 48 px inside).' },
  }, required: ['filename', 'sizes'] },
  describe: (a) => `Make PNGs of ${String(a.filename)}`,
  async run(a, ctx) {
    if (!ctx.workDir) return { ok: false, text: 'PNGs can only be made from artifacts in Work mode.', summary: 'Not in Work mode' };
    const file = safeName(String(a.filename ?? ''));
    const hit = file && listArtifacts(ctx.workDir).find((x) => x.file.toLowerCase() === file.toLowerCase());
    if (!hit || extname(hit.file).toLowerCase() !== '.svg') return { ok: false, text: `No .svg artifact called ${a.filename}. Save the SVG with artifact.write first.`, summary: 'SVG not found' };
    const sizes = cleanSizes(a.sizes);
    if (!sizes.length && !a.favicon) return { ok: false, text: `Give sizes between ${PNG_MIN} and ${PNG_MAX} pixels, e.g. [16, 32, 512].`, summary: 'No sizes' };
    const svg = readFileSync(join(ctx.workDir, hit.file), 'utf8');
    if (!/<svg\b/i.test(svg)) return { ok: false, text: `${hit.file} is not an SVG drawing.`, summary: 'Not an SVG' };
    try {
      const base = basename(hit.file, extname(hit.file));
      const r = await exportPngs(svg, base, sizes, ctx.workDir, { padding: Number(a.padding) || 0, background: a.background ? String(a.background) : undefined, favicon: !!a.favicon });
      const all = [...r.files, ...(r.favicon ? [r.favicon] : [])];
      return { ok: true, text: `Saved ${all.join(', ')} in the work folder.`, summary: `Made ${all.length} file${all.length === 1 ? '' : 's'} from ${hit.file}`, data: { files: all } };
    } catch (e) {
      return { ok: false, text: (e as Error).message, summary: 'PNG export failed' };
    }
  },
};
