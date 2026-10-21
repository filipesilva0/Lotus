import React, { useEffect, useRef, useState } from 'react';
import { Mood } from './state';

/**
 * Tomo's mascot: a soft bead with two eyes that follows your cursor and reacts to what the
 * local AI is doing. Drawn from scratch for this app.
 */
export const Mascot: React.FC<{ mood: Mood; size?: number; gaze?: { x: number; y: number } }> = ({ mood, size = 24, gaze }) => {
  const [blink, setBlink] = useState(false);
  const timer = useRef<number>(0);

  useEffect(() => {
    if (mood === 'sleep' || mood === 'happy') return;
    const loop = () => {
      timer.current = window.setTimeout(() => {
        setBlink(true);
        window.setTimeout(() => setBlink(false), 120);
        loop();
      }, 2200 + Math.random() * 3200);
    };
    loop();
    return () => clearTimeout(timer.current);
  }, [mood]);

  const gx = (gaze?.x ?? 0) * 1.8 + (mood === 'thinking' ? -1.2 : 0);
  const gy = (gaze?.y ?? 0) * 1.4 + (mood === 'thinking' ? -1.6 : 0);
  const eyeY = 19;

  const eyes = () => {
    if (mood === 'sleep')
      return [14.5, 25.5].map((x) => <path key={x} d={`M${x - 2.4} ${eyeY + 1} q2.4 1.8 4.8 0`} stroke="#0B0F19" strokeWidth="1.6" strokeLinecap="round" fill="none" />);
    if (mood === 'happy')
      return [14.5, 25.5].map((x) => <path key={x} d={`M${x - 2.4} ${eyeY + 1.4} q2.4 -3.4 4.8 0`} stroke="#0B0F19" strokeWidth="1.8" strokeLinecap="round" fill="none" />);
    return [14.5, 25.5].map((x) => (
      <ellipse key={x} cx={x + gx} cy={eyeY + gy} rx="2.1" ry={blink ? 0.3 : mood === 'alert' ? 3.9 : 3.2} fill="#0B0F19" style={{ transition: 'ry 90ms' }} />
    ));
  };

  const mouth = () => {
    if (mood === 'speaking')
      return (
        <g>
          {[-2.6, 0, 2.6].map((dx, i) => (
            <rect key={dx} x={20 + dx - 0.9} y={25} width="1.8" height="4.4" rx=".9" fill="#0B0F19" data-tomo-anim
              style={{ transformOrigin: `${20 + dx}px 27px`, animation: `tomo-talk ${0.5 + i * 0.12}s ease-in-out infinite` }} />
          ))}
        </g>
      );
    if (mood === 'listening') return <ellipse cx="20" cy="27" rx="2.1" ry="2.5" fill="#0B0F19" />;
    if (mood === 'alert') return <ellipse cx="20" cy="27.2" rx="1.6" ry="2" fill="#0B0F19" />;
    if (mood === 'thinking') return <path d="M17.5 27.4h5" stroke="#0B0F19" strokeWidth="1.6" strokeLinecap="round" />;
    return <path d={mood === 'happy' ? 'M16.5 25.6q3.5 4.4 7 0' : 'M17 26.4q3 2.6 6 0'} stroke="#0B0F19" strokeWidth="1.6" strokeLinecap="round" fill="none" />;
  };

  return (
    <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label={`Tomo is ${mood}`} className="shrink-0 overflow-visible">
      <defs>
        <radialGradient id="tomo-body" cx="35%" cy="28%" r="85%">
          <stop offset="0%" stopColor="color-mix(in srgb, var(--color-accent-vibrant) 55%, white)" />
          <stop offset="100%" stopColor="var(--color-accent-vibrant)" />
        </radialGradient>
      </defs>
      {mood === 'listening' && <circle cx="20" cy="21" r="17" fill="none" stroke="var(--color-accent-vibrant)" strokeWidth="2" data-tomo-anim style={{ transformOrigin: '20px 21px', animation: 'tomo-pulse 1.4s ease-out infinite' }} />}
      <g data-tomo-anim style={{ transformOrigin: '20px 36px', animation: mood === 'alert' ? 'tomo-bounce .9s ease-in-out infinite' : mood === 'sleep' ? 'none' : 'tomo-breathe 4s ease-in-out infinite' }}>
        <circle cx="20" cy="21" r="17" fill="url(#tomo-body)" />
        <ellipse cx="13.5" cy="12.5" rx="5" ry="3" fill="white" opacity=".28" transform="rotate(-28 13.5 12.5)" />
        {eyes()}
        {mouth()}
      </g>
      {mood === 'thinking' && (
        <g>{[0, 1, 2].map((i) => <circle key={i} cx={29 + i * 4} cy={6} r="1.4" fill="white" data-tomo-anim style={{ animation: `tomo-dots 1.2s ${i * 0.2}s infinite` }} />)}</g>
      )}
      {mood === 'alert' && <text x="31" y="9" fontSize="11" fontWeight="700" fill="#FBBF24">!</text>}
      {mood === 'sleep' && <text x="29" y="9" fontSize="8" fontWeight="600" fill="white" opacity=".7">z</text>}
    </svg>
  );
};
