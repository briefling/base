// The npm package's bin (`cli.mjs`, bundled by scripts/build-npm.ts): hides Node's one-line « SQLite is an experimental
// feature » warning (node:sqlite loads with the bundle's static imports, before any of its code runs), then loads the
// bundle through the update guard (hub/src/bootguard.ts: a service start right after an update rolls back if the new
// version does not start). `./briefling.mjs` stays a separate file: this one must load even when that one is broken.
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { guardedStart } from './bootguard.ts';

const emit = process.emitWarning;
process.emitWarning = ((w: unknown, ...a: unknown[]) => /SQLite is an experimental/.test(String((w as Error)?.message ?? w))
  ? undefined : (emit as (...x: unknown[]) => void).call(process, w, ...a)) as typeof process.emitWarning;
const bundle = './briefling.mjs';
await guardedStart(() => import(bundle), { env: process.env, here: dirname(fileURLToPath(import.meta.url)), argv: process.argv.slice(2) });
