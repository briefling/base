import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bgCount, bgLine, bgTasks, bgTip, bgWork } from '../src/background.ts';

const tasks = [{ id: 'b', kind: 'process' as const, goal: 'npm run e2e', since: 20 }, { id: 'a', kind: 'delegate' as const, goal: 'bench', since: 10 }];

test('background: Quiet with tasks shows In progress (background); other states and no tasks do not', () => {
  assert.equal(bgWork({ state: 'calm', background: { tasks } }), true);
  assert.equal(bgWork({ state: 'calm', background: { tasks: [] } }), false);
  assert.equal(bgWork({ state: 'calm' }), false);
  for (const state of ['you', 'run', 'wait', 'done', 'idea'] as const) assert.equal(bgWork({ state, background: { tasks } }), false, state);
  assert.equal(bgCount({ background: { tasks } }), 2);
  assert.equal(bgCount({}), 0);
});

test('background: tasks oldest first, one goal per line in the tooltip', () => {
  assert.deepEqual(bgTasks({ background: { tasks } }).map(t => t.id), ['a', 'b']);
  assert.equal(bgTip({ background: { tasks } }), 'bench\nnpm run e2e');
  assert.deepEqual(tasks.map(t => t.id), ['b', 'a'], 'the thread\'s list is not reordered in place');
});

test('background: the line under the messages shows the oldest task, the others counted, minutes since it started', () => {
  const now = 10 + 65 * 60_000;
  assert.deepEqual(bgLine({ state: 'calm', background: { tasks } }, now), { goal: 'bench', more: 1, min: 65 });
  for (const state of ['you', 'wait', 'done'] as const) assert.equal(bgLine({ state, background: { tasks } }, now)?.goal, 'bench', state);
  assert.equal(bgLine({ state: 'run', background: { tasks } }, now), null, 'a running turn has its own working line');
  assert.equal(bgLine({ state: 'calm', background: { tasks: [] } }, now), null, 'list emptied (ended, or lost: the waiting outcome takes over)');
  assert.equal(bgLine({ state: 'calm' }, now), null);
  assert.equal(bgLine({ state: 'calm', background: { tasks: [tasks[1]] } }, 10 + 59_000)?.min, null, 'under one minute');
  assert.equal(bgLine({ state: 'calm', background: { tasks: [tasks[1]] } }, 0)?.min, null, 'agent clock ahead');
  assert.equal(bgLine({ state: 'calm', background: { tasks: [tasks[1]] } }, now)?.more, 0);
});
