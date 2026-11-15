// An agent's face (session 16): a blobatar from the agent's name, or the look the main agent designed
// for it with avatar.create (lotus.avatars.v1, updated live). Lotus itself is Petal, the island mascot.

import React, { useEffect, useState } from 'react';
import { Blobatar } from '../../vendor/blobatar/react';
import '../../vendor/blobatar/motion.css';
import { AVATARS_KEY, avatarOptions, AvatarLook, LOTUS_LOOK, LOTUS_SEED, parseLooks, petal } from '../../agents/avatars';
import { kv } from '../../lib/store';

let looks = parseLooks(kv.getItem(AVATARS_KEY));
const subs = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => { if (e.key === AVATARS_KEY) { looks = parseLooks(e.newValue); subs.forEach((f) => f()); } });
}
export function useLooks(): Record<string, AvatarLook> {
  const [, bump] = useState(0);
  useEffect(() => { const f = () => bump((n) => n + 1); subs.add(f); looks = parseLooks(kv.getItem(AVATARS_KEY)); return () => { subs.delete(f); }; }, []);
  return looks;
}

/** `name` 'Lotus' (or empty) is the main agent. `mood` overrides the saved expression. */
export const AgentFace: React.FC<{ name?: string; size?: number; animate?: boolean; mood?: AvatarLook['expression']; className?: string; /** Shown on hover instead of the name. */ label?: string }> = ({ name, size = 28, animate = true, mood, className, label: shownAs }) => {
  const all = useLooks();
  const [hue, setHue] = useState(petal.hue());
  useEffect(() => petal.on(setHue), []);
  const main = !name || name.toLowerCase() === 'lotus';
  const look: AvatarLook = main ? { ...LOTUS_LOOK, hue } : (all[name!.toLowerCase()] ?? {});
  const opts = avatarOptions({ ...look, ...(mood ? { expression: mood } : {}) });
  const label = shownAs ?? (main ? 'Lotus' : name!);
  return (
    <span className={className} title={look.about ? `${label}: ${look.about}` : label} style={{ display: 'inline-flex', width: size, height: size, flexShrink: 0 }}>
      {animate
        ? <Blobatar name={main ? LOTUS_SEED : name!} size={size} {...opts} animate="always" title={label} />
        : <Blobatar name={main ? LOTUS_SEED : name!} size={size} {...opts} title={label} alt={label} />}
    </span>
  );
};
