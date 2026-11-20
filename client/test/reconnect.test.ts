import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconnector, BACKOFF, type Timers } from '../src/reconnect.ts';

/** Manual timers: `fire()` runs the scheduled attempt, `delays` lists every wait asked. */
function fake() {
  let next = 1;
  const jobs = new Map<number, () => void>(), delays: number[] = [];
  const timers: Timers = {
    set: (fn, ms) => { jobs.set(next, fn); delays.push(ms); return next++; },
    clear: (id) => { jobs.delete(id); },
  };
  const fire = async () => { const [[id, fn]] = jobs; jobs.delete(id); fn(); await new Promise(r => setImmediate(r)); };
  return { timers, jobs, delays, fire };
}
const tick = () => new Promise(r => setImmediate(r));

test('a token refresh that throws offline schedules the next attempt (no WebSocket, so no onclose)', async () => {
  const f = fake(), errors: unknown[] = [];
  let calls = 0;
  const r = reconnector(async () => { calls++; if (calls < 3) throw new TypeError('Failed to fetch'); }, e => errors.push(e), f.timers);
  await r.start();
  assert.equal(r.waiting(), true, 'the failed start is retried');
  await f.fire();
  assert.equal(r.waiting(), true, 'still failing: retried again');
  await f.fire();
  assert.equal(calls, 3);
  assert.equal(r.waiting(), false, 'opened: nothing scheduled');
  assert.deepEqual(f.delays, BACKOFF.slice(0, 2), 'same backoff as a lost WebSocket');
  assert.equal(errors.length, 2);
});

test('lost WebSocket: backoff grows up to 30 s, and starts again once connected', async () => {
  const f = fake();
  const r = reconnector(async () => {}, () => {}, f.timers);
  await r.start();
  for (let i = 0; i < 8; i++) { r.failed(); await f.fire(); }
  assert.deepEqual(f.delays, [...BACKOFF, 30000, 30000]);
  r.opened(); r.failed();
  assert.equal(f.delays.at(-1), 500);
});

test('now() skips the wait (back online, tab shown, banner clicked); nothing to skip when connected', async () => {
  const f = fake();
  let calls = 0;
  const r = reconnector(async () => { calls++; }, () => {}, f.timers);
  await r.start();
  assert.equal(r.now(), false, 'connected: no attempt');
  r.failed();
  assert.equal(r.now(), true);
  await tick();
  assert.equal(calls, 2);
  assert.equal(f.jobs.size, 0, 'the scheduled attempt is cancelled');
});

test('one attempt at a time: a loss reported while an attempt runs schedules nothing more', async () => {
  const f = fake();
  let release!: () => void;
  const r = reconnector(() => new Promise<void>(ok => { release = ok; }), () => {}, f.timers);
  const first = r.start();
  r.failed();
  assert.equal(r.waiting(), false);
  release(); await first;
  r.failed(); r.failed();
  assert.equal(f.jobs.size, 1);
});
