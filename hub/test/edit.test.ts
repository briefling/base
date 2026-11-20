import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editBlock, erasedByEdit, lastOwn } from '../../protocol/edit.ts';
import type { Message } from '../../protocol/frames.ts';

let at = 0;
const human = (id: string, who = 'blair', extra: Partial<Message> = {}): Message => ({ id, thread: 't', author: { kind: 'human', id: who }, type: 'text', text: id, at: ++at, ...extra });
const agent = (id: string): Message => ({ id, thread: 't', author: { kind: 'agent', id: 'milan' }, type: 'text', text: id, at: ++at });
const stop = (id: string, acted: boolean): Message => ({ id, thread: 't', author: { kind: 'system', id: 'briefling' }, type: 'text', text: 'Stopped.', at: ++at, stop: { by: 'blair', acted } });
const label = (id: string): Message => ({ id, thread: 't', author: { kind: 'system', id: 'briefling' }, type: 'text', text: 'label', at: ++at });

test('editBlock: author, replies, turn, answered vs stopped', () => {
  const m = human('m');
  assert.equal(editBlock([m], 'x', 'blair', false), 'unknown');
  assert.equal(editBlock([m], 'm', 'joachim', false), 'not_author');
  assert.equal(editBlock([human('a', 'blair', { type: 'answer' })], 'a', 'blair', false), 'not_author', 'a card answer is not editable');
  assert.equal(editBlock([m], 'm', 'blair', false), null, 'nobody answered: free, no time limit');
  assert.equal(editBlock([m, label('l')], 'm', 'blair', false), null, 'a system line is not an answer');
  assert.equal(editBlock([m], 'm', 'blair', true), 'busy');
  assert.equal(editBlock([m, human('j', 'joachim')], 'm', 'blair', true), 'replied', 'a reply wins over busy');
  assert.equal(editBlock([m, human('n')], 'm', 'blair', false), 'replied', 'not the last own message');
  assert.equal(editBlock([m, agent('a')], 'm', 'blair', false), null, 'answered by the agent: still editable');
  assert.equal(editBlock([m, agent('a'), stop('s', true)], 'm', 'blair', false), null, 'stopped turn: editable');
  assert.equal(editBlock([m, stop('s', false)], 'm', 'blair', false), null, 'stopped before any text');
  assert.equal(editBlock([m, agent('a'), stop('s', false), agent('b')], 'm', 'blair', false), null, 'answered after the stop');
  assert.equal(editBlock([m, agent('a'), human('j', 'joachim')], 'm', 'blair', false), 'replied', 'a human after the answer closes it');
  assert.equal(editBlock([m, agent('a')], 'm', 'blair', true), 'busy', 'a new turn runs: stop it first');
});

test('editBlock: time order by hub time, not by id (agent ids carry the agent clock)', () => {
  const m = human('z-late-id'), r = human('a-early-id', 'joachim');
  assert.equal(editBlock([r, m], 'z-late-id', 'blair', false), 'replied', 'the reply came later in hub time');
});

test('erasedByEdit: partial answer of the last stopped turn, only when no tool was called', () => {
  const m = human('m');
  assert.deepEqual(erasedByEdit([m], 'm'), []);
  assert.deepEqual(erasedByEdit([m, agent('a'), agent('b'), stop('s', false)], 'm'), ['a', 'b']);
  assert.deepEqual(erasedByEdit([m, agent('a'), stop('s', true)], 'm'), [], 'a tool was called: kept');
  assert.deepEqual(erasedByEdit([m, agent('a'), stop('s1', true), agent('b'), stop('s2', false)], 'm'), ['b'], 'an earlier kept answer stays');
  const before = agent('before'), m2 = human('m2');
  assert.deepEqual(erasedByEdit([before, m2, agent('a2'), stop('s3', false)], 'm2'), ['a2'], 'nothing before the message');
  const m3 = human('m3');
  assert.deepEqual(erasedByEdit([m3, agent('a3'), stop('s4', false), agent('b3')], 'm3'), [], 'answered after the stop: the answer stays');
});

test('lastOwn: latest own text message', () => {
  const a = human('a'), b = human('b', 'joachim'), c = human('c', 'blair', { type: 'answer' });
  assert.equal(lastOwn([a, b, c], 'blair')?.id, 'a');
  assert.equal(lastOwn([b], 'blair'), null);
});
