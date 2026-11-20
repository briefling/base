import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret, secretFormError, suggestName } from '../src/secret.ts';
import { SECRET_CT_RE, SECRET_INFO, SECRET_IV_RE, SECRET_KEY_RE, secretAad } from '../../protocol/secret.ts';

const raw = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));

/** The agent side of protocol/secret.ts, on WebCrypto (the plugin does the same with `cryptography`). */
async function open(priv: CryptoKey, agentPub: string, box: { epk: string; iv: string; ct: string }, aad: string) {
  const epk = await crypto.subtle.importKey('raw', raw(box.epk), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: epk }, priv, 256);
  const ikm = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array([...raw(box.epk), ...raw(agentPub)]), info: new TextEncoder().encode(SECRET_INFO) },
    ikm, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw(box.iv), additionalData: new TextEncoder().encode(aad) }, key, raw(box.ct)));
}

test('encryptSecret: opens with the agent key and the same metadata only; fresh ephemeral key and nonce each time', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const pub = Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url');
  assert.match(pub, SECRET_KEY_RE);
  const meta = { space: 'civic', thread: 't1', agent: 'milan', name: 'DB_PASSWORD', kind: 'password' as const };
  const box = await encryptSecret(pub, meta, 'hunter2 é ✓');
  assert.match(box.epk, SECRET_KEY_RE); assert.match(box.iv, SECRET_IV_RE); assert.match(box.ct, SECRET_CT_RE);
  assert.equal(await open(pair.privateKey, pub, box, secretAad('civic', 't1', 'milan', 'DB_PASSWORD', 'password')), 'hunter2 é ✓');
  await assert.rejects(open(pair.privateKey, pub, box, secretAad('civic', 't1', 'milan', 'OTHER', 'password')), 'relabelled by the hub: refused');
  await assert.rejects(open(pair.privateKey, pub, box, secretAad('civic', 't2', 'milan', 'DB_PASSWORD', 'password')), 'moved to another thread: refused');
  const again = await encryptSecret(pub, meta, 'hunter2 é ✓');
  assert.notEqual(again.epk, box.epk); assert.notEqual(again.iv, box.iv); assert.notEqual(again.ct, box.ct);
});

test('secret form: name shape, empty and oversized values; a free label becomes a name', () => {
  assert.equal(secretFormError('DB_PASSWORD', 'x'), '');
  assert.equal(secretFormError('../etc', 'x'), 'name');
  assert.equal(secretFormError('1ABC', 'x'), 'name');
  assert.equal(secretFormError('A'.repeat(65), 'x'), 'name');
  assert.equal(secretFormError('A', ''), 'empty');
  assert.equal(secretFormError('A', 'é'.repeat(4097)), 'too_long', 'bytes, not characters');
  assert.equal(suggestName('Mot de passe DB'), 'MOT_DE_PASSE_DB');
  assert.equal(suggestName('  2fa github!'), 'FA_GITHUB');
  assert.equal(suggestName('***'), '');
});
