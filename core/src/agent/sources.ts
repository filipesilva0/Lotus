// Sources the agent really found (pure, tested). 0.16.0 hands-on test: every Work researcher came
// back empty, the brief was written from the model's memory with made-up references, and Lotus still
// said it was done "with a Reference List". So Lotus keeps track of the web addresses that really came
// back from a search or a page this run, and:
//   - a saved document may only link to those (artifact.write is refused once, then cleaned);
//   - a document can't have a reference list when nothing was found;
//   - a reply can't claim references or citations when nothing was found.

/** Web addresses in a text, as written (trailing punctuation dropped). */
export function urlsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of String(text ?? '').matchAll(/https?:\/\/[^\s<>"'`()\]\[]+/gi)) {
    const u = m[0].replace(/[.,;:!?*_]+$/, '');
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

/** One form per page: lower-case host, no www, no fragment, no query, no trailing slash. */
export function normUrl(u: string): string {
  try {
    const x = new URL(u);
    return `${x.hostname.toLowerCase().replace(/^www\./, '')}${x.pathname.replace(/\/+$/, '')}`;
  } catch { return u.toLowerCase(); }
}
const hostOf = (n: string) => n.split('/')[0];

/** What this run really found: each page's address, and the sites they were on. */
export class SeenSources {
  private pages = new Set<string>();
  private hosts = new Set<string>();
  add(urls: string[]) { for (const u of urls) { const n = normUrl(u); this.pages.add(n); this.hosts.add(hostOf(n)); } }
  get size() { return this.pages.size; }
  /** The page itself, or a site's front page when a page of that site was found. */
  has(u: string) { const n = normUrl(u); return this.pages.has(n) || (!n.includes('/') && this.hosts.has(n)); }
}

const REF_HEADING = String.raw`(?:references?|reference list|sources?(?: cited)?|bibliography|works cited|citations|further reading|refer[êe]ncias|bibliografia|fontes)`;
const MD_REF = new RegExp(String.raw`^(#{1,6})\s*(?:\d+\.?\s*)?\**${REF_HEADING}\**\s*:?\s*$`, 'im');
const HTML_REF = new RegExp(String.raw`<h([1-6])\b[^>]*>\s*(?:\d+\.?\s*)?${REF_HEADING}\s*:?\s*</h\1>`, 'i');

/** Where a document's reference list is: from its heading to the next heading of the same level or higher. */
export function referenceSection(content: string): { start: number; end: number } | null {
  const md = MD_REF.exec(content);
  if (md) {
    const level = md[1].length;
    const rest = content.slice(md.index + md[0].length);
    const next = new RegExp(String.raw`^#{1,${level}}\s`, 'm').exec(rest);
    return { start: md.index, end: next ? md.index + md[0].length + next.index : content.length };
  }
  const h = HTML_REF.exec(content);
  if (h) {
    const rest = content.slice(h.index + h[0].length);
    const next = new RegExp(String.raw`<h[1-${h[1]}]\b|</(?:section|article|main|body)>`, 'i').exec(rest);
    return { start: h.index, end: next ? h.index + h[0].length + next.index : content.length };
  }
  return null;
}

const TEXT_DOC = /\.(?:md|markdown|txt)$/i;

export interface RefCheck { invented: string[]; refsWithoutSources: boolean }

/**
 * Links in a document that no search or page in this run returned, and whether it has a reference list
 * although nothing at all was found. Text documents are checked whole; other files (a web page can link
 * its fonts and scripts) only in their reference list.
 */
export function checkReferences(file: string, content: string, seen: SeenSources): RefCheck {
  const section = referenceSection(content);
  const scope = TEXT_DOC.test(file) ? content : section ? content.slice(section.start, section.end) : '';
  const invented = urlsIn(scope).filter((u) => !seen.has(u));
  return { invented, refsWithoutSources: !!section && seen.size === 0 };
}

/** The document with invented links and (when nothing was found) its reference list taken out, and a plain note. */
export function cleanReferences(file: string, content: string, check: RefCheck): string {
  let out = content;
  let removedList = false;
  if (check.refsWithoutSources) {
    const s = referenceSection(out);
    if (s) { out = out.slice(0, s.start).replace(/\s+$/, '') + '\n' + out.slice(s.end); removedList = true; }
  }
  let lines = 0;
  if (check.invented.length) {
    out = out.split('\n').filter((line) => {
      const bad = check.invented.some((u) => line.includes(u));
      if (bad) lines++;
      return !bad;
    }).join('\n');
  }
  if (!removedList && !lines) return content;
  const what = removedList
    ? 'No sources were found while this was made, so Lotus removed its reference list. The content above comes from the model\'s own knowledge and has not been checked against sources.'
    : `Lotus removed ${lines} link${lines === 1 ? '' : 's'} that didn't come from any search or page opened while this was made.`;
  if (/\.html?$/i.test(file)) {
    const note = `<p><em>Note: ${what}</em></p>`;
    return /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `${note}\n</body>`) : `${out.trimEnd()}\n${note}\n`;
  }
  return `${out.trimEnd()}\n\n---\n*Note: ${what}*\n`;
}

/** What the model is told when it tries to save made-up links or an unsupported reference list. */
export function refusalText(check: RefCheck): string {
  const parts: string[] = [];
  if (check.refsWithoutSources) parts.push('No web sources were found in this work, so the document must not have a references, sources or bibliography section. Remove it, and say plainly in the document that it was written without sources.');
  if (check.invented.length) parts.push(`These links did not come from any search result or page opened in this work: ${check.invented.slice(0, 8).join(', ')}${check.invented.length > 8 ? ', …' : ''}. Remove them; only cite pages that a tool result really returned.`);
  return `Not saved. ${parts.join(' ')} Then call artifact.write again with the corrected content.`;
}

/** A reply that says it has references, citations or sources ("…with a Reference List", "fully cited"). */
export function claimsSources(text: string): boolean {
  for (const s of String(text ?? '').split(/(?<=[.!?])\s+|\n+/)) {
    const m = /\b(?:reference list|references|bibliography|citations|works cited|sources cited|cited sources|cited|referenced|refer[êe]ncias|bibliografia|fontes citadas)\b/i.exec(s);
    if (!m) continue;
    const before = s.slice(0, m.index + m[0].length);
    if (/\b(?:no|not|without|none|never|couldn't|could not|didn't|did not|unable|sem|nenhuma?|não)\b|n't\b/i.test(before)) continue;
    if (/\?\s*$/.test(s)) continue;
    return true;
  }
  return false;
}
