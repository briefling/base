// Sign-in of a standalone server with OIDC (hub/src/oidc.ts; Dex of the compose `dex` profile or any issuer with
// discovery): authorization code + PKCE + nonce in the browser through oauth4webapi (panva, no dependency), nothing of
// the protocol written here. The ID token stands for the Cognito access token (Sec-WebSocket-Protocol) and lives where
// tokens.ts keeps it; the server checks it again. No refresh token (Dex's refresh deadlocks on SQLite, see
// docker/dex/config.tmpl): an expired ID token means a new round trip to the issuer, silent while its session lasts.
import * as oauth from 'oauth4webapi';
import type { Tokens } from './login.ts';

export type OidcCfg = { issuer: string; clientId: string };
const PENDING = 'briefling.oidc'; // sessionStorage: verifier, state, nonce, the route, while the browser is at the issuer
const SCOPE = 'openid email profile';
type Kv = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function oidcClient(cfg: OidcCfg, redirectUri: string, session: Kv) {
  const issuer = new URL(cfg.issuer);
  // http only on loopback (the server refuses any other http issuer): oauth4webapi wants it said explicitly.
  const insecure = issuer.protocol === 'http:' ? { [oauth.allowInsecureRequests]: true } : {};
  const client: oauth.Client = { client_id: cfg.clientId };
  const auth = oauth.None();
  let as: Promise<oauth.AuthorizationServer> | null = null;
  const server = () => as ??= oauth.discoveryRequest(issuer, { algorithm: 'oidc', ...insecure })
    .then(r => oauth.processDiscoveryResponse(issuer, r)).catch(e => { as = null; throw e });
  return {
    /** To the issuer's sign-in page; never returns. `route`: the app's route, back after the round trip. */
    async login(route: string): Promise<never> {
      const a = await server();
      const verifier = oauth.generateRandomCodeVerifier(), state = oauth.generateRandomState(), nonce = oauth.generateRandomNonce();
      session.setItem(PENDING, JSON.stringify({ verifier, state, nonce, route }));
      const u = new URL(a.authorization_endpoint!);
      u.search = new URLSearchParams({ client_id: cfg.clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPE, state, nonce,
        code_challenge: await oauth.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256' }).toString();
      location.assign(u.href);
      return new Promise<never>(() => {});
    },
    /** Back from the issuer (`?code=` or `?error=` in `url`): the tokens and the route to restore, null when this is
     *  not our callback. Throws on a bad answer (wrong state, error from the issuer, token refused). */
    async callback(url: URL): Promise<{ tokens: Tokens; route: string } | null> {
      if (!url.searchParams.has('code') && !url.searchParams.has('error')) return null;
      const p = JSON.parse(session.getItem(PENDING) ?? 'null');
      session.removeItem(PENDING);
      if (!p?.verifier || !p.state || !p.nonce) return null;
      const a = await server();
      const params = oauth.validateAuthResponse(a, client, url, p.state); // state checked here (CSRF)
      const r = await oauth.authorizationCodeGrantRequest(a, client, auth, params, redirectUri, p.verifier, insecure);
      const res = await oauth.processAuthorizationCodeResponse(a, client, r, { expectedNonce: p.nonce, requireIdToken: true });
      const claims = oauth.getValidatedIdTokenClaims(res);
      if (!res.id_token || !claims) throw new Error('no id_token');
      return { tokens: { access: res.id_token, exp: claims.exp * 1000 }, route: typeof p.route === 'string' && p.route.startsWith('#/') ? p.route : '' };
    },
  };
}
