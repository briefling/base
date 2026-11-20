// Sidebar entries remember their last open conversation: back on Lounge (a space, Later, Closed), the topic or thread
// you left is open again. In memory, per tab (a reload keeps the view through the URL). DOM-free, tested in
// client/test/lastconv.test.ts. Now is left out on purpose: it shows what waits for you, reopening a handled thread
// there would hide it.
import type { PublicThread } from '../../protocol/frames.ts';
import { generalId } from '../../protocol/frames.ts';
import { viewOf } from './search.ts';

type View = { kind: string; id?: string };
type Listed = Pick<PublicThread, 'kind' | 'state' | 'archived' | 'outcome' | 'space' | 'updatedAt'>;
/** Entry → last selection (null = list alone). The new-topic composer ('new') is never kept: Blair, the Lounge came
 *  back on it forever after one click; it now comes back on the last topic opened, else General. */
export type LastConv = Map<string, string | null>;

const REMEMBERED = new Set(['space', 'lounge', 'later', 'closed']);
const keyOf = (v: View) => REMEMBERED.has(v.kind) && v.id ? `${v.kind}:${v.id}` : null;

/** Called on every render: the selection shown in a remembered entry becomes its memory (null included). */
export function remember(mem: LastConv, v: View, sel: string | null): void {
  const k = keyOf(v);
  if (k && sel !== 'new') mem.set(k, sel);
}

/**
 * Selection to open when the sidebar entry `v` is clicked. List alone (null) when the entry is already active (the
 * click closes the conversation), on a narrow screen (one pane: the list first) or when the remembered conversation
 * is no longer listed there (closed, archived, moved to Later, not loaded). The Lounge then opens its General room
 * (arriving in a space lands in the room, not on the new-topic composer), even before its first post.
 */
export function reopen(mem: LastConv, v: View, get: (id: string) => Listed | undefined, o: { active: boolean; narrow: boolean }): string | null {
  const k = keyOf(v);
  if (!k || o.active || o.narrow) return null;
  const fallback = v.kind === 'lounge' && v.id ? generalId(v.id) : null;
  const sel = mem.get(k);
  if (!sel || sel === 'new') return fallback;
  const f = get(sel);
  // A thread opened in the Lounge's side pane (split.ts) comes back there too, while it is listed in its space.
  return f && f.space === v.id && (viewOf(f) === v.kind || (v.kind === 'lounge' && viewOf(f) === 'space')) ? sel : fallback;
}
