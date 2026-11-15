import React from 'react';
import { Blobatar } from '../vendor/blobatar/react';
import { happy, idle, sleepy, surprised, thinking, unsure, type Expression } from '../vendor/blobatar/expression';
import '../vendor/blobatar/motion.css';
import { Mood } from './state';

/**
 * Lotus's mascot, Petal (session 16): a round, lotus-pink blob made with blobatar (MIT,
 * github.com/Alain00/blobatar). The seed and the pinned traits keep it the same creature
 * everywhere; its pose follows what Lotus is doing, and it breathes, bobs and blinks on its own.
 */
export const MASCOT_SEED = 'petal';
const LOOK = { traits: { shape: 0.05 }, tone: 0.4 } as const;

const POSE: Record<Mood, Expression> = {
  idle, thinking, happy, sleep: sleepy, alert: unsure, listening: surprised, speaking: happy,
};
const WORD: Record<Mood, string> = {
  idle: 'resting', thinking: 'working', happy: 'done', sleep: 'asleep', alert: 'waiting for you', listening: 'listening', speaking: 'speaking',
};

export const Mascot: React.FC<{ mood: Mood; size?: number; gaze?: { x: number; y: number }; /** Petal takes the colour of the page you are on. */ hue?: number }> = ({ mood, size = 24, hue = 330 }) => (
  <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
    <Blobatar name={MASCOT_SEED} {...LOOK} hue={hue} size={size} expression={POSE[mood]} animate={mood === 'sleep' ? 'hover' : 'always'}
      title={`Petal is ${WORD[mood]}`} />
    {mood === 'listening' && <span aria-hidden className="absolute inset-[-3px] rounded-full border-2 border-[#F472B6] animate-ping opacity-60" />}
  </span>
);
