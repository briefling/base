// « Import from repo » of the Memory view (docs/project-status.md « Project memory »): an admin brings a repo's memory
// files (unstrikeable format, protocol/memory.ts memoryFileIn) into the space's memory once. product decision: trusted
// content, published at once with gate `manual` (the admin's click is the human act), traced in `imported`.
// Idempotent: the entry id derives from the repo and the path, written only if absent, so a second click adds only the
// new files and never overwrites (nor restores) an entry already imported. All or nothing on the 300 live entries.
import { createHash } from 'node:crypto';
import { MEMORY_IMPORT_FILES_MAX, MEMORY_IMPORT_RE, MEMORY_LIVE_MAX, memoryFileIn, type MemoryEntry, type MemoryFileError } from '../../protocol/memory.ts';
import type { HubFrame } from '../../protocol/frames.ts';
import { broadcast, canAdmin, reposOf, type Deps, type GithubJob } from './router.ts';
import { NOT_INSTALLED, type GitHub } from './github.ts';

type JobDeps = Deps & { gh: GitHub };
type Job = Extract<GithubJob, { kind: 'memimport' }>;
const READS_AT_ONCE = 8;

/** Stable id of the entry imported from `path` of `repo` (the repo's case ignored, as GitHub does). */
export const importId = (repo: string, path: string) => `imp-${createHash('sha256').update(`${repo.toLowerCase()}:${path}`).digest('hex').slice(0, 40)}`;

const ghCode = (m: string) => m === NOT_INSTALLED ? 'github_not_installed' : /^github_403/.test(m) ? 'github_permission'
  : /^github_404/.test(m) ? 'git_not_found' : m === 'github_tree_truncated' ? 'too_many' : 'github_failed';

export async function memoryImport(deps: JobDeps, job: Job): Promise<{ result: string; added?: number; existing?: number; failed?: number }> {
  const answer = (x: Partial<Extract<HubFrame, { type: 'memory.imported' }>>) => deps.sender.send(job.conn,
    { v: 2, type: 'memory.imported', client_id: job.client_id, space: job.space, repo: job.repo, added: 0, existing: 0, failed: [], ...x });
  // The rights again: the frame was checked by the WebSocket Lambda, but they may have changed since it was queued.
  const space = await deps.store.getSpace(job.space);
  const repo = space && reposOf(space).find(r => r.toLowerCase() === job.repo.toLowerCase());
  if (!space || !space.members.includes(job.by) || !(await canAdmin(deps, job.by, space)) || !repo) { await answer({ error: 'forbidden' }); return { result: 'forbidden' }; }
  let sha: string, paths: string[], blobs: Map<string, string>;
  try {
    sha = await deps.gh.branchHead(repo, await deps.gh.defaultBranch(repo));
    blobs = (await deps.gh.commitTree(repo, sha)).blobs;
    paths = [...blobs.keys()].filter(p => MEMORY_IMPORT_RE.test(p)).sort();
  } catch (e) {
    const code = ghCode((e as Error)?.message ?? '');
    console.error('memimport_read_failed', job.space, repo, (e as Error)?.message?.slice(0, 200));
    await answer({ error: code }); return { result: code };
  }
  if (paths.length > MEMORY_IMPORT_FILES_MAX) { await answer({ sha, error: 'too_many' }); return { result: 'too_many' }; }
  const entries = await deps.store.listMemory(space.id);
  const known = new Set(entries.map(e => e.id));
  const fresh = paths.filter(p => !known.has(importId(repo, p)));
  const existing = paths.length - fresh.length;
  // Read only the new files, a few at a time (GitHub's secondary rate limits).
  const parsed: { path: string; r: ReturnType<typeof memoryFileIn> }[] = [];
  try {
    for (let i = 0; i < fresh.length; i += READS_AT_ONCE) {
      const part = fresh.slice(i, i + READS_AT_ONCE);
      const texts = await Promise.all(part.map(p => deps.gh.blobText(repo, blobs.get(p)!)));
      part.forEach((path, k) => parsed.push({ path, r: memoryFileIn(repo, path, texts[k]) }));
    }
  } catch (e) {
    const code = ghCode((e as Error)?.message ?? '');
    console.error('memimport_blob_failed', job.space, repo, (e as Error)?.message?.slice(0, 200));
    await answer({ sha, error: code }); return { result: code };
  }
  const failed: { path: string; why: MemoryFileError }[] = [];
  const ok: { path: string; f: Exclude<ReturnType<typeof memoryFileIn>, { error: MemoryFileError }> }[] = [];
  for (const { path, r } of parsed) { if ('error' in r) failed.push({ path, why: r.error }); else ok.push({ path, f: r }); }
  // All or nothing: half a memory imported is worse than a clear refusal (archive entries or compact, then retry).
  const live = entries.filter(e => e.status === 'published' || e.status === 'pending').length;
  if (live + ok.length > MEMORY_LIVE_MAX) {
    await answer({ sha, existing, failed, error: 'memory_full', live, wanted: ok.length });
    return { result: 'memory_full', existing, failed: failed.length };
  }
  const now = deps.now();
  let added = 0, raced = 0;
  for (const { path, f } of ok) {
    const e: MemoryEntry = { id: importId(repo, path), space: space.id, text: f.text, kind: 'rule', sources: f.sources, author: f.author,
      thread: '', by: job.by, at: f.at ?? now, status: 'published', gate: 'manual', imported: { by: job.by, at: now, repo, sha }, version: 1 };
    if (await deps.store.putMemory(e, null)) { added++; await broadcast(deps, space.id, { v: 2, type: 'event', event: 'memory.updated', data: e }); }
    else raced++; // written by a concurrent click in between: already there
  }
  console.log('memimport', space.id, `${repo}@${sha.slice(0, 7)}`, JSON.stringify({ added, existing: existing + raced, failed: failed.map(x => `${x.why} ${x.path}`) }));
  await answer({ sha, added, existing: existing + raced, failed });
  return { result: 'imported', added, existing: existing + raced, failed: failed.length };
}
