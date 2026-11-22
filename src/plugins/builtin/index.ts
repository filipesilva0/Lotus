// The plugins that ship with Lotus (0.21). See builtin/types.ts for where they come from.

import { CODE } from './code';
import { CAVEMAN, SITE_AUDIT } from './community';
import { DESIGN } from './design';
import { DOCUMENTS } from './documents';
import { GLOBE } from './globe';
import { SUPERPOWERS } from './superpowers';
import { TOOLKIT } from './toolkit';
import { WRITING } from './writing';
import type { BuiltinPluginDef } from './types';
import type { LotusPlugin } from '../types';

export type { BuiltinPluginDef, PluginCredit } from './types';

export const BUILTIN_PLUGINS: BuiltinPluginDef[] = [SUPERPOWERS, DESIGN, DOCUMENTS, WRITING, CODE, TOOLKIT, SITE_AUDIT, GLOBE, CAVEMAN];

export const isBuiltinId = (id: string) => id.startsWith('builtin-');

/** The built-in plugins as installed plugins, with the user's on/off choices applied. */
export function builtinPlugins(choices: Record<string, boolean> = {}): LotusPlugin[] {
  return BUILTIN_PLUGINS.map((d) => ({
    id: d.id, name: d.name, version: d.version, description: d.description, author: d.author,
    instructions: d.instructions, commands: d.commands, skills: d.skills, credit: d.credit,
    enabled: typeof choices[d.id] === 'boolean' ? choices[d.id] : d.defaultOn,
    origin: 'builtin', created: 0, updated: 0,
  }));
}

/**
 * Skills and plugins Claude has that were NOT brought into Lotus, and why. Shown nowhere in the app;
 * kept here so the list is reviewed with the code (and checked by the tests).
 */
export const NOT_BROUGHT_OVER: { name: string; why: string }[] = [
  { name: 'using-superpowers, diagnosing-superpowers', why: 'About Claude Code sessions themselves; Lotus picks skills automatically.' },
  { name: 'using-git-worktrees, finishing-a-development-branch', why: 'Need git and a terminal, which Lotus does not have.' },
  { name: 'docs, google-workspace', why: 'Need Claude Docs or Google Drive connectors.' },
  { name: 'morning', why: 'Needs calendar and email connectors. Lotus Routines can run a daily summary instead.' },
  { name: 'chrome-browser, built-in-browser, computer-use', why: 'About Claude’s own apps; Lotus has its own browser and computer tools with their own instructions.' },
  { name: 'artifact-capabilities, artifact-diagramming, artifact-design', why: 'claude.ai page features. The design and diagram parts became web-page-design and diagrams.' },
  { name: 'claude-api, update-config, keybindings-help, fewer-permission-prompts, init, run, session-start-hook, plugin-authoring', why: 'Settings and tools of Claude Code itself; Lotus has its own plugin creator.' },
  { name: 'God’s Eye View (the app itself)', why: 'A whole 3D globe app with its own server; Lotus connects to it as a tool server instead (Globe plugin). Its bundled datasets are not MIT and some are non-commercial.' },
  { name: 'loop', why: 'Lotus Routines already repeat work on a schedule.' },
  { name: 'skill-creator', why: 'Merged into writing-skills (Superpowers).' },
  { name: 'dispatching-parallel-agents, subagent-driven-development', why: 'Merged into delegating-to-helpers (Superpowers).' },
];
