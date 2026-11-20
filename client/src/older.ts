// Older messages of a conversation, loaded page by page as the reader scrolls up (infinite scroll upwards).
// The hub sends the latest page on open (`history`), then the page older than a message on demand
// (`history { before }`), with `more` when older ones remain. DOM-free, tested in client/test/older.test.ts.

/** Per conversation: the oldest message loaded while older ones remain (null = start reached), and a request in flight. */
export type Older = Map<string, { oldest: string | null; pending: boolean }>;

/** A `history` page arrived (latest page or an older one): what remains above it. */
export function onHistory(o: Older, thread: string, page: { before?: string; more: boolean; first?: string }) {
  const cur = o.get(thread);
  // An older page that no longer answers the current oldest (a later page or the latest page came first): stale.
  if (page.before && cur?.oldest !== page.before) { if (cur) cur.pending = false; return; }
  o.set(thread, { oldest: page.more && page.first ? page.first : null, pending: false });
}

/** The message to ask the older page for, marking it in flight; null when nothing is left or a request is running. */
export function nextOlder(o: Older, thread: string): string | null {
  const cur = o.get(thread);
  if (!cur || cur.pending || !cur.oldest) return null;
  cur.pending = true;
  return cur.oldest;
}

/** Another walker (a search jump) wants the page older than `before`: false when that very page is already in flight
 *  (the top sentinel asked it: its answer serves both), else marked in flight so the sentinel does not ask it again. */
export function claimOlder(o: Older, thread: string, before: string): boolean {
  const cur = o.get(thread);
  if (cur?.oldest !== before) return true;
  if (cur.pending) return false;
  cur.pending = true;
  return true;
}

/** Older messages remain above what is shown: the top of the conversation shows the loading sentinel. */
export const hasOlder = (o: Older, thread: string) => !!o.get(thread)?.oldest;

/** Request lost (connection dropped): asking again is allowed. */
export function olderFailed(o: Older) { for (const v of o.values()) v.pending = false; }
