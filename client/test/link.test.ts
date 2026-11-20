import { test } from 'node:test';
import assert from 'node:assert/strict';
import { msgRoute, splitMsg, linkUrl } from '../src/link.ts';

test('msgRoute: thread route + /m/<msg>, id encoded', () => {
  assert.equal(msgRoute('#/e2e/t205', 'm3005'), '#/e2e/t205/m/m3005');
  assert.equal(msgRoute('#/e2e/t205', 'a/b c'), '#/e2e/t205/m/a%2Fb%20c');
});

test('splitMsg: round trip of a message link', () => {
  assert.deepEqual(splitMsg(msgRoute('#/e2e/t205', 'm3005')), { route: '#/e2e/t205', msg: 'm3005' });
  assert.deepEqual(splitMsg(msgRoute('#/e2e/t205', 'a/b c')), { route: '#/e2e/t205', msg: 'a/b c' });
  assert.deepEqual(splitMsg('#/e2e/t205/m/m3005/'), { route: '#/e2e/t205', msg: 'm3005' });
  // A shelf route before the thread (Lounge, Later, Closed) keeps working.
  assert.deepEqual(splitMsg('#/e2e/lounge/t900/m/m9000'), { route: '#/e2e/lounge/t900', msg: 'm9000' });
});

test('splitMsg: older links unchanged, no message', () => {
  for (const h of ['', '#', '#/now', '#/e2e', '#/e2e/t205', '#/e2e/lounge/t900', '#/e2e/settings/work', '#/new-space'])
    assert.deepEqual(splitMsg(h), { route: h, msg: null });
});

test('splitMsg: a space or thread named « m » is not a message suffix', () => {
  assert.deepEqual(splitMsg('#/m/t1'), { route: '#/m/t1', msg: null });
  assert.deepEqual(splitMsg('#/e2e/m'), { route: '#/e2e/m', msg: null });
  assert.deepEqual(splitMsg('#/m/m/x'), { route: '#/m/m/x', msg: null }); // space « m », thread « m », then junk: parsed as before
  assert.deepEqual(splitMsg('#/m/m/m/x'), { route: '#/m/m', msg: 'x' }); // thread « m » of space « m », message x
});

test('splitMsg: malformed or empty message id dropped, thread kept', () => {
  assert.deepEqual(splitMsg('#/e2e/t205/m/%E0%A4%A'), { route: '#/e2e/t205', msg: null });
  assert.deepEqual(splitMsg('#/e2e/t205/m/'), { route: '#/e2e/t205/m/', msg: null }); // no id: parsed as before
  assert.deepEqual(splitMsg('#/e2e/t205/m/x/y'), { route: '#/e2e/t205/m/x/y', msg: null });
});

test('linkUrl: origin + path + route', () => {
  assert.equal(linkUrl({ origin: 'https://app.test', pathname: '/' }, '#/e2e/t205'), 'https://app.test/#/e2e/t205');
});
