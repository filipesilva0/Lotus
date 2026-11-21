// Which optional parts of Chat's system prompt a message needs (0.15.1). Every token of the system
// prompt is read before the first word of a reply, which on an 8 GB card costs seconds, so the install
// and image instructions (about 2,500 characters) only go with messages that can use them.
// Pure functions only, so the core's tests can import them.

/**
 * Whether this message may be about getting a model (0.15.1): the install instructions are only sent
 * then, since every token of the system prompt slows the first reply. An empty message (regenerate)
 * keeps them, to be safe.
 */
export function wantsInstall(query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  return /\b(install|download|pull|set ?up|uninstall)/i.test(q) || (/\b(add|get|try|use|need|switch|recommend|which|better|bigger|smaller)\b/i.test(q) && /\b(models?|llms?|engines?|checkpoints?|voices?|loras?)\b/i.test(q));
}

const IMAGE_WORDS = /\b(images?|pictures?|pics?|photos?|draw\w*|drew|paint\w*|illustrat\w*|sketch\w*|render\w*|logos?|icons?|wallpapers?|posters?|portraits?|artworks?|art|avatars?|stickers?|comics?|memes?|prompts?|visuali[sz]e|generate|flux|sdxl|stable diffusion|comfy\w*)\b/i;

/**
 * Whether the image instructions belong in this request (0.15.1): only when the message is about
 * pictures, or Lotus's last reply proposed one (so "make it bluer" still works). An empty message
 * (regenerate) keeps them, to be safe.
 */
export function wantsImage(query: string, lastReply = ''): boolean {
  const q = query.trim();
  return !q || IMAGE_WORDS.test(q) || /```image/i.test(lastReply);
}
