import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loungeLayout, threadView } from '../src/split.ts';

const lounge = { kind: 'lounge', id: 's' };
const wide = { narrow: false };

test('Lounge layout: the feed alone without a selection, feed + side pane with one, nothing elsewhere', () => {
  assert.equal(loungeLayout(lounge, null), 'lounge-full');
  assert.equal(loungeLayout(lounge, 'tp'), 'lounge-split');
  assert.equal(loungeLayout(lounge, 'new'), 'lounge-split', 'the new-topic composer opens in the side pane too');
  assert.equal(loungeLayout({ kind: 'space', id: 's' }, 'a'), '');
  assert.equal(loungeLayout({ kind: 'now' }, null), '');
});

test('a thread clicked in the Lounge of its space opens in the side pane: the Lounge stays', () => {
  assert.deepEqual(threadView(lounge, 's', wide), { kind: 'lounge', id: 's' });
});

test('elsewhere the thread opens in its space list, as before', () => {
  for (const v of [{ kind: 'space', id: 's' }, { kind: 'now' }, { kind: 'later', id: 's' }, { kind: 'closed', id: 's' }, { kind: 'lounge', id: 'other' }])
    assert.deepEqual(threadView(v, 's', wide), { kind: 'space', id: 's' }, JSON.stringify(v));
});

test('phone and notifications keep the space list', () => {
  assert.deepEqual(threadView(lounge, 's', { narrow: true }), { kind: 'space', id: 's' }, 'phone unchanged');
  assert.deepEqual(threadView(lounge, 's', { narrow: false, list: true }), { kind: 'space', id: 's' }, 'notification');
});
