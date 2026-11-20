import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveTokens, readTokens, clearTokens, TK, RK, type Store } from '../src/tokens.ts';

const mem = (): Store & { m: Map<string, string> } => {
  const m = new Map<string, string>();
  return { m, getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: k => { m.delete(k); } };
};

test('the refresh token goes to local storage, the access token stays in the session', () => {
  const s = mem(), l = mem();
  saveTokens(s, l, { access: 'A', refresh: 'R', exp: 100 });
  assert.deepEqual(JSON.parse(s.m.get(TK)!), { access: 'A', exp: 100 });
  assert.deepEqual(JSON.parse(l.m.get(RK)!), { refresh: 'R' });
  assert.deepEqual(readTokens(s, l), { access: 'A', exp: 100, refresh: 'R' });
});

test('after the app was killed (session wiped) only the refresh token comes back, to be refreshed', () => {
  const s = mem(), l = mem();
  saveTokens(s, l, { access: 'A', refresh: 'R', exp: 100, hosted: true });
  const killed = mem();
  assert.deepEqual(readTokens(killed, l), { access: '', exp: 0, refresh: 'R', hosted: true });
});

test('a refresh without a new refresh token keeps the stored one', () => {
  const s = mem(), l = mem();
  saveTokens(s, l, { access: 'A', refresh: 'R', exp: 100 });
  saveTokens(s, l, { access: 'B', exp: 200 });
  assert.deepEqual(readTokens(s, l), { access: 'B', exp: 200, refresh: 'R' });
});

test('a session entry written before the split (refresh inside) still works', () => {
  const s = mem(), l = mem();
  s.setItem(TK, JSON.stringify({ access: 'A', refresh: 'OLD', exp: 100 }));
  assert.deepEqual(readTokens(s, l), { access: 'A', exp: 100, refresh: 'OLD' });
});

test('nothing stored, garbage or an empty refresh token: signed out', () => {
  const s = mem(), l = mem();
  assert.equal(readTokens(s, l), null);
  l.setItem(RK, '{not json'); assert.equal(readTokens(s, l), null);
  l.setItem(RK, JSON.stringify({ refresh: '' })); assert.equal(readTokens(s, l), null);
});

test('clear forgets both, and storage that throws never breaks sign-in', () => {
  const s = mem(), l = mem();
  saveTokens(s, l, { access: 'A', refresh: 'R', exp: 100 });
  clearTokens(s, l);
  assert.equal(readTokens(s, l), null);
  const off: Store = { getItem: () => { throw new Error('off'); }, setItem: () => { throw new Error('off'); }, removeItem: () => { throw new Error('off'); } };
  saveTokens(s, off, { access: 'A', refresh: 'R', exp: 100 });
  assert.deepEqual(readTokens(s, off), { access: 'A', exp: 100 });
  clearTokens(off, off);
});
