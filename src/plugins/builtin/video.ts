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
  version: '1.2.0',
  description: 'Make and edit videos: narrated videos, captions, Shorts from a long video, an automatic first cut, voiceovers with your voices. Its makers are also presets on the Video page.',
  author: 'Lotus',
  defaultOn: true,
  credit: { by: 'Lotus', license: 'Original', note: 'Written for Lotus. Does the kind of job video skills like onetake do, with Lotus’s own voices and FFmpeg; onetake itself is for non-commercial use only, so none of it is copied.' },
  instructions: '',
  commands: [
    { name: 'video', description: 'Make a narrated video', prompt: 'Make a short narrated video. Follow the narrated-video skill: plan, script, pick a voice, record the voiceover, make the pictures or use mine, and put it together with video.make. What it is about:\n\n{{input}}' },
    { name: 'film', description: 'Film new footage with AI', prompt: 'Film new footage with AI for this. Follow the film-with-ai skill: plan short shots, say how long it will take, then video.generate. What it should show:\n\n{{input}}' },
    { name: 'captions', description: 'Add captions to a video', prompt: 'Add captions to my video. Follow the captions-for-a-video skill. The video and the look I want:\n\n{{input}}' },
    { name: 'shorts', description: 'Cut a long video into Shorts', prompt: 'Cut my long video into Shorts. Follow the shorts-from-a-long-video skill. The video and what I want:\n\n{{input}}' },
    { name: 'autoedit', description: 'Edit my footage into one video', prompt: 'Edit my footage into one video. Follow the auto-edit-footage skill. The files and what I want:\n\n{{input}}' },
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
- Pictures with pan, zoom and crossfades are quick. For real motion use the film-with-ai skill (video.generate), which is slow: say how long before starting.`,
    },
    {
      name: 'film-with-ai',
      description: 'Film new moving footage with AI (Wan video models) and make it into a narrated video.',
      whenToUse: 'Real motion, real footage, animate, film, generate video clips, text to video, image to video, bring my picture to life, AI video instead of a slideshow.',
      body: `# Filming new footage with AI

1. Plan few, short shots: each clip is 2–5 s and takes minutes to make (about 6 minutes per 2 s on an 8 GB card). A 30 s video is about 10–15 shots.
2. Script and voiceover first (narrated-video steps 2–4), so you know each line's length.
3. Write each shot as one sentence: subject, action, place, camera move, light ("a runner ties her shoes on a misty bridge at dawn, camera slowly pushes in, soft golden light"). Keep the same style words for every shot. No text or logos: video models can't write.
4. Tell the user how long it will take, then call video.generate once per line with that shot, seconds about the line's length, the aspect, and filename shot1.mp4, shot2.mp4…
5. video.make with the shot files as scenes, voiceover "voiceover.wav" and the aspect.
6. If video.generate says this computer can't film (no graphics card, too little memory, no model), do what it says: pictures with slow moves, and tell the user why in one sentence.

## Rules
- Never film real, named people or anything the user hasn't the right to show.
- If a clip fails part way, don't start over: say what was made and offer to continue or use pictures.`,
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
      name: 'captions-for-a-video',
      description: 'Add captions (subtitles) to a video from what is said in it.',
      whenToUse: 'Add captions, subtitles, subs, closed captions, burned-in text or a transcript with times to my video, reel or recording.',
      body: `# Captions for a video

1. video.subtitles with the file. Whisper writes what is said with real times; it saves an .srt and, with burn true (default), a copy with the captions drawn on.
2. Pick the look from where it will be posted: "bold" for Shorts, Reels and TikTok; "clean" for YouTube and anything wide; "boxed" when the footage is busy; "big" for one punchy word at a time.
3. Tell the user both file names and the first few lines, and that the Video page's Captions panel lets them fix any word.

If it says no dictation model is downloaded, tell the user to get Whisper in Settings → Models → Dictation.`,
    },
    {
      name: 'shorts-from-a-long-video',
      description: 'Cut a long video into several tall Shorts with captions.',
      whenToUse: 'Make Shorts, Reels, TikToks or clips from a long video, podcast, stream, lesson or vlog; find the best moments; split a video into short vertical clips.',
      body: `# Shorts from a long video

1. video.shorts with the file, how many (count, default 3) and about how long (seconds, default 30). Lotus finds the best moments itself: where people talk, the liveliest sound, where things happen.
2. If the user named the moments ("the bit about posture at 4:10"), pass them as moments with start and end in seconds instead.
3. Each Short is 9:16 with a blurred copy behind and bold captions. Report each file, its time in the original and what is said in it.`,
    },
    {
      name: 'auto-edit-footage',
      description: 'Edit raw footage into one video automatically: a highlight reel, or a talking video with the pauses cut.',
      whenToUse: 'Edit my footage, clips or recordings into one video; make a highlight reel, montage or recap; cut out the pauses, silences or dead air; tighten a talking-head video.',
      body: `# Auto-editing footage

1. Pick the mode: "highlights" for a reel of many clips (holiday, event, product shots); "tighten" for one person talking (lesson, vlog, explainer).
2. video.autoedit with the files in order, the mode, and for highlights about how long (seconds).
3. Add a voiceover (video.voiceover) or music only if asked, then pass them to video.autoedit.
4. Tell the user the file, its length and, for tighten, how much was cut. Mention they can fine-tune the cut on the Video page.`,
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
