import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOUNDS, colVars, dragged, fitCols, gripsOf, parseCols } from '../src/panes.ts';

test('parse: invalid JSON, non-objects and arrays give no stored width', () => {
  for (const raw of [null, '', '{', 'null', '42', '"x"', '[240, 300]', 'true']) assert.deepEqual(parseCols(raw), {}, String(raw));
});

test('parse: unknown keys dropped, non-finite and non-number values rejected, a missing column stays absent', () => {
  assert.deepEqual(parseCols(JSON.stringify({ side: 250, chat: 500, list: '300', info: null, split: 0.6 })), { side: 250, split: 0.6 });
  assert.deepEqual(parseCols('{"side":1e999,"list":-1e999}'), {}); // JSON turns 1e999 into Infinity
  assert.deepEqual(parseCols('{"list":400}'), { list: 400 });
});

test('parse: each width bounded to its [min, max]', () => {
  assert.deepEqual(parseCols(JSON.stringify({ side: 10, list: 5000, info: 239, split: 0.99 })),
    { side: BOUNDS.side[0], list: BOUNDS.list[1], info: BOUNDS.info[0], split: BOUNDS.split[1] });
});

test('fit: a window wide enough keeps the stored widths', () => {
  assert.deepEqual(fitCols({ side: 300, list: 500 }, ['side', 'list'], 1600), { side: 300, list: 500 });
});

test('fit: a narrow window shrinks list, then info, then side, so the centre keeps its minimum', () => {
  // 1200 - 360 = 840 for the columns: 300 + 600 + 360 (info at default) = 1260, 420 too many.
  const f = fitCols({ side: 300, list: 600 }, ['side', 'list', 'info'], 1200);
  assert.deepEqual(f, { side: 240, list: BOUNDS.list[0] });
  assert.equal(f.side! + f.list! + 360, 1200 - 360);
});

test('fit: absent columns (on screen or not) are never written, an off-screen one does not count', () => {
  assert.deepEqual(fitCols({ list: 600 }, ['side'], 800), { list: 600 });
  assert.deepEqual(fitCols({}, ['side', 'list', 'info'], 701), {});
});

test('fit: never under a minimum, even when the window is too narrow for every minimum', () => {
  assert.deepEqual(fitCols({ side: 400, list: 640, info: 720 }, ['side', 'list', 'info'], 400), { side: 160, list: 240, info: 240 });
});

test('fit: the centre minimum is a parameter (a Lounge split keeps room for feed + pane)', () => {
  assert.deepEqual(fitCols({ side: 400 }, ['side'], 1000, 640), { side: 360 });
});

test('drag: side and list grow to the right, the right column to the left, the split by share; all bounded', () => {
  assert.equal(dragged('side', 210, 40), 250);
  assert.equal(dragged('list', 360, -500), BOUNDS.list[0]);
  assert.equal(dragged('info', 360, -100), 460);
  assert.equal(dragged('split', 0.5, -100, 1000), 0.6);
  assert.equal(dragged('split', 0.5, 900, 1000), BOUNDS.split[0]);
  assert.equal(dragged('split', 0.5, 10, 0), 0.5);
});

test('css variables: px widths rounded, the split as the pane fr weight, an absent column removed', () => {
  assert.deepEqual(colVars({ side: 250.6, split: 0.6 }), { '--w-side': '251px', '--w-list': null, '--w-info': null, '--split': '1.5fr' });
  assert.deepEqual(colVars({}), { '--w-side': null, '--w-list': null, '--w-info': null, '--split': null });
});

test('grips: sidebar always; the list outside the Lounge; the split in a Lounge split; the right column with info or Recents', () => {
  const L = { lounge: '' as const, list: true, info: false, recents: false };
  assert.deepEqual(gripsOf(L), ['side', 'list']);
  assert.deepEqual(gripsOf({ ...L, list: false }), ['side']);
  assert.deepEqual(gripsOf({ ...L, info: true }), ['side', 'list', 'info']);
  assert.deepEqual(gripsOf({ ...L, lounge: 'lounge-full' }), ['side']);
  assert.deepEqual(gripsOf({ ...L, lounge: 'lounge-split', recents: true }), ['side', 'split', 'info']);
});
