import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pushApp, showAskBanner, b64urlToBytes, sameKey, pushPlan, anyFocused, notificationOf, notifMsg, setBadge, shellKey, SHELL, pendingTarget, NOTIF_TTL } from '../src/push.ts';
import { splitMsg } from '../src/link.ts';

test('b64urlToBytes / sameKey: the VAPID key compared byte for byte (rotated key = re-subscribe)', () => {
  const key = Buffer.from([4, 250, 251, 1, 2, 3, 62, 63]).toString('base64url');
  assert.deepEqual([...b64urlToBytes(key)], [4, 250, 251, 1, 2, 3, 62, 63]);
  assert.ok(sameKey(b64urlToBytes(key).buffer, key));
  assert.ok(!sameKey(b64urlToBytes(key).buffer, Buffer.from([4, 250, 251, 1, 2, 3, 62, 64]).toString('base64url')));
  assert.ok(!sameKey(null, key));
});

test('pushPlan: follows the bell and the permission; another account\'s subscription is dropped first', () => {
  assert.equal(pushPlan(true, false, 'granted', false, null, 'me'), 'off', 'no PushManager (iOS Safari tab)');
  assert.equal(pushPlan(true, true, 'granted', false, null, 'me'), 'subscribe');
  assert.equal(pushPlan(true, true, 'granted', true, 'me', 'me'), 'subscribe', 'refreshed at every connection');
  assert.equal(pushPlan(true, true, 'default', false, null, 'me'), 'off', 'permission not given yet');
  assert.equal(pushPlan(true, true, 'denied', true, 'me', 'me'), 'unsubscribe');
  assert.equal(pushPlan(false, true, 'granted', true, 'me', 'me'), 'unsubscribe', 'bell turned off');
  assert.equal(pushPlan(false, true, 'granted', false, null, 'me'), 'off');
  assert.equal(pushPlan(true, true, 'granted', true, 'alice', 'me'), 'unsubscribe', 'alice\'s pushes must not reach me');
});

test('anyFocused: only a visible AND focused tab silences the push', () => {
  assert.ok(!anyFocused([]));
  assert.ok(!anyFocused([{ focused: false, visibilityState: 'visible' }, { focused: true, visibilityState: 'hidden' }]));
  assert.ok(anyFocused([{ focused: false, visibilityState: 'hidden' }, { focused: true, visibilityState: 'visible' }]));
});

test('notificationOf: our payload only, tag = thread, url = the thread route', () => {
  assert.deepEqual(notificationOf({ title: 'Sensor fix', body: 'Your turn · Civic', thread: 't1', space: 'civic' }),
    { title: 'Sensor fix', body: 'Your turn · Civic', tag: 't1', thread: 't1', space: 'civic', url: '/#/civic/t1' });
  for (const bad of [null, 'x', { title: 'a', body: 'b', thread: 't1' }, { title: '', body: 'b', thread: 't', space: 's' }, { title: 'a', body: 'b', thread: 1, space: 's' }])
    assert.equal(notificationOf(bad), null);
  assert.equal(notificationOf({ title: 'a', body: 'b', thread: '../x', space: 'a/b' })!.url, '/#/a%2Fb/..%2Fx');
});

test('notificationOf: the message it is about rides along, the URL is its message link (new window jumps to it)', () => {
  const n = notificationOf({ title: 'Milan · Sensor fix', body: 'Tu valides ?', thread: 't1', space: 'civic', msg: 'm42' })!;
  assert.equal(n.msg, 'm42');
  assert.equal(n.url, '/#/civic/t1/m/m42');
  assert.deepEqual(splitMsg(n.url.slice(1)), { route: '#/civic/t1', msg: 'm42' }, 'the client router reads it back');
  assert.equal(notificationOf({ title: 'a', body: 'b', thread: 't1', space: 's', msg: 'a/b' })!.url, '/#/s/t1/m/a%2Fb');
  for (const bad of [undefined, '', 7, 'x'.repeat(65)]) {
    const o = notificationOf({ title: 'a', body: 'b', thread: 't1', space: 's', msg: bad })!;
    assert.equal(o.url, '/#/s/t1'); assert.ok(!('msg' in o), 'a bad id is dropped, the thread still opens');
  }
  assert.equal(notifMsg('m1'), 'm1'); assert.equal(notifMsg(null), null); assert.equal(notifMsg({}), null);
});

test('notificationOf: a memory reminder has no thread, opens the space\'s Memory view, one per space', () => {
  assert.deepEqual(notificationOf({ title: 'Project memory', body: '3 memory entries to review in Civic', space: 'civic', view: 'memory' }),
    { title: 'Project memory', body: '3 memory entries to review in Civic', tag: 'memory:civic', thread: '', space: 'civic', view: 'memory', url: '/#/civic/memory' });
  assert.equal(notificationOf({ title: 'a', body: 'b', space: 'civic' }), null, 'neither a thread nor the memory view');
  assert.equal(notificationOf({ title: 'a', body: 'b', space: 'civic', view: 'other' }), null);
  assert.equal(notificationOf({ title: 'a', body: 'b', space: 'a/b', view: 'memory' })!.url, '/#/a%2Fb/memory');
});

test('notificationOf: the app badge total rides along, a bad value is dropped and the notification kept', () => {
  const base = { title: 'a', body: 'b', thread: 't1', space: 's' };
  assert.equal(notificationOf({ ...base, badge: 3 })!.badge, 3);
  assert.equal(notificationOf({ ...base, badge: 0 })!.badge, 0, '0 = clear the badge');
  assert.equal(notificationOf({ title: 'a', body: 'b', space: 's', view: 'memory', badge: 2 })!.badge, 2);
  for (const bad of [-1, 1.5, '3', 1e9, null, NaN]) {
    const n = notificationOf({ ...base, badge: bad });
    assert.ok(n && !('badge' in n), String(bad));
  }
  assert.ok(!('badge' in notificationOf(base)!), 'older hub: no badge, untouched');
});

test('setBadge: count set, 0 clears, nothing without the API, a refusal never throws', async () => {
  const calls: string[] = [];
  const nav = { setAppBadge: async (n: number) => { calls.push(`set ${n}`) }, clearAppBadge: async () => { calls.push('clear') } };
  await setBadge(nav, 4); await setBadge(nav, 0);
  assert.deepEqual(calls, ['set 4', 'clear']);
  await setBadge({}, 4); // Android, Firefox
  await setBadge({ setAppBadge: async () => { throw new DOMException('denied', 'NotAllowedError') }, clearAppBadge: async () => {} }, 1);
});

test('shellKey: same-origin app shell only, never the hub, the files bucket nor anything else', () => {
  const o = 'https://app.test';
  assert.equal(shellKey('https://app.test/?code=abc&state=x', o, true), '/', 'OAuth return = the index');
  assert.equal(shellKey('https://app.test/#/civic/t1', o, true), '/');
  assert.equal(shellKey('https://app.test/agent.md?code=x', o, true), null, 'agent page: not the app');
  assert.equal(shellKey('https://app.test/a/AAAAAAAAAAAAAAAAAAAAAA/#/civic/applets/x', o, true), '/', 'a pinned applet\'s app: the same page');
  assert.equal(shellKey('https://app.test/a/AAAAAAAAAAAAAAAAAAAAAA/manifest.webmanifest', o, false), null, 'its files: never cached by the worker');
  assert.equal(shellKey('https://app.test/a/short/', o, true), null);
  assert.equal(shellKey('https://app.test/app.js', o, false), '/app.js');
  assert.equal(shellKey('https://app.test/config.json?v=2', o, false), '/config.json');
  assert.equal(shellKey('https://app.test/sw.js', o, false), null);
  assert.equal(shellKey('https://files.s3.test/f/x', o, false), null);
  assert.equal(shellKey('https://evil.test/app.js', o, false), null);
  assert.ok(SHELL.includes('/'));
});

test('pushApp: briefling\'s own app notifies, never a pinned applet\'s app (a second iOS subscription = every notification twice)', () => {
  assert.equal(pushApp('/'), true);
  assert.equal(pushApp('/index.html'), true);
  assert.equal(pushApp('/a/AAAAAAAAAAAAAAAAAAAAAA/'), false);
});

test('showAskBanner: installed app, push supported, permission never asked, alerts on, not dismissed', () => {
  assert.ok(showAskBanner(true, true, 'default', true, false));
  assert.ok(!showAskBanner(false, true, 'default', true, false), 'browser tab: the bell is enough');
  assert.ok(!showAskBanner(true, false, 'default', true, false));
  assert.ok(!showAskBanner(true, true, 'granted', true, false), 'answered: gone');
  assert.ok(!showAskBanner(true, true, 'denied', true, false));
  assert.ok(!showAskBanner(true, true, 'default', false, false), 'bell turned off by hand');
  assert.ok(!showAskBanner(true, true, 'default', true, true), '« Later »');
});

test('notificationOf: a reminder with its source conversation opens it on the card, tag per reminder; without, Reminders', () => {
  const n = notificationOf({ title: 'Coller le snippet', body: 'Rappels · Briefling', space: 'bf', view: 'reminders', thread: 't1', msg: 'm1' })!;
  assert.deepEqual([n.url, n.tag, n.thread, n.msg, n.view], ['/#/bf/t1/m/m1', 'reminders:bf:Coller le snippet', 't1', 'm1', undefined]);
  const o = notificationOf({ title: 'Payer', body: 'Rappels · Perso', space: 'p', view: 'reminders' })!;
  assert.deepEqual([o.url, o.view, o.thread], ['/#/p/reminders', 'reminders', '']);
});

test('pendingTarget: the stored tap opens once, only if fresh and well formed', () => {
  const now = 1_000_000;
  assert.deepEqual(pendingTarget({ space: 'jyd', thread: 't1', msg: 'm9', at: now - 5_000 }, now), { space: 'jyd', thread: 't1', msg: 'm9', at: now - 5_000 });
  assert.deepEqual(pendingTarget({ space: 'jyd', thread: '', view: 'memory', at: now }, now), { space: 'jyd', thread: '', view: 'memory', at: now });
  assert.equal(pendingTarget({ space: 'jyd', thread: 't1', at: now - NOTIF_TTL }, now), null, '60 s old: an ordinary start');
  assert.equal(pendingTarget({ space: 'jyd', thread: 't1', at: now + 1_000 }, now), null, 'from the future (clock moved)');
  assert.deepEqual(pendingTarget({ space: 'jyd', thread: 't1', msg: 7, at: now }, now), { space: 'jyd', thread: 't1', at: now }, 'bad msg dropped, thread kept');
  for (const bad of [null, 'x', {}, { space: '', thread: 't1', at: now }, { space: 'jyd', thread: 't1' }, { space: 'jyd', thread: '', at: now }, { space: 'x'.repeat(65), thread: 't', at: now }])
    assert.equal(pendingTarget(bad, now), null, JSON.stringify(bad));
});
