// Standalone server's scheduler (hub/src/server.ts): the `Schedules` of EventBridge Scheduler, persisted in the server's
// SQLite file and checked on a timer. Only the two expression shapes the hub writes are accepted: `cron(M H ? * DOW *)`
// (protocol/routines.ts routineCron: routines, Radar) and a one-shot `at(YYYY-MM-DDTHH:MM:SS)` (protocol/reminders.ts).
// Both are read in the schedule's zone (default Europe/Paris, like ScheduleOpts) through Intl: the tick compares the
// current wall clock of that zone with the expression, no offset arithmetic. A cron fires at most once per minute key
// (stored before the run: at most once, like the scheduler with retries off); an `at()` missed while the server was down
// fires at the next tick, then is deleted.
import type { DatabaseSync } from 'node:sqlite';
import type { Schedules, ScheduleOpts } from './router.ts';

const DEFAULT_TZ = 'Europe/Paris';
const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const CRON_RE = /^cron\((\d{1,2}) (\d{1,2}) [?*] \* ((?:SUN|MON|TUE|WED|THU|FRI|SAT)(?:,(?:SUN|MON|TUE|WED|THU|FRI|SAT))*|[*?]) \*\)$/;
const AT_RE = /^at\((\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\)$/;

/** Wall clock of `tz` at `now`: `YYYY-MM-DDTHH:MM:SS` and the day of week (SUN..SAT). Throws on an unknown zone. */
export function wallClock(now: number, tz: string): { stamp: string; dow: string } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' }).formatToParts(now).map(x => [x.type, x.value]));
  return { stamp: `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`, dow: String(p.weekday).toUpperCase() };
}

/** Is `expr` due at `now`? For a cron, the minute key it is due for (one fire per key); for an at(), 'at'. */
export function dueKey(expr: string, tz: string, now: number): string | null {
  const w = wallClock(now, tz);
  const at = AT_RE.exec(expr);
  if (at) return w.stamp >= at[1] ? 'at' : null;
  const c = CRON_RE.exec(expr);
  if (!c) return null;
  const [m, h, days] = [Number(c[1]), Number(c[2]), c[3]];
  const [hh, mm] = [Number(w.stamp.slice(11, 13)), Number(w.stamp.slice(14, 16))];
  if (hh !== h || mm !== m || (days !== '*' && days !== '?' && !days.split(',').includes(w.dow))) return null;
  return w.stamp.slice(0, 16);
}

export const validExpr = (expr: string) => AT_RE.test(expr) || CRON_RE.test(expr);

export interface LocalSchedules extends Schedules {
  /** Fires what is due at `now` (each fire awaited, a failure logged and not retried); returns how many fired. */
  tick(now: number, fire: (input: unknown) => Promise<unknown>): Promise<number>;
  list(): { name: string; expr: string; enabled: boolean; input: string; tz: string; once: boolean; last: string | null }[];
}

export function openSchedules(db: DatabaseSync): LocalSchedules {
  db.exec(`CREATE TABLE IF NOT EXISTS schedules (name TEXT PRIMARY KEY, expr TEXT NOT NULL, enabled INTEGER NOT NULL, input TEXT NOT NULL,
    tz TEXT NOT NULL, once INTEGER NOT NULL, last TEXT)`);
  const upsert = db.prepare(`INSERT INTO schedules (name, expr, enabled, input, tz, once) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET expr = excluded.expr, enabled = excluded.enabled, input = excluded.input, tz = excluded.tz, once = excluded.once`);
  const del = db.prepare('DELETE FROM schedules WHERE name = ?');
  const all = db.prepare('SELECT name, expr, enabled, input, tz, once, last FROM schedules ORDER BY name');
  const mark = db.prepare('UPDATE schedules SET last = ? WHERE name = ?');
  const rows = () => (all.all() as any[]).map(r => ({ name: r.name, expr: r.expr, enabled: !!r.enabled, input: r.input, tz: r.tz, once: !!r.once, last: r.last ?? null }));
  return {
    async put(name: string, expr: string, enabled: boolean, input: string, opts?: ScheduleOpts) {
      const tz = opts?.tz ?? DEFAULT_TZ;
      if (!validExpr(expr)) throw new Error(`unsupported schedule expression: ${expr}`);
      wallClock(0, tz); // an unknown zone throws here, not at every tick
      upsert.run(name, expr, enabled ? 1 : 0, input, tz, opts?.once ? 1 : 0);
    },
    async remove(name: string) { del.run(name) },
    list: rows,
    async tick(now, fire) {
      let n = 0;
      for (const r of rows().filter(r => r.enabled)) {
        let key: string | null;
        try { key = dueKey(r.expr, r.tz, now) } catch { continue }
        if (!key || key === r.last) continue;
        // Recorded before the run: a crash during it never fires it twice.
        if (key === 'at' || r.once) del.run(r.name); else mark.run(key, r.name);
        let input: unknown;
        try { input = JSON.parse(r.input) } catch { console.error('schedule_bad_input', r.name); continue }
        n++;
        try { await fire(input) } catch (e) { console.error('schedule_fire_failed', r.name, (e as Error)?.name, (e as Error)?.message?.slice(0, 200)) }
      }
      return n;
    },
  };
}
