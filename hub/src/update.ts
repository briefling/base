// Updates of the standalone server (hub/src/server.ts) from the npm registry, shown to the admins (client/src/serverupdate.ts).
//   check:   GET <registry>/briefling/latest 30 s after the start, then once a day (BRIEFLING_UPDATE_CHECK=0: never).
//            Only a stable x.y.z strictly above the running one counts: never a downgrade, never a pre-release.
//   apply:   only for the service (`briefling install`, its copy in <data>/app). The version the admin was shown (pinned,
//            not « latest » again), its tarball from the registry's own host, its sha512 checked against the registry's
//            `dist.integrity`, extracted aside, its `cli.mjs --version` run. Then it waits until no agent turn runs, backs
//            the database up (VACUUM INTO, a consistent copy under WAL), swaps <data>/app (old one kept in app.prev),
//            writes update.json and exits non-zero: launchd / systemd restart the service on the new version, whose
//            guard (hub/src/bootguard.ts) rolls back if it does not start.
//   others:  npx, a global npm install, the Docker image: the command to run, nothing installed by the server.
// The check sends nothing but the request (no id, no version in the URL); the registry sees the machine's address.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readRecord, writeRecord, type UpdateRecord } from './bootguard.ts';
import { proxyFetch } from './proxyfetch.ts';

export const PACKAGE = 'briefling';
export const REGISTRY = 'https://registry.npmjs.org';
export const FIRST_CHECK_MS = 30_000, CHECK_EVERY_MS = 24 * 3600_000, IDLE_POLL_MS = 5_000;
const MAX_META = 256 * 1024, MAX_TARBALL = 50 * 1024 * 1024, KEEP_BACKUPS = 3;

/** How this server was started: decides whether it can update itself or shows a command. */
export type InstallMode = 'service' | 'npx' | 'npm' | 'docker' | 'dev';

const SEMVER = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;
/** A stable version strictly above `current` (both x.y.z; anything else is never newer). */
export function isNewer(candidate: string, current: string): boolean {
  const a = SEMVER.exec(candidate), b = SEMVER.exec(current);
  if (!a || !b) return false;
  for (let i = 1; i <= 3; i++) if (Number(a[i]) !== Number(b[i])) return Number(a[i]) > Number(b[i]);
  return false;
}

export interface Release { version: string; tarball: string; integrity: string }
/** The registry's `latest` manifest, if it is a release of this package we may install: its tarball on the registry's
 *  host under the package's path, a sha512 integrity. */
export function validRelease(body: unknown, registry = REGISTRY): Release | null {
  const b = body as { name?: unknown; version?: unknown; dist?: { tarball?: unknown; integrity?: unknown } } | null;
  if (!b || b.name !== PACKAGE || typeof b.version !== 'string' || !SEMVER.test(b.version)) return null;
  const tarball = b.dist?.tarball, integrity = b.dist?.integrity;
  if (typeof tarball !== 'string' || typeof integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity)) return null;
  let u: URL;
  try { u = new URL(tarball) } catch { return null }
  const reg = new URL(registry);
  if (u.protocol !== reg.protocol || u.host !== reg.host || u.username || u.password || u.search || u.hash) return null;
  if (u.pathname !== `${reg.pathname.replace(/\/$/, '')}/${PACKAGE}/-/${PACKAGE}-${b.version}.tgz`) return null;
  if (reg.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(reg.hostname)) return null; // http: a local test registry only
  return { version: b.version, tarball: u.href, integrity };
}

async function readCapped(r: Response, max: number): Promise<Buffer> {
  if (Number(r.headers.get('content-length') ?? 0) > max) throw new Error('too_big');
  const parts: Buffer[] = []; let n = 0;
  for await (const c of r.body as unknown as AsyncIterable<Uint8Array>) { n += c.length; if (n > max) throw new Error('too_big'); parts.push(Buffer.from(c)) }
  return Buffer.concat(parts);
}

export async function fetchLatest(fetchFn: typeof fetch, registry = REGISTRY): Promise<Release | null> {
  const r = await fetchFn(`${registry.replace(/\/$/, '')}/${PACKAGE}/latest`, { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`registry_${r.status}`);
  return validRelease(JSON.parse((await readCapped(r, MAX_META)).toString('utf8')), registry);
}

/** The tarball's bytes, refused unless their sha512 is the registry's `dist.integrity`. */
export async function download(fetchFn: typeof fetch, rel: Release): Promise<Buffer> {
  const r = await fetchFn(rel.tarball, { redirect: 'error', signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error(`download_${r.status}`);
  const bytes = await readCapped(r, MAX_TARBALL);
  if (`sha512-${createHash('sha512').update(bytes).digest('base64')}` !== rel.integrity) throw new Error('integrity');
  return bytes;
}

/** `tgz` extracted into `dir` (system tar: macOS and Linux, the only service platforms), checked to be that release. */
export function extract(tgz: string, dir: string, version: string, run = execFileSync): string {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  run('tar', ['-xzf', tgz, '-C', dir, '--no-same-owner'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const pkg = join(dir, 'package');
  const meta = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
  if (meta.name !== PACKAGE || meta.version !== version) throw new Error('not_the_release');
  for (const f of ['cli.mjs', 'briefling.mjs', 'client/index.html']) if (!existsSync(join(pkg, f))) throw new Error('incomplete');
  return pkg;
}

export interface UpdateState {
  current: string; mode: InstallMode; check: boolean
  latest?: string; checkedAt?: number
  status: 'idle' | 'downloading' | 'waiting' | 'restarting' | 'failed'
  /** waiting: conversations with an agent turn running. failed: why. */
  busy?: number; error?: string
  /** npx / npm / docker: what to run instead. */
  command?: string
  /** The last update of this server (update.json): from, to, state (ok / rolled_back). */
  last?: Pick<UpdateRecord, 'from' | 'to' | 'state' | 'at'>
}

export function commandFor(mode: InstallMode, version: string): string | undefined {
  if (mode === 'npx') return `npx -y ${PACKAGE}@${version}`;
  if (mode === 'npm') return `npm install -g ${PACKAGE}@${version}`;
  if (mode === 'docker') return 'docker compose pull && docker compose up -d';
  return undefined;
}

export interface UpdaterDeps {
  current: string; mode: InstallMode; dataDir: string; enabled: boolean
  registry?: string; fetch?: typeof fetch; now?: () => number; log?: (s: string) => void
  /** Conversations with an agent turn running now. */
  busy(): Promise<number>
  /** A consistent copy of the database at `path`. */
  backup(path: string): void
  /** Stop the server and exit non-zero (the service starts it again). */
  restart(): Promise<void>
  run?: typeof execFileSync; idlePollMs?: number
}

export function makeUpdater(d: UpdaterDeps) {
  const fetchFn = d.fetch ?? proxyFetch(), now = d.now ?? Date.now, log = d.log ?? (() => {}), registry = d.registry ?? REGISTRY, run = d.run ?? execFileSync;
  let latest: Release | null = null, checkedAt: number | undefined, status: UpdateState['status'] = 'idle', busyN: number | undefined, error: string | undefined;
  let cancelled = false, timers: NodeJS.Timeout[] = [];
  const canCheck = d.enabled;

  async function check(): Promise<void> {
    if (!canCheck) return;
    try {
      const rel = await fetchLatest(fetchFn, registry);
      checkedAt = now();
      if (rel && isNewer(rel.version, d.current)) { if (latest?.version !== rel.version) log(`update: briefling ${rel.version} available (running ${d.current})`); latest = rel }
      else latest = null;
    } catch (e) { log(`update: check failed (${(e as Error)?.message})`) }
  }
  function state(): UpdateState {
    const rec = readRecord(d.dataDir);
    return { current: d.current, mode: d.mode, check: canCheck, ...(latest ? { latest: latest.version } : {}), ...(checkedAt ? { checkedAt } : {}), status,
      ...(status === 'waiting' && busyN !== undefined ? { busy: busyN } : {}), ...(status === 'failed' && error ? { error } : {}),
      ...(latest && commandFor(d.mode, latest.version) ? { command: commandFor(d.mode, latest.version) } : {}),
      ...(rec ? { last: { from: rec.from, to: rec.to, state: rec.state, at: rec.at } } : {}) };
  }
  const fail = (code: string) => { status = 'failed'; error = code; log(`update: failed (${code})`) };

  /** The admin's « Update »: `version` must be the one announced. Resolves once the install is staged (the wait and the
   *  restart go on in the background). */
  async function apply(version: string): Promise<{ ok: boolean; code?: string }> {
    if (d.mode !== 'service') return { ok: false, code: 'not_service' };
    if (!latest || latest.version !== version) return { ok: false, code: 'not_announced' };
    if (status === 'downloading' || status === 'waiting' || status === 'restarting') return { ok: false, code: 'in_progress' };
    const rel = latest, dir = join(d.dataDir, 'update'), app = join(d.dataDir, 'app');
    if (!existsSync(join(app, 'cli.mjs'))) return { ok: false, code: 'no_copy' };
    status = 'downloading'; error = undefined; cancelled = false;
    let pkg: string;
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const tgz = join(dir, `${PACKAGE}-${rel.version}.tgz`);
      writeFileSync(tgz, await download(fetchFn, rel), { mode: 0o600 });
      pkg = extract(tgz, join(dir, 'next'), rel.version, run);
      // The new bundle loads (no data touched): `--version` answers its own number.
      const v = String(run(process.execPath, [join(pkg, 'cli.mjs'), '--version'], { encoding: 'utf8', timeout: 30_000, env: { PATH: process.env.PATH ?? '' }, stdio: ['ignore', 'pipe', 'pipe'] })).trim();
      if (v !== rel.version) throw new Error('preflight');
    } catch (e) {
      const m = (e as Error)?.message ?? '';
      fail(['integrity', 'too_big', 'not_the_release', 'incomplete', 'preflight'].includes(m) || /^(download|registry)_/.test(m) ? m : 'download');
      return { ok: false, code: error };
    }
    void (async () => {
      status = 'waiting';
      for (;;) {
        if (cancelled) { status = 'idle'; rmSync(dir, { recursive: true, force: true }); return }
        busyN = await d.busy().catch(() => 1);
        if (!busyN) break;
        await new Promise(r => setTimeout(r, d.idlePollMs ?? IDLE_POLL_MS));
      }
      try {
        status = 'restarting';
        const backups = join(d.dataDir, 'backups');
        mkdirSync(backups, { recursive: true, mode: 0o700 });
        const backup = join(backups, `briefling-${d.current}-${now()}.db`);
        d.backup(backup);
        for (const old of readdirSync(backups).filter(f => /^briefling-.*\.db$/.test(f)).map(f => join(backups, f))
          .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs).slice(KEEP_BACKUPS)) rmSync(old, { force: true });
        writeRecord(d.dataDir, { from: d.current, to: rel.version, at: now(), backup, state: 'pending', tries: 0 });
        rmSync(join(d.dataDir, 'app.prev'), { recursive: true, force: true });
        renameSync(app, join(d.dataDir, 'app.prev'));
        renameSync(pkg, app);
        rmSync(dir, { recursive: true, force: true });
      } catch (e) {
        // Nothing swapped yet, or the old copy back: the running version stays.
        if (!existsSync(app) && existsSync(join(d.dataDir, 'app.prev'))) renameSync(join(d.dataDir, 'app.prev'), app);
        rmSync(join(d.dataDir, 'update.json'), { force: true });
        return fail('swap');
      }
      log(`update: restarting into briefling ${rel.version}`);
      await d.restart();
    })();
    return { ok: true };
  }
  function cancel(): boolean { if (status !== 'waiting') return false; cancelled = true; return true }

  return {
    check, state, apply, cancel,
    start() { if (!canCheck) return; timers = [setTimeout(() => void check(), FIRST_CHECK_MS), setInterval(() => void check(), CHECK_EVERY_MS)]; timers.forEach(t => t.unref()) },
    stop() { timers.forEach(t => clearTimeout(t)); cancelled = true },
  };
}
export type Updater = ReturnType<typeof makeUpdater>;
