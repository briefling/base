// Secrets handed to an agent (« Secret » button of the composer), end to end encrypted.
//
// The agent's plugin holds a P-256 key pair in memory (new at every gateway start) and reports the public key at
// subscribe. A trusted human's browser encrypts the value for that key (WebCrypto, no library):
//   shared = ECDH(ephemeral private, agent public)                      (32 bytes, x coordinate)
//   key    = HKDF-SHA256(shared, salt = epk || agent public, info = SECRET_INFO, 32 bytes)
//   ct     = AES-256-GCM(key, iv (12 random bytes), value UTF-8, aad = secretAad(...))   (tag appended, WebCrypto layout)
// epk, iv, ct and keys travel as base64url without padding. The hub relays the ciphertext to the live connections of
// the instance holding that key and stores nothing of it: only a line « X shared NAME with agent » (name, kind,
// status). The AAD binds the ciphertext to its space, thread, agent, name and kind: a hub that relabels it makes the
// decryption fail. The plugin decrypts, writes the value outside the conversation and tells the agent where it is.

export const SECRET_KINDS = ['password', 'api_key', 'private_key', 'totp'] as const;
export type SecretKind = typeof SECRET_KINDS[number];
export const SECRET_INFO = 'briefling-secret-v1';
/** Name of a secret: also its file name on the agent side and a natural env var name. */
export const SECRET_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
/** Value bound (UTF-8 bytes): a PEM private key fits, the frame stays far under the WebSocket limit. */
export const SECRET_VALUE_MAX = 8192;
/** Uncompressed P-256 point (65 bytes, first byte 0x04) in base64url: 87 characters starting with « B ». */
export const SECRET_KEY_RE = /^B[A-Za-z0-9_-]{86}$/;
/** 12-byte GCM nonce in base64url. */
export const SECRET_IV_RE = /^[A-Za-z0-9_-]{16}$/;
/** Ciphertext + 16-byte tag in base64url, bounded by SECRET_VALUE_MAX. */
export const SECRET_CT_MAX = Math.ceil((SECRET_VALUE_MAX + 16) * 4 / 3);
export const SECRET_CT_RE = /^[A-Za-z0-9_-]+$/;

/** Status of the line in the thread: relayed, written on the agent side, or refused there (stale key, store error). */
export type SecretStatus = 'sent' | 'received' | 'failed';
/** `Message.secret`: the line « by shared name with agent », never the value. */
export interface SecretLine { name: string; kind: SecretKind; agent: string; by: string; status: SecretStatus }

export const isSecretKind = (x: unknown): x is SecretKind => typeof x === 'string' && (SECRET_KINDS as readonly string[]).includes(x);

/** Additional data of the AES-GCM encryption (same string on both sides). */
export function secretAad(space: string, thread: string, agent: string, name: string, kind: SecretKind): string {
  return [SECRET_INFO, space, thread, agent, name, kind].join('\n');
}
