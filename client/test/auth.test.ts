import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorizeQuery } from '../src/auth.ts';

const base = { clientId: 'c1', redirectUri: 'https://app.example/', state: 's', challenge: 'ch' };

test('authorize query carries the app language for Managed Login', () => {
  assert.equal(authorizeQuery({ ...base, lang: 'fr' }).get('lang'), 'fr');
  assert.equal(authorizeQuery({ ...base, lang: 'en' }).get('lang'), 'en');
});

test('authorize query keeps the code + PKCE parameters', () => {
  const q = authorizeQuery({ ...base, lang: 'en' });
  assert.deepEqual(Object.fromEntries(q), { response_type: 'code', client_id: 'c1', redirect_uri: 'https://app.example/', scope: 'openid',
    state: 's', code_challenge_method: 'S256', code_challenge: 'ch', lang: 'en' });
});
