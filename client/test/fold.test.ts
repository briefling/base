import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aboutFold, briefLines, foldsBrief, offCardLabel, BRIEF_COLS, BRIEF_FOLD_AT } from '../src/fold.ts';

test('briefLines: one per source line, long lines count as they wrap, blank lines count, ends trimmed', () => {
  assert.equal(briefLines('a\nb\n\nc'), 4);
  assert.equal(briefLines('x'.repeat(BRIEF_COLS)), 1);
  assert.equal(briefLines('x'.repeat(BRIEF_COLS + 1)), 2);
  assert.equal(briefLines('\n\na\n\n'), 1);
});

test('offCardLabel: dismissed and superseded cards fold, each with its label; live cards do not', () => {
  assert.equal(offCardLabel('dismissed', 'plan_dismissed'), 'plan_dismissed');
  assert.equal(offCardLabel('superseded', 'plan_dismissed'), 'card_superseded');
  for (const s of ['open', 'pending', 'running', 'failed', 'done', 'stopped']) assert.equal(offCardLabel(s, 'ni_dismissed'), null, s);
});

test('foldsBrief: short briefs stay whole, long ones fold (no fold for one extra line)', () => {
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `- point ${i}`).join('\n');
  assert.equal(foldsBrief(lines(BRIEF_FOLD_AT - 1)), false);
  assert.equal(foldsBrief(lines(BRIEF_FOLD_AT)), true);
  assert.equal(foldsBrief('x'.repeat(BRIEF_COLS * BRIEF_FOLD_AT)), true);   // one long paragraph
  assert.equal(foldsBrief(''), false);
});

test('aboutFold: an applied draft folds as applied, an older draft folds as replaced once a newer one is applied', () => {
  const a = (id: string, applied = false) => ({ id, type: 'about', about: applied ? { applied: { by: 'u', at: 1 } } : {} });
  const msg = { id: 'm9', type: 'text' };
  assert.equal(aboutFold(a('a1'), [a('a1'), msg]), null); // live
  assert.equal(aboutFold(a('a1', true), [a('a1', true)]), 'about_card_applied');
  assert.equal(aboutFold(a('a1'), [a('a1'), a('a2', true)]), 'card_superseded');
  assert.equal(aboutFold(a('a2'), [a('a1', true), a('a2')]), null); // a newer draft after the applied one stays open
  assert.equal(aboutFold(a('a1'), [a('a1'), a('a2')]), null); // a newer draft not applied replaces nothing
});
