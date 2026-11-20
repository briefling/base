// Agents of this machine (hub/src/localagents.ts): the scan on a fake PATH and fake model ports, the bridge's command
// line and the child's environment. The launch itself is proven by test/e2e-standalone.ts (a fake ACP agent through uvx).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AGENT_RE } from '../../protocol/frames.ts';
import { existsSync, readFileSync } from 'node:fs';
import { BRIDGE_FROM, CANDIDATES, CLAUDE_ACP, PI_ACP, LocalAgents, bridgeArgs, childEnv, freePort, hubEnv, onPath, probeModels, scan } from '../src/localagents.ts';
import { startServer } from '../src/server.ts';

const dir = mkdtempSync(join(tmpdir(), 'scan-'));
const bin = (d: string, name: string, mode = 0o755) => { mkdirSync(d, { recursive: true }); writeFileSync(join(d, name), '#!/bin/sh\n'); chmodSync(join(d, name), mode) };
const serve = (routes: Record<string, unknown>) => new Promise<Server & { port: number }>(res => {
  const s = createServer((req, r) => { const b = routes[req.url!]; if (b === undefined) return void r.writeHead(404).end(); r.writeHead(200, { 'Content-Type': 'application/json' }).end(typeof b === 'string' ? b : JSON.stringify(b)) });
  s.listen(0, '127.0.0.1', () => res(Object.assign(s, { port: (s.address() as { port: number }).port })));
});
const closed = { vllm: 1, ollama: 1, llamacpp: 1 }; // port 1: nothing listens there

test('scan: agents of the PATH, first directory wins, non-executable files and directories ignored', { skip: process.platform === 'win32' }, async () => {
  const a = join(dir, 'a'), b = join(dir, 'b');
  bin(a, 'kiro-cli'); bin(a, 'gemini', 0o644); mkdirSync(join(a, 'codex'));
  bin(b, 'claude'); bin(b, 'agent'); bin(b, 'gemini'); bin(b, 'npx'); bin(b, 'uvx'); bin(b, 'copilot');
  const s = await scan({ path: [a, '', b].join(':'), ports: closed });
  assert.deepEqual(s.agents.map(x => [x.id, x.command.join(' '), x.missing ?? '']), [
    ['claude', `npx -y ${CLAUDE_ACP}`, ''],
    ['copilot', 'copilot --acp --stdio', ''],
    ['cursor', 'agent acp', ''],
    ['gemini', 'gemini --acp', ''], // the 0644 one in a/ is skipped, b/'s is used
    ['kiro', 'kiro-cli acp', ''],
  ]);
  assert.equal(s.uv, true);
  assert.deepEqual(s.models, []);
  assert.equal(onPath('gemini', a), null);
});

test('scan: Antigravity CLI (agy) found next to Gemini CLI; absent from the PATH, not listed', { skip: process.platform === 'win32' }, async () => {
  const g = join(dir, 'g'), h = join(dir, 'h');
  bin(g, 'agy'); bin(g, 'gemini'); bin(h, 'gemini');
  const both = await scan({ path: g, ports: closed });
  assert.deepEqual(both.agents.map(x => [x.id, x.label, x.command.join(' ')]), [
    ['gemini', 'Gemini CLI', 'gemini --acp'],
    ['antigravity', 'Antigravity CLI', 'agy acp'],
  ]);
  assert.deepEqual((await scan({ path: h, ports: closed })).agents.map(x => x.id), ['gemini']);
});

test('scan: cursor-agent preferred over agent; an adapter-based CLI without npx is flagged; no uvx', { skip: process.platform === 'win32' }, async () => {
  const c = join(dir, 'c');
  bin(c, 'agent'); bin(c, 'cursor-agent'); bin(c, 'codex');
  const s = await scan({ path: c, ports: closed });
  assert.deepEqual(s.agents.map(x => [x.id, x.bin, x.missing ?? '']), [['codex', 'codex', 'npx'], ['cursor', 'cursor-agent', '']]);
  assert.equal(s.uv, false);
  assert.deepEqual((await scan({ path: '', ports: closed })).agents, []);
});

test('scan: the local-model agents (maki, pi through its pinned adapter, opencode, goose, Qwen Code, Mistral Vibe)', { skip: process.platform === 'win32' }, async () => {
  const l = join(dir, 'l'), n = join(dir, 'n');
  for (const x of ['maki', 'pi', 'opencode', 'goose', 'qwen', 'vibe', 'vibe-acp']) bin(l, x);
  const s = await scan({ path: l, ports: closed });
  assert.deepEqual(s.agents.map(x => [x.id, x.command.join(' '), x.missing ?? '']), [
    ['maki', 'maki acp', ''],
    ['pi', `npx -y ${PI_ACP}`, 'npx'], // pi-acp runs through npx: flagged when npx is missing
    ['opencode', 'opencode acp', ''],
    ['goose', 'goose acp', ''],
    ['qwen', 'qwen --acp', ''],
    ['vibe', 'vibe-acp', ''], // `vibe` alone is the interactive CLI, not an ACP agent
  ]);
  bin(n, 'npx'); bin(n, 'vibe');
  assert.deepEqual((await scan({ path: [l, n].join(':'), ports: closed })).agents.find(x => x.id === 'pi')?.missing, undefined);
  assert.deepEqual((await scan({ path: n, ports: closed })).agents, []);
});

test('onPath: Windows looks through PATHEXT', () => {
  const w = join(dir, 'w'); mkdirSync(w); writeFileSync(join(w, 'gemini.CMD'), '');
  assert.equal(onPath('gemini', w, true, '.EXE;.CMD'), join(w, 'gemini.CMD'));
  assert.equal(onPath('gemini', w, true, '.EXE'), null);
});

test('models: vLLM and llama.cpp /v1/models, Ollama /api/tags, names only; down, 404 or junk = absent', async () => {
  const v = await serve({ '/v1/models': { object: 'list', data: [{ id: 'Qwen/Qwen3-8B', owned_by: 'vllm' }, { id: 7 }] } });
  const o = await serve({ '/api/tags': { models: [{ name: 'llama3.2:3b', digest: 'x' }] } });
  // llama-server's shape: an OpenAI list plus its own `models` array
  const l = await serve({ '/v1/models': { models: [{ name: 'qwen3-27b-q4_k_m.gguf' }], object: 'list', data: [{ id: 'qwen3-27b-q4_k_m.gguf', object: 'model', owned_by: 'llamacpp' }] } });
  const junk = await serve({ '/api/tags': 'not json', '/v1/models': { status: 'ok' } });
  try {
    assert.deepEqual(await probeModels({ vllm: v.port, ollama: o.port, llamacpp: l.port }), [
      { kind: 'vllm', url: `http://127.0.0.1:${v.port}`, models: ['Qwen/Qwen3-8B'] },
      { kind: 'ollama', url: `http://127.0.0.1:${o.port}`, models: ['llama3.2:3b'] },
      { kind: 'llamacpp', url: `http://127.0.0.1:${l.port}`, models: ['qwen3-27b-q4_k_m.gguf'] },
    ]);
    assert.deepEqual(await probeModels({ vllm: o.port, ollama: junk.port, llamacpp: junk.port }), [],
      'vLLM path 404 on the Ollama server, junk JSON, a JSON on :8080 that is not a model list');
    assert.deepEqual(await probeModels(closed), []);
  } finally { v.close(); o.close(); l.close(); junk.close() }
});

test('candidates: hub agent names, fixed commands, ACP adapters pinned to an exact version', () => {
  for (const c of CANDIDATES) assert.match(c.id, AGENT_RE);
  for (const c of CANDIDATES) for (const a of c.acp(c.bins[0])) if (a.startsWith('@')) assert.match(a, /@\d+\.\d+\.\d+$/, a);
  assert.match(BRIDGE_FROM, /^git\+https:\/\/github\.com\/briefling\/acp-bridge@v\d+\.\d+\.\d+$/);
});

test('bridge command: the link (with --force) only to join, the agent command after --', () => {
  assert.deepEqual(bridgeArgs('F', '/d/kiro.env', '/w', 'http://127.0.0.1:1/agent.md?code=X', ['kiro-cli', 'acp']),
    ['--from', 'F', 'briefling-acp', '--env', '/d/kiro.env', '--cwd', '/w', '--force', 'http://127.0.0.1:1/agent.md?code=X', '--', 'kiro-cli', 'acp']);
  assert.deepEqual(bridgeArgs('F', '/d/kiro.env', '/w', null, ['kiro-cli', 'acp']), ['--from', 'F', 'briefling-acp', '--env', '/d/kiro.env', '--cwd', '/w', '--', 'kiro-cli', 'acp']);
  assert.deepEqual(bridgeArgs('F', '/d/copilot.env', '/w', 'L', ['copilot', '--acp', '--stdio'], 4321),
    ['--from', 'F', 'briefling-acp', '--env', '/d/copilot.env', '--cwd', '/w', '--mcp-port', '4321', '--force', 'L', '--', 'copilot', '--acp', '--stdio']);
});

test('MCP over HTTP: Copilot only (it ignores stdio MCP servers over ACP), its bridge gets --mcp-port <a free port>', { skip: process.platform === 'win32' }, async () => {
  assert.deepEqual(CANDIDATES.filter(c => c.mcpHttp).map(c => c.id), ['copilot'], 'the other agents keep the stdio server');
  const p = await freePort();
  assert.ok(p > 0 && p < 65536);
  const d = join(dir, `uv-args-${Math.random().toString(36).slice(2)}`); mkdirSync(d);
  // a fake uvx that writes its arguments next to the credentials file it is given
  writeFileSync(join(d, 'uvx'), '#!/bin/sh\nprev=; for a in "$@"; do [ "$prev" = --env ] && e="$a"; prev="$a"; done\nprintf \'%s\\n\' "$@" > "$e.args"; : > "$e"\nexec sleep 60\n');
  chmodSync(join(d, 'uvx'), 0o755);
  const data = join(dir, 'mcphttp');
  await withPath(d, async () => {
    const m = new LocalAgents(data, dir, 'http://127.0.0.1:1', 'F');
    await m.start('copilot', ['copilot', '--acp', '--stdio'], null);
    await m.start('kiro', ['kiro-cli', 'acp'], null);
    await until(() => existsSync(join(data, 'copilot.env.args')) && existsSync(join(data, 'kiro.env.args')));
    const args = (id: string) => readFileSync(join(data, `${id}.env.args`), 'utf8').trim().split('\n');
    const c = args('copilot'), i = c.indexOf('--mcp-port');
    assert.ok(i > 0 && /^\d+$/.test(c[i + 1]) && c.indexOf('--') > i, c.join(' '));
    assert.ok(!args('kiro').includes('--mcp-port'), 'stdio for the others');
    await m.stop('copilot'); await m.stop('kiro');
  });
});

test('child env: the user\'s, without BRIEFLING_* (the bridge would take them over its credentials file); the hub = this server', () => {
  assert.deepEqual(childEnv({ PATH: '/bin', HOME: '/h', BRIEFLING_CLIENT_SECRET: 's', BRIEFLING_WS_URL: 'ws://x' }), { PATH: '/bin', HOME: '/h' });
  // npx briefling's own npm_* never reach the agent's npx (npm_config_package would replace its --package).
  assert.deepEqual(childEnv({ PATH: '/bin', npm_config_package: 'C:\\briefling.tgz', NPM_CONFIG_YES: 'true', npm_execpath: 'x', npm_command: 'exec', NPMRC: 'kept' }),
    { PATH: '/bin', NPMRC: 'kept' });
  assert.deepEqual(hubEnv('http://127.0.0.1:8787'), { BRIEFLING_WS_URL: 'ws://127.0.0.1:8787/ws', BRIEFLING_TOKEN_URL: 'http://127.0.0.1:8787/oauth2/token' });
});

// A fake `uvx` on the PATH: writes the credentials file it is given (as a joined bridge would), then waits to be stopped.
const fakeUv = () => {
  const d = join(dir, `uv-${Math.random().toString(36).slice(2)}`); mkdirSync(d);
  writeFileSync(join(d, 'uvx'), '#!/bin/sh\nwhile [ $# -gt 0 ]; do [ "$1" = --env ] && : > "$2"; shift; done\nexec sleep 60\n'); chmodSync(join(d, 'uvx'), 0o755);
  bin(d, 'kiro-cli'); bin(d, 'gemini');
  return d;
};
const withPath = async (p: string, f: () => Promise<void>) => { const p0 = process.env.PATH; process.env.PATH = `${p}:${p0}`; try { await f() } finally { process.env.PATH = p0 } };
const until = async (ok: () => boolean) => { for (let i = 0; i < 100 && !ok(); i++) await new Promise(r => setTimeout(r, 50)); assert.ok(ok()) };

test('stop: one agent, its marker kept across restarts; resume skips it; a launch clears it', { skip: process.platform === 'win32' }, async () => {
  const uv = fakeUv(), data = join(dir, 'm1');
  await withPath(uv, async () => {
    const m = new LocalAgents(data, dir, 'http://127.0.0.1:1', 'F');
    m.start('kiro', ['kiro-cli', 'acp'], null); m.start('gemini', ['gemini', '--acp'], null);
    await until(() => m.joined('kiro') && m.joined('gemini'));
    await m.stop('kiro');
    assert.deepEqual(m.state('kiro'), { id: 'kiro', state: 'exited', code: null, manual: true }, 'stopped by hand: no exit code nor log line shown');
    assert.equal(m.state('gemini')?.state, 'running', 'the others keep running');
    m.stopAll();
    assert.ok(existsSync(join(data, 'kiro.stopped')) && !existsSync(join(data, 'gemini.stopped')), 'the server stopping leaves no marker');
    // next server start
    const again = new LocalAgents(data, dir, 'http://127.0.0.1:1', 'F');
    again.resume(() => true);
    assert.deepEqual(again.state('kiro'), { id: 'kiro', state: 'exited', code: null, manual: true }, 'not resumed');
    assert.equal(again.state('gemini')?.state, 'running', 'resumed');
    again.start('kiro', ['kiro-cli', 'acp'], null);
    assert.equal(again.state('kiro')?.state, 'running');
    assert.ok(!existsSync(join(data, 'kiro.stopped')), 'Relaunch clears the marker');
    await again.stop('kiro'); await again.stop('gemini');
    await again.stop('gemini'); // twice: nothing to kill
    assert.equal(again.state('gemini')?.manual, true);
  });
});

test('server: the first start launches every runnable agent into Home, POST /local/agents/stop stops one for good', { skip: process.platform === 'win32' }, async () => {
  const uv = fakeUv(), data = join(dir, 'srv');
  bin(join(uv, 'only'), 'codex'); // codex needs npx: not launched
  await withPath(uv, async () => {
    const machine = { path: `${uv}:${join(uv, 'only')}`, ports: {}, cwd: dir, from: 'F', autoLaunch: true };
    let s = await startServer({ dataDir: data, port: 0, tick: false, log: () => {}, machine });
    const api = (path: string, body?: object, headers: Record<string, string> = {}) => fetch(`${s.url}${path}`, { method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${s.adminToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    try {
      assert.deepEqual(s.autoLaunched, ['Gemini CLI', 'Kiro CLI']);
      assert.equal(s.joinLink, null, 'the placeholder\'s link is revoked: the first launched agent took its place');
      let g = await (await api('/local/agents')).json();
      assert.deepEqual(Object.entries(g.launched).map(([id, l]: [string, any]) => [id, l.state ?? '']), [['codex', ''], ['gemini', 'running'], ['kiro', 'running']]);
      // the stop route: admin, same origin, JSON, a known agent name only
      assert.equal((await fetch(`${s.url}/local/agents/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"agent":"kiro"}' })).status, 401);
      assert.equal((await api('/local/agents/stop', { agent: 'kiro' }, { Origin: 'https://evil.example' })).status, 403);
      assert.equal((await api('/local/agents/stop', { agent: 'kiro' }, { 'Content-Type': 'text/plain' })).status, 415);
      assert.equal((await api('/local/agents/stop')).status, 405);
      for (const agent of ['../x', 'nobody', 7]) assert.equal((await api('/local/agents/stop', { agent })).status, 400, String(agent));
      const r = await (await api('/local/agents/stop', { agent: 'kiro' })).json();
      assert.deepEqual([r.results, r.launched.kiro.state, r.launched.kiro.manual, r.launched.gemini.state], [{ kiro: 'stopped' }, 'exited', true, 'running']);
      assert.deepEqual((await (await api('/local/agents', { space: 'home', agents: ['gemini'] })).json()).results, { gemini: 'running' }, 'running: no second invitation');
      await s.close();
      s = await startServer({ dataDir: data, port: 0, tick: false, log: () => {}, machine });
      assert.deepEqual(s.autoLaunched, [], 'not the first start: nothing launched');
      g = await (await api('/local/agents')).json();
      assert.deepEqual([g.launched.kiro.state, g.launched.kiro.manual], ['exited', true], 'stopped by hand: still stopped after the restart');
      const re = await (await api('/local/agents', { space: 'home', agents: ['kiro'] })).json();
      assert.equal(re.launched.kiro.state, 'running', 'Relaunch');
      assert.equal(re.launched.kiro.manual, undefined);
    } finally { await s.close() }
  });
});

test('server: no auto-launch unless asked (tests never start the CLIs of their machine)', { skip: process.platform === 'win32' }, async () => {
  const uv = fakeUv();
  await withPath(uv, async () => {
    const s = await startServer({ dataDir: join(dir, 'off'), port: 0, tick: false, log: () => {}, machine: { path: uv, ports: {}, cwd: dir, from: 'F' } });
    try { assert.deepEqual(s.autoLaunched, []); assert.ok(s.joinLink) } finally { await s.close() }
  });
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
