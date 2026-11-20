import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dueKey, openSchedules, wallClock } from '../src/localsched.ts';
import { openLocalAuth, bindAllowed, publicUrlAllowed } from '../src/localauth.ts';
import { startServer, turnCredentials } from '../src/server.ts';
import { diskSite } from '../src/localfiles.ts';
import { readFileSync, existsSync } from 'node:fs';
import { request } from 'node:http';
import { routineCron } from '../../protocol/routines.ts';
import { reminderAt } from '../../protocol/reminders.ts';
// Windows has no mode bits (stat says 0666): there the user's profile folder's ACL keeps these files private.
const assertPrivate = (p: string) => { if (process.platform !== 'win32') assert.equal(statSync(p).mode & 0o777, 0o600, p) };

const paris = (y: number, mo: number, d: number, h: number, mi: number, utcOffset: number) => Date.UTC(y, mo - 1, d, h - utcOffset, mi, 5);

test('wallClock: the zone\'s wall time and weekday, summer and winter', () => {
  assert.deepEqual(wallClock(Date.UTC(2026, 10, 16, 7, 30), 'Europe/Paris'), { stamp: '2026-11-16T08:30:00', dow: 'MON' });
  assert.deepEqual(wallClock(Date.UTC(2026, 6, 1, 23, 30), 'Europe/Paris'), { stamp: '2026-07-02T01:30:00', dow: 'THU' }); // UTC+2, next day
});

test('dueKey: the hub\'s cron fires at its minute and days in its zone, across DST', () => {
  const cron = routineCron({ days: [1, 3], time: '08:30' }); // MON, WED
  assert.match(cron, /^cron\(30 8 \? \* /);
  assert.equal(dueKey(cron, 'Europe/Paris', paris(2026, 11, 16, 8, 30, 1)), '2026-11-16T08:30'); // Monday, winter
  assert.equal(dueKey(cron, 'Europe/Paris', paris(2026, 7, 1, 8, 30, 2)), '2026-07-01T08:30');   // Wednesday, summer
  assert.equal(dueKey(cron, 'Europe/Paris', paris(2026, 11, 17, 8, 30, 1)), null, 'Tuesday');
  assert.equal(dueKey(cron, 'Europe/Paris', paris(2026, 11, 16, 8, 31, 1)), null, 'next minute');
  assert.equal(dueKey(cron, 'UTC', paris(2026, 11, 16, 8, 30, 1)), null, 'another zone, another instant');
  assert.equal(dueKey('rate(5 minutes)', 'UTC', 0), null, 'unknown shapes never fire');
});

test('dueKey: at() is due from its wall time on (a missed one fires late)', () => {
  const at = reminderAt({ date: '2026-11-20', time: '09:00' } as any);
  assert.equal(dueKey(at, 'Europe/Paris', paris(2026, 11, 20, 8, 59, 1)), null);
  assert.equal(dueKey(at, 'Europe/Paris', paris(2026, 11, 20, 9, 0, 1)), 'at');
  assert.equal(dueKey(at, 'Europe/Paris', paris(2026, 11, 22, 3, 0, 1)), 'at');
});

test('schedules: put replaces, cron once per minute (persisted), at() once then gone, disabled never, remove', async () => {
  const db = new DatabaseSync(':memory:'), s = openSchedules(db), fired: unknown[] = [];
  const fire = async (i: unknown) => { fired.push(i) };
  await s.put('r1', routineCron({ days: [1, 2, 3, 4, 5, 6, 7], time: '03:17' }), true, '{"space":"a","routine":"r1"}');
  await s.put('off', routineCron({ days: [1, 2, 3, 4, 5, 6, 7], time: '03:17' }), false, '{"x":1}');
  await s.put('rem', reminderAt({ date: '2026-11-16', time: '03:00' } as any), true, '{"space":"a","reminder":"m"}', { tz: 'Europe/Paris', once: true });
  await assert.rejects(s.put('bad', 'rate(1 minute)', true, '{}'));
  await assert.rejects(s.put('badtz', 'at(2026-01-01T00:00:00)', true, '{}', { tz: 'Mars/Olympus' }));
  const t = paris(2026, 11, 16, 3, 17, 1);
  assert.equal(await s.tick(t, fire), 2);
  assert.equal(await s.tick(t + 30_000, fire), 0, 'same minute: once');
  assert.deepEqual(fired, [{ space: 'a', routine: 'r1' }, { space: 'a', reminder: 'm' }]);
  assert.deepEqual(s.list().map(r => r.name), ['off', 'r1'], 'the at() is gone');
  // persisted: a new handle on the same db sees the last minute fired
  assert.equal(await openSchedules(db).tick(t + 40_000, fire), 0);
  // a failing run is logged, not retried, and does not stop the others
  await s.put('r1', routineCron({ days: [1, 2, 3, 4, 5, 6, 7], time: '03:18' }), true, '{"space":"a","routine":"r1"}');
  assert.equal(await s.tick(t + 60_000, async () => { throw new Error('boom') }), 1);
  assert.equal(await s.tick(t + 70_000, fire), 0);
  await s.remove('r1'); await s.remove('missing');
  assert.deepEqual(s.list().map(r => r.name), ['off']);
});

test('local auth: loopback only without OIDC; admin token; agent key hashed, token signed, expiring, tamper-proof', async () => {
  assert.ok(bindAllowed('127.0.0.1', false) && bindAllowed('::1', false) && bindAllowed('localhost', false));
  assert.ok(!bindAllowed('0.0.0.0', false) && !bindAllowed('192.168.1.10', false) && !bindAllowed('::', false));
  assert.ok(bindAllowed('0.0.0.0', true));
  assert.ok(bindAllowed('0.0.0.0', false, true), 'in the image: the published port decides');
  const dir = mkdtempSync(join(tmpdir(), 'bl-auth-'));
  try {
    const db = new DatabaseSync(':memory:'), a = openLocalAuth(db, dir);
    assert.match(a.adminToken, /^[A-Za-z0-9_-]{43}$/);
    assertPrivate(join(dir, 'admin-token'));
    assertPrivate(join(dir, 'server-key'));
    assert.equal(openLocalAuth(db, dir).adminToken, a.adminToken, 'kept across starts');
    assert.equal(a.human(a.adminToken), 'admin');
    assert.equal(a.human(a.adminToken.slice(1)), null);
    const c = await a.agentClients('http://127.0.0.1:1/oauth2/token').create('bot');
    const row = db.prepare('SELECT hash FROM agent_keys WHERE id = ?').get(c.id) as { hash: string };
    assert.ok(row && !row.hash.includes(c.secret) && row.hash.length === 64, 'only the hash is stored');
    const basic = (id: string, s: string) => `Basic ${Buffer.from(`${id}:${s}`).toString('base64')}`;
    const form = new URLSearchParams({ grant_type: 'client_credentials', scope: 'briefling/instance' });
    const now = Date.UTC(2026, 10, 16);
    assert.equal(a.token(basic(c.id, 'nope'), form, now).status, 401);
    assert.equal(a.token(basic('f'.repeat(26), c.secret), form, now).status, 401);
    assert.equal(a.token(undefined, form, now).status, 401);
    assert.equal(a.token(basic(c.id, c.secret), new URLSearchParams({ grant_type: 'password' }), now).status, 400);
    assert.equal(a.token(basic(c.id, c.secret), new URLSearchParams({ grant_type: 'client_credentials', scope: 'admin' }), now).status, 400);
    const r = a.token(basic(c.id, c.secret), form, now);
    assert.equal(r.status, 200);
    const tok = String(r.body.access_token);
    assert.equal(a.instance(tok, now), c.id);
    assert.equal(a.human(tok), null, 'an agent token is never the admin');
    assert.equal(a.instance(tok, now + 3600_000), null, 'expired after 1 h');
    const [p, id, exp, sig] = tok.split('.');
    assert.equal(a.instance([p, id, String(Number(exp) + 9999), sig].join('.'), now), null, 'expiry moved: signature refused');
    assert.equal(a.instance(a.adminToken, now), null);
    assert.ok(a.hasKey(c.id));
    await a.agentClients('x').remove(c.id);
    assert.ok(!a.hasKey(c.id));
    assert.equal(a.token(basic(c.id, c.secret), form, now).status, 401, 'removed key');
  } finally { rmSync(dir, { recursive: true, force: true }) }
});


test('public address: http on loopback or https, an origin only; never plain http beyond loopback', () => {
  for (const ok of ['http://127.0.0.1:8787', 'http://localhost:8787/', 'http://[::1]:8787', 'https://briefling.example.org', 'https://10.0.0.5:8443'])
    assert.ok(publicUrlAllowed(new URL(ok)), ok);
  for (const no of ['http://192.168.1.10:8787', 'http://briefling.example.org', 'https://x.example/sub', 'https://x.example/?a=1', 'https://u:p@x.example', 'ws://127.0.0.1:8787'])
    assert.ok(!publicUrlAllowed(new URL(no)), no);
});

test('TURN credentials: coturn REST shape (expiry:peer, base64 HMAC-SHA1 of the secret), 5 minutes', () => {
  // expected value computed outside Node: python3 hmac.new(b'north', b'1700000300:s1-a', hashlib.sha1), base64
  assert.deepEqual(turnCredentials({ urls: ['turn:127.0.0.1:3478'], secret: 'north' }, 's1-a', 1_700_000_000_000),
    [{ urls: ['turn:127.0.0.1:3478'], username: '1700000300:s1-a', credential: 'gpfDWMNJ8/8qxhzXxK6GNc08xQU=' }]);
});

test('server in the image: listens on every address, gives its public address, writes the invitation for the hermes service', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bl-img-'));
  const get = (port: number, path: string, host: string) => new Promise<{ status: number; body: string }>((res, rej) =>
    request({ host: '127.0.0.1', port, path, headers: { Host: host } }, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => res({ status: r.statusCode!, body: b })) }).on('error', rej).end());
  await assert.rejects(startServer({ dataDir: join(dir, 'x'), host: '0.0.0.0', port: 0, tick: false, log: () => {} }), /loopback/);
  await assert.rejects(startServer({ dataDir: join(dir, 'x'), port: 0, tick: false, log: () => {}, publicUrl: 'http://192.168.1.10:8787' }), /BRIEFLING_URL/);
  const s = await startServer({ dataDir: join(dir, 'data'), host: '0.0.0.0', container: true, port: 0, tick: false, log: () => {}, agent: 'hermes',
    publicUrl: 'https://briefling.example.org', inviteDir: join(dir, 'invite'), machine: { path: '' } });
  try {
    assert.equal(s.url, 'https://briefling.example.org');
    assert.match(s.joinLink ?? '', /^https:\/\/briefling\.example\.org\/agent\.md\?code=[A-Za-z0-9_-]{32}$/);
    const file = join(dir, 'invite', 'join-link');
    assert.equal(readFileSync(file, 'utf8').trim(), s.joinLink);
    assertPrivate(file);
    const viaProxy = await get(s.port, '/config.json', 'briefling.example.org');
    assert.equal(JSON.parse(viaProxy.body).wsUrl, 'wss://briefling.example.org/ws', 'behind the TLS proxy: wss');
    assert.match(JSON.parse((await get(s.port, '/config.json', `127.0.0.1:${s.port}`)).body).wsUrl, /^ws:\/\/127\.0\.0\.1:\d+\/ws$/, 'a service of the same network namespace');
    assert.equal((await get(s.port, '/config.json', `0.0.0.0:${s.port}`)).status, 421);
    assert.equal((await get(s.port, '/config.json', 'evil.example')).status, 421);
  } finally { await s.close() }
  const again = await startServer({ dataDir: join(dir, 'data'), port: 0, tick: false, log: () => {}, inviteDir: join(dir, 'invite'), machine: { path: '' } });
  try { assert.ok(existsSync(join(dir, 'invite', 'join-link')), 'still unserved: a new link at each start') } finally { await again.close(); rmSync(dir, { recursive: true, force: true }) }
});

test('pinned applets on a standalone server: the hub writes only a token\'s three files, the server serves them, nothing else of the folder', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bl-pin-'));
  const tok = 'AbCdEfGhIjKlMnOpQrSt_-';
  const get = (port: number, path: string) => new Promise<{ status: number; type: string; body: string }>((res, rej) =>
    request({ host: '127.0.0.1', port, path }, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => res({ status: r.statusCode!, type: String(r.headers['content-type']), body: b })) }).on('error', rej).end());
  const site = diskSite(join(dir, 'data', 'site'));
  await assert.rejects(site.put('a/../../server-key', 'x', 'text/plain'), /bad site key/);
  await assert.rejects(site.put(`a/${tok}/index.html`, 'x', 'text/html'), /bad site key/);
  await site.put(`a/${tok}/manifest.webmanifest`, '{"name":"Devis"}', 'application/manifest+json');
  const s = await startServer({ dataDir: join(dir, 'data'), port: 0, tick: false, log: () => {}, machine: { path: '' } });
  try {
    const m = await get(s.port, `/a/${tok}/manifest.webmanifest`);
    assert.deepEqual([m.status, m.type, m.body], [200, 'application/manifest+json', '{"name":"Devis"}']);
    assert.equal((await get(s.port, `/a/${tok}/icon-192.png`)).status, 404);
    await site.remove(`a/${tok}/manifest.webmanifest`);
    assert.equal((await get(s.port, `/a/${tok}/manifest.webmanifest`)).status, 404, 'removed with the applet');
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }) }
});
