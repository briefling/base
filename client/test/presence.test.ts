import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AWAY_MS, canTalk, dotOf, idleOf, localState, mergePresence, presLine, roster, span, withAgents, stuckAgents, stuckKey } from '../../protocol/presence.ts';
import { stuckOf } from '../../protocol/plugin.ts';

test('stuck agents: why a plugin behind the latest release will not catch up alone, kept through the merge', () => {
  assert.equal(stuckOf(undefined, '0.3.80'), undefined, 'no version: the ACP bridge, no banner');
  assert.equal(stuckOf({ version: '0.3.80', update: 'failed' }, '0.3.80'), undefined);
  assert.equal(stuckOf({ version: '0.3.81' }, '0.3.80'), undefined);
  assert.equal(stuckOf({ version: '0.3.79' }, '0.3.80'), undefined);
  assert.equal(stuckOf({ version: '0.3.79', update: 'pinned' }, '0.3.80'), 'pinned');
  assert.equal(stuckOf({ version: '0.3.72', update: 'failed' }, '0.3.80'), 'old');
  const list = mergePresence([{ id: 'milan', voice: true }, { id: 'milan', stuck: 'failed' }, { id: 'gideon' }, { id: 'blair' }]);
  assert.deepEqual(list.find(p => p.id === 'milan'), { id: 'milan', state: 'active', voice: true, stuck: 'failed' });
  assert.deepEqual(stuckAgents(list), [{ id: 'milan', stuck: 'failed' }]);
  assert.deepEqual(stuckAgents(undefined), []);
  assert.equal(stuckKey([{ id: 'radar', stuck: 'old' }, { id: 'milan', stuck: 'failed' }]), 'milan:failed,radar:old', 'order-free');
});

test('mergePresence: one entry per principal, the best state of their connections wins', () => {
  assert.deepEqual(mergePresence([]), []);
  assert.deepEqual(mergePresence([{ id: 'b', away: true }, { id: 'a' }, { id: 'b' }, { id: 'c', away: true }, { id: 'c', away: true }]),
    [{ id: 'a', state: 'active' }, { id: 'b', state: 'active' }, { id: 'c', state: 'away' }]);
  assert.deepEqual(mergePresence([{ id: 'b' }, { id: 'b', away: true }]), [{ id: 'b', state: 'active' }], 'active then away: stays active');
});

test('localState: away after AWAY_MS without input, not before', () => {
  assert.equal(localState(1000, 1000 + AWAY_MS - 1), 'active');
  assert.equal(localState(1000, 1000 + AWAY_MS), 'away');
});

test('dotOf: human disconnected = none, agent disconnected = off (red), nothing claimed before the first list', () => {
  const list = [{ id: 'blair', state: 'away' as const }, { id: 'gaston', state: 'active' as const }];
  assert.equal(dotOf({ id: 'blair', kind: 'human' }, list), 'away');
  assert.equal(dotOf({ id: 'joachim', kind: 'human' }, list), null);
  assert.equal(dotOf({ id: 'gaston', kind: 'agent' }, list), 'active');
  assert.equal(dotOf({ id: 'milan', kind: 'agent' }, list), 'off');
  assert.equal(dotOf({ id: 'milan', kind: 'agent' }, undefined), null);
  assert.equal(dotOf({ id: 'blair', kind: 'human' }, []), null, 'after a disconnection: the dot goes');
});

test('roster: the stack holds who is here (humans active first, then agents); offline agents (red) then offline humans fold out', () => {
  const people = [
    { id: 'z', name: 'Zoé', kind: 'human' as const }, { id: 'a', name: 'Anne', kind: 'human' as const }, { id: 'o', name: 'Off', kind: 'human' as const },
    { id: 'milan', name: 'Milan', kind: 'agent' as const }, { id: 'gaston', name: 'Gaston', kind: 'agent' as const },
    { id: 'old', name: 'Old', kind: 'agent' as const, gone: true },
  ];
  const list = [{ id: 'a', state: 'away' as const }, { id: 'z', state: 'active' as const }, { id: 'milan', state: 'active' as const }];
  const r = roster(people, list);
  assert.deepEqual(r.here.map(p => `${p.id}:${p.dot}`), ['z:active', 'a:away', 'milan:active']);
  assert.deepEqual(r.absent.map(p => `${p.id}:${p.dot}`), ['gaston:off', 'o:none'], 'gone agent left out');
  assert.deepEqual(roster(people, undefined), { here: [], absent: [] }, 'nothing claimed before the first list');
});

test('mergePresence: an away principal carries the latest input of its away connections (since)', () => {
  assert.deepEqual(mergePresence([{ id: 'b', away: true, idle: 5 }, { id: 'b', away: true, idle: 9 }, { id: 'b', away: true }]), [{ id: 'b', state: 'away', since: 9 }]);
  assert.deepEqual(mergePresence([{ id: 'b', away: true, idle: 5 }, { id: 'b' }]), [{ id: 'b', state: 'active' }], 'active wins, no since');
  assert.deepEqual(mergePresence([{ id: 'b', away: true }]), [{ id: 'b', state: 'away' }], 'older client: no since');
});

test('idleOf: the input sent with away, kept in [0, now]; missing or bad = AWAY_MS ago', () => {
  assert.equal(idleOf(500.7, 1000), 500);
  assert.equal(idleOf(5000, 1000), 1000);
  for (const v of [undefined, 'x', -1, NaN, Infinity]) assert.equal(idleOf(v, AWAY_MS + 10), 10, String(v));
});

test('span: minutes (1 at least) under an hour, hours under a day, then days', () => {
  assert.deepEqual(span(0), { unit: 'min', n: 1 });
  assert.deepEqual(span(-5), { unit: 'min', n: 1 });
  assert.deepEqual(span(25 * 60_000 + 59_000), { unit: 'min', n: 25 });
  assert.deepEqual(span(60 * 60_000), { unit: 'h', n: 1 });
  assert.deepEqual(span(23 * 3600_000 + 3599_000), { unit: 'h', n: 23 });
  assert.deepEqual(span(48 * 3600_000), { unit: 'd', n: 2 });
});

test('presLine: active, idle · since, seen ago / just now / yesterday / never, agent offline for (or unknown)', () => {
  const now = 10 * 86_400_000, h = (dot: any) => ({ kind: 'human' as const, dot }), a = (dot: any) => ({ kind: 'agent' as const, dot });
  assert.deepEqual(presLine(h('active'), 5, now), { k: 'active' });
  assert.deepEqual(presLine(a('active'), undefined, now), { k: 'active' });
  assert.deepEqual(presLine(h('away'), now - 25 * 60_000, now), { k: 'idle', d: { unit: 'min', n: 25 } });
  assert.deepEqual(presLine(h('away'), undefined, now), { k: 'idle', d: { unit: 'min', n: 15 } }, 'older hub: AWAY_MS');
  assert.deepEqual(presLine(h('none'), undefined, now), { k: 'never' });
  assert.deepEqual(presLine(h('none'), now - 30_000, now), { k: 'seen_now' });
  assert.deepEqual(presLine(h('none'), now - 3 * 3600_000, now), { k: 'seen', d: { unit: 'h', n: 3 } });
  assert.deepEqual(presLine(h('none'), now - 30 * 3600_000, now), { k: 'seen_yday' });
  assert.deepEqual(presLine(h('none'), now - 50 * 3600_000, now), { k: 'seen', d: { unit: 'd', n: 2 } });
  assert.deepEqual(presLine(a('off'), now - 50 * 3600_000, now), { k: 'down', d: { unit: 'd', n: 2 } });
  assert.deepEqual(presLine(a('off'), undefined, now), { k: 'down_unknown' });
});

test('voice: an agent talks when one of its connections announces it; canTalk reads it', () => {
  const list = mergePresence([{ id: 'gideon' }, { id: 'gideon', voice: true }, { id: 'milan', voice: false }, { id: 'blair' }]);
  assert.deepEqual(list, [{ id: 'blair', state: 'active' }, { id: 'gideon', state: 'active', voice: true }, { id: 'milan', state: 'active' }]);
  assert.equal(mergePresence([{ id: 'gideon', voice: true }, { id: 'gideon' }])[0].voice, true, 'whatever the order');
  assert.equal(canTalk('gideon', list), true);
  assert.equal(canTalk('milan', list), false);
  assert.equal(canTalk('gideon', undefined), false, 'before the first list');
  assert.equal(canTalk('gideon', []), false, 'its gateway is down');
});

test('space.updated: an agent that joins while the Lounge is open enters the stack without a resync', () => {
  type P = { id: string; name: string; kind: 'human' | 'agent'; gone?: boolean };
  const make = (id: string): P => ({ id, name: id[0].toUpperCase() + id.slice(1), kind: 'agent' });
  const humans: P[] = [{ id: 'admin', name: 'Admin', kind: 'human' }];
  const synced: P[] = [...humans, make('claude'), { ...make('old'), gone: true }];
  const live = mergePresence([{ id: 'admin' }, { id: 'claude' }, { id: 'copilot' }]); // presence.changed already has copilot
  assert.deepEqual(roster(synced, live).here.map(p => p.id), ['admin', 'claude'], 'before: copilot ignored');
  const next = withAgents(humans, synced, ['claude', 'copilot'], make);
  assert.deepEqual(roster(next, live).here.map(p => p.id), ['admin', 'claude', 'copilot']);
  assert.deepEqual(next.find(p => p.id === 'copilot'), { id: 'copilot', name: 'Copilot', kind: 'agent' });
  // removed from the space: kept as gone (mentions), out of the stack; back again: no longer gone
  const dropped = withAgents(humans, next, ['copilot'], make);
  assert.deepEqual(dropped.filter(p => p.gone).map(p => p.id).sort(), ['claude', 'old']);
  assert.equal(withAgents(humans, dropped, ['claude', 'copilot'], make).find(p => p.id === 'claude')!.gone, undefined);
  // older hub (no agents): kept as synced
  assert.deepEqual(withAgents(humans, synced, undefined, make), synced);
});
