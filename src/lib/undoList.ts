// Undo for deletes from a list (0.19 critique: "undo on every delete"). Kept free of React so the
// core's tests can check it.

/** The list without the item, and where it was, so Undo can put it back in the same place. */
export function takeOut<T extends { id: string }>(list: T[], id: string): { rest: T[]; item: T | null; index: number } {
  const index = list.findIndex((x) => x.id === id);
  return index < 0 ? { rest: list, item: null, index: -1 } : { rest: [...list.slice(0, index), ...list.slice(index + 1)], item: list[index], index };
}

/** Puts an item back at its old position (or the end), unless it is already there. */
export function putBack<T extends { id: string }>(list: T[], item: T, index: number): T[] {
  if (list.some((x) => x.id === item.id)) return list;
  const at = index < 0 ? list.length : Math.min(index, list.length);
  return [...list.slice(0, at), item, ...list.slice(at)];
}
