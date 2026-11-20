// Rollback of a server update (hub/src/update.ts), run by the package's `cli.mjs` before the server loads
// (scripts/build-npm.ts bundles hub/src/shim.ts with this file). The update swapped `<data>/app` for the new version,
// kept the old one in `<data>/app.prev`, backed the database up and wrote `<data>/update.json` with `state: pending`.
// The service manager (launchd, systemd --user) then starts the NEW `cli.mjs`, so this code is the new version's:
//   - the server listens (its start resolved): the update is `ok`;
//   - its start throws, or the service restarted it MAX_TRIES times without reaching that point: the old version goes
//     back in `<data>/app`, the database backup replaces the file (its WAL too: the new version's writes go), the state
//     says `rolled_back`, and the process exits non-zero so the service starts the old version.
// No-op outside a service start from `<data>/app` (npx, a checkout, `briefling url`), and when nothing is pending.
import { copyFileSync, existsSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const MAX_TRIES = 3;

export interface UpdateRecord { from: string; to: string; at: number; backup: string; state: 'pending' | 'ok' | 'rolled_back'; tries: number; reason?: string }

export const recordPath = (dataDir: string) => join(dataDir, 'update.json');
export function readRecord(dataDir: string): UpdateRecord | null {
  try {
    const r = JSON.parse(readFileSync(recordPath(dataDir), 'utf8'));
    return r && typeof r.from === 'string' && typeof r.to === 'string' && typeof r.state === 'string' ? r as UpdateRecord : null;
  } catch { return null }
}
export function writeRecord(dataDir: string, r: UpdateRecord) {
  const p = recordPath(dataDir);
  writeFileSync(`${p}.tmp`, JSON.stringify(r), { mode: 0o600 });
  renameSync(`${p}.tmp`, p);
}

/** The old version back in `<data>/app` and the database as it was before the update. */
export function rollback(dataDir: string, reason: string): boolean {
  const app = join(dataDir, 'app'), prev = join(dataDir, 'app.prev'), r = readRecord(dataDir);
  if (!r || r.state !== 'pending' || !existsSync(prev)) return false;
  rmSync(join(dataDir, 'app.failed'), { recursive: true, force: true });
  if (existsSync(app)) renameSync(app, join(dataDir, 'app.failed'));
  renameSync(prev, app);
  if (r.backup && existsSync(r.backup)) {
    const db = join(dataDir, 'briefling.db');
    copyFileSync(r.backup, `${db}.restore`);
    for (const x of ['-wal', '-shm']) rmSync(db + x, { force: true });
    renameSync(`${db}.restore`, db);
  }
  writeRecord(dataDir, { ...r, state: 'rolled_back', reason });
  return true;
}

/** `load` starts the server (resolves once it listens). `here`: the folder of the running `cli.mjs`. */
export async function guardedStart(load: () => Promise<unknown>, o: { env: NodeJS.ProcessEnv; here: string; argv: string[]; log?: (s: string) => void }) {
  const data = o.env.BRIEFLING_DATA, log = o.log ?? ((s: string) => console.error(s));
  // The module's own path is the real one (ESM resolves symlinks): compare real paths (macOS /tmp is /private/tmp).
  const real = (p: string) => { try { return realpathSync(p) } catch { return resolve(p) } };
  const active = o.env.BRIEFLING_SERVICE === '1' && !!data && real(o.here) === real(join(data, 'app')) && (o.argv[0] ?? 'start') === 'start';
  const r = active ? readRecord(data!) : null;
  if (!r || r.state !== 'pending') return void await load();
  if (r.tries >= MAX_TRIES) {
    if (rollback(data!, 'no_start')) log(`briefling: ${r.to} did not start ${r.tries} times, back to ${r.from}`);
    process.exit(1);
  }
  writeRecord(data!, { ...r, tries: r.tries + 1 });
  // The server's own start errors end the process (runFromEnv: process.exit(1)) without coming back here.
  let started = false;
  const onExit = (code: number) => { if (!started && code !== 0 && rollback(data!, 'start_failed')) log(`briefling: ${r.to} failed to start, back to ${r.from}`) };
  process.once('exit', onExit);
  try { await load() } catch (e) {
    log(`briefling: ${r.to} failed to start (${(e as Error)?.message?.split('\n')[0]})`);
    process.exit(1);
  }
  started = true;
  process.off('exit', onExit);
  const now = readRecord(data!);
  if (now?.state === 'pending') writeRecord(data!, { ...now, state: 'ok' });
}
