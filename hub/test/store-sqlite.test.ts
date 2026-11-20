// Store contract on SQLite (hub/src/sqlite.ts), in memory and on a file, plus writers in parallel on one file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { storeContract } from './store-contract.ts';
import { openSqliteStore } from '../src/sqlite.ts';

storeContract('sqlite', async () => {
  const s = openSqliteStore(':memory:');
  return { store: s.store, seedAdmin: async (u: string) => s.seedAdmin(u), close: async () => s.close() };
});

storeContract('sqlite-file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'briefling-sqlite-'));
  const s = openSqliteStore(join(dir, 'briefling.db'));
  return { store: s.store, seedAdmin: async (u: string) => s.seedAdmin(u), close: async () => { s.close(); rmSync(dir, { recursive: true, force: true }) } };
});

// Several connections on one file, truly in parallel (threads): the IMMEDIATE transactions must lose no write.
test('sqlite-file › parallel connections: no lost update, no counter overshoot', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'briefling-sqlite-'));
  const path = join(dir, 'briefling.db');
  try {
    const s = openSqliteStore(path);
    await s.store.putThread({ id: 'race', space: 'sp', title: 'race', owner: 'gaston', state: 'idle', updatedAt: 1, version: 1, lastTurnAt: 0, facts: {} } as any, null);
    s.close();
    const WORKERS = 4, ROUNDS = 300, gate = new SharedArrayBuffer(8);
    new Int32Array(gate)[1] = WORKERS;
    const out = await Promise.all(Array.from({ length: WORKERS }, () => new Promise<{ counted: number; retries: number }>((ok, ko) => {
      const w = new Worker(new URL('./sqlite-worker.ts', import.meta.url), { workerData: { path, rounds: ROUNDS, cap: WORKERS * ROUNDS - 7, gate } });
      w.once('message', ok); w.once('error', ko);
    })));
    const r = openSqliteStore(path);
    assert.equal((await r.store.getThread('race'))!.version, 1 + WORKERS * ROUNDS, 'every optimistic increment landed once');
    // The cap sits 7 under the attempts: exactly cap counts succeed, never one more (no read-then-write race).
    assert.equal(out.reduce((n, x) => n + x.counted, 0), WORKERS * ROUNDS - 7, 'counter stops exactly at the cap');
    assert.equal(await r.store.countAgentTopic('sp', 'gaston', '2026-11-16', WORKERS * ROUNDS - 7), false, 'still capped');
    console.log(`[store-contract] sqlite-file parallel: ${WORKERS} connections x ${ROUNDS} rounds, ${out.reduce((n, x) => n + x.retries, 0)} version conflicts retried`);
    assert.ok(out.reduce((n, x) => n + x.retries, 0) > 0, 'the writers really raced (else this test proves nothing)');
    r.close();
  } finally { rmSync(dir, { recursive: true, force: true }) }
});
