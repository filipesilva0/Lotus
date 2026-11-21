// Tool calls a model wrote inside its answer as JSON (0.15.1). Seen in the 0.15.0 review with
// Qwen 2.5 Coder 7B on the built-in engine: llama.cpp only reads <tool_call> tags for its template,
// and the model wrote
//   Let me look that up.
//   ```json
//   {"name": "web_search", "arguments": {"query": "…"}}
//   ```
// so the user saw the raw JSON as the answer and nothing ran. textCall (loop.ts) only catches a reply
// that is nothing but the call; this finds calls among other text.
//
// Only objects shaped like a call ({name, arguments|parameters} or {function: {…}}) whose name is a
// tool this run offers count, so ordinary JSON in an answer (a config example) is left alone.

import { matchingBrace, parseLoose } from '../../../src/chat/looseBlock';

export interface TextCall { name: string; args: Record<string, unknown> }

/** A call-shaped object → the call, or null. `strict`: arguments/parameters must be present. */
function asCall(j: unknown, strict: boolean): TextCall | null {
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  const o = j as Record<string, unknown>;
  const fn = (o.function && typeof o.function === 'object' ? o.function : o) as Record<string, unknown>;
  const name = typeof fn.name === 'string' ? fn.name.trim() : typeof o.tool === 'string' ? o.tool.trim() : '';
  if (!name) return null;
  const raw = fn.arguments ?? fn.parameters ?? o.arguments ?? o.parameters ?? o.args;
  if (strict && raw === undefined) return null;
  let args: unknown = raw ?? {};
  if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
  // Only these keys: a call has nothing else (an answer's JSON with a "name" field has more).
  const extra = Object.keys(o).filter((k) => !['name', 'function', 'arguments', 'parameters', 'args', 'tool', 'type', 'id'].includes(k));
  if (extra.length) return null;
  return { name, args: args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {} };
}

/** One object or a list of them → calls (all must be calls), or null. */
function callsFrom(j: unknown, strict: boolean): TextCall[] | null {
  const list = Array.isArray(j) ? j : [j];
  if (!list.length) return null;
  const out: TextCall[] = [];
  for (const x of list) { const c = asCall(x, strict); if (!c) return null; out.push(c); }
  return out;
}

const tryParse = (s: string): unknown => { try { return parseLoose(s); } catch { return undefined; } };

/**
 * Tool calls written as JSON anywhere in `text`, if every one names a known tool. Returns the calls
 * and the text without them, or null when there are none.
 */
export function callsInText(text: string, known: (name: string) => boolean): { calls: TextCall[]; text: string } | null {
  const spans: { start: number; end: number; calls: TextCall[] }[] = [];
  const taken = (i: number) => spans.some((s) => i >= s.start && i < s.end);
  const accept = (start: number, end: number, calls: TextCall[] | null) => {
    if (!calls || !calls.every((c) => known(c.name))) return;
    spans.push({ start, end, calls });
  };
  // 1. Fenced blocks (```json, ```tool_call, untagged) and <tool_call>…</tool_call> written as text.
  for (const m of text.matchAll(/```[ \t]*(json|tool_call|tool|javascript|js)?[ \t]*\n?([\s\S]*?)```|<tool_call>\s*([\s\S]*?)\s*(?:<\/tool_call>|$)/gi)) {
    const body = (m[2] ?? m[3] ?? '').trim();
    if (!/^[[{]/.test(body)) continue;
    let calls: TextCall[] | null = null;
    if (matchingBrace(body, 0) === body.length - 1) {
      const j = tryParse(body);
      calls = j === undefined ? null : callsFrom(j, !m[3]);
    } else {
      // Several calls in one block, one per line (JSON lines).
      const each = body.split(/\n(?=\s*\{)/).map((p) => { const x = tryParse(p); return x === undefined ? null : callsFrom(x, true); });
      calls = each.every(Boolean) ? each.flatMap((c) => c!) : null;
    }
    accept(m.index!, m.index! + m[0].length, calls);
  }
  // 2. Bare objects in the prose.
  for (let i = text.indexOf('{'); i >= 0; i = text.indexOf('{', i + 1)) {
    if (taken(i)) continue;
    const end = matchingBrace(text, i);
    if (end < 0) continue;
    const j = tryParse(text.slice(i, end + 1));
    if (j === undefined) continue;
    accept(i, end + 1, callsFrom(j, true));
    // A whole object was read: a call inside it ({"example": {"name": …}}) is part of it, not a call.
    i = end;
  }
  if (!spans.length) return null;
  spans.sort((a, b) => a.start - b.start);
  let rest = '';
  let at = 0;
  for (const s of spans) { rest += text.slice(at, s.start); at = s.end; }
  rest += text.slice(at);
  return { calls: spans.flatMap((s) => s.calls), text: rest.replace(/\n{3,}/g, '\n\n').trim() };
}
