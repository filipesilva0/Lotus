// Plugin types, kept apart from the store (which needs a browser) so pure code and tests can use them.

import type { PluginCredit } from './builtin/types';

export interface PluginCommand { name: string; description: string; prompt: string }
export interface PluginSkill { name: string; description: string; whenToUse: string; body: string }

export interface LotusPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  instructions: string;
  commands: PluginCommand[];
  skills: PluginSkill[];
  enabled: boolean;
  /** 0.21: 'builtin' plugins ship with Lotus (plugins/builtin); they can be switched off, not edited. */
  origin: 'created' | 'imported' | 'builtin';
  /** Where a built-in plugin comes from and under which licence. */
  credit?: PluginCredit;
  created: number;
  updated: number;
}
