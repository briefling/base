// « Secret » button: encrypts a value for the agent's public key in the browser (WebCrypto only, scheme in
// protocol/secret.ts). DOM-free, tested in client/test/secret.test.ts and against the plugin (scripts/secret-vector.ts).
import { SECRET_INFO, SECRET_NAME_RE, SECRET_VALUE_MAX, secretAad, type SecretKind } from '../../protocol/secret.ts';

export interface SecretMeta { space: string; thread: string; agent: string; name: string; kind: SecretKind }
export interface SecretBox { epk: string; iv: string; ct: string }

function b64u(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64u(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Why the form cannot be sent ('' = fine): name shape, empty or oversized value. */
export function secretFormError(name: string, value: string): '' | 'name' | 'empty' | 'too_long' {
  if (!SECRET_NAME_RE.test(name)) return 'name';
  if (!value) return 'empty';
  if (new TextEncoder().encode(value).length > SECRET_VALUE_MAX) return 'too_long';
  return '';
}

/** Name suggested from a free label: « Mot de passe DB » → « MOT_DE_PASSE_DB » (accents dropped, starts with a letter). */
export function suggestName(label: string): string {
  const s = label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^[^A-Z]+|_+$/g, '');
  return s.slice(0, 64).replace(/_+$/, '');
}

/** ECDH P-256 (ephemeral) + HKDF-SHA256 + AES-256-GCM, AAD bound to the space, thread, agent, name and kind. */
export async function encryptSecret(agentKey: string, meta: SecretMeta, value: string): Promise<SecretBox> {
  const subtle = crypto.subtle;
  const agentRaw = fromB64u(agentKey);
  const pub = await subtle.importKey('raw', agentRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const eph = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const epk = new Uint8Array(await subtle.exportKey('raw', eph.publicKey));
  const shared = await subtle.deriveBits({ name: 'ECDH', public: pub }, eph.privateKey, 256);
  const ikm = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const salt = new Uint8Array(epk.length + agentRaw.length);
  salt.set(epk); salt.set(agentRaw, epk.length);
  const key = await subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode(SECRET_INFO) }, ikm,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(secretAad(meta.space, meta.thread, meta.agent, meta.name, meta.kind));
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, new TextEncoder().encode(value));
  return { epk: b64u(epk), iv: b64u(iv), ct: b64u(ct) };
}
