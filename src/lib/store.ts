// `kv`: Lotus's key/value storage, a drop-in for localStorage.
//
// With the core running (the desktop app), every `lotus.*` key lives in lotus.db. The window loads
// them all once at start (`initStore`, before React renders), reads are synchronous from memory, and
// writes go to the core in small batches. Other windows hear about changes over the core's event
// socket and get a normal `storage` event, so existing listeners keep working.
//
// Without a core (browser preview, tests, or the core failed to start) it is plain localStorage.
//
// The first time a window connects, everything an older Lotus kept in localStorage and IndexedDB is
// imported (once; the browser copies are left in place as a backup).

import { coreJson, coreReady, forgetCore, onCoreEvent, setCoreError } from './core';

type Mode = 'local' | 'core';
let mode: Mode = 'local';
const mem = new Map<string, string>();
const pendingSet = new Map<string, string>();
const pendingRemove = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing: Promise<void> | null = null;
let failures = 0;
/** Identifies this window's own writes in the broadcast, so they aren't applied twice. */
const origin = `w-${Math.random().toString(36).slice(2, 10)}`;
const errorSubs = new Set<(msg: string | null) => void>();
let lastWriteError: string | null = null;

const ls = (): Storage | null => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };

function fireStorage(key: string, oldValue: string | null, newValue: string | null) {
  if (typeof window === 'undefined' || oldValue === newValue) return;
  try { window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue })); } catch { /* very old engines */ }
}

function setWriteError(msg: string | null) {
  if (msg === lastWriteError) return;
  lastWriteError = msg;
  errorSubs.forEach((f) => f(msg));
}

function schedule(delay = 40) {
  if (flushTimer) return;
  flushTimer = setTimeout(() => { flushTimer = null; void flush(); }, delay);
}

/** Sends queued writes to the core. Keeps them queued (and retries) if the core is unreachable. */
export function flush(): Promise<void> {
  if (mode !== 'core') return Promise.resolve();
  if (flushing) return flushing.then(() => (pendingSet.size || pendingRemove.size ? flush() : undefined));
  if (!pendingSet.size && !pendingRemove.size) return Promise.resolve();
  const set = Object.fromEntries(pendingSet);
  const remove = [...pendingRemove];
  pendingSet.clear(); pendingRemove.clear();
  flushing = coreJson('/v1/kv', 'PUT', { set, remove, origin })
    .then(() => { failures = 0; setWriteError(null); })
    .catch((e: Error) => {
      // Put them back unless a newer write replaced them meanwhile.
      for (const [k, v] of Object.entries(set)) if (!pendingSet.has(k) && !pendingRemove.has(k)) pendingSet.set(k, v);
      for (const k of remove) if (!pendingSet.has(k)) pendingRemove.add(k);
      failures++;
      setWriteError(`Lotus could not save your changes: ${e.message}`);
      flushTimer = setTimeout(() => { flushTimer = null; void flush(); }, Math.min(30_000, 500 * 2 ** failures));
    })
    .finally(() => { flushing = null; });
  return flushing;
}

export const kv = {
  getItem(key: string): string | null {
    if (mode === 'core') return mem.get(key) ?? null;
    return ls()?.getItem(key) ?? null;
  },
  setItem(key: string, value: string): void {
    const v = String(value);
    if (mode !== 'core') { ls()?.setItem(key, v); return; }
    if (mem.get(key) === v) return;
    mem.set(key, v);
    pendingRemove.delete(key);
    pendingSet.set(key, v);
    schedule();
  },
  removeItem(key: string): void {
    if (mode !== 'core') { ls()?.removeItem(key); return; }
    if (!mem.has(key)) return;
    mem.delete(key);
    pendingSet.delete(key);
    pendingRemove.add(key);
    schedule();
  },
  keys(): string[] {
    if (mode === 'core') return [...mem.keys()];
    const s = ls();
    return s ? Array.from({ length: s.length }, (_, i) => s.key(i)).filter((k): k is string => !!k) : [];
  },
  /** JSON helpers (no throw: a damaged value reads as the fallback). */
  getJson<T>(key: string, fallback: T): T {
    const raw = kv.getItem(key);
    if (raw == null) return fallback;
    try { return JSON.parse(raw) as T; } catch { return fallback; }
  },
  setJson(key: string, value: unknown): void { kv.setItem(key, JSON.stringify(value)); },
};

export const storeMode = () => mode;
export const storeWriteError = () => lastWriteError;
export function onStoreWriteError(fn: (msg: string | null) => void): () => void { errorSubs.add(fn); return () => { errorSubs.delete(fn); }; }

// ── import from browser storage ─────────────────────────────────────────────

const MIGRATED_FLAG = 'lotus.core.migrated.v1';
/** IndexedDB entries that hold Blobs are converted by their owners (the gallery saves its images as files). */
const IDB_SKIP = new Set(['gallery.v1']);

async function readIdb(): Promise<Record<string, string>> {
  if (typeof indexedDB === 'undefined') return {};
  return new Promise((resolve) => {
    const out: Record<string, string> = {};
    let req: IDBOpenDBRequest;
    try { req = indexedDB.open('lotus', 1); } catch { resolve(out); return; }
    req.onupgradeneeded = () => { try { req.result.createObjectStore('kv'); } catch { /* exists */ } };
    req.onerror = () => resolve(out);
    req.onsuccess = () => {
      try {
        const store = req.result.transaction('kv', 'readonly').objectStore('kv');
        const cur = store.openCursor();
        cur.onsuccess = () => {
          const c = cur.result;
          if (!c) { resolve(out); return; }
          const k = String(c.key);
          if (!IDB_SKIP.has(k)) { try { out[`lotus.idb.${k}`] = JSON.stringify(c.value); } catch { /* not JSON-able */ } }
          c.continue();
        };
        cur.onerror = () => resolve(out);
      } catch { resolve(out); }
    };
  });
}

async function migrate(): Promise<void> {
  const s = ls();
  if (s?.getItem(MIGRATED_FLAG)) return;
  const items: Record<string, string> = {};
  if (s) for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (k && k.startsWith('lotus.') && k !== MIGRATED_FLAG) { const v = s.getItem(k); if (v != null) items[k] = v; }
  }
  Object.assign(items, await readIdb());
  await coreJson('/v1/kv/migrate', 'POST', { items });
  try { s?.setItem(MIGRATED_FLAG, String(Date.now())); } catch { /* the core remembers too */ }
}

// ── start ───────────────────────────────────────────────────────────────────

let started: Promise<Mode> | null = null;

async function hydrate(): Promise<void> {
  const { items } = await coreJson<{ items: Record<string, string> }>('/v1/kv');
  const prev = new Map(mem);
  mem.clear();
  for (const [k, v] of Object.entries(items)) mem.set(k, v);
  // Writes this window hasn't sent yet still win.
  for (const [k, v] of pendingSet) mem.set(k, v);
  for (const k of pendingRemove) mem.delete(k);
  if (prev.size) {
    for (const k of new Set([...prev.keys(), ...mem.keys()])) fireStorage(k, prev.get(k) ?? null, mem.get(k) ?? null);
  }
}

/** Call once per window before rendering. Resolves to where data lives for this run. */
export function initStore(): Promise<Mode> {
  started ??= (async (): Promise<Mode> => {
    // A core that is busy or restarting gets a few chances (about 12 s) before this window gives up
    // and keeps its changes locally (0.8.0: one failed attempt left the window local for good).
    let lastErr: unknown = null;
    let ok = false;
    for (let attempt = 0; attempt < 4 && !ok; attempt++) {
      if (attempt) { await new Promise((r) => setTimeout(r, 3000)); forgetCore(); }
      const info = await coreReady();
      if (!info) { lastErr = null; continue; }
      try { await migrate(); await hydrate(); ok = true; } catch (e) { lastErr = e; }
    }
    if (!ok) {
      if (lastErr) {
        console.warn('[lotus] core storage unavailable, using browser storage:', lastErr);
        setCoreError(`It started, but this window couldn't reach it (${(lastErr as Error)?.message || String(lastErr)}).`);
      }
      watchForCore();
      return (mode = 'local');
    }
    mode = 'core';
    onCoreEvent((e) => {
      if (e.type === 'hello') {
        // (Re)connected, maybe to a restarted core: catch up on anything missed meanwhile.
        // Only keys that differ fire a storage event, so the first hello is a no-op.
        void hydrate().catch(() => undefined);
        return;
      }
      if (e.type !== 'kv' || e.origin === origin) return;
      for (const [k, v] of Object.entries(e.set)) {
        if (pendingSet.has(k) || pendingRemove.has(k)) continue; // ours is newer
        const old = mem.get(k) ?? null; mem.set(k, v); fireStorage(k, old, v);
      }
      for (const k of e.remove) {
        if (pendingSet.has(k)) continue;
        const old = mem.get(k) ?? null; mem.delete(k); fireStorage(k, old, null);
      }
    });
    if (typeof window !== 'undefined') {
      // Last chance to send queued writes when the window goes away.
      window.addEventListener('pagehide', () => { void flush(); });
      window.addEventListener('beforeunload', () => { void flush(); });
    }
    return mode;
  })();
  return started;
}

/**
 * In local mode (desktop app only): keep checking for the core, and reload the window as soon as it
 * answers, so the window is back on lotus.db without the user quitting Lotus.
 */
let watching = false;
function watchForCore() {
  if (watching || typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
  watching = true;
  const t = setInterval(async () => {
    forgetCore();
    const info = await coreReady().catch(() => null);
    if (!info) return;
    try { await coreJson('/v1/info'); clearInterval(t); window.location.reload(); } catch { /* not yet */ }
  }, 5000);
}

/** For tests: forget everything and go back to localStorage mode. */
export function __resetStoreForTests(): void {
  mode = 'local'; mem.clear(); pendingSet.clear(); pendingRemove.clear(); started = null; failures = 0; lastWriteError = null;
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
}
