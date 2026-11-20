// Search palette (⌘K): DOM-free rules, tested in client/test. Matching and folding live in protocol/search.ts,
// shared with the hub, so the highlight marks exactly what the hub matched.
import type { Message, PublicThread } from '../../protocol/frames.ts';
import { matchRanges } from '../../protocol/search.ts';
import { shelfOf } from './shelves.ts';

/** View that lists the thread, so opening a result selects it where it lives (Lounge, Later, Closed or the space). */
export function viewOf(f: Pick<PublicThread, 'kind' | 'state' | 'archived' | 'outcome' | 'space' | 'updatedAt'>): 'lounge' | 'later' | 'closed' | 'space' {
  const shelf = shelfOf(f);
  return shelf ?? (f.kind === 'topic' ? 'lounge' : 'space');
}

/** Element to scroll to for a message: an answer is shown inside its question card, so the card. */
export function jumpTarget(msgs: Iterable<Message>, id: string): string {
  for (const m of msgs) if (m.id === id) return m.type === 'answer' && m.ask?.id ? m.ask.id : id;
  return id;
}

/** Text cut into plain and matching pieces (rendered as text nodes and <mark>). */
export function pieces(text: string, terms: string[]): { text: string; hit: boolean }[] {
  const out: { text: string; hit: boolean }[] = [];
  let i = 0;
  for (const [a, b] of matchRanges(text, terms)) {
    if (a > i) out.push({ text: text.slice(i, a), hit: false });
    out.push({ text: text.slice(a, b), hit: true });
    i = b;
  }
  if (i < text.length) out.push({ text: text.slice(i), hit: false });
  return out;
}

/** Keyboard selection in the result list: wraps around, -1 when empty. */
export const moveSel = (i: number, n: number, delta: number) => n ? ((i + delta) % n + n) % n : -1;
