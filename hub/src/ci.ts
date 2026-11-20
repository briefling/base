// CI follow-up (docs/design-ci-feedback.md, slice 1: display only, no agent wake-up). The agent declares the commits it
// pushed (`ci.watch`, router); the 5-min poller reads their CI on GitHub with a token restricted to checks/statuses read
// on the followed repos, decides a verdict, keeps the latest state per repo on the thread and posts a system line when a
// human should look (red, never finished, commit unknown). Nothing CI-written ever reaches a prompt: the line's `text`
// (read by the summary model) holds no check name, the names live in `Message.ci` for the client only.
import { CI_LISTED, CI_NAME_MAX, CI_NONE_MS, type CiCheck, type CiPill, type CiReason, type CiReport, type CiVerdict, type Message } from '../../protocol/frames.ts';
import { broadcast, modOn, mutateThread, publicThread, type Deps, type Space, type StoredThread } from './router.ts';
import { logEvent } from './details.ts';

/** One commit followed in one thread (`CIWATCH` partition, one item per thread and repo: a new sha overwrites it). */
export interface StoredCiWatch { thread: string; space: string; repo: string; sha: string; by: string; since: number; deadline: number }

/** A check run or a commit status, as read from GitHub's rollup. state: check run status (QUEUED, IN_PROGRESS,
 *  COMPLETED, WAITING, PENDING, REQUESTED) or commit status state (PENDING, EXPECTED, SUCCESS, FAILURE, ERROR). */
export interface CiContext { kind: 'check' | 'status'; name: string; state: string; conclusion: string | null; url: string }
/** What GitHub says about one commit: its contexts, or why it could not be read. */
export type CiRead = { contexts: CiContext[] } | { missing: true } | { reason: CiReason };
export interface CiReader {
  /** The CI of these commits of one organization's repos (key `repo@sha`). Throws on a transient failure (retried at the next poll). */
  read(org: string, commits: { repo: string; sha: string }[]): Promise<Map<string, CiRead>>;
}
export const ciKey = (repo: string, sha: string) => `${repo.toLowerCase()}@${sha}`;

const RED = new Set(['FAILURE', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR']);
const GREEN = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
const terminal = (c: CiContext) => c.kind === 'check' ? c.state === 'COMPLETED' : c.state === 'SUCCESS' || c.state === 'FAILURE' || c.state === 'ERROR';
/** Result of a finished context: the check's conclusion, or the status state itself. */
const result = (c: CiContext) => c.kind === 'check' ? c.conclusion ?? '' : c.state;

export interface Verdict { verdict: CiVerdict; n: number; failed: CiCheck[]; passed: number; reason?: CiReason }
/**
 * Verdict of one commit (design § 5.3). Red is decided once every context is terminal: one line, the whole list. A
 * commit with nothing yet is running for CI_NONE_MS (the CI may not have started), then `none`.
 */
export function ciVerdict(r: CiRead, since: number, deadline: number, now: number): Verdict {
  if ('reason' in r) return { verdict: 'unknown', n: 0, failed: [], passed: 0, reason: r.reason };
  if ('missing' in r) return { verdict: 'missing', n: 0, failed: [], passed: 0 };
  const cs = r.contexts, n = cs.length;
  const failed = cs.filter(c => terminal(c) && RED.has(result(c))).map(c => ({ name: c.name, conclusion: result(c).toLowerCase(), ...(c.url ? { url: c.url } : {}) }));
  const passed = cs.filter(c => terminal(c) && GREEN.has(result(c))).length;
  const base = { n, failed, passed };
  if (!n) return { ...base, verdict: now - since >= CI_NONE_MS ? 'none' : now >= deadline ? 'timeout' : 'running' };
  if (cs.some(c => !terminal(c))) return { ...base, verdict: now >= deadline ? 'timeout' : 'running' };
  return { ...base, verdict: failed.length ? 'red' : passed === n ? 'green' : 'cancelled' };
}

// ---------------------------------------------------------------- GitHub read
// REST, not the GraphQL `statusCheckRollup`: reaching a commit through GraphQL (`repository.object`) needs `contents:
// read` (checked live: FORBIDDEN « Resource not accessible by integration » with checks + statuses only), and the CI
// token must not read code. Two calls per commit: check runs (`checks: read`, latest attempt of each) and the combined
// status (`statuses: read`, latest per context; its `state` is « pending » with no status at all, so only the list is used).
/** A link shown to humans: kept only on github.com (a status `target_url` can point anywhere: phishing). */
const ghUrl = (u: unknown) => typeof u === 'string' && /^https:\/\/github\.com\//.test(u) && u.length <= 500 ? u : '';
const cut = (x: unknown) => [...String(x ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ')].slice(0, CI_NAME_MAX).join('');
const up = (x: unknown) => String(x ?? '').toUpperCase();

/** REST check runs + combined statuses -> contexts. Only names, states, conclusions and URLs are read (no output,
 *  annotation nor description). */
export function mapContexts(checkRuns: any[], statuses: any[]): CiContext[] {
  return [
    ...(Array.isArray(checkRuns) ? checkRuns : []).filter(x => x && typeof x.name === 'string')
      .map(x => ({ kind: 'check' as const, name: cut(x.name), state: up(x.status), conclusion: x.conclusion ? up(x.conclusion) : null, url: ghUrl(x.html_url ?? x.details_url) })),
    ...(Array.isArray(statuses) ? statuses : []).filter(x => x && typeof x.context === 'string')
      .map(x => ({ kind: 'status' as const, name: cut(x.context), state: up(x.state), conclusion: null, url: ghUrl(x.target_url) })),
  ];
}

/** `token(org, repoNames)`: an installation token restricted to checks/statuses read on these repos of `org`. */
export function makeCiReader(token: (org: string, repos: string[]) => Promise<string>, fetchFn: typeof fetch = fetch): CiReader {
  return {
    async read(org, commits) {
      const out = new Map<string, CiRead>();
      const names = [...new Set(commits.map(c => c.repo.split('/')[1]))].sort();
      const tok = await token(org, names); // not_installed / no_permission thrown as is, mapped by the caller
      const get = async (path: string) => {
        const r = await fetchFn(`https://api.github.com${path}`, {
          headers: { authorization: `Bearer ${tok}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'briefling' },
          signal: AbortSignal.timeout(10_000),
        });
        const j: any = await r.json().catch(() => null);
        return { status: r.status, j };
      };
      for (const c of commits) {
        // Path parts encoded: the repo comes from the space settings, the sha was checked by the router (SHA_RE).
        const [o, n] = c.repo.split('/').map(encodeURIComponent);
        const base = `/repos/${o}/${n}/commits/${c.sha}`;
        const runs = await get(`${base}/check-runs?per_page=100&filter=latest`);
        const key = ciKey(c.repo, c.sha);
        if (runs.status === 404 || runs.status === 422) { out.set(key, { missing: true }); continue; } // no such commit
        if (runs.status === 401 || runs.status === 403) { console.log('ci_read_refused', runs.status, String(runs.j?.message ?? '').slice(0, 120)); out.set(key, { reason: 'no_permission' }); continue; }
        if (runs.status !== 200 || !runs.j) throw new Error(`github_${runs.status}`);
        const st = await get(`${base}/status?per_page=100`);
        if (st.status === 401 || st.status === 403) { console.log('ci_read_refused', st.status, String(st.j?.message ?? '').slice(0, 120)); out.set(key, { reason: 'no_permission' }); continue; }
        if (st.status !== 200 || !st.j) throw new Error(`github_${st.status}`);
        out.set(key, { contexts: mapContexts(runs.j.check_runs, st.j.statuses) });
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------- thread state
/** The thread's pills with `p` as the latest of its repo (most recent first, CI_MAX_WATCHES kept by the router's gate). */
export function withPill(pills: CiPill[] | undefined, p: CiPill): CiPill[] {
  return [p, ...(pills ?? []).filter(x => x.repo.toLowerCase() !== p.repo.toLowerCase())];
}
const sha7 = (sha: string) => sha.slice(0, 7);
/** English fallback of a CI line: counts only (it reaches the summary model, check names are CI-written text). */
export function ciLineText(r: CiReport): string {
  const at = `${r.repo}@${sha7(r.sha)}`;
  if (r.verdict === 'missing') return `CI: commit ${at} not found on GitHub.`;
  if (r.verdict === 'timeout') return `CI on ${at} still not finished after one hour: follow-up stopped.`;
  return `CI failed on ${at}: ${r.failed.length + r.more} failed, ${r.passed} passed.`;
}
export function ciReport(w: Pick<StoredCiWatch, 'repo' | 'sha'>, v: Verdict): CiReport | null {
  if (v.verdict !== 'red' && v.verdict !== 'timeout' && v.verdict !== 'missing') return null;
  return { repo: w.repo, sha: w.sha, verdict: v.verdict, failed: v.failed.slice(0, CI_LISTED), more: Math.max(0, v.failed.length - CI_LISTED), passed: v.passed };
}

type CiDeps = Deps & { ci: CiReader };

/**
 * CI pass of the poller (every 5 min, whoever is connected): nothing followed = one Query, no GitHub call. A watch ends
 * on any verdict but running; a transient GitHub failure keeps it for the next run (until its deadline).
 */
export async function pollCi(deps: CiDeps): Promise<{ open: number; ended: number }> {
  const watches = await deps.store.listCiWatches();
  if (!watches.length) return { open: 0, ended: 0 };
  const now = deps.now();
  const spaces = new Map<string, Space | null>();
  const spaceOf = async (id: string) => { if (!spaces.has(id)) spaces.set(id, await deps.store.getSpace(id)); return spaces.get(id)! };
  const live: StoredCiWatch[] = [];
  let ended = 0;
  for (const w of watches) {
    const s = await spaceOf(w.space);
    // Follow-up turned off, or the repo detached since: dropped without a line.
    if (!s || !s.ci || !modOn(s, 'ci') || s.archived || !reposIn(s).includes(w.repo)) { if (await drop(deps, w)) ended++; continue; }
    live.push(w);
  }
  const byOrg = new Map<string, StoredCiWatch[]>();
  for (const w of live) { const o = w.repo.split('/')[0].toLowerCase(); byOrg.set(o, [...(byOrg.get(o) ?? []), w]); }
  for (const [org, ws] of byOrg) {
    let reads: Map<string, CiRead> | null = null, reason: CiReason | null = null;
    try { reads = await deps.ci.read(org, ws); }
    catch (e) {
      const m = (e as Error)?.message ?? '';
      if (m === 'not_installed') reason = 'not_installed';
      else if (m === 'no_permission') reason = 'no_permission';
      else console.error('ci_read_failed', org, m.slice(0, 120)); // transient: next run
    }
    for (const w of ws) {
      const r = reason ? { reason } : reads?.get(ciKey(w.repo, w.sha));
      const v = r ? ciVerdict(r, w.since, w.deadline, now) : now >= w.deadline ? { verdict: 'timeout' as const, n: 0, failed: [], passed: 0 } : null;
      if (!v || v.verdict === 'running') continue;
      if (await settle(deps, w, v)) ended++;
    }
  }
  return { open: watches.length - ended, ended };
}
/** Attached repos of a space (same rule as the router's `reposOf`, kept here to avoid an import cycle at load). */
const reposIn = (s: Space) => s.repos ?? s.github?.repos ?? [];

/** Ends a watch on its verdict: pill updated (if still this sha), line posted when a human should look. */
async function settle(deps: Deps, w: StoredCiWatch, v: Verdict): Promise<boolean> {
  if (!(await deps.store.deleteCiWatch(w.thread, w.repo, w.sha))) return false; // superseded or stopped meanwhile
  console.log('ci_verdict', w.repo, sha7(w.sha), v.verdict, v.n, v.failed.length);
  const pill: CiPill = { repo: w.repo, sha: w.sha, verdict: v.verdict, at: deps.now(), n: v.n, failed: v.failed.length, ...(v.reason ? { reason: v.reason } : {}) };
  let current = false;
  const t = await mutateThread(deps, w.thread, { type: 'noop' }, undefined, undefined, x => {
    current = !!x.ci?.some(p => p.repo === w.repo && p.sha === w.sha);
    return current ? { ...x, ci: withPill(x.ci, pill) } : x;
  }).catch(() => null); // thread gone: nothing to show
  if (!t || !current) return true;
  await logEvent(deps, t, { at: pill.at, kind: 'ci', repo: w.repo, sha: w.sha, verdict: v.verdict });
  const report = ciReport(w, v);
  if (report) {
    const line: Message = { id: deps.newId(), thread: t.id, author: { kind: 'system', id: 'ci' }, type: 'text', text: ciLineText(report), ci: report, at: deps.now() };
    const r = await deps.store.upsertMessage(line);
    if (r) await broadcast(deps, t.space, { v: 2, type: 'event', event: 'message.created', data: r.message });
  }
  await broadcast(deps, t.space, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(t) });
  return true;
}

/** Drops a watch and its running pill (follow-up off, stopped, thread put away). */
async function drop(deps: Deps, w: StoredCiWatch): Promise<boolean> {
  if (!(await deps.store.deleteCiWatch(w.thread, w.repo, w.sha))) return false;
  const t = await mutateThread(deps, w.thread, { type: 'noop' }, undefined, undefined, x => withoutRunning(x, w.repo)).catch(() => null);
  if (t) await broadcast(deps, t.space, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(t) });
  return true;
}
/** The thread without the running pill of `repo` (every running pill when no repo). */
export function withoutRunning(x: StoredThread, repo?: string): StoredThread {
  if (!x.ci?.some(p => p.verdict === 'running' && (!repo || p.repo === repo))) return x;
  const ci = x.ci.filter(p => !(p.verdict === 'running' && (!repo || p.repo === repo)));
  const { ci: _, ...rest } = x;
  return ci.length ? { ...x, ci } : rest as StoredThread;
}

/** « Stop CI follow-up », Done, Closed, Later, Archive: every watch of the thread ends, its running pills go. */
export async function stopCi(deps: Deps, thread: StoredThread): Promise<StoredThread> {
  if (!thread.ci?.some(p => p.verdict === 'running')) return thread; // nothing followed: no Query
  for (const w of (await deps.store.listCiWatches()).filter(x => x.thread === thread.id)) await deps.store.deleteCiWatch(w.thread, w.repo, w.sha);
  const t = await mutateThread(deps, thread.id, { type: 'noop' }, undefined, undefined, x => withoutRunning(x));
  await broadcast(deps, t.space, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(t) });
  return t;
}

