// The files Library shows (session 7): SKILL.md for every skill, a memory.md view of long-term
// memory, and the soul (persona) Lotus speaks with. Pure functions so the harness can check them.

import type { MemoryItem } from '../types/lotus';
import type { Skill } from '../memory/store';
import type { SystemSkill } from '../skills/system';
import type { LotusPlugin, PluginSkill } from '../plugins/store';

const esc = (v: string) => v.replace(/\n/g, ' ').replace(/"/g, "'");

/** Same text as the Rust mirror `skills/<slug>/SKILL.md` (memory_db.rs `skill_markdown`). */
export function skillFile(s: Pick<Skill, 'name' | 'description' | 'whenToUse' | 'version' | 'tags' | 'origin' | 'body'>): string {
  return `---\nname: "${esc(s.name)}"\ndescription: "${esc(s.description)}"\nwhen_to_use: "${esc(s.whenToUse)}"\nversion: ${s.version}\ntags: [${s.tags.map((t) => `"${esc(t)}"`).join(', ')}]\norigin: ${esc(s.origin)}\n---\n\n${s.body.trim()}\n`;
}

export function systemSkillFile(s: SystemSkill): string {
  return `---\nname: "${esc(s.name)}"\ndescription: "${esc(s.description)}"\nwhen_to_use: "${esc(s.whenToUse)}"\norigin: system\nread_only: true\n---\n\n${s.body.trim()}\n`;
}

export function pluginSkillFile(k: PluginSkill, p: Pick<LotusPlugin, 'name' | 'version'>): string {
  return `---\nname: "${esc(k.name)}"\ndescription: "${esc(k.description)}"\nwhen_to_use: "${esc(k.whenToUse)}"\nplugin: "${esc(p.name)} ${p.version}"\n---\n\n${k.body.trim()}\n`;
}

/** Long-term memory as one Markdown document: standing instructions first, then facts. */
export function memoryFile(items: MemoryItem[]): string {
  const line = (m: MemoryItem) => `- ${m.text.replace(/\n+/g, ' ')}${m.source === 'auto' ? ' _(learned)_' : ''}`;
  const rules = items.filter((m) => m.kind === 'instruction');
  const facts = items.filter((m) => m.kind !== 'instruction');
  const parts = ['# Memory', '', `${items.length} item${items.length === 1 ? '' : 's'} · used when memory is on for a chat.`];
  parts.push('', '## Standing instructions', '', ...(rules.length ? rules.map(line) : ['_None yet. Say “from now on …” in a chat to add one._']));
  parts.push('', '## Facts', '', ...(facts.length ? facts.map(line) : ['_None yet. Say “remember …” in a chat, or let Lotus learn while memory is on._']));
  return parts.join('\n');
}

/** The persona Lotus uses: the system prompt from Settings, then any project soul files. */
export function soulFile(systemPrompt: string): string {
  return `# Lotus\n\nThe system prompt sent at the start of every chat (Settings → Models).\n\n---\n\n${systemPrompt.trim() || '_Empty: the model uses its own default persona._'}`;
}
