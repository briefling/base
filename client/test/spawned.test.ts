import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dotMarks, familyIds, linkChip, markCount, rowMark, spawnedCounts, topicFamily, type RowMark } from '../src/spawned.ts';
import type { PublicThread, ThreadState } from '../../protocol/frames.ts';

const th = (id: string, state: ThreadState, extra: Partial<PublicThread> = {}) =>
  ({ id, space: 'e', title: id, owner: 'milan', state, updatedAt: 1, version: 1, ...extra }) as PublicThread;
const counts = (threads: PublicThread[], ids = threads.map(x => x.id), shownOf = (f: PublicThread) => f.state) => {
  const by = new Map(threads.map(x => [x.id, x]));
  return spawnedCounts(ids, id => by.get(id), shownOf);
};

test('spawned badges: one per state in display order, Waiting = wait + calm, Closed = done + archived', () => {
  assert.deepEqual(counts([th('a', 'done'), th('b', 'calm'), th('c', 'run'), th('d', 'wait'), th('e', 'you'), th('f', 'run', { archived: { by: 'b', at: 1 } }), th('g', 'calm')]),
    [{ bucket: 'run', n: 1 }, { bucket: 'you', n: 1 }, { bucket: 'wait', n: 3 }, { bucket: 'done', n: 2 }]);
});

test('spawned badges: a bucket at 0 is left out, Later has its own badge', () => {
  assert.deepEqual(counts([th('a', 'idea')]), [{ bucket: 'idea', n: 1 }]);
  assert.deepEqual(counts([]), []);
});

test('spawned badges: the displayed state decides (a queued Quiet thread shows Waiting)', () => {
  assert.deepEqual(counts([th('a', 'calm'), th('b', 'calm')], undefined, f => f.id === 'a' ? 'wait' : f.state), [{ bucket: 'wait', n: 2 }]);
  assert.deepEqual(counts([th('a', 'you')], undefined, () => 'run'), [{ bucket: 'run', n: 1 }]);
});

test('spawned badges: a Quiet thread the agent said done counts as done, like the Closed list (Your turn + waiting outcome does not)', () => {
  assert.deepEqual(counts([th('a', 'calm', { outcome: { kind: 'done', at: 1 } } as any), th('b', 'calm'), th('c', 'you', { outcome: { kind: 'waiting', at: 1, action: 'x' } } as any)]),
    [{ bucket: 'you', n: 1 }, { bucket: 'wait', n: 1 }, { bucket: 'done', n: 1 }]);
});

test('spawned badges: unknown ids are not counted, a duplicate id counts once', () => {
  assert.deepEqual(counts([th('a', 'run')], ['a', 'gone', 'a']), [{ bucket: 'run', n: 1 }]);
  assert.deepEqual(counts([], ['gone']), []);
});

const fam = (threads: PublicThread[], root: Partial<PublicThread> & { id: string }, max?: number) => {
  const by = new Map(threads.map(x => [x.id, x]));
  return topicFamily(root, id => by.get(id), max).map(r => `${r.f.id}@${r.depth}`);
};

test('topic family: a thread opened from a thread comes right under its parent, one level deeper', () => {
  const ts = [th('a', 'run', { spawned: ['a1', 'a2'] }), th('a1', 'done', { spawned: ['a11'] }), th('a11', 'you'), th('a2', 'wait'), th('b', 'idea')];
  assert.deepEqual(fam(ts, { id: 'topic', spawned: ['a', 'b'] }), ['a@1', 'a1@2', 'a11@3', 'a2@2', 'b@1']);
  const by = new Map(ts.map(x => [x.id, x]));
  assert.deepEqual(spawnedCounts(familyIds({ id: 'topic', spawned: ['a', 'b'] }, id => by.get(id)), id => by.get(id), f => f.state),
    [{ bucket: 'run', n: 1 }, { bucket: 'you', n: 1 }, { bucket: 'wait', n: 1 }, { bucket: 'idea', n: 1 }, { bucket: 'done', n: 1 }], 'counts cover the whole family');
});

test('topic family: a cycle or a thread listed twice is walked once, the topic itself never shows', () => {
  const ts = [th('a', 'run', { spawned: ['b', 'topic'] }), th('b', 'run', { spawned: ['a', 'b'] })];
  assert.deepEqual(fam(ts, { id: 'topic', spawned: ['a', 'b', 'a'] }), ['a@1', 'b@2']);
});

test('topic family: unknown ids are skipped with their descendants, depth is bounded, no spawned = empty', () => {
  const ts = [th('a', 'run', { spawned: ['gone'] }), th('d1', 'run', { spawned: ['d2'] }), th('d2', 'run', { spawned: ['d3'] }), th('d3', 'run')];
  assert.deepEqual(fam(ts, { id: 'topic', spawned: ['gone', 'a'] }), ['a@1']);
  assert.deepEqual(fam(ts, { id: 'topic', spawned: ['d1'] }, 2), ['d1@1', 'd2@2'], 'deeper than max is left out');
  assert.deepEqual(fam(ts, { id: 'topic' }), []);
});

test('topic card mark: done merges « ✓ done », Closed and archived', () => {
  assert.equal(rowMark(th('a', 'calm', { outcome: { kind: 'done' } } as Partial<PublicThread>), 'calm'), 'done');
  assert.equal(rowMark(th('a', 'done'), 'done'), 'done');
  assert.equal(rowMark(th('a', 'run', { archived: { by: 'b', at: 1 } }), 'run'), 'archived', 'archived gets its own mark, not Closed\'s ✓');
  assert.equal(rowMark(th('a', 'done', { archived: { by: 'b', at: 1 } }), 'done'), 'archived', 'archived wins over Closed');
});

test('topic card mark: run, you and wait follow the shown state, the rest is idle', () => {
  assert.equal(rowMark(th('a', 'run'), 'run'), 'run');
  assert.equal(rowMark(th('a', 'calm'), 'run'), 'run', 'work column or background work shows In progress');
  assert.equal(rowMark(th('a', 'you'), 'you'), 'you');
  assert.equal(rowMark(th('a', 'you'), 'wait'), 'wait', 'someone else\'s turn shows Waiting');
  assert.equal(rowMark(th('a', 'wait'), 'wait'), 'wait');
  assert.equal(rowMark(th('a', 'calm'), 'wait'), 'wait', 'a Quiet thread queued behind its agent shows Waiting, not Quiet');
  assert.equal(rowMark(th('a', 'calm'), 'calm'), 'idle');
  assert.equal(rowMark(th('a', 'idea'), 'idea'), 'later', 'Later gets its own mark (the clock), not Quiet\'s');
  assert.equal(rowMark(th('a', 'idea', { archived: { by: 'b', at: 1 } }), 'idea'), 'archived', 'archived wins over Later');
  // done outcome but queued (shown Waiting): not finished, same as the « ✓ done » chip
  assert.equal(rowMark(th('a', 'calm', { outcome: { kind: 'done' } } as Partial<PublicThread>), 'wait'), 'wait');
});

test('topic card counter: finished/total, none without threads', () => {
  assert.deepEqual(markCount(['done', 'run', 'you', 'done']), { done: 2, total: 4 });
  assert.deepEqual(markCount(['archived', 'run', 'done']), { done: 2, total: 3 }, 'an archived thread still counts finished');
  assert.deepEqual(dotMarks(['archived', 'done', 'run', 'you', 'idle']), [{ mark: 'done', n: 2 }, { mark: 'run' }, { mark: 'you' }, { mark: 'idle' }], 'archived folds into « ✓ n »');
  assert.equal(markCount([]), null);
});

test('topic bubble: from 5 marks the finished ones fold into one leading « ✓ n » mark', () => {
  const four: RowMark[] = ['done', 'run', 'done', 'you'];
  assert.deepEqual(dotMarks(four), four.map(mark => ({ mark })), 'under the threshold: one mark each, order kept');
  assert.deepEqual(dotMarks(['run', 'done', 'idle', 'done', 'you', 'done']),
    [{ mark: 'done', n: 3 }, { mark: 'run' }, { mark: 'idle' }, { mark: 'you' }], 'at 5+: done first with its number, others in order');
  assert.deepEqual(dotMarks(['done', 'run', 'done', 'you', 'idle'], 5)[0], { mark: 'done', n: 2 }, 'exactly at the threshold');
  const open: RowMark[] = ['run', 'you', 'idle', 'idle', 'run', 'you'];
  assert.deepEqual(dotMarks(open), open.map(mark => ({ mark })), 'nothing finished: nothing to fold');
  assert.deepEqual(dotMarks(Array(8).fill('done')), [{ mark: 'done', n: 8 }], 'all finished: a single mark');
  assert.deepEqual(dotMarks([]), []);
});

test('link card chip: « Archived » once archived whatever the state, else the state chip', () => {
  assert.equal(linkChip(th('a', 'calm', { archived: { by: 'b', at: 1 } })), 'archived');
  assert.equal(linkChip(th('a', 'run', { archived: { by: 'b', at: 1 } })), 'archived');
  assert.equal(linkChip(th('a', 'calm')), 'state');
  assert.equal(linkChip(th('a', 'done')), 'state');
});
