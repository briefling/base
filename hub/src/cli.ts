// The `briefling` command of the npm package (scripts/build-npm.ts bundles this file, the server and the built PWA):
//   briefling [start]      the standalone server (hub/src/server.ts) on this machine, data in the user's data folder
//   briefling url          the admin's sign-in link (the token stays in the data folder, never in a service log)
//   briefling install      a user service that starts it with the session (launchd / systemd --user, hub/src/service.ts)
//   briefling uninstall    removes that service (the data stays)
// Options: --port N, --data DIR (else BRIEFLING_PORT, BRIEFLING_DATA; every other setting is a BRIEFLING_* variable,
// docs/self-hosted.md).
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { defaultDataDir, install, uninstall } from './service.ts';

declare const __BRIEFLING_VERSION__: string | undefined; // set by the bundler (scripts/build-npm.ts)
const VERSION = typeof __BRIEFLING_VERSION__ === 'string' ? __BRIEFLING_VERSION__ : 'dev';

const HELP = `briefling ${VERSION}: a hub where people and AI agents work together, on this machine.

Usage: briefling [command] [--port N] [--data DIR]

  start       run the server (default): http://127.0.0.1:8787, data in ${defaultDataDir(process.platform, {}, '~')}
  url         print the sign-in link of this machine's server
  install     start the server with your session (launchd on macOS, systemd --user on Linux)
  uninstall   remove that service (your data stays)
  --version   print the version

Settings: BRIEFLING_* environment variables (port, data folder, OIDC sign-in...), see the README.
`;

export function parseArgs(argv: string[]): { cmd: string; port?: string; data?: string } {
  const out: { cmd: string; port?: string; data?: string } = { cmd: 'start' };
  let cmdSet = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = (name: string) => { const v = argv[++i]; if (v === undefined || v.startsWith('--')) throw new Error(`${name} needs a value`); return v };
    if (a === '--port') { out.port = val(a); if (!/^\d{1,5}$/.test(out.port) || Number(out.port) > 65535) throw new Error(`--port: a number from 0 to 65535, not ${out.port}`) }
    else if (a === '--data') out.data = val(a);
    else if (a === '-h' || a === '--help') { out.cmd = 'help'; cmdSet = true }
    else if (a === '-v' || a === '--version') { out.cmd = 'version'; cmdSet = true }
    else if (!a.startsWith('-') && !cmdSet && ['start', 'url', 'install', 'uninstall', 'help', 'version'].includes(a)) { out.cmd = a; cmdSet = true }
    else throw new Error(`unknown argument ${a} (briefling --help)`);
  }
  return out;
}

async function main() {
  let args: ReturnType<typeof parseArgs>;
  try { args = parseArgs(process.argv.slice(2)) } catch (e) { console.error(`briefling: ${(e as Error).message}`); process.exit(2) }
  const env = { ...process.env };
  if (args.port) env.BRIEFLING_PORT = args.port;
  const dataDir = resolve(args.data ?? defaultDataDir(process.platform, env, homedir()));
  const here = fileURLToPath(import.meta.url);
  // The package: the PWA next to the bundle. A checkout (node hub/src/cli.ts): client/dist.
  const packaged = existsSync(join(dirname(here), 'client', 'index.html'));
  const clientDir = packaged ? join(dirname(here), 'client') : undefined;

  if (args.cmd === 'help') return void process.stdout.write(HELP);
  if (args.cmd === 'version') return void console.log(VERSION);
  if (args.cmd === 'url') {
    const file = join(dataDir, 'admin-token');
    if (!existsSync(file)) { console.error(`briefling: no server data in ${dataDir} (start it once: briefling)`); process.exit(1) }
    if (env.BRIEFLING_OIDC_ISSUER) return void console.log(`http://127.0.0.1:${env.BRIEFLING_PORT ?? 8787}/ (people sign in at ${env.BRIEFLING_OIDC_ISSUER})`);
    return void console.log(`http://127.0.0.1:${env.BRIEFLING_PORT ?? 8787}/#token=${readFileSync(file, 'utf8').trim()}`);
  }
  if (args.cmd === 'install' || args.cmd === 'uninstall') {
    const run = (cmd: string, a: string[]) => void execFileSync(cmd, a, { stdio: ['ignore', 'ignore', 'pipe'] });
    try {
      if (args.cmd === 'uninstall') {
        const u = uninstall({ platform: process.platform, home: homedir(), uid: process.getuid?.() ?? 0, env, run });
        return void console.log(u ? `briefling: service removed (${u}); your data stays in ${dataDir}` : 'briefling: no service installed');
      }
      const r = install({ platform: process.platform, home: homedir(), uid: process.getuid?.() ?? 0, dataDir, cwd: process.cwd(), env,
        execPath: process.execPath, bundle: packaged ? join(dirname(here), 'cli.mjs') : undefined, run, log: console.log });
      console.log(`briefling: service installed and started (${r.unit}).
  Program: ${r.app}
  Agents work in: ${env.BRIEFLING_AGENT_CWD ?? process.cwd()}
  Log: ${process.platform === 'darwin' ? join(dataDir, 'server.log') : 'journalctl --user -u briefling'}
  Sign-in link: briefling url${args.data ? ` --data ${dataDir}` : ''}${args.port ? ` --port ${args.port}` : ''}
${process.platform === 'linux' ? '  At boot without logging in: loginctl enable-linger\n' : ''}  Remove it: briefling uninstall`);
    } catch (e) {
      const err = e as Error & { stderr?: Buffer };
      console.error(`briefling: ${err.message.split('\n')[0]}${err.stderr?.length ? `\n${String(err.stderr).trim()}` : ''}`);
      process.exit(1);
    }
    return;
  }
  const { runFromEnv } = await import('./server.ts'); // not loaded by the other commands
  // Where the package runs from: npx's cache (`.../_npx/<hash>/node_modules/briefling`), else an npm install.
  const mode = !packaged ? 'dev' as const : realpathSync(here).split(/[\\/]/).includes('_npx') ? 'npx' as const : 'npm' as const;
  await runFromEnv(env, { dataDir, clientDir, service: env.BRIEFLING_SERVICE === '1', version: VERSION === 'dev' ? undefined : VERSION, mode });
}

// Bundled: always the command. From a checkout: `node hub/src/cli.ts` (the tests import parseArgs only).
if (typeof __BRIEFLING_VERSION__ === 'string' || (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))) await main();
