// Personal mute of a space (hub/src/mute.ts): the hub stops ringing its messages for me (Web Push, tab
// alert) except my turns and my mentions; the client moves it into the « Muted » group at the bottom of the sidebar
// (spacegroups.ts), drops it from Now except my turns (recents.ts `nowTree`) and hides its Lounge unread counter.
// Stored on the hub only (never localStorage), like the pins. DOM-free, tested in client/test/mute.test.ts.
import type { Mute, SpaceInfo } from '../../protocol/frames.ts';

export type Mutes = Map<string, Mute>;

/** The mutes the hub sent with my space list at connect (`SpaceInfo.muted`): authoritative, `at` 0 so any later
 *  `mute.updated` or toggle of mine wins. */
export const mutesOf = (list: readonly SpaceInfo[]): Mutes => new Map(list.map(s => [s.id, { space: s.id, on: !!s.muted, at: 0 }]));

/** A mute applied if more recent (`at`) than the one held: my own toggle right away, then the hub's echo. */
export function applyMute(m: Mutes, x: Mute): void {
  const cur = m.get(x.space);
  if (!cur || cur.at < x.at) m.set(x.space, x);
}

/** The spaces I muted. */
export const mutedSet = (m: Mutes): Set<string> => new Set([...m.values()].filter(x => x.on).map(x => x.space));
