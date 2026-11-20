// Where the Cognito tokens live in the browser. The access token (1 h) stays in sessionStorage: gone with the tab.
// The refresh token goes to localStorage so the session survives the app being killed: iOS kills an installed PWA in
// the background and wipes its sessionStorage, which meant a sign-in at every reopening; desktop keeps the tab alive.
// Security delta: an XSS could already read the refresh token in sessionStorage; what changes is that it outlives the
// tab (shared device), still bounded by its Cognito validity and revoked at logout. DOM-free: client/test/tokens.test.ts.
import type { Tokens } from './login.ts';

export const TK = 'briefling.tokens', RK = 'briefling.refresh';
export type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const parse = (s: Store, k: string): any => { try { return JSON.parse(s.getItem(k) ?? 'null'); } catch { return null; } };
const put = (s: Store, k: string, v: unknown) => { try { s.setItem(k, JSON.stringify(v)); } catch { /* storage full or off */ } };

export function saveTokens(session: Store, local: Store, t: Tokens) {
  put(session, TK, { access: t.access, exp: t.exp, ...(t.hosted ? { hosted: true } : {}) });
  if (t.refresh) put(local, RK, { refresh: t.refresh, ...(t.hosted ? { hosted: true } : {}) });
}

/** The tab's tokens, or only the stored refresh token after a restart (`access` empty, `exp` 0: the caller refreshes).
 *  A refresh token still inside the session entry (written before this split) keeps working. */
export function readTokens(session: Store, local: Store): Tokens | null {
  const s = parse(session, TK), l = parse(local, RK);
  const r = typeof l?.refresh === 'string' && l.refresh ? l : null;
  if (s && typeof s.access === 'string') {
    const refresh = r?.refresh ?? (typeof s.refresh === 'string' ? s.refresh : undefined);
    return { access: s.access, exp: Number(s.exp) || 0, ...(refresh ? { refresh } : {}), ...(s.hosted || r?.hosted ? { hosted: true } : {}) };
  }
  return r ? { access: '', exp: 0, refresh: r.refresh, ...(r.hosted ? { hosted: true } : {}) } : null;
}

export function clearTokens(session: Store, local: Store) {
  for (const [s, k] of [[session, TK], [local, RK]] as const) try { s.removeItem(k); } catch { /* storage off */ }
}
