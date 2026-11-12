// Tool calls for models without native tool calling (and for llama.cpp servers): the model writes
//   <tool name="task.add">{"title": "Buy milk"}</tool>
// and gets the result back as a user turn starting "Tool result". Same idea as the App Builder's tag
// protocol (builder/protocol.ts), kept separate because its tags edit project files.

import type { Tool } from './types';

export interface TagCall { name: string; args: Record<string, unknown>; error?: string }

export function tagInstructions(tools: Tool[]): string {
  const list = tools.map((t) => {
    const props = Object.entries(t.parameters.properties).map(([k, p]) => `${k}${t.parameters.required?.includes(k) ? '' : '?'}: ${p.type}${p.enum ? ` (${p.enum.join(' | ')})` : ''} — ${p.description}`).join('; ');
    return `- ${t.name}: ${t.description}${props ? ` Arguments: ${props}.` : ''}`;
  }).join('\n');
  return `\n\nYou can use tools. To use one, write a tag on its own line and then stop writing:\n<tool name="TOOL NAME">{"argument": "value"}</tool>\nThe result comes back in the next message. Use a tool whenever the user asks you to do something a tool can do; never say you did something without using the tool and seeing its result. You may use several tools one after another. When you are finished, answer normally without a tag.\n\nTools:\n${list}`;
}

/** The first balanced {...} in a string (models sometimes add text around the JSON). */
function firstObject(s: string): string | null {
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return s.slice(start, i + 1);
  }
  return null;
}

const TAG = /<tool\s+name\s*=\s*["']([a-z_.]+)["']\s*>([\s\S]*?)(?:<\/tool>|$)/gi;

/** Calls in a finished reply, and the reply with the tags taken out. */
export function parseTags(text: string): { calls: TagCall[]; text: string } {
  const calls: TagCall[] = [];
  const rest = text.replace(TAG, (_m, name: string, body: string) => {
    const raw = body.trim();
    if (!raw) { calls.push({ name, args: {} }); return ''; }
    const obj = firstObject(raw);
    try { calls.push({ name, args: obj ? JSON.parse(obj) : {} }); }
    catch { calls.push({ name, args: {}, error: 'The arguments were not valid JSON.' }); }
    return '';
  });
  return { calls, text: rest.replace(/\n{3,}/g, '\n\n').trim() };
}

/**
 * Streams text through, holding back anything that may be the start of a <tool …> tag, so the chat
 * never shows half a tag. `push` returns what can be shown now; `end` returns the rest (tags removed).
 */
export class TagFilter {
  private held = '';
  private inTag = false;
  push(chunk: string): string {
    let out = '';
    this.held += chunk;
    for (;;) {
      if (this.inTag) {
        const close = this.held.indexOf('</tool>');
        if (close < 0) return out;
        this.held = this.held.slice(close + 7);
        this.inTag = false;
        continue;
      }
      const lt = this.held.indexOf('<');
      if (lt < 0) { out += this.held; this.held = ''; return out; }
      out += this.held.slice(0, lt);
      this.held = this.held.slice(lt);
      if (/^<tool[\s>]/i.test(this.held)) { this.inTag = true; continue; }
      if ('<tool'.startsWith(this.held.slice(0, 5).toLowerCase()) && this.held.length < 6) return out; // maybe a tag: wait
      out += this.held[0];
      this.held = this.held.slice(1);
    }
  }
  end(): string { const rest = this.inTag ? '' : this.held; this.held = ''; this.inTag = false; return rest; }
}
