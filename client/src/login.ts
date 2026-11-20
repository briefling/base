// In-app sign-in on Cognito's public JSON API: plain `fetch` to `cognito-idp.<region>.amazonaws.com` with the web
// client (public, no secret), no SDK nor lib. Same pool, same tokens as before: the hub sees no difference.
// Flows: USER_PASSWORD_AUTH (the password goes over TLS straight to Cognito; SRP would need a crypto lib, never hand-rolled),
// NEW_PASSWORD_REQUIRED (first sign-in of an invitation, temporary password), forgot password (code by mail),
// REFRESH_TOKEN_AUTH, RevokeToken at logout. DOM-free: tested in node with a fake fetch (client/test/login.test.ts).
import type { Key } from './i18n.ts';

/** `hosted`: obtained through the Cognito Managed Login page (fallback), whose own session cookie the logout must end. */
export type Tokens = { access: string; refresh?: string; exp: number; hosted?: boolean };
export type Fetch = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string }) =>
  Promise<{ ok: boolean; status: number; json(): Promise<any> }>;
export type Idp = { url: string; clientId: string; fetch: Fetch };

/** Pool password policy (infra/app.ts `passwordPolicy`: length only). */
export const PW_MIN = 16;

type Answer = { ok: true; data: any } | { ok: false; code: string; message: string };

/** One Cognito API call. A network failure is `code: 'network'`; an error answer gives Cognito's exception name. */
export async function call(idp: Idp, action: string, body: object): Promise<Answer> {
  let r;
  try {
    r = await idp.fetch(idp.url, { method: 'POST', body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': `AWSCognitoIdentityProviderService.${action}` } });
  } catch { return { ok: false, code: 'network', message: '' }; }
  const j = await r.json().catch(() => ({}));
  if (r.ok) return { ok: true, data: j };
  return { ok: false, code: String(j?.__type ?? '').split('#').pop() || `http_${r.status}`, message: String(j?.message ?? j?.Message ?? '') };
}

/** Message shown for a Cognito error. NotAuthorizedException covers several cases told apart by Cognito's message only. */
export function errorKey(code: string, message = ''): Key {
  switch (code) {
    case 'NotAuthorizedException':
      if (/attempts exceeded/i.test(message)) return 'login_locked';
      if (/temporary password has expired/i.test(message)) return 'login_invite_expired';
      if (/session is expired|invalid session/i.test(message)) return 'login_session_expired';
      if (/cannot be reset/i.test(message)) return 'login_reset_unavailable';
      return 'login_bad';
    case 'UserNotFoundException': return 'login_bad'; // masked by the client setting anyway (preventUserExistenceErrors)
    case 'InvalidPasswordException': return 'login_pw_policy';
    case 'CodeMismatchException': return 'login_code_bad';
    case 'ExpiredCodeException': return 'login_code_expired';
    case 'LimitExceededException': case 'TooManyRequestsException': case 'TooManyFailedAttemptsException': return 'login_too_many';
    case 'InvalidParameterException': return /verified email|registered\/verified/i.test(message) ? 'login_reset_unavailable' : 'login_failed';
    case 'network': return 'login_network';
    default: return 'login_failed';
  }
}

/** Addresses are user names in lower case (space.invite); other user names (test accounts) are kept as typed. */
export const normUser = (u: string) => { const s = u.trim(); return s.includes('@') ? s.toLowerCase() : s; };

/** Local check of a new password before asking Cognito (which checks again). */
export function pwProblem(pw: string, again: string): Key | null {
  if (pw.length < PW_MIN) return 'login_pw_short';
  if (pw !== again) return 'login_pw_mismatch';
  return null;
}

const tokensOf = (a: any, now: number, refresh?: string): Tokens | null =>
  typeof a?.AccessToken === 'string' ? { access: a.AccessToken, refresh: a.RefreshToken ?? refresh, exp: now + Number(a.ExpiresIn ?? 3600) * 1000 } : null;

export type SignIn =
  | { kind: 'tokens'; tokens: Tokens }
  | { kind: 'new_password'; session: string; username: string } // invitation: choose a password
  | { kind: 'reset'; username: string }                         // password reset by an admin: code step
  | { kind: 'error'; err: Key };

/** Sign-in with user name + password, or the challenge that comes instead of tokens. */
export async function signIn(idp: Idp, username: string, password: string, now: number): Promise<SignIn> {
  const r = await call(idp, 'InitiateAuth', { AuthFlow: 'USER_PASSWORD_AUTH', ClientId: idp.clientId, AuthParameters: { USERNAME: username, PASSWORD: password } });
  if (!r.ok) return r.code === 'PasswordResetRequiredException' ? { kind: 'reset', username } : { kind: 'error', err: errorKey(r.code, r.message) };
  const t = tokensOf(r.data.AuthenticationResult, now);
  if (t) return { kind: 'tokens', tokens: t };
  if (r.data.ChallengeName === 'NEW_PASSWORD_REQUIRED' && typeof r.data.Session === 'string')
    return { kind: 'new_password', session: r.data.Session, username: r.data.ChallengeParameters?.USER_ID_FOR_SRP ?? username };
  return { kind: 'error', err: 'login_unsupported' }; // MFA and other challenges: not enabled on the pool
}

/** Answer to NEW_PASSWORD_REQUIRED (session valid 3 min, Cognito's default for the client). */
export async function newPassword(idp: Idp, session: string, username: string, password: string, now: number): Promise<{ tokens: Tokens } | { err: Key }> {
  const r = await call(idp, 'RespondToAuthChallenge', { ChallengeName: 'NEW_PASSWORD_REQUIRED', ClientId: idp.clientId, Session: session,
    ChallengeResponses: { USERNAME: username, NEW_PASSWORD: password } });
  if (!r.ok) return { err: errorKey(r.code, r.message) };
  const t = tokensOf(r.data.AuthenticationResult, now);
  return t ? { tokens: t } : { err: 'login_unsupported' };
}

/** New access token from the refresh token (kept: Cognito sends no new one without rotation). Null = sign in again;
 *  a network failure throws instead (the caller retries the connection, the person stays signed in). */
export async function refresh(idp: Idp, token: string, now: number): Promise<Tokens | null> {
  const r = await call(idp, 'InitiateAuth', { AuthFlow: 'REFRESH_TOKEN_AUTH', ClientId: idp.clientId, AuthParameters: { REFRESH_TOKEN: token } });
  if (!r.ok && r.code === 'network') throw new Error('network');
  return r.ok ? tokensOf(r.data.AuthenticationResult, now, token) : null;
}

/** Sends the reset code by mail. `dest` = Cognito's masked address (absent for an unknown user name: same answer, by design). */
export async function forgot(idp: Idp, username: string): Promise<{ dest: string } | { err: Key }> {
  const r = await call(idp, 'ForgotPassword', { ClientId: idp.clientId, Username: username });
  return r.ok ? { dest: String(r.data.CodeDeliveryDetails?.Destination ?? '') } : { err: errorKey(r.code, r.message) };
}

export async function confirmForgot(idp: Idp, username: string, code: string, password: string): Promise<{ ok: true } | { err: Key }> {
  const r = await call(idp, 'ConfirmForgotPassword', { ClientId: idp.clientId, Username: username, ConfirmationCode: code.trim(), Password: password });
  return r.ok ? { ok: true } : { err: errorKey(r.code, r.message) };
}

/** Logout: the refresh token stops working at once. Access tokens it issued stay valid for the hub (its JWT check is
 *  offline) until they expire (1 h), but this device has just forgotten them. */
export async function revoke(idp: Idp, token: string): Promise<boolean> {
  return (await call(idp, 'RevokeToken', { ClientId: idp.clientId, Token: token })).ok;
}
