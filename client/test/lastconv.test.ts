import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remember, reopen, type LastConv } from '../src/lastconv.ts';
import type { PublicThread } from '../../protocol/frames.ts';

const th = (id: string, kind: string, state: string, extra: Record<string, unknown> = {}) =>
  ({ id, space: 's', kind, state, updatedAt: 0, ...extra }) as unknown as PublicThread;
const world = (...fs: PublicThread[]) => (id: string) => fs.find(f => f.id === id);
const off = { active: false, narrow: false };

test('each entry reopens its own last conversation', () => {
  const mem: LastConv = new Map();
  remember(mem, { kind: 'lounge', id: 's' }, 'tp');
  remember(mem, { kind: 'space', id: 's' }, 'a');
  remember(mem, { kind: 'lounge', id: 'other' }, 'tq');
  const get = world(th('tp', 'topic', 'calm'), th('a', 'thread', 'you'), th('tq', 'topic', 'calm', { space: 'other' }));
  assert.equal(reopen(mem, { kind: 'lounge', id: 's' }, get, off), 'tp');
  assert.equal(reopen(mem, { kind: 'space', id: 's' }, get, off), 'a');
  assert.equal(reopen(mem, { kind: 'lounge', id: 'other' }, get, off), 'tq');
  assert.equal(reopen(mem, { kind: 'later', id: 's' }, get, off), null, 'nothing remembered: list');
});

test('the last state wins, list alone included (the Lounge then opens its General room)', () => {
  const mem: LastConv = new Map();
  remember(mem, { kind: 'lounge', id: 's' }, 'tp');
  remember(mem, { kind: 'lounge', id: 's' }, null);
  assert.equal(reopen(mem, { kind: 'lounge', id: 's' }, world(th('tp', 'topic', 'calm')), off), 'general-s');
});

test('arriving in a space: the Lounge opens its General room, even never written in; never on a narrow screen', () => {
  const mem: LastConv = new Map();
  assert.equal(reopen(mem, { kind: 'lounge', id: 's' }, world(), off), 'general-s', 'nothing remembered');
  remember(mem, { kind: 'lounge', id: 's' }, 'gone');
  assert.equal(reopen(mem, { kind: 'lounge', id: 's' }, world(), off), 'general-s', 'remembered topic no longer listed');
  assert.equal(reopen(new Map(), { kind: 'lounge', id: 's' }, world(), { active: false, narrow: true }), null, 'phone: the list first');
  assert.equal(reopen(new Map(), { kind: 'space', id: 's' }, world(), off), null, 'the thread list keeps its list');
});

test('click on the active entry, or a narrow screen: list alone', () => {
  const mem: LastConv = new Map();
  remember(mem, { kind: 'lounge', id: 's' }, 'tp');
  const get = world(th('tp', 'topic', 'calm'));
  assert.equal(reopen(mem, { kind: 'lounge', id: 's' }, get, { active: true, narrow: false }), null);
  assert.equal(reopen(mem, { kind: 'lounge', id: 's' }, get, { active: false, narrow: true }), null);
});

test('a conversation no longer listed in the entry falls back to the list', () => {
  const mem: LastConv = new Map();
  const sp = { kind: 'space', id: 's' };
  remember(mem, sp, 'a');
  assert.equal(reopen(mem, sp, world(), off), null, 'absent');
  assert.equal(reopen(mem, sp, world(th('a', 'thread', 'done')), off), null, 'closed');
  assert.equal(reopen(mem, sp, world(th('a', 'thread', 'calm', { archived: { by: 'x', at: 1 } })), off), null, 'archived');
  assert.equal(reopen(mem, sp, world(th('a', 'thread', 'idea')), off), null, 'moved to Later');
  // and it opens where it now lives
  const cl = { kind: 'closed', id: 's' };
  remember(mem, cl, 'a');
  assert.equal(reopen(mem, cl, world(th('a', 'thread', 'done')), off), 'a');
  assert.equal(reopen(mem, cl, world(th('a', 'thread', 'you')), off), null, 'reopened: back in the space list');
});

test('the new-topic composer is never remembered: back on the last topic opened, else General', () => {
  const mem: LastConv = new Map(), lg = { kind: 'lounge', id: 's' };
  remember(mem, lg, 'new');
  assert.equal(reopen(mem, lg, world(), off), 'general-s', 'composer alone: General');
  remember(mem, lg, 'tp');
  remember(mem, lg, 'new');
  assert.equal(reopen(mem, lg, world(th('tp', 'topic', 'calm')), off), 'tp', 'the topic opened before the composer');
  assert.equal(reopen(mem, lg, world(), off), 'general-s', 'that topic no longer listed: General');
  remember(mem, { kind: 'space', id: 's' }, 'new');
  assert.equal(reopen(mem, { kind: 'space', id: 's' }, world(), off), null);
});

test('Now and other views are not remembered', () => {
  const mem: LastConv = new Map();
  remember(mem, { kind: 'now' }, 'a');
  remember(mem, { kind: 'metrics', id: 's' }, 'a');
  assert.equal(mem.size, 0);
  assert.equal(reopen(mem, { kind: 'now' }, world(th('a', 'thread', 'you')), off), null);
});

test('a thread opened in the Lounge side pane comes back there while it is listed in its space', () => {
  const mem: LastConv = new Map();
  remember(mem, { kind: 'lounge', id: 's' }, 'a');
  assert.equal(reopen(mem, { kind: 'lounge', id: 's' }, world(th('a', 'thread', 'you')), off), 'a');
  assert.equal(reopen(mem, { kind: 'lounge', id: 's' }, world(th('a', 'thread', 'done')), off), 'general-s', 'closed: the Bar');
  assert.equal(reopen(mem, { kind: 'lounge', id: 's' }, world(th('a', 'thread', 'you', { space: 'o' })), off), 'general-s', 'other space');
});
