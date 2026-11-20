import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retryThrottled, frameKind, bodyKind, RETRY_WAITS_MS } from '../src/throttle.ts';

const tooMany = (name = 'TooManyRequestsException') => Object.assign(new Error('Too Many Requests'), { name });

test('retryThrottled: a 429 then a success is retried after a growing, bounded wait', async () => {
  const waits: number[] = []; let n = 0;
  const r = await retryThrottled(async () => { if (++n < 3) throw tooMany(n === 1 ? 'LimitExceededException' : undefined); return 'ok' }, 'x', async ms => { waits.push(ms) });
  assert.equal(r, 'ok'); assert.equal(n, 3);
  assert.equal(waits.length, 2);
  assert.ok(waits[0] >= RETRY_WAITS_MS[0] && waits[0] <= RETRY_WAITS_MS[0] * 1.5);
  assert.ok(waits[1] >= RETRY_WAITS_MS[1] && waits[1] <= RETRY_WAITS_MS[1] * 1.5);
});

test('retryThrottled: still throttled after the last try = logged send_throttled <frame> <conn>, then the 429 is thrown', async () => {
  const waits: number[] = []; let n = 0; const logged: unknown[][] = [];
  const err = console.error; console.error = (...a: unknown[]) => { logged.push(a) };
  try { await assert.rejects(retryThrottled(async () => { n++; throw tooMany() }, 'event:message.created c1', async ms => { waits.push(ms) }), /Too Many/); }
  finally { console.error = err; }
  assert.equal(n, RETRY_WAITS_MS.length + 1);
  assert.ok(waits.reduce((a, b) => a + b, 0) <= RETRY_WAITS_MS.reduce((a, b) => a + b, 0) * 1.5, 'total wait bounded');
  assert.deepEqual(logged, [['send_throttled', 'event:message.created c1']]);
});

test('retryThrottled: any other error is thrown at once, no retry', async () => {
  let n = 0;
  await assert.rejects(retryThrottled(async () => { n++; throw Object.assign(new Error('gone'), { name: 'GoneException' }) }, 'x', async () => {}), /gone/);
  assert.equal(n, 1);
});

test('frameKind / bodyKind: short log-safe labels, never the content', () => {
  assert.equal(frameKind({ v: 2, type: 'event', event: 'message.created', data: { text: 'secret' } }), 'event:message.created');
  assert.equal(frameKind({ type: 'deliver' }), 'deliver');
  assert.equal(frameKind({ type: 'post\nfake log line' }), '?');
  assert.equal(frameKind(null), '?');
  assert.equal(bodyKind('{"v":2,"type":"post","text":"hello"}'), 'post');
  assert.equal(bodyKind('{not json'), '?');
});
