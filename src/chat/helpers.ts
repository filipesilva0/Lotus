import { ChatMessage, ChatSession, ContextItem, ContextChunk } from '../types/lotus';
import { uid } from '../lib/persist';

export const estimateTokens = (s: string) => Math.ceil(s.length / 4);

export const TEXT_EXT = /\.(txt|md|markdown|json|csv|tsv|log|ya?ml|toml|ini|xml|html?|css|scss|js|jsx|ts|tsx|py|rs|go|java|c|h|cpp|hpp|cs|rb|php|sh|ps1|bat|sql|tex)$/i;

/** Split text into ~1,500-character chunks on paragraph or line boundaries. */
export function chunkText(text: string, size = 1500): ContextChunk[] {
  const out: ContextChunk[] = [];
  let cur = '';
  for (const line of text.split('\n')) {
    if (cur.length + line.length + 1 > size && cur) { out.push({ id: uid('ck'), text: cur, on: true }); cur = ''; }
    cur += (cur ? '\n' : '') + line;
    while (cur.length > size * 2) { out.push({ id: uid('ck'), text: cur.slice(0, size), on: true }); cur = cur.slice(size); }
  }
  if (cur.trim()) out.push({ id: uid('ck'), text: cur, on: true });
  return out;
}

export function contextItemFromText(name: string, text: string): ContextItem {
  return { id: uid('ctx'), name, kind: 'file', chunks: chunkText(text) };
}

/** Text that is sent with each request: enabled chunks only, plus any @mentioned files forced on. */
export function contextPayload(items: ContextItem[] | undefined, force: string[] = []): string {
  const parts = (items ?? []).map((it) => {
    const forced = force.includes(it.name);
    const t = it.chunks.filter((c) => c.on || forced).map((c) => c.text).join('\n…\n');
    return t ? `### ${it.name}\n${t}` : '';
  }).filter(Boolean);
  return parts.length ? `\n\nThe user mounted these references. Use them when relevant:\n\n${parts.join('\n\n')}` : '';
}

export function contextTokens(items: ContextItem[] | undefined): number {
  return estimateTokens((items ?? []).flatMap((i) => i.chunks.filter((c) => c.on)).map((c) => c.text).join(''));
}

/** Explicit, deterministic triggers only: the user must say "remember …" or "from now on …". */
export function detectMemory(text: string): { kind: 'memory' | 'instruction'; text: string } | null {
  const t = text.trim();
  const rem = t.match(/^(?:please\s+)?remember(?:\s+that)?[:,]?\s+(.{3,240})$/i);
  if (rem) return { kind: 'memory', text: rem[1].replace(/[.!\s]+$/, '') };
  const ins = t.match(/^(?:from now on|going forward|always)[,:]?\s+(.{3,240})$/i);
  if (ins) return { kind: 'instruction', text: ins[1].replace(/[.!\s]+$/, '') };
  return null;
}

export function artifactsFrom(messages: ChatMessage[]): { id: string; lang: string; code: string; msgId: string; title: string }[] {
  const out: { id: string; lang: string; code: string; msgId: string; title: string }[] = [];
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    const re = /```([a-zA-Z0-9+#-]*)\n([\s\S]*?)(```|$)/g;
    let x: RegExpExecArray | null, i = 0;
    while ((x = re.exec(m.content))) {
      const lang = (x[1] || 'text').toLowerCase();
      if (x[2].trim().split('\n').length < 3 && !['html', 'svg'].includes(lang)) continue;
      out.push({ id: `${m.id}-${i}`, lang, code: x[2], msgId: m.id, title: `${lang.toUpperCase()} · ${x[2].trim().split('\n')[0].slice(0, 36) || 'snippet'}` });
      i++;
    }
  }
  return out;
}

export const newSession = (model: string, extra: Partial<ChatSession> = {}): ChatSession => ({
  id: uid('chat'), title: 'New conversation', model, updatedAt: 'Just now', category: 'General', ts: Date.now(), messages: [], ...extra,
});
