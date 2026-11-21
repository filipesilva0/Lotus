// Opt-in crash reports and "Copy diagnostics" (0.17.0). Lotus has no servers: a crash report is a
// GitHub issue the person reads, can edit, and submits themselves. Crash reports are off until they
// are turned on in Settings › Privacy; errors are kept on this computer either way (last 20), so
// "Copy diagnostics" can include them when the person asks for help.

import { useSyncExternalStore } from 'react';
import { kv } from './store';
import { coreState, subscribeCore } from './core';
import { builtinsNow } from './builtins';
import { currentVersion } from '../services/updateService';
import { LIBRARY } from '../models/library';
import { buildDiagnostics, crashIssueUrl, type DiagError } from './diagnosticsText';
import { openExternal } from './open';
import type { LotusSettings } from '../types/lotus';

const OPT_IN_KEY = 'lotus.crashReports.v1';
const ERRORS_KEY = 'lotus.errorLog.v1';
const MAX_ERRORS = 20;
/** At most one crash card every few minutes, and never twice for the same error. */
const PROMPT_GAP_MS = 5 * 60_000;

export const crashReportsOn = (): boolean => kv.getJson<boolean>(OPT_IN_KEY, false) === true;
export function setCrashReports(on: boolean) { kv.setJson(OPT_IN_KEY, on); emit(); }

let errors: DiagError[] = (() => { try { return kv.getJson<DiagError[]>(ERRORS_KEY, []).slice(-MAX_ERRORS); } catch { return []; } })();
let pending: DiagError | null = null;
let lastPrompt = 0;
let lastPromptMsg = '';
let snap = { on: false, pending: null as DiagError | null };
const subs = new Set<() => void>();
function emit() { snap = { on: crashReportsOn(), pending }; subs.forEach((f) => f()); }
snap = { on: (() => { try { return crashReportsOn(); } catch { return false; } })(), pending: null };

export const recentErrors = () => errors;

/**
 * Notes an error in the local log. `crash` errors (an uncaught error, the window breaking, the core
 * stopping) also offer a report when crash reports are on.
 */
export function recordError(where: string, err: unknown, crash = false) {
  const e = err as { message?: string; stack?: string } | undefined;
  const message = (typeof err === 'string' ? err : e?.message ?? String(err ?? 'Unknown error')).slice(0, 1000);
  const entry: DiagError = { at: Date.now(), where, message, stack: typeof e?.stack === 'string' ? e.stack.slice(0, 2000) : undefined };
  errors = [...errors, entry].slice(-MAX_ERRORS);
  try { kv.setJson(ERRORS_KEY, errors); } catch { /* memory only */ }
  if (crash && crashReportsOn() && message !== lastPromptMsg && Date.now() - lastPrompt > PROMPT_GAP_MS) {
    pending = entry; lastPrompt = Date.now(); lastPromptMsg = message;
  }
  emit();
}

export function dismissCrash() { pending = null; emit(); }
export function clearErrors() { errors = []; try { kv.setJson(ERRORS_KEY, []); } catch { /* memory only */ } emit(); }

export function useCrashReports() {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => snap, () => snap);
}

/** The diagnostics text for this computer right now. */
export async function collectDiagnostics(settings?: Partial<LotusSettings> | null): Promise<string> {
  const b = builtinsNow();
  const core = coreState();
  const byId = new Map(LIBRARY.map((e) => [e.id, e]));
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const os = b.machine?.os ?? (/Windows/i.test(ua) ? 'windows' : /Mac/i.test(ua) ? 'macos' : /Linux/i.test(ua) ? 'linux' : 'unknown');
  return buildDiagnostics({
    appVersion: await currentVersion().catch(() => null),
    coreVersion: core.info?.version ?? null,
    coreError: core.info ? null : core.error,
    os,
    arch: b.machine?.arch,
    gpu: b.machine && b.machine.gpu !== 'none' ? b.machine.gpuName || b.machine.gpu : undefined,
    vramGb: b.machine?.vramGb,
    ramGb: b.machine?.ramGb,
    engines: b.engines.map((e) => ({ name: e.name, version: e.version, flavour: e.flavour, installed: e.installed })),
    models: b.models.map((m) => ({ title: (m.entryId && byId.get(m.entryId)?.title) || byId.get(m.id)?.title || m.title, kind: m.kind, custom: !!m.custom || !(byId.has(m.id) || (m.entryId && byId.has(m.entryId))) })),
    chatEngine: settings?.llmBackend,
    imageEngine: settings?.imageEngine,
    voiceEngine: settings?.voiceEngine,
    errors,
  });
}

/** Help › Copy Diagnostics and the Settings button. Resolves false when the clipboard refused. */
export async function copyDiagnostics(settings?: Partial<LotusSettings> | null): Promise<boolean> {
  try { await navigator.clipboard.writeText(await collectDiagnostics(settings)); return true; } catch { return false; }
}

/** Opens a GitHub issue with `report` filled in, for the person to read and submit. */
export const sendReport = (report: string) => openExternal(crashIssueUrl(report));

let installed = false;
/** Catches errors nothing else handled. Call once at start-up. */
export function installCrashCatcher() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (ev) => {
    // A failed image or script load is an Event with no error; only real exceptions count.
    if (!ev.error && !ev.message) return;
    recordError('window', ev.error ?? ev.message, true);
  });
  // Unhandled promise rejections are mostly network hiccups: logged, but no report is offered.
  window.addEventListener('unhandledrejection', (ev) => recordError('promise', ev.reason, false));
  // The core stopping on its own is a crash; "not running yet" at start-up is not.
  let lastCore: string | null = null;
  subscribeCore(() => {
    const err = coreState().error;
    if (err && err !== lastCore) recordError('core', err, /stopped|crash|exited/i.test(err));
    lastCore = err;
  });
}
