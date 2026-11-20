// Who gets notified (Web Push + open-tab alert), Blair's rule (Oct 2026), shared by the hub and the client.
// A conversation keeps the humans concerned by it (`people`: the one who opened it from a Lounge card, then everyone
// who wrote in it, in order of arrival). Your turn goes to them; a human's new message goes to the others of them plus
// the humans it @mentions, never to its author. Pure functions, tested in hub/test/notify.test.ts.

/** Cap of `people` per conversation (the record must stay small; past it the earliest stay, newcomers are left out). */
export const PEOPLE_MAX = 50;

/** `people` once `who` has written: added at the end if new. Missing = no one known yet (older conversation). */
export function withPerson(people: readonly string[] | undefined, who: string): string[] {
  const out = [...(people ?? [])];
  if (!out.includes(who) && out.length < PEOPLE_MAX) out.push(who);
  return out;
}

const uniq = (xs: Iterable<string>) => [...new Set(xs)];

/**
 * Who a Your turn is for: the humans concerned that are still members. None known (a conversation older than the rule,
 * or only ex-members) = every member, the behaviour before the rule, minus the members who muted the space (`muted`,
 * Blair, Nov 14): in a muted space, a Your turn reaches you only when you are named in `people`.
 */
export function yourTurnTo(people: readonly string[] | undefined, members: readonly string[], muted?: ReadonlySet<string>): string[] {
  const known = uniq(people ?? []).filter(p => members.includes(p));
  return known.length ? known : uniq(members).filter(p => !muted?.has(p));
}

/**
 * Who a human's new message is for: the humans concerned BEFORE it (it may be the first message of its author) and the
 * members it mentions, minus its author. A Lounge topic where nobody else wrote notifies no one.
 */
export function messageTo(peopleBefore: readonly string[] | undefined, mentioned: readonly string[], author: string, members: readonly string[]): string[] {
  return uniq([...(peopleBefore ?? []), ...mentioned]).filter(p => p !== author && members.includes(p));
}

/**
 * A message notification once the mutes are applied: a member who muted the space is left out, unless
 * the message @mentions them. Your turn never goes through this (a muted space still rings for it).
 */
export function unmuted(to: readonly string[], muted: ReadonlySet<string>, mentioned: readonly string[]): string[] {
  return to.filter(p => !muted.has(p) || mentioned.includes(p));
}

/**
 * An agent's message notifies the members it @mentions (never the others: they get Your turn at the end of the turn),
 * mute or not, at most ONE such notification per conversation and agent turn (`turnAt`: when the turn started) against an
 * agent spamming mentions. `last`: the turn of the last mention notification of that conversation (none = never).
 */
export function agentMentionTo(mentioned: readonly string[], members: readonly string[], turnAt: number, last: number | undefined): string[] {
  return last === turnAt ? [] : uniq(mentioned).filter(p => members.includes(p));
}

/** Open-tab alert of a Your turn: does it concern `me` (same rule as the push, `people` as the client received it).
 *  `muted`: `me` muted the space, so the « none known = every member » fallback no longer counts `me` in. */
export const yourTurnFor = (people: readonly string[] | undefined, me: string | null, muted = false): boolean =>
  people?.length ? !!me && people.includes(me) : !muted;

interface TurnThread { kind?: string; archived?: unknown; state: string; people?: readonly string[] }
/**
 * Your turn for `me`: a thread (not a Lounge topic), not archived, in state `you`, whose humans concerned that are still
 * members include `me` (none known = every member, like `yourTurnTo`, except for a `me` who muted the space). `members` unknown (client directory not loaded
 * yet) = `people` taken as is. What the client counts (Now, sidebar, tab title, app badge) and the hub sends in the
 * push payload (`badge`): one rule, so the icon badge set by the service worker matches the app's counter.
 */
export const isMyTurn = (f: TurnThread, me: string | null, members: readonly string[] | undefined, muted = false): boolean =>
  f.kind !== 'topic' && !f.archived && f.state === 'you' && yourTurnFor(members ? f.people?.filter(p => members.includes(p)) : f.people, me, muted);
