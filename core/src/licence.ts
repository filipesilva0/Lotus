// Lotus Pro: licence keys, the 14-day trial and whether Pro features are unlocked (0.18.0).
//
// How it works (see the business model doc):
//   1. Freemius sells Pro and emails a key (Polar turned Lotus down on 2026-11-21: image generation).
//   2. The user pastes the key once. We activate it with Freemius's public licence API, which needs no
//      secret (only the product id), and keep a record on this PC, signed with a key derived from this
//      machine so the file only counts here.
//   3. After that Lotus works offline. When online it rechecks every 30 days; a recheck that can't reach
//      Freemius changes nothing. Only a clear "this licence or activation is gone" turns Pro off.
//   4. 3 activations per key (the plan's quota in Freemius). "Remove this PC" frees this one; the others
//      are managed in the buyer's Freemius account.
//
// Freemius endpoints used (https://api.freemius.com, no Authorization header):
//   POST /v1/products/{id}/licenses/activate.json     { uid, license_key, title, version }
//   GET  /v1/products/{id}/installs/{install}/license.json?uid=&license_key=
//   POST /v1/products/{id}/licenses/deactivate.json   { uid, install_id, license_key }
// `uid` is 32 characters, the same for every call from this PC.
//
// The launch switch: until `locks` is on, every Pro feature is unlocked for everyone, no trial starts and
// nothing is for sale. LOTUS_PRO_TEST=1 shows the Lotus Pro pane for testing with a sandbox product.
//
// No obfuscation, no always-online check: people who pirate weren't going to buy.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { cpus, homedir, hostname, platform, userInfo } from 'node:os';
import { dirname, join } from 'node:path';

export interface ProConfig {
  /** The launch switch: Pro features lock for people without a licence or trial. */
  locks: boolean;
  /** Where the Buy button goes. Empty: no Buy button (selling is off). */
  buyUrl: string;
  /** The buyer's Freemius account page, where they see their keys and remove old PCs. */
  portalUrl: string;
  /** Freemius product id. Public, not a secret. Empty: keys can't be activated yet. */
  productId: string;
  /** Freemius public key (pk_…), for the checkout link. Public, not a secret. */
  publicKey: string;
  /** Test build: shows the Lotus Pro pane before launch (for a Freemius sandbox product). */
  test: boolean;
}

/** What ships. Selling and the locks stay off until the launch release. */
export const PRO_CONFIG: ProConfig = {
  locks: false,
  buyUrl: '',
  portalUrl: '',
  // Lotus Pro on Freemius (set up 2026-11-21). Both are public; the secret key never goes in the app.
  productId: '45920',
  publicKey: 'pk_4142d1716197ac0d93e6ba4aaf586',
  test: false,
};

/** Testing only: point a build at a Freemius product (and show the Pro pane) without changing the code. */
export function proConfigFromEnv(env: Record<string, string | undefined> = process.env, base: ProConfig = PRO_CONFIG): ProConfig {
  const c = { ...base };
  if (env.LOTUS_PRO_TEST === '1') c.test = true;
  if (env.LOTUS_FREEMIUS_PRODUCT && /^\d+$/.test(env.LOTUS_FREEMIUS_PRODUCT)) c.productId = env.LOTUS_FREEMIUS_PRODUCT;
  if (env.LOTUS_PRO_LOCKS === '1') c.locks = true;
  if (env.LOTUS_PRO_LOCKS === '0') c.locks = false;
  if (env.LOTUS_PRO_BUY_URL) c.buyUrl = env.LOTUS_PRO_BUY_URL;
  if (env.LOTUS_PRO_PORTAL_URL) c.portalUrl = env.LOTUS_PRO_PORTAL_URL;
  return c;
}

export const TRIAL_DAYS = 14;
export const RECHECK_DAYS = 30;
const DAY = 86_400_000;

/** The Pro features, by the name the app uses for each "Try Pro" card. */
export const PRO_FEATURES = ['voice-clone', 'voice-design', 'own-voices', 'stories'] as const;
export type ProFeature = (typeof PRO_FEATURES)[number];

export type Plan = 'free' | 'trial' | 'pro';

export interface ProStatus {
  /** Whether the launch switch is on. Off: everything unlocked, nothing shown about Pro. */
  locks: boolean;
  /** Can the user use Pro features right now? */
  unlocked: boolean;
  plan: Plan;
  trialStartedAt: number | null;
  trialEndsAt: number | null;
  trialDaysLeft: number;
  /** The key masked (e.g. "****-ABCD"), never the full key. */
  displayKey: string | null;
  limitActivations: number | null;
  lastCheckedAt: number | null;
  /** A recheck said the key or this PC's activation is gone. */
  problem: string | null;
  buyUrl: string;
  portalUrl: string;
  /** Keys can be activated (a shop id is set). */
  canActivate: boolean;
  /** Test build (LOTUS_PRO_TEST=1). */
  test: boolean;
}

interface LicenceRecord {
  key: string;
  displayKey: string;
  installId: number;
  limitActivations: number | null;
  /** When updates end (Freemius `expiration`); Pro features keep working after it. */
  expiresAt: string | null;
  activatedAt: number;
  checkedAt: number;
  productId: string;
}

interface SignedFile<T> { v: 1; data: T; sig: string }

export interface LicenceOptions {
  dataDir: string;
  config?: ProConfig;
  fetch?: typeof fetch;
  now?: () => number;
  /** Something stable for this PC. Default: host name, user, OS and CPU. */
  machine?: string;
  /** The second trial marker, outside the data folder (survives a wipe of Lotus's data, loosely). */
  trialMarker?: string;
  log?: (msg: string) => void;
}

export class LicenceError extends Error {}

function defaultMachine(): string {
  let user = '';
  try { user = userInfo().username; } catch { /* no user name */ }
  return [hostname(), user, platform(), cpus()[0]?.model ?? ''].join('|');
}

function defaultTrialMarker(): string {
  const base = process.env.LOCALAPPDATA || process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state');
  return join(base, 'Lotus Pro', 'trial.json');
}

const API = 'https://api.freemius.com';
const mask = (key: string) => `****-${key.replace(/[^A-Za-z0-9]/g, '').slice(-4).toUpperCase()}`;

export class Licence {
  readonly config: ProConfig;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly secret: Buffer;
  /** Freemius's `uid`: 32 characters, stable for this PC. */
  private readonly uid: string;
  private readonly file: string;
  private readonly trialFile: string;
  private readonly trialMarker: string;
  private readonly log: (msg: string) => void;
  private problem: string | null = null;
  private checking: Promise<void> | null = null;

  constructor(o: LicenceOptions) {
    this.config = o.config ?? proConfigFromEnv();
    this.fetchFn = o.fetch ?? fetch;
    this.now = o.now ?? Date.now;
    const machine = o.machine ?? defaultMachine();
    this.secret = createHash('sha256').update(`lotus-pro|${machine}`).digest();
    this.uid = createHash('sha256').update(`lotus-machine|${machine}`).digest('hex').slice(0, 32);
    this.file = join(o.dataDir, 'licence.json');
    this.trialFile = join(o.dataDir, 'trial.json');
    this.trialMarker = o.trialMarker ?? defaultTrialMarker();
    this.log = o.log ?? (() => undefined);
  }

  // ---- signed files ---------------------------------------------------------------------------

  private sign(data: unknown): string {
    return createHmac('sha256', this.secret).update(JSON.stringify(data)).digest('hex');
  }

  private readSigned<T>(path: string): T | null {
    try {
      if (!existsSync(path)) return null;
      const f = JSON.parse(readFileSync(path, 'utf8')) as SignedFile<T>;
      if (!f || f.v !== 1 || typeof f.sig !== 'string') return null;
      const want = Buffer.from(this.sign(f.data), 'hex');
      const got = Buffer.from(f.sig, 'hex');
      if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
      return f.data;
    } catch { return null; }
  }

  private writeSigned(path: string, data: unknown): void {
    mkdirSync(dirname(path), { recursive: true });
    const f: SignedFile<unknown> = { v: 1, data, sig: this.sign(data) };
    writeFileSync(path, JSON.stringify(f, null, 1));
  }

  private record(): LicenceRecord | null {
    const r = this.readSigned<LicenceRecord>(this.file);
    // A record made for another product (a test build's sandbox product) doesn't count here.
    return r && typeof r.installId === 'number' && r.productId === this.config.productId ? r : null;
  }

  // ---- trial ----------------------------------------------------------------------------------

  /** When the trial started on this PC: the earlier of the two markers. Checked loosely on purpose. */
  private trialStart(): number | null {
    const starts = [this.trialFile, this.trialMarker]
      .map((p) => this.readSigned<{ startedAt: number }>(p)?.startedAt)
      .filter((t): t is number => typeof t === 'number' && t > 0);
    return starts.length ? Math.min(...starts) : null;
  }

  /**
   * The first chat that worked. Starts the 14-day trial once per PC, only while the launch switch is on.
   * Returns the status either way.
   */
  noteChatSuccess(): ProStatus {
    if (this.config.locks && !this.record() && this.trialStart() === null) {
      const data = { startedAt: this.now() };
      for (const p of [this.trialFile, this.trialMarker]) {
        try { this.writeSigned(p, data); } catch (e) { this.log(`trial marker ${p}: ${(e as Error).message}`); }
      }
    }
    return this.status();
  }

  // ---- status ---------------------------------------------------------------------------------

  status(): ProStatus {
    const c = this.config;
    const rec = this.record();
    const start = rec ? null : this.trialStart();
    const now = this.now();
    const ends = start === null ? null : start + TRIAL_DAYS * DAY;
    const trialLive = ends !== null && now < ends;
    const plan: Plan = rec ? 'pro' : trialLive ? 'trial' : 'free';
    return {
      locks: c.locks,
      unlocked: !c.locks || plan !== 'free',
      plan,
      trialStartedAt: start,
      trialEndsAt: ends,
      trialDaysLeft: trialLive && ends ? Math.max(1, Math.ceil((ends - now) / DAY)) : 0,
      displayKey: rec?.displayKey ?? null,
      limitActivations: rec?.limitActivations ?? null,
      lastCheckedAt: rec?.checkedAt ?? null,
      problem: this.problem,
      buyUrl: c.buyUrl,
      portalUrl: c.portalUrl,
      canActivate: !!c.productId,
      test: c.test,
    };
  }

  /** Is this feature usable now? */
  allows(feature: ProFeature): boolean {
    void feature; // every Pro feature unlocks together today
    return this.status().unlocked;
  }

  // ---- Freemius -------------------------------------------------------------------------------

  private async call(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<Response> {
    if (!this.config.productId) throw new LicenceError('Licence keys are not set up in this build yet.');
    try {
      return await this.fetchFn(`${API}/v1/products/${this.config.productId}/${path}`, {
        method,
        headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new LicenceError("Lotus couldn't reach the licence server. Check your internet connection and try again.");
    }
  }

  private static async error(res: Response): Promise<{ code: string; message: string }> {
    try {
      const j = (await res.json()) as { error?: { code?: unknown; message?: unknown } };
      return { code: String(j.error?.code ?? ''), message: String(j.error?.message ?? '') };
    } catch { return { code: '', message: '' }; }
  }

  private validatePath(installId: number, key: string) {
    return `installs/${installId}/license.json?${new URLSearchParams({ uid: this.uid, license_key: key })}`;
  }

  /** The licence as Freemius sees it from this install; null when it says the licence is gone. */
  private async fetchLicence(installId: number, key: string): Promise<{ quota: number | null; expiration: string | null } | null | 'unknown'> {
    const res = await this.call('GET', this.validatePath(installId, key));
    if (res.status === 404 || res.status === 402) return null;
    if (!res.ok) return 'unknown';
    try {
      const j = (await res.json()) as { quota?: number | null; expiration?: string | null; is_cancelled?: boolean };
      if (j.is_cancelled) return null;
      return { quota: typeof j.quota === 'number' ? j.quota : null, expiration: j.expiration ?? null };
    } catch { return 'unknown'; }
  }

  /** Paste a key: activate it for this PC and keep the signed record. */
  async activate(rawKey: string, label?: string, version = ''): Promise<ProStatus> {
    const key = rawKey.trim();
    if (key.length < 8) throw new LicenceError("That doesn't look like a Lotus Pro key. Copy the whole key from your purchase email.");
    const res = await this.call('POST', 'licenses/activate.json', {
      uid: this.uid,
      license_key: key,
      title: (label || hostname() || 'This PC').slice(0, 100),
      ...(version ? { version } : {}),
    });
    let installId: number | null = null;
    if (res.ok) {
      try { installId = Number(((await res.json()) as { install_id?: unknown }).install_id) || null; } catch { /* below */ }
      if (!installId) throw new LicenceError('The licence server gave an answer Lotus did not understand.');
    } else {
      const e = await Licence.error(res);
      if (e.code === 'license_activated') {
        // Already active on this PC (a reinstall): take the install it names.
        installId = Number(/install (\d+)/.exec(e.message)?.[1]) || null;
        if (!installId) throw new LicenceError('This key is already in use on another PC. Remove that PC in your Freemius account, then try again.');
      } else if (e.code === 'invalid_license_key' || res.status === 404) {
        throw new LicenceError("That key wasn't found. Check that you copied all of it.");
      } else if (e.code === 'license_utilized') {
        throw new LicenceError('This key is already used on 3 PCs. Remove one of them in your Freemius account, then try again.');
      } else if (e.code === 'license_expired') {
        throw new LicenceError('This key has expired. Check your Freemius account, or write to support.');
      } else {
        throw new LicenceError(`The licence server answered with an error (${res.status}${e.message ? `: ${e.message}` : ''}). Try again in a minute.`);
      }
    }
    // Quota and expiry come from the licence itself (the activation answer doesn't carry them).
    let info: Awaited<ReturnType<Licence['fetchLicence']>> = 'unknown';
    try { info = await this.fetchLicence(installId, key); } catch { /* offline right after activating: fine */ }
    if (info === null) throw new LicenceError('This key is no longer active (it may have been refunded or cancelled).');
    const now = this.now();
    const rec: LicenceRecord = {
      key,
      displayKey: mask(key),
      installId,
      limitActivations: info !== 'unknown' ? info.quota : null,
      expiresAt: info !== 'unknown' ? info.expiration : null,
      activatedAt: now,
      checkedAt: now,
      productId: this.config.productId,
    };
    this.writeSigned(this.file, rec);
    this.problem = null;
    return this.status();
  }

  /**
   * Every 30 days when online. Can't reach Freemius → nothing changes. A clear "gone" (refunded, cancelled,
   * or this PC removed in the account) → back to Free, with a note saying why.
   */
  async recheck(force = false): Promise<ProStatus> {
    if (this.checking) { await this.checking; return this.status(); }
    const rec = this.record();
    if (!rec || !this.config.productId) return this.status();
    if (!force && this.now() - rec.checkedAt < RECHECK_DAYS * DAY) return this.status();
    this.checking = (async () => {
      let info: Awaited<ReturnType<Licence['fetchLicence']>>;
      try { info = await this.fetchLicence(rec.installId, rec.key); } catch { return; }
      if (info === null) {
        this.forget();
        this.problem = 'Your Lotus Pro key is no longer active on this PC (it was removed, refunded or cancelled). Paste a key to turn Pro back on.';
        return;
      }
      if (info === 'unknown') return; // a server hiccup is not the user's problem
      this.writeSigned(this.file, { ...rec, limitActivations: info.quota, expiresAt: info.expiration, checkedAt: this.now() });
      this.problem = null;
    })();
    try { await this.checking; } finally { this.checking = null; }
    return this.status();
  }

  /** "Remove this PC": frees one of the key's 3 activations. Works even if Freemius can't be reached. */
  async deactivate(): Promise<ProStatus> {
    const rec = this.record();
    if (!rec) return this.status();
    let freed = false;
    try {
      const res = await this.call('POST', 'licenses/deactivate.json', { uid: this.uid, install_id: rec.installId, license_key: rec.key });
      freed = res.ok || res.status === 404;
    } catch { /* offline */ }
    this.forget();
    this.problem = freed ? null : "Pro is off on this PC, but Lotus couldn't reach the licence server to free its slot. Remove this PC in your Freemius account.";
    return this.status();
  }

  private forget(): void {
    try { rmSync(this.file, { force: true }); } catch { /* already gone */ }
  }
}
