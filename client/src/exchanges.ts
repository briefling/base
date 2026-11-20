// Exchanges view (protocol/exchanges.ts): pure list rules, DOM-free (client/test/exchanges.test.ts).
import { exchangeDue, exchangeOrder, type Correspondent, type Exchange, type ExchangeRequest, type ExchangeState } from '../../protocol/exchanges.ts';

export type ExFilter = 'all' | ExchangeState;
export const EX_FILTERS: readonly ExFilter[] = ['all', 'us', 'wait', 'closed'];

/** Rows shown: the state filter and the correspondent ('' = all), urgent first (exchangeOrder). */
export function filterExchanges(list: readonly Exchange[], state: ExFilter, corr: string): Exchange[] {
  return list.filter(x => (state === 'all' || x.state === state) && (!corr || x.correspondent === corr)).sort(exchangeOrder);
}
/** Count per state pill, within the correspondent filter. */
export function exchangeCounts(list: readonly Exchange[], corr: string): Record<ExFilter, number> {
  const n: Record<ExFilter, number> = { all: 0, us: 0, wait: 0, closed: 0 };
  for (const x of list) if (!corr || x.correspondent === corr) { n.all++; n[x.state]++; }
  return n;
}
/** Insert or replace an exchange (live `exchange.updated`), never going back to an older version. */
export function upsertExchange(list: readonly Exchange[], x: Exchange): Exchange[] {
  const old = list.find(e => e.id === x.id);
  if (old && old.version > x.version) return [...list];
  return [...list.filter(e => e.id !== x.id), x];
}
/** Correspondent of an exchange, null once removed from the space. */
export const correspondentById = (cs: readonly Correspondent[], id: string) => cs.find(c => c.id === id) ?? null;
/** Addresses typed in Settings (comma, semicolon, space or line separated) -> list for `correspondent.save`. */
export const addrsOf = (text: string) => [...new Set(text.split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean))];
/** Your turn of a lead: the exchanges « ours » for EXCHANGE_DUE_MS in the spaces they lead, the longest waiting first. */
export function dueExchanges(by: ReadonlyMap<string, { exchanges: readonly Exchange[] }>, trusted: ReadonlySet<string>, now: number): Exchange[] {
  return [...by].filter(([space]) => trusted.has(space)).flatMap(([, l]) => l.exchanges.filter(x => exchangeDue(x, now)))
    .sort((a, b) => (a.lastIn ?? a.lastAt) - (b.lastIn ?? b.lastAt) || a.id.localeCompare(b.id));
}
/** Requests shown in the detail: open first (ours before theirs), then done, each oldest first. */
export function requestOrder(rs: readonly ExchangeRequest[]): ExchangeRequest[] {
  const rank = (r: ExchangeRequest) => r.done ? 2 : r.side === 'us' ? 0 : 1;
  return [...rs].sort((a, b) => rank(a) - rank(b) || a.at - b.at || a.id.localeCompare(b.id));
}
