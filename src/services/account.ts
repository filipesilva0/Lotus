import { useSyncExternalStore } from 'react';
import { http } from '../lib/http';
import { syncDelete, syncGet, syncPut } from './sync';

/**
 * Lotus accounts: sign-in for syncing the studio between PCs.
 *
 * The account server is a Supabase project (hosted at supabase.com, or self-hosted with Docker).
 * Lotus only talks to two of its standard REST APIs, so any compatible server works:
 *   - Auth (GoTrue)   /auth/v1/...   sign up, sign in, refresh, user profile
 *   - Data (PostgREST) /rest/v1/...  the `user_state` table used by services/sync.ts
 * The table and its row-level security live in `sync-server/schema.sql`.
 *
 * Server address and public ("anon") key come from, in order:
 *   1. what the user entered in the sign-in sheet (lotus.account.server.v1)
 *   2. build-time env VITE_LOTUS_SYNC_URL / VITE_LOTUS_SYNC_KEY (for an official Lotus server later)
 * The anon key is public by design; row-level security is what protects each user's data.
 */

export interface SyncServer { url: string; anonKey: string }

export interface AccountUser {
  id: string;
  email: string;
  name: string;
  /** data: URL, or null to show initials. */
  avatar: string | null;
}

interface StoredSession {
  accessToken: string;
  refreshToken: string;
  /** epoch ms */
  expiresAt: number;
  user: AccountUser;
}

export type AccountState =
  | { kind: 'signed-out' }
  | { kind: 'signed-in'; user: AccountUser };

const SERVER_KEY = 'lotus.account.server.v1';
const SESSION_KEY = 'lotus.account.v1';

// ── Server config ──────────────────────────────────────────────────────────
export function getServer(): SyncServer | null {
  try {
    const saved = JSON.parse(localStorage.getItem(SERVER_KEY) || 'null') as SyncServer | null;
    if (saved?.url && saved.anonKey) return saved;
  } catch { /* fall through */ }
  const url = import.meta.env.VITE_LOTUS_SYNC_URL as string | undefined;
  const anonKey = import.meta.env.VITE_LOTUS_SYNC_KEY as string | undefined;
  return url && anonKey ? { url, anonKey } : null;
}

export function setServer(s: SyncServer | null): void {
  if (!s) localStorage.removeItem(SERVER_KEY);
  else localStorage.setItem(SERVER_KEY, JSON.stringify({ url: s.url.trim().replace(/\/+$/, ''), anonKey: s.anonKey.trim() }));
  emit();
}

// ── Session store ──────────────────────────────────────────────────────────
let session: StoredSession | null = (() => {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null') as StoredSession | null; } catch { return null; }
})();
let snapshot: AccountState = session ? { kind: 'signed-in', user: session.user } : { kind: 'signed-out' };
const subs = new Set<() => void>();

function emit() {
  snapshot = session ? { kind: 'signed-in', user: session.user } : { kind: 'signed-out' };
  subs.forEach((f) => f());
}
function save(s: StoredSession | null) {
  session = s;
  if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else localStorage.removeItem(SESSION_KEY);
  emit();
}

// Another window (the island) signing in or out keeps both in step.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== SESSION_KEY && e.key !== SERVER_KEY) return;
    try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null') as StoredSession | null; } catch { session = null; }
    emit();
  });
}

export const accountStore = {
  get: () => snapshot,
  subscribe: (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn); }; },
};

export function useAccount(): AccountState {
  return useSyncExternalStore(accountStore.subscribe, accountStore.get, accountStore.get);
}

// ── Errors ─────────────────────────────────────────────────────────────────
export class AccountError extends Error {}

function needServer(): SyncServer {
  const s = getServer();
  if (!s) throw new AccountError('No sync server is set up yet. Add its address and public key under "Sync server" first.');
  return s;
}

async function call<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const srv = needServer();
  const headers = new Headers(init.headers);
  headers.set('apikey', srv.anonKey);
  headers.set('Content-Type', 'application/json');
  headers.set('Authorization', `Bearer ${init.token ?? srv.anonKey}`);
  let res: Response;
  try {
    res = await http(`${srv.url}${path}`, { ...init, headers });
  } catch (e) {
    throw new AccountError(`Could not reach the sync server at ${srv.url}. Check your connection and the server address. (${(e as Error).message})`);
  }
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try { body = text ? (JSON.parse(text) as Record<string, unknown>) : {}; } catch { /* non-JSON */ }
  if (!res.ok) {
    const msg = String(body.msg ?? body.error_description ?? body.message ?? body.error ?? `HTTP ${res.status}`);
    if (res.status === 400 && /invalid login/i.test(msg)) throw new AccountError('That email and password do not match an account.');
    if (/email not confirmed/i.test(msg)) throw new AccountError('Confirm your email first: open the link the server sent you, then sign in.');
    if (res.status === 401 || res.status === 403) throw new AccountError(`The server refused the request (${msg}). Check the public key under "Sync server".`);
    throw new AccountError(msg);
  }
  return body as T;
}

// ── Auth API ───────────────────────────────────────────────────────────────
interface RawUser { id: string; email?: string; user_metadata?: { full_name?: string; name?: string; avatar_url?: string } }
interface TokenResponse { access_token: string; refresh_token: string; expires_in: number; user: RawUser }

function toUser(u: RawUser, avatar: string | null): AccountUser {
  const email = u.email ?? '';
  return { id: u.id, email, name: u.user_metadata?.full_name || u.user_metadata?.name || email.split('@')[0] || 'Lotus user', avatar };
}

async function remoteAvatar(url?: string): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith('data:')) return url;
  // Remote images are blocked by the page's CSP, so fetch through Rust and keep a data: URL.
  try {
    const res = await http(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = bad; r.readAsDataURL(blob); });
  } catch { return null; }
}

async function adopt(t: TokenResponse): Promise<AccountUser> {
  const base = { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: Date.now() + t.expires_in * 1000 };
  // Save first so the avatar lookup below can use the token.
  save({ ...base, user: toUser(t.user, session?.user.id === t.user.id ? session.user.avatar : null) });
  const stored = await syncGet<string>('profile.avatar').catch(() => null);
  const avatar = stored ?? (await remoteAvatar(t.user.user_metadata?.avatar_url));
  const user = toUser(t.user, avatar);
  save({ ...base, user });
  return user;
}

export async function signIn(email: string, password: string): Promise<AccountUser> {
  const t = await call<TokenResponse>('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email: email.trim(), password }) });
  return adopt(t);
}

/** Returns the user when the server signs them straight in, or 'confirm-email' when it sent a confirmation link. */
export async function signUp(email: string, password: string, name: string): Promise<AccountUser | 'confirm-email'> {
  const r = await call<Partial<TokenResponse> & RawUser>('/auth/v1/signup', {
    method: 'POST', body: JSON.stringify({ email: email.trim(), password, data: { full_name: name.trim() } }),
  });
  if (r.access_token && r.refresh_token && r.user) return adopt(r as TokenResponse);
  return 'confirm-email';
}

export async function signOut(): Promise<void> {
  const token = session?.accessToken;
  save(null);
  if (token) await call('/auth/v1/logout', { method: 'POST', token }).catch(() => undefined);
}

let refreshing: Promise<string | null> | null = null;

/** A valid access token for API calls (refreshed when close to expiry), or null when signed out. */
export async function getAccessToken(): Promise<string | null> {
  if (!session) return null;
  if (session.expiresAt - Date.now() > 60_000) return session.accessToken;
  refreshing ??= (async () => {
    try {
      const t = await call<TokenResponse>('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: session!.refreshToken }) });
      save({ accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: Date.now() + t.expires_in * 1000, user: { ...session!.user, ...toUser(t.user, session!.user.avatar) } });
      return t.access_token;
    } catch (e) {
      // A rejected refresh token means the session is over; a network failure keeps it for later.
      if (e instanceof AccountError && /refresh token|invalid|expired|refused/i.test(e.message)) save(null);
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** Change the display name and/or picture. The picture is synced as `profile.avatar` (kept out of the auth token). */
export async function updateProfile(p: { name?: string; avatar?: string | null }): Promise<void> {
  const token = await getAccessToken();
  if (!token || !session) throw new AccountError('You are signed out. Sign in again to change your profile.');
  if (p.name !== undefined) {
    await call('/auth/v1/user', { method: 'PUT', token, body: JSON.stringify({ data: { full_name: p.name.trim() } }) });
  }
  if (p.avatar !== undefined) {
    if (p.avatar) await syncPut('profile.avatar', p.avatar); else await syncDelete('profile.avatar');
  }
  save({ ...session, user: { ...session.user, ...(p.name !== undefined ? { name: p.name.trim() || session.user.name } : {}), ...(p.avatar !== undefined ? { avatar: p.avatar } : {}) } });
}

/** Shrink a picked image to a 128 px square JPEG data: URL (about 5–10 KB). */
export async function imageToAvatar(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new AccountError('That file is not an image Lotus can read.')); i.src = url; });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    c.getContext('2d')!.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 128, 128);
    return c.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}
