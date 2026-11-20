// Humans of a standalone server signed in through an OIDC provider (Dex of the compose `dex` profile, or any issuer
// with discovery): the browser does code + PKCE itself (client/src/oidc.ts) and offers the ID token where the Cognito
// access token goes (Sec-WebSocket-Protocol). Here: the token checked against the issuer's keys (aws-jwt-verify,
// already the Lambda authorizer's library: signature, `iss`, `aud` = our client id, expiry), then mapped to a hub user.
// Invitation only, like the Cognito pool (no self sign-up): an identity (issuer + `sub`) gets in when it is already
// bound to a user, or when its VERIFIED e-mail matches an unexpired invitation of an admin (`space.invite`) or the
// admin list of the config (`BRIEFLING_OIDC_ADMINS`, the first sign-in makes them global admin). Anyone else the
// provider knows (any GitHub account behind the github connector...) is refused. Hub user ids are ours, not the
// provider's `sub`: an invitation exists before the person ever signed in. Agents never come here: they keep the keys
// the hub issues at `agent.join` (hub/src/localauth.ts), Dex's static clients cannot be added without a restart.
import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { JwtVerifier } from 'aws-jwt-verify';
import { SimpleJwksCache } from 'aws-jwt-verify/jwk';
import { normEmail } from '../../protocol/frames.ts';
import { INVITE_VALID_MS, type Users } from './router.ts';

export interface OidcConfig {
  issuer: string;
  clientId: string;
  /** E-mails made global admin at their first sign-in (verified e-mail only). */
  admins: string[];
  /** Where THIS server reaches the issuer when it is not the browser's address (compose: `http://dex:5556/dex`).
   *  Only the fetch address changes: the tokens must still carry `issuer`. */
  internalUrl?: string;
}

/** OIDC config from the environment; null when off, an Error when half set (the server refuses to start). */
export function oidcFromEnv(e: Record<string, string | undefined>): OidcConfig | null {
  const issuer = e.BRIEFLING_OIDC_ISSUER?.trim(), clientId = e.BRIEFLING_OIDC_CLIENT_ID?.trim() || 'briefling';
  if (!issuer) return null;
  const admins = (e.BRIEFLING_OIDC_ADMINS ?? '').split(',').map(normEmail).filter((x): x is string => !!x);
  const url = new URL(issuer);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
    throw new Error(`refusing BRIEFLING_OIDC_ISSUER ${issuer}: https, or http on loopback`);
  if (!admins.length) throw new Error('BRIEFLING_OIDC_ADMINS is empty: nobody could administer this server (comma-separated e-mails)');
  const internalUrl = e.BRIEFLING_OIDC_INTERNAL_URL?.trim() || undefined;
  if (internalUrl) new URL(internalUrl);
  return { issuer: issuer.replace(/\/$/, ''), clientId, admins, ...(internalUrl ? { internalUrl: internalUrl.replace(/\/$/, '') } : {}) };
}

export type Claims = { iss: string; sub: string; email?: string; email_verified?: boolean; name?: string };
/** Who a sign-in resolved to; `admin`: the config's list says so (the caller seeds the role and the Home space). */
export type Resolved = { id: string; admin: boolean; first: boolean; name: string };

export interface Oidc {
  config: OidcConfig;
  /** Signature, issuer, audience, expiry; the claims, or null. */
  verify(token: string): Promise<Claims | null>;
  /** The hub user of these claims (binding an invitation or an admin e-mail at the first sign-in), or null: not invited. */
  resolve(c: Claims, now: number): Resolved | null;
  /** verify + resolve. */
  human(token: string, now: number): Promise<Resolved | null>;
  users: Users;
}

type Fetch = (url: string) => Promise<{ ok: boolean; json(): Promise<any>; arrayBuffer(): Promise<ArrayBuffer> }>;

/** `firstAdmin`: the user id the first admin of the config to sign in takes, while nobody holds it (server.ts: `admin`). */
export function openOidc(db: DatabaseSync, config: OidcConfig, o: { fetch?: Fetch; now?: () => number; firstAdmin?: string } = {}): Oidc {
  const fetchJson: Fetch = o.fetch ?? ((u: string) => fetch(u, { redirect: 'error', signal: AbortSignal.timeout(5000) })), clock = o.now ?? Date.now;
  // The library's own fetcher is https only: Dex on the compose network answers in http (BRIEFLING_OIDC_INTERNAL_URL).
  const jwksCache = new SimpleJwksCache({ fetcher: { async fetch(u: string) { const r = await fetchJson(u); if (!r.ok) throw new Error('jwks fetch failed'); return r.arrayBuffer() } } });
  db.exec(`CREATE TABLE IF NOT EXISTS oidc_users (id TEXT PRIMARY KEY, email TEXT, iss TEXT, sub TEXT, invited INTEGER NOT NULL, seen INTEGER);
    CREATE UNIQUE INDEX IF NOT EXISTS oidc_identity ON oidc_users (iss, sub) WHERE sub IS NOT NULL;
    CREATE INDEX IF NOT EXISTS oidc_email ON oidc_users (email);`);
  const byIdentity = db.prepare('SELECT id FROM oidc_users WHERE iss = ? AND sub = ?');
  const byEmail = db.prepare('SELECT id, sub, invited FROM oidc_users WHERE email = ? ORDER BY invited');
  const bind = db.prepare('UPDATE oidc_users SET iss = ?, sub = ?, seen = ? WHERE id = ? AND sub IS NULL');
  const insert = db.prepare('INSERT INTO oidc_users (id, email, iss, sub, invited, seen) VALUES (?, ?, ?, ?, ?, ?)');
  const newUserId = () => 'u' + randomBytes(12).toString('hex');
  const fetchBase = config.internalUrl ?? config.issuer;

  // Discovery once it answers (Dex may start after us): its `issuer` must be ours, its keys URL read from it.
  let verifier: Promise<{ verify(t: string): Promise<any> }> | null = null;
  const getVerifier = () => verifier ??= (async () => {
    const r = await fetchJson(`${fetchBase}/.well-known/openid-configuration`);
    if (!r.ok) throw new Error('oidc discovery failed');
    const d = await r.json();
    if (d?.issuer?.replace(/\/$/, '') !== config.issuer) throw new Error(`oidc discovery: issuer ${d?.issuer} is not ${config.issuer}`);
    const jwks = String(d.jwks_uri ?? '');
    if (!jwks.startsWith(config.issuer + '/')) throw new Error('oidc discovery: jwks_uri outside the issuer');
    return JwtVerifier.create({ issuer: d.issuer, audience: config.clientId, jwksUri: fetchBase + jwks.slice(config.issuer.length) }, { jwksCache });
  })().catch(e => { verifier = null; throw e });

  const nameOf = (c: Claims) => {
    const n = typeof c.name === 'string' ? c.name.trim().slice(0, 40) : '';
    if (n) return n;
    const local = (c.email ?? 'member').split('@')[0];
    return (local[0].toUpperCase() + local.slice(1)).slice(0, 40);
  };
  const oidc: Oidc = {
    config,
    async verify(token) {
      if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) || token.length > 8192) return null;
      const v = await getVerifier(); // unreachable issuer: throws (the caller refuses the connection)
      try {
        const p = await v.verify(token);
        return typeof p.sub === 'string' && p.sub ? p as Claims : null;
      } catch { return null }
    },
    resolve(c, now) {
      const known = byIdentity.get(c.iss, c.sub) as { id: string } | undefined;
      const email = c.email_verified === true ? normEmail(c.email) : null;
      const admin = !!email && config.admins.includes(email);
      if (known) return { id: known.id, admin, first: false, name: nameOf(c) };
      if (!email) return null; // nothing to match an invitation with
      // Synchronous from here (node:sqlite): no other sign-in runs in between.
      const rows = byEmail.all(email) as { id: string; sub: string | null; invited: number }[];
      const open = rows.find(r => r.sub === null && (admin || now - r.invited <= INVITE_VALID_MS));
      if (open && bind.run(c.iss, c.sub, now, open.id).changes) return { id: open.id, admin, first: true, name: nameOf(c) };
      if (!admin) return null;
      const id = o.firstAdmin && !db.prepare('SELECT 1 FROM oidc_users WHERE id = ?').get(o.firstAdmin) ? o.firstAdmin : newUserId();
      insert.run(id, email, c.iss, c.sub, now, now);
      return { id, admin, first: true, name: nameOf(c) };
    },
    async human(token, now) { const c = await oidc.verify(token); return c ? oidc.resolve(c, now) : null },
    users: {
      async findByEmail(email) { return (byEmail.all(email.toLowerCase()) as { id: string }[]).map(r => r.id) },
      // No mail here: the person signs in with that address through the provider (the admin tells them).
      async invite(email) { const id = newUserId(); insert.run(id, email.toLowerCase(), null, null, clock(), null); return { id, created: true } },
      async pending() { return new Map((db.prepare('SELECT id, invited FROM oidc_users WHERE sub IS NULL').all() as { id: string; invited: number }[]).map(r => [r.id, r.invited])) },
      async resend(id) { return db.prepare('UPDATE oidc_users SET invited = ? WHERE id = ? AND sub IS NULL').run(clock(), id).changes > 0 },
    },
  };
  return oidc;
}
