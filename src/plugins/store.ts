// Custom plugins (session 7).
//
// A Lotus plugin is a small, local bundle that changes how chat behaves. It can hold:
//   • instructions — added to the system prompt of every chat while the plugin is on
//   • commands     — slash commands (/name text) that expand to a prompt template ({{input}})
//   • skills       — reference notes loaded into a reply only when the question matches them
// Plugins are data, not code: nothing in a plugin runs on the PC, so an imported plugin cannot do
// anything a typed prompt could not. They are stored in lotus.db (`lotus.plugins.v1`) and can be
// exported/imported as `.lotus-plugin.json` files. The plugin creator (plugins/creator.ts) drafts them.

import { useSyncExternalStore } from 'react';
import { uid } from '../lib/persist';
import { kv } from '../lib/store';
import { buildPluginBlock } from './block';
import { builtinPlugins, isBuiltinId } from './builtin';

import type { LotusPlugin, PluginCommand, PluginSkill } from './types';
export type { LotusPlugin, PluginCommand, PluginSkill } from './types';

/** File format for export/import. */
export interface PluginFile { lotusPlugin: 1; name: string; version: string; description: string; author?: string; instructions?: string; commands?: PluginCommand[]; skills?: PluginSkill[] }

const KEY = 'lotus.plugins.v1';
/** On/off choices for the built-in plugins, by id (only the ones the user changed). */
const BUILTIN_KEY = 'lotus.plugins.builtin.v1';
export const LIMITS = { name: 48, description: 280, instructions: 4000, commands: 12, skills: 12, prompt: 4000, skillBody: 8000 } as const;

/** Built-in slash commands a plugin may not take over. Kept in sync with SLASH in Composer.tsx. */
export const RESERVED_COMMANDS = ['new', 'clear', 'incognito', 'research', 'search', 'think', 'web', 'memory', 'model', 'temp', 'seed', 'system', 'pin', 'plugins', 'library'];

const s = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
export const commandSlug = (v: string) => v.toLowerCase().replace(/^\//, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

export interface Validation { plugin: Omit<LotusPlugin, 'id' | 'enabled' | 'origin' | 'created' | 'updated'> | null; errors: string[]; warnings: string[] }

/**
 * Checks a plugin draft (from the creator, an import, or the editor) and returns a clean copy.
 * Errors block installing; warnings are fixed automatically and shown to the user.
 */
export function validatePlugin(raw: unknown, others: Pick<LotusPlugin, 'commands' | 'name'>[] = []): Validation {
  const errors: string[] = [], warnings: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { plugin: null, errors: ['This is not a plugin: expected a JSON object.'], warnings };
  const r = raw as Record<string, unknown>;
  const name = s(r.name, LIMITS.name);
  if (!name) errors.push('The plugin needs a name.');
  const description = s(r.description, LIMITS.description);
  if (!description) errors.push('Add a one-line description of what the plugin does.');
  const instructions = s(r.instructions, LIMITS.instructions);
  if (typeof r.instructions === 'string' && r.instructions.trim().length > LIMITS.instructions) warnings.push(`Instructions were cut to ${LIMITS.instructions} characters.`);

  const taken = new Set(others.flatMap((p) => p.commands.map((c) => c.name)));
  const cmds: PluginCommand[] = [];
  for (const c of (Array.isArray(r.commands) ? r.commands : []).slice(0, LIMITS.commands) as Record<string, unknown>[]) {
    if (!c || typeof c !== 'object') continue;
    const n = commandSlug(s(c.name, 40));
    const prompt = s(c.prompt ?? c.template, LIMITS.prompt);
    if (!n || !prompt) { warnings.push('A command without a name or prompt was skipped.'); continue; }
    if (RESERVED_COMMANDS.includes(n)) { errors.push(`/${n} is a built-in Lotus command. Rename the plugin's command.`); continue; }
    if (taken.has(n) || cmds.some((x) => x.name === n)) { errors.push(`/${n} is already used by another plugin command.`); continue; }
    cmds.push({ name: n, description: s(c.description, 160) || `Runs the ${name} plugin`, prompt });
  }
  if (Array.isArray(r.commands) && r.commands.length > LIMITS.commands) warnings.push(`Only the first ${LIMITS.commands} commands were kept.`);

  const skills: PluginSkill[] = [];
  for (const k of (Array.isArray(r.skills) ? r.skills : []).slice(0, LIMITS.skills) as Record<string, unknown>[]) {
    if (!k || typeof k !== 'object') continue;
    const sk = { name: s(k.name, 60), description: s(k.description, 200), whenToUse: s(k.whenToUse ?? k.when_to_use, 300), body: s(k.body ?? k.content, LIMITS.skillBody) };
    if (!sk.name || !sk.body) { warnings.push('A skill without a name or body was skipped.'); continue; }
    skills.push(sk);
  }
  if (!instructions && !cmds.length && !skills.length) errors.push('A plugin needs instructions, at least one command, or at least one skill.');
  if (others.some((p) => p.name.toLowerCase() === name.toLowerCase())) errors.push(`A plugin called “${name}” is already installed.`);

  const version = /^\d+(\.\d+){0,2}$/.test(s(r.version, 20)) ? s(r.version, 20) : '1.0.0';
  return {
    plugin: errors.length ? null : { name, version, description, author: s(r.author, 60), instructions, commands: cmds, skills },
    errors, warnings,
  };
}

// ── store ─────────────────────────────────────────────────────────────────

function load(): LotusPlugin[] {
  try { const v = JSON.parse(kv.getItem(KEY) || '[]'); return Array.isArray(v) ? v.filter((p) => p && !isBuiltinId(String(p.id))) : []; } catch { return []; }
}
function loadChoices(): Record<string, boolean> {
  try { const v = JSON.parse(kv.getItem(BUILTIN_KEY) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
}
let list: LotusPlugin[] = load();
let choices = loadChoices();
/** The user's plugins first, then the built-in ones. One array per change, for useSyncExternalStore. */
let all: LotusPlugin[] = [...list, ...builtinPlugins(choices)];
const subs = new Set<() => void>();
function refresh() { all = [...list, ...builtinPlugins(choices)]; subs.forEach((f) => f()); }
function commit(next: LotusPlugin[]) {
  list = next;
  try { kv.setItem(KEY, JSON.stringify(list)); } catch { /* quota */ }
  refresh();
}

export const plugins = {
  get: () => all,
  subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; },
  /** Re-reads storage (another window or a test changed it). */
  reload: () => { list = load(); choices = loadChoices(); refresh(); },
  install(raw: unknown, origin: Exclude<LotusPlugin['origin'], 'builtin'>): Validation & { id?: string } {
    const v = validatePlugin(raw, all);
    if (!v.plugin) return v;
    const t = Date.now();
    const p: LotusPlugin = { ...v.plugin, id: uid('plg'), enabled: true, origin, created: t, updated: t };
    commit([p, ...list]);
    return { ...v, id: p.id };
  },
  update(id: string, raw: unknown): Validation {
    if (isBuiltinId(id)) return { plugin: null, errors: ['Built-in plugins can’t be edited. Switch it off, or create your own plugin.'], warnings: [] };
    const cur = list.find((p) => p.id === id);
    if (!cur) return { plugin: null, errors: ['That plugin is no longer installed.'], warnings: [] };
    const v = validatePlugin(raw, all.filter((p) => p.id !== id));
    if (v.plugin) commit(list.map((p) => (p.id === id ? { ...p, ...v.plugin, updated: Date.now() } : p)));
    return v;
  },
  setEnabled(id: string, enabled: boolean) {
    if (isBuiltinId(id)) {
      choices = { ...choices, [id]: enabled };
      try { kv.setItem(BUILTIN_KEY, JSON.stringify(choices)); } catch { /* quota */ }
      refresh();
      return;
    }
    commit(list.map((p) => (p.id === id ? { ...p, enabled } : p)));
  },
  /** Built-in plugins can't be removed (switch them off instead). */
  remove(id: string) { if (!isBuiltinId(id)) commit(list.filter((p) => p.id !== id)); },
};

export function usePlugins(): LotusPlugin[] {
  return useSyncExternalStore(plugins.subscribe, plugins.get, plugins.get);
}

export function toFile(p: LotusPlugin): PluginFile {
  return { lotusPlugin: 1, name: p.name, version: p.version, description: p.description, author: p.author || undefined, instructions: p.instructions || undefined, commands: p.commands, skills: p.skills };
}

/** Accepts a plugin file, or a bare plugin object (as the creator returns). */
export function fromFileText(text: string): unknown {
  const v = JSON.parse(text) as Record<string, unknown>;
  return v && typeof v === 'object' && 'plugin' in v && typeof v.plugin === 'object' ? v.plugin : v;
}

// ── chat integration ───────────────────────────────────────────────────────

export interface PluginSlash { name: string; help: string; args: string; plugin: string; prompt: string }

/** Slash commands from enabled plugins, for the composer menu. */
export function pluginCommands(from: LotusPlugin[] = all): PluginSlash[] {
  // A plugin made before 0.21 may use a name a built-in plugin now has: the user's own comes first and wins.
  const seen = new Set<string>();
  return from.filter((p) => p.enabled).flatMap((p) => p.commands.map((c) => ({ name: c.name, help: `${c.description} · ${p.name}`, args: c.prompt.includes('{{input}}') ? '<text>' : '', plugin: p.name, prompt: c.prompt })))
    .filter((c) => (seen.has(c.name) ? false : (seen.add(c.name), true)));
}

/** Fills a command template. Without {{input}}, the user's text is appended after the template. */
export function expandCommand(prompt: string, input: string): string {
  const i = input.trim();
  if (prompt.includes('{{input}}')) return prompt.split('{{input}}').join(i).trim();
  return i ? `${prompt.trim()}\n\n${i}` : prompt.trim();
}

/**
 * Text added to the system prompt: the instructions of every enabled plugin (capped), plus the
 * plugin skills that match this message (at most two). See plugins/block.ts.
 */
export function pluginSystemBlock(query: string, from: LotusPlugin[] = all, budget = 6000): string {
  return buildPluginBlock(query, from, budget);
}
