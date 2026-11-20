// Thread info panel (« Thread info »): the code, assets and timeline of one thread, read on demand (`details.get`).
// Identifiers say `details` (`threadInfo` already names the public thread carried by `history`).
// - Timeline: events the hub records as they happen (`THREAD#<id>/EV#<at>#<id>`, from this feature on): turn start and
//   end, outcome, shared resource taken / queued / freed, commits pushed (`pushed_commits`, CI follow-up on or off),
//   CI verdict, merge. A thread older than the feature only shows its opening.
// - Assets: files attached to its messages (FileRef only, the client asks the URLs as for a message).
// - Code: the pushed commits (from the events) and, read on GitHub when the panel opens, the pull request of each
//   repo's last pushed branch (`details.prs`, GitHub Lambda, token restricted to pull requests read on those repos).
import { DETAILS_MAX_EVENTS, DETAILS_MAX_FILES, type DetailsFile, type PrError, type PrState, type ThreadDetails, type ThreadEvent } from '../../protocol/frames.ts';
import { canSee, reposOf, type Deps, type Space } from './router.ts';

/** What one Query of the thread's partition gives the panel: first message date, attached files, recorded events. */
export interface DetailsRows { first: number | null; files: DetailsFile[]; events: ThreadEvent[] }

/**
 * Records a timeline event. Best effort: a failed write never fails the action it describes (the panel then misses
 * one line). Never for a Lounge topic (no panel there).
 */
export async function logEvent(deps: Pick<Deps, 'store' | 'newId'>, thread: { id: string; kind?: string }, ev: ThreadEvent): Promise<void> {
  if (thread.kind === 'topic') return;
  try { await deps.store.putEvent(thread.id, deps.newId(), ev); }
  catch (e) { console.error('event_put_failed', thread.id, ev.kind, (e as Error)?.message?.slice(0, 160)); }
}

/** The panel's data: newest DETAILS_MAX_EVENTS events and DETAILS_MAX_FILES files kept, oldest first. */
export function threadDetails(thread: string, rows: DetailsRows, from: { id: string; title: string } | null): ThreadDetails {
  const events = rows.events.slice().sort((a, b) => a.at - b.at);
  const files = rows.files.slice().sort((a, b) => a.at - b.at);
  return {
    thread,
    opened: rows.first === null ? null : { at: rows.first, ...(from ? { from } : {}) },
    files: files.slice(-DETAILS_MAX_FILES),
    events: events.slice(-DETAILS_MAX_EVENTS),
    more: events.length > DETAILS_MAX_EVENTS || files.length > DETAILS_MAX_FILES,
  };
}

/** Last pushed head of each attached repo (its branch if the agent gave it): what the PR read looks for. */
export function pushedHeads(events: ThreadEvent[], space: Space): { repo: string; sha: string; branch?: string }[] {
  const repos = reposOf(space), out = new Map<string, { repo: string; sha: string; branch?: string }>();
  for (const e of events.slice().sort((a, b) => a.at - b.at)) {
    if (e.kind !== 'push') continue;
    const repo = repos.find(r => r.toLowerCase() === e.repo.toLowerCase());
    if (repo) out.set(repo, { repo, sha: e.sha, ...(e.branch ? { branch: e.branch } : {}) });
  }
  return [...out.values()];
}

// ---------------------------------------------------------------- GitHub read (GitHub Lambda only)
/** Pull requests of pushed heads, read with a token restricted to `pull_requests: read` on these repos. */
export interface PrReader { read(org: string, heads: { repo: string; sha: string; branch?: string }[]): Promise<{ prs: PrState[]; errors: PrError[] }> }
/** At most this many PRs per repo (a branch reused for several PRs: newest first). */
export const PRS_PER_REPO = 3;
const cutText = (x: unknown, max: number) => [...String(x ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ')].slice(0, max).join('');
const ghUrl = (u: unknown) => typeof u === 'string' && /^https:\/\/github\.com\//.test(u) && u.length <= 500 ? u : '';

/** REST pull objects -> PrState (number, title, link, state, draft, head branch; nothing else of the PR is kept). */
export function mapPulls(repo: string, list: unknown): PrState[] {
  return (Array.isArray(list) ? list : []).filter((p: any) => p && Number.isSafeInteger(p.number) && p.number > 0).slice(0, PRS_PER_REPO).map((p: any) => ({
    repo, number: p.number, title: cutText(p.title, 200), url: ghUrl(p.html_url),
    state: p.merged_at ? 'merged' as const : p.state === 'closed' ? 'closed' as const : 'open' as const, draft: p.draft === true,
    ...(typeof p.head?.ref === 'string' ? { branch: cutText(p.head.ref, 200) } : {}),
  }));
}

/**
 * With a branch: `GET /repos/{o}/{r}/pulls?head={o}:{branch}&state=all` (open, closed and merged; a squash merge keeps
 * the PR found). Without: `GET /repos/{o}/{r}/commits/{sha}/pulls` (GitHub only returns open PRs for a commit that is
 * not on the default branch). Forks are not looked up (head owner = the repo's owner).
 */
export function makePrReader(token: (org: string, repos: string[]) => Promise<string>, fetchFn: typeof fetch = fetch): PrReader {
  return {
    async read(org, heads) {
      const names = [...new Set(heads.map(h => h.repo.split('/')[1]))].sort();
      const tok = await token(org, names); // not_installed / no_permission thrown as is, mapped by the caller
      const prs: PrState[] = [], errors: PrError[] = [];
      for (const h of heads) {
        const [o, n] = h.repo.split('/').map(encodeURIComponent);
        const path = h.branch ? `/repos/${o}/${n}/pulls?state=all&per_page=${PRS_PER_REPO}&head=${o}:${encodeURIComponent(h.branch)}`
          : `/repos/${o}/${n}/commits/${h.sha}/pulls?per_page=${PRS_PER_REPO}`;
        const r = await fetchFn(`https://api.github.com${path}`, {
          headers: { authorization: `Bearer ${tok}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'briefling' },
          signal: AbortSignal.timeout(10_000),
        });
        const j: any = await r.json().catch(() => null);
        if (r.status === 401 || r.status === 403) { console.log('prs_read_refused', r.status, String(j?.message ?? '').slice(0, 120)); errors.push({ repo: h.repo, code: 'no_permission' }); continue; }
        if (r.status === 404 || r.status === 422) continue; // unknown commit or branch: no PR
        if (r.status !== 200) { errors.push({ repo: h.repo, code: 'failed' }); continue; }
        prs.push(...mapPulls(h.repo, j));
      }
      return { prs, errors };
    },
  };
}

/**
 * `details.get` second half (GitHub Lambda): the PRs of the thread's pushed heads, sent to the connection that asked.
 * Gate read again (member of the space, attached repos only); a refusal or a failure is said per repo, never thrown.
 */
export async function detailsPrs(deps: Deps & { prs: PrReader }, job: { thread: string; by: string; conn: string; client_id: string }): Promise<'done' | 'refused'> {
  const thread = await deps.store.getThread(job.thread);
  const space = thread && await deps.store.getSpace(thread.space);
  if (!thread || !space || !canSee(space, job.by)) return 'refused';
  const heads = pushedHeads((await deps.store.threadDetails(thread.id)).events, space);
  const prs: PrState[] = [], errors: PrError[] = [];
  const byOrg = new Map<string, typeof heads>();
  for (const h of heads) { const o = h.repo.split('/')[0].toLowerCase(); byOrg.set(o, [...(byOrg.get(o) ?? []), h]); }
  for (const [org, hs] of byOrg) {
    try { const r = await deps.prs.read(org, hs); prs.push(...r.prs); errors.push(...r.errors); }
    catch (e) {
      const m = (e as Error)?.message ?? '';
      console.error('prs_read_failed', org, m.slice(0, 160));
      const code = m === 'not_installed' ? 'not_installed' as const : m === 'no_permission' ? 'no_permission' as const : 'failed' as const;
      errors.push(...hs.map(h => ({ repo: h.repo, code })));
    }
  }
  await deps.sender.send(job.conn, { v: 2, type: 'details.prs', client_id: job.client_id, thread: thread.id, prs, errors });
  return 'done';
}
