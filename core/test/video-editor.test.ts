// 0.22: the Video editor page's project model and presets (src/video/project.ts, src/video/presets.ts).

import { describe, expect, test } from 'bun:test';
import {
  addClip, addExports, clipAt, clipStarts, clock, cueAt, editCue, exportPlan, fromEdit, loadProject, moveClip, newProject, notReady, removeClip, splitAt,
  totalSeconds, trimClip, upsertRef, type Media,
} from '../../src/video/project';
import { PRESETS, applyLook } from '../../src/video/presets';
import { builtinPlugins } from '../../src/plugins/builtin';
import { matchPluginSkills } from '../../src/plugins/block';

const vid = (file: string, duration: number): Media => ({ file, kind: 'video', duration, width: 1280, height: 720, hasAudio: true });
const pic = (file: string): Media => ({ file, kind: 'picture', duration: 0, width: 800, height: 600, hasAudio: false });

describe('the timeline', () => {
  test('adding, timing, splitting, trimming, moving and removing clips', () => {
    let p = newProject('video-1');
    p = addClip(p, vid('a.mp4', 10));
    p = addClip(p, pic('b.png'));
    p = addClip(p, { file: 'song.mp3', kind: 'audio', duration: 100, width: 0, height: 0, hasAudio: true });
    expect(p.clips.map((c) => c.file)).toEqual(['a.mp4', 'b.png']);
    expect(totalSeconds(p)).toBe(13);
    expect(clipStarts(p)).toEqual([0, 10]);
    expect(clipAt(p, 11)).toEqual({ index: 1, offset: 1 });
    p = splitAt(p, 4);
    expect(p.clips.map((c) => [c.file, c.from, c.to])).toEqual([['a.mp4', 0, 4], ['a.mp4', 4, 10], ['b.png', 0, 3]]);
    expect(splitAt(p, 4.05)).toBe(p); // too close to an edge
    p = trimClip(p, p.clips[1].id, 5, 99, vid('a.mp4', 10));
    expect([p.clips[1].from, p.clips[1].to]).toEqual([5, 10]);
    p = trimClip(p, p.clips[2].id, 0, 100, pic('b.png'));
    expect(p.clips[2].to).toBe(30);
    p = moveClip(p, p.clips[2].id, -2);
    expect(p.clips[0].file).toBe('b.png');
    expect(moveClip(p, p.clips[0].id, -1)).toBe(p);
    p = removeClip(p, p.clips[0].id);
    expect(totalSeconds(p)).toBe(9);
    p = addClip(p, pic('c.png'), 0);
    expect(p.clips[0].file).toBe('c.png');
  });
  test('captions: the one showing, edits keep them in order, empty ones go', () => {
    const cues = [{ start: 0, end: 2, text: 'a' }, { start: 3, end: 4, text: 'b' }];
    expect(cueAt(cues, 3.5)?.text).toBe('b');
    expect(cueAt(cues, 2.5)).toBeNull();
    expect(editCue(cues, 0, { start: 5, end: 6 }).map((c) => c.text)).toEqual(['b', 'a']);
    expect(editCue(cues, 1, { text: ' ' })).toHaveLength(1);
  });
  test('a saved project is made safe; the export plan and readiness', () => {
    const p = loadProject({ title: 'Mine', aspect: 'weird', clips: [{ file: 'a.mp4', from: 0, to: 2 }, { file: 'x', from: 3, to: 1 }], cues: 'no' }, 'video-2');
    expect(p).toMatchObject({ id: 'video-2', title: 'Mine', aspect: '16:9', cues: [], exports: [] });
    expect(p.clips).toHaveLength(1);
    expect(p.clips[0].volume).toBe(1);
    expect(notReady(newProject('x'), [])).toContain('Add a video');
    expect(notReady(p, [])).toContain('a.mp4 is no longer');
    expect(notReady(p, [vid('a.mp4', 5)])).toBeNull();
    const plan = exportPlan({ ...p, voice: { file: 'voiceover.wav', seconds: 3, voice: 'v', lines: [] } }, 'out');
    expect(plan).toMatchObject({ voiceover: 'voiceover.wav', aspect: '16:9', filename: 'out', burn: true });
    expect(addExports(addExports(p, ['a.mp4']), ['b.mp4', 'a.mp4']).exports).toEqual(['b.mp4', 'a.mp4']);
    expect(fromEdit(p, [{ file: 'z.mp4', from: 1, to: 2 }]).clips[0]).toMatchObject({ file: 'z.mp4', from: 1, to: 2, volume: 1 });
    expect(upsertRef([{ id: 'a', title: 'A', updated: 1 }, { id: 'b', title: 'B', updated: 2 }], { id: 'b', title: 'B2', updated: 3 }).map((r) => r.title)).toEqual(['B2', 'A']);
    expect(clock(65.34, true)).toBe('1:05.3');
    expect(clock(5)).toBe('0:05');
  });
});

describe('presets', () => {
  test('the Video plugin\'s makers are presets, next to one-click recipes', () => {
    const ai = PRESETS.filter((p) => p.kind === 'ai');
    expect(ai.map((p) => p.ai)).toEqual(['narrate', 'pictures', 'idea', 'film']);
    const plugin = builtinPlugins().find((p) => p.id === 'builtin-video')!;
    for (const p of ai) expect(plugin.commands.some((c) => `/${c.name}` === p.command)).toBe(true);
    expect(PRESETS.filter((p) => p.kind === 'recipe').length).toBeGreaterThanOrEqual(5);
  });
  test('a recipe sets the look: the captioned Short is tall, blurred behind, bold', () => {
    const p = applyLook(newProject('v'), PRESETS.find((x) => x.id === 'short')!);
    expect(p).toMatchObject({ aspect: '9:16', fit: 'blur', captionStyle: 'bold', burn: true });
  });
  test('the plugin finds the new skills', () => {
    const all = builtinPlugins();
    const top = (q: string) => matchPluginSkills(q, all, 2)[0]?.skill.name ?? null;
    expect(top('add burned in captions subtitles to my video')).toBe('captions-for-a-video');
    expect(top('cut my long podcast video into shorts and reels')).toBe('shorts-from-a-long-video');
    expect(top('cut out the pauses and silences in my talking video')).toBe('auto-edit-footage');
  });
});
