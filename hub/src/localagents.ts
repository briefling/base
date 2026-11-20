// Standalone server (hub/src/server.ts): the agents of this machine. `scan` looks for ACP agents on the PATH and for
// local model servers on their usual ports, and reads nothing else (no credentials, no config file). `LocalAgents`
// launches the ACP bridge of an agent (first start, or the admin's Launch button): `uvx --from <acp-bridge at a pinned tag> briefling-acp`, with
// the agent's ACP command after `--`. The bridge keeps its default: every permission request of the agent is refused.
// These agents run with the rights of the user who started the server; the onboarding screen says so.
import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { delimiter, join } from 'node:path';
import { BRIDGE_RELEASE } from '../../protocol/bridge-release.ts';

/** Public repo of the ACP bridge, at the release this build announces (protocol/bridge-release.ts, written by
 *  scripts/publish-acp-bridge.ts --push): launched by uvx at a fixed tag, such a bridge does not update itself (`pinned`). */
export const BRIDGE_TAG = `v${BRIDGE_RELEASE.version}`;
export const BRIDGE_FROM = `git+https://github.com/briefling/acp-bridge@${BRIDGE_TAG}`;
/** ACP adapters of the CLIs without a native ACP mode (Zed's, moved to the agentclientprotocol org), pinned. */
export const CLAUDE_ACP = '@agentclientprotocol/claude-agent-acp@0.107.3';
export const CODEX_ACP = '@agentclientprotocol/codex-acp@2.7.0';
/** pi has no ACP mode: the adapter of the ACP registry (cdn.agentclientprotocol.com/registry/v1, Nov 19 2026). */
export const PI_ACP = 'pi-acp@0.0.34';

/** `mcpHttp`: the agent ignores the stdio MCP servers of session/new (Copilot CLI, github/copilot-cli#3889) and takes
 *  HTTP ones: its bridge runs with `--mcp-port <a free port>` and declares briefling's tools as an http server. */
export interface Candidate { id: string; label: string; bins: string[]; acp: (bin: string) => string[]; needs?: string; mcpHttp?: true }
/** id = the agent's name in the hub (AGENT_RE). First binary of `bins` found on the PATH wins. */
export const CANDIDATES: readonly Candidate[] = [
  { id: 'claude', label: 'Claude Code', bins: ['claude'], needs: 'npx', acp: () => ['npx', '-y', CLAUDE_ACP] },
  { id: 'codex', label: 'Codex', bins: ['codex'], needs: 'npx', acp: () => ['npx', '-y', CODEX_ACP] },
  { id: 'copilot', label: 'GitHub Copilot CLI', bins: ['copilot'], acp: bin => [bin, '--acp', '--stdio'], mcpHttp: true }, // ACP built in (public preview, Jan 2026); 1.0.114 advertises mcpCapabilities.http
  { id: 'cursor', label: 'Cursor', bins: ['cursor-agent', 'agent'], acp: bin => [bin, 'acp'] },
  { id: 'gemini', label: 'Gemini CLI', bins: ['gemini'], acp: bin => [bin, '--acp'] }, // superseded by agy, still runs with an API key
  { id: 'antigravity', label: 'Antigravity CLI', bins: ['agy'], acp: bin => [bin, 'acp'] },
  { id: 'kiro', label: 'Kiro CLI', bins: ['kiro-cli'], acp: bin => [bin, 'acp'] },
  { id: 'hermes', label: 'Hermes', bins: ['hermes'], acp: bin => [bin, 'acp'] },
  // Agents that run on a local model; ACP commands as in the ACP registry (Nov 19 2026), maki's from its author.
  { id: 'maki', label: 'maki', bins: ['maki'], acp: bin => [bin, 'acp'] },
  { id: 'pi', label: 'pi', bins: ['pi'], needs: 'npx', acp: () => ['npx', '-y', PI_ACP] },
  { id: 'opencode', label: 'opencode', bins: ['opencode'], acp: bin => [bin, 'acp'] },
  { id: 'goose', label: 'goose', bins: ['goose'], acp: bin => [bin, 'acp'] },
  { id: 'qwen', label: 'Qwen Code', bins: ['qwen'], acp: bin => [bin, '--acp'] },
  { id: 'vibe', label: 'Mistral Vibe', bins: ['vibe-acp'], acp: bin => [bin] }, // mistral-vibe installs vibe and vibe-acp
];
/** Model servers with an OpenAI-compatible API: not agents, shown so an agent can be pointed at them. */
export const MODEL_PORTS = { vllm: 8000, ollama: 11434, llamacpp: 8080 } as const;
/** Ports to probe; a kind left out is not probed (tests). */
export type ModelPorts = Partial<Record<keyof typeof MODEL_PORTS, number>>;

export interface FoundAgent { id: string; label: string; bin: string; command: string[]; missing?: string }
export interface ModelServer { kind: keyof typeof MODEL_PORTS; url: string; models: string[] }
export interface Scan { agents: FoundAgent[]; models: ModelServer[]; uv: boolean }

/** Executable `name` on `path` (PATH syntax), or null. Windows: PATHEXT. Nothing is executed. */
export function onPath(name: string, path: string, win = process.platform === 'win32', pathext = process.env.PATHEXT ?? '.EXE;.CMD;.BAT'): string | null {
  const exts = win ? ['', ...pathext.split(';').filter(Boolean)] : [''];
  for (const dir of path.split(win ? ';' : delimiter)) {
    if (!dir) continue;
    for (const e of exts) {
      const p = join(dir, name + e);
      // Mode bits rather than access(X_OK): no syscall that depends on who asks; a launch of a file the user cannot
      // run fails with a clear line in the agent's log.
      try { const s = statSync(p); if (s.isFile() && (win || (s.mode & 0o111))) return p } catch { /* not there */ }
    }
  }
  return null;
}

async function getJson(url: string, ms: number): Promise<any> {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms), redirect: 'error' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
/** vLLM and llama.cpp (`llama-server`) `/v1/models`, Ollama `/api/tags`, on 127.0.0.1: only the model names are kept.
 *  8080 is a common port for anything: llama.cpp counts only with an OpenAI model list (`data` array). */
export async function probeModels(ports: ModelPorts = MODEL_PORTS, ms = 600): Promise<ModelServer[]> {
  const names = (xs: unknown, key: string) => Array.isArray(xs) ? xs.map(x => (x as any)?.[key]).filter((s): s is string => typeof s === 'string').slice(0, 20).map(s => s.slice(0, 120)) : [];
  const one = async (kind: ModelServer['kind'], url: string, read: (j: any) => string[]) => {
    try { return { kind, url: url.replace(/\/(v1\/models|api\/tags)$/, ''), models: read(await getJson(url, ms)) } } catch { return null }
  };
  const all = await Promise.all([
    ports.vllm && one('vllm', `http://127.0.0.1:${ports.vllm}/v1/models`, j => names(j?.data, 'id')),
    ports.ollama && one('ollama', `http://127.0.0.1:${ports.ollama}/api/tags`, j => names(j?.models, 'name')),
    ports.llamacpp && one('llamacpp', `http://127.0.0.1:${ports.llamacpp}/v1/models`, j => { if (!Array.isArray(j?.data)) throw new Error('not a model list'); return names(j.data, 'id') }),
  ]);
  return all.filter((x): x is ModelServer => !!x);
}

export async function scan(o: { path?: string; ports?: ModelPorts } = {}): Promise<Scan> {
  const path = o.path ?? process.env.PATH ?? '';
  const agents: FoundAgent[] = [];
  for (const c of CANDIDATES) {
    const bin = c.bins.map(b => onPath(b, path) ? b : null).find(Boolean);
    if (!bin) continue;
    const missing = c.needs && !onPath(c.needs, path) ? c.needs : undefined;
    agents.push({ id: c.id, label: c.label, bin, command: c.acp(bin), ...(missing ? { missing } : {}) });
  }
  return { agents, models: await probeModels(o.ports), uv: !!onPath('uvx', path) };
}

/** The bridge's command line. `link` only to join (`--force`: a new link replaces the credentials of an agent removed
 * from the hub), then the credentials file is enough. `mcpPort`: briefling's tools over HTTP on 127.0.0.1 (`mcpHttp`). */
export function bridgeArgs(from: string, envFile: string, cwd: string, link: string | null, agent: readonly string[], mcpPort?: number): string[] {
  return ['--from', from, 'briefling-acp', '--env', envFile, '--cwd', cwd, ...(mcpPort ? ['--mcp-port', String(mcpPort)] : []),
    ...(link ? ['--force', link] : []), '--', ...agent];
}

/** A port free on 127.0.0.1 right now (the OS picks it); the bridge binds it a moment later, a rare clash makes it exit
 *  with « cannot serve briefling's MCP tools » in its log, and Relaunch picks another one. */
export function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer().unref();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address() as AddressInfo; s.close(() => res(port)) });
  });
}

/** The child's environment: the user's, minus the variables the bridge would take over its credentials file, and
 *  minus the npm_* that `npx briefling` set for this server: an agent started with npx (claude-agent-acp) would read
 *  npm_config_package=<briefling's tarball> as its own --package and run its package spec as a command (Joachim's
 *  Windows machine, Nov 19 2026: « 'agentclientprotocol' n'est pas reconnu »). Windows names are case-insensitive. */
export function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('BRIEFLING_') && !/^npm_/i.test(k)));
}

/** The bridge reads these over its credentials file: the hub is always this server, at its current address. */
export const hubEnv = (origin: string) => ({ BRIEFLING_WS_URL: `${origin.replace(/^http/, 'ws')}/ws`, BRIEFLING_TOKEN_URL: `${origin}/oauth2/token` });

export type AgentState = 'running' | 'exited';
/** `manual`: stopped from the app (its `<id>.stopped` marker), not by itself: no log line to show, not resumed. */
export interface LocalAgent { id: string; state: AgentState; code?: number | null; last?: string; manual?: true }

/** Launched bridges, one per agent: credentials and log in `<dir>/<id>.env|.log`, its command in `<id>.json`, and
 *  `<id>.stopped` while the admin wants it stopped (the next server start leaves it stopped). */
export class LocalAgents {
  private procs = new Map<string, { p: ChildProcess; state: AgentState; code?: number | null }>();
  private starting = new Set<string>(); // an mcpHttp agent waiting for its port: no second bridge
  readonly dir: string; readonly cwd: string; readonly origin: string; readonly from: string; private log: (s: string) => void;
  /** `origin`: the server's http origin; its address wins over the one saved at join (another port after a restart). */
  constructor(dir: string, cwd: string, origin: string, from = BRIDGE_FROM, log: (s: string) => void = () => {}) {
    this.dir = dir; this.cwd = cwd; this.origin = origin; this.from = from; this.log = log;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  envFile(id: string) { return join(this.dir, `${id}.env`) }
  joined(id: string) { return existsSync(this.envFile(id)) }
  private marker(id: string) { return join(this.dir, `${id}.stopped`) }
  stoppedByHand(id: string) { return existsSync(this.marker(id)) }
  /** Starts the bridge (join first when `link`); the command is kept for the next server start, the stop marker goes.
   *  An `mcpHttp` agent first gets a free port (async); the others start before this returns. */
  async start(id: string, agent: readonly string[], link: string | null): Promise<void> {
    if (this.procs.get(id)?.state === 'running' || this.starting.has(id)) return;
    let mcpPort: number | undefined;
    if (CANDIDATES.find(c => c.id === id)?.mcpHttp) {
      this.starting.add(id);
      try { mcpPort = await freePort() } finally { this.starting.delete(id) }
      if (this.procs.get(id)?.state === 'running') return;
    }
    rmSync(this.marker(id), { force: true });
    writeFileSync(join(this.dir, `${id}.json`), JSON.stringify({ command: agent }), { mode: 0o600 });
    const logPath = join(this.dir, `${id}.log`);
    const fd = openSync(logPath, 'a', 0o600);
    chmodSync(logPath, 0o600);
    const p = spawn('uvx', bridgeArgs(this.from, this.envFile(id), this.cwd, link, agent, mcpPort),
      { cwd: this.cwd, env: { ...childEnv(process.env), ...hubEnv(this.origin) }, stdio: ['ignore', fd, fd], shell: false });
    closeSync(fd);
    const rec: { p: ChildProcess; state: AgentState; code?: number | null } = { p, state: 'running' };
    this.procs.set(id, rec);
    p.on('error', e => { rec.state = 'exited'; rec.code = null; this.log(`agent ${id}: ${e.message}`) });
    p.on('exit', code => { rec.state = 'exited'; rec.code = code; this.log(`agent ${id}: bridge exited (${code})`) });
    this.log(`agent ${id}: bridge started (${agent.join(' ')})`);
  }
  /** The admin's Stop: the marker first (a restart leaves it stopped), then the bridge; resolves once it exited (5 s at most). */
  async stop(id: string): Promise<void> {
    writeFileSync(this.marker(id), '', { mode: 0o600 });
    const r = this.procs.get(id);
    if (r?.state !== 'running') return;
    const gone = new Promise<void>(res => { r.p.once('exit', () => res()); r.p.once('error', () => res()) });
    this.kill(r.p);
    await Promise.race([gone, new Promise<void>(res => setTimeout(res, 5000).unref())]);
  }
  /** Windows: the whole tree (uvx → the bridge → the agent), a kill only ends uvx. */
  private kill(p: ChildProcess) {
    if (process.platform === 'win32' && p.pid) spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' }).on('error', () => p.kill());
    else p.kill('SIGTERM');
  }
  /** Server start: the agents that joined before come back, with their saved command; not the ones stopped by hand. */
  resume(served: (id: string) => boolean) {
    for (const c of CANDIDATES) {
      const saved = join(this.dir, `${c.id}.json`);
      if (!this.joined(c.id) || !existsSync(saved) || !served(c.id) || this.stoppedByHand(c.id)) continue;
      try { void this.start(c.id, JSON.parse(readFileSync(saved, 'utf8')).command, null).catch(e => this.log(`agent ${c.id}: ${e.message}`)) } catch { /* unreadable: launched again from the app */ }
    }
  }
  state(id: string): LocalAgent | null {
    const r = this.procs.get(id), manual = this.stoppedByHand(id);
    if (!r) return manual ? { id, state: 'exited', code: null, manual } : null;
    if (r.state === 'exited' && manual) return { id, state: 'exited', code: null, manual };
    return { id, state: r.state, ...(r.state === 'exited' ? { code: r.code ?? null, last: this.lastLine(id) } : {}) };
  }
  /** Last line of the bridge's log: why it stopped (agent not logged in, command missing...). */
  lastLine(id: string): string {
    try { return readFileSync(join(this.dir, `${id}.log`), 'utf8').trimEnd().split('\n').pop()!.slice(-300) } catch { return '' }
  }
  /** The server stops: its bridges with it, no marker (they come back at the next start). */
  stopAll() { for (const r of this.procs.values()) if (r.state === 'running') r.p.kill('SIGTERM') }
}
