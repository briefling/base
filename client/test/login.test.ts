import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, errorKey, normUser, pwProblem, signIn, newPassword, refresh, forgot, confirmForgot, revoke, PW_MIN, type Idp } from '../src/login.ts';

/** Fake Cognito: records the calls, answers with `answer(action, body)` ([status, json]) or throws (network). */
function fake(answer: (action: string, body: any) => [number, any] | 'down') {
  const calls: { url: string; action: string; body: any; headers: Record<string, string> }[] = [];
  const idp: Idp = { url: 'https://cognito-idp.us-east-2.amazonaws.com/', clientId: 'web1', fetch: async (url, init) => {
    const action = init.headers['X-Amz-Target'].replace('AWSCognitoIdentityProviderService.', ''), body = JSON.parse(init.body);
    calls.push({ url, action, body, headers: init.headers });
    const a = answer(action, body);
    if (a === 'down') throw new TypeError('Failed to fetch');
    return { ok: a[0] < 300, status: a[0], json: async () => a[1] };
  } };
  return { idp, calls };
}
const err = (type: string, message = '') => [400, { __type: type, message }] as [number, any];
const AUTH = { AccessToken: 'acc', RefreshToken: 'ref', IdToken: 'id', ExpiresIn: 3600, TokenType: 'Bearer' };

test('call: POST to the regional endpoint with the JSON 1.1 target, error name without its namespace', async () => {
  const { idp, calls } = fake(() => [400, { __type: 'com.amazonaws#NotAuthorizedException', message: 'Incorrect username or password.' }]);
  const r = await call(idp, 'InitiateAuth', { a: 1 });
  assert.deepEqual(r, { ok: false, code: 'NotAuthorizedException', message: 'Incorrect username or password.' });
  assert.equal(calls[0].url, 'https://cognito-idp.us-east-2.amazonaws.com/');
  assert.equal(calls[0].headers['Content-Type'], 'application/x-amz-json-1.1');
  assert.equal(calls[0].headers['X-Amz-Target'], 'AWSCognitoIdentityProviderService.InitiateAuth');
  assert.deepEqual(await call(fake(() => 'down').idp, 'X', {}), { ok: false, code: 'network', message: '' });
  assert.deepEqual(await call(fake(() => [500, null]).idp, 'X', {}), { ok: false, code: 'http_500', message: '' });
});

test('sign-in: tokens with their expiry, user name + password sent with USER_PASSWORD_AUTH on the web client', async () => {
  const { idp, calls } = fake(() => [200, { AuthenticationResult: AUTH }]);
  assert.deepEqual(await signIn(idp, 'blair', 'pw', 1000), { kind: 'tokens', tokens: { access: 'acc', refresh: 'ref', exp: 1000 + 3600_000 } });
  assert.deepEqual(calls[0].body, { AuthFlow: 'USER_PASSWORD_AUTH', ClientId: 'web1', AuthParameters: { USERNAME: 'blair', PASSWORD: 'pw' } });
});

test('sign-in of an invitation: NEW_PASSWORD_REQUIRED gives the session and the user name, then the answer gives tokens', async () => {
  const { idp, calls } = fake((a) => a === 'InitiateAuth'
    ? [200, { ChallengeName: 'NEW_PASSWORD_REQUIRED', Session: 'sess', ChallengeParameters: { USER_ID_FOR_SRP: 'zoe@acme.test', requiredAttributes: '[]' } }]
    : [200, { AuthenticationResult: AUTH }]);
  const r = await signIn(idp, 'zoe@acme.test', 'Temp-pass', 0);
  assert.deepEqual(r, { kind: 'new_password', session: 'sess', username: 'zoe@acme.test' });
  assert.deepEqual(await newPassword(idp, 'sess', 'zoe@acme.test', 'a-long-new-password', 0), { tokens: { access: 'acc', refresh: 'ref', exp: 3600_000 } });
  assert.deepEqual(calls[1].body, { ChallengeName: 'NEW_PASSWORD_REQUIRED', ClientId: 'web1', Session: 'sess', ChallengeResponses: { USERNAME: 'zoe@acme.test', NEW_PASSWORD: 'a-long-new-password' } });
});

test('sign-in: an unknown challenge (MFA) is not taken for a success; reset by an admin goes to the code step', async () => {
  assert.deepEqual(await signIn(fake(() => [200, { ChallengeName: 'SOFTWARE_TOKEN_MFA', Session: 's' }]).idp, 'u', 'p', 0), { kind: 'error', err: 'login_unsupported' });
  assert.deepEqual(await signIn(fake(() => err('PasswordResetRequiredException')).idp, 'u', 'p', 0), { kind: 'reset', username: 'u' });
  assert.deepEqual(await signIn(fake(() => err('NotAuthorizedException', 'Incorrect username or password.')).idp, 'u', 'p', 0), { kind: 'error', err: 'login_bad' });
});

test('new password: expired challenge session (3 min) and refused password', async () => {
  assert.deepEqual(await newPassword(fake(() => err('NotAuthorizedException', 'Invalid session for the user, session is expired.')).idp, 's', 'u', 'p', 0), { err: 'login_session_expired' });
  assert.deepEqual(await newPassword(fake(() => err('InvalidPasswordException', 'Password does not conform to policy')).idp, 's', 'u', 'p', 0), { err: 'login_pw_policy' });
});

test('errors: the NotAuthorized cases told apart by message (lockout, expired invitation), throttling, codes, network', () => {
  assert.equal(errorKey('NotAuthorizedException', 'Password attempts exceeded'), 'login_locked');
  assert.equal(errorKey('NotAuthorizedException', 'Temporary password has expired and must be reset by an administrator.'), 'login_invite_expired');
  assert.equal(errorKey('NotAuthorizedException', 'User password cannot be reset in the current state.'), 'login_reset_unavailable');
  assert.equal(errorKey('NotAuthorizedException', 'Incorrect username or password.'), 'login_bad');
  assert.equal(errorKey('UserNotFoundException'), 'login_bad');
  assert.equal(errorKey('InvalidParameterException', 'Cannot reset password for the user as there is no registered/verified email or phone_number'), 'login_reset_unavailable');
  assert.equal(errorKey('InvalidParameterException', 'other'), 'login_failed');
  assert.equal(errorKey('LimitExceededException'), 'login_too_many');
  assert.equal(errorKey('TooManyRequestsException'), 'login_too_many');
  assert.equal(errorKey('CodeMismatchException'), 'login_code_bad');
  assert.equal(errorKey('ExpiredCodeException'), 'login_code_expired');
  assert.equal(errorKey('network'), 'login_network');
  assert.equal(errorKey('http_502'), 'login_failed');
});

test('refresh: new access token, refresh token kept; refused = null (sign in again); network = throws (keep the session)', async () => {
  const { idp, calls } = fake(() => [200, { AuthenticationResult: { AccessToken: 'acc2', ExpiresIn: 3600 } }]);
  assert.deepEqual(await refresh(idp, 'ref', 5), { access: 'acc2', refresh: 'ref', exp: 5 + 3600_000 });
  assert.deepEqual(calls[0].body, { AuthFlow: 'REFRESH_TOKEN_AUTH', ClientId: 'web1', AuthParameters: { REFRESH_TOKEN: 'ref' } });
  assert.equal(await refresh(fake(() => err('NotAuthorizedException', 'Refresh Token has been revoked')).idp, 'ref', 0), null);
  await assert.rejects(refresh(fake(() => 'down').idp, 'ref', 0));
});

test('forgot password: masked destination, then code + new password; revoke at logout', async () => {
  const { idp, calls } = fake((a) => a === 'ForgotPassword' ? [200, { CodeDeliveryDetails: { Destination: 'z***@a***', DeliveryMedium: 'EMAIL' } }] : [200, {}]);
  assert.deepEqual(await forgot(idp, 'zoe@acme.test'), { dest: 'z***@a***' });
  assert.deepEqual(await confirmForgot(idp, 'zoe@acme.test', ' 123456 ', 'a-long-new-password'), { ok: true });
  assert.equal(await revoke(idp, 'ref'), true);
  assert.deepEqual(calls.map(c => [c.action, c.body]), [
    ['ForgotPassword', { ClientId: 'web1', Username: 'zoe@acme.test' }],
    ['ConfirmForgotPassword', { ClientId: 'web1', Username: 'zoe@acme.test', ConfirmationCode: '123456', Password: 'a-long-new-password' }],
    ['RevokeToken', { ClientId: 'web1', Token: 'ref' }]]);
  assert.deepEqual(await confirmForgot(fake(() => err('CodeMismatchException')).idp, 'u', '1', 'p'), { err: 'login_code_bad' });
  assert.deepEqual(await forgot(fake(() => err('LimitExceededException')).idp, 'u'), { err: 'login_too_many' });
});

test('user name: addresses in lower case (invitation user names), other names as typed; local password checks', () => {
  assert.equal(normUser('  Zoe@Acme.TEST '), 'zoe@acme.test');
  assert.equal(normUser(' gaston-E2E '), 'gaston-E2E');
  assert.equal(pwProblem('x'.repeat(PW_MIN - 1), 'x'.repeat(PW_MIN - 1)), 'login_pw_short');
  assert.equal(pwProblem('x'.repeat(PW_MIN), 'y'.repeat(PW_MIN)), 'login_pw_mismatch');
  assert.equal(pwProblem('x'.repeat(PW_MIN), 'x'.repeat(PW_MIN)), null);
});
