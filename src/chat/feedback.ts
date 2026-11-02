// Thumbs up / down under a reply (session 13, HIG Generative AI: voluntary feedback next to the
// output, acted on immediately). Feedback is stored on the reply. When the reply used skills and
// memory is on for the chat, it also teaches Lotus: a thumbs up counts as a win for those skills,
// a thumbs down rewrites the first one (the same paths as "thanks" / "that's wrong" in chat).

export type Feedback = 'good' | 'bad';
export type FeedbackEffect = 'win' | 'refine' | null;

/** What a click changes for learning. Clicking the same thumb again clears it and changes nothing. */
export function feedbackEffect(prev: Feedback | undefined, next: Feedback | null, usedSkills: boolean, learning: boolean): FeedbackEffect {
  if (!next || next === prev || !usedSkills || !learning) return null;
  return next === 'good' ? 'win' : 'refine';
}

/** The line shown after a click, so the person knows the click did something. */
export function feedbackNote(next: Feedback | null, effect: FeedbackEffect): string | null {
  if (!next) return null;
  if (effect === 'win') return 'Thanks. The skills this reply used were marked as working.';
  if (effect === 'refine') return 'Thanks. Lotus is rewriting the skill this reply used. Try again for a new answer.';
  return next === 'good' ? 'Thanks for the feedback.' : 'Thanks. Try again for a different answer.';
}
