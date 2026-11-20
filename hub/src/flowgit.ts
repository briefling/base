// Flow config with a git source (docs/design-flow.md § 4.2): the GitHub Lambda side. A save = one normal commit on the
// branch's current head with only the files the save changes; refused only when one of those files changed in the
// repo since the editor read the head. The agents get the bundle files read at the branch head (cached in FLOWGIT, read
// again at each 5-min poll when the head moved), so a commit made outside briefling reaches them too.
import { visibleAgents } from '../../protocol/memory.ts';
import { createHash } from 'node:crypto';
import { validateFlow } from '../../protocol/flowcfg.ts';
import { BUNDLE_PATH_RE, MAX_BUNDLE_FILES, bundleFiles, bundleIssues, repoPath, sameSource, sourceOk, validateTeam, type FlowSource } from '../../protocol/flowteam.ts';
import type { FlowVersionMeta } from '../../protocol/frames.ts';
import { canAdmin, flowTarget, pushFlowConfig, reposOf, type Deps, type FlowGit, type GithubJob } from './router.ts';
import { NOT_INSTALLED, REF_MOVED, type GitHub } from './github.ts';

type JobDeps = Deps & { gh: GitHub };
const COMMIT_TRIES = 3;

/** git's blob id of a text: sha1 of `blob <bytes>\0<bytes>` (compared with the tree's ids, no blob read needed). */
export const gitBlobId = (text: string) => { const b = Buffer.from(text, 'utf8'); return createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex'); };

const ghCode = (m: string) => m === NOT_INSTALLED ? 'github_not_installed' : /^github_403/.test(m) ? 'github_permission' : /^github_404/.test(m) ? 'git_not_found' : 'github_failed';

/** Bundle files under the source's folder at `head` (closed list of paths only); a blob already cached is not read again. */
async function readBundle(gh: GitHub, src: FlowSource, head: string, cache: FlowGit | null): Promise<FlowGit['files']> {
  const t = await gh.commitTree(src.repo, head);
  const prefix = src.dir ? `${src.dir}/` : '';
  const known = new Map((cache?.files ?? []).map(f => [f.blob, f.text]));
  const files: FlowGit['files'] = [];
  for (const [p, blob] of [...t.blobs].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const rel = p.startsWith(prefix) ? p.slice(prefix.length) : '';
    if (!BUNDLE_PATH_RE.test(rel)) continue;
    if (files.length > MAX_BUNDLE_FILES) break; // bundleIssues reports too_big
    files.push({ path: rel, blob, text: known.get(blob) ?? await gh.blobText(src.repo, blob) });
  }
  return files;
}

/**
 * Reads the branch head of the space's git source; when it moved since the cached read (or `force`), reads the bundle,
 * caches it and pushes it to the flow agents. Briefling source (or none): nothing.
 */
export async function refreshFlowGit(deps: JobDeps, spaceId: string): Promise<{ state: 'none' | 'same' | 'pushed' | 'refused'; head?: string; error?: string }> {
  const space = await deps.store.getSpace(spaceId);
  const v = space && await deps.store.getFlowVersion(spaceId, null);
  if (!space || !v?.source) return { state: 'none' };
  const src = v.source;
  const cache = await deps.store.getFlowGit(spaceId);
  const same = cache && sameSource(cache.source, src) ? cache : null;
  const head = await deps.gh.branchHead(src.repo, src.branch);
  if (same && same.head === head) return { state: 'same', head, ...(same.error ? { error: same.error } : {}) };
  const files = await readBundle(deps.gh, src, head, same);
  const bad = bundleIssues(files.map(({ path, text }) => ({ path, text })));
  const error = bad.length ? bad.map(x => `${x.code}${x.path ? ` ${x.path}` : ''}`).join(', ').slice(0, 300)
    : files.some(f => f.path === 'config.yml') ? undefined : `no config.yml in ${src.dir || 'the repo root'}`;
  await deps.store.putFlowGit(spaceId, { head, source: src, files, at: deps.now(), ...(error ? { error } : {}) });
  if (error) { console.error('flow_git_refused', spaceId, head.slice(0, 7), error); return { state: 'refused', head, error }; }
  await pushFlowConfig(deps, space);
  return { state: 'pushed', head };
}

/** Editor opened on a git source: the branch head read again, answered to the editor (the base of its next save). */
export async function flowGitRead(deps: JobDeps, job: Extract<GithubJob, { kind: 'flowgit' }>): Promise<string> {
  const send = (head: string | null, error?: string) => deps.sender.send(job.conn, { v: 2, type: 'flowcfg.git', client_id: job.client_id, space: job.space, head, ...(error ? { error } : {}) });
  if (!(await canAdmin(deps, job.by, job.space))) { await send(null, 'forbidden'); return 'forbidden'; }
  try {
    // Another source picked in the editor (not saved yet): only its head, for the first save there.
    const latest = job.source ? await deps.store.getFlowVersion(job.space, null) : null;
    if (job.source && !sameSource(latest?.source, job.source)) {
      const space = await deps.store.getSpace(job.space);
      if (!space || !sourceOk(job.source, reposOf(space))) { await send(null, 'bad_source'); return 'bad_source'; }
      const head = await deps.gh.branchHead(job.source.repo, job.source.branch);
      await send(head);
      return 'head';
    }
    const r = await refreshFlowGit(deps, job.space);
    await send(r.head ?? null, r.error);
    return r.state;
  } catch (e) {
    const m = (e as Error)?.message ?? '';
    console.error('flow_git_read_failed', job.space, m.slice(0, 200));
    await send(null, ghCode(m));
    return 'failed';
  }
}

/**
 * Save on a git source. Everything is checked again (the queue is no proof). Changed files = the ones whose text differs
 * from the editor's base `head`, plus the files the previous version wrote there and this one no longer has (deleted);
 * nothing else in the repo is touched. One of them changed between `head` and the current head: refused
 * (`changed_meanwhile`, the files and the last commit). Else one commit on the current head, retried if the branch moves
 * meanwhile (for other files), then the version is stored and the agents get the new head.
 */
export async function flowCommit(deps: JobDeps, job: Extract<GithubJob, { kind: 'flowcommit' }>): Promise<string> {
  const fail = async (code: string, detail?: string) => { await deps.sender.send(job.conn, { v: 2, type: 'error', code, ref: job.client_id, ...(detail ? { detail } : {}) }); return code; };
  const space = await deps.store.getSpace(job.space);
  if (!space || space.archived || !(await canAdmin(deps, job.by, space))) return fail('forbidden');
  const src = job.source;
  if (!sourceOk(src, reposOf(space)) || !src || src.readonly) return fail('bad_source'); // read-only: never written
  if (validateFlow(job.def).length || validateTeam(job.team, job.def, visibleAgents(space)).length) return fail('bad_flow');
  const files = bundleFiles(job.def, job.team, flowTarget(space));
  if (bundleIssues(files).length) return fail('bad_flow');
  const latest = await deps.store.getFlowVersion(space.id, null);
  if ((latest?.version ?? 0) !== job.base) return fail('stale');
  const P = (p: string) => repoPath(src, p);
  const gone = latest && sameSource(latest.source, src)
    ? bundleFiles(latest.def, latest.team, flowTarget(space)).map(f => f.path).filter(p => !files.some(f => f.path === p)) : [];
  let commit = '';
  try {
    const base = await deps.gh.commitTree(src.repo, job.head);
    const changes = [
      ...files.filter(f => base.blobs.get(P(f.path)) !== gitBlobId(f.text)).map(f => ({ path: P(f.path), text: f.text as string | null })),
      ...gone.filter(p => base.blobs.has(P(p))).map(p => ({ path: P(p), text: null as string | null })),
    ];
    for (let attempt = 1; ; attempt++) {
      const cur = await deps.gh.branchHead(src.repo, src.branch);
      const now = cur === job.head ? base : await deps.gh.commitTree(src.repo, cur);
      const moved = changes.filter(c => base.blobs.get(c.path) !== now.blobs.get(c.path));
      if (moved.length) {
        const last = await deps.gh.lastCommit(src.repo, src.branch, moved[0].path).catch(() => null);
        return fail('changed_meanwhile', `${moved.map(c => c.path).join(', ')}${last ? ` (${last.sha.slice(0, 7)}, ${last.author})` : ''}`);
      }
      if (!changes.length) { commit = cur; break; }
      const name = space.names?.[job.by] ?? 'an admin';
      const what = changes.length === 1 ? changes[0].path : `${changes.length} files`;
      const message = `Edit ${what} (${name}, from briefling)\n\n${changes.map(c => `- ${c.text === null ? 'delete' : 'write'} ${c.path}`).join('\n')}\n`;
      try { commit = await deps.gh.commitFiles(src.repo, src.branch, cur, now.tree, changes, message); break; }
      catch (e) { if ((e as Error)?.message !== REF_MOVED || attempt >= COMMIT_TRIES) throw e; }
    }
  } catch (e) {
    const m = (e as Error)?.message ?? '';
    console.error('flow_commit_failed', job.space, m.slice(0, 200));
    return fail(m === REF_MOVED ? 'stale' : ghCode(m));
  }
  const json = JSON.stringify({ def: job.def, team: job.team });
  const meta: FlowVersionMeta = { version: job.base + 1, by: job.by, at: deps.now(), sha: createHash('sha256').update(json).digest('hex'), commit };
  // Lost a race with another admin's save: the commit stays in the repo (the agents get it at the next head read).
  if (!(await deps.store.putFlowVersion(space.id, { ...meta, ...JSON.parse(json), source: src }))) return fail('stale');
  await deps.sender.send(job.conn, { v: 2, type: 'flowcfg.saved', client_id: job.client_id, space: space.id, version: meta });
  try { await refreshFlowGit(deps, space.id); }
  catch (e) { console.error('flow_git_read_failed', job.space, (e as Error)?.message?.slice(0, 200)); }
  return 'done';
}
