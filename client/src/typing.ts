// « Blair is typing… » (hub/src/typing.ts): while I type in a composer, `typing.set` at most every
// TYPING_EVERY_MS, and `off` once the field is empty (sent or cleared); the others' frames are kept per conversation and
// forgotten TYPING_TTL_MS after the last one (a lost `off`, a closed tab). Humans only: the agents have their « working »
// line. DOM-free, tested in client/test/typing.test.ts.
import type { Lang } from './i18n.ts';

export const TYPING_EVERY_MS = 3000;
export const TYPING_TTL_MS = 6000;

/** Conversation → who → time of their last `typing.updated` (ms), in arrival order. */
export type Typing = Map<string, Map<string, number>>;

/** What my composer sends for its current text, given when it last sent « on » (undefined = never, or `off` since). */
export function typingFrame(lastOn: number | undefined, text: string, now: number): 'on' | 'off' | null {
  if (!text.trim()) return lastOn === undefined ? null : 'off';
  return lastOn === undefined || now - lastOn >= TYPING_EVERY_MS ? 'on' : null;
}

/** A `typing.updated` received (or their message arrived: `off`). */
export function noteTyping(m: Typing, thread: string, who: string, off: boolean, now: number): void {
  const cur = m.get(thread) ?? new Map<string, number>();
  cur.delete(who); // re-inserted last: the order is the one they started in, refreshed by nobody else
  if (!off) cur.set(who, now);
  if (cur.size) m.set(thread, cur); else m.delete(thread);
}

/** Who is typing in `thread` now (expired ones dropped), in the order they started. */
export function typersOf(m: Typing, thread: string, now: number): string[] {
  const cur = m.get(thread);
  if (!cur) return [];
  for (const [who, at] of cur) if (now - at >= TYPING_TTL_MS) cur.delete(who);
  if (!cur.size) m.delete(thread);
  return [...cur.keys()];
}

/** « Blair », « Blair and Paul », « Blair, Paul and Léa »: the names joined the way the language does. */
export const typingWho = (names: string[], lang: Lang): string => new Intl.ListFormat(lang, { type: 'conjunction' }).format(names);
