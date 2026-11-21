// When Lotus renames a chat by itself (pure; tested in core/test/v020.test.ts). See rename.ts.

import type { ChatSession } from '../types/lotus';

/** True right after the first reply of a chat whose title Lotus chose itself. */
export function shouldRename(s: Pick<ChatSession, 'title' | 'autoTitle' | 'messages'>): boolean {
  if (!s.autoTitle || s.title !== s.autoTitle) return false;
  const replies = s.messages.filter((m) => m.role === 'assistant' && m.content.trim() && !m.isStreaming);
  return replies.length === 1 && s.messages.some((m) => m.role === 'user' && m.content.trim());
}

/** The session as it is once reply `aiId` has finished with `content` (state updates may still be on their way). */
export function withFinishedReply<S extends Pick<ChatSession, 'messages'>>(s: S, aiId: string, content: string): S {
  return { ...s, messages: s.messages.map((m) => (m.id === aiId ? { ...m, isStreaming: false, content: content || m.content } : m)) };
}

