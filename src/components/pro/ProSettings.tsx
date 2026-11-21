// Settings → Lotus Pro (0.18.0): paste a key, see the plan, remove this PC.
// Only shown once the launch switch is on, or in a build pointed at Polar's practice shop.

import React, { useState } from 'react';
import { Btn, Banner, TextInput } from '../common/ui';
import { activateKey, recheckKey, removeThisPc, usePro } from '../../lib/pro';
import { openExternal } from '../../lib/open';

const PRO_FEATURES = ['Clone a voice from a short recording, or describe one', 'Your own voices in calls and read-aloud', 'Stories with a voice for each character, exported as one file'];

export const ProSettings: React.FC = () => {
  const pro = usePro();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<'add' | 'remove' | 'check' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async (what: 'add' | 'remove' | 'check', f: () => Promise<unknown>) => {
    setBusy(what); setErr(null);
    try { await f(); if (what === 'add') setKey(''); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  const when = (t: number | null) => (t ? new Date(t).toLocaleDateString() : '');
  const headline = pro.plan === 'pro' ? 'Lotus Pro is on for this PC.'
    : pro.plan === 'trial' ? `Pro trial: ${pro.trialDaysLeft} day${pro.trialDaysLeft === 1 ? '' : 's'} left (until ${when(pro.trialEndsAt)}).`
    : pro.trialStartedAt ? 'Your Pro trial has ended. Everything else in Lotus stays free.' : 'Lotus is free. Pro adds the voice features below.';

  return (
    <div className="space-y-4 pt-2">
      {pro.sandbox && <Banner tone="info">Test mode: this build uses Polar's practice shop, so only test keys work.</Banner>}
      {pro.problem && <Banner tone="warn">{pro.problem}</Banner>}
      <section className="space-y-1">
        <p className="text-[13px] font-medium">{headline}</p>
        <ul className="text-[12px] text-[var(--color-text-muted)] list-disc pl-5 space-y-0.5">
          {PRO_FEATURES.map((f) => <li key={f}>{f}</li>)}
        </ul>
        <p className="text-[12px] text-[var(--color-text-muted)]">Chat, images, dictation, built-in voices, calls, Deep Research and Advanced mode are free for everyone.</p>
      </section>

      {pro.plan === 'pro' ? (
        <section className="space-y-2 border-t border-[var(--sep)] pt-3">
          <p className="text-[13px]">Key <span className="font-mono">{pro.displayKey}</span>{pro.limitActivations ? ` · works on ${pro.limitActivations} PCs` : ''}</p>
          <p className="text-[12px] text-[var(--color-text-muted)]">Works offline. Lotus checks the key about once a month when you're online{pro.lastCheckedAt ? ` (last: ${when(pro.lastCheckedAt)})` : ''}, and never locks you out when it can't.</p>
          <div className="flex gap-2 flex-wrap">
            <Btn variant="secondary" loading={busy === 'remove'} onClick={() => void run('remove', removeThisPc)}>Remove this PC</Btn>
            <Btn variant="ghost" loading={busy === 'check'} onClick={() => void run('check', recheckKey)}>Check now</Btn>
            {pro.portalUrl && <Btn variant="ghost" onClick={() => void openExternal(pro.portalUrl)}>Manage my PCs</Btn>}
          </div>
        </section>
      ) : (
        <section className="space-y-2 border-t border-[var(--sep)] pt-3">
          <label htmlFor="pro-key" className="text-[13px] block">Have a key? Paste it here once.</label>
          <div className="flex gap-2">
            <TextInput id="pro-key" placeholder="Your Lotus Pro key" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false}
              onKeyDown={(e) => { if (e.key === 'Enter' && key.trim()) void run('add', () => activateKey(key)); }} />
            <Btn variant="primary" disabled={!key.trim() || !pro.canActivate} loading={busy === 'add'} onClick={() => void run('add', () => activateKey(key))}>Turn on Pro</Btn>
          </div>
          {!pro.canActivate && <p className="text-[12px] text-[var(--color-text-muted)]">Keys can't be added in this build yet.</p>}
          <p className="text-[12px] text-[var(--color-text-muted)]">Each key works on 3 PCs. To move it, remove an old PC here or in your Polar account.</p>
          {pro.buyUrl && <Btn variant="secondary" onClick={() => void openExternal(pro.buyUrl)}>Get Lotus Pro</Btn>}
        </section>
      )}
      {err && <Banner tone="error">{err}</Banner>}
    </div>
  );
};
