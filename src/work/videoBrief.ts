// The Video page (0.21) turns its form into a request for Work mode, which runs the video tools.
// Pure (tested in core/test/video.test.ts): the words sent are exactly what the form says.

export type VideoMode = 'narrate' | 'pictures' | 'idea';
export type VideoShape = '16:9' | '9:16' | '1:1';

export interface VideoBrief {
  mode: VideoMode;
  /** File names already in the job's folder (the user's video or pictures). */
  files: string[];
  /** What the user wants it to say or be about. */
  brief: string;
  /** A voice the user chose (id from the voice list), or none to let Lotus pick. */
  voice?: { id: string; name: string } | null;
  shape: VideoShape;
  /** Length for pictures and ideas. */
  seconds?: number;
  /** Narrating: the video's own sound. */
  original?: 'lower' | 'mute' | 'keep';
}

const voiceStep = (v: VideoBrief['voice']) => (v ? `Use the voice ${v.id} (${v.name}); I chose it.` : 'Call voice.list and pick the best voice for this (language first, then tone); tell me which one and why.');

export function videoRequest(b: VideoBrief): string {
  const about = b.brief.trim();
  const list = b.files.map((f) => `"${f}"`).join(', ');
  if (b.mode === 'narrate') {
    const sound = { keep: 'keep its own sound as it is', mute: 'mute its own sound', lower: 'lower its own sound under the voice' }[b.original ?? 'lower'];
    return [
      `Add a voiceover to my video ${list}.${about ? ` What I want: ${about}` : ''}`,
      'Steps: 1) video.inspect the video and describe what happens, with times. 2) Write a script that fits those moments (about 2.5 words per second) and save it as script.md. 3) '
        + voiceStep(b.voice)
        + ` 4) video.voiceover with the lines and their start times. 5) video.make with the video as the only scene, the voiceover, and original_sound "${b.original ?? 'lower'}" (${sound}).`,
      'Tell me the file name and what the voice says when.',
    ].join('\n');
  }
  const secs = b.seconds ?? 30;
  const lines = Math.max(3, Math.round(secs / 5));
  const pics = b.mode === 'pictures'
    ? `Use my pictures ${list} as the scenes, in this order (look at each with video.inspect first so the script matches it).`
    : `Make one picture per line with image.generate, aspect ${b.shape}, with the same style words in every prompt so the scenes look like one film.`;
  return [
    `Make a ${secs}-second narrated video, shape ${b.shape}.${about ? ` It is about: ${about}` : ''}`,
    `Steps: 1) Write a script of about ${lines} short lines (one per scene, about 2.5 words per second) and save it as script.md. 2) ${voiceStep(b.voice)} 3) video.voiceover with the lines. 4) ${pics} 5) video.make with the scenes, voiceover "voiceover.wav" and aspect "${b.shape}".`,
    'Tell me the file name, the voice and what each scene shows.',
  ].join('\n');
}
