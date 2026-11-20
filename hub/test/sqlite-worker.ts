// Worker of the SQLite concurrency test (store-sqlite.test.ts): its own connection on the shared file.
import { parentPort, workerData } from 'node:worker_threads';
import { openSqliteStore } from '../src/sqlite.ts';

const { path, rounds, cap, gate } = workerData as { path: string; rounds: number; cap: number; gate: SharedArrayBuffer };
const { store, close } = openSqliteStore(path);
// Start barrier: every worker has opened its connection before anyone writes, so they really overlap.
const g = new Int32Array(gate); Atomics.add(g, 0, 1); Atomics.notify(g, 0);
while (Atomics.load(g, 0) < Atomics.load(g, 1)) Atomics.wait(g, 0, Atomics.load(g, 0), 50);
let counted = 0, retries = 0;
for (let i = 0; i < rounds; i++) {
  if (await store.countAgentTopic('sp', 'gaston', '2026-11-16', cap)) counted++;
  // Optimistic increment under the version guard: read, write version + 1, retry when another writer moved it.
  for (;;) {
    const t = (await store.getThread('race'))!;
    await new Promise(r => setTimeout(r, 1)); // a real handler awaits between its read and its write: widen the window
    if (await store.putThread({ ...t, version: t.version + 1, updatedAt: t.updatedAt + 1 }, t.version)) break;
    retries++;
  }
}
close();
parentPort!.postMessage({ counted, retries });
