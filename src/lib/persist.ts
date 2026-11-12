import { useEffect, useState } from 'react';
import { kv } from './store';

/** useState that mirrors a JSON value into `kv` (lotus.db through the core; localStorage without one) (key should be `lotus.*.v1`). */
export function usePersisted<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [v, setV] = useState<T>(() => {
    try { const raw = kv.getItem(key); return raw ? (JSON.parse(raw) as T) : initial; } catch { return initial; }
  });
  useEffect(() => { try { kv.setItem(key, JSON.stringify(v)); } catch { /* quota: keep working in memory */ } }, [key, v]);
  return [v, setV];
}

export const uid = (p = 'id') => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
