// Approval modes and deny rules (pure, tested).
//
//   ask    every tool call waits for Allow / Deny
//   risky  only risky tools wait (changing the user's files, sending something off this computer); the default
//   auto   nothing waits
// Deny rules apply in every mode, before anything else. One rule per line:
//   files.write            the tool, whatever it is asked
//   files.*                every tool in the group
//   files.read:*.env       only when the tool's target (path, url or query) matches the pattern
// Patterns use * (any text) and ? (one character), case-insensitive; \ and / are the same.

import type { ApprovalMode, Risk, Tool } from './types';

export type Decision = 'allow' | 'ask' | 'deny';

export { DEFAULT_DENY } from '../../../src/agents/toolDefaults';

export interface Rule { tool: string; pattern: string | null; raw: string }

export function parseRules(lines: string[] | string): Rule[] {
  const list = Array.isArray(lines) ? lines : String(lines ?? '').split('\n');
  const out: Rule[] = [];
  for (const raw of list) {
    const line = String(raw ?? '').trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf(':');
    const tool = (i < 0 ? line : line.slice(0, i)).trim().toLowerCase();
    const pattern = i < 0 ? null : line.slice(i + 1).trim() || null;
    if (!/^[a-z*][a-z0-9_.*]*$/.test(tool)) continue;
    out.push({ tool, pattern, raw: line });
  }
  return out;
}

const norm = (s: string) => s.replace(/\\/g, '/').toLowerCase();

export function globMatch(pattern: string, text: string): boolean {
  const re = new RegExp(`^${norm(pattern).split('').map((c) => (c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&'))).join('')}$`, 's');
  return re.test(norm(text));
}

/** The thing a call is about, for deny patterns and approval cards. */
export function targetOf(args: Record<string, unknown>): string {
  for (const k of ['path', 'url', 'query', 'title', 'prompt', 'text']) {
    const v = args[k];
    if (typeof v === 'string' && v) return v;
  }
  return '';
}

export function deniedBy(rules: Rule[], toolName: string, args: Record<string, unknown>): Rule | null {
  const name = toolName.toLowerCase();
  const target = targetOf(args);
  for (const r of rules) {
    if (!globMatch(r.tool, name)) continue;
    if (r.pattern === null || globMatch(r.pattern, target)) return r;
  }
  return null;
}

export function needsAsk(mode: ApprovalMode, risk: Risk): boolean {
  if (mode === 'ask') return true;
  if (mode === 'auto') return false;
  return risk === 'risky';
}

export function decide(tool: Pick<Tool, 'name' | 'risk'>, args: Record<string, unknown>, mode: ApprovalMode, rules: Rule[]): { decision: Decision; rule?: string } {
  const r = deniedBy(rules, tool.name, args);
  if (r) return { decision: 'deny', rule: r.raw };
  return { decision: needsAsk(mode, tool.risk) ? 'ask' : 'allow' };
}

export const isApprovalMode = (v: unknown): v is ApprovalMode => v === 'ask' || v === 'risky' || v === 'auto';
