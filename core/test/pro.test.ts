// Lotus Pro licence keys (Freemius since 0.18.1; Polar declined Lotus), the 14-day trial and the launch switch.

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Licence, PRO_CONFIG, proConfigFromEnv, type ProConfig } from '../src/licence';

const DAY = 86_400_000;
const PRODUCT = '12345';
const live: ProConfig = { ...PRO_CONFIG, locks: true, productId: PRODUCT };
const KEY = 'sk_LotusTestKey_WXYZ';

interface Call { method: string; url: string; body: Record<string, unknown> }
type Kind = 'activate' | 'validate' | 'deactivate';

/** A fake Freemius: answers per endpoint, records each call. */
function fakeFreemius(answers: Partial<Record<Kind, () => Response>>): { fetch: typeof globalThis.fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    calls.push({ method: init?.method ?? 'GET', url, body });
    const kind: Kind = url.includes('/licenses/activate.json') ? 'activate' : url.includes('/licenses/deactivate.json') ? 'deactivate' : 'validate';
    const a = answers[kind];
    if (!a) throw new TypeError('fetch failed');
    return a();
  }) as unknown as typeof fetch;
  return { fetch: fakeFetch, calls };
}

const activated = () => new Response(JSON.stringify({ user_id: 1, install_id: 777, install_api_token: 'tok', license_plan_id: 9, license_plan_name: 'pro' }), { status: 200 });
const licence = (extra: Record<string, unknown> = {}) => () => new Response(JSON.stringify({ id: 5, quota: 3, activated: 1, expiration: null, is_cancelled: false, ...extra }), { status: 200 });
const fsError = (status: number, code: string, message = '') => () => new Response(JSON.stringify({ error: { code, message, type: 'x', http: status } }), { status });

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
    expect(PRO_CONFIG.productId).toBe('45920');
    expect(PRO_CONFIG.publicKey).toStartWith('pk_');
  });
  test('everything is unlocked and no trial starts', () => {
    const { mk } = setup({ ...PRO_CONFIG });
    const l = mk();
    expect(l.status().unlocked).toBe(true);
    expect(l.allows('voice-clone')).toBe(true);
    const s = l.noteChatSuccess();
    expect(s.plan).toBe('free');
    expect(s.trialStartedAt).toBeNull();
    expect(s.canActivate).toBe(true); // the Freemius product is set up; the pane stays hidden until launch
  });
  test('a test build can be set up from the environment', () => {
    const c = proConfigFromEnv({ LOTUS_PRO_TEST: '1', LOTUS_FREEMIUS_PRODUCT: PRODUCT, LOTUS_PRO_LOCKS: '1' });
    expect(c).toMatchObject({ test: true, productId: PRODUCT, locks: true });
    expect(proConfigFromEnv({ LOTUS_FREEMIUS_PRODUCT: 'abc' }).productId).toBe(PRO_CONFIG.productId); // not a number: ignored
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
  test('activate sends the 32-character uid, the key and a title, then reads the quota', async () => {
    const p = fakeFreemius({ activate: activated, validate: licence() });
    const { mk } = setup(live, p.fetch);
    const s = await mk().activate(`  ${KEY}  `, 'Desk PC');
    expect(p.calls[0].method).toBe('POST');
    expect(p.calls[0].url).toBe(`https://api.freemius.com/v1/products/${PRODUCT}/licenses/activate.json`);
    expect(p.calls[0].body).toMatchObject({ license_key: KEY, title: 'Desk PC' });
    expect(String(p.calls[0].body.uid)).toMatch(/^[0-9a-f]{32}$/);
    expect(p.calls[1].url).toStartWith(`https://api.freemius.com/v1/products/${PRODUCT}/installs/777/license.json?uid=`);
    expect(s).toMatchObject({ plan: 'pro', unlocked: true, displayKey: '****-WXYZ', limitActivations: 3 });
  });
  test('the uid is the same for every call from one PC, and differs on another', async () => {
    const a = fakeFreemius({ activate: activated, validate: licence() });
    await setup(live, a.fetch, 'pc-a').mk().activate(KEY);
    await setup(live, a.fetch, 'pc-a').mk().activate(KEY);
    const b = fakeFreemius({ activate: activated, validate: licence() });
    await setup(live, b.fetch, 'pc-b').mk().activate(KEY);
    expect(a.calls[0].body.uid).toBe(a.calls[2].body.uid);
    expect(a.calls[0].body.uid).not.toBe(b.calls[0].body.uid);
  });
  test('works offline after activation (even if the quota could not be read) and survives a restart', async () => {
    const p = fakeFreemius({ activate: activated });
    const { mk } = setup(live, p.fetch);
    expect((await mk().activate(KEY)).plan).toBe('pro');
    expect(mk().status()).toMatchObject({ plan: 'pro', limitActivations: null });
  });
  test('the record copied to another PC does not count', async () => {
    const p = fakeFreemius({ activate: activated, validate: licence() });
    const { mk } = setup(live, p.fetch);
    await mk('pc-a').activate(KEY);
    expect(mk('pc-b').status().plan).toBe('free');
  });
  test('a reinstall on the same PC picks up its existing install', async () => {
    const p = fakeFreemius({ activate: fsError(400, 'license_activated', 'License is already activated on install 4242.'), validate: licence() });
    const { mk } = setup(live, p.fetch);
    const s = await mk().activate(KEY);
    expect(s.plan).toBe('pro');
    expect(p.calls[1].url).toContain('/installs/4242/license.json');
  });
  test('plain-words errors: unknown key, 3 PCs used, expired, cancelled, offline', async () => {
    const cases: [Partial<Record<Kind, () => Response>>, RegExp][] = [
      [{ activate: fsError(404, 'invalid_license_key', 'Invalid license key.') }, /wasn't found/],
      [{ activate: fsError(402, 'license_utilized', 'Your license quota of 3 production site(s) has been reached.') }, /already used on 3 PCs/],
      [{ activate: fsError(402, 'license_expired', 'Your license has expired.') }, /expired/],
      [{ activate: activated, validate: licence({ is_cancelled: true }) }, /no longer active/],
    ];
    for (const [answers, msg] of cases) {
      const { mk } = setup(live, fakeFreemius(answers).fetch);
      await expect(mk().activate(KEY)).rejects.toThrow(msg);
      expect(mk().status().plan).toBe('free');
    }
    const { mk } = setup(live, fakeFreemius({}).fetch);
    await expect(mk().activate(KEY)).rejects.toThrow(/couldn't reach/);
    await expect(mk().activate('abc')).rejects.toThrow(/doesn't look like/);
  });
  test('no product id yet: activation says so', async () => {
    const { mk } = setup({ ...live, productId: '' });
    await expect(mk().activate(KEY)).rejects.toThrow(/not set up/);
  });
});

describe('30-day recheck', () => {
  test('not before 30 days, then checks the licence of this install', async () => {
    let validated = 0;
    const p = fakeFreemius({ activate: activated, validate: () => { validated++; return licence({ quota: 5 })(); } });
    const { mk, clock } = setup(live, p.fetch);
    const l = mk();
    await l.activate(KEY);
    validated = 0;
    await l.recheck();
    expect(validated).toBe(0);
    clock.advance(31 * DAY);
    const s = await l.recheck();
    expect(validated).toBe(1);
    expect(p.calls.at(-1)?.url).toContain(`license_key=${KEY}`);
    expect(s.limitActivations).toBe(5);
    expect(s.lastCheckedAt).toBe(Date.parse('2026-11-21T12:00:00Z') + 31 * DAY);
  });
  test('offline or a server error never locks the user out', async () => {
    let mode: 'ok' | 'down' | '500' = 'ok';
    const p = fakeFreemius({ activate: activated, validate: () => { if (mode === 'down') throw new TypeError('fetch failed'); return mode === '500' ? new Response('oops', { status: 500 }) : licence()(); } });
    const { mk, clock } = setup(live, p.fetch);
    const l = mk();
    await l.activate(KEY);
    mode = 'down';
    clock.advance(400 * DAY);
    expect((await l.recheck()).plan).toBe('pro');
    mode = '500';
    expect((await l.recheck()).plan).toBe('pro');
  });
  test('updates ending (expiration passed) keeps Pro on: buyers keep what they paid for', async () => {
    const p = fakeFreemius({ activate: activated, validate: licence({ expiration: '2026-01-01 00:00:00' }) });
    const { mk } = setup(live, p.fetch);
    const l = mk();
    await l.activate(KEY);
    expect((await l.recheck(true)).plan).toBe('pro');
  });
  test('a licence that was refunded or this PC removed turns Pro off with a note', async () => {
    let gone = false;
    const p = fakeFreemius({ activate: activated, validate: () => (gone ? fsError(404, 'not_found')() : licence()()) });
    const { mk } = setup(live, p.fetch);
    const l = mk();
    await l.activate(KEY);
    gone = true;
    const s = await l.recheck(true);
    expect(s.plan).toBe('free');
    expect(s.problem).toMatch(/no longer active/);
  });
});

describe('remove this PC', () => {
  test('deactivates with Freemius and goes back to Free', async () => {
    const p = fakeFreemius({ activate: activated, validate: licence(), deactivate: licence() });
    const { mk } = setup(live, p.fetch);
    const l = mk();
    await l.activate(KEY);
    const s = await l.deactivate();
    expect(p.calls.at(-1)?.url).toBe(`https://api.freemius.com/v1/products/${PRODUCT}/licenses/deactivate.json`);
    expect(p.calls.at(-1)?.body).toMatchObject({ license_key: KEY, install_id: 777, uid: p.calls[0].body.uid });
    expect(s).toMatchObject({ plan: 'free', problem: null });
  });
  test('offline: Pro still turns off here, and the note says to free the slot online', async () => {
    let online = true;
    const p = fakeFreemius({ activate: activated, validate: licence(), deactivate: () => { if (!online) throw new TypeError('down'); return licence()(); } });
    const { mk } = setup(live, p.fetch);
    const l = mk();
    await l.activate(KEY);
    online = false;
    const s = await l.deactivate();
    expect(s.plan).toBe('free');
    expect(s.problem).toMatch(/Remove this PC in your Freemius account/);
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
