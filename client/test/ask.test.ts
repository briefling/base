import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askChoice, askDone, askStart, askAnswerText, askAnswered } from '../src/ask.ts';

const opts = ['Approve', 'For this session', 'Always', 'Deny'];

test('askChoice: an option button answer picks its index', () => {
  assert.deepEqual(askChoice(opts, 'Approve'), { index: 0 });
  assert.deepEqual(askChoice(opts, 'Deny'), { index: 3 });
});

test('askChoice: an option repeated by hand still matches (spaces, case)', () => {
  assert.deepEqual(askChoice(opts, '  for THIS session '), { index: 1 });
});

test('askChoice: the exact match wins over a looser earlier one', () => {
  assert.deepEqual(askChoice(['yes', 'Yes'], 'Yes'), { index: 1 });
});

test('askChoice: an answer outside the options is free text, trimmed', () => {
  assert.deepEqual(askChoice(opts, ' Only on staging '), { free: 'Only on staging' });
});

test('askChoice: a question without options always gets a free answer', () => {
  assert.deepEqual(askChoice([], 'A'), { free: 'A' });
});

test('askChoice: an empty answer matches no option, not even an empty one', () => {
  assert.deepEqual(askChoice(['', 'B'], '  '), { free: '' });
});

const ITEMS = [{ label: 'Content', q: 'Empty it?', options: ['Empty it', 'Keep hidden'] }, { label: 'Who', q: 'Who deletes?', options: ['Author', 'Author + leads', 'Anyone'] }];

test('askStart: the recommended choice (first) is picked on every point', () => {
  assert.deepEqual(askStart(ITEMS), [{ choice: 0 }, { choice: 0 }]);
});

test('askAnswerText: one « label → choice » line per point; an empty Other blocks the send', () => {
  assert.equal(askAnswerText(ITEMS, [{ choice: 1 }, { choice: 1 }]), 'Content → Keep hidden\nWho → Author + leads');
  assert.equal(askAnswerText(ITEMS, [{ choice: 0 }, { other: '  only\n leads ' }]), 'Content → Empty it\nWho → only leads');
  assert.equal(askAnswerText(ITEMS, [{ choice: 0 }, { other: '  ' }]), null);
});

test('askAnswered: reads each point back from the answer, null for a missing line', () => {
  assert.deepEqual(askAnswered(ITEMS, 'Content → Keep hidden\nWho → only leads'), ['Keep hidden', 'only leads']);
  assert.deepEqual(askAnswered(ITEMS, 'Who → Anyone'), [null, 'Anyone']);
});

test('askDone: the approval options read in the past tense, a denial is not ok', () => {
  assert.deepEqual(askDone(opts, 'Approve'), { past: 'ask_past_approve', ok: true });
  assert.deepEqual(askDone(opts, 'For this session'), { past: 'ask_past_session', ok: true });
  assert.deepEqual(askDone(opts, ' always '), { past: 'ask_past_always', ok: true });
  assert.deepEqual(askDone(opts, 'Deny'), { past: 'ask_past_deny', ok: false });
});

test('askDone: another choice or a free answer is shown as is, ticked', () => {
  assert.deepEqual(askDone(['A', 'B'], 'a'), { text: 'A', ok: true });
  assert.deepEqual(askDone(['Now', 'Later'], ' Only on staging '), { text: 'Only on staging', ok: true });
  assert.deepEqual(askDone(['Now'], 'constructor'), { text: 'constructor', ok: true });
});
