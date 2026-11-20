// Web Push wire format: what handlers/push.ts hands to web-push is decryptable by the device (RFC 8291 aes128gcm) and
// carries a VAPID header for the app's subject. Real P-256 keys, as a browser makes them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import webpush from 'web-push';
// @ts-expect-error no types: transitive dependency of web-push (same version), used here only to decrypt like a browser.
import ece from 'http_ece';
import { validPushSub, pushPayload, pushTopic, pushExcerpt, PUSH_EXCERPT_MAX } from '../src/push.ts';

test('push: a real browser subscription passes validPushSub and the encrypted body decrypts to the payload', () => {
  const device = createECDH('prime256v1'); device.generateKeys();
  const auth = randomBytes(16);
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/dev1', keys: { p256dh: device.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
  assert.ok(validPushSub(sub));
  const vapid = webpush.generateVAPIDKeys();
  const payload = JSON.stringify(pushPayload({ id: 't1', space: 'civic', title: 'Sensor fix' }, 'Civic', 'en'));
  const req = webpush.generateRequestDetails(sub, payload, { vapidDetails: { subject: 'https://app.briefling.test', ...vapid }, TTL: 60, urgency: 'high', topic: pushTopic('t1') });
  assert.equal(req.endpoint, sub.endpoint);
  assert.equal(req.headers['Content-Encoding'], 'aes128gcm');
  assert.equal(req.headers.Topic, pushTopic('t1'));
  assert.match(String(req.headers.Authorization), new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${vapid.publicKey}$`));
  const clear = ece.decrypt(req.body, { version: 'aes128gcm', privateKey: device, authSecret: auth.toString('base64url') });
  assert.deepEqual(JSON.parse(clear.toString()), { title: 'Sensor fix', body: 'Your turn · Civic', thread: 't1', space: 'civic' });
  assert.ok(!(req.body as Buffer).includes(Buffer.from('Sensor fix')), 'the push service only sees ciphertext');
});

test('pushExcerpt: Markdown dropped, one line, cut at a word by code point, control and bidi characters removed', () => {
  const cases: [string, string][] = [
    ['## Plan\n\n- **step** one\n- [x] `npm test`', 'Plan step one npm test'],
    ['> quoted *idea* and _this_ but not snake_case_name', 'quoted idea and this but not snake_case_name'],
    ['See [the doc](https://x.test/a) and ![shot](s.png) <https://y.test>', 'See the doc and shot https://y.test'],
    ['```ts\nconst a = 1;\n```\nafter', 'const a = 1; after'],
    ['| a | b |\n|---|:-:|\n| 1 | 2 |', 'a b 1 2'],
    ['1. first\n2) second\n\n---\n~~old~~ new', 'first second old new'],
    ['2 * 3 * 4 = 24, a*b', '2 * 3 * 4 = 24, a*b'],
    ['evil\u202eetxt\u0007 bell', 'evil etxt bell'],
    ['@Milan   tu   peux ?', '@Milan tu peux ?'],
    ['```\n```', ''],
  ];
  for (const [inp, out] of cases) assert.equal(pushExcerpt(inp), out, inp);
  const long = pushExcerpt('mot '.repeat(100));
  assert.ok([...long].length <= PUSH_EXCERPT_MAX && long.endsWith('mot…'), long);
  const emoji = pushExcerpt('😀'.repeat(200));
  assert.equal([...emoji].length, PUSH_EXCERPT_MAX); assert.ok(emoji.endsWith('😀…'), 'never inside an emoji');
  assert.equal(pushExcerpt('a, b; c: d', 5), 'a, b…', 'trailing punctuation dropped before the ellipsis');
});

test('pushPayload: excerpt forms, title capped below the service worker limit', () => {
  const t = { id: 't1', space: 'civic', title: 'Sensor fix' };
  assert.deepEqual(pushPayload(t, 'Civic', 'fr', 'Milan', undefined, 'Tu valides ?'), { title: 'Milan · Sensor fix', body: 'Tu valides ?', thread: 't1', space: 'civic' });
  assert.equal(pushPayload(t, 'Civic', 'fr', undefined, 2, 'Valider le brief').body, 'À toi : Valider le brief · Civic');
  assert.equal(pushPayload(t, 'Civic', 'fr', 'Joachim').body, 'Joachim a écrit · Civic');
  assert.ok([...pushPayload({ ...t, title: 'x'.repeat(300) }, 'Civic', 'en', 'Milan', undefined, 'hi').title].length <= 120);
});
