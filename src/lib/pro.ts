// Lotus Pro in the window (0.18.0). The core owns the licence and the trial (core/src/licence.ts);
// this keeps the latest status for the screens and the voice code.
//
// Until the launch switch is on, `unlocked` is always true: every feature works as before and nothing
// about Pro is shown. With no core (browser, tests), Pro counts as unlocked too.

import { useEffect, useState } from 'react';
import { onCoreEvent, rpc } from './core';

export type Plan = 'free' | 'trial' | 'pro';
export type ProFeature = 'voice-clone' | 'voice-design' | 'own-voices' | 'stories';

export interface ProStatus {
  locks: boolean;
  unlocked: boolean;
  plan: Plan;
  trialStartedAt: number | null;
  trialEndsAt: number | null;
  trialDaysLeft: number;
  displayKey: string | null;
  limitActivations: number | null;
  lastCheckedAt: number | null;
  problem: string | null;
  buyUrl: string;
  portalUrl: string;
  canActivate: boolean;
  sandbox: boolean;
}

export const OPEN_STATUS: ProStatus = {
  locks: false, unlocked: true, plan: 'free', trialStartedAt: null, trialEndsAt: null, trialDaysLeft: 0, displayKey: null,
  limitActivations: null, lastCheckedAt: null, problem: null, buyUrl: '', portalUrl: '', canActivate: false, sandbox: false,
};

let status: ProStatus = OPEN_STATUS;
let loaded: Promise<void> | null = null;
const subs = new Set<(s: ProStatus) => void>();
const set = (s: ProStatus | null | undefined) => { if (!s || typeof s !== 'object') return; status = { ...OPEN_STATUS, ...s }; subs.forEach((f) => f(status)); };

onCoreEvent((e) => { if (e.type === 'pro') set(e.status as ProStatus); });

/** Fetches the status once (and again after `refresh`). */
export function loadPro(): Promise<void> {
  loaded ??= rpc<ProStatus>('pro_status').then(set).catch(() => undefined);
  return loaded;
}

/** The latest status, without waiting. */
export const proNow = (): ProStatus => status;
/** Can Pro features be used right now? (Always true while the launch switch is off.) */
export const proUnlocked = (): boolean => !status.locks || status.unlocked;

export function usePro(): ProStatus {
  const [s, setS] = useState(status);
  useEffect(() => { subs.add(setS); void loadPro(); setS(status); return () => { subs.delete(setS); }; }, []);
  return s;
}

/** The first chat that worked starts the trial (only once the launch switch is on). Best effort. */
let chatNoted = false;
export function noteChatSuccess(): void {
  if (chatNoted) return;
  chatNoted = true;
  rpc<ProStatus>('pro_chat_ok').then(set).catch(() => { chatNoted = false; });
}

export async function activateKey(key: string): Promise<ProStatus> { const s = await rpc<ProStatus>('pro_activate', { key }); set(s); return s; }
export async function removeThisPc(): Promise<ProStatus> { const s = await rpc<ProStatus>('pro_deactivate'); set(s); return s; }
export async function recheckKey(): Promise<ProStatus> { const s = await rpc<ProStatus>('pro_recheck', { force: true }); set(s); return s; }

/** What each "Try Pro" card says. */
export const PRO_COPY: Record<ProFeature, { title: string; body: string }> = {
  'voice-clone': { title: 'Clone a voice with Lotus Pro', body: 'Make a voice from a short recording of yours, then use it anywhere Lotus speaks.' },
  'voice-design': { title: 'Design a voice with Lotus Pro', body: 'Describe the voice you want and Lotus makes it.' },
  'own-voices': { title: 'Your own voices are part of Lotus Pro', body: 'Calls and read-aloud use a built-in voice for now. Your voices are kept and come back with Pro.' },
  stories: { title: 'Stories are part of Lotus Pro', body: 'Turn a script into a story with a different voice for each character, and export it as one file.' },
};
