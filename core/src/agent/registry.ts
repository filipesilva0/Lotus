// The tool registry: every tool the agent can use, by dotted name, plus the helpers that turn them
// into Ollama's tool list and check the arguments a model sends.

import type { Tool } from './types';
import type { WireTool } from './llm';

export class Registry {
  private tools = new Map<string, Tool>();
  constructor(list: Tool[] = []) { list.forEach((t) => this.add(t)); }
  add(t: Tool) {
    if (!/^[a-z]+\.[a-z_]+$/.test(t.name)) throw new Error(`Bad tool name ${t.name}`);
    this.tools.set(t.name, t);
  }
  get(name: string): Tool | undefined { return this.tools.get(fromWire(name)); }
  list(): Tool[] { return [...this.tools.values()]; }
}

/** Ollama/OpenAI function names can't contain dots: task.add ↔ task_add. */
export const toWire = (name: string) => name.replace('.', '_');
export function fromWire(name: string): string {
  const n = String(name ?? '').trim().toLowerCase();
  if (n.includes('.')) return n;
  const i = n.indexOf('_');
  return i < 0 ? n : `${n.slice(0, i)}.${n.slice(i + 1)}`;
}

/** The schema as models see it (without Lotus's own `aliases`). */
function wireSchema(t: Tool) {
  const properties = Object.fromEntries(Object.entries(t.parameters.properties).map(([k, { aliases: _a, ...p }]) => [k, p]));
  return { ...t.parameters, properties };
}

export function wireTools(tools: Tool[]): WireTool[] {
  return tools.map((t) => ({ type: 'function', function: { name: toWire(t.name), description: t.description, parameters: wireSchema(t) } }));
}

const squash = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Checks and tidies a model's arguments: required ones present, numbers given as text converted,
 * enums respected, unknown keys dropped. Returns an error the model can act on.
 */
export function checkArgs(t: Tool, raw: Record<string, unknown>): { args: Record<string, unknown>; error?: string } {
  const out: Record<string, unknown> = {};
  const props = t.parameters.properties;
  for (const [k, p] of Object.entries(props)) {
    let v = raw?.[k];
    if (v === undefined || v === null || v === '') continue;
    if ((p.type === 'number' || p.type === 'integer') && typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) v = Number(v);
    if (p.type === 'integer' && typeof v === 'number') v = Math.round(v);
    if (p.type === 'boolean' && typeof v === 'string') v = /^(true|yes|1)$/i.test(v);
    if (p.type === 'string' && typeof v !== 'string') v = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (p.type === 'array' && typeof v === 'string') v = v.split(/\n|;/).map((x) => x.trim()).filter(Boolean);
    const okType = p.type === 'integer' ? typeof v === 'number' : p.type === 'array' ? Array.isArray(v) : typeof v === p.type;
    if (!okType) return { args: out, error: `${k} must be a ${p.type}.` };
    if (p.enum && !p.enum.includes(String(v))) {
      // "In progress", "to_do", "TODO" → the value meant (models rarely copy enums exactly).
      const want = squash(String(v));
      const hit = p.enum.find((e) => squash(e) === want) ?? Object.entries(p.aliases ?? {}).find(([a]) => squash(a) === want)?.[1];
      if (!hit) return { args: out, error: `${k} must be one of: ${p.enum.join(', ')}.` };
      v = hit;
    }
    out[k] = v;
  }
  for (const r of t.parameters.required ?? []) if (out[r] === undefined) return { args: out, error: `${t.name} needs ${r}.` };
  return { args: out };
}
