// Lounge on a wide screen (Blair, Nov 1, Slack-like): the feed takes the whole width; a topic or a thread opened from it
// shows in a side pane next to the feed, closed by the cross of that pane, and links clicked in that pane keep it there.
// Narrow screens are unchanged (one pane at a time: mobile.ts). DOM-free, tested in client/test/split.test.ts.

type View = { kind: string; id?: string };
export type LoungeLayout = '' | 'lounge-full' | 'lounge-split';

/** Shell class of the Lounge (style.css applies it above 700 px only): the feed alone, or feed + side pane. */
export function loungeLayout(v: View, sel: string | null): LoungeLayout {
  return v.kind !== 'lounge' ? '' : sel ? 'lounge-split' : 'lounge-full';
}

/**
 * View a thread of `space` opens in. From that space's Lounge on a wide screen, the Lounge itself (side pane, the feed
 * stays); anywhere else, or on a phone, the space list as before. `list` forces the space list (a notification).
 */
export function threadView(v: View, space: string, o: { narrow: boolean; list?: boolean }): { kind: 'lounge' | 'space'; id: string } {
  return !o.list && !o.narrow && v.kind === 'lounge' && v.id === space ? { kind: 'lounge', id: space } : { kind: 'space', id: space };
}
