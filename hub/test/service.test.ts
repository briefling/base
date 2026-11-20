import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultDataDir, install, launchdPlist, serviceEnv, systemdUnit, uninstall, unitPath } from '../src/service.ts';
import { parseArgs } from '../src/cli.ts';

test('data folder per platform, BRIEFLING_DATA first', () => {
  assert.equal(defaultDataDir('darwin', {}, '/h'), join('/h', 'Library', 'Application Support', 'briefling'));
  assert.equal(defaultDataDir('linux', {}, '/h'), join('/h', '.local', 'share', 'briefling'));
  assert.equal(defaultDataDir('linux', { XDG_DATA_HOME: '/x' }, '/h'), join('/x', 'briefling'));
  assert.equal(defaultDataDir('win32', { LOCALAPPDATA: 'C:\\L' }, '/h'), join('C:\\L', 'briefling'));
  assert.equal(defaultDataDir('darwin', { BRIEFLING_DATA: '/d' }, '/h'), '/d');
});

test('cli arguments: commands, --port and --data, refusals', () => {
  assert.deepEqual(parseArgs([]), { cmd: 'start' });
  assert.deepEqual(parseArgs(['install', '--port', '9000', '--data', '/d']), { cmd: 'install', port: '9000', data: '/d' });
  assert.deepEqual(parseArgs(['--version']), { cmd: 'version' });
  for (const bad of [['--port', '99999'], ['--port', 'x'], ['--port'], ['--data', '--port'], ['rm', '-rf'], ['start', 'url'], ['--token', 'x']])
    assert.throws(() => parseArgs(bad), Error, bad.join(' '));
});

const spec = { program: ['/usr/bin/node', '/d/app/cli.mjs', 'start'], env: { PATH: '/a:/b', BRIEFLING_DATA: '/d & <x>' }, cwd: '/w', log: '/d/server.log' };

test('launchd plist: escaped values, kept alive on failure only', () => {
  const p = launchdPlist(spec);
  assert.match(p, /<key>Label<\/key><string>briefling\.server<\/string>/);
  assert.match(p, /<string>\/d &amp; &lt;x&gt;<\/string>/);
  assert.match(p, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(p, /<key>SuccessfulExit<\/key><false\/>/);
  assert.doesNotMatch(p, /<x>/);
  assert.throws(() => launchdPlist({ ...spec, cwd: '/w\n<key>' }), /line break/);
});

test('systemd unit: quoted words, % and $ escaped, no line break injection', () => {
  const u = systemdUnit({ ...spec, program: ['/opt/my node/node', '/d/100%/cli.mjs', '$HOME'], env: { A: 'x"y\\z' } });
  assert.match(u, /^ExecStart="\/opt\/my node\/node" "\/d\/100%%\/cli\.mjs" "\$\$HOME"$/m);
  assert.match(u, /^Environment="A=x\\"y\\\\z"$/m);
  assert.match(u, /^WorkingDirectory=\/w$/m, 'a bare path: systemd refuses a quoted one');
  assert.match(u, /^Restart=on-failure$/m);
  assert.match(u, /^WantedBy=default\.target$/m);
  assert.throws(() => systemdUnit({ ...spec, env: { A: 'x\nExecStartPre=/bin/evil' } }), /line break/);
});

test('service env: PATH and BRIEFLING_* of the installing shell, the data folder fixed, nothing else', () => {
  const e = serviceEnv({ env: { PATH: '/p', HOME: '/h', AWS_SECRET_ACCESS_KEY: 's', BRIEFLING_PORT: '9000', BRIEFLING_DATA: '/old' }, dataDir: '/d', cwd: '/w' });
  assert.deepEqual(e, { PATH: '/p', BRIEFLING_PORT: '9000', BRIEFLING_DATA: '/d', BRIEFLING_AGENT_CWD: '/w', BRIEFLING_SERVICE: '1' });
});

for (const platform of ['linux', 'darwin'] as const) test(`install / uninstall on ${platform}: program copied, unit 0600, service loaded`, () => {
  const t = mkdtempSync(join(tmpdir(), 'svc-')), home = join(t, 'home'), data = join(t, 'data'), npx = join(t, 'npx', 'briefling');
  mkdirSync(join(npx, 'client'), { recursive: true }); mkdirSync(join(npx, 'node_modules', 'x'), { recursive: true });
  writeFileSync(join(npx, 'cli.mjs'), '//'); writeFileSync(join(npx, 'client', 'index.html'), '<html>');
  const calls: string[] = [];
  try {
    const r = install({ platform, home, uid: 501, dataDir: data, cwd: '/w', env: { PATH: '/p', BRIEFLING_PORT: '9000' },
      execPath: '/usr/bin/node', bundle: join(npx, 'cli.mjs'), run: (c, a) => void calls.push([c, ...a].join(' ')), log: () => {} });
    assert.equal(r.unit, unitPath(platform, home, {}));
    if (process.platform !== 'win32') assert.equal(statSync(r.unit).mode & 0o777, 0o600); // no mode bits on Windows
    assert.ok(existsSync(join(data, 'app', 'client', 'index.html')), 'the PWA copied');
    assert.ok(!existsSync(join(data, 'app', 'node_modules')), 'nothing but the package');
    const text = readFileSync(r.unit, 'utf8');
    const copy = join(data, 'app', 'cli.mjs');
    assert.ok(text.includes(platform === 'linux' ? copy.replace(/\\/g, '\\\\') : copy), 'runs the copy, not the npx cache'); // systemd escapes \\
    assert.ok(text.includes('9000'));
    assert.deepEqual(calls, platform === 'darwin'
      ? ['launchctl bootout gui/501/briefling.server', `launchctl bootstrap gui/501 ${r.unit}`]
      : ['systemctl --user daemon-reload', 'systemctl --user enable briefling.service', 'systemctl --user restart briefling.service']);
    // Reinstall from the installed copy (`<data>/app/cli.mjs install`): the copy is kept, not wiped.
    install({ platform, home, uid: 501, dataDir: data, cwd: '/w', env: { PATH: '/p' }, execPath: '/usr/bin/node', bundle: join(data, 'app', 'cli.mjs'), run: () => {}, log: () => {} });
    assert.ok(existsSync(join(data, 'app', 'client', 'index.html')));
    calls.length = 0;
    assert.equal(uninstall({ platform, home, uid: 501, env: {}, run: (c, a) => void calls.push([c, ...a].join(' ')) }), r.unit);
    assert.ok(!existsSync(r.unit));
    assert.ok(existsSync(join(data, 'app')), 'the data stays');
    assert.equal(uninstall({ platform, home, uid: 501, env: {}, run: () => {} }), null);
  } finally { rmSync(t, { recursive: true, force: true }) }
});

test('install on Windows: refused with a way out', () => {
  assert.throws(() => install({ platform: 'win32', home: 'C:\\h', uid: 0, dataDir: 'C:\\d', cwd: 'C:\\w', env: {}, execPath: 'node', run: () => {}, log: () => {} }), /npx briefling/);
});
