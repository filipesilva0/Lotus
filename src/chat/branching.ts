import { ChatMessage } from '../types/lotus';

/*
 * Branching model. The first message of a tail that has alternatives carries `branch`:
 *   { list: tails[], index }  where list[index] is a stale snapshot of the live tail.
 * Switching saves the live tail into list[index] and loads list[newIndex]. Nested branches
 * live inside the stored tails, so switching an earlier branch never corrupts a later one.
 */

const strip = (m: ChatMessage): ChatMessage => { const { branch: _b, ...rest } = m; return rest; };

/** Replace messages[i..] with `newTail`, keeping the old tail as an alternative. */
export function addBranch(messages: ChatMessage[], i: number, newTail: ChatMessage[]): ChatMessage[] {
  const prefix = messages.slice(0, i);
  const oldTail = messages.slice(i);
  const set = oldTail[0]?.branch ?? { list: [oldTail.map((m, k) => (k === 0 ? strip(m) : m))], index: 0 };
  const list = set.list.map((t, k) => (k === set.index ? oldTail.map((m, j) => (j === 0 ? strip(m) : m)) : t));
  list.push(newTail.map((m, k) => (k === 0 ? strip(m) : m)));
  const first: ChatMessage = { ...strip(newTail[0]), branch: { list, index: list.length - 1 } };
  return [...prefix, first, ...newTail.slice(1)];
}

/** Move to the previous/next alternative of the tail starting at index i. */
export function switchBranch(messages: ChatMessage[], i: number, dir: -1 | 1): ChatMessage[] {
  const live = messages.slice(i);
  const set = live[0]?.branch;
  if (!set) return messages;
  const next = set.index + dir;
  if (next < 0 || next >= set.list.length) return messages;
  const list = set.list.map((t, k) => (k === set.index ? live.map((m, j) => (j === 0 ? strip(m) : m)) : t));
  const target = list[next];
  const first: ChatMessage = { ...target[0], branch: { list, index: next } };
  return [...messages.slice(0, i), first, ...target.slice(1)];
}
