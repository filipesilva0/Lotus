// What a crash report or "Copy diagnostics" holds (0.17.0). Pure (no DOM, no kv), so the core tests
// check it. Rule: facts about the app and the computer, and error messages, never the person's
// content. No chats, prompts, file contents or file names; user names are cut out of folder paths;
// e-mail addresses and anything that looks like a key or token is blanked.

export const ISSUES_URL = 'https://github.com/filipesilva0/Lotus/issues/new';

export interface DiagError { at: number; where: string; message: string; stack?: string }
export interface DiagInput {
  appVersion: string | null;
  coreVersion: string | null;
  os: string;
  arch?: string;
  gpu?: string;
  vramGb?: number;
  ramGb?: number;
  engines: { name: string; version: string | null; flavour?: string | null; installed: boolean }[];
  /** Installed model titles from Lotus's catalog (custom models are only counted). */
  models: { title: string; kind: string; custom?: boolean }[];
  chatEngine?: string;
  imageEngine?: string;
  voiceEngine?: string;
  coreError?: string | null;
  errors: DiagError[];
  now?: Date;
}

/** Cuts personal bits out of a line of text: user folders, e-mail addresses, keys and tokens. */
export function redact(text: string): string {
  return String(text ?? '')
    // C:\Users\Name\…, /Users/name/…, /home/name/… → the user's folder without the name
    .replace(/([A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+)[^\\/\s"'<>|:*?]+/gi, '$1…')
    .replace(/(\/(?:Users|home)\/)[^/\s"'<>]+/g, '$1…')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b(?:sk|pk|rk|hf|gh[pousr]|xox[abp]|AIza)[-_A-Za-z0-9]{12,}\b/g, '[key]')
    .replace(/\b(Bearer|token|key|apikey|api_key|password|secret)(\s*[=:]\s*|\s+)("?)[^\s"&]{6,}/gi, '$1$2$3[hidden]')
    .replace(/\b[0-9a-f]{32,}\b/gi, '[hidden]');
}

const line = (k: string, v: unknown) => `- ${k}: ${v === undefined || v === null || v === '' ? 'unknown' : v}`;

/** The plain-text summary: the same text for "Copy diagnostics", the preview, and a GitHub issue. */
export function buildDiagnostics(d: DiagInput): string {
  const out: string[] = [];
  out.push('## Lotus diagnostics', '');
  out.push(line('Lotus', d.appVersion ?? 'development build'));
  out.push(line('Core (lotusd)', d.coreVersion ?? (d.coreError ? 'not running' : 'unknown')));
  out.push(line('System', [d.os, d.arch].filter(Boolean).join(' ')));
  out.push(line('Graphics', d.gpu ? `${d.gpu}${d.vramGb ? `, ${d.vramGb} GB` : ''}` : 'none found'));
  if (d.ramGb) out.push(line('Memory', `${d.ramGb} GB`));
  out.push(line('Engines in use', [d.chatEngine && `chat ${d.chatEngine}`, d.imageEngine && `images ${d.imageEngine}`, d.voiceEngine && `voice ${d.voiceEngine}`].filter(Boolean).join(', ')));
  out.push('', '### Lotus engines');
  if (!d.engines.length) out.push('- none reported');
  for (const e of d.engines) out.push(`- ${e.name}: ${e.installed ? `${e.version ?? 'installed'}${e.flavour ? ` (${e.flavour})` : ''}` : 'not installed'}`);
  out.push('', '### Models');
  const known = d.models.filter((m) => !m.custom);
  const custom = d.models.length - known.length;
  if (!d.models.length) out.push('- none installed');
  for (const m of known.slice(0, 20)) out.push(`- ${m.title} (${m.kind})`);
  if (known.length > 20) out.push(`- and ${known.length - 20} more`);
  if (custom) out.push(`- ${custom} added by link`);
  if (d.coreError) out.push('', '### Core', redact(d.coreError).slice(0, 400));
  out.push('', '### Recent errors');
  if (!d.errors.length) out.push('- none');
  for (const e of d.errors.slice(-10)) {
    out.push(`- ${new Date(e.at).toISOString()} · ${e.where}: ${redact(e.message).slice(0, 300)}`);
    if (e.stack) out.push(...redact(e.stack).split('\n').slice(0, 6).map((s) => `    ${s.trim().slice(0, 200)}`));
  }
  out.push('', `_Made ${(d.now ?? new Date()).toISOString()}. Holds no chats, prompts, files or file names._`);
  return out.join('\n');
}

/** A new-issue link on Lotus's GitHub with the report filled in; the person reads it and submits. */
export function crashIssueUrl(report: string, title = 'Crash report'): string {
  const max = 6000; // GitHub refuses very long links
  const body = report.length > max ? `${report.slice(0, max)}\n\n(cut to fit)` : report;
  return `${ISSUES_URL}?${new URLSearchParams({ title, body, labels: 'crash report' }).toString()}`;
}
