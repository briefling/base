// Thread list pages per space (infinite scroll): the cursor of the next page and the request in flight.
// DOM-free, tested in client/test/paging.test.ts. Threads of a page are merged like any thread (highest `version` kept),
// so a thread received both live and in a page is never shown twice.

export interface Paging { cursor: Map<string, string | null>; pending: Set<string> }
export const newPaging = (): Paging => ({ cursor: new Map(), pending: new Set() });

/** `synced` or `threads.page` received for the space: next cursor (null = end of the list), request done. */
export function onPage(p: Paging, space: string, cursor: string | null) { p.cursor.set(space, cursor); p.pending.delete(space); }

/** More threads to load in this space (not synced yet = no). */
export const hasMore = (p: Paging, space: string) => !!p.cursor.get(space);

/** Last activity at the cursor (`<updatedAt>.<id>`, `encodeCursor` in hub/src/router.ts) while pages remain: every
 *  thread active after it is loaded. null at the end of the list, before the sync, or on a cursor of another shape. */
export function cursorAt(p: Paging, space: string): number | null {
  const n = Number(p.cursor.get(space)?.split('.')[0] ?? NaN);
  return Number.isFinite(n) ? n : null;
}

/** Cursor to request now and marks it in flight; null at the end of the list or while a request is already in flight. */
export function takeNext(p: Paging, space: string): string | null {
  const c = p.cursor.get(space);
  if (!c || p.pending.has(space)) return null;
  p.pending.add(space);
  return c;
}

/** The request could not be sent (offline): it can be asked again. */
export const cancel = (p: Paging, space: string) => { p.pending.delete(space); };
