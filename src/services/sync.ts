import { http } from '../lib/http';
import { AccountError, accountStore, getAccessToken, getServer } from './account';

/**
 * Per-user key/value storage on the account server: the base for syncing Lotus between PCs.
 *
 * Each row is (user_id, key, value jsonb, updated_at) in the `user_state` table; row-level security
 * means a signed-in user can only see and change their own rows (see sync-server/schema.sql).
 * Use namespaced keys, e.g. `settings`, `profile.avatar`, `chat.<id>`, `skills.<slug>`.
 *
 * Today only the profile picture uses it. Syncing settings, chats, skills etc. is a matter of
 * calling syncPut on change and syncList/syncGet on sign-in (newest `updated_at` wins).
 */

export interface SyncRow<T = unknown> { key: string; value: T; updated_at: string }

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const srv = getServer();
  const token = await getAccessToken();
  if (!srv || !token) throw new AccountError('Sign in to sync.');
  const headers = new Headers(init.headers);
  headers.set('apikey', srv.anonKey);
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Content-Type', 'application/json');
  let res: Response;
  try {
    res = await http(`${srv.url}/rest/v1/${path}`, { ...init, headers });
  } catch (e) {
    throw new AccountError(`Could not reach the sync server. Changes stay on this PC until it is back. (${(e as Error).message})`);
  }
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 404 || /user_state/.test(text) && /does not exist|not find/i.test(text)) {
      throw new AccountError('The sync server has no user_state table yet. Run sync-server/schema.sql in its SQL editor.');
    }
    throw new AccountError(`Sync failed (HTTP ${res.status}). ${text.slice(0, 200)}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

/** The current user's id from the session (the table's RLS checks it again on the server). */
async function userId(): Promise<string> {
  const s = accountStore.get();
  if (s.kind !== 'signed-in') throw new AccountError('Sign in to sync.');
  return s.user.id;
}

export async function syncGet<T>(key: string): Promise<T | null> {
  const rows = await rest<SyncRow<T>[]>(`user_state?select=key,value,updated_at&key=eq.${encodeURIComponent(key)}`);
  return rows[0]?.value ?? null;
}

/** Every row, optionally only keys starting with `prefix`. */
export async function syncList<T = unknown>(prefix = ''): Promise<SyncRow<T>[]> {
  const filter = prefix ? `&key=like.${encodeURIComponent(prefix.replace(/[%_]/g, '\\$&'))}*` : '';
  return rest<SyncRow<T>[]>(`user_state?select=key,value,updated_at${filter}&order=updated_at.desc`);
}

export async function syncPut<T>(key: string, value: T): Promise<void> {
  const user_id = await userId();
  await rest('user_state?on_conflict=user_id,key', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ user_id, key, value, updated_at: new Date().toISOString() }),
  });
}

export async function syncDelete(key: string): Promise<void> {
  await rest(`user_state?key=eq.${encodeURIComponent(key)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
}
