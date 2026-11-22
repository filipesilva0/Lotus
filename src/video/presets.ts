// The Video editor's presets (0.22). Two kinds:
//   - recipes the editor does by itself, in one click (a captioned Short, a cleaned-up talking video…):
//     they set the shape and look and run the editor's own jobs, so they work without a chat model;
//   - the Video plugin's makers (src/plugins/builtin/video.ts: /narrate, /video, /film), which hand the
//     job to Work, where the assistant writes the script, picks the voice and puts it together.
// Pure (tested in core/test/video-editor.test.ts).

import type { Aspect, CaptionStyle, Fit, Project } from './project';

export type RecipeStep = 'captions' | 'tighten' | 'highlights' | 'shorts';
export type AiMode = 'narrate' | 'pictures' | 'idea' | 'film';

export interface Preset {
  id: string;
  title: string;
  detail: string;
  kind: 'recipe' | 'ai';
  /** Recipes: the look they set. */
  look?: { aspect?: Aspect; fit?: Fit; captionStyle?: CaptionStyle; burn?: boolean; fade?: number };
  /** Recipes: what they run, in order. */
  steps?: RecipeStep[];
  /** Recipes: the highlight reel's length. */
  seconds?: number;
  /** AI presets: the maker, and the Video plugin command it is. */
  ai?: AiMode;
  command?: string;
  /** Needs Whisper (writes down what is said). */
  hears?: boolean;
}

export const PRESETS: Preset[] = [
  { id: 'short', kind: 'recipe', title: 'Captioned Short', detail: 'Tall 9:16 with a blurred background and big bold captions, ready for Shorts, Reels and TikTok.', look: { aspect: '9:16', fit: 'blur', captionStyle: 'bold', burn: true, fade: 0 }, steps: ['captions'], hears: true },
  { id: 'shorts', kind: 'recipe', title: 'Shorts from a long video', detail: 'Finds the best moments of a long video and cuts each into its own captioned Short.', look: { aspect: '9:16', fit: 'blur', captionStyle: 'bold' }, steps: ['shorts'] },
  { id: 'talk', kind: 'recipe', title: 'Clean up a talking video', detail: 'Takes out the pauses and adds clean captions. Great for vlogs, lessons and explainers.', look: { captionStyle: 'clean', burn: true, fade: 0 }, steps: ['tighten', 'captions'], hears: true },
  { id: 'reel', kind: 'recipe', title: 'Highlight reel', detail: 'The best few seconds of every shot, joined with soft crossfades into a 30-second reel.', look: { fade: 0.3 }, steps: ['highlights'], seconds: 30 },
  { id: 'youtube', kind: 'recipe', title: 'YouTube video', detail: 'Wide 16:9, the whole picture, clean captions at the bottom.', look: { aspect: '16:9', fit: 'fit', captionStyle: 'clean', burn: true }, steps: ['captions'], hears: true },
  { id: 'square', kind: 'recipe', title: 'Square post', detail: 'Square 1:1 filling the frame, with boxed captions that read well in a feed.', look: { aspect: '1:1', fit: 'fill', captionStyle: 'boxed', burn: true }, steps: ['captions'], hears: true },
  { id: 'narrate', kind: 'ai', ai: 'narrate', command: '/narrate', title: 'Narrate my video', detail: 'Lotus watches your video, writes a voiceover that fits what happens, and records it.' },
  { id: 'pictures', kind: 'ai', ai: 'pictures', command: '/video', title: 'Video from my pictures', detail: 'Your pictures become moving scenes with a voiceover that tells the story.' },
  { id: 'idea', kind: 'ai', ai: 'idea', command: '/video', title: 'Video from an idea', detail: 'Lotus writes the script, makes a picture for each line, records the voice and puts it together.' },
  { id: 'film', kind: 'ai', ai: 'film', command: '/film', title: 'Film it with AI', detail: 'New moving footage made by AI on your graphics card. Slow (minutes per second), but real motion.' },
];

/** A recipe's look applied to a project (steps are run by the page). */
export function applyLook(p: Project, preset: Preset): Project {
  const l = preset.look ?? {};
  return { ...p, aspect: l.aspect ?? p.aspect, fit: l.fit ?? p.fit, captionStyle: l.captionStyle ?? p.captionStyle, burn: l.burn ?? p.burn, fade: l.fade ?? p.fade };
}
