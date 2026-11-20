import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { openOidc, oidcFromEnv, type OidcConfig } from '../src/oidc.ts';

const ISS = 'http://127.0.0.1:5556/dex', INTERNAL = 'http://dex:5556/dex';
const b64 = (x: object | Buffer) => (Buffer.isBuffer(x) ? x : Buffer.from(JSON.stringify(x))).toString('base64url');
const keyOf = (kid: string) => { const k = generateKeyPairSync('rsa', { modulusLength: 2048 }); return { kid, ...k, jwk: { ...k.publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' } } };
const good = keyOf('k1'), other = keyOf('k2');
function jwt(claims: Record<string, unknown>, key = good) {
  const head = b64({ alg: 'RS256', typ: 'JWT', kid: key.kid }), body = b64({ iss: ISS, aud: 'briefling', exp: Math.floor(Date.now() / 1000) + 600, iat: Math.floor(Date.now() / 1000), ...claims });
  return `${head}.${body}.${createSign('RSA-SHA256').update(`${head}.${body}`).sign(key.privateKey).toString('base64url')}`;
}
const fetched: string[] = [];
const res = (o: unknown, ok = true) => ({ ok, json: async () => o, arrayBuffer: async () => { const b = Buffer.from(JSON.stringify(o)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length) } });
const fakeFetch = (discoveryIssuer = ISS) => async (u: string) => {
  fetched.push(u);
  if (u === `${INTERNAL}/.well-known/openid-configuration`) return res({ issuer: discoveryIssuer, jwks_uri: `${ISS}/keys` });
  if (u === `${INTERNAL}/keys`) return res({ keys: [good.jwk] });
  return res({}, false);
};
const cfg: OidcConfig = { issuer: ISS, clientId: 'briefling', admins: ['boss@example.org'], internalUrl: INTERNAL };
const DAY = 86_400_000;
const open = (o: Partial<Parameters<typeof openOidc>[2]> = {}) => openOidc(new DatabaseSync(':memory:'), cfg, { fetch: fakeFetch(), firstAdmin: 'admin', ...o });

test('config from the environment: off, refused, defaults', () => {
  assert.equal(oidcFromEnv({}), null);
  assert.throws(() => oidcFromEnv({ BRIEFLING_OIDC_ISSUER: 'http://dex.example.org/dex', BRIEFLING_OIDC_ADMINS: 'a@b.co' }), /https, or http on loopback/);
  assert.throws(() => oidcFromEnv({ BRIEFLING_OIDC_ISSUER: 'https://dex.example.org/dex' }), /ADMINS is empty/);
  assert.deepEqual(oidcFromEnv({ BRIEFLING_OIDC_ISSUER: 'https://x.example.org/dex/', BRIEFLING_OIDC_ADMINS: ' Boss@Example.org, nope ', BRIEFLING_OIDC_INTERNAL_URL: 'http://dex:5556/dex' }),
    { issuer: 'https://x.example.org/dex', clientId: 'briefling', admins: ['boss@example.org'], internalUrl: 'http://dex:5556/dex' });
});

test('ID token: signature, issuer, audience, expiry, keys fetched at the internal address', async () => {
  const o = open();
  assert.equal((await o.verify(jwt({ sub: 's1' })))?.sub, 's1');
  assert.ok(fetched.includes(`${INTERNAL}/keys`), 'the keys come from the compose network address');
  assert.equal(await o.verify(jwt({ sub: 's1', aud: 'other-client' })), null, 'another client of the provider');
  assert.equal(await o.verify(jwt({ sub: 's1', iss: 'http://127.0.0.1:9999/dex' })), null, 'another issuer');
  assert.equal(await o.verify(jwt({ sub: 's1', exp: Math.floor(Date.now() / 1000) - 60 })), null, 'expired');
  assert.equal(await o.verify(jwt({ sub: 's1' }, other)), null, 'a key the provider does not publish');
  assert.equal(await o.verify(jwt({ sub: 's1' }).slice(0, -4) + 'AAAA'), null, 'signature changed');
  assert.equal(await o.verify('not-a-jwt'), null, 'the admin token of the mode without OIDC');
  assert.equal(await o.verify(jwt({})), null, 'no sub');
});

test('a discovery document naming another issuer: refused, nothing verified', async () => {
  const o = open({ fetch: fakeFetch('https://evil.example') });
  await assert.rejects(o.verify(jwt({ sub: 's1' })), /issuer/);
});

test('sign-in: admins of the config, invitations (verified e-mail, 7 days), nobody else', async () => {
  const o = open();
  let now = Date.now();
  const me = (sub: string, email?: string, verified = true) => ({ iss: ISS, sub, ...(email ? { email, email_verified: verified } : {}) });
  assert.equal(o.resolve(me('x', 'stranger@example.org'), now), null, 'unknown address: refused');
  assert.equal(o.resolve(me('b', 'boss@example.org', false), now), null, 'admin address not verified: refused');
  const boss = o.resolve(me('b', 'Boss@Example.org'), now)!;
  assert.deepEqual([boss.id, boss.admin, boss.first], ['admin', true, true], 'the first admin takes the seeded user');
  assert.deepEqual(o.resolve(me('b'), now), { id: 'admin', admin: false, first: false, name: 'Member' }, 'known identity: no e-mail needed');
  const second = o.resolve(me('b2', 'boss@example.org'), now)!;
  assert.match(second.id, /^u[0-9a-f]{24}$/, 'another identity with an admin address: a new user, not the first one');

  const { id, created } = await o.users.invite('Ann@Example.org');
  assert.equal(created, true);
  assert.deepEqual(await o.users.findByEmail('ann@example.org'), [id]);
  assert.ok((await o.users.pending()).has(id));
  assert.equal(o.resolve(me('a', 'ann@example.org', false), now), null, 'invited, e-mail not verified: refused');
  now += 8 * DAY;
  assert.equal(o.resolve(me('a', 'ann@example.org'), now), null, 'invitation past 7 days: refused');
  o.users.resend(id); // `now` of the hub's clock: the real one
  now = Date.now() + DAY;
  const ann = o.resolve(me('a', 'ann@example.org', true), now)!;
  assert.deepEqual([ann.id, ann.admin, ann.first, ann.name], [id, false, true, 'Ann']);
  assert.equal((await o.users.pending()).has(id), false, 'signed in: no longer pending');
  assert.equal(await o.users.resend(id), false);
  assert.equal(o.resolve(me('a2', 'ann@example.org'), now), null, 'another identity with her address once she signed in: refused (no takeover)');
  assert.equal(o.resolve({ iss: 'http://other', sub: 'a' }, now), null, 'same sub, another issuer: another identity');
});
