import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capGauge, chipOf, durationLabel, flowStatus, spent } from '../src/flowstate.ts';
import type { FlowAgentState } from '../../protocol/frames.ts';

const st = (over: Partial<FlowAgentState> = {}): FlowAgentState => ({ agent: 'gideon', at: 1, paused: null, current: null,
  usage: { task: { day: 1, month: 4 }, discussion: { day: 0.5, month: 1 } }, caps: { day: 5, month: 50 }, alerts: [], ...over });
const cur = (over: Partial<NonNullable<FlowAgentState['current']>> = {}) =>
  ({ ref: 'uplift/loom#80', trigger: 'dev.assigned', thread: 't80', since: 1000, running: false, alive: null, ...over });

test('flowStatus: a pause wins over the running task, quota apart; working only while a turn runs', () => {
  assert.equal(flowStatus(st()), 'idle');
  assert.equal(flowStatus(st({ current: cur() })), 'waiting');
  assert.equal(flowStatus(st({ current: cur({ running: true }) })), 'working');
  assert.equal(flowStatus(st({ current: cur({ running: true }), paused: { by: 'human', reason: 'x', since: 1 } })), 'paused');
  assert.equal(flowStatus(st({ paused: { by: 'quota', reason: 'x', since: 1 } })), 'quota');
});

test('capGauge: share capped at 1, warn from 80 %, over from 100 %, no gauge without a cap', () => {
  assert.deepEqual(capGauge(1, 5), { share: 0.2, level: 'ok' });
  assert.deepEqual(capGauge(4, 5), { share: 0.8, level: 'warn' });
  assert.deepEqual(capGauge(6, 5), { share: 1, level: 'over' });
  assert.equal(capGauge(6, null), null);
  assert.equal(capGauge(6, 0), null);
  assert.equal(spent(st(), 'day'), 1.5, 'task and discussion both count');
  assert.equal(spent(st(), 'month'), 5);
});

test('chipOf: the agent whose task is in this thread, its last sign of life in ms (else the task start)', () => {
  const states = [st({ agent: 'gaston' }), st({ current: cur({ alive: 2000, running: true }) })];
  assert.deepEqual(chipOf(states, 't80'), { agent: 'gideon', status: 'working', last: 2_000_000 });
  assert.deepEqual(chipOf([st({ current: cur() })], 't80'), { agent: 'gideon', status: 'waiting', last: 1_000_000 });
  assert.equal(chipOf(states, 't81'), null);
});

test('durationLabel: under a minute, minutes, hours with padded minutes, days', () => {
  assert.equal(durationLabel(20, 'en'), '<1 min');
  assert.equal(durationLabel(12 * 60 + 5, 'en'), '12 min');
  assert.equal(durationLabel(65 * 60, 'en'), '1 h 05');
  assert.equal(durationLabel(3 * 86400, 'fr'), '3 j');
});
