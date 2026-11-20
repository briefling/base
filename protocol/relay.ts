// Agents waking each other: an agent's final message that @mentions another agent of the space
// wakes it, in a Lounge topic or a work thread. A cap per conversation bounds the loop: every agent may be woken this
// way `relayMax` times (Settings › General, 0 = off) since the last human message; past it the hub posts one notice and
// wakes nobody until a human writes again. Counting wakes rather than exchanges keeps a discussion among n agents
// possible. Pure rules here, the hub side in hub/src/relay.ts.

export const RELAY_MAX_DEFAULT = 6;
export const RELAY_MAX_BOUNDS = [0, 20] as const;
export const validRelayMax = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= RELAY_MAX_BOUNDS[0] && (n as number) <= RELAY_MAX_BOUNDS[1];
export const relayMaxOf = (s: { relayMax?: number }): number => validRelayMax(s.relayMax) ? s.relayMax : RELAY_MAX_DEFAULT;

/**
 * A conversation's relay state (hub only, never sent to clients). `since`: id of the last human message it counts from
 * ('' = none yet): a newer human message starts a fresh count, so no write is needed on the human side. `n`: wakes of
 * each agent since then. `seen`: the last message of each agent already relayed (a replayed turn end, or the turn end
 * and the late write of its message, relay it once). `capped`: the limit notice is posted.
 */
export interface RelayState { since: string; n: Record<string, number>; seen: Record<string, string>; capped?: true }

export type RelayStep = { wake: string[]; next: RelayState; notice: boolean };

/**
 * Message `msg` of agent `from` mentions `targets` (other agents of the space). Null: already handled, nothing to
 * write. Else who to wake, the next state, and whether to post the limit notice (once per count). One target over the
 * cap wakes nobody: the limit stops the whole relay, not only that agent.
 */
export function relayStep(cur: RelayState | undefined, since: string, from: string, msg: string, targets: string[], max: number): RelayStep | null {
  const base: RelayState = cur && cur.since === since ? cur : { since, n: {}, seen: {} };
  if (base.seen[from] === msg) return null;
  const seen = { ...base.seen, [from]: msg };
  if (max <= 0 || !targets.length) return { wake: [], next: { ...base, seen }, notice: false };
  if (base.capped) return { wake: [], next: { ...base, seen }, notice: false };
  if (targets.some(t => (base.n[t] ?? 0) >= max)) return { wake: [], next: { ...base, seen, capped: true }, notice: true };
  const n = { ...base.n };
  for (const t of targets) n[t] = (n[t] ?? 0) + 1;
  return { wake: targets, next: { ...base, n, seen }, notice: false };
}
