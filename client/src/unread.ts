// « New messages » marker of a conversation (Bar feed and topics): where the reader stopped last time. DOM-free, tested
// in client/test/unread.test.ts. The only read state is one mark per thread (`updatedAt` read, seen.ts), and opening a
// thread moves it at once (`markSeen`), so main.ts freezes the mark the thread had BEFORE it came on screen and gives
// it here. Both clocks are the hub's: a message's `at` and the thread's `updatedAt` (moved by every post, after it).
import type { Message } from '../../protocol/frames.ts';

export type Countable = Pick<Message, 'id' | 'at' | 'author' | 'type'> & { notice?: boolean };

/** `first`: first unread message loaded (null = nothing unread); `n`: unread messages loaded; `more`: the first unread
 *  may be older than the loaded page (older pages remain and the oldest loaded is already unread): the count is « n+ »
 *  and a jump must page back first. */
export interface UnreadMark { first: string | null; firstAt: number | null; n: number; more: boolean }

/** A message that counts as news: not the reader's own, not a grey gateway notice, not an answer (shown in its
 *  question card, never on its own line, so the marker could not sit before it). */
const news = (m: Countable, me: string | null) => m.author.id !== me && !m.notice && m.type !== 'answer';

/**
 * `msgs`: the loaded messages, oldest first. `mark`: the thread's read mark before it was opened; undefined = never
 * read on any device, so every message counts (the same rule as the unread dot, `seen[id] ?? 0`). `older`: older
 * pages remain to load.
 */
export function unreadMark(msgs: readonly Countable[], mark: number | undefined, me: string | null, older: boolean): UnreadMark {
  const since = mark ?? 0;
  const fresh = msgs.filter(m => m.at > since && news(m, me));
  if (!fresh.length) return { first: null, firstAt: null, n: 0, more: false };
  return { first: fresh[0].id, firstAt: fresh[0].at, n: fresh.length, more: older && msgs[0].at > since };
}
