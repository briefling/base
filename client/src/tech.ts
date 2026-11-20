// Technical details folded for a member the admin flagged « not technical » (SpaceInfo.nontech): diffs and code
// blocks, commits, CI, tool phrases and deploy rows sit behind a « Details » toggle, never removed; everyone else
// keeps today's display. DOM-free so node can test it (client/test/tech.test.ts).
import type { Key } from './i18n.ts';

/** Timeline rows about code, CI, locks and refused tool calls (details.ts keys): folded for a non-technical reader. */
const TECH_ROWS = new Set<Key>(['det_push', 'det_push_branch', 'det_ci', 'det_merge', 'det_res_acquired', 'det_res_queued', 'det_res_released', 'det_refused']);
export const techRow = (key: Key) => TECH_ROWS.has(key);

export type Run<T> = { tech: false; row: T } | { tech: true; rows: T[] };
/** Rows in order, each run of consecutive technical rows grouped into one (folded under one toggle). */
export function foldRuns<T>(rows: readonly T[], isTech: (r: T) => boolean): Run<T>[] {
  const out: Run<T>[] = [];
  for (const r of rows) {
    const last = out.at(-1);
    if (!isTech(r)) out.push({ tech: false, row: r });
    else if (last?.tech) last.rows.push(r);
    else out.push({ tech: true, rows: [r] });
  }
  return out;
}

/** Activity feed of a non-technical reader: the tool phrases, or the current one alone when the agent sends no feed
 *  (the line itself then no longer shows it). */
export const feedOf = (recent: readonly string[] | undefined, what: string | null | undefined): string[] =>
  recent?.length ? [...recent] : what ? [what] : [];
