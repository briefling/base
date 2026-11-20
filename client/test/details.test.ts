import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeBlocks, duration, timelineRows } from '../src/details.ts';
import type { ThreadDetails, ThreadEvent } from '../../protocol/frames.ts';

const A = 'a'.repeat(40), B = 'b'.repeat(40), C = 'c'.repeat(40);
const det = (events: ThreadEvent[], opened: ThreadDetails['opened'] = null): ThreadDetails => ({ thread: 't', opened, files: [], events, more: false });

test('details code: repos by latest push, last branch, commits newest first and once, CI from events then pills, PRs and errors per repo', () => {
  const d = det([
    { at: 1, kind: 'push', agent: 'g', repo: 'o/api', sha: A, branch: 'feat/a' },
    { at: 2, kind: 'push', agent: 'g', repo: 'o/web', sha: B },
    { at: 3, kind: 'ci', repo: 'o/api', sha: A, verdict: 'red' },
    { at: 4, kind: 'push', agent: 'g', repo: 'O/API', sha: C, branch: 'feat/b' },
    { at: 5, kind: 'push', agent: 'g', repo: 'o/web', sha: B }, // declared twice
  ]);
  const prs = { prs: [{ repo: 'o/api', number: 3, title: 'B', url: 'https://github.com/o/api/pull/3', state: 'merged' as const, draft: false }],
    errors: [{ repo: 'o/web', code: 'no_permission' as const }] };
  const b = codeBlocks(d, [{ repo: 'o/api', sha: C, verdict: 'running', at: 4, n: 0, failed: 0 }], prs);
  assert.deepEqual(b.map(x => [x.repo, x.branch, x.commits.map(c => [c.sha[0], c.verdict ?? '-']), x.prs.map(p => p.number), x.error ?? '']),
    [['o/web', undefined, [['b', '-']], [], 'no_permission'], ['O/API', 'feat/b', [['c', 'running'], ['a', 'red']], [3], '']]);
  assert.deepEqual(codeBlocks(det([]), undefined, null), []);
  assert.deepEqual(codeBlocks(d, undefined, null).map(x => x.prs.length + (x.error ? 1 : 0)), [0, 0], 'PRs not read yet');
  assert.deepEqual(b.map(x => x.followed), [true, true], 'older hub (no followed): every repo looked up');
  assert.deepEqual(codeBlocks({ ...d, followed: ['O/api'] }, undefined, null).map(x => [x.repo, x.followed]), [['o/web', false], ['O/API', true]],
    'a repo not attached (not followed) gets no PR line');
});

test('details timeline: opening first, a turn start and end on one line, running turn, outcome, resources, CI, merge', () => {
  const rows = timelineRows(det([
    { at: 10, kind: 'turn', agent: 'milan', phase: 'start' },
    { at: 12, kind: 'resource', resource: 'stack:dev', op: 'acquired' },
    { at: 13, kind: 'push', agent: 'milan', repo: 'o/api', sha: A, branch: 'main' },
    { at: 14, kind: 'outcome', agent: 'milan', outcome: 'waiting', action: 'look at it' },
    { at: 15, kind: 'turn', agent: 'milan', phase: 'end' },
    { at: 15, kind: 'resource', resource: 'stack:dev', op: 'released' },
    { at: 20, kind: 'ci', repo: 'o/api', sha: A, verdict: 'green' },
    { at: 30, kind: 'merge', by: 'blair', repo: 'o/api', number: 7, sha: B },
    { at: 40, kind: 'turn', agent: 'milan', phase: 'start' },
    { at: 2, kind: 'turn', agent: 'gaston', phase: 'end', stopped: true }, // its start predates the feature
  ], { at: 1, from: { id: 'x', title: 'Idea' } }));
  assert.deepEqual(rows.map(r => [r.at, r.key, r.tone, r.who ?? '', r.end ?? 0]), [
    [1, 'det_opened_from', 'calm', '', 0], [2, 'det_turn_end_stopped', 'calm', 'gaston', 0], [10, 'det_turn', 'calm', 'milan', 15],
    [12, 'det_res_acquired', 'calm', '', 0], [13, 'det_push_branch', 'calm', 'milan', 0], [14, 'det_waiting', 'you', 'milan', 0],
    [15, 'det_res_released', 'calm', '', 0], [20, 'det_ci', 'done', '', 0], [30, 'det_merge', 'done', 'blair', 0], [40, 'det_turn_running', 'run', 'milan', 0]]);
  assert.deepEqual(rows[4].vars, { ref: 'api@aaaaaaa', branch: 'main' });
  assert.deepEqual(rows[8].vars, { ref: 'api#7', sha: 'bbbbbbb' });
  assert.deepEqual(timelineRows(det([{ at: 3, kind: 'turn', agent: 'g', phase: 'start' }, { at: 4, kind: 'turn', agent: 'g', phase: 'end', stopped: true }])).map(r => r.key), ['det_turn_stopped']);
  assert.deepEqual(timelineRows(det([], { at: 1 })).map(r => r.key), ['det_opened']);
  const [refused] = timelineRows(det([{ at: 5, kind: 'refused', agent: 'milan', frame: 'thread.outcome', code: 'no_text' }]));
  assert.deepEqual([refused.key, refused.tone, refused.who, refused.vars], ['det_refused', 'red', 'milan', { frame: 'thread.outcome', code: 'no_text' }]);
});

test('details: turn duration', () => {
  assert.deepEqual([duration(40_000), duration(12 * 60_000), duration(65 * 60_000), duration(-5)], ['40 s', '12 min', '1 h 05', '0 s']);
});
