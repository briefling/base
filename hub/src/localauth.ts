// Standalone server's auth (hub/src/server.ts), the Jupyter model: the server listens on loopback only and prints a URL
// carrying a random admin token, generated at the first start and kept in the data folder (0600). The browser sends it
// like the Cognito access token (Sec-WebSocket-Protocol). Agents get their key at `agent.join` (AgentClients, as on
// AWS where it is a Cognito app client): only its SHA-256 is stored (a 256-bit random secret: no slow hash needed).
// They trade it at /oauth2/token (client_credentials, HTTP Basic, like Cognito) for a stateless access token HMAC-signed
// with the server key: it survives a restart; the instance record and the key row are re-checked at every connection
// (a removed agent is refused at once, its last token still well-formed).
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import type { AgentClients } from './router.ts';

export const ADMIN_USER = 'admin'; // the one human of a standalone server without OIDC (global admin, seeded)
export const INSTANCE_SCOPE = 'briefling/instance';
const ACCESS_TTL_S = 3600;
const TOKEN_PREFIX = 'bl1.';
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

/** Where the server may listen: loopback always; any other address only with OIDC in front (not built yet), or in the
 * image (`container`, BRIEFLING_CONTAINER=1 set by the Dockerfile): there the address is the container's own network,
 * and what reaches it is the compose file's published port (127.0.0.1 by default) or the TLS proxy of the `tls` profile. */
export function bindAllowed(host: string, oidc: boolean, container = false): boolean { return LOOPBACK.has(host) || oidc || container }

/** The address browsers and agents are given (BRIEFLING_URL): plain http on loopback, else https (a TLS proxy in
 * front). Plain http beyond loopback would carry the admin token and the agents' keys in clear: refused. An origin only. */
export function publicUrlAllowed(url: URL): boolean {
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) return false;
  return url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname.replace(/^\[(.*)\]$/, '$1')));
}

const sha = (s: string | Buffer) => createHash('sha256').update(s).digest();
const same = (a: string, b: string) => timingSafeEqual(sha(a), sha(b)); // fixed length: no length oracle

/** A secret of the data folder: read, or created (0600) at the first start. */
function secretFile(path: string): string {
  if (existsSync(path)) return readFileSync(path, 'utf8').trim();
  const v = randomBytes(32).toString('base64url');
  writeFileSync(path, v + '\n', { mode: 0o600, flag: 'wx' });
  chmodSync(path, 0o600);
  return v;
}

export interface LocalAuth {
  adminToken: string;
  /** The human behind a WebSocket token, or null. */
  human(token: string): string | null;
  /** The instance (client id) of an access token, or null: signature and expiry only, the caller checks the records. */
  instance(token: string, now: number): string | null;
  /** Key row of an instance still there (not removed). */
  hasKey(id: string): boolean;
  agentClients(tokenUrl: string): AgentClients;
  /** /oauth2/token: HTTP status and JSON body. */
  token(authorization: string | undefined, form: URLSearchParams, now: number): { status: number; body: Record<string, unknown> };
}

export function openLocalAuth(db: DatabaseSync, dir: string): LocalAuth {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const adminToken = secretFile(`${dir}/admin-token`), key = secretFile(`${dir}/server-key`);
  db.exec('CREATE TABLE IF NOT EXISTS agent_keys (id TEXT PRIMARY KEY, agent TEXT NOT NULL, hash TEXT NOT NULL, at INTEGER NOT NULL)');
  const getKey = db.prepare('SELECT hash FROM agent_keys WHERE id = ?');
  const sign = (body: string) => createHmac('sha256', key).update(body).digest('base64url');
  const access = (id: string, exp: number) => `${TOKEN_PREFIX}${id}.${exp}.${sign(`${id}.${exp}`)}`;
  const deny = { status: 401, body: { error: 'invalid_client' } };
  return {
    adminToken,
    human: t => !t.startsWith(TOKEN_PREFIX) && same(t, adminToken) ? ADMIN_USER : null,
    instance(t, now) {
      const m = /^bl1\.([a-f0-9]{26})\.(\d{10,13})\.([A-Za-z0-9_-]{43})$/.exec(t);
      if (!m || !same(m[3], sign(`${m[1]}.${m[2]}`)) || Number(m[2]) * 1000 <= now) return null;
      return m[1];
    },
    hasKey: id => !!getKey.get(id),
    agentClients: tokenUrl => ({
      async create(agent) {
        const id = randomBytes(13).toString('hex'), secret = randomBytes(32).toString('base64url');
        db.prepare('INSERT INTO agent_keys (id, agent, hash, at) VALUES (?, ?, ?, ?)').run(id, agent, sha(secret).toString('hex'), Date.now());
        return { id, secret, tokenUrl };
      },
      async remove(id) { db.prepare('DELETE FROM agent_keys WHERE id = ?').run(id) },
    }),
    token(authorization, form, now) {
      if (form.get('grant_type') !== 'client_credentials') return { status: 400, body: { error: 'unsupported_grant_type' } };
      if (form.has('scope') && form.get('scope') !== INSTANCE_SCOPE) return { status: 400, body: { error: 'invalid_scope' } };
      const m = /^Basic ([A-Za-z0-9+/=]{1,400})$/.exec(authorization ?? '');
      if (!m) return deny;
      const [id, secret] = Buffer.from(m[1], 'base64').toString('utf8').split(':');
      const row = /^[a-f0-9]{26}$/.test(id ?? '') ? getKey.get(id) as { hash: string } | undefined : undefined;
      // Compared even for an unknown id: no timing difference between a wrong id and a wrong secret.
      const ok = same(sha(secret ?? '').toString('hex'), row?.hash ?? 'x'.repeat(64)) && !!row;
      if (!ok) return deny;
      const exp = Math.floor(now / 1000) + ACCESS_TTL_S;
      return { status: 200, body: { access_token: access(id, exp), token_type: 'Bearer', expires_in: ACCESS_TTL_S } };
    },
  };
}
