// Which plugin skills go with a message, and the plugin text added to the system prompt. Pure (no
// React, no storage) so the core tests can run it.
//
// 0.21: a plugin skill is only loaded when the message shares at least two subject words with its
// name, "use when" and description (the words of memory/skillMatch.ts). Before, one shared word prefix
// was enough, which was fine for one or two custom plugins but not for the ~35 built-in skills. The
// learned-skill rule that one word in a skill's name is enough for a short message is not used here:
// built-in names hold broad words ("code", "plan", "review") that would pull a skill into "fix my code".
// A built-in skill may also list `anchors`: a word or phrase that names its subject on its own
// ("logo", "app icon"). An anchor counts as a match and ranks the skill one place higher.

import { skillOverlap, subjectWords } from '../memory/skillMatch';
import type { LotusPlugin, PluginSkill } from './types';

export interface SkillHit { plugin: LotusPlugin; skill: PluginSkill; shared: number }

/** True when every word of one of the skill's anchors is in the message. */
export function anchorHit(query: string, skill: Pick<PluginSkill, 'anchors'>): boolean {
  if (!skill.anchors?.length) return false;
  const q = new Set(subjectWords(query));
  return skill.anchors.some((a) => { const w = subjectWords(a); return w.length > 0 && w.every((x) => q.has(x)); });
}

/** Skills of enabled plugins that fit the message, best first (at most `limit`). */
export function matchPluginSkills(query: string, from: LotusPlugin[], limit = 2): SkillHit[] {
  if (!query.trim()) return [];
  const hits: (SkillHit & { inName: boolean })[] = [];
  for (const p of from) {
    if (!p.enabled) continue;
    for (const k of p.skills) {
      const o = skillOverlap(query, k);
      const anchored = anchorHit(query, k);
      if (o.shared >= 2 || anchored) hits.push({ plugin: p, skill: k, shared: Math.max(o.shared, 1) + (anchored ? 1 : 0), inName: o.inName });
    }
  }
  return hits.sort((a, b) => b.shared - a.shared || Number(b.inName) - Number(a.inName)).slice(0, limit)
    .map(({ plugin, skill, shared }) => ({ plugin, skill, shared }));
}

/**
 * Text added to the system prompt: the instructions of every enabled plugin (capped), plus the
 * plugin skills that match this message (at most two, so small context windows are not flooded).
 */
export function buildPluginBlock(query: string, from: LotusPlugin[], budget = 6000): string {
  const on = from.filter((p) => p.enabled);
  if (!on.length) return '';
  const parts: string[] = [];
  let left = budget;
  for (const p of on) {
    if (!p.instructions || left < 200) continue;
    const t = p.instructions.slice(0, left);
    left -= t.length;
    parts.push(`### ${p.name}\n${t}`);
  }
  for (const { plugin, skill } of matchPluginSkills(query, on, 2)) {
    if (left < 300) break;
    const t = skill.body.slice(0, left);
    left -= t.length;
    parts.push(`### Skill: ${skill.name} (from ${plugin.name})\n${t}`);
  }
  return parts.length ? `\n\n# Plugins the user turned on\nFollow these unless the user asks otherwise.\n\n${parts.join('\n\n')}` : '';
}
