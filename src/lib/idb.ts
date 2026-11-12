// Minimal key/value store for larger values (App Builder chats). With the core running these live in
// lotus.db as `lotus.idb.<key>` (JSON); without one, in the browser's IndexedDB as before.
// Blobs can't go through the core this way: save images and audio with saveMedia (lib/core.ts).
import { kv, storeMode } from './store';

const DB = 'lotus';
let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore('kv'); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = fn(db.transaction('kv', mode).objectStore('kv'));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

const K = (key: string) => `lotus.idb.${key}`;

export const idbGet = <T,>(key: string): Promise<T | undefined> => {
  if (storeMode() === 'core') return Promise.resolve(kv.getJson<T | undefined>(K(key), undefined));
  return tx<T | undefined>('readonly', (s) => s.get(key) as IDBRequest<T | undefined>).catch(() => undefined);
};
export const idbSet = (key: string, value: unknown): Promise<boolean> => {
  if (storeMode() === 'core') { try { kv.setJson(K(key), value); return Promise.resolve(true); } catch { return Promise.resolve(false); } }
  return tx('readwrite', (s) => s.put(value, key)).then(() => true).catch(() => false);
};
export const idbDel = (key: string): Promise<unknown> => {
  if (storeMode() === 'core') { kv.removeItem(K(key)); return Promise.resolve(); }
  return tx('readwrite', (s) => s.delete(key)).catch(() => undefined);
};
/** The browser's own IndexedDB copy, for one-time imports (the gallery's images). */
export const idbGetLocal = <T,>(key: string) => tx<T | undefined>('readonly', (s) => s.get(key) as IDBRequest<T | undefined>).catch(() => undefined);
