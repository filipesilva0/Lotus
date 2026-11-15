// avatar.create (session 16): the main agent designs a face (a blobatar) for an agent, a helper, a
// persona or the user. Looks are saved under lotus.avatars.v1 (every window shows them at once) and
// as an SVG file in Lotus Studio/Avatars. The renderer is blobatar's MIT source, vendored in
// src/vendor/blobatar.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Tool } from '../agent/types';
import { AVATARS_KEY, COLOR_HUES, EXPRESSIONS, hueOf, parseLooks, renderAvatar, SHAPES, type AvatarLook, type ExpressionName, type ShapeName } from '../../../src/agents/avatars';

export const avatarCreate: Tool = {
  name: 'avatar.create', label: 'Designing a face', risk: 'write',
  description: 'Design a face (a small blob character) for an agent, a helper you are about to start with agent.delegate, a persona or the user. Give it a name and choose its colour, shape and expression; anything you leave out comes from the name. The same name always shows this face in Lotus.',
  parameters: { type: 'object', properties: {
    name: { type: 'string', description: 'Who it is for, e.g. "Researcher" or "Helper 1".' },
    color: { type: 'string', description: `A colour word (${Object.keys(COLOR_HUES).join(', ')}) or a hue 0–360.` },
    shape: { type: 'string', description: 'Body shape.', enum: Object.keys(SHAPES) },
    expression: { type: 'string', description: 'Its usual face.', enum: Object.keys(EXPRESSIONS) },
    shade: { type: 'string', description: 'pale, soft, bright or dark.', enum: ['pale', 'soft', 'bright', 'dark'] },
    about: { type: 'string', description: 'One line on what this agent does.' },
  }, required: ['name'] },
  describe: (a) => `Design a face for ${String(a.name).slice(0, 60)}`,
  async run(a, ctx) {
    const name = String(a.name ?? '').trim().slice(0, 60);
    if (!name) return { ok: false, text: 'Give the face a name.', summary: 'No name' };
    const look: AvatarLook = {};
    const hue = hueOf(a.color);
    if (a.color !== undefined && hue === undefined) return { ok: false, text: `I don't know the colour "${a.color}". Use one of: ${Object.keys(COLOR_HUES).join(', ')}, or a number 0–360.`, summary: 'Unknown colour' };
    if (hue !== undefined) look.hue = hue;
    if (typeof a.shape === 'string') look.shape = a.shape as ShapeName;
    if (typeof a.expression === 'string') look.expression = a.expression as ExpressionName;
    if (typeof a.shade === 'string') look.tone = { pale: 0.15, soft: 0.35, bright: 0.6, dark: 0.92 }[a.shade as 'pale'];
    // A colour asked for should read as that colour, not as the name's random (maybe near-black) shade.
    else if (hue !== undefined) look.tone = 0.4;
    if (a.about) look.about = String(a.about).slice(0, 160);
    const svg = renderAvatar(name, look, 256);
    const dir = join(ctx.studio, 'Avatars');
    mkdirSync(dir, { recursive: true });
    const file = `${name.replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '-') || 'avatar'}.svg`;
    writeFileSync(join(dir, file), svg, 'utf8');
    const looks = parseLooks(ctx.kvGet(AVATARS_KEY));
    looks[name.toLowerCase()] = look;
    ctx.kvSet(AVATARS_KEY, JSON.stringify(looks));
    const bits = [look.shape, a.color && String(a.color), look.expression].filter(Boolean).join(', ');
    return { ok: true, text: `Made a face for ${name}${bits ? ` (${bits})` : ''}. Lotus now shows it wherever ${name} appears. Saved as Avatars/${file}.`, summary: `Face for ${name}${bits ? ` · ${bits}` : ''}`, data: { avatar: { name, look, file: `Avatars/${file}` } } };
  },
};
