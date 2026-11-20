import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afterStop, editOf, isEditKey, onUp, pencilOn, saveAction } from '../src/edit.ts';
import type { Message } from '../../protocol/frames.ts';

const ME = 'u-blair';
let n = 0;
const msg = (kind: 'human' | 'agent' | 'system', id: string, o: Partial<Message> = {}): Message =>
  ({ id: `m${++n}`, thread: 't1', author: { kind, id }, type: 'text', text: `text ${n}`, at: n * 1000, ...o } as Message);
const mine = (o: Partial<Message> = {}) => msg('human', ME, o);
const agent = (o: Partial<Message> = {}) => msg('agent', 'milan', o);
const stopLine = (acted = false) => msg('system', 'briefling', { stop: { by: ME, acted } });
const key = (o: Partial<KeyboardEvent> = {}) => ({ key: 'ArrowUp', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, isComposing: false, ...o });

test('↑ only in an empty composer, plain key, suggestions closed, no edit open', () => {
  assert.equal(isEditKey(key(), '', false, false), true);
  assert.equal(isEditKey(key(), 'x', false, false), false);
  assert.equal(isEditKey(key(), '', true, false), false);
  assert.equal(isEditKey(key(), '', false, true), false);
  for (const m of ['shiftKey', 'altKey', 'ctrlKey', 'metaKey', 'isComposing'] as const) assert.equal(isEditKey(key({ [m]: true }), '', false, false), false, m);
  assert.equal(isEditKey(key({ key: 'ArrowDown' }), '', false, false), false);
});

test('↑ with nothing of mine: null (the key keeps its default)', () => {
  assert.equal(onUp([agent()], ME, false, true), null);
  assert.equal(onUp([], ME, false, true), null);
});

test('↑ on my unanswered last message: edit it', () => {
  const before = agent(), m = mine();
  assert.deepEqual(onUp([before, m], ME, false, true), { kind: 'edit', msg: m });
});

test('↑ while the agent works: confirm when trusted, hint otherwise', () => {
  const m = mine();
  assert.deepEqual(onUp([m], ME, true, true), { kind: 'confirm', msg: m });
  assert.deepEqual(onUp([m], ME, true, false), { kind: 'hint', hint: 'untrusted' });
});

test('↑ after the agent answered: still edit it; after another human: the refusal code', () => {
  const m = mine();
  assert.deepEqual(onUp([m, agent()], ME, false, true), { kind: 'edit', msg: m });
  assert.deepEqual(onUp([mine(), msg('human', 'u-aurore')], ME, false, true), { kind: 'hint', hint: 'replied' });
});

test('waiting for the stop: wait while it runs, then edit if the stop line came, else the code', () => {
  const m = mine(), partial = agent();
  assert.equal(afterStop([m, partial], m.id, ME, true), 'wait');
  assert.equal(afterStop([m, partial, stopLine()], m.id, ME, false), 'edit');
  assert.equal(afterStop([m, partial], m.id, ME, false), 'edit'); // the turn had ended with an answer before the stop
  assert.equal(afterStop([m, msg('human', 'u-aurore')], m.id, ME, false), 'replied');
});

test('pencil: on the message ↑ would open, also after an answer or while a trusted member may stop the agent', () => {
  const old = mine(), m = mine();
  assert.equal(pencilOn([old, m, agent()], ME, false, true), m.id, 'my last message only, answered or not');
  assert.equal(pencilOn([m], ME, true, true), m.id, 'agent working: the pencil opens the stop confirm');
  assert.equal(pencilOn([m], ME, true, false), null, 'not trusted: nothing a click could do');
  assert.equal(pencilOn([m, msg('human', 'u-aurore')], ME, false, true), null, 'another human answered');
  assert.equal(pencilOn([agent()], ME, false, true), null);
  assert.equal(pencilOn([m, mine({ deleted: { by: ME, at: 1 } } as Partial<Message>)], ME, false, true), m.id, 'a deleted newer one is skipped');
});

test('editOf: the text as written, a files-only message starts empty', () => {
  const e = editOf(mine({ text: 'hello', rev: 2 }));
  assert.equal(e.phase, 'edit'); assert.equal(e.text, 'hello'); assert.equal(e.orig, 'hello'); assert.equal(e.rev, 2);
  assert.equal(editOf(mine({ text: ' ' })).text, '');
  assert.equal(editOf(mine()).rev, 0);
});

test('save: unchanged leaves, empty without files keeps, otherwise sends once', () => {
  const e = editOf(mine({ text: 'hello' }));
  assert.equal(saveAction({ ...e, text: 'hello ' }, false), 'leave');
  assert.equal(saveAction({ ...e, text: '  ' }, false), 'keep');
  assert.equal(saveAction({ ...e, text: '' }, true), 'send');
  assert.equal(saveAction({ ...e, text: 'hello world' }, false), 'send');
  assert.equal(saveAction({ ...e, text: 'hello world', cid: 'c1' }, false), 'keep'); // already in flight
  assert.equal(saveAction({ ...e, text: 'hello world', phase: 'stopping' }, false), 'keep');
});

test('delete: only my own text messages, any time; a deleted one is never edited, and ↑ skips it', async () => {
  const { deletable, editBlock } = await import('../../protocol/edit.ts');
  const m = mine(), a = agent(), other = msg('human', 'u-joachim');
  assert.equal(deletable(m, ME), true);
  assert.equal(deletable(mine(), 'u-joachim'), false, 'not the author');
  assert.equal(deletable(a, ME), false, 'never an agent message');
  assert.equal(deletable(other, ME), false);
  assert.equal(deletable(mine({ type: 'answer' }), ME), false, 'a card answer is not a text message');
  assert.equal(deletable(mine({ deleted: { at: 1, by: ME } }), ME), true, 'deleting again is harmless (the hub acks it)');
  const older = mine(), gone = mine({ text: '', deleted: { at: 9, by: ME } });
  assert.equal(editBlock([older, gone], gone.id, ME, false), 'deleted');
  assert.equal(onUp([older, gone], ME, false, true)?.kind === 'edit' && (onUp([older, gone], ME, false, true) as any).msg.id, older.id, '↑ opens the one before');
  const first = mine(), reply = msg('human', 'u-joachim', { text: '', deleted: { at: 9, by: 'u-joachim' } });
  assert.equal(editBlock([first, reply], first.id, ME, false), null, 'a deleted reply no longer closes the edit');
});
