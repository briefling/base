import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FOLD_UP_PX, clickFolds, upTracker, wheelPx } from '../src/sumfold.ts';

test('sumfold: folds once a gesture went up past the threshold, in small steps too', () => {
  const tr = upTracker();
  assert.equal(tr.up(FOLD_UP_PX - 1), false);
  assert.equal(tr.up(1), true);
  const tp = upTracker();
  assert.deepEqual(Array.from({ length: 10 }, () => tp.up(4)), [false, false, false, false, false, false, false, false, false, true]);
});

test('sumfold: a step down cancels what was gathered, a zero step changes nothing', () => {
  const tr = upTracker();
  tr.up(30); tr.up(0);
  assert.equal(tr.up(10), true);
  const td = upTracker();
  td.up(30); td.up(-5);
  assert.equal(td.up(30), false);
  assert.equal(upTracker().up(-500), false);
});

test('sumfold: reset starts a new gesture', () => {
  const tr = upTracker();
  tr.up(30); tr.reset();
  assert.equal(tr.up(30), false);
});

test('sumfold: wheel deltas in lines and pages become pixels', () => {
  assert.equal(wheelPx(-3, 1), -48);
  assert.equal(wheelPx(-1, 2), -800);
  assert.equal(wheelPx(-120, 0), -120);
});

// A fake element: its own selector first, then its ancestors'; `closest` matches one of them against a selector list.
const el = (...chain: string[]) => ({ closest: (sel: string) => chain.find(c => sel.split(',').map(s => s.trim()).includes(c)) ?? null });
const MSG = ['.m', '.conv.work .msgs'];

test('sumfold: a plain click in a thread\'s messages folds, outside them it does not', () => {
  assert.equal(clickFolds(el('p', ...MSG), ''), true);
  assert.equal(clickFolds(el('.conv.work .msgs'), ''), true);
  assert.equal(clickFolds(el('p', '.composer'), ''), false);
  assert.equal(clickFolds(null, ''), false);
});

test('sumfold: a click on something active, in the Summary or ending a selection does not fold', () => {
  for (const active of ['a', 'button', 'input', 'textarea', 'select', 'label', 'summary', 'details', 'video', 'audio', '[role="button"]', '[tabindex]', '[contenteditable]', '.ask', '.sumcard'])
    assert.equal(clickFolds(el('span', active, ...MSG), ''), false, active);
  assert.equal(clickFolds(el('p', ...MSG), 'selected words'), false);
});
