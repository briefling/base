// Reminders view (module `reminders`, protocol/reminders.ts): the client's pure parts, DOM-free so node can test them.
// The space's lists and reminders as the hub sent them, the smart lists and their counts, the quick-add line (« Call
// Paul tomorrow 6pm » -> title + date + time) and the due label. The view itself is client/src/remindersview.ts.
import {
  INBOX, SMART, addDays, dayOf, dueToday, inSmart, overdue, sortReminders,
  type Reminder, type ReminderList, type Smart,
} from '../../protocol/reminders.ts';

export interface SpaceReminders { lists: ReminderList[]; items: Map<string, Reminder> }
/** What is selected in the view: a smart list, or a list by id (INBOX included). */
export type RmSel = Smart | `list:${string}`;
export const listSel = (id: string): RmSel => `list:${id}`;
export const selList = (s: RmSel): string | null => s.startsWith('list:') ? s.slice(5) : null;

export const fromList = (lists: ReminderList[], reminders: Reminder[]): SpaceReminders => ({ lists: [...lists], items: new Map(reminders.map(r => [r.id, r])) });

/** A `reminder.updated` event (or a write's answer) applied: newer versions win, removed ids go. */
export function applyUpdate(cur: SpaceReminders, d: { lists?: ReminderList[]; reminders?: Reminder[]; removed?: string[]; removedLists?: string[] }): SpaceReminders {
  const items = new Map(cur.items);
  for (const r of d.reminders ?? []) { const o = items.get(r.id); if (!o || o.version <= r.version) items.set(r.id, r); }
  for (const id of d.removed ?? []) items.delete(id);
  let lists = cur.lists.filter(l => !(d.removedLists ?? []).includes(l.id));
  for (const l of d.lists ?? []) { const i = lists.findIndex(x => x.id === l.id); if (i < 0) lists = [...lists, l]; else if (lists[i].version <= l.version) lists = lists.map(x => x.id === l.id ? l : x); }
  for (const id of d.removedLists ?? []) for (const [k, r] of items) if (r.list === id) items.delete(k);
  return { lists, items };
}

/** Reminders shown for a selection, in display order. A list hides its completed ones unless `showDone`; `keep` are
 *  ids just checked, kept on screen for a moment (Apple's check animation). */
export function shown(sp: SpaceReminders, sel: RmSel, me: string, now: number, tz: string, showDone: boolean, keep: ReadonlySet<string> = new Set()): Reminder[] {
  const all = [...sp.items.values()];
  const list = selList(sel);
  const pick = list !== null ? all.filter(r => r.list === list && (showDone || !r.done || keep.has(r.id)))
    : all.filter(r => inSmart(r, sel as Smart, me, now, tz) || (sel !== 'done' && keep.has(r.id)));
  // A row just checked keeps its place while it fades (sorted as if still open), as in Apple's app.
  const order = sortReminders(pick.map(r => keep.has(r.id) && r.done ? { ...r, done: undefined } : r)).map(r => r.id);
  return order.map(id => sp.items.get(id)!);
}

/** Counts of the tiles (open reminders; Completed = done ones) and of each list (open ones). */
export function counts(sp: SpaceReminders, me: string, now: number, tz: string): { smart: Record<Smart, number>; lists: Record<string, number> } {
  const smart = Object.fromEntries(SMART.map(s => [s, 0])) as Record<Smart, number>;
  const lists: Record<string, number> = { [INBOX]: 0, ...Object.fromEntries(sp.lists.map(l => [l.id, 0])) };
  for (const r of sp.items.values()) {
    for (const s of SMART) if (inSmart(r, s, me, now, tz)) smart[s]++;
    if (!r.done) lists[r.list] = (lists[r.list] ?? 0) + 1;
  }
  return { smart, lists };
}

// ---------------------------------------------------------------- quick add
const DAY_WORDS: Record<string, number> = { today: 0, tonight: 0, "aujourd'hui": 0, 'aujourd’hui': 0, auj: 0, ce_soir: 0, tomorrow: 1, demain: 1, 'après-demain': 2, 'apres-demain': 2 };
const WEEKDAYS: Record<string, number> = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7,
  lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6, dimanche: 7 };
const CONNECT = new Set(['à', 'a', 'at', 'le', 'on', 'vers', 'pour']);
/** `18h`, `18h30`, `18:30`, `9h`, `6pm`, `6:30pm`, `noon`/`midi` -> HH:MM; null otherwise. */
export function timeWord(w: string): string | null {
  const s = w.toLowerCase();
  if (s === 'midi' || s === 'noon') return '12:00';
  let m = /^([01]?\d|2[0-3])(?:h|:)([0-5]\d)?$/.exec(s) ?? /^([01]?\d|2[0-3])h$/.exec(s);
  if (m) return `${m[1].padStart(2, '0')}:${m[2] ?? '00'}`;
  m = /^(1[0-2]|0?[1-9])(?::([0-5]\d))?(am|pm)$/.exec(s);
  if (m) { const h = (Number(m[1]) % 12) + (m[3] === 'pm' ? 12 : 0); return `${String(h).padStart(2, '0')}:${m[2] ?? '00'}`; }
  return null;
}
/** ISO weekday (1 = Monday) of a YYYY-MM-DD day. */
const isoDay = (day: string) => { const [y, m, d] = day.split('-').map(Number); return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1; };

/**
 * Quick-add line: date and time words at the END of the text become the reminder's date and time (« Call Paul
 * tomorrow at 6pm », « Payer la cantine vendredi 9h »); the rest is the title. A weekday is the next one (today's
 * name = in a week). A time alone = today, or tomorrow once that time passed. Nothing recognised: all title.
 */
export function parseQuick(text: string, today: string, nowTime = '00:00'): { title: string; date?: string; time?: string } {
  const words = text.trim().split(/\s+/);
  let date: string | undefined, time: string | undefined;
  while (words.length > 1) {
    const w = words.at(-1)!.toLowerCase().replace(/[.,;!]+$/, ''), two = words.length > 2 ? `${words.at(-2)!.toLowerCase()}_${w}` : '';
    if (!time && timeWord(w)) { time = timeWord(w)!; words.pop(); continue; }
    if (!date && two && two in DAY_WORDS) { date = addDays(today, DAY_WORDS[two]); words.splice(-2); continue; }
    if (!date && w in DAY_WORDS) { date = addDays(today, DAY_WORDS[w]); words.pop(); continue; }
    if (!date && w in WEEKDAYS) { const diff = (WEEKDAYS[w] - isoDay(today) + 7) % 7 || 7; date = addDays(today, diff); words.pop(); continue; }
    if ((date || time) && CONNECT.has(w)) { words.pop(); continue; }
    break;
  }
  const title = words.join(' ').trim();
  if (!title) return { title: text.trim() };
  if (time && !date) date = time > nowTime ? today : addDays(today, 1);
  return { title, ...(date ? { date } : {}), ...(time ? { time } : {}) };
}

// ---------------------------------------------------------------- labels
/** Due line of a row: « Today, 18:00 », « Tomorrow », « Tue 12 Nov » (year when not this year); overdue flagged. */
export function dueLabel(r: Pick<Reminder, 'due' | 'done'>, now: number, tz: string, lang: string, words: { today: string; tomorrow: string; yesterday: string }): { text: string; overdue: boolean } | null {
  if (!r.due) return null;
  const today = dayOf(now, tz), d = r.due.date;
  const [y, m, dd] = d.split('-').map(Number);
  const day = d === today ? words.today : d === addDays(today, 1) ? words.tomorrow : d === addDays(today, -1) ? words.yesterday
    : new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short', ...(y !== Number(today.slice(0, 4)) ? { year: 'numeric' } : {}), timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, dd)));
  return { text: r.due.time ? `${day}, ${r.due.time}` : day, overdue: overdue(r, now, tz) };
}
/** Today tile and sidebar: overdue first, then today's, in time order. */
export const todayOrder = (rs: readonly Reminder[], now: number, tz: string) => sortReminders(rs.filter(r => dueToday(r, now, tz)));
