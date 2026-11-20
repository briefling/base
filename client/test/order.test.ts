import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Message } from '../../protocol/frames.ts';
import { convOrder } from '../src/order.ts';

const msg = (id: string, at: number, kind: Message['author']['kind'], type: Message['type'] = 'text'): Message =>
  ({ id, thread: 't', author: { kind, id: kind === 'agent' ? 'milan' : kind === 'human' ? 'blair' : 'briefling' }, type, text: id, at });
const ids = (ms: Message[]) => ms.map(m => m.id);

test('a card created mid-turn shows after the agent message that announces it', () => {
  const all = [msg('q', 1, 'human'), msg('card', 2, 'system', 'propose'), msg('a', 3, 'agent')];
  assert.deepEqual(ids(convOrder(all)), ['q', 'a', 'card']);
});

test('the turn card types move, other system messages do not', () => {
  for (const type of ['propose', 'issue', 'about', 'plan', 'elevation'] as const)
    assert.deepEqual(ids(convOrder([msg('c', 1, 'system', type), msg('a', 2, 'agent')])), ['a', 'c'], type);
  assert.deepEqual(ids(convOrder([msg('g', 1, 'system', 'github'), msg('a', 2, 'agent')])), ['g', 'a']);
  assert.deepEqual(ids(convOrder([msg('l', 1, 'system'), msg('a', 2, 'agent')])), ['l', 'a']);
});

test('the card stops before the next human or system message', () => {
  const all = [msg('c', 1, 'system', 'propose'), msg('a1', 2, 'agent'), msg('a2', 3, 'agent'), msg('h', 4, 'human'), msg('a3', 5, 'agent')];
  assert.deepEqual(ids(convOrder(all)), ['a1', 'a2', 'c', 'h', 'a3']);
  const sys = [msg('c', 1, 'system', 'issue'), msg('a1', 2, 'agent'), msg('line', 3, 'system'), msg('a2', 4, 'agent')];
  assert.deepEqual(ids(convOrder(sys)), ['a1', 'c', 'line', 'a2']);
});

test('several cards of one turn keep their order, after the turn', () => {
  const all = [msg('c1', 1, 'system', 'propose'), msg('a1', 2, 'agent'), msg('c2', 3, 'system', 'propose'), msg('a2', 4, 'agent')];
  assert.deepEqual(ids(convOrder(all)), ['a1', 'a2', 'c1', 'c2']);
});

test('a card with nothing after it (turn still running) stays last; input order does not matter', () => {
  const all = [msg('a', 3, 'agent'), msg('h', 1, 'human'), msg('c', 4, 'system', 'about')];
  assert.deepEqual(ids(convOrder(all)), ['h', 'a', 'c']);
  assert.deepEqual(ids(convOrder(new Map(all.map(m => [m.id, m])).values())), ['h', 'a', 'c']);
});

test('a To decide card (agent ask with items) moves after the agent text; a plain ask does not', () => {
  const card: Message = { ...msg('card', 2, 'agent', 'ask'), ask: { id: 'card', options: [], items: [{ label: 'Motif', q: 'Quel fond ?', options: ['A', 'B'] }] } };
  const all = [msg('q', 1, 'human'), card, msg('a', 3, 'agent'), msg('h', 4, 'human')];
  assert.deepEqual(ids(convOrder(all)), ['q', 'a', 'card', 'h']);
  const approval: Message = { ...msg('ok?', 2, 'agent', 'ask'), ask: { id: 'ok?', options: ['once', 'deny'] } };
  assert.deepEqual(ids(convOrder([msg('q', 1, 'human'), approval, msg('a', 3, 'agent')])), ['q', 'ok?', 'a']);
});

test('same timestamp: ids break the tie as before', () => {
  assert.deepEqual(ids(convOrder([msg('b', 1, 'human'), msg('a', 1, 'human')])), ['a', 'b']);
});
