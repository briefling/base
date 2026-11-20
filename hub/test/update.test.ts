import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commandFor, download, isNewer, makeUpdater, validRelease, type Release } from '../src/update.ts';
import { guardedStart, readRecord, rollback, writeRecord } from '../src/bootguard.ts';
import { runningTurns, startServer } from '../src/server.ts';
import type { StoredThread } from '../src/router.ts';

const REG = 'https://registry.npmjs.org';
const integrity = (b: Buffer) => `sha512-${createHash('sha512').update(b).digest('base64')}`;
const manifest = (v: string, o: { tarball?: string; integrity?: string; name?: string } = {}) =>
  ({ name: o.name ?? 'briefling', version: v, dist: { tarball: o.tarball ?? `${REG}/briefling/-/briefling-${v}.tgz`, integrity: o.integrity ?? integrity(Buffer.from(v)) } });

test('newer: stable x.y.z strictly above, never a downgrade nor a pre-release', () => {
  assert.equal(isNewer('0.1.2', '0.1.1'), true);
  assert.equal(isNewer('0.10.0', '0.9.9'), true);
  assert.equal(isNewer('1.0.0', '0.99.99'), true);
  for (const [a, b] of [['0.1.1', '0.1.1'], ['0.1.0', '0.1.1'], ['0.2.0-rc.1', '0.1.1'], ['0.0.0-stage', '0.0.0'], ['v0.2.0', '0.1.1'], ['0.2.0', 'dev'], ['01.2.0', '0.1.0']])
    assert.equal(isNewer(a, b), false, `${a} vs ${b}`);
});

test('release: this package, its tarball on the registry host and path, a sha512', () => {
  assert.deepEqual(validRelease(manifest('0.2.0')), { version: '0.2.0', tarball: `${REG}/briefling/-/briefling-0.2.0.tgz`, integrity: integrity(Buffer.from('0.2.0')) });
  for (const bad of [manifest('0.2.0', { name: 'briefling-x' }), manifest('0.2.0', { tarball: 'https://evil.example/briefling/-/briefling-0.2.0.tgz' }),
    manifest('0.2.0', { tarball: `${REG}/briefling/-/briefling-0.1.0.tgz` }), manifest('0.2.0', { tarball: `${REG}/other/-/other-0.2.0.tgz` }),
    manifest('0.2.0', { tarball: `${REG}/briefling/-/briefling-0.2.0.tgz?x=1` }), manifest('0.2.0', { tarball: `http://registry.npmjs.org/briefling/-/briefling-0.2.0.tgz` }),
    manifest('0.2.0', { integrity: 'sha1-abc' }), manifest('0.2.0-rc.1'), null, 'x', { name: 'briefling' }])
    assert.equal(validRelease(bad), null, JSON.stringify(bad));
  // http only for a registry on loopback (tests)
  assert.ok(validRelease(manifest('0.2.0', { tarball: 'http://127.0.0.1:9/briefling/-/briefling-0.2.0.tgz' }), 'http://127.0.0.1:9'));
  assert.equal(validRelease(manifest('0.2.0', { tarball: 'http://10.0.0.1:9/briefling/-/briefling-0.2.0.tgz' }), 'http://10.0.0.1:9'), null);
});

test('download: refused when the bytes are not the integrity of the manifest', async () => {
  const body = Buffer.from('the tarball');
  const f = (async () => new Response(new Uint8Array(body))) as unknown as typeof fetch;
  const rel: Release = { version: '0.2.0', tarball: `${REG}/briefling/-/briefling-0.2.0.tgz`, integrity: integrity(body) };
  assert.deepEqual(await download(f, rel), body);
  await assert.rejects(download(f, { ...rel, integrity: integrity(Buffer.from('other')) }), /integrity/);
});

test('commands for the installs the server does not update itself', () => {
  assert.equal(commandFor('npx', '0.2.0'), 'npx -y briefling@0.2.0');
  assert.equal(commandFor('npm', '0.2.0'), 'npm install -g briefling@0.2.0');
  assert.equal(commandFor('docker', '0.2.0'), 'docker compose pull && docker compose up -d');
  assert.equal(commandFor('service', '0.2.0'), undefined);
});

/** A data folder with an installed copy (<data>/app) and a registry serving `pkgs` (version -> tarball bytes). */
function fixture(current: string) {
  const data = mkdtempSync(join(tmpdir(), 'upd-'));
  const app = join(data, 'app');
  mkdirSync(app, { recursive: true });
  writeFileSync(join(app, 'cli.mjs'), `console.log('${current}')\n`);
  writeFileSync(join(data, 'briefling.db'), 'db-before');
  return { data, app };
}
function tarball(version: string, o: { cliVersion?: string; name?: string } = {}): Buffer {
  const d = mkdtempSync(join(tmpdir(), 'upd-pkg-')), p = join(d, 'package');
  mkdirSync(join(p, 'client'), { recursive: true });
  writeFileSync(join(p, 'package.json'), JSON.stringify({ name: o.name ?? 'briefling', version }));
  writeFileSync(join(p, 'cli.mjs'), `console.log(${JSON.stringify(o.cliVersion ?? version)})\n`);
  writeFileSync(join(p, 'briefling.mjs'), '');
  writeFileSync(join(p, 'client/index.html'), '');
  execFileSync('tar', ['-czf', join(d, 'x.tgz'), '-C', d, 'package']);
  return readFileSync(join(d, 'x.tgz'));
}
function registry(pkgs: Record<string, Buffer>, latest: string): typeof fetch {
  return (async (url: string) => {
    if (url === `${REG}/briefling/latest`) return Response.json(manifest(latest, { integrity: integrity(pkgs[latest]) }));
    const v = /briefling-(.+)\.tgz$/.exec(url)?.[1];
    return v && pkgs[v] ? new Response(new Uint8Array(pkgs[v])) : new Response('', { status: 404 });
  }) as unknown as typeof fetch;
}
// Building and extracting tarballs needs a POSIX tar, and the in-place update is for the service (macOS, Linux only):
// Git's GNU tar on Windows reads `C:` in a path as a remote host.
const posix = { skip: process.platform === 'win32' ? 'no service on Windows' : false };
const until = async (ok: () => boolean) => { for (let i = 0; i < 200 && !ok(); i++) await new Promise(r => setTimeout(r, 25)) };

test('apply: pinned to the announced version, waits for no turn, backs up, swaps, restarts', posix, async () => {
  const { data, app } = fixture('0.1.0');
  let busy = 2, restarted = 0;
  const u = makeUpdater({ current: '0.1.0', mode: 'service', enabled: true, dataDir: data, fetch: registry({ '0.2.0': tarball('0.2.0') }, '0.2.0'),
    idlePollMs: 20, busy: async () => busy, backup: p => writeFileSync(p, readFileSync(join(data, 'briefling.db'))), restart: async () => { restarted++ } });
  assert.equal(u.state().latest, undefined);
  await u.check();
  assert.equal(u.state().latest, '0.2.0');
  assert.equal(u.state().command, undefined); // the service: the button, no command
  assert.deepEqual(await u.apply('0.3.0'), { ok: false, code: 'not_announced' });
  assert.deepEqual(await u.apply('0.2.0'), { ok: true });
  await until(() => u.state().status === 'waiting' && u.state().busy === 2);
  assert.equal(u.state().busy, 2);
  assert.equal(readFileSync(join(app, 'cli.mjs'), 'utf8'), "console.log('0.1.0')\n"); // nothing swapped while turns run
  busy = 0;
  await until(() => restarted > 0);
  assert.equal(restarted, 1);
  assert.equal(JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')).version, '0.2.0');
  assert.equal(readFileSync(join(data, 'app.prev', 'cli.mjs'), 'utf8'), "console.log('0.1.0')\n");
  const rec = readRecord(data)!;
  assert.deepEqual([rec.from, rec.to, rec.state, rec.tries], ['0.1.0', '0.2.0', 'pending', 0]);
  assert.equal(readFileSync(rec.backup, 'utf8'), 'db-before');
  assert.equal(existsSync(join(data, 'update')), false);
});

test('apply: a bad download or a bundle that does not answer its version changes nothing', posix, async () => {
  for (const [what, pkg, code] of [['other package', tarball('0.2.0', { name: 'evil' }), 'not_the_release'], ['broken bundle', tarball('0.2.0', { cliVersion: '0.1.0' }), 'preflight']] as const) {
    const { data, app } = fixture('0.1.0');
    let restarted = 0;
    const u = makeUpdater({ current: '0.1.0', mode: 'service', enabled: true, dataDir: data, fetch: registry({ '0.2.0': pkg }, '0.2.0'),
      busy: async () => 0, backup: () => {}, restart: async () => { restarted++ } });
    await u.check();
    assert.deepEqual(await u.apply('0.2.0'), { ok: false, code }, what);
    assert.equal(u.state().status, 'failed');
    assert.equal(readFileSync(join(app, 'cli.mjs'), 'utf8'), "console.log('0.1.0')\n", what);
    assert.equal(restarted, 0);
  }
});

test('apply: refused outside the service; cancel while waiting; check off = never asks', posix, async () => {
  const { data } = fixture('0.1.0');
  const reg = registry({ '0.2.0': tarball('0.2.0') }, '0.2.0');
  const npx = makeUpdater({ current: '0.1.0', mode: 'npx', enabled: true, dataDir: data, fetch: reg, busy: async () => 0, backup: () => {}, restart: async () => {} });
  await npx.check();
  assert.equal(npx.state().command, 'npx -y briefling@0.2.0');
  assert.deepEqual(await npx.apply('0.2.0'), { ok: false, code: 'not_service' });
  const svc = makeUpdater({ current: '0.1.0', mode: 'service', enabled: true, dataDir: data, fetch: reg, idlePollMs: 20, busy: async () => 1, backup: () => {}, restart: async () => { throw new Error('no') } });
  await svc.check();
  await svc.apply('0.2.0');
  await until(() => svc.state().status === 'waiting');
  assert.equal(svc.cancel(), true);
  await until(() => svc.state().status === 'idle');
  assert.equal(svc.state().status, 'idle');
  let asked = 0;
  const off = makeUpdater({ current: '0.1.0', mode: 'service', enabled: false, dataDir: data, fetch: (async () => { asked++; return new Response('') }) as unknown as typeof fetch,
    busy: async () => 0, backup: () => {}, restart: async () => {} });
  await off.check();
  assert.equal(asked, 0);
  assert.equal(off.state().check, false);
  // the registry answering an older or the same version: nothing announced
  const same = makeUpdater({ current: '0.2.0', mode: 'service', enabled: true, dataDir: data, fetch: reg, busy: async () => 0, backup: () => {}, restart: async () => {} });
  await same.check();
  assert.equal(same.state().latest, undefined);
});

test('guard: ok once the new version listens; rolled back (code and database) when it fails to start', async () => {
  const setup = () => {
    const { data, app } = fixture('0.2.0');
    mkdirSync(join(data, 'app.prev'));
    writeFileSync(join(data, 'app.prev', 'cli.mjs'), 'old');
    writeFileSync(join(data, 'backup.db'), 'db-before');
    writeFileSync(join(data, 'briefling.db'), 'db-migrated');
    writeFileSync(join(data, 'briefling.db-wal'), 'wal');
    writeRecord(data, { from: '0.1.0', to: '0.2.0', at: 1, backup: join(data, 'backup.db'), state: 'pending', tries: 0 });
    return { data, app, env: { BRIEFLING_SERVICE: '1', BRIEFLING_DATA: data } };
  };
  const a = setup();
  await guardedStart(async () => {}, { env: a.env, here: a.app, argv: ['start'] });
  assert.equal(readRecord(a.data)!.state, 'ok');
  assert.equal(readFileSync(join(a.data, 'briefling.db'), 'utf8'), 'db-migrated');

  const b = setup();
  assert.equal(rollback(b.data, 'start_failed'), true);
  assert.equal(readFileSync(join(b.app, 'cli.mjs'), 'utf8'), 'old');
  assert.equal(readFileSync(join(b.data, 'briefling.db'), 'utf8'), 'db-before');
  assert.equal(existsSync(join(b.data, 'briefling.db-wal')), false);
  assert.equal(existsSync(join(b.data, 'app.failed', 'cli.mjs')), true);
  assert.deepEqual([readRecord(b.data)!.state, readRecord(b.data)!.reason], ['rolled_back', 'start_failed']);
  assert.equal(rollback(b.data, 'again'), false); // once

  // not a service start from <data>/app: nothing read nor written
  const c = setup();
  let loaded = 0;
  await guardedStart(async () => { loaded++ }, { env: {}, here: c.app, argv: ['start'] });
  await guardedStart(async () => { loaded++ }, { env: c.env, here: c.app, argv: ['url'] });
  assert.equal(loaded, 2);
  assert.equal(readRecord(c.data)!.state, 'pending');
});

test('running turns: owner or guests in a turn; a leftover turn (more than 12 h) does not hold the update', () => {
  const now = 100 * 3600_000;
  const th = (o: Partial<StoredThread>) => ({ id: 'x', owner: 'milan', lastTurnAt: now - 60_000, facts: { turnActive: false }, ...o }) as unknown as StoredThread;
  assert.equal(runningTurns([th({}), th({ facts: { turnActive: true } } as Partial<StoredThread>)], now), 1);
  assert.equal(runningTurns([th({ turns: { milan: { at: now - 1000, active: false }, gaston: { at: now - 1000, active: true } } } as Partial<StoredThread>)], now), 1);
  assert.equal(runningTurns([th({ facts: { turnActive: true }, lastTurnAt: now - 13 * 3600_000 } as Partial<StoredThread>)], now), 0);
});

test('/local/update: a global admin only, same origin, JSON; the state of the updater', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bl-upd-'));
  const reg = registry({ '9.0.0': Buffer.from('a tarball never downloaded here') }, '9.0.0');
  const s = await startServer({ dataDir: join(dir, 'data'), port: 0, tick: false, log: () => {}, machine: { path: '' },
    update: { current: '0.1.0', mode: 'npx', enabled: true, fetch: reg } });
  const call = (o: { method?: string; auth?: string; origin?: string; body?: string; type?: string } = {}) => fetch(`${s.url}/local/update`, { method: o.method ?? 'GET',
    headers: { ...(o.auth !== '' ? { Authorization: `Bearer ${o.auth ?? s.adminToken}` } : {}), ...(o.origin ? { Origin: o.origin } : {}), ...(o.type ? { 'Content-Type': o.type } : {}) }, ...(o.body ? { body: o.body } : {}) });
  try {
    assert.equal((await call({ auth: '' })).status, 401);
    assert.equal((await call({ auth: 'x'.repeat(40) })).status, 401);
    assert.equal((await call({ origin: 'https://evil.example' })).status, 403);
    assert.equal((await call({ method: 'POST', body: '{"action":"check"}', type: 'text/plain' })).status, 415);
    const st = await (await call()).json();
    assert.deepEqual([st.current, st.mode, st.check, st.latest], ['0.1.0', 'npx', true, undefined]);
    const c = await (await call({ method: 'POST', body: '{"action":"check"}', type: 'application/json' })).json();
    assert.deepEqual([c.latest, c.command], ['9.0.0', 'npx -y briefling@9.0.0']);
    const a = await call({ method: 'POST', body: '{"action":"apply","version":"9.0.0"}', type: 'application/json' });
    assert.deepEqual([a.status, (await a.json()).code], [409, 'not_service']);
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }) }
  // No updater (a server started without it): 204, nothing in the browser's console.
  const bare = await startServer({ dataDir: join(dir, 'bare'), port: 0, tick: false, log: () => {}, machine: { path: '' } });
  try {
    assert.equal((await fetch(`${bare.url}/local/update`, { headers: { Authorization: `Bearer ${bare.adminToken}` } })).status, 204);
  } finally { await bare.close(); rmSync(dir, { recursive: true, force: true }) }
});
