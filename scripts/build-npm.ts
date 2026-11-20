// `npm run build:npm`: the npm package `briefling` (the `npx briefling` command) in .cache/npm/package, then
// `npm pack` it into .cache/npm/briefling-<version>.tgz. One self-contained bundle (hub/src/cli.ts + the server + its
// two runtime packages, ws and aws-jwt-verify, inlined: the package has no dependency to install) and the built PWA.
// Usage: node scripts/build-npm.ts. No single executable (Node SEA): measured, docs/self-hosted.md « npx ».
// Nothing is published here: publishing is scripts/publish-npm.ts (dry run by default).
import { buildSync, transformSync } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, '.cache/npm'), pkg = join(out, 'package');
const meta = JSON.parse(readFileSync(join(root, 'packaging/npm/package.json'), 'utf8'));
const say = (s: string) => console.log(`[build-npm] ${s}`);

execFileSync(process.execPath, [join(root, 'scripts/build-client.ts')], { stdio: 'inherit' });
rmSync(out, { recursive: true, force: true });
mkdirSync(pkg, { recursive: true });

// 1. The command: ESM bundle. `ws` is CommonJS and requires Node built-ins: give the bundle a real `require`.
const banner = "import { createRequire as __briefling_cr } from 'node:module'; const require = __briefling_cr(import.meta.url);";
const r = buildSync({ entryPoints: [join(root, 'hub/src/cli.ts')], bundle: true, platform: 'node', format: 'esm', target: 'node22',
  outfile: join(pkg, 'briefling.mjs'), banner: { js: banner }, define: { __BRIEFLING_VERSION__: JSON.stringify(meta.version) },
  // ws' optional native speedups: never installed, ws falls back to JS.
  external: ['bufferutil', 'utf-8-validate'], legalComments: 'none', metafile: true, logLevel: 'warning' });
const pkgsOf = (m: { inputs: Record<string, unknown> }) => [...new Set(Object.keys(m.inputs).filter(p => p.includes('node_modules/'))
  .map(p => p.split('node_modules/').pop()!.split('/')).map(s => s[0].startsWith('@') ? `${s[0]}/${s[1]}` : s[0]))].sort();
const packages = pkgsOf(r.metafile);
// The PWA (client/dist, built by build-client.ts) inlines its own packages: same entry points, listed, not written.
const web = buildSync({ entryPoints: ['main.ts', 'sw.ts'].map(f => join(root, 'client/src', f)).concat(join(root, 'client/preview/voice-worklet.ts')),
  bundle: true, write: false, metafile: true, outdir: join(out, 'web'), format: 'esm', logLevel: 'silent' });
const webPackages = pkgsOf(web.metafile);
// The notices cover what is listed here, each one's licence checked by hand: a new package fails the build until added.
const KNOWN: Record<string, string> = { ws: 'MIT', 'aws-jwt-verify': 'Apache-2.0', 'markdown-it': 'MIT', 'linkify-it': 'MIT', mdurl: 'MIT',
  'uc.micro': 'MIT', entities: 'BSD-2-Clause', 'punycode.js': 'MIT', morphdom: 'MIT', prismjs: 'MIT', oauth4webapi: 'MIT' };
const unknown = [...packages, ...webPackages].filter(p => !KNOWN[p]);
if (unknown.length) throw new Error(`new package(s) in the bundles, check the licence and add to KNOWN: ${unknown.join(', ')}`);
// The bin (hub/src/shim.ts): hides Node's SQLite warning and starts the bundle through the update guard
// (hub/src/bootguard.ts), Node built-ins only. npm keeps the tarball's mode.
const shim = buildSync({ entryPoints: [join(root, 'hub/src/shim.ts')], bundle: true, platform: 'node', format: 'esm', target: 'node22',
  outfile: join(pkg, 'cli.mjs'), banner: { js: '#!/usr/bin/env node' }, legalComments: 'none', metafile: true, logLevel: 'warning' });
if (pkgsOf(shim.metafile).length) throw new Error(`the bin must stay free of packages: ${pkgsOf(shim.metafile).join(', ')}`);
chmodSync(join(pkg, 'cli.mjs'), 0o755);
if (/@aws-sdk\//.test(readFileSync(join(pkg, 'briefling.mjs'), 'utf8'))) throw new Error('the AWS SDK leaked into the standalone bundle');

// 2. The PWA, the notices, the README and the manifest. File by file: cpSync's native directory copy fails with EACCES
// on bind-mounted folders (agent containers), as in build-client.ts.
const copyTree = (from: string, to: string) => {
  mkdirSync(to, { recursive: true });
  for (const e of readdirSync(from, { withFileTypes: true })) (e.isDirectory() ? copyTree : copyFileSync)(join(from, e.name), join(to, e.name));
};
copyTree(join(root, 'client/dist'), join(pkg, 'client'));
// CSS comments carry design history (names, dates): stripped from the packaged copy only.
writeFileSync(join(pkg, 'client/style.css'), transformSync(readFileSync(join(root, 'client/dist/style.css'), 'utf8'), { loader: 'css', minify: true, legalComments: 'none' }).code);
const licenceText = (p: string) => {
  const d = join(root, 'node_modules', p), f = readdirSync(d).find(n => /^licen[cs]e(-mit)?(\.(md|txt))?$/i.test(n));
  if (!f) throw new Error(`${p}: no licence file`);
  return readFileSync(join(d, f), 'utf8').trim();
};
writeFileSync(join(pkg, 'THIRD-PARTY-NOTICES.txt'), [...new Set([...packages, ...webPackages])].sort().map(p => {
  const v = JSON.parse(readFileSync(join(root, 'node_modules', p, 'package.json'), 'utf8'));
  if (v.license !== KNOWN[p]) throw new Error(`${p} ${v.version} is now ${v.license}, was ${KNOWN[p]}: check it`);
  return `${p} ${v.version} (${v.license})\n\n${licenceText(p)}\n`;
}).join(`\n${'-'.repeat(78)}\n\n`));
copyFileSync(join(root, 'packaging/npm/README.md'), join(pkg, 'README.md'));
if (existsSync(join(root, 'LICENSE'))) copyFileSync(join(root, 'LICENSE'), join(pkg, 'LICENSE'));
else meta.files = meta.files.filter((f: string) => f !== 'LICENSE');
writeFileSync(join(pkg, 'package.json'), `${JSON.stringify(meta, null, 2)}\n`);

// 3. The tarball (what `npm publish` would upload).
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const tgz = execFileSync(npm, ['pack', '--silent', '--pack-destination', out], { cwd: pkg, encoding: 'utf8', shell: process.platform === 'win32' }).trim().split('\n').pop()!;
const size = (f: string) => `${(statSync(f).size / 1e6).toFixed(2)} MB`;
say(`${join(out, tgz)} (${size(join(out, tgz))}; bundle ${size(join(pkg, 'briefling.mjs'))}; runtime packages inlined: ${packages.join(', ')}; PWA: ${webPackages.join(', ')})`);

