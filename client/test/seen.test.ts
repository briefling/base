import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeMarks, syncMarks, markRead, type Marks } from '../src/seen.ts';

const th = (id: string, updatedAt: number) => ({ id, updatedAt });

test('mergeMarks: max of local and hub, never backwards', () => {
  const l: Marks = { a: 10, b: 50 };
  assert.equal(mergeMarks(l, [{ thread: 'a', at: 20 }, { thread: 'b', at: 40 }, { thread: 'c', at: 5 }]), true);
  assert.deepEqual(l, { a: 20, b: 50, c: 5 });
  assert.equal(mergeMarks(l, [{ thread: 'a', at: 20 }]), false);
});

test('syncMarks: read on the other device = read here; local marks the hub lacks are sent', () => {
  const l: Marks = { a: 10, b: 50 };
  const r = syncMarks(l, [{ thread: 'a', at: 30 }, { thread: 'b', at: 40 }], [th('a', 30), th('b', 60), th('c', 70)], false);
  assert.deepEqual(l, { a: 30, b: 50 }, 'a read elsewhere; c never read: stays unread (not first run)');
  assert.equal(r.changed, true);
  assert.deepEqual(r.upload, [[{ thread: 'b', at: 50 }]], 'only what the hub has older or lacks');
});

test('syncMarks first connection after the deploy: every local mark goes up, in frames of 100', () => {
  const l: Marks = Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`t${i}`, i + 1]));
  const r = syncMarks(l, [], Array.from({ length: 150 }, (_, i) => th(`t${i}`, 1000)), false);
  assert.equal(r.changed, false);
  assert.deepEqual(r.upload.map(x => x.length), [100, 50]);
  assert.deepEqual(r.upload[1][0], { thread: 't100', at: 101 });
});

test('syncMarks new device: hub marks apply, threads with no mark anywhere count as read', () => {
  const l: Marks = {};
  const r = syncMarks(l, [{ thread: 'a', at: 10 }], [th('a', 20), th('b', 30)], true);
  assert.deepEqual(l, { a: 10, b: 30 }, 'a moved since read on the other device: unread; b: read');
  assert.deepEqual(r.upload, [[{ thread: 'b', at: 30 }]], 'the baseline is shared too');
  assert.deepEqual(syncMarks({}, [], [], true), { changed: false, upload: [] });
});

test('markRead: one mark per move', () => {
  const l: Marks = { a: 10 };
  assert.equal(markRead(l, th('a', 10)), null);
  assert.deepEqual(markRead(l, th('a', 12)), { thread: 'a', at: 12 });
  assert.equal(l.a, 12);
  assert.equal(markRead({ a: 20 }, th('a', 12)), null, 'a newer mark from the other device is kept');
});
