// Presence: who is connected in a space. The hub derives it from the live subscriptions (`SUB#<space>`), each human
// connection carrying the state its client reported (`presence.set`); an agent is there when its gateway is.
// Display: green = connected and active, orange = connected but idle for AWAY_MS, nothing = human not connected,
// red = agent not connected (its gateway is down). Agents are never away.
// Time beside each name (« Who is here » list): idle since the last input for an away human, last seen for a
// disconnected one or an agent down. The hub records `seen` per principal and space at a disconnection and at the
// switch to away (one write, no counter, no polling); the client turns it into relative text each minute (`presLine`).

import type { PluginStuck } from './plugin.ts';

export type PresenceState = 'active' | 'away';
/** One connected principal of a space: a human (best state of their connections) or an agent whose gateway is up. */
// voice: an agent whose gateway announces a voice daemon (`subscribe.plugin.voice`): the « Voice » button can ask it.
// stuck: an agent behind the latest plugin release that will not update by itself (protocol/plugin.ts stuckOf): leads get a banner.
export interface Presence { id: string; state: PresenceState; since?: number; voice?: true; stuck?: PluginStuck } // since: away only, the last input (ms)
/** Last time each principal of the space was seen (ms), for those not connected: `synced.lastSeen`, `presence.changed`. */
export type LastSeen = Record<string, number>;
/** No input for that long: the tab reports itself away. */
export const AWAY_MS = 15 * 60_000;

/** Hub: one entry per principal, sorted by id; several tabs or devices: the best state wins (active over away), and
 *  between away ones the latest input (`idle`). */
export function mergePresence(conns: { id: string; away?: boolean; idle?: number; voice?: boolean; stuck?: PluginStuck }[]): Presence[] {
  const m = new Map<string, Presence>();
  for (const c of conns) {
    const cur = m.get(c.id);
    if (cur?.state === 'active') { if (c.voice) cur.voice = true; if (c.stuck && !cur.stuck) cur.stuck = c.stuck; continue; }
    if (!c.away) { m.set(c.id, { id: c.id, state: 'active', ...(c.voice ? { voice: true as const } : {}), ...(c.stuck ? { stuck: c.stuck } : {}) }); continue; }
    const since = Math.max(cur?.since ?? 0, c.idle ?? 0);
    m.set(c.id, { id: c.id, state: 'away', ...(since ? { since } : {}) });
  }
  return [...m.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
/** Hub: the `idle` a client sent with `presence.set` away, kept in [0, now]; missing or bad = AWAY_MS ago (older client). */
export const idleOf = (v: unknown, now: number): number => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), now) : now - AWAY_MS;

/** Client: the state this tab reports, from its last input (a hidden tab gets none, so it turns away after AWAY_MS). */
export const localState = (lastInput: number, now: number): PresenceState => now - lastInput >= AWAY_MS ? 'away' : 'active';

/** Client: the agent is connected and its gateway can open a voice channel on request. */
export const canTalk = (agent: string, list: Presence[] | undefined): boolean => !!list?.some(x => x.id === agent && x.voice);

/** Client: the connected agents of a space that will not update their plugin by themselves (banner for its leads). */
export const stuckAgents = (list: Presence[] | undefined): { id: string; stuck: PluginStuck }[] =>
  (list ?? []).flatMap(x => x.stuck ? [{ id: x.id, stuck: x.stuck }] : []);
/** Client: what a dismiss of that banner hides (agent + reason, order-free); another agent or reason shows it again. */
export const stuckKey = (stuck: { id: string; stuck: PluginStuck }[]): string => stuck.map(x => `${x.id}:${x.stuck}`).sort().join(',');

export type Dot = PresenceState | 'off';
/** Dot of a person: a disconnected human has none (null), a disconnected agent is 'off'; null before the first list. */
export function dotOf(p: { id: string; kind: 'human' | 'agent' }, list: Presence[] | undefined): Dot | null {
  if (!list) return null;
  const e = list.find(x => x.id === p.id);
  if (p.kind === 'agent') return e ? 'active' : 'off';
  return e ? e.state : null;
}

const RANK: Record<string, number> = { 'human:active': 0, 'human:away': 1, 'agent:active': 2, 'agent:off': 3, 'human:none': 4 };
type Person = { id: string; name: string; kind: 'human' | 'agent'; gone?: boolean };
/** Lounge header: `here` = the stack (connected humans, active first, then connected agents); `absent` = the fold-out
 *  list (disconnected agents in red first, then disconnected humans, dot 'none'); by name inside. Empty before the
 *  first list: nothing is claimed. Gone people are left out. */
export function roster<P extends Person>(people: P[], list: Presence[] | undefined): { here: (P & { dot: Dot })[]; absent: (P & { dot: Dot | 'none' })[] } {
  if (!list) return { here: [], absent: [] };
  const all = people.filter(p => !p.gone).map(p => ({ ...p, dot: dotOf(p, list) ?? 'none' as const }))
    .sort((a, b) => RANK[`${a.kind}:${a.dot}`] - RANK[`${b.kind}:${b.dot}`] || a.name.localeCompare(b.name));
  return { here: all.filter((p): p is P & { dot: Dot } => p.dot === 'active' || p.dot === 'away'), absent: all.filter(p => p.dot === 'off' || p.dot === 'none') };
}

/** People of a space after `space.updated`: its humans, then its agents. An agent that just joined is added (else the
 *  stack ignores it while presence knows it), one no longer listed is kept as gone (its mentions stay recognized), the
 *  others keep their entry. `agents` missing (older hub): the agents are kept as synced. */
export function withAgents<P extends Person>(humans: P[], current: P[], agents: string[] | undefined, make: (id: string) => P): P[] {
  const known = current.filter(p => p.kind !== 'human');
  if (!agents) return [...humans, ...known];
  const kept = known.map(p => agents.includes(p.id) ? (p.gone ? (({ gone: _, ...q }) => q as P)(p) : p) : { ...p, gone: true });
  return [...humans, ...kept, ...agents.filter(a => !known.some(p => p.id === a)).map(make)];
}

/** A duration in the largest whole unit: minutes (1 at least) under an hour, hours under a day, then days. */
export type Span = { unit: 'min' | 'h' | 'd'; n: number };
export function span(ms: number): Span {
  const min = Math.floor(Math.max(0, ms) / 60_000);
  return min < 60 ? { unit: 'min', n: Math.max(1, min) } : min < 1440 ? { unit: 'h', n: Math.floor(min / 60) } : { unit: 'd', n: Math.floor(min / 1440) };
}
/** Text beside a name in the « Who is here » list, as a key + duration (the client translates it):
 *  active; idle · 25 min; seen 3 h ago / just now / yesterday / never; agent offline for 2 d (or just offline, never seen). */
export type PresLine = { k: 'active' } | { k: 'idle'; d: Span } | { k: 'seen'; d: Span } | { k: 'seen_now' } | { k: 'seen_yday' } | { k: 'never' }
  | { k: 'down'; d: Span } | { k: 'down_unknown' };
export function presLine(p: { kind: 'human' | 'agent'; dot: Dot | 'none' }, at: number | undefined, now: number): PresLine {
  if (p.dot === 'active') return { k: 'active' };
  if (p.dot === 'away') return { k: 'idle', d: span(now - (at ?? now - AWAY_MS)) };
  if (p.kind === 'agent') return at ? { k: 'down', d: span(now - at) } : { k: 'down_unknown' };
  if (!at) return { k: 'never' };
  const d = span(now - at);
  return now - at < 60_000 ? { k: 'seen_now' } : d.unit === 'd' && d.n === 1 ? { k: 'seen_yday' } : { k: 'seen', d };
}
