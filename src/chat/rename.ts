// Chat auto-rename (session 7): after the first reply, the background tasks model gives the chat a
// short title. Runs as housekeeping in the agent pool (waits while a reply streams). A title the
// user typed is never replaced: only titles Lotus set itself (`autoTitle`) are renamed.

import { agentPool } from '../agents/pool';
import { llm } from '../services/llm';
import { CHAT_TITLER_SKILL } from '../skills/system';
import type { ChatSession } from '../types/lotus';

/** Turns a model reply into a usable title, or '' if it is not one. */
export function cleanTitle(raw: string): string {
  let t = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim().split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  t = t.replace(/^(title|chat title)\s*[:\-–]\s*/i, '').replace(/^["'“”‘’*#`\s]+|["'“”‘’*`.\s]+$/g, '').replace(/\s+/g, ' ');
  if (!t || t.length > 60) t = t.slice(0, 60).replace(/\s+\S*$/, '');
  return t.length >= 2 ? t : '';
}

/** True right after the first reply of a chat whose title Lotus chose itself. */
export function shouldRename(s: Pick<ChatSession, 'title' | 'autoTitle' | 'messages'>): boolean {
  if (!s.autoTitle || s.title !== s.autoTitle) return false;
  const replies = s.messages.filter((m) => m.role === 'assistant' && m.content.trim() && !m.isStreaming);
  return replies.length === 1 && s.messages.some((m) => m.role === 'user' && m.content.trim());
}

export function titleTurns(s: Pick<ChatSession, 'messages'>) {
  const convo = s.messages.filter((m) => m.role !== 'system' && m.content.trim()).slice(0, 4)
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.replace(/```[\s\S]*?```/g, '[code]').slice(0, 800)}`).join('\n\n');
  return [
    { role: 'system' as const, content: CHAT_TITLER_SKILL },
    { role: 'user' as const, content: `Conversation:\n\n${convo}\n\nTitle:` },
  ];
}

export function suggestTitle(s: Pick<ChatSession, 'messages'>): Promise<string> {
  return agentPool.run('Naming the chat', 'rename', async ({ model, numCtx, signal }) => {
    if (!model) return '';
    const r = await llm.chatOnce(titleTurns(s), { model, numCtx: Math.min(numCtx || 4096, 4096), temperature: 0.2, numPredict: 24, signal, think: false });
    return cleanTitle(r.content);
  }, { priority: 2 });
}
