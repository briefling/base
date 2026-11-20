// `briefling install` / `uninstall` (hub/src/cli.ts): the standalone server as a user service that starts with the
// session, launchd on macOS (~/Library/LaunchAgents), systemd --user on Linux (~/.config/systemd/user). No root, no
// system unit, no port beyond the server's own. The running package (or the single binary) is first copied into the
// data folder (`<data>/app`): an npx cache can be cleaned at any time, the service must not depend on it. The unit
// carries the PATH of the shell that installed it (the agents' CLIs and uv are found the same way) and the BRIEFLING_*
// settings set then; it is written 0600 (a setting may be a secret). Windows: not supported, the command says so.
import { chmodSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export const LABEL = 'briefling.server'; // launchd label
export const UNIT = 'briefling.service'; // systemd --user unit

/** Where the server keeps its data when BRIEFLING_DATA is not set: the platform's per-user application data folder. */
export function defaultDataDir(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): string {
  if (env.BRIEFLING_DATA) return env.BRIEFLING_DATA;
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'briefling');
  if (platform === 'win32') return join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'briefling');
  return join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'briefling');
}

export interface ServiceSpec { program: string[]; env: Record<string, string>; cwd: string; log: string }

const noNewline = (s: string) => { if (/[\r\n\0]/.test(s)) throw new Error(`refusing a value with a line break: ${JSON.stringify(s.slice(0, 40))}`); return s };
const xml = (s: string) => noNewline(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** launchd user agent: started at login and kept alive; stdout/stderr to the log file of the data folder. */
export function launchdPlist(s: ServiceSpec): string {
  const str = (v: string) => `<string>${xml(v)}</string>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>${str(LABEL)}
  <key>ProgramArguments</key>
  <array>
${s.program.map(a => `    ${str(a)}`).join('\n')}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(s.env).map(([k, v]) => `    <key>${xml(k)}</key>${str(v)}`).join('\n')}
  </dict>
  <key>WorkingDirectory</key>${str(s.cwd)}
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key>${str(s.log)}
  <key>StandardErrorPath</key>${str(s.log)}
</dict>
</plist>
`;
}

// systemd.syntax: WorkingDirectory= takes the bare path (quotes are refused: « bad unit file setting »). A double-quoted word takes C escapes (\\ and \"); `%` starts a specifier everywhere (%%), `$` an
// environment substitution in ExecStart ($$).
const sdQuote = (s: string, exec: boolean) => `"${noNewline(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%').replace(exec ? /\$/g : /(?!)/g, '$$$$')}"`;

/** systemd --user unit: started with the user's session (at boot too after `loginctl enable-linger`), restarted on failure. */
export function systemdUnit(s: ServiceSpec): string {
  return `[Unit]
Description=briefling standalone server
After=network.target

[Service]
ExecStart=${s.program.map(a => sdQuote(a, true)).join(' ')}
WorkingDirectory=${noNewline(s.cwd).replace(/%/g, '%%')}
${Object.entries(s.env).map(([k, v]) => `Environment=${sdQuote(`${k}=${v}`, false)}`).join('\n')}
Restart=on-failure
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=default.target
`;
}

export interface InstallCtx {
  platform: NodeJS.Platform; home: string; uid: number; dataDir: string; cwd: string; env: NodeJS.ProcessEnv
  /** The running program: `node` + the bundle (its folder holds the PWA), or the single binary (`bundle` absent). */
  execPath: string; bundle?: string
  run: (cmd: string, args: string[]) => void; log: (s: string) => void
}

/** Path of the unit file of this platform, or null (unsupported). */
export function unitPath(platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv): string | null {
  if (platform === 'darwin') return join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
  if (platform === 'linux') return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'systemd', 'user', UNIT);
  return null;
}

/** The settings the service starts with: the installing shell's PATH and BRIEFLING_* (but the data folder, fixed here). */
export function serviceEnv(c: Pick<InstallCtx, 'env' | 'dataDir' | 'cwd'>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(c.env)) if (k.startsWith('BRIEFLING_') && v !== undefined && k !== 'BRIEFLING_DATA' && k !== 'BRIEFLING_SERVICE') out[k] = v;
  return { PATH: c.env.PATH ?? '/usr/bin:/bin', ...out, BRIEFLING_DATA: c.dataDir, BRIEFLING_AGENT_CWD: c.env.BRIEFLING_AGENT_CWD ?? c.cwd, BRIEFLING_SERVICE: '1' };
}

export function install(c: InstallCtx): { unit: string; app: string } {
  const unit = unitPath(c.platform, c.home, c.env);
  if (!unit) throw new Error(`briefling install supports macOS (launchd) and Linux (systemd --user), not ${c.platform}: run \`npx briefling\` at login instead`);
  // 1. A copy of what runs now, inside the data folder (the npx cache may go away).
  const app = join(c.dataDir, 'app');
  mkdirSync(c.dataDir, { recursive: true, mode: 0o700 });
  const src = c.bundle ? dirname(c.bundle) : dirname(c.execPath);
  if (src !== app) rmSync(app, { recursive: true, force: true }); // reinstalled from the installed copy: keep it
  let program: string[];
  if (c.bundle) {
    if (src !== app) cpSync(src, app, { recursive: true, filter: p => !p.startsWith(join(src, 'node_modules')) });
    program = [c.execPath, join(app, basename(c.bundle)), 'start'];
  } else {
    mkdirSync(app, { recursive: true });
    const bin = join(app, basename(c.execPath));
    if (src !== app) { cpSync(c.execPath, bin); chmodSync(bin, 0o755) }
    program = [bin, 'start'];
  }
  // 2. The unit, private to the user.
  const spec: ServiceSpec = { program, env: serviceEnv(c), cwd: c.env.BRIEFLING_AGENT_CWD ?? c.cwd, log: join(c.dataDir, 'server.log') };
  mkdirSync(dirname(unit), { recursive: true });
  writeFileSync(unit, c.platform === 'darwin' ? launchdPlist(spec) : systemdUnit(spec), { mode: 0o600 });
  chmodSync(unit, 0o600);
  // 3. Load and start it (a reinstall replaces the running one).
  if (c.platform === 'darwin') {
    try { c.run('launchctl', ['bootout', `gui/${c.uid}/${LABEL}`]) } catch { /* not loaded */ }
    c.run('launchctl', ['bootstrap', `gui/${c.uid}`, unit]);
  } else {
    c.run('systemctl', ['--user', 'daemon-reload']);
    c.run('systemctl', ['--user', 'enable', UNIT]);
    c.run('systemctl', ['--user', 'restart', UNIT]);
  }
  return { unit, app };
}

export function uninstall(c: Pick<InstallCtx, 'platform' | 'home' | 'uid' | 'env' | 'run'>): string | null {
  const unit = unitPath(c.platform, c.home, c.env);
  if (!unit) throw new Error(`no service on ${c.platform}`);
  if (!existsSync(unit)) return null;
  if (c.platform === 'darwin') { try { c.run('launchctl', ['bootout', `gui/${c.uid}/${LABEL}`]) } catch { /* not loaded */ } }
  else { try { c.run('systemctl', ['--user', 'disable', '--now', UNIT]) } catch { /* not loaded */ } }
  rmSync(unit, { force: true });
  if (c.platform === 'linux') { try { c.run('systemctl', ['--user', 'daemon-reload']) } catch { /* no user manager */ } }
  return unit;
}
