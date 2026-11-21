// Writing: Lotus's own versions of the humanizer and writing-style skills. Written from scratch; the
// writing-style skill keeps the user's voice in memory (memory.save) instead of a generated skill.

import type { BuiltinPluginDef } from './types';

export const WRITING: BuiltinPluginDef = {
  id: 'builtin-writing',
  name: 'Writing',
  version: '1.0.0',
  description: 'Make text sound human, not like AI, and learn to write in your own voice.',
  author: 'Lotus',
  defaultOn: true,
  credit: { by: 'Lotus', license: 'Original', note: 'Written for Lotus. Does the same jobs as Claude’s humanizer and writing-style skills, in Lotus’s own words.' },
  instructions: '',
  commands: [
    { name: 'humanize', description: 'Rewrite text so it does not sound like AI', prompt: 'Rewrite this so it sounds like a person wrote it, not an AI. Keep the meaning, facts and language. Return only the rewritten text:\n\n{{input}}' },
  ],
  skills: [
    {
      name: 'humanizer',
      description: 'Rewrite AI-sounding text so it reads like a person wrote it, same meaning.',
      whenToUse: 'Humanize or rewrite text that sounds like AI or ChatGPT so it sounds natural and human; remove AI writing patterns.',
      body: `# Make text sound human

Keep every fact, claim and the language. Change only how it is said.

## Remove
- "Not X, but Y" set-ups and dramatic one-line closers.
- Lists of exactly three for no reason; every sentence the same length.
- Overused words: delve, tapestry, testament, crucial, seamless, robust, leverage, elevate, unlock, landscape, navigate, journey, "in today's fast-paced world".
- Inflated importance ("plays a pivotal role"), vague praise, sales talk.
- Stacked hedges ("it may potentially perhaps").
- Em dashes everywhere; use commas, full stops or brackets.
- Empty openers and closers ("Great question!", "I hope this helps!").

## Add
- Plain, specific words. Concrete details from the text.
- Mixed sentence lengths. Active voice with a clear subject.
- The writer's own tone (casual stays casual).

Return only the rewritten text unless the user asked for notes. For an audit, list each pattern found with the line and a fix.`,
    },
    {
      name: 'writing-style',
      description: 'Learn how the user writes from their samples and draft in that voice.',
      whenToUse: 'Learn or copy my writing style or voice from samples of my writing, so drafts sound like me.',
      body: `# Learning the user's writing voice

1. Ask for 3–5 real samples the user wrote (emails, posts, messages). Only use what they give you.
2. Describe the voice in at most 8 short lines:
   - sentence length and rhythm
   - formal or casual; contractions or not
   - greetings and sign-offs they use
   - favourite words and phrases; words they never use
   - punctuation habits (exclamation marks, emoji, dashes)
   - how they open and close, how direct they are
3. Show the profile and ask if it is right.
4. When they agree, save it with memory.save as a standing instruction: "When drafting text for me to send, write in my voice: …".
5. Test: draft one short message in their voice and ask what to change; update the memory.

Never copy private details from the samples into the profile.`,
    },
  ],
};
