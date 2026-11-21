// 0.18.0: Lotus Pro licence keys (Polar), the 14-day trial and the launch switch.

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Licence, PRO_CONFIG, proConfigFromEnv, type ProConfig } from '../src/licence';

const DAY = 86_400_000;
const ORG = '11111111-2222-3333-4444-555555555555';
const live: ProConfig = { ...PRO_CONFIG, locks: true, organizationId: ORG, env: 'sandbox' };

interface Call { url: string; body: Record<string, unknown> }

/** A fake Polar: answers per path, records each call. */
function fakePolar(answers: Partial<Record<'activate' | 'validate' | 'deactivate', () => Response>>): { fetch: typeof globalThis.fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ url, body });
    const path = url.split('/').pop() as 'activate' | 'validate' | 'deactivate';
    const a = answers[path];
    if (!a) throw new TypeError('fetch failed');
    return a();
  }) as unknown as typeof fetch;
  return { fetch: fakeFetch, calls };
}

const activated = () => new Response(JSON.stringify({
  id: 'act-1', license_key_id: 'lk-1', label: 'PC', meta: {}, created_at: '2026-11-21T00:00:00Z', modified_at: null,
  license_key: { display_key: '****-WXYZ', limit_activations: 3, expires_at: null, status: 'granted' },
}), { status: 200 });

function setup(config: ProConfig, fetch?: typeof globalThis.fetch, machine = 'pc-a') {
  const dir = mkdtempSync(join(tmpdir(), 'lotus-pro-'));
  let t = Date.parse('2026-11-21T12:00:00Z');
  const clock = { advance: (ms: number) => { t += ms; } };
  const mk = (m = machine): Licence => new Licence({ dataDir: join(dir, 'data'), config, fetch, now: () => t, machine: m, trialMarker: join(dir, 'marker', 'trial.json') });
  return { dir, clock, mk };
}

describe('launch switch off (what 0.18.0 ships)', () => {
  test('the shipped config keeps selling and locks off', () => {
    expect(PRO_CONFIG.locks).toBe(false);
    expect(PRO_CONFIG.buyUrl).toBe('');
  });
  test('everything is unlocked and no trial starts', () => {
    const { mk } = setup({ ...PRO_CONFIG });
    const l = mk();
    expect(l.status().unlocked).toBe(true);
    expect(l.allows('voice-clone')).toBe(true);
    const s = l.noteChatSuccess();
    expect(s.plan).toBe('free');
    expect(s.trialStartedAt).toBeNull();
    expect(s.canActivate).toBe(false);
  });
  test('the sandbox can be chosen from the environment for testing', () => {
    const c = proConfigFromEnv({ LOTUS_POLAR_ENV: 'sandbox', LOTUS_POLAR_ORG: ORG, LOTUS_PRO_LOCKS: '1' });
    expect(c).toMatchObject({ env: 'sandbox', organizationId: ORG, locks: true });
  });
});

describe('trial', () => {
  test('locked before the first chat, then 14 days of Pro, then locked again', () => {
    const { mk, clock } = setup(live);
    const l = mk();
    expect(l.status()).toMatchObject({ plan: 'free', unlocked: false });
    const s = l.noteChatSuccess();
    expect(s).toMatchObject({ plan: 'trial', unlocked: true, trialDaysLeft: 14 });
    clock.advance(13 * DAY + 1);
    expect(l.status().trialDaysLeft).toBe(1);
    clock.advance(DAY);
    expect(l.status()).toMatchObject({ plan: 'free', unlocked: false, trialDaysLeft: 0 });
    // A later chat doesn't restart it.
    expect(l.noteChatSuccess().plan).toBe('free');
  });
  test('wiping Lotus data keeps the trial used (the second marker)', () => {
    const { mk, dir } = setup(live);
    mk().noteChatSuccess();
    writeFileSync(join(dir, 'data', 'trial.json'), 'garbage');
    expect(mk().status().trialStartedAt).not.toBeNull();
  });
  test('an edited trial file does not count', () => {
    const { mk, dir } = setup(live);
    mk().noteChatSuccess();
    for (const p of [join(dir, 'data', 'trial.json'), join(dir, 'marker', 'trial.json')]) {
      const f = JSON.parse(readFileSync(p, 'utf8'));
      f.data.startedAt += 30 * DAY;
      writeFileSync(p, JSON.stringify(f));
    }
    // Both markers fail their signature, so it reads as never started (tolerated: checked loosely).
    expect(mk().status().trialStartedAt).toBeNull();
  });
});

describe('licence keys', () => {
  test('activate sends the key, the shop id and a label, and unlocks Pro', async () => {
    const p = fakePolar({ activate: activated });
    const { mk } = setup(live, p.fetch);
    const s = await mk().activate('  LOTUS-ABCD-EFGH-WXYZ  ', 'Desk PC');
    expect(p.calls[0].url).toBe('https://sandbox-api.polar.sh/v1/customer-portal/license-keys/activate');
    expect(p.calls[0].body).toMatchObject({ key: 'LOTUS-ABCD-EFGH-WXYZ', organization_id: ORG, label: 'Desk PC' });
    expect(s).toMatchObject({ plan: 'pro', unlocked: true, displayKey: '****-WXYZ', limitActivations: 3 });
  });
  test('works offline after activation and survives a restart', async () => {
    const p = fakePolar({ activate: activated });
    const { mk } = setup(live, p.fetch);
    await mk().activate('LOTUS-ABCD-EFGH-WXYZ');
    const again = mk();
    expect(again.status().plan).toBe('pro');
  });
  test('the record copied to another PC does not count', async () => {
    const p = fakePolar({ activate: activated });
    const { mk } = setup(live, p.fetch);
    await mk('pc-a').activate('LOTUS-ABCD-EFGH-WXYZ');
    expect(mk('pc-b').status().plan).toBe('free');
  });
  test('plain-words errors: unknown key, 3 PCs used, refunded, offline', async () => {
    const cases: [() => Response, RegExp][] = [
      [() => new Response('{"error":"ResourceNotFound","detail":"Not found"}', { status: 404 }), /wasn't found/],
      [() => new Response('{"error":"NotPermitted","detail":"License key has reached its activation limit"}', { status: 403 }), /already used on 3 PCs/],
      [() => new Response('{"error":"NotPermitted","detail":"License key is revoked"}', { status: 403 }), /no longer active/],
    ];
    for (const [answer, msg] of cases) {
      const { mk } = setup(live, fakePolar({ activate: answer }).fetch);
      await expect(mk().activate('LOTUS-ABCD-EFGH')).rejects.toThrow(msg);
    }
    const { mk } = setup(live, fakePolar({}).fetch);
    await expect(mk().activate('LOTUS-ABCD-EFGH')).rejects.toThrow(/couldn't reach/);
    await expect(mk().activate('abc')).rejects.toThrow(/doesn't look like/);
  });
  test('no shop id yet: activation says so', async () => {
    const { mk } = setup({ ...live, organizationId: '' });
    await expect(mk().activate('LOTUS-ABCD-EFGH')).rejects.toThrow(/not set up/);
  });
});

describe('30-day recheck', () => {
  test('not before 30 days, then validates with the activation id', async () => {
    let validated = 0;
    const p = fakePolar({ activate: activated, validate: () => { validated++; return new Response('{"expires_at":null}', { status: 200 }); } });
    const { mk, clock } = setup(live, p.fetch);
    const l = mk();
    await l.activate('LOTUS-ABCD-EFGH-WXYZ');
    await l.recheck();
    expect(validated).toBe(0);
    clock.advance(31 * DAY);
    const s = await l.recheck();
    expect(validated).toBe(1);
    expect(p.calls.at(-1)?.body).toMatchObject({ key: 'LOTUS-ABCD-EFGH-WXYZ', activation_id: 'act-1' });
    expect(s.lastCheckedAt).toBe(Date.parse('2026-11-21T12:00:00Z') + 31 * DAY);
  });
  test('offline or a server error never locks the user out', async () => {
    let mode: 'down' | '500' = 'down';
    const p = fakePolar({ activate: activated, validate: () => { if (mode === 'down') throw new TypeError('fetch failed'); return new Response('oops', { status: 500 }); } });
    const { mk, clock } = setup(live, p.fetch);
    const l = mk();
    await l.activate('LOTUS-ABCD-EFGH-WXYZ');
    clock.advance(400 * DAY);
    expect((await l.recheck()).plan).toBe('pro');
    mode = '500';
    expect((await l.recheck()).plan).toBe('pro');
  });
  test('a key that was refunded or removed turns Pro off with a note', async () => {
    const p = fakePolar({ activate: activated, validate: () => new Response('{"error":"ResourceNotFound"}', { status: 404 }) });
    const { mk } = setup(live, p.fetch);
    const l = mk();
    await l.activate('LOTUS-ABCD-EFGH-WXYZ');
    const s = await l.recheck(true);
    expect(s.plan).toBe('free');
    expect(s.problem).toMatch(/no longer active/);
  });
});

describe('remove this PC', () => {
  test('deactivates with Polar and goes back to Free', async () => {
    const p = fakePolar({ activate: activated, deactivate: () => new Response(null, { status: 204 }) });
    const { mk } = setup(live, p.fetch);
    const l = mk();
    await l.activate('LOTUS-ABCD-EFGH-WXYZ');
    const s = await l.deactivate();
    expect(p.calls.at(-1)?.body).toMatchObject({ key: 'LOTUS-ABCD-EFGH-WXYZ', activation_id: 'act-1', organization_id: ORG });
    expect(s).toMatchObject({ plan: 'free', problem: null });
  });
  test('offline: Pro still turns off here, and the note says to free the slot online', async () => {
    const p = fakePolar({ activate: activated });
    const { mk } = setup(live, p.fetch);
    const l = mk();
    await l.activate('LOTUS-ABCD-EFGH-WXYZ');
    const s = await l.deactivate();
    expect(s.plan).toBe('free');
    expect(s.problem).toMatch(/Remove this PC in your Polar account/);
  });
});

describe('voices when Pro is locked', () => {
  test('cloned voices are kept but not used; calls fall back to a built-in voice', async () => {
    const { voiceOptions, pickVoice } = await import('../../src/voice/studio');
    const models = [
      { id: 'pocket-tts', title: 'PocketTTS', speakers: [], clones: true, needsReferenceText: false },
      { id: 'kokoro', title: 'Kokoro', speakers: [{ id: 0, name: 'af_heart' }], clones: false, needsReferenceText: false },
    ];
    const mine = [
      { id: 'v1', name: 'Me', model: 'pocket-tts', reference: 'Audio/me.wav', created: 1 },
      { id: 'v2', name: 'Calm Narrator', model: 'kokoro', speaker: 0, created: 2 },
    ];
    expect(pickVoice(voiceOptions(models, mine), 'v1')?.id).toBe('v1');
    const locked = voiceOptions(models, mine, { proLocked: true });
    expect(locked.find((o) => o.id === 'v1')).toMatchObject({ ready: false, why: 'Cloned voices are part of Lotus Pro.' });
    expect(locked.find((o) => o.id === 'v2')?.ready).toBe(true); // a built-in speaker you saved stays free
    expect(pickVoice(locked, 'v1')?.id).toBe('v2');
  });
});
