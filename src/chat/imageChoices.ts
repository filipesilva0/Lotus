// The image models Chat may propose (0.10.1): App keeps this list up to date with the ready image
// setups (Lotus's engine) or ComfyUI checkpoints, and the chat request reads it for its instructions.

import type { ImageChoice } from './imageProposal';

let choices: ImageChoice[] = [];
export const setImageChoices = (l: ImageChoice[]) => { choices = l; };
export const imageChoices = () => choices;
