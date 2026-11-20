import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Plan, PlanStatus } from '../../protocol/frames.ts';
import { isBoardPlan, planButtons, planHasIssues, planProgress, planStepState, planStepThreads } from '../src/plan.ts';

const steps = [{ title: 'A', brief: 'a' }, { title: 'B', brief: 'b' }, { title: 'C', brief: 'c' }];
const plan = (over: Partial<Plan>): Plan => ({ title: 'P', steps, by: 'testbot', status: 'open', ...over });
const states = (p: Plan) => p.steps.map((_, i) => planStepState(p, i));
const ALL: PlanStatus[] = ['open', 'running', 'pending', 'done', 'stopped', 'failed', 'dismissed'];

test('briefling driver: step state for every status', () => {
  assert.deepEqual(states(plan({ status: 'open' })), ['next', 'next', 'next']);
  assert.deepEqual(states(plan({ status: 'running', current: 0 })), ['active', 'next', 'next']);
  assert.deepEqual(states(plan({ status: 'running', current: 1 })), ['done', 'active', 'next']);
  assert.deepEqual(states(plan({ status: 'running', current: 2 })), ['done', 'done', 'active']);
  assert.deepEqual(states(plan({ status: 'done', current: 2 })), ['done', 'done', 'done']);
  assert.deepEqual(states(plan({ status: 'done' })), ['done', 'done', 'done']);
  assert.deepEqual(states(plan({ status: 'stopped', current: 1 })), ['done', 'active', 'off']);
  assert.deepEqual(states(plan({ status: 'failed', current: 1, error: 'refused' })), ['done', 'off', 'off']);
  assert.deepEqual(states(plan({ status: 'failed', error: 'refused' })), ['off', 'off', 'off']);
  assert.deepEqual(states(plan({ status: 'dismissed' })), ['off', 'off', 'off']);
  assert.deepEqual(states(plan({ status: 'pending' })), ['next', 'next', 'next']);
});

test('briefling driver: running without current starts at step 1; out-of-range index has no state', () => {
  assert.deepEqual(states(plan({ status: 'running' })), ['active', 'next', 'next']);
  assert.equal(planStepState(plan({ status: 'running', current: 0 }), -1), null);
  assert.equal(planStepState(plan({ status: 'running', current: 0 }), 3), null);
});

test('board driver: no per-step state, whatever the status', () => {
  for (const status of ALL) assert.deepEqual(states(plan({ status, repo: 'uplift/lab', current: 1 })), [null, null, null], status);
  assert.equal(isBoardPlan(plan({ repo: 'uplift/lab' })), true);
  assert.equal(isBoardPlan(plan({})), false);
});

test('buttons: none for a non-trusted viewer, any status, both drivers', () => {
  for (const status of ALL) for (const repo of [undefined, 'uplift/lab'])
    assert.deepEqual(planButtons(plan({ status, repo }), false), [], `${status} ${repo}`);
});

test('buttons: trusted, briefling driver', () => {
  const b = (status: PlanStatus, over: Partial<Plan> = {}) => planButtons(plan({ status, ...over }), true);
  assert.deepEqual(b('open'), ['start', 'dismiss']);
  assert.deepEqual(b('running', { current: 1 }), ['stop']);
  assert.deepEqual(b('failed', { current: 1, error: 'refused' }), [], 'over: the hub neither retries nor dismisses it');
  for (const s of ['pending', 'done', 'stopped', 'dismissed'] as const) assert.deepEqual(b(s), [], s);
});

test('buttons: « threads » module off: no Launch (it opens threads), closing and stopping stay', () => {
  assert.deepEqual(planButtons(plan({ status: 'open' }), true, false), ['dismiss']);
  assert.deepEqual(planButtons(plan({ status: 'running', current: 1 }), true, false), ['stop']);
  assert.deepEqual(planButtons(plan({ status: 'open' }), false, false), []);
});

test('buttons: trusted, board driver (no Stop; Not now gone once an issue exists)', () => {
  const repo = 'uplift/lab';
  const b = (status: PlanStatus, over: Partial<Plan> = {}) => planButtons(plan({ status, repo, ...over }), true);
  assert.deepEqual(b('open'), ['start', 'dismiss']);
  assert.deepEqual(b('running'), []);
  assert.deepEqual(b('pending'), []);
  assert.deepEqual(b('failed', { error: 'not_installed' }), ['start', 'dismiss']);
  const one = [{ ...steps[0], number: 12, url: 'https://github.com/uplift/lab/issues/12' }, steps[1], steps[2]];
  assert.deepEqual(b('failed', { error: 'github', steps: one }), ['start']);
  for (const s of ['done', 'stopped', 'dismissed'] as const) assert.deepEqual(b(s), [], s);
});

test('planHasIssues and planProgress', () => {
  assert.equal(planHasIssues(plan({})), false);
  assert.equal(planHasIssues(plan({ steps: [steps[0], { ...steps[1], number: 3 }] })), true);
  assert.deepEqual(planProgress(plan({ status: 'running', current: 1 })), { i: 2, n: 3 });
  assert.deepEqual(planProgress(plan({ status: 'running' })), { i: 1, n: 3 });
  assert.deepEqual(planProgress(plan({ status: 'running', current: 9 })), { i: 3, n: 3 });
});


test('planStepThreads: the steps of the same plan by index, null when not opened; other plans ignored', () => {
  const link = { parent: 't1', card: 'c1', step: 1, of: 4 };
  const th = [
    { id: 'a', plan: { parent: 't1', card: 'c1', step: 0, of: 4 } },
    { id: 'b', plan: link },
    { id: 'x', plan: { parent: 't1', card: 'c2', step: 2, of: 4 } },
    { id: 'y', plan: { parent: 't9', card: 'c1', step: 3, of: 4 } },
    { id: 'z', plan: { parent: 't1', card: 'c1', step: 7, of: 4 } },
    { id: 'n' },
  ];
  assert.deepEqual(planStepThreads(link, th), ['a', 'b', null, null]);
});
