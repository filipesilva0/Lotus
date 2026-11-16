// 0.9.5: paste and drop several files and images everywhere; one folder per image generation with
// "Reference N" and "Output N" files; FLUX.2 takes several reference images.

import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db';
import { cleanDir, folderNameFrom, newImageFolder, resolveMedia, saveMedia } from '../src/media';
import { sdcppArgs, type ImageProfile } from '../../src/models/imageProfiles';
import { clipboardFiles, dragHasFiles, nameFiles, sortFiles } from '../../src/lib/fileKinds';

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'lotus-s19-')); dirs.push(d); return d; };
afterAll(() => dirs.forEach((d) => { try { rmSync(d, { recursive: true, force: true }); } catch { /* Windows */ } }));
const png = (n: number) => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, n]);

describe('one folder per generation', () => {
  test('folder names come from the prompt and are safe on every OS', () => {
    const at = new Date(2026, 10, 16, 14, 5);
    expect(folderNameFrom('a red fox in the snow, cinematic lighting <lora:detail:0.8>', at)).toBe('A red fox in the snow cinematic lighting');
    expect(folderNameFrom('what: is/this? <a> "b" | c*', at)).toBe('What is this a b c');
    expect(folderNameFrom('   ', at)).toBe('Image 2026-11-16 14.05');
    expect(folderNameFrom('con', at)).toBe('Con image');
    expect(folderNameFrom('word '.repeat(40), at).length).toBeLessThanOrEqual(48);
    expect(folderNameFrom('...dots...', at)).toBe('Dots');
    for (const bad of ['', '..', '.', 'a/b', 'a\\b', 'x:y', 'trail.', 'x'.repeat(81)]) expect(cleanDir(bad)).toBeNull();
    expect(cleanDir('A lotus flower 2')).toBe('A lotus flower 2');
    expect(cleanDir(' padded ')).toBe('padded');
  });

  test('a new generation never reuses a folder', () => {
    const studio = tmp();
    expect(newImageFolder(studio, 'red fox')).toBe('Red fox');
    expect(newImageFolder(studio, 'red fox')).toBe('Red fox 2');
    expect(newImageFolder(studio, 'Red fox')).toBe('Red fox 3');
    expect(existsSync(join(studio, 'Images', 'Red fox 3'))).toBe(true);
  });

  test('numbered files: Output 1, 2, …; identical references are kept once', async () => {
    const studio = tmp();
    const db = openDb(tmp());
    const dir = newImageFolder(studio, 'red fox');
    const o1 = await saveMedia(db, studio, png(1), 'image/png', 'Output', new Date(), { dir, numbered: true });
    const o2 = await saveMedia(db, studio, png(1), 'image/png', 'Output', new Date(), { dir, numbered: true });
    const r1 = await saveMedia(db, studio, png(2), 'image/jpeg', 'Reference', new Date(), { dir, numbered: true, reuse: true });
    const r1again = await saveMedia(db, studio, png(2), 'image/jpeg', 'Reference', new Date(), { dir, numbered: true, reuse: true });
    const r2 = await saveMedia(db, studio, png(3), 'image/png', 'Reference', new Date(), { dir, numbered: true, reuse: true });
    expect([o1.path, o2.path]).toEqual(['Images/Red fox/Output 1.png', 'Images/Red fox/Output 2.png']); // outputs are never merged
    expect([r1.path, r1again.path, r2.path]).toEqual(['Images/Red fox/Reference 1.jpg', 'Images/Red fox/Reference 1.jpg', 'Images/Red fox/Reference 2.png']);
    expect(readdirSync(join(studio, 'Images', 'Red fox')).sort()).toEqual(['Output 1.png', 'Output 2.png', 'Reference 1.jpg', 'Reference 2.png']);
    // Numbering continues after the highest number, even with a gap.
    rmSync(join(studio, 'Images', 'Red fox', 'Output 1.png'));
    expect((await saveMedia(db, studio, png(4), 'image/png', 'Output', new Date(), { dir, numbered: true })).path).toBe('Images/Red fox/Output 3.png');
    // The saved paths open like any other media path; a folder name can't climb out of Images/.
    expect(resolveMedia(studio, o2.path)).toBe(join(studio, 'Images', 'Red fox', 'Output 2.png'));
    await expect(saveMedia(db, studio, png(5), 'image/png', 'Output', new Date(), { dir: '../x', numbered: true })).rejects.toThrow(/folder name/);
    // Without a folder, images still go to the month (Audio and older callers).
    expect((await saveMedia(db, studio, png(6), 'image/png', 'clip', new Date(2026, 10, 1))).path).toBe('Images/2026-11/clip.png');
    db.sql.close();
  });
});

describe('several reference images', () => {
  const path = (folder: string, file: string) => `/M/${folder}/${file}`;
  const run = { prompt: 'x', width: 1024, height: 1024, seed: 1, count: 1, steps: 4, cfg: 1, sampler: 'euler', scheduler: 'simple', output: '/o/x.png' };
  test('FLUX.2 gets each one as --ref-image; SD models start from one image', () => {
    const flux2 = { id: 'f2', name: 'FLUX.2 Klein', family: 'flux2', files: { model: 'flux-2-klein.safetensors', llm: 'qwen_3_4b.safetensors', vae: 'flux2-vae.safetensors' } } as ImageProfile;
    const a = sdcppArgs(flux2, { ...run, refs: ['/r/1.png', '/r/2.png', '/r/3.png'] }, path);
    expect(a.filter((x, i) => a[i - 1] === '-r')).toEqual(['/r/1.png', '/r/2.png', '/r/3.png']);
    expect(a).not.toContain('-i');
    const sdxl = { id: 'x', name: 'SDXL', family: 'sdxl', files: { model: 'sdxl.safetensors' } } as ImageProfile;
    const b = sdcppArgs(sdxl, { ...run, init: '/r/1.png', strength: 0.5, refs: ['/r/2.png'] }, path);
    expect(b).not.toContain('-r');
    expect(b[b.indexOf('-i') + 1]).toBe('/r/1.png');
  });
});

describe('paste and drop', () => {
  const file = (name: string, type: string) => new File([new Uint8Array([1, 2, 3])], name, { type });
  const clip = (files: File[], types: string[]) => ({ files, items: [], types });

  test('screenshots and copied files are pasted as files; text stays text', () => {
    const at = new Date(2026, 10, 16, 9, 4, 7);
    // A screenshot: one "image.png" and no text.
    const one = clipboardFiles(clip([file('image.png', 'image/png')], ['Files']));
    expect(one.length).toBe(1);
    expect(one[0].name).toMatch(/^Pasted image \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}\.png$/);
    // Several files copied in Explorer/Finder keep their names, even with their names as text too.
    const many = clipboardFiles(clip([file('notes.md', 'text/markdown'), file('photo.jpg', 'image/jpeg'), file('a.png', 'image/png')], ['Files', 'text/plain']));
    expect(many.map((f) => f.name)).toEqual(['notes.md', 'photo.jpg', 'a.png']);
    // Cells copied from a spreadsheet: text plus a picture of them → the text is pasted.
    expect(clipboardFiles(clip([file('image.png', 'image/png')], ['text/plain', 'text/html', 'Files']))).toEqual([]);
    expect(clipboardFiles(clip([], ['text/plain']))).toEqual([]);
    expect(clipboardFiles(null)).toEqual([]);
    // Several pasted images get different names.
    const named = nameFiles([file('image.png', 'image/png'), file('image.png', 'image/jpeg')], at);
    expect(named.map((f) => f.name)).toEqual(['Pasted image 2026-11-16 09.04.07 (1).png', 'Pasted image 2026-11-16 09.04.07 (2).jpg']);
  });

  test('which drags carry files, and how files are sorted', () => {
    expect(dragHasFiles(['Files'])).toBe(true);
    expect(dragHasFiles(['text/uri-list', 'text/html'])).toBe(true); // an image dragged inside Lotus
    expect(dragHasFiles(['text/plain'])).toBe(false); // a task card on the board
    expect(dragHasFiles(null)).toBe(false);
    const s = sortFiles([file('a.png', 'image/png'), file('talk.m4a', ''), file('clip.mp4', 'video/mp4'), file('notes.txt', 'text/plain'), file('x.pdf', 'application/pdf')]);
    expect([s.images.map((f) => f.name), s.media.map((f) => f.name), s.other.map((f) => f.name)]).toEqual([['a.png'], ['talk.m4a', 'clip.mp4'], ['notes.txt', 'x.pdf']]);
  });
});
