// Thread info panel (« Thread info », `details.get`): code, assets and timeline of one thread, built from what the hub
// sends (ThreadDetails, then the PRs read on GitHub). DOM-free so node can test it (client/test/details.test.ts).
import type { CiPill, CiVerdict, PrError, PrState, ThreadDetails, ThreadEvent } from '../../protocol/frames.ts';
import type { Key } from './i18n.ts';

export interface CommitRow { repo: string; sha: string; branch?: string; at: number; verdict?: CiVerdict }
/** One repo the agent pushed to: its last branch, its commits (newest first), the PRs found and why none could be read. */
export interface RepoBlock { repo: string; branch?: string; commits: CommitRow[]; prs: PrState[]; error?: PrError['code']; followed: boolean }
export interface Prs { prs: PrState[]; errors: PrError[] }

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Code section: repos by latest push first. A commit's CI = its last verdict event, or the thread's pill for that sha
 *  (running, or a verdict newer than the panel's read). */
export function codeBlocks(d: ThreadDetails, pills: readonly CiPill[] | undefined, prs: Prs | null): RepoBlock[] {
  const verdict = new Map<string, CiVerdict>();
  for (const e of d.events) if (e.kind === 'ci') verdict.set(`${e.repo.toLowerCase()}@${e.sha}`, e.verdict);
  for (const p of pills ?? []) verdict.set(`${p.repo.toLowerCase()}@${p.sha}`, p.verdict);
  const blocks: RepoBlock[] = [];
  const pushes = d.events.filter((e): e is Extract<ThreadEvent, { kind: 'push' }> => e.kind === 'push').sort((a, b) => b.at - a.at);
  for (const e of pushes) {
    let b = blocks.find(x => same(x.repo, e.repo));
    if (!b) {
      blocks.push(b = { repo: e.repo, ...(e.branch ? { branch: e.branch } : {}), commits: [], prs: (prs?.prs ?? []).filter(p => same(p.repo, e.repo)),
        followed: !d.followed || d.followed.some(r => same(r, e.repo)) });
      const err = prs?.errors.find(x => same(x.repo, e.repo));
      if (err) b.error = err.code;
    }
    if (b.commits.some(c => c.sha === e.sha)) continue; // declared twice: shown once, at its latest push
    const v = verdict.get(`${e.repo.toLowerCase()}@${e.sha}`);
    b.commits.push({ repo: e.repo, sha: e.sha, ...(e.branch ? { branch: e.branch } : {}), at: e.at, ...(v ? { verdict: v } : {}) });
  }
  return blocks;
}

export type Tone = 'calm' | 'run' | 'wait' | 'you' | 'done' | 'red';
/** A timeline line: translated by the caller (`key` + `vars`); `who` = a person id the caller turns into a name. */
export interface TimelineRow { at: number; tone: Tone; key: Key; vars: Record<string, string>; who?: string; end?: number }

const short = (repo: string) => repo.split('/')[1] ?? repo;
const ref = (repo: string, sha: string) => `${short(repo)}@${sha.slice(0, 7)}`;
const ciTone = (v: CiVerdict): Tone => v === 'green' ? 'done' : v === 'red' ? 'red' : v === 'running' ? 'run' : 'calm';

/**
 * Timeline, oldest first. A turn start and its end make ONE line (start time, `end` for the duration); a start with no
 * end yet is the running turn. The opening comes first when known.
 */
export function timelineRows(d: ThreadDetails): TimelineRow[] {
  const rows: TimelineRow[] = [];
  if (d.opened) rows.push(d.opened.from ? { at: d.opened.at, tone: 'calm', key: 'det_opened_from', vars: { title: d.opened.from.title } }
    : { at: d.opened.at, tone: 'calm', key: 'det_opened', vars: {} });
  const open = new Map<string, TimelineRow>(); // agent -> its turn line still without an end
  for (const e of d.events.slice().sort((a, b) => a.at - b.at)) {
    switch (e.kind) {
      case 'turn': {
        if (e.phase === 'start') { const r: TimelineRow = { at: e.at, tone: 'run', key: 'det_turn_running', vars: {}, who: e.agent }; open.set(e.agent, r); rows.push(r); break; }
        const r = open.get(e.agent);
        open.delete(e.agent);
        if (r) Object.assign(r, { tone: 'calm', key: e.stopped ? 'det_turn_stopped' : 'det_turn', end: e.at });
        else rows.push({ at: e.at, tone: 'calm', key: e.stopped ? 'det_turn_end_stopped' : 'det_turn_end', vars: {}, who: e.agent }); // start before the feature
        break;
      }
      case 'outcome':
        rows.push(e.outcome === 'waiting' ? { at: e.at, tone: 'you', key: 'det_waiting', vars: { action: e.action ?? '' }, who: e.agent }
          : { at: e.at, tone: 'done', key: 'det_done', vars: {}, who: e.agent });
        break;
      case 'resource':
        rows.push({ at: e.at, tone: e.op === 'queued' ? 'wait' : 'calm', key: e.op === 'acquired' ? 'det_res_acquired' : e.op === 'queued' ? 'det_res_queued' : 'det_res_released', vars: { resource: e.resource } });
        break;
      case 'push':
        rows.push({ at: e.at, tone: 'calm', key: e.branch ? 'det_push_branch' : 'det_push', vars: { ref: ref(e.repo, e.sha), branch: e.branch ?? '' }, who: e.agent });
        break;
      case 'ci':
        rows.push({ at: e.at, tone: ciTone(e.verdict), key: 'det_ci', vars: { verdict: e.verdict, ref: ref(e.repo, e.sha) } });
        break;
      case 'merge':
        rows.push({ at: e.at, tone: 'done', key: 'det_merge', vars: { ref: `${short(e.repo)}#${e.number}`, sha: e.sha.slice(0, 7) }, who: e.by });
        break;
      case 'refused': // a tool call the hub turned down (frame type and error code: protocol words, not translated)
        rows.push({ at: e.at, tone: 'red', key: 'det_refused', vars: { frame: e.frame, code: e.code }, who: e.agent });
        break;
      case 'relay': // woken by another agent's mention (hub/src/relay.ts)
        rows.push({ at: e.at, tone: 'calm', key: 'det_relay', vars: { by: e.by.charAt(0).toUpperCase() + e.by.slice(1) }, who: e.agent });
        break;
    }
  }
  return rows;
}

/** « 12 min », « 1 h 05 », « 40 s »: length of a finished turn. */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}
