// Reminders of a space (module `reminders`, Blair Nov 2026, after Apple's Reminders app): lists, reminders with an
// optional date and time, a box to check. Shared with the whole space: every member creates, edits, checks and deletes;
// each reminder is « for » one member (default: who creates it), the only one who gets the push when it is due. An
// agent never creates one: it proposes a card (`reminder.propose`), a member adds it. Shared by the hub (validation,
// schedule), the client (view, smart lists) and, by its rules, the plugin (tooldefs.py).

export const REMINDER_LISTS_MAX = 30;      // per space, besides the default list
export const REMINDERS_MAX = 1000;         // per space, completed ones included (« Clear completed » frees them)
export const REMINDER_TITLE_MAX = 200;
export const REMINDER_NOTES_MAX = 2000;
export const REMINDER_LIST_NAME_MAX = 40;
/** Why a reminder exists (the agent's reason on its card), kept on the reminder. */
export const REMINDER_WHY_MAX = 500;
/** The default list: always there, never stored, renamed nor deleted (« Reminders » in Apple's app). */
export const INBOX = 'inbox';
/** Colours of a list (Apple's palette); the client maps each to a CSS colour per theme. */
export const LIST_COLORS = ['blue', 'red', 'orange', 'yellow', 'green', 'teal', 'purple', 'pink', 'brown', 'gray'] as const;
export type ListColor = typeof LIST_COLORS[number];
/** Time of the push of a reminder with a date but no time (Apple: 09:00). */
export const ALL_DAY_TIME = '09:00';

export const DATE_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const LINE_CTRL = /[\u0000-\u001f\u007f]/;
const TEXT_CTRL = /[\u0000-\u0008\u000b-\u001f\u007f]/;

export interface ReminderList { id: string; name: string; color: ListColor; by: string; at: number; version: number }
/** When a reminder is due: a local date, an optional local time, the time zone they are read in (the creator's
 *  device), and `at` the instant (ms) the hub computed from them (date only: ALL_DAY_TIME). */
export interface Due { date: string; time?: string; tz: string; at: number }
/** Where a reminder comes from: the conversation (and the card message) it was added from, with the agent's reason.
 *  Set by the hub at `reminder.accept`, or sent by « Remind me » on a summary line (no message); kept on every edit. */
export interface ReminderSource { thread: string; msg?: string; why?: string }
export interface ReminderDraft { title: string; notes?: string; list: string; for: string; due?: Omit<Due, 'at'>; flag?: true }
export interface Reminder extends Omit<ReminderDraft, 'due'> {
  id: string;
  due?: Due;
  done?: { by: string; at: number };
  source?: ReminderSource;
  by: string;      // who created it
  at: number;      // last change
  version: number;
}
/** Reminder card posted by an agent (`reminder.propose`): its draft (no list nor recipient: the member who adds it
 *  picks them, prefilled with the default list and the human of the turn), and once added, `added`. */
export interface ReminderCard { title: string; notes?: string; date?: string; time?: string; tz?: string; by: string; why?: string; to?: string;
  added?: { id: string; by: string; at: number } }

const line = (x: unknown, max: number): x is string => typeof x === 'string' && x.trim().length > 0 && x.trim().length <= max && !LINE_CTRL.test(x);
export const okId = (x: unknown): x is string => typeof x === 'string' && ID_RE.test(x);
export const isColor = (x: unknown): x is ListColor => typeof x === 'string' && (LIST_COLORS as readonly string[]).includes(x);

/** A real calendar date (2026-02-30 is not). */
export function dateOk(x: unknown): x is string {
  if (typeof x !== 'string' || !DATE_RE.test(x)) return false;
  const [y, m, d] = x.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d && y >= 2000 && y <= 2200;
}
/** An IANA time zone this runtime knows (`Europe/Paris`, `UTC`). */
export function tzOk(x: unknown): x is string {
  if (typeof x !== 'string' || x.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(x)) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: x }); return true } catch { return false }
}

/** Offset (ms) of `tz` from UTC at the instant `t`. */
function offsetAt(t: number, tz: string): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(t)).filter(x => x.type !== 'literal').map(x => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(t / 1000) * 1000;
}
/** The instant (ms) of a local date and time in `tz`. A time skipped by a DST change lands just after it. */
export function zonedAt(date: string, time: string, tz: string): number {
  const [y, mo, d] = date.split('-').map(Number), [h, mi] = time.split(':').map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let t = wall - offsetAt(wall, tz);
  t = wall - offsetAt(t, tz);
  return t;
}
/** The instant a due date fires (date only: ALL_DAY_TIME). */
export const dueAt = (d: Omit<Due, 'at'>) => zonedAt(d.date, d.time ?? ALL_DAY_TIME, d.tz);

/** The due fields of a frame (`date`, `time`, `tz`): undefined = no date, null = malformed. */
export function dueIn(r: Record<string, unknown>): Omit<Due, 'at'> | undefined | null {
  if (r.date === undefined || r.date === '' || r.date === null) return r.time === undefined || r.time === '' || r.time === null ? undefined : null;
  if (!dateOk(r.date) || !tzOk(r.tz)) return null;
  if (r.time !== undefined && r.time !== '' && (typeof r.time !== 'string' || !TIME_RE.test(r.time))) return null;
  return { date: r.date, ...(typeof r.time === 'string' && r.time ? { time: r.time } : {}), tz: r.tz };
}

/** The reminder fields of a frame, trimmed; null if malformed. `list` and `for` are checked against the space by the hub. */
export function reminderIn(x: unknown): ReminderDraft | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Record<string, unknown>;
  if (!line(r.title, REMINDER_TITLE_MAX) || !okId(r.list) || !okId(r.for)) return null;
  if (r.notes !== undefined && (typeof r.notes !== 'string' || r.notes.length > REMINDER_NOTES_MAX || TEXT_CTRL.test(r.notes))) return null;
  if (r.flag !== undefined && typeof r.flag !== 'boolean') return null;
  const due = dueIn(r);
  if (due === null) return null;
  const notes = typeof r.notes === 'string' ? r.notes.trim() : '';
  return { title: r.title.trim(), list: r.list, for: r.for, ...(notes ? { notes } : {}), ...(due ? { due } : {}), ...(r.flag ? { flag: true as const } : {}) };
}
/** The `source` of a frame (ids only, plus an optional reason), trimmed; null if malformed. The hub checks the thread is
 *  one of the space. */
export function sourceIn(x: unknown): ReminderSource | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Record<string, unknown>;
  if (!okId(r.thread) || (r.msg !== undefined && !okId(r.msg))) return null;
  if (r.why !== undefined && (typeof r.why !== 'string' || r.why.length > REMINDER_WHY_MAX || TEXT_CTRL.test(r.why))) return null;
  const why = typeof r.why === 'string' ? r.why.trim() : '';
  return { thread: r.thread, ...(r.msg ? { msg: r.msg as string } : {}), ...(why ? { why } : {}) };
}
/** The list fields of a frame; null if malformed. */
export function listIn(x: unknown): { name: string; color: ListColor } | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Record<string, unknown>;
  return line(r.name, REMINDER_LIST_NAME_MAX) && isColor(r.color) ? { name: r.name.trim(), color: r.color } : null;
}
/** The draft of an agent's card; null if malformed. Same title, notes and date rules as a reminder. */
export function cardIn(x: unknown): Omit<ReminderCard, 'by' | 'to' | 'added'> | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Record<string, unknown>;
  if (!line(r.title, REMINDER_TITLE_MAX)) return null;
  if (r.notes !== undefined && (typeof r.notes !== 'string' || r.notes.length > REMINDER_NOTES_MAX || TEXT_CTRL.test(r.notes))) return null;
  if (r.why !== undefined && (typeof r.why !== 'string' || r.why.length > REMINDER_WHY_MAX || TEXT_CTRL.test(r.why))) return null;
  const due = dueIn(r);
  if (due === null) return null;
  const notes = typeof r.notes === 'string' ? r.notes.trim() : '', why = typeof r.why === 'string' ? r.why.trim() : '';
  return { title: r.title.trim(), ...(notes ? { notes } : {}), ...(due ? { date: due.date, ...(due.time ? { time: due.time } : {}), tz: due.tz } : {}), ...(why ? { why } : {}) };
}

/** EventBridge Scheduler one-shot expression, read in the reminder's time zone: `at(2026-11-12T09:00:00)`. */
export const reminderAt = (d: Omit<Due, 'at'>) => `at(${d.date}T${d.time ?? ALL_DAY_TIME}:00)`;
/** Scheduler name of a reminder (≤ 64 chars, [0-9a-zA-Z-_.]), in the routines' group. */
export const reminderSchedule = (space: string, id: string) => `${space}.rm.${id}`.slice(0, 64);
/** What the schedule hands the Routine Lambda: ids and the instant it was set for (an edit since = stale, nothing sent). */
export interface ReminderFire { space: string; reminder: string; at: number }

// ---------------------------------------------------------------- smart lists (client view, hub badge)
/** Smart lists of the view, as in Apple's app: Today (due today or overdue), Scheduled (with a date), All, For me
 *  (my reminders), Completed. */
export const SMART = ['today', 'scheduled', 'all', 'mine', 'done'] as const;
export type Smart = typeof SMART[number];

/** Local calendar day (YYYY-MM-DD) of an instant in `tz`. */
export const dayOf = (t: number, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
/** The day a reminder is due, as its creator wrote it (a date is a calendar day, not an instant). */
export const dueDay = (r: Pick<Reminder, 'due'>) => r.due?.date ?? '';
/** Overdue: not done, and its time passed (date only: the day is over in the viewer's zone). */
export function overdue(r: Pick<Reminder, 'due' | 'done'>, now: number, tz: string): boolean {
  if (r.done || !r.due) return false;
  return r.due.time ? r.due.at <= now : r.due.date < dayOf(now, tz);
}
/** Due today or overdue, not done. */
export const dueToday = (r: Pick<Reminder, 'due' | 'done'>, now: number, tz: string) => !r.done && !!r.due && (r.due.date <= dayOf(now, tz) || overdue(r, now, tz));
export function inSmart(r: Reminder, s: Smart, me: string, now: number, tz: string): boolean {
  if (s === 'done') return !!r.done;
  if (r.done) return false;
  return s === 'today' ? dueToday(r, now, tz) : s === 'scheduled' ? !!r.due : s === 'mine' ? r.for === me : true;
}
/** Sidebar badge: my reminders due today or overdue (Apple's Today count, restricted to what is mine). */
export const myTodayCount = (rs: readonly Reminder[], me: string, now: number, tz: string) => rs.filter(r => r.for === me && dueToday(r, now, tz)).length;

/** Display order inside a list: open ones first; then dated before undated, by due instant; then by creation. */
export function sortReminders(rs: readonly Reminder[]): Reminder[] {
  const key = (r: Reminder) => r.due ? r.due.at : Number.MAX_SAFE_INTEGER;
  return [...rs].sort((a, b) => Number(!!a.done) - Number(!!b.done) || (a.done && b.done ? b.done.at - a.done.at : key(a) - key(b)) || a.id.localeCompare(b.id));
}
/** Scheduled view: open reminders with a date, grouped by day, in date order. */
export function byDay(rs: readonly Reminder[]): { day: string; items: Reminder[] }[] {
  const out = new Map<string, Reminder[]>();
  for (const r of sortReminders(rs.filter(r => r.due && !r.done))) { const d = r.due!.date; out.set(d, [...(out.get(d) ?? []), r]); }
  return [...out].sort(([a], [b]) => a.localeCompare(b)).map(([day, items]) => ({ day, items }));
}

/** Short words a person types for a date in the quick-add line, resolved against today (`tomorrow`, `demain`…). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
