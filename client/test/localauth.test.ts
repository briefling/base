import { test } from 'node:test';
import assert from 'node:assert/strict';
import { takeLocalToken, localToken, forgetLocalToken, LOCAL_KEY } from '../src/localauth.ts';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m } };
const TOK = 'Ab3_-' + 'x'.repeat(38);

test('local token: taken from #token=, stored, removed from the fragment (route kept)', () => {
  const s = mem();
  assert.equal(takeLocalToken('#/s/demo', s), null, 'a route is not a token');
  assert.equal(localToken(s), null);
  assert.equal(takeLocalToken(`#token=${TOK}`, s), '');
  assert.equal(localToken(s), TOK);
  assert.equal(takeLocalToken(`#token=${TOK}&/s/demo`, s), '#/s/demo');
  forgetLocalToken(s);
  assert.equal(localToken(s), null);
});

test('local token: a malformed one is dropped from the URL but never stored', () => {
  const s = mem();
  assert.equal(takeLocalToken('#token=<script>', s), '');
  assert.equal(localToken(s), null);
  s.setItem(LOCAL_KEY, 'short');
  assert.equal(localToken(s), null);
});
