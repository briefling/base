// Slack-style grouping: an item shows without avatar nor name, under the previous one, when the same author wrote both
// close enough. DOM-free, tested in client/test/grouping.test.ts.

/** Thread conversations: two messages of the same author group when written less than 5 min apart. */
export const GAP_THREAD = 5 * 60_000;
/** Lounge feed and General (« A »): grouping lasts while nobody else writes, up to 30 min between two items. */
export const GAP_LOUNGE = 30 * 60_000;

export interface Groupable {
  /** null = unknown author (an old topic with no author): never groups, nothing groups under it. */
  author: { kind: string; id: string } | null;
  at: number;
  /** A later item may group under this one: a text message or a topic card (not a card of another kind). */
  lead: boolean;
}

/** The item a message groups under: the last one before index `i` that is not a gateway notice, so a notice (small
 *  grey line, no author header) never breaks a run of the same author. */
export function groupPrev<T extends { notice?: true }>(all: readonly T[], i: number): T | null {
  for (let j = i - 1; j >= 0; j--) if (!all[j].notice) return all[j];
  return null;
}

/** `cur` shows grouped under `prev` (the item right before it): same author, `prev` can lead, less than `gap` apart. */
export function groupsUnder(prev: Groupable | null | undefined, cur: Groupable, gap: number): boolean {
  if (!prev?.lead || !prev.author || !cur.author) return false;
  return prev.author.kind === cur.author.kind && prev.author.id === cur.author.id && cur.at - prev.at < gap;
}
