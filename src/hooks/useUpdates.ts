import { useCallback, useEffect, useRef, useState } from 'react';
import {
  UpdateInfo, checkForUpdate, installUpdate, onUpdateProgress, updatesSupported, currentVersion,
} from '../services/updateService';
import { appPaths } from '../services/engineControl';

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'current'; checkedAt: number }
  | { kind: 'available'; info: UpdateInfo }
  | { kind: 'installing'; downloaded: number; total: number | null }
  | { kind: 'error'; message: string };

const PREF_KEY = 'lotus.updates.v1';
const loadAuto = (): boolean => {
  try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}').autoCheck === true; } catch { return false; }
};

/** Update state for the whole studio window. Network is touched only by check() / install(). */
export function useUpdates() {
  const [state, setState] = useState<UpdateState>({ kind: 'idle' });
  const [version, setVersion] = useState<string | null>(null);
  const [portable, setPortable] = useState(false);
  const [autoCheck, setAutoCheckState] = useState(loadAuto);
  const busy = useRef(false);

  useEffect(() => {
    void currentVersion().then(setVersion);
    void appPaths().then((p) => setPortable(!!p?.portable));
  }, []);

  const check = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setState({ kind: 'checking' });
    try {
      const info = await checkForUpdate();
      setState(info ? { kind: 'available', info } : { kind: 'current', checkedAt: Date.now() });
    } catch (e) {
      setState({ kind: 'error', message: (e as Error).message });
    } finally {
      busy.current = false;
    }
  }, []);

  const install = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setState({ kind: 'installing', downloaded: 0, total: null });
    const off = await onUpdateProgress((p) => setState({ kind: 'installing', ...p }));
    try {
      await installUpdate(); // normally never returns: the installer closes Lotus and reopens it
    } catch (e) {
      setState({ kind: 'error', message: (e as Error).message });
    } finally {
      off();
      busy.current = false;
    }
  }, []);

  const setAutoCheck = useCallback((v: boolean) => {
    localStorage.setItem(PREF_KEY, JSON.stringify({ autoCheck: v }));
    setAutoCheckState(v);
  }, []);

  // Optional check shortly after launch (off by default: it is the one request Lotus makes to GitHub).
  useEffect(() => {
    if (!updatesSupported || !autoCheck) return;
    const t = setTimeout(() => void check(), 4000);
    return () => clearTimeout(t);
    // run once per launch, not whenever the toggle flips later
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { state, version, portable, autoCheck, setAutoCheck, check, install, supported: updatesSupported };
}

export type Updates = ReturnType<typeof useUpdates>;
