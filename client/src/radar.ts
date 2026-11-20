// Radar view: the space's signals, filtered by type and state (pure, tested). Rules in protocol/radar.ts.
import { RADAR_SEVERITIES, RADAR_STATES, RADAR_TIME, RADAR_TYPES, SIGNAL_TODO_MAX, radarDays, type RadarConfig, type Signal, type SignalState, type SignalType } from '../../protocol/radar.ts';
import { ROUTINE_TZ } from '../../protocol/routines.ts';

export type TypeFilter = SignalType | 'all';
export type StateFilter = SignalState | 'all';

/** A live `radar.updated` (or a list) merged in: an older version arriving late never overwrites a newer one. */
export function upsertSignal(list: readonly Signal[], s: Signal): Signal[] {
  const i = list.findIndex(x => x.id === s.id);
  if (i >= 0 && list[i].version >= s.version) return [...list];
  return i >= 0 ? list.map((x, k) => k === i ? s : x) : [...list, s];
}

const sev = (s: Signal) => RADAR_SEVERITIES.indexOf(s.severity);
/** Shown order: to sort first, then the most severe, then the latest seen. */
export const sortSignals = (list: readonly Signal[]) => [...list].sort((a, b) =>
  Number(b.state === 'new') - Number(a.state === 'new') || sev(b) - sev(a) || b.lastAt - a.lastAt || a.id.localeCompare(b.id));

export const filterSignals = (list: readonly Signal[], type: TypeFilter, state: StateFilter) =>
  sortSignals(list.filter(s => (type === 'all' || s.kind === type) && (state === 'all' || s.state === state)));

/** Counts of the filter pills: per type (within the state filter) and per state (within the type filter). */
export function signalCounts(list: readonly Signal[], type: TypeFilter, state: StateFilter) {
  const types = Object.fromEntries(['all', ...RADAR_TYPES].map(k => [k, list.filter(s => (k === 'all' || s.kind === k) && (state === 'all' || s.state === state)).length])) as Record<TypeFilter, number>;
  const states = Object.fromEntries(['all', ...RADAR_STATES].map(k => [k, list.filter(s => (k === 'all' || s.state === k) && (type === 'all' || s.kind === type)).length])) as Record<StateFilter, number>;
  return { types, states };
}

/**
 * Main action of a signal still to sort: a competitor or a tech news is discussed first (a Lounge topic), a bug, a flaw
 * or a code finding goes straight to a thread. The other one stays offered as secondary.
 */
export const radarPrimary = (kind: SignalType): 'topic' | 'thread' => kind === 'competitor' || kind === 'tech' ? 'topic' : 'thread';

/** Signals still to sort (nav badge). */
export const toSort = (list: readonly Signal[] | undefined) => (list ?? []).filter(s => s.state === 'new').length;

// Labelled lines of a summary (« Quoi : », « Exposition (…) : », « À faire : »): the detail shows them as sections.
const LABEL = /^([\p{L}][\p{L}' -]{0,28}?)(\s*\([^)]{0,80}\))?\s*:\s+(.*)$/u;
const TODO_LABEL = /^(à faire|a faire|to do|todo|action)$/i;
export interface SummarySection { label: string; note?: string; text: string }

/**
 * The summary cut at its labelled lines (« Quoi : … », « Exposition (abaissée à low) : … »); a line without a label
 * goes on with the section above. No label at all: one section with an empty label (shown as plain text).
 */
export function summarySections(summary: string): SummarySection[] {
  const out: SummarySection[] = [];
  for (const raw of summary.split('\n')) {
    const line = raw.trim(); if (!line) continue;
    const m = LABEL.exec(line);
    if (m) out.push({ label: m[1].trim(), ...(m[2] ? { note: m[2].trim().slice(1, -1) } : {}), text: m[3].trim() });
    else if (out.length) out[out.length - 1].text += '\n' + line;
    else out.push({ label: '', text: line });
  }
  return out;
}

/** One line cut at a word to `max` chars, with an ellipsis when cut. */
export function clip(text: string, max: number): string {
  const one = text.replace(/\s+/g, ' ').trim();
  if (one.length <= max) return one;
  const cut = one.slice(0, max - 1), sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.]+$/, '') + '…';
}

/**
 * The « to do » line of the list: the agent's `todo`, or for a signal stored before it existed the first sentence of
 * the summary's « À faire : » section, at most SIGNAL_TODO_MAX chars. Empty when neither exists.
 */
export function signalTodo(s: Pick<Signal, 'todo' | 'summary'>): string {
  if (s.todo) return s.todo;
  const sec = summarySections(s.summary).find(x => TODO_LABEL.test(x.label));
  if (!sec) return '';
  const first = sec.text.split(/(?<=[.;!?])\s|\s;\s|\n/)[0].replace(/\s*[;.]$/, '');
  return clip(first, SIGNAL_TODO_MAX);
}

/** Icon of each signal type (lucide names of the client's icon table): filter pills, list lines, empty state. */
export const RD_ICON: Record<SignalType, string> = { bug: 'bug', security: 'shield', competitor: 'users', tech: 'cpu', code: 'code' };

/**
 * Empty list: under « All » the radar scope and a general sentence; under one type, that type's icon (coloured by its
 * `--rt`) and a sentence of its own. « Topic opened » / « Thread opened » / « Dismissed » keep the look, only the title changes (no text).
 */
export interface RadarEmpty { scope: boolean; icon: string | null; kind: SignalType | null; title: string; text: string | null }
export function radarEmpty(type: TypeFilter, state: StateFilter): RadarEmpty {
  const kind = type === 'all' ? null : type;
  const look = { scope: !kind, icon: kind ? RD_ICON[kind] : null, kind };
  if (state === 'topic' || state === 'thread' || state === 'dismissed') return { ...look, title: `rd_empty_${state}`, text: null };
  return { ...look, title: `rd_empty_${type}`, text: `rd_empty_${type}_txt` };
}

/** Wall clock of `ms` in `tz`, read as if it were UTC (y, m, d, h, min). */
function wall(ms: number, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
    .formatToParts(ms).filter(x => x.type !== 'literal').map(x => [x.type, Number(x.value)]));
  return { y: p.year, m: p.month, d: p.day, utc: Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) };
}

/**
 * « Last pass · next » under the empty list, from the Radar config (admins only get it). Last = end of the last pass
 * (`run.ended` of a pass), else the start of the previous one (`lastPass`); next = the next RADAR_TIME (Europe/Paris)
 * on a day of the rhythm; rhythm off = none. Both absent = no line.
 */
export function radarPasses(c: RadarConfig | undefined, now: number): { last: number | null; next: number | null } {
  if (!c) return { last: null, next: null };
  const last = c.run?.kind === 'pass' && c.run.ended ? c.run.ended : c.lastPass ?? null;
  const days = radarDays(c.rhythm);
  if (!days.length) return { last, next: null };
  const [hh, mm] = RADAR_TIME.split(':').map(Number), today = wall(now, ROUTINE_TZ);
  for (let i = 0; i <= 7; i++) {
    const day = new Date(Date.UTC(today.y, today.m - 1, today.d + i)), iso = day.getUTCDay() || 7;
    if (!days.includes(iso)) continue;
    const guess = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hh, mm);
    const at = guess - (wall(guess, ROUTINE_TZ).utc - guess);       // the zone's offset at that time (DST included)
    if (at > now) return { last, next: at };
  }
  return { last, next: null };
}
