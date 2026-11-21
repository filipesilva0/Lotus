// The header on every assistant reply (0.20): the assistant's face and its name from the Soul. Chat, Work
// and the voice call transcript use it, so the assistant looks and is called the same everywhere.

import React from 'react';
import { AgentFace } from './AgentFace';
import { useAssistantName } from '../../lib/identity';
import type { AvatarLook } from '../../agents/avatars';

export const ReplyHeader: React.FC<{ live?: boolean; mood?: AvatarLook['expression']; detail?: React.ReactNode }> = ({ live, mood, detail }) => {
  const name = useAssistantName();
  return (
    <p className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--color-text-muted)] mb-1">
      {/* The face is the status: it only moves while the assistant is working. */}
      <AgentFace size={18} animate={!!live} mood={mood ?? (live ? 'thinking' : undefined)} label={name} />
      <span className="text-[var(--color-text-main)]">{name}</span>
      {detail && <span className="font-normal truncate">{detail}</span>}
    </p>
  );
};
