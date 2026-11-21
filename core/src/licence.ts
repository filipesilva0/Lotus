// Lotus Pro: licence keys, the 14-day trial and whether Pro features are unlocked (0.18.0).
//
// How it works (see the business model doc):
//   1. Polar sells Pro and emails a key.
//   2. The user pastes the key once. We activate it with Polar's customer-portal API, which needs no
//      secret (only the shop's public organization id), and keep a record on this PC, signed with a key
//      derived from this machine so the file only counts here.
//   3. After that Lotus works offline. When online it rechecks every 30 days; a recheck that can't reach
//      Polar changes nothing. Only a clear "this key or activation is gone" answer turns Pro off.
//   4. 3 activations per key (set on the Polar product). "Remove this PC" frees this one; the others are
//      managed in Polar's customer portal.
//
// The launch switch: until `locks` is on, every Pro feature is unlocked for everyone, no trial starts and
// nothing is for sale. The code still runs against Polar's sandbox for testing (LOTUS_POLAR_ENV=sandbox).
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
  /** Polar's customer portal, where buyers see their keys and remove old PCs. */
  portalUrl: string;
  /** Polar shop (organization) id. Public, not a secret. Empty: keys can't be activated yet. */
  organizationId: string;
  /** 'production' or 'sandbox' (Polar's practice shop with fake payments). */
  env: 'production' | 'sandbox';
}

/** What ships. Selling and the locks stay off until the launch release. */
export const PRO_CONFIG: ProConfig = {
  locks: false,
  buyUrl: '',
  portalUrl: '',
  organizationId: '',
  env: 'production',
};

/** Testing only: point a build at Polar's sandbox without changing the code. */
export function proConfigFromEnv(env: Record<string, string | undefined> = process.env, base: ProConfig = PRO_CONFIG): ProConfig {
  const c = { ...base };
  if (env.LOTUS_POLAR_ENV === 'sandbox') c.env = 'sandbox';
  if (env.LOTUS_POLAR_ORG) c.organizationId = env.LOTUS_POLAR_ORG;
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
  /** The key as Polar shows it (e.g. "****-ABCD"), never the full key. */
  displayKey: string | null;
  limitActivations: number | null;
  lastCheckedAt: number | null;
  /** A recheck said the key or this PC's activation is gone. */
  problem: string | null;
  buyUrl: string;
  portalUrl: string;
  /** Keys can be activated (a shop id is set). */
  canActivate: boolean;
  sandbox: boolean;
}

interface LicenceRecord {
  key: string;
  displayKey: string;
  activationId: string;
  licenseKeyId: string;
  limitActivations: number | null;
  expiresAt: string | null;
  activatedAt: number;
  checkedAt: number;
  env: ProConfig['env'];
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

const apiBase = (env: ProConfig['env']) => (env === 'sandbox' ? 'https://sandbox-api.polar.sh' : 'https://api.polar.sh');

export class Licence {
  readonly config: ProConfig;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly secret: Buffer;
  private readonly machineId: string;
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
    this.machineId = createHash('sha256').update(`lotus-machine|${machine}`).digest('hex').slice(0, 24);
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
    // A record made against the sandbox doesn't count in a production build, and the other way round.
    return r && r.env === this.config.env ? r : null;
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
      canActivate: !!c.organizationId,
      sandbox: c.env === 'sandbox',
    };
  }

  /** Is this feature usable now? */
  allows(feature: ProFeature): boolean {
    void feature; // every Pro feature unlocks together today
    return this.status().unlocked;
  }

  // ---- Polar ----------------------------------------------------------------------------------

  private async polar(path: 'activate' | 'validate' | 'deactivate', body: Record<string, unknown>): Promise<Response> {
    if (!this.config.organizationId) throw new LicenceError('Licence keys are not set up in this build yet.');
    try {
      return await this.fetchFn(`${apiBase(this.config.env)}/v1/customer-portal/license-keys/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ organization_id: this.config.organizationId, ...body }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new LicenceError("Lotus couldn't reach the licence server. Check your internet connection and try again.");
    }
  }

  private static async detail(res: Response): Promise<string> {
    try { const j = (await res.json()) as { detail?: unknown }; return typeof j.detail === 'string' ? j.detail : ''; } catch { return ''; }
  }

  /** Paste a key: activate it for this PC and keep the signed record. */
  async activate(rawKey: string, label?: string): Promise<ProStatus> {
    const key = rawKey.trim();
    if (key.length < 8) throw new LicenceError("That doesn't look like a Lotus Pro key. Copy the whole key from your purchase email.");
    const res = await this.polar('activate', {
      key,
      label: (label || hostname() || 'This PC').slice(0, 100),
      meta: { app: 'lotus', machine: this.machineId },
    });
    if (res.status === 404) throw new LicenceError("That key wasn't found. Check that you copied all of it.");
    if (res.status === 403) {
      const d = (await Licence.detail(res)).toLowerCase();
      if (d.includes('limit')) throw new LicenceError('This key is already used on 3 PCs. Remove one of them in your Polar account, then try again.');
      throw new LicenceError('This key is no longer active (it may have been refunded or turned off).');
    }
    if (!res.ok) throw new LicenceError(`The licence server answered with an error (${res.status}). Try again in a minute.`);
    const j = (await res.json()) as { id?: string; license_key_id?: string; license_key?: { display_key?: string; limit_activations?: number | null; expires_at?: string | null } };
    if (!j.id) throw new LicenceError('The licence server gave an answer Lotus did not understand.');
    const now = this.now();
    const rec: LicenceRecord = {
      key,
      displayKey: j.license_key?.display_key || `****-${key.slice(-4).toUpperCase()}`,
      activationId: j.id,
      licenseKeyId: j.license_key_id ?? '',
      limitActivations: j.license_key?.limit_activations ?? null,
      expiresAt: j.license_key?.expires_at ?? null,
      activatedAt: now,
      checkedAt: now,
      env: this.config.env,
    };
    this.writeSigned(this.file, rec);
    this.problem = null;
    return this.status();
  }

  /**
   * Every 30 days when online. Can't reach Polar → nothing changes. A clear "not found" (key revoked,
   * refunded, or this PC removed elsewhere) → back to Free, with a note saying why.
   */
  async recheck(force = false): Promise<ProStatus> {
    if (this.checking) { await this.checking; return this.status(); }
    const rec = this.record();
    if (!rec || !this.config.organizationId) return this.status();
    if (!force && this.now() - rec.checkedAt < RECHECK_DAYS * DAY) return this.status();
    this.checking = (async () => {
      let res: Response;
      try { res = await this.polar('validate', { key: rec.key, activation_id: rec.activationId }); } catch { return; }
      if (res.status === 404) {
        this.forget();
        this.problem = 'Your Lotus Pro key is no longer active on this PC (it was removed, refunded or turned off). Paste a key to turn Pro back on.';
        return;
      }
      if (!res.ok) return; // a server hiccup is not the user's problem
      let expiresAt = rec.expiresAt;
      try { expiresAt = ((await res.json()) as { expires_at?: string | null }).expires_at ?? null; } catch { /* keep */ }
      this.writeSigned(this.file, { ...rec, expiresAt, checkedAt: this.now() });
      this.problem = null;
    })();
    try { await this.checking; } finally { this.checking = null; }
    return this.status();
  }

  /** "Remove this PC": frees one of the key's 3 activations. Works even if Polar can't be reached. */
  async deactivate(): Promise<ProStatus> {
    const rec = this.record();
    if (!rec) return this.status();
    let freed = false;
    try {
      const res = await this.polar('deactivate', { key: rec.key, activation_id: rec.activationId });
      freed = res.status === 204 || res.status === 404 || res.ok;
    } catch { /* offline */ }
    this.forget();
    this.problem = freed ? null : "Pro is off on this PC, but Lotus couldn't reach the licence server to free its slot. Remove this PC in your Polar account.";
    return this.status();
  }

  private forget(): void {
    try { rmSync(this.file, { force: true }); } catch { /* already gone */ }
  }
}
