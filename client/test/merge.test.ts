import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canMerge, mergeStale, mergeView, type MergeEntry } from '../src/merge.ts';

const th = { kind: 'thread' as const, issue: { repo: 'uplift/loom', number: 1, url: 'https://github.com/uplift/loom/issues/1' },
  board: { node: 'I1', column: 'To merge', labels: [], state: 'OPEN' as const, vetting: false, sig: 's1' } };
const pr = { repo: 'uplift/lab', number: 6, title: 'PR', url: 'https://github.com/uplift/lab/pull/6', sha: 'a'.repeat(40) };
const entry = (over: Partial<MergeEntry>): MergeEntry => ({ cid: 'c', sig: 'x', info: null, err: '', busy: false, confirm: false, ...over });

test('merge: the button is for a trusted human, on an OPEN issue in « To merge » of a board-driven space', () => {
  assert.equal(canMerge(th, true, true), true);
  assert.equal(canMerge({ ...th, board: { ...th.board, column: 'to merge' } }, true, true), true);
  assert.equal(canMerge(th, true, false), false);
  assert.equal(canMerge(th, false, true), false);
  assert.equal(canMerge({ ...th, board: { ...th.board, column: 'In review' } }, true, true), false);
  assert.equal(canMerge({ ...th, board: { ...th.board, state: 'CLOSED' } }, true, true), false);
  assert.equal(canMerge({ ...th, board: { ...th.board, column: null } }, true, true), false);
  // the flow config's approved column replaces « To merge »
  assert.equal(canMerge({ ...th, board: { ...th.board, column: 'ship IT' } }, true, true, 'Ship it'), true);
  assert.equal(canMerge(th, true, true, 'Ship it'), false);
});

test('merge: asked again when the board moved; shows nothing without exactly one PR, a reason when blocked, retry when it may change by itself', () => {
  assert.equal(mergeStale(undefined, 'a'), true);
  assert.equal(mergeStale(entry({ sig: 'a' }), 'a'), false);
  assert.equal(mergeStale(entry({ sig: 'a' }), 'b'), true);
  assert.deepEqual(mergeView(undefined), { kind: 'checking' });
  assert.deepEqual(mergeView(entry({})), { kind: 'checking' });
  assert.deepEqual(mergeView(entry({ err: 'GitHub did not answer.' })), { kind: 'error', err: 'GitHub did not answer.' });
  assert.deepEqual(mergeView(entry({ info: { pr: null, prs: 0, blocked: null } })), { kind: 'none' });
  assert.deepEqual(mergeView(entry({ info: { pr: null, prs: 2, blocked: null } })), { kind: 'none' });
  assert.deepEqual(mergeView(entry({ info: { pr, prs: 1, blocked: null } })), { kind: 'ready', pr, blocked: null, retry: false });
  assert.deepEqual(mergeView(entry({ info: { pr, prs: 1, blocked: 'conflict' } })), { kind: 'blocked', pr, blocked: 'conflict', retry: false });
  assert.deepEqual(['checks', 'unknown', 'merged'].map(b => (mergeView(entry({ info: { pr, prs: 1, blocked: b as any } })) as any).retry), [true, true, false]);
});
