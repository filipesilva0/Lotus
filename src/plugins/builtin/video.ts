// Video (0.21): Lotus's own skills for making videos in Work mode with the video tools
// (core/src/tools/video.ts): watch a video, write a script, pick a voice, record the voiceover and
// put it all together with FFmpeg.
//
// The user pointed at onetake (github.com/feitangyuan/onetake) as an example. Its licence is PolyForm
// Noncommercial 1.0.0, which doesn't allow commercial use, and Lotus is sold, so nothing was copied
// from it: no text, scripts or move library. These skills are written from scratch for Lotus and only
// do the same kind of job (short narrated videos that don't feel like a slideshow).

import type { BuiltinPluginDef } from './types';

export const VIDEO: BuiltinPluginDef = {
  id: 'builtin-video',
  name: 'Video',
  version: '1.0.0',
  description: 'Make narrated videos: watch a video, write the script, pick the best voice, record it and put it all together.',
  author: 'Lotus',
  defaultOn: true,
  credit: { by: 'Lotus', license: 'Original', note: 'Written for Lotus. Does the kind of job video skills like onetake do, with Lotus’s own voices and FFmpeg; onetake itself is for non-commercial use only, so none of it is copied.' },
  instructions: '',
  commands: [
    { name: 'video', description: 'Make a narrated video', prompt: 'Make a short narrated video. Follow the narrated-video skill: plan, script, pick a voice, record the voiceover, make the pictures or use mine, and put it together with video.make. What it is about:\n\n{{input}}' },
    { name: 'narrate', description: 'Add a voiceover to one of my videos', prompt: 'Add a voiceover to my video. Follow the narrate-a-video skill: watch it with video.inspect, write a script that fits what happens and when, pick a voice, record it, and make the narrated version with video.make. The video and what I want:\n\n{{input}}' },
  ],
  skills: [
    {
      name: 'narrated-video',
      description: 'Make a short narrated video from an idea: script, voice, pictures and assembly.',
      whenToUse: 'Make, create or generate a video, promo, explainer, teaser, reel, short, trailer, ad or slideshow video with voiceover narration, from an idea or topic.',
      body: `# Making a narrated video

1. plan.set with the steps below. Ask (ask.user) only what you can't guess: length (default 30–45 s), shape (16:9, or 9:16 for phones), language.
2. Script: one line per scene, 6–12 words each, about 2.5 words per second. A hook first, one idea per line, a clear last line. Save it with artifact.write as script.md.
3. Voice: call voice.list. Pick by language, then tone (calm, warm, energetic) and gender that suit the topic. Prefer the user's usual or own voice when it fits. Say which voice you chose and why in one line.
4. video.voiceover with the voice id and the script lines.
5. Pictures, one per line: use the user's own when they gave them; otherwise image.generate with aspect matching the video and the same style words in every prompt so the scenes look like one film.
6. video.make with the pictures as scenes (in order), voiceover "voiceover.wav", the aspect. Scene lengths follow the voice by themselves.
7. Tell the user the file name, its length, the voice and what each scene shows. Offer one change (another voice, faster pace, music).

## Rules
- Never use a voice voice.list marks NOT USABLE, and never copy a real person's voice.
- Each scene should carry something from the one before (same place, character or colour) so it doesn't feel like slides.
- Lotus makes moving pictures with pan, zoom and crossfades; it does not film new footage. Say so if asked for real motion.`,
    },
    {
      name: 'narrate-a-video',
      description: 'Watch an existing video, script a voiceover that fits it, and add it.',
      whenToUse: 'Add a voiceover, narration, commentary or dub to my existing video or recording; voice over this clip; narrate footage I already have.',
      body: `# Narrating an existing video

1. video.inspect the video. Describe what happens in each part from the frame sheet, with times. If something matters, look closer with video.inspect and at.
2. If it has speech, read the transcript; ask whether to keep it (original_sound "lower") or replace it ("mute").
3. Script: one line per moment, each short enough to finish before the next moment (about 2.5 words per second). Note each line's start time.
4. voice.list, pick the voice (language first, then tone), then video.voiceover with the lines and their starts.
5. video.make with the video as the only scene, the voiceover, and original_sound as agreed.
6. Report the file, its length and anything you had to move or cut.

Translating a video: write the transcript's meaning in the new language as the lines, keep the starts, mute or lower the original.`,
    },
    {
      name: 'understanding-a-video',
      description: 'Describe, summarise or answer questions about a video.',
      whenToUse: 'What happens in this video, summarise, describe, review, transcribe or explain a video, recording or clip; find the moment when something happens.',
      body: `# Understanding a video

1. video.inspect the file (9 frames; 16 for videos over 3 minutes).
2. From the frame sheet: what is on screen in each part, with times. From the transcript: who says what.
3. For a specific moment, video.inspect again with at (seconds) and look closely.
4. Answer the question first, then a short timeline (0:00 …). Quote the transcript only where it helps.

If no pictures come through, say the chat model can't see images and answer from the transcript. Never invent what is on screen.`,
    },
  ],
};
