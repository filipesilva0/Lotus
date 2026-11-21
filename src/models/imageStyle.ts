// Which kind of picture an image model makes, guessed from its name (0.15.1). In 0.15.0 the Photo
// examples ran on whatever model was selected, so "elderly fisherman… photorealistic" on illustriousXL
// came back as an anime face while Juggernaut XL sat unused. No React here, so core tests can import it.

export type ImageStyle = 'photo' | 'anime' | 'general';

/** Model names that make anime or cartoon pictures, whatever the prompt says. */
const ANIME = /illustrious|noob|pony|anime|animagine|waifu|counterfeit|anything[-_ ]?v|hassaku|kohaku|meina|aniverse|\bwai[-_ ]|wainsfw|nai[-_]?xl|toon|cartoon|manga|niji/i;
/** Model names made for photographs. */
const PHOTO = /juggernaut|realvis|realistic|realism|real[-_ ]?vision|epic[-_ ]?real|cyber[-_ ]?real|photon|photo|z[-_ ]?image|lustify|halcyon|zavychroma|leosam|newreality|absolute[-_ ]?reality|majicmix[-_ ]?realistic/i;

export function imageStyle(name: string): ImageStyle {
  const n = name.split(/[\\/]/).pop() ?? name;
  if (PHOTO.test(n) && !/anime|toon|cartoon/i.test(n)) return 'photo';
  if (ANIME.test(n)) return 'anime';
  return 'general';
}

/** `name` is what the style is read from (file names help); `label` is what the user sees. */
export interface StyleModel { id: string; name: string; label?: string }
const shown = (m: StyleModel) => m.label ?? m.name;

/**
 * The model to use for an example of a given style, and what to tell the user. Keeps the current model
 * when it already suits; otherwise switches to the best installed one; warns when none suits.
 */
export function modelForStyle(want: ImageStyle | undefined, current: StyleModel | undefined, models: StyleModel[]): { switchTo?: StyleModel; note?: string } {
  if (!want || want === 'general' || !current) return {};
  const style = (m: StyleModel) => imageStyle(m.name);
  const have = style(current);
  if (have === want) return {};
  const best = models.find((m) => style(m) === want);
  const label = want === 'photo' ? 'photo-style' : 'anime-style';
  if (best && best.id !== current.id) return { switchTo: best, note: `Switched to ${shown(best)} for ${label} pictures. You can change it in the model menu.` };
  // Nothing made for this style: a general model is fine, but an anime model will draw the photo.
  if (want === 'photo' && have === 'anime') {
    const general = models.find((m) => style(m) === 'general');
    if (general) return { switchTo: general, note: `Switched to ${shown(general)}: ${shown(current)} draws anime-style pictures. A photo model such as Juggernaut XL makes these look real.` };
    return { note: `${shown(current)} draws anime-style pictures, so this may not look like a photo. Get a photo model such as Juggernaut XL in Models.` };
  }
  return {};
}
