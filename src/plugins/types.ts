// Plugin types, kept apart from the store (which needs a browser) so pure code and tests can use them.

import type { PluginCredit } from './builtin/types';

export interface PluginCommand { name: string; description: string; prompt: string }
export interface PluginSkill {
  name: string; description: string; whenToUse: string; body: string;
  /**
   * Built-in skills only (0.21): words or short phrases that are enough on their own to pick the
   * skill ("logo", "app icon"), for subjects a message often names in one word. Every word of a
   * phrase must be in the message. User plugins can't set these.
   */
  anchors?: string[];
}

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
