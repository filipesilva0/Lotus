// Always-allow rules (Phase 2), saved by the core under their own key. Same syntax as deny rules:
//   files.write:C:/Users/Filipe/Documents/Notes/*   the tool in that folder and everything under it
//   web.read:https://en.wikipedia.org/*            the tool on that site
//   computer.click                                 the tool, whatever it is asked
// Pure helpers, shared by the approval cards and Settings → Tools.

export const ALLOW_KEY = 'lotus.agentAllow.v1';

/** What a rule lets Lotus do, in plain words: "files.write in C:\…\Notes", "web.read on wikipedia.org". */
export function describeAllow(rule: string): string {
  const line = String(rule ?? '').trim();
  const i = line.indexOf(':');
  const tool = i < 0 ? line : line.slice(0, i);
  const pat = i < 0 ? '' : line.slice(i + 1).trim();
  if (!pat) return `${tool}, anywhere`;
  const site = /^https?:\/\/([^/]+)\/\*$/i.exec(pat);
  if (site) return `${tool} on ${site[1].replace(/^www\./, '')}`;
  if (pat.endsWith('/*')) return `${tool} in ${pat.slice(0, -2) || '/'}`;
  return `${tool} for ${pat}`;
}

export function parseAllow(raw: string | null): string[] {
  try { const v = JSON.parse(raw || '[]'); return Array.isArray(v) ? v.map(String).filter(Boolean) : []; } catch { return []; }
}
