import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedOf, foldRuns, techRow } from '../src/tech.ts';
import { timelineRows } from '../src/details.ts';
import type { ThreadDetails } from '../../protocol/frames.ts';

test('tech fold: runs of consecutive technical rows are grouped, the others stay one by one and in order', () => {
  const isT = (x: string) => x.startsWith('t');
  assert.deepEqual(foldRuns([], isT), []);
  assert.deepEqual(foldRuns(['a', 't1', 't2', 'b', 't3'], isT),
    [{ tech: false, row: 'a' }, { tech: true, rows: ['t1', 't2'] }, { tech: false, row: 'b' }, { tech: true, rows: ['t3'] }]);
  assert.deepEqual(foldRuns(['t1'], isT), [{ tech: true, rows: ['t1'] }]);
});

test('tech fold: pushes, CI, merges, locks and refused calls are technical timeline rows; turns, outcomes and the opening are not', () => {
  const sha = 'a'.repeat(40);
  const d: ThreadDetails = { thread: 't', opened: { at: 0 }, files: [], more: false, events: [
    { at: 1, kind: 'turn', phase: 'start', agent: 'g' }, { at: 2, kind: 'push', agent: 'g', repo: 'o/a', sha, branch: 'b' },
    { at: 3, kind: 'push', agent: 'g', repo: 'o/a', sha }, { at: 4, kind: 'ci', repo: 'o/a', sha, verdict: 'green' },
    { at: 5, kind: 'resource', op: 'acquired', resource: 'stack:x' }, { at: 6, kind: 'merge', repo: 'o/a', number: 3, sha, by: 'b' },
    { at: 7, kind: 'refused', agent: 'g', frame: 'x', code: 'y' }, { at: 8, kind: 'turn', phase: 'end', agent: 'g' },
    { at: 9, kind: 'outcome', agent: 'g', outcome: 'done' }] } as ThreadDetails;
  assert.deepEqual(timelineRows(d).map(r => [r.key, techRow(r.key)]), [['det_opened', false], ['det_turn', false], ['det_push_branch', true],
    ['det_push', true], ['det_ci', true], ['det_res_acquired', true], ['det_merge', true], ['det_refused', true], ['det_done', false]]);
});

test('tech fold: the feed of a non-technical reader holds the tool phrases, else the current one alone, else nothing', () => {
  assert.deepEqual(feedOf(['a', 'b'], 'b'), ['a', 'b']);
  assert.deepEqual(feedOf(undefined, 'Running npm test'), ['Running npm test']);
  assert.deepEqual(feedOf([], null), []);
});
