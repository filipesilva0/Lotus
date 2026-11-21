// Built-in plugins (0.21): skills and slash commands that ship with Lotus.
//
// They were brought over from the skills and plugins Claude uses, adapted for small local models:
// short bodies, plain triggers, and only the tools Lotus really has (files.*, web.*, browser.*,
// plan.set/plan.check, artifact.write, agent.delegate, agents.deploy, memory.save, ask.user …).
//
// Licences: MIT sources (superpowers, caveman, site-audit) are adapted and keep their copyright
// notice in `credit` and in THIRD_PARTY_LICENSES.md. Everything else is written from scratch for
// Lotus and only does the same job; no text was copied from proprietary or unclear sources.

import type { PluginCommand, PluginSkill } from '../types';

export interface PluginCredit {
  /** Who made the original, as their licence asks to be credited. */
  by: string;
  /** "MIT" for adapted open-source plugins, "Original" for Lotus's own versions. */
  license: 'MIT' | 'Original';
  url?: string;
  /** One plain sentence shown under the plugin. */
  note: string;
}

export interface BuiltinPluginDef {
  /** Stable id, `builtin-<slug>`; never changes, the on/off state is stored under it. */
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  instructions: string;
  commands: PluginCommand[];
  skills: PluginSkill[];
  /** On when the user has not chosen. Plugins with standing instructions start off. */
  defaultOn: boolean;
  credit: PluginCredit;
}
