// Minimal IndexedDB key/value store for things localStorage cannot hold (image blobs, long galleries).
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

export const idbGet = <T,>(key: string) => tx<T | undefined>('readonly', (s) => s.get(key) as IDBRequest<T | undefined>).catch(() => undefined);
export const idbSet = (key: string, value: unknown) => tx('readwrite', (s) => s.put(value, key)).then(() => true).catch(() => false);
export const idbDel = (key: string) => tx('readwrite', (s) => s.delete(key)).catch(() => undefined);
