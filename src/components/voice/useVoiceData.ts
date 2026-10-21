import { useCallback, useEffect, useRef, useState } from 'react';
import {
  voicebox, VoiceProfile, AvailableEffect, EffectPreset, Health,
} from '../../services/voicebox';

export type VbStatus = 'checking' | 'online' | 'offline';

export interface VoiceData {
  status: VbStatus;
  health: Health | null;
  profiles: VoiceProfile[];
  profilesLoading: boolean;
  effects: AvailableEffect[];
  presets: EffectPreset[];
  refreshProfiles: () => Promise<void>;
  refreshPresets: () => Promise<void>;
  recheck: () => void;
}

/** Tracks Voicebox's availability and the lists every voice tab needs. */
export function useVoiceData(): VoiceData {
  const [status, setStatus] = useState<VbStatus>('checking');
  const [health, setHealth] = useState<Health | null>(null);
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [effects, setEffects] = useState<AvailableEffect[]>([]);
  const [presets, setPresets] = useState<EffectPreset[]>([]);
  const wasOnline = useRef(false);

  const refreshProfiles = useCallback(async () => {
    try {
      setProfiles(await voicebox.listProfiles());
    } catch {
      /* status poll will surface the outage */
    } finally {
      setProfilesLoading(false);
    }
  }, []);

  const refreshPresets = useCallback(async () => {
    try {
      setPresets(await voicebox.effectPresets());
    } catch {
      /* ignore */
    }
  }, []);

  const check = useCallback(async () => {
    try {
      const h = await voicebox.health();
      setHealth(h);
      setStatus('online');
      if (!wasOnline.current) {
        wasOnline.current = true;
        void refreshProfiles();
        void refreshPresets();
        voicebox.availableEffects().then(setEffects).catch(() => undefined);
      }
    } catch {
      wasOnline.current = false;
      setStatus('offline');
      setHealth(null);
      setProfilesLoading(false);
    }
  }, [refreshProfiles, refreshPresets]);

  useEffect(() => {
    void check();
    const t = setInterval(check, 4000);
    return () => clearInterval(t);
  }, [check]);

  return { status, health, profiles, profilesLoading, effects, presets, refreshProfiles, refreshPresets, recheck: check };
}

/** Persisted selection of the active voice profile. */
export function useSelectedProfile(profiles: VoiceProfile[]): [VoiceProfile | null, (id: string) => void] {
  const [id, setId] = useState<string | null>(() => localStorage.getItem('tomo.voice.profile'));
  const selected = profiles.find((p) => p.id === id) ?? profiles[0] ?? null;
  return [
    selected,
    (next: string) => {
      localStorage.setItem('tomo.voice.profile', next);
      setId(next);
    },
  ];
}

export function avatarGradient(seed: string): string {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `linear-gradient(135deg, hsl(${h} 70% 62%), hsl(${(h + 48) % 360} 70% 50%))`;
}
