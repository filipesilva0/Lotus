// Plugin creator: asks the local model, guided by the built-in plugin-creator skill, to draft a
// plugin from a plain-language idea. The draft is validated (plugins/store.ts) before the user can
// install it; nothing is installed without the user pressing Install.

import { agentPool } from '../agents/pool';
import { extractJson, llm } from '../services/llm';
import { PLUGIN_CREATOR_SKILL } from '../skills/system';
import { plugins, validatePlugin, Validation } from './store';

export interface DraftResult extends Validation { raw: unknown }

/** The messages sent to the model (exported for tests). */
export function creatorTurns(idea: string, previous?: unknown, feedback?: string) {
  const turns: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: PLUGIN_CREATOR_SKILL },
    { role: 'user', content: `Plugin idea:\n${idea.trim()}` },
  ];
  if (previous && feedback?.trim()) {
    turns.push({ role: 'assistant', content: JSON.stringify(previous) });
    turns.push({ role: 'user', content: `Change the plugin: ${feedback.trim()}\nReply with the full updated JSON object only.` });
  }
  return turns;
}

/** Drafts (or revises) a plugin. Runs in the agent pool as user-started work. */
export function draftPlugin(idea: string, o: { previous?: unknown; feedback?: string; signal?: AbortSignal } = {}): Promise<DraftResult> {
  return agentPool.run('Creating a plugin', 'task', async ({ model, numCtx, signal }) => {
    if (!model) throw new Error('No chat model is installed. Download one in Models first.');
    const r = await llm.chatOnce(creatorTurns(idea, o.previous, o.feedback), { model, numCtx, temperature: 0.3, json: true, signal, numPredict: 2000 });
    const raw = extractJson(r.content);
    if (!raw) return { raw: null, plugin: null, errors: ['The model did not reply with a plugin. Try again, or describe the idea in more detail.'], warnings: [] };
    return { raw, ...validatePlugin(raw, plugins.get()) };
  }, { priority: 0, signal: o.signal });
}
