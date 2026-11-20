// GitHub jobs (dedicated Lambda, the only one holding the GitHub App key): Project polling and issue creation.
import type { GhSnapshot, MergeBlock, MergeInfo, Message, NewIssue, NewIssueError, Plan, PlanError } from '../../protocol/frames.ts';
import { boardDriven, reposOf, broadcast, labelTarget, mergeTarget, mutateThread, publicThread, wakeFlow, type Deps, type GithubJob, type Space } from './router.ts';
import { issueBody, LABEL_UNKNOWN, MERGE_MOVED, MERGE_REFUSED, mergeBlock, NOT_INSTALLED, publishable, type GitHub, type PullInfo } from './github.ts';
import { createdBodyCard, issueKey, ownerOf, syncIssues } from './board.ts';
import { logEvent } from './details.ts';

type JobDeps = Deps & { gh: GitHub; sleep?: (ms: number) => Promise<void> };

/** Polls the Project of a space; broadcasts only if something changed. */
export async function pollSpace(deps: JobDeps, spaceId: string): Promise<'updated' | 'same' | 'skipped'> {
  const space = await deps.store.getSpace(spaceId);
  if (!space?.github) return 'skipped';
  // On-demand: nobody connected, no GitHub call (polling resumes on the next run).
  if (!(await deps.store.listSubs(spaceId)).some(s => s.kind === 'human')) return 'skipped';
  const { owner, project } = space.github;
  let snap: GhSnapshot;
  try {
    const p = await deps.gh.project(owner, project);
    // Board-driven space: issues -> threads first, so each Board item links to its thread.
    const links = boardDriven(space) ? await syncIssues(deps, space, p.issues ?? []) : null;
    const items = links ? p.items.map(i => { const t = i.repo && i.number ? links.get(issueKey(i.repo, i.number)) : undefined; return t ? { ...i, thread: t } : i; }) : p.items;
    snap = { space: spaceId, at: deps.now(), project: { title: p.title, url: p.url }, items };
  } catch (e) {
    if ((e as Error)?.message !== NOT_INSTALLED) throw e;
    // Shown on the Board instead of an empty one; broadcast once (same comparison as a normal read).
    snap = { space: spaceId, at: deps.now(), project: { title: `${owner} #${project}`, url: `https://github.com/orgs/${encodeURIComponent(owner)}/projects/${project}` }, items: [], error: NOT_INSTALLED };
  }
  const prev = await deps.store.getGithub(spaceId);
  if (prev && JSON.stringify({ ...prev, at: 0 }) === JSON.stringify({ ...snap, at: 0 })) return 'same';
  await deps.store.putGithub(snap);
  await broadcast(deps, spaceId, { v: 2, type: 'event', event: 'github.updated', data: snap });
  if (!snap.error) await wakeFlow(deps, space); // an issue moved on the board: the flow's agents read it now
  return 'updated';
}

/** Creates a thread's issue, adds it to the Project, and records it in the thread. Re-checks everything: the queue is no proof. */
export async function createIssue(deps: JobDeps, job: { thread: string; repo: string; by: string }): Promise<'done' | 'refused'> {
  const thread = await deps.store.getThread(job.thread);
  const space = thread && await deps.store.getSpace(thread.space);
  if (!thread || !space?.github || thread.issue || !reposOf(space).includes(job.repo) || !space.trusted.includes(job.by)) return 'refused';
  const name = (id: string) => space.names?.[id] ?? 'Member';
  // SQS delivers at least once: we "reserve" the thread before writing to GitHub (only one Lambda wins).
  try {
    await mutateThread(deps, thread.id, { type: 'noop' }, undefined, undefined, f => { if (f.issue || f.issuePending) throw new Error('claimed'); return { ...f, issuePending: true }; });
  } catch (e) { if ((e as Error).message === 'claimed') return 'refused'; throw e; }
  const body = issueBody(thread.title, await deps.store.getSummary(thread.id), await deps.store.lastMessages(thread.id, 50), name);
  const issue = await deps.gh.createIssue(job.repo, thread.title, body);
  // This thread is the issue's thread: a board-driven space's poller must not open a second one for it.
  await deps.store.claimIssueThread(space.id, issueKey(job.repo, issue.number), thread.id);
  const p = await deps.gh.project(space.github.owner, space.github.project).catch(() => null);
  if (p) await deps.gh.addToProject(space.github.owner, p.id, issue.nodeId).catch(e => console.error('github_add_to_project_failed', (e as Error).message));
  const next = await mutateThread(deps, thread.id, { type: 'noop' }, undefined, undefined, f => ({ ...f, issuePending: false, issue: { repo: job.repo, number: issue.number, url: issue.url } }));
  const msg: Message = { id: deps.newId(), thread: thread.id, author: { kind: 'system', id: 'briefling' }, type: 'text',
    text: `${name(job.by)} opened issue ${job.repo}#${issue.number}: ${issue.url}`, at: deps.now() };
  await deps.store.upsertMessage(msg);
  await broadcast(deps, thread.space, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(next) });
  await broadcast(deps, thread.space, { v: 2, type: 'event', event: 'message.created', data: msg });
  await wakeFlow(deps, space);
  return 'done';
}

/**
 * Approved "Create this issue?" card (`propose_issue`): creates the issue with the briefling App (no label), adds it to
 * the Project, opens its thread `repo#N` with the body as the first GitHub card, links the card to it. SQS delivers at
 * least once: the card is claimed (conditional write on `rev`) before any GitHub write, and the issue number is recorded
 * as soon as GitHub answers, so a retry can never create a second one. Gate checked again (the queue is no proof). Never
 * throws after the claim: any failure is shown on the card (`error`), never retried automatically.
 */
export async function createProposedIssue(deps: JobDeps, job: Extract<GithubJob, { kind: 'newissue' }>): Promise<'done' | 'refused' | 'failed'> {
  const src = await deps.store.getThread(job.thread);
  let card = src ? await deps.store.getMessage(src.id, job.msg) : null;
  let p = card?.type === 'issue' ? card.newIssue : undefined;
  if (!src || !card || !p || p.status !== 'pending' || p.claimed || p.approver !== job.by) return 'refused';
  const write = async (next: NewIssue, show = true) => {
    const r = await deps.store.upsertMessage({ ...card!, newIssue: next, rev: (card!.rev ?? 0) + 1 });
    if (!r) return false;
    card = r.message; p = next;
    if (show) await broadcast(deps, src.space, { v: 2, type: 'event', event: 'message.updated', data: r.message });
    return true;
  };
  if (!(await write({ ...p, claimed: true }, false))) return 'refused'; // another delivery claimed it
  const fail = async (error: NewIssueError) => { await write({ ...p!, status: 'failed', claimed: false, error }); return 'failed' as const; };
  const space = await deps.store.getSpace(src.space);
  if (!space || !boardDriven(space) || !reposOf(space).includes(p.repo) || !space.trusted.includes(job.by)) return fail('refused');
  let issue: Awaited<ReturnType<GitHub['createIssue']>>;
  try { issue = await deps.gh.createIssue(p.repo, p.title, p.body); }
  catch (e) {
    const m = (e as Error)?.message ?? '';
    console.error('github_newissue_failed', job.thread, m.slice(0, 200));
    return fail(m === NOT_INSTALLED ? 'not_installed' : 'github');
  }
  // From here on the issue exists: recorded at once, a retry would duplicate it.
  await write({ ...p, number: issue.number, url: issue.url });
  const { owner, project } = space.github!;
  let inProject = true;
  try { const pr = await deps.gh.project(owner, project); await deps.gh.addToProject(owner, pr.id, issue.nodeId); }
  catch (e) { inProject = false; console.error('github_add_to_project_failed', (e as Error)?.message?.slice(0, 200)); }
  try {
    const name = space.names?.[job.by] ?? 'Member';
    const id = await issueThread(deps, space, p.repo, p.title, p.body, issue, job.by,
      `${name} created this issue from "${src.title}", proposed by ${p.by[0].toUpperCase() + p.by.slice(1)}.`);
    await write({ ...p, status: 'done', claimed: false, thread: id, ...(inProject ? {} : { error: 'project' as const }) });
    await wakeFlow(deps, space);
    return 'done';
  } catch (e) {
    console.error('github_newissue_thread_failed', job.thread, (e as Error)?.message?.slice(0, 200));
    return fail('thread');
  }
}

/**
 * The thread of an issue the App just created from a card: one thread per issue (the poller may have seen it first, it
 * lists the Project; then we link to its thread), the body as the first GitHub card, then `line` (GitHub only shows the
 * App as the author: the thread says which human created it, from which conversation). Returns the thread id.
 */
async function issueThread(deps: JobDeps, space: Space, repo: string, title: string, text: string,
  issue: { number: number; url: string; nodeId: string; createdAt?: string }, by: string, line: string): Promise<string> {
  const id = await deps.store.claimIssueThread(space.id, issueKey(repo, issue.number), deps.newId());
  const body = createdBodyCard(id, issue.number, issue.url, issue.createdAt ?? new Date(deps.now()).toISOString(), publishable(text));
  if (await deps.store.getThread(id)) return id;
  const thread = await mutateThread(deps, null, { type: 'noop' }, { id, space: space.id, title, owner: ownerOf([], space), kind: 'thread', opener: by }, undefined,
    f => ({ ...f, issue: { repo, number: issue.number, url: issue.url },
      board: { node: issue.nodeId, column: null, labels: [], state: 'OPEN', vetting: false, sig: '', body: body.id } }));
  await broadcast(deps, space.id, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(thread) });
  const made = await deps.store.upsertMessage(body);
  if (made) await broadcast(deps, space.id, { v: 2, type: 'event', event: 'message.created', data: made.message });
  const msg: Message = { id: deps.newId(), thread: id, author: { kind: 'system', id: 'briefling' }, type: 'text', at: deps.now(), text: line };
  await deps.store.upsertMessage(msg);
  await broadcast(deps, space.id, { v: 2, type: 'event', event: 'message.created', data: msg });
  return id;
}

/** Body of a plan step's issue: its brief, then where it sits in the plan (GitHub shows the dependency, people read this). */
export const planIssueBody = (p: Plan, i: number) =>
  `${p.steps[i].brief}\n\n---\nStep ${i + 1} of ${p.steps.length} of the plan "${p.title}"${i > 0 && p.steps[i - 1].number ? `, after #${p.steps[i - 1].number}` : ''}.`;

/**
 * Approved board plan ("Launch this plan?" with a repo): creates its N issues in order with the briefling App, makes
 * each one blocked by the previous one (GitHub issue dependencies: the board's flow skips blocked items, so the steps
 * run in order), adds them to the Project, opens their threads. Dependencies are set BEFORE the issues reach the
 * Project, so no agent can take step 2 early. SQS delivers at least once: the card is claimed (`rev`) before any
 * GitHub write, and each step records what is done at once (`number` + `node`, `linked`, `thread`): a retry by hand
 * after a failure only does what is left, never a second issue. Never throws after the claim: failures go on the card.
 */
export async function createPlanIssues(deps: JobDeps, job: Extract<GithubJob, { kind: 'newplan' }>): Promise<'done' | 'refused' | 'failed'> {
  const src = await deps.store.getThread(job.thread);
  let card = src ? await deps.store.getMessage(src.id, job.msg) : null;
  let p = card?.type === 'plan' ? card.plan : undefined;
  if (!src || !card || !p || !p.repo || p.status !== 'pending' || p.claimed || p.approver !== job.by) return 'refused';
  const write = async (next: Plan, show = true) => {
    const r = await deps.store.upsertMessage({ ...card!, plan: next, rev: (card!.rev ?? 0) + 1 });
    if (!r) return false;
    card = r.message; p = next;
    if (show) await broadcast(deps, src.space, { v: 2, type: 'event', event: 'message.updated', data: r.message });
    return true;
  };
  const step = (i: number, patch: Partial<Plan['steps'][number]>) => ({ ...p!, steps: p!.steps.map((s, k) => k === i ? { ...s, ...patch } : s) });
  if (!(await write({ ...p, claimed: true }, false))) return 'refused'; // another delivery claimed it
  const fail = async (error: PlanError, e?: unknown) => {
    if (e) console.error('github_newplan_step_failed', job.thread, error, ((e as Error)?.message ?? '').slice(0, 200));
    await write({ ...p!, status: 'failed', claimed: false, error });
    return 'failed' as const;
  };
  const space = await deps.store.getSpace(src.space);
  const repo = p.repo;
  if (!space || !boardDriven(space) || !reposOf(space).includes(repo) || !space.trusted.includes(job.by)) return fail('refused');
  const ghFail = (e: unknown) => fail((e as Error)?.message === NOT_INSTALLED ? 'not_installed' : 'github', e);
  const owner = repo.split('/')[0];
  // 1. The issues, in order (a step's body names the previous issue).
  for (let i = 0; i < p.steps.length; i++) {
    if (p.steps[i].number) continue;
    let issue: Awaited<ReturnType<GitHub['createIssue']>>;
    try { issue = await deps.gh.createIssue(repo, p.steps[i].title, planIssueBody(p, i)); }
    catch (e) { return ghFail(e); }
    await write(step(i, { number: issue.number, url: issue.url, node: issue.nodeId })); // exists now: recorded at once
  }
  // 2. Each step blocked by the previous one.
  for (let i = 1; i < p.steps.length; i++) {
    if (p.steps[i].linked) continue;
    try { await deps.gh.addBlockedBy(owner, p.steps[i].node!, p.steps[i - 1].node!); }
    catch (e) { return ghFail(e); }
    await write(step(i, { linked: true }), false);
  }
  // 3. Project and threads (adding twice to a Project is harmless: GitHub returns the same item).
  let projectId: string;
  try { projectId = (await deps.gh.project(space.github!.owner, space.github!.project)).id; }
  catch (e) { return ghFail(e); }
  const name = space.names?.[job.by] ?? 'Member';
  for (let i = 0; i < p.steps.length; i++) {
    const s = p.steps[i];
    if (s.thread) continue;
    try { await deps.gh.addToProject(space.github!.owner, projectId, s.node!); }
    catch (e) { return ghFail(e); }
    try {
      const id = await issueThread(deps, space, repo, s.title, planIssueBody(p, i), { number: s.number!, url: s.url!, nodeId: s.node! }, job.by,
        `${name} created this issue from "${src.title}": step ${i + 1} of ${p.steps.length} of the plan "${p.title}", proposed by ${p.by[0].toUpperCase() + p.by.slice(1)}.`);
      await write(step(i, { thread: id }), false);
    } catch (e) { return fail('thread', e); }
  }
  await write({ ...p, status: 'done', claimed: false });
  await wakeFlow(deps, space);
  return 'done';
}

type LabelJob = Extract<GithubJob, { kind: 'label' }>;
const withoutColors = <T extends { labelColors?: string[] }>({ labelColors: _, ...b }: T) => b;
/**
 * Adds / removes a label of an issue thread with the briefling App, then says in the thread which human did it (GitHub
 * only shows the App). Gate checked again. Any failure = a visible system line, never retried (the handler never
 * throws). The system line's id is the job's: SQS delivers at least once, a second delivery finds it and stops.
 */
export async function labelIssue(deps: JobDeps, job: LabelJob): Promise<'done' | 'failed' | 'duplicate'> {
  const t0 = await deps.store.getThread(job.thread);
  if (!t0) return 'failed';
  if (await deps.store.getMessage(t0.id, job.id)) return 'duplicate';
  const line = async (text: string) => {
    const msg: Message = { id: job.id, thread: t0.id, author: { kind: 'system', id: 'briefling' }, type: 'text', text, at: deps.now() };
    const r = await deps.store.upsertMessage(msg);
    if (r) await broadcast(deps, t0.space, { v: 2, type: 'event', event: 'message.created', data: r.message });
  };
  const verb = job.on ? 'Adding' : 'Removing';
  const t = await labelTarget(deps, job.thread, job.by);
  if (typeof t === 'string') { await line(`${verb} the label \`${job.label}\` was refused (${t}).`); return 'failed'; }
  const { thread, space } = t;
  const name = space.names?.[job.by] ?? 'Member';
  let set: Awaited<ReturnType<JobDeps['gh']['setLabel']>>;
  try { set = await deps.gh.setLabel(thread.issue!.repo, thread.issue!.number, job.label, job.on); }
  catch (e) {
    const m = (e as Error)?.message ?? '';
    console.error('github_label_failed', job.thread, m.slice(0, 200));
    await line(m === LABEL_UNKNOWN ? `${verb} the label \`${job.label}\` failed: ${thread.issue!.repo} has no such label.`
      : m === NOT_INSTALLED ? `${verb} the label \`${job.label}\` failed: the briefling GitHub App is not installed on ${space.github!.owner}.`
      : `${verb} the label \`${job.label}\` failed (GitHub error). Not retried: try again from the thread.`);
    return 'failed';
  }
  const labels = set.labels;
  // The board state follows at once (the poller confirms at its next run); agent in charge from the assignment label.
  // Colours replaced with the labels (never kept from before: same order as `labels`, a stale list would shift them).
  const next = await mutateThread(deps, thread.id, { type: 'noop' }, undefined, undefined, f => f.board
    ? { ...f, board: { ...withoutColors(f.board), labels, ...(set.labelColors ? { labelColors: set.labelColors } : {}) }, owner: f.facts.turnActive ? f.owner : ownerOf(labels, space) } : f);
  await broadcast(deps, thread.space, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(next) });
  const shown = labels.find(l => l.toLowerCase() === job.label.toLowerCase()) ?? job.label;
  await line(job.on ? `${name} added the label \`${shown}\`.` : `${name} removed the label \`${shown}\`.`);
  await wakeFlow(deps, space);
  return 'done';
}

/** Labels of the issue's repo, sent to the connection that asked (picker). Failure = an `error` frame to it. */
export async function repoLabels(deps: JobDeps, job: Extract<GithubJob, { kind: 'labels' }>): Promise<'done' | 'failed'> {
  const t = await labelTarget(deps, job.thread, job.by);
  const fail = async (code: string) => { await deps.sender.send(job.conn, { v: 2, type: 'error', code, ref: job.client_id }); return 'failed' as const; };
  if (typeof t === 'string') return fail(t);
  try {
    const labels = await deps.gh.repoLabels(t.thread.issue!.repo);
    await deps.sender.send(job.conn, { v: 2, type: 'labels', client_id: job.client_id, thread: t.thread.id, labels });
    return 'done';
  } catch (e) {
    const m = (e as Error)?.message ?? '';
    console.error('github_labels_failed', job.thread, m.slice(0, 200));
    return fail(m === NOT_INSTALLED ? 'github_not_installed' : 'github_failed');
  }
}

// ---- Merge button (issue in « To merge », unstrikeable `approved`: humans merge, the click is that human act)
type MergeJob = Extract<GithubJob, { kind: 'merge' }>;
const UNKNOWN_RETRY_MS = 2000;
const AFTER_MERGE_POLL_MS = [4000, 8000]; // inside the GitHub Lambda's 60 s timeout
/**
 * Fresh read of what the Merge button shows: the issue's open linked PRs in attached repos and, when there is exactly
 * one, the PR itself. GitHub computes `mergeable` lazily (null / `unknown` on the first read): read again once.
 */
async function readMerge(deps: JobDeps, thread: { issue?: { repo: string } | null; board?: { node: string } | null }, space: Space): Promise<{ info: MergeInfo; pull?: PullInfo }> {
  const prs = (await deps.gh.openPrs(thread.issue!.repo.split('/')[0], thread.board!.node)).filter(p => reposOf(space).includes(p.repo));
  if (prs.length !== 1) return { info: { pr: null, prs: prs.length, blocked: null } };
  const { repo, number } = prs[0];
  let pull = await deps.gh.pull(repo, number);
  if (mergeBlock(pull) === 'unknown') {
    await (deps.sleep ?? (ms => new Promise(r => setTimeout(r, ms))))(UNKNOWN_RETRY_MS);
    pull = await deps.gh.pull(repo, number);
  }
  return { pull, info: { pr: { repo, number, title: pull.title, url: pull.url, sha: pull.sha }, prs: 1, blocked: mergeBlock(pull) } };
}
// 403 = the App lacks pull requests / contents: write (added by Blair in the App settings, then accepted on the installation).
const ghError = (m: string) => m === NOT_INSTALLED ? 'github_not_installed' : /^github_403/.test(m) ? 'github_permission' : 'github_failed';
const NO_PERMISSION = 'the briefling GitHub App lacks the permission (contents and pull requests: write)';

/** `merge.get`: what the Merge button shows, sent to the connection that asked. Failure = an `error` frame to it. */
export async function mergeInfo(deps: JobDeps, job: Extract<GithubJob, { kind: 'mergeinfo' }>): Promise<'done' | 'failed'> {
  const fail = async (code: string) => { await deps.sender.send(job.conn, { v: 2, type: 'error', code, ref: job.client_id }); return 'failed' as const; };
  const t = await mergeTarget(deps, job.thread, job.by);
  if (typeof t === 'string') return fail(t);
  try {
    const { info } = await readMerge(deps, t.thread, t.space);
    await deps.sender.send(job.conn, { v: 2, type: 'merge', client_id: job.client_id, thread: job.thread, merge: info });
    return 'done';
  } catch (e) {
    const m = (e as Error)?.message ?? '';
    console.error('github_mergeinfo_failed', job.thread, m.slice(0, 200));
    return fail(ghError(m));
  }
}

/** Why a merge was refused, as the thread's system line says it (after « Merging repo#n was refused: »). */
const BLOCK_TEXT: Record<MergeBlock, string> = {
  conflict: 'it conflicts with the default branch (unstrikeable sends it back to the dev for a rebase)',
  checks: 'its checks are not green (failed or still running)', blocked: 'branch protection blocks it',
  behind: 'branch protection wants it up to date with the default branch', draft: 'it is a draft',
  base: 'it does not target the default branch', unknown: 'GitHub has not computed whether it can be merged yet, try again in a moment',
  merged: 'it is already merged', closed: 'it is closed',
};

/**
 * Merges the PR the human saw (squash, at the head `sha` shown), then deletes its head branch, with the briefling App.
 * Everything is read again first: gate, the issue's only open PR in an attached repo, its mergeability, its head. A
 * system line says who merged (GitHub only shows the App) or why not; then a fresh state goes to the clicking connection.
 * Never retried, never throws on GitHub errors; the line's id is the job's, so an SQS redelivery stops at once.
 */
export async function mergePr(deps: JobDeps, job: MergeJob): Promise<'done' | 'refused' | 'failed' | 'duplicate'> {
  const t0 = await deps.store.getThread(job.thread);
  if (!t0) return 'failed';
  if (await deps.store.getMessage(t0.id, job.id)) return 'duplicate';
  const ref = `${job.repo}#${job.number}`;
  const line = async (text: string) => {
    const msg: Message = { id: job.id, thread: t0.id, author: { kind: 'system', id: 'briefling' }, type: 'text', text, at: deps.now() };
    const r = await deps.store.upsertMessage(msg);
    if (r) await broadcast(deps, t0.space, { v: 2, type: 'event', event: 'message.created', data: r.message });
  };
  const show = (merge: MergeInfo) => deps.sender.send(job.conn, { v: 2, type: 'merge', client_id: job.client_id, thread: t0.id, merge }).catch(() => false);
  // No fresh state to show (gate refused, GitHub failed): an error to the clicking connection, so its button comes back.
  const tell = (code: string) => deps.sender.send(job.conn, { v: 2, type: 'error', code, ref: job.client_id }).catch(() => false);
  const refuse = async (why: string, info?: MergeInfo) => { await line(`Merging ${ref} was refused: ${why}.`); if (info) await show(info); return 'refused' as const; };
  const t = await mergeTarget(deps, job.thread, job.by);
  if (typeof t === 'string') { await tell(t); return refuse(t === 'not_to_merge' ? 'the issue is no longer in « To merge »' : `not allowed (${t})`); }
  const { space } = t;
  const name = space.names?.[job.by] ?? 'Member';
  let read: Awaited<ReturnType<typeof readMerge>>;
  try { read = await readMerge(deps, t.thread, space); }
  catch (e) {
    const m = (e as Error)?.message ?? '';
    console.error('github_merge_failed', job.thread, m.slice(0, 200));
    await line(`Merging ${ref} failed: ${m === NOT_INSTALLED ? `the briefling GitHub App is not installed on ${job.repo.split('/')[0]}` : /^github_403/.test(m) ? NO_PERMISSION : 'GitHub could not be read'}. Not retried: try again from the thread.`);
    await tell(ghError(m));
    return 'failed';
  }
  const { info, pull } = read;
  if (!info.pr || info.pr.repo !== job.repo || info.pr.number !== job.number) return refuse('it is no longer the issue\'s only open pull request', info);
  if (info.blocked) return refuse(BLOCK_TEXT[info.blocked], info);
  const moved = (now: string) => refuse(`a commit was pushed after you looked (head now \`${now.slice(0, 7)}\`). Check it, then merge again`, info);
  if (info.pr.sha !== job.sha) return moved(info.pr.sha);
  try { await deps.gh.merge(job.repo, job.number, job.sha, `${pull!.title} (#${job.number})`); }
  catch (e) {
    const m = (e as Error)?.message ?? '';
    console.error('github_merge_failed', job.thread, m.slice(0, 200));
    if (m === MERGE_MOVED) return moved((await deps.gh.pull(job.repo, job.number).catch(() => pull!)).sha);
    if (m === MERGE_REFUSED) return refuse('GitHub refused it (not mergeable)', info);
    await line(`Merging ${ref} failed: ${/^github_403/.test(m) ? NO_PERMISSION : 'GitHub error'}. Not retried: try again from the thread.`);
    await tell(ghError(m));
    return 'failed';
  }
  // Head branch: only a branch of the same repo, never its default branch (a fork's branch is not ours to delete).
  let branch = '';
  if (pull!.headRepo === job.repo && pull!.headRef && pull!.headRef !== pull!.defaultBranch) {
    try { await deps.gh.deleteBranch(job.repo, pull!.headRef); branch = ` and deleted the branch \`${pull!.headRef}\``; }
    catch (e) { console.error('github_branch_delete_failed', job.thread, (e as Error)?.message?.slice(0, 200)); branch = `; the branch \`${pull!.headRef}\` could not be deleted (GitHub error)`; }
  }
  await line(`${name} merged ${ref} (squash, \`${job.sha.slice(0, 7)}\`)${branch}.`);
  await logEvent(deps, t0, { at: deps.now(), kind: 'merge', by: job.by, repo: job.repo, number: job.number, sha: job.sha });
  await show({ ...info, blocked: 'merged' });
  // GitHub closes the issue and moves it on the Project a few seconds after the merge: read the board now rather than
  // at the next 5-min poll, so the thread leaves « To merge » at once. Twice at most; the schedule covers the rest.
  for (const ms of AFTER_MERGE_POLL_MS) {
    await (deps.sleep ?? (x => new Promise(r => setTimeout(r, x))))(ms);
    try { await pollSpace(deps, space.id); } catch (e) { console.error('github_poll_failed', space.id, (e as Error)?.message?.slice(0, 200)); break; }
    if ((await deps.store.getThread(t0.id))?.board?.state === 'CLOSED') break;
  }
  await wakeFlow(deps, space); // after the reads above: a wake sent before GitHub moved the issue would be wasted
  return 'done';
}

/** Failure visible in the thread (and reservation lifted so it can be retried by hand). */
export async function reportIssueFailure(deps: JobDeps, threadId: string, reason?: string) {
  const thread = await deps.store.getThread(threadId);
  if (!thread) return;
  await mutateThread(deps, thread.id, { type: 'noop' }, undefined, undefined, f => ({ ...f, issuePending: false }));
  const org = reason === NOT_INSTALLED ? (await deps.store.getSpace(thread.space))?.github?.owner ?? 'this organization' : '';
  const msg: Message = { id: deps.newId(), thread: thread.id, author: { kind: 'system', id: 'briefling' }, type: 'text', text: org
    ? `Creating the GitHub issue failed: the briefling GitHub App is not installed on ${org}.`
    : 'Creating the GitHub issue failed. You can try again.', at: deps.now() };
  await deps.store.upsertMessage(msg);
  await broadcast(deps, thread.space, { v: 2, type: 'event', event: 'message.created', data: msg });
}
