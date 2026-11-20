// Standalone server (hub/src/server.ts, no OIDC): the admin token arrives once in the URL the server prints
// (`#token=...`: a fragment never reaches the server's logs nor a Referer), is kept in localStorage and removed from the
// address bar. It then stands for the Cognito access token: sent in Sec-WebSocket-Protocol, never refreshed.
// DOM-free: client/test/localauth.test.ts.
import type { Store } from './tokens.ts';

export const LOCAL_KEY = 'briefling.local';
const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;

/** Takes the token out of the fragment (returns the fragment to keep, '' when the token was all of it), stores it. */
export function takeLocalToken(hash: string, local: Store): string | null {
  const m = /^#token=([^&]*)(?:&(.*))?$/.exec(hash);
  if (!m) return null;
  if (TOKEN_RE.test(m[1])) try { local.setItem(LOCAL_KEY, m[1]); } catch { /* storage off: asked again at the next start */ }
  return m[2] ? `#${m[2]}` : '';
}

export function localToken(local: Store): string | null {
  try { const t = local.getItem(LOCAL_KEY); return t && TOKEN_RE.test(t) ? t : null; } catch { return null; }
}

export function forgetLocalToken(local: Store) { try { local.removeItem(LOCAL_KEY); } catch { /* storage off */ } }
