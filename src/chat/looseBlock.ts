// Finding the JSON blocks models add for Lotus's cards (```choices, ```image), even when the model
// doesn't write them exactly as asked (0.11.0). Seen from real models:
//   - the block tagged ```json (or untagged) instead of ```choices / ```image
//   - no fence at all: the JSON object pasted at the end of the reply
//   - the closing fence on the same line as the last brace: }```
//   - JSON with trailing commas, // comments, 'single quotes', “smart quotes” or unquoted keys
// Pure functions only, so the core's tests can import them.

export interface FoundBlock {
  /** Index where the block starts (its opening fence, or the first brace). */
  start: number;
  /** Index just after it ends. */
  end: number;
  /** The parsed JSON (null while still streaming). */
  json: unknown;
  /** The block's JSON could not be read even loosely. */
  broken: boolean;
  /** An opening fence for this card that hasn't closed yet (still streaming). */
  pending: boolean;
  /** Found by its own tag (```choices, ```image), not guessed from a json block or bare object. */
  tagged?: boolean;
}

/** JSON.parse, then a forgiving second try for the usual mistakes models make. */
export function parseLoose(text: string): unknown {
  const t = text.trim();
  try { return JSON.parse(t); } catch { /* try harder */ }
  let s = t
    .replace(/[“”„‟″]/g, '"').replace(/[‘’‚‛′]/g, "'")
    // Comments outside strings (good enough for model output: strings rarely hold "//" before a quote).
    .replace(/^\s*\/\/.*$/gm, '').replace(/,\s*\/\/[^\n"]*$/gm, ',')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  // 'single-quoted' strings → "double-quoted".
  s = s.replace(/'((?:[^'\\\n]|\\.)*)'(?=\s*[:,}\]])/g, (_m, inner: string) => `"${inner.replace(/\\'/g, "'").replace(/"/g, '\\"')}"`);
  // Unquoted keys.
  s = s.replace(/([{,]\s*)([A-Za-z_][\w-]*)(\s*:)/g, '$1"$2"$3');
  // Trailing commas.
  s = s.replace(/,(\s*[}\]])/g, '$1');
  // Python/JS literals.
  s = s.replace(/:\s*True\b/g, ': true').replace(/:\s*False\b/g, ': false').replace(/:\s*None\b/g, ': null');
  try { return JSON.parse(s); } catch { /* fall through */ }
  // Text after the object ("{…} Let me know!"): cut at the matching brace.
  const end = matchingBrace(s, s.search(/[{[]/));
  if (end > 0) { try { return JSON.parse(s.slice(s.search(/[{[]/), end + 1)); } catch { /* give up */ } }
  throw new SyntaxError('Not JSON');
}

/** Index of the brace/bracket closing the one at `from` (strings respected), or -1. */
export function matchingBrace(s: string, from: number): number {
  if (from < 0) return -1;
  let depth = 0, inStr = false, esc = false;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

const FENCE_OPEN = /(^|\n)[ ]{0,3}(`{3,}|~{3,})[ \t]*([\w+-]*)[^\n]*\n/g;

/**
 * Finds the card block in a reply: first a fence tagged with one of `tags`, then a ```json / untagged
 * fence whose JSON `fits`, then a bare JSON object at the very end of the reply that `fits`.
 */
export function findCardBlock(content: string, tags: string[], fits: (json: unknown) => boolean, streamingHint?: RegExp): FoundBlock | null {
  const fences: { start: number; bodyStart: number; tag: string; fence: string }[] = [];
  FENCE_OPEN.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = FENCE_OPEN.exec(content));) {
    fences.push({ start: m.index + m[1].length, bodyStart: m.index + m[0].length, tag: m[3].toLowerCase(), fence: m[2] });
    // Skip past this block's closing fence so code inside isn't read as an opening one.
    const close = closeAt(content, m.index + m[0].length, m[2]);
    FENCE_OPEN.lastIndex = close ? close.end : content.length;
  }
  const read = (f: typeof fences[number]): FoundBlock => {
    const close = closeAt(content, f.bodyStart, f.fence);
    if (!close) return { start: f.start, end: content.length, json: null, broken: false, pending: true };
    const body = content.slice(f.bodyStart, close.bodyEnd);
    try { return { start: f.start, end: close.end, json: parseLoose(body), broken: false, pending: false }; }
    catch { return { start: f.start, end: close.end, json: null, broken: true, pending: false }; }
  };
  const tagged = fences.find((f) => tags.includes(f.tag));
  if (tagged) return { ...read(tagged), tagged: true };
  for (const f of fences) {
    if (f.tag && !['json', 'jsonc', 'json5', 'javascript', 'js'].includes(f.tag)) continue;
    const b = read(f);
    if (b.pending) {
      // An untagged/json block still streaming: hide it only when it already looks like this card.
      if (streamingHint && streamingHint.test(content.slice(f.bodyStart))) return b;
      continue;
    }
    if (!b.broken && fits(b.json)) return b;
  }
  // A bare object closing the reply.
  const trimmed = content.replace(/\s+$/, '');
  if (trimmed.endsWith('}')) {
    for (let i = trimmed.lastIndexOf('\n{'); i >= -1; i = i > 0 ? trimmed.lastIndexOf('\n{', i - 1) : -2) {
      const from = i === -1 ? (trimmed.startsWith('{') ? 0 : -1) : i + 1;
      if (from < 0) break;
      if (matchingBrace(trimmed, from) !== trimmed.length - 1) continue;
      try {
        const json = parseLoose(trimmed.slice(from));
        if (fits(json)) return { start: from, end: content.length, json, broken: false, pending: false };
      } catch { /* not this one */ }
    }
  }
  return null;
}

/** The fence closing a block that opened with `fence`, searching from `from`; also "}```" on one line. */
function closeAt(content: string, from: number, fence: string): { bodyEnd: number; end: number } | null {
  const ch = fence[0] === '`' ? '`' : '~';
  const re = new RegExp(`(\\n[ ]{0,3}|[}\\]][ \\t]*)(${ch === '`' ? '`' : '~'}{${fence.length},})[ \\t]*(?=\\n|$)`, 'g');
  re.lastIndex = Math.max(0, from - 1);
  const m = re.exec(content);
  if (!m) return null;
  const lead = m[1];
  // When the fence follows a brace on the same line, the brace belongs to the body.
  const bodyEnd = lead.startsWith('\n') ? m.index : m.index + 1;
  let end = m.index + m[0].length;
  if (content[end] === '\n') end++;
  return { bodyEnd, end };
}

/** The reply with the block cut out (text after it kept). */
export function withoutBlock(content: string, b: Pick<FoundBlock, 'start' | 'end'>): string {
  const before = content.slice(0, b.start).replace(/\s+$/, '');
  const after = content.slice(b.end).trim();
  return (before + (after ? `\n\n${after}` : '')).trim();
}
