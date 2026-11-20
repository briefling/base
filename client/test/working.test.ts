import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workingAgents, statusKey, pruneStatus, progressOf } from '../src/busy.ts';

const f = (state: 'run' | 'calm', working?: string[]) => ({ id: 't1', state, owner: 'milan', ...(working ? { working } : {}) }) as const;

test('working agents: the topic lists them, a thread falls back to its owner, nobody outside a turn', () => {
  assert.deepEqual(workingAgents(f('run', ['gideon'])), ['gideon'], 'a topic where only the second agent works');
  assert.deepEqual(workingAgents(f('run', ['milan', 'gideon'])), ['milan', 'gideon']);
  assert.deepEqual(workingAgents(f('run')), ['milan'], 'thread, or an older hub');
  assert.equal(workingAgents(f('calm', ['gideon'])).length, 0);
});

test('status phrases: kept per agent, dropped when that agent stops working, all dropped at the turn end', () => {
  const s = new Map<string, unknown>([[statusKey('t1', 'milan'), 1], [statusKey('t1', 'gideon'), 2], [statusKey('t2', 'milan'), 3]]);
  pruneStatus(s, f('run', ['milan', 'gideon']));
  assert.equal(s.size, 3);
  pruneStatus(s, f('run', ['gideon']));
  assert.deepEqual([...s.keys()], [statusKey('t1', 'gideon'), statusKey('t2', 'milan')]);
  pruneStatus(s, f('calm'));
  assert.deepEqual([...s.keys()], [statusKey('t2', 'milan')], 'another conversation is untouched');
});

test('working progress: whole minutes from the turn start, model calls; nothing shown when unknown or zero', () => {
  const now = 1_000_000_000;
  assert.deepEqual(progressOf({ since: now - 9 * 60_000 - 59_000, steps: 39 }, now), { min: 9, steps: 39 });
  assert.deepEqual(progressOf({ since: now - 59_000, steps: 0 }, now), { min: null, steps: null }, 'under a minute, no call yet');
  assert.deepEqual(progressOf({ since: now + 120_000, steps: 2 }, now), { min: null, steps: 2 }, 'plugin clock ahead');
  assert.deepEqual(progressOf(undefined, now), { min: null, steps: null }, 'older plugin');
});
