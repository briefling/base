// Standalone server: one Node process serving the PWA and the hub's WebSocket on a SQLite file, without AWS
// (`npm run standalone`). Same router as the Lambda (hub/src/handlers/ws.ts), reached through the same `Store`
// (hub/src/sqlite.ts) and `Sender` interfaces: nothing of the Lambda path changes. What API Gateway, the authorizer, S3,
// EventBridge Scheduler and the DynamoDB TTL sweep do there is done here by: the `ws` server and an in-process
// connection map, hub/src/localauth.ts (Jupyter-style admin token, agent keys), hub/src/localfiles.ts (attachments on
// disk), hub/src/localsched.ts (routines, Radar, reminders) and a purge timer. Off here: Bedrock (summaries, memory
// auto mode), preview and visitor links, elevation, Web Push, GitHub (no App), invitations by email.
// Humans: the admin token on loopback (localauth.ts), or, with an OIDC issuer configured (hub/src/oidc.ts, Dex of the
// compose `dex` profile), the ID token of an invited person; the admin token is then refused. Listens on loopback only
// without OIDC (localauth.ts bindAllowed), except in the image (Dockerfile, docker-compose.yml), where the published
// port decides; with OIDC, on any address behind an https BRIEFLING_URL (a TLS proxy in front). TURN (preview) only with a coturn secret.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { PROTOCOL, AGENT_CODE_RE, type HubFrame, type Principal } from '../../protocol/frames.ts';
import { PLUGIN_RELEASE } from '../../protocol/plugin-release.ts';
import { agentPage } from '../../infra/agent-page.ts';
import { handle, presenceLeft, type Deps, type Sender, type Space } from './router.ts';
import { agentInvite } from './agents.ts';
import { openSqliteStore } from './sqlite.ts';
import { openLocalAuth, bindAllowed, publicUrlAllowed, ADMIN_USER } from './localauth.ts';
import { openOidc, oidcFromEnv, type OidcConfig } from './oidc.ts';
import { diskFiles, diskSite } from './localfiles.ts';
import { openSchedules } from './localsched.ts';
import { fireSchedule } from './fire.ts';
import { bodyKind } from './throttle.ts';
import { LocalAgents, scan, BRIDGE_FROM, BRIDGE_TAG, CANDIDATES, type ModelPorts, type Scan } from './localagents.ts';
import { createHash, createHmac } from 'node:crypto';
import { makeUpdater, type InstallMode, type Updater } from './update.ts';
import { turnsOf, workingIn, type StoredThread } from './router.ts';
import type { IceServer } from '../../protocol/preview.ts';

const MAX_FRAME = 128 * 1024; // API Gateway's WebSocket frame cap: an agent tested here behaves the same in production
const CONN_MAX_MS = 2 * 3600_000; // API Gateway cuts at 2 h; subscriptions expire at 3 h (CONN_TTL_S): clients re-subscribe
const TICK_MS = 15_000, PURGE_MS = 10 * 60_000;
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.md': 'text/markdown; charset=utf-8' };
const LISTEN_ANY = new Set(['0.0.0.0', '::']); // a container's every address: never a Host header
const NO_CACHE = new Set(['/index.html', '/sw.js', '/version.json', '/config.json']);

/** Same id shape as hub/src/aws.ts newId (time-ordered, then random). */
export const newId = () => Date.now().toString(36) + randomUUID().replaceAll('-', '').slice(0, 12);

/** `agent`: the agent of the first space, created at the first start (default `agent`). `machine`: the agents of this
 * machine (hub/src/localagents.ts): working directory of their sessions (default the server's), bridge source (default
 * the pinned public tag), PATH and model ports scanned (tests), `autoLaunch`: the first start launches every agent it can
 * into Home (on with `briefling`/`npm run standalone`, off by default so a test never starts the CLIs of its machine). */
/** `publicUrl`: the origin browsers and agents are given when it is not the listening address (container, TLS proxy).
 * `container`: running in the image (may listen on the container's address). `inviteDir`: the first space's agent
 * invitation is also written there (`join-link`, 0600), on the volume only the server and the `hermes` service share.
 * `turn`: coturn for previews (TURN REST credentials from its static-auth-secret, 5 minutes). */
/** `oidc`: humans sign in at this issuer (hub/src/oidc.ts); off = the admin token. */
export interface ServerOpts { dataDir: string; host?: string; port?: number; clientDir?: string; oidc?: OidcConfig; log?: (s: string) => void; tick?: boolean; agent?: string
  machine?: { cwd?: string; from?: string; path?: string; ports?: ModelPorts; autoLaunch?: boolean }
  publicUrl?: string; container?: boolean; inviteDir?: string; turn?: { urls: string[]; secret: string }
  update?: ServerUpdate }
/** Updates from npm (hub/src/update.ts): the running version, how it was installed, the check on or off. `registry`: a
 *  test registry. `exit`: what ends the process once a new version is in place (default process.exit; the code is 75). */
export interface ServerUpdate { current: string; mode: InstallMode; enabled: boolean; registry?: string; fetch?: typeof fetch; exit?: (code: number) => void }

const TURN_TTL_S = 300; // like the KVS credentials of the AWS stack
/** coturn's TURN REST credentials (`use-auth-secret`): username `<expiry>:<peer>`, password base64(HMAC-SHA1(secret, username)). */
export function turnCredentials(turn: { urls: string[]; secret: string }, peer: string, nowMs: number): IceServer[] {
  const username = `${Math.floor(nowMs / 1000) + TURN_TTL_S}:${peer}`;
  return [{ urls: turn.urls, username, credential: createHmac('sha1', turn.secret).update(username).digest('base64') }];
}
/** joinLink: invitation of the first space's agent while no instance serves it (a new code at each start), else null.
 *  adminToken: '' with OIDC (refused there). */
/** autoLaunched: the agents of this machine launched into Home by the first start (labels). */
export interface Running { url: string; port: number; adminToken: string; joinLink: string | null; autoLaunched: string[]; close(): Promise<void>; tick(now?: number): Promise<number>; scan(): Promise<Scan>; updater: Updater | null }
/** An agent turn that started longer ago is a leftover (its agent went away mid-turn): it does not hold an update back. */
const STALE_TURN_MS = 12 * 3600_000;
/** Conversations where an agent turn runs now (a leftover one aside): an update waits until there is none. */
export const runningTurns = (threads: StoredThread[], now: number): number =>
  threads.filter(t => workingIn(t).length && Object.values(turnsOf(t)).some(x => x.active && now - (x.at ?? 0) < STALE_TURN_MS)).length;
export const HOME = 'home';

export async function startServer(o: ServerOpts): Promise<Running> {
  const host = o.host ?? '127.0.0.1', log = o.log ?? console.log;
  if (!bindAllowed(host, !!o.oidc, !!o.container)) throw new Error(`refusing to listen on ${host}: without OIDC the server only listens on loopback (127.0.0.1, ::1)`);
  const pub = o.publicUrl ? new URL(o.publicUrl) : null;
  if (pub && !publicUrlAllowed(pub)) throw new Error(`refusing BRIEFLING_URL ${o.publicUrl}: an origin, http on loopback or https (a TLS proxy in front)`);
  // Beyond loopback, browsers need the address the provider sends them back to: the https one of the proxy.
  if (o.oidc && !o.container && !bindAllowed(host, false) && !pub) throw new Error(`refusing to listen on ${host} without BRIEFLING_URL (https, the TLS proxy in front)`);
  const dist = resolve(o.clientDir ?? fileURLToPath(new URL('../../client/dist/', import.meta.url)));
  mkdirSync(o.dataDir, { recursive: true, mode: 0o700 }); // database, keys and files: the owner only
  const sql = openSqliteStore(join(o.dataDir, 'briefling.db'));
  const auth = openLocalAuth(sql.db, o.dataDir);
  if (!(await sql.store.isAdmin(ADMIN_USER))) sql.seedAdmin(ADMIN_USER);
  // With OIDC the first admin of the config who signs in takes the `admin` user (the Home space, or what an earlier
  // start without OIDC made); the next ones are new users.
  const oidc = o.oidc ? openOidc(sql.db, o.oidc, { firstAdmin: ADMIN_USER }) : null;
  const schedules = openSchedules(sql.db);
  const conns = new Map<string, WebSocket>();
  const sender: Sender = {
    async send(connId, frame: HubFrame) {
      const ws = conns.get(connId);
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      return new Promise<boolean>(res => ws.send(JSON.stringify(frame), e => res(!e)));
    },
    async close(connId) { conns.get(connId)?.close(1000) },
  };

  const server = createServer();
  await new Promise<void>((res, rej) => { server.once('error', rej); server.listen(o.port ?? 8787, host, () => { server.off('error', rej); res() }) });
  const port = (server.address() as { port: number }).port;
  const listening = `${host.includes(':') ? `[${host}]` : host}:${port}`;
  const origin = pub ? pub.origin : `http://${listening}`;
  // DNS rebinding: only these Host headers (the public address, loopback IPs and localhost on the listening port)
  const hosts = new Set([...(pub ? [pub.host] : []), ...(LISTEN_ANY.has(host) ? [] : [listening]), `127.0.0.1:${port}`, `localhost:${port}`]);
  const wsOrigin = origin.replace(/^http/, 'ws');
  const files = diskFiles(join(o.dataDir, 'files'), origin, readFileSync(join(o.dataDir, 'server-key'), 'utf8').trim());
  const site = diskSite(join(o.dataDir, 'site')); // pinned applets' manifests and icons (hub/src/pinapp.ts)
  const deps: Deps = { store: sql.store, sender, now: () => Date.now(), newId, files, site, schedules, agentClients: auth.agentClients(`${origin}/oauth2/token`),
    ...(oidc ? { users: oidc.users } : {}),
    ...(o.turn ? { previewIce: async (peer: string) => turnCredentials(o.turn!, peer, Date.now()) } : {}) };
  const csp = ["default-src 'self'", "script-src 'self'", "style-src 'self'", `img-src 'self' data: blob: ${origin}`, `media-src 'self' ${origin}`,
    `connect-src 'self' ${wsOrigin} ws://localhost:${port}${oidc ? ` ${new URL(oidc.config.issuer).origin}` : ''}`, "frame-src 'none'", "worker-src 'self'", "manifest-src 'self'",
    "frame-ancestors 'none'", "base-uri 'none'", "form-action 'none'", "object-src 'none'"].join('; ');
  const security = { 'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' };
  const m = o.machine ?? {};
  const machine = new LocalAgents(join(o.dataDir, 'agents'), resolve(m.cwd ?? process.cwd()), origin, m.from ?? BRIDGE_FROM, log);
  const scanHere = () => scan({ path: m.path, ports: m.ports });
  let updater: Updater | null = null;

  const readBody = async (req: IncomingMessage, max: number) => {
    let n = 0; const parts: Buffer[] = [];
    for await (const c of req) { n += (c as Buffer).length; if (n > max) throw new Error('too long'); parts.push(c as Buffer) }
    return Buffer.concat(parts).toString('utf8');
  };
  function staticFile(res: ServerResponse, path: string) {
    let p = resolve(dist, '.' + (path === '/' ? '/index.html' : decodeURIComponent(path)));
    if (p !== dist && !p.startsWith(dist + sep)) return void res.writeHead(404).end();
    // A path without extension is a route of the app (CloudFront answers index.html the same way).
    if (!existsSync(p) && !extname(p)) p = join(dist, 'index.html');
    if (!existsSync(p) || !statSync(p).isFile()) return void res.writeHead(404, security).end();
    const rel = '/' + p.slice(dist.length + 1).split(sep).join('/');
    res.writeHead(200, { ...security, 'Content-Type': MIME[extname(p)] ?? 'application/octet-stream', 'Cache-Control': NO_CACHE.has(rel) ? 'no-cache' : 'public, max-age=300' });
    res.end(readFileSync(p));
  }
  server.on('request', async (req, res) => {
    try {
      if (!hosts.has(String(req.headers.host))) return void res.writeHead(421).end();
      const url = new URL(req.url ?? '/', origin);
      if (await files.serve(req, res, url)) return;
      if (url.pathname === '/oauth2/token' && req.method === 'POST') {
        const r = auth.token(req.headers.authorization, new URLSearchParams(await readBody(req, 4096)), Date.now());
        return void res.writeHead(r.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(r.body));
      }
      if (url.pathname === '/local/agents') return void await localAgents(req, res);
      if (url.pathname === '/local/agents/stop') return void await localStop(req, res);
      if (url.pathname === '/local/update') return void await localUpdate(req, res);
      if (req.method !== 'GET' && req.method !== 'HEAD') return void res.writeHead(405).end();
      if (url.pathname === '/config.json') {
        return void res.writeHead(200, { ...security, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' })
          .end(JSON.stringify({ wsUrl: String(req.headers.host) === new URL(origin).host ? `${wsOrigin}/ws` : `ws://${String(req.headers.host)}/ws`,
            ...(oidc ? { oidc: { issuer: oidc.config.issuer, clientId: oidc.config.clientId } } : { local: { user: ADMIN_USER } }) }));
      }
      if (url.pathname === '/agent.md') {
        return void res.writeHead(200, { ...security, 'Content-Type': MIME['.md'], 'Cache-Control': 'no-cache' })
          .end(agentPage(origin, PLUGIN_RELEASE.version, PLUGIN_RELEASE.commit || 'unpublished'));
      }
      if (await site.serve(res, url.pathname, security)) return;
      staticFile(res, url.pathname);
    } catch (e) {
      log(`http_failed ${(e as Error)?.name}`);
      if (!res.headersSent) res.writeHead(500).end(); else res.destroy();
    }
  });

  // Agents of this machine (Settings › Agents of a standalone server): GET = scan + state, POST {space, agents} = invite
  // and launch these agents (the app sends one, its row's button). POST /local/agents/stop {agent} = stop one, and keep
  // it stopped across restarts. Admin token only (Bearer), same-origin only: it starts processes on this machine. The
  // browser only sends agent ids, the commands come from the scan (CANDIDATES), never from the request.
  const served = async (agent: string) => (await sql.store.listInstances()).some(i => i.agents.includes(agent));
  const jsonOf = (res: ServerResponse) => (status: number, body: unknown) => void res.writeHead(status, { ...security, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
  /** The admin's local API (/local/*): same origin only, a global admin's Bearer token; false = refused (answered). */
  async function localAdmin(req: IncomingMessage, json: (status: number, body: unknown) => void): Promise<boolean> {
    const from = req.headers.origin;
    if (from !== undefined && from !== origin && from !== `http://localhost:${port}`) { json(403, { error: 'forbidden' }); return false }
    // an ID token with OIDC: a JWT of a few kB
    const bearer = /^Bearer (\S{20,8192})$/.exec(String(req.headers.authorization ?? ''))?.[1];
    const user = bearer ? await humanOf(bearer).catch(() => null) : null;
    if (!user || !(await sql.store.isAdmin(user))) { json(401, { error: 'unauthorized' }); return false }
    return true;
  }
  async function localAgents(req: IncomingMessage, res: ServerResponse) {
    const json = jsonOf(res);
    if (!(await localAdmin(req, json))) return;
    const found = await scanHere();
    if (req.method === 'GET') return json(200, await machineState(found));
    if (req.method !== 'POST') return json(405, { error: 'method' });
    if (!/^application\/json\b/.test(String(req.headers['content-type'] ?? ''))) return json(415, { error: 'json_only' });
    let body: any;
    try { body = JSON.parse(await readBody(req, 4096)) } catch { return json(400, { error: 'bad_request' }) }
    const ids = Array.isArray(body?.agents) ? [...new Set(body.agents.filter((x: unknown) => typeof x === 'string'))] as string[] : [];
    if (typeof body?.space !== 'string' || !ids.length || ids.length > 6) return json(400, { error: 'bad_request' });
    if (!found.uv) return json(409, { error: 'no_uv' });
    const results: Record<string, string> = {};
    for (const id of ids) {
      const a = found.agents.find(x => x.id === id);
      if (!a) { results[id] = 'not_found'; continue }
      if (a.missing) { results[id] = `missing_${a.missing}`; continue }
      try { results[id] = await launch(body.space, a.id, a.command) } catch (e) { results[id] = (e as { code?: string }).code ?? 'failed' }
    }
    return json(200, { results, ...(await machineState(found)) });
  }
  async function machineState(found: Scan) {
    return { ...found, cwd: machine.cwd, bridge: BRIDGE_TAG,
      launched: Object.fromEntries(await Promise.all(found.agents.map(async a => [a.id, { joined: machine.joined(a.id), served: await served(a.id), ...(machine.state(a.id) ?? {}) }]))) };
  }
  async function localStop(req: IncomingMessage, res: ServerResponse) {
    const json = jsonOf(res);
    if (!(await localAdmin(req, json))) return;
    if (req.method !== 'POST') return json(405, { error: 'method' });
    if (!/^application\/json\b/.test(String(req.headers['content-type'] ?? ''))) return json(415, { error: 'json_only' });
    let body: any;
    try { body = JSON.parse(await readBody(req, 1024)) } catch { return json(400, { error: 'bad_request' }) }
    // a known agent name only: it names files of data/agents
    if (typeof body?.agent !== 'string' || !CANDIDATES.some(c => c.id === body.agent)) return json(400, { error: 'bad_request' });
    await machine.stop(body.agent);
    return json(200, { results: { [body.agent]: 'stopped' }, ...(await machineState(await scanHere())) });
  }
  // Server update (client/src/serverupdate.ts): GET = the state, POST {action: check | apply (+ version) | cancel}.
  async function localUpdate(req: IncomingMessage, res: ServerResponse) {
    const json = jsonOf(res);
    if (!(await localAdmin(req, json))) return;
    if (!updater) return void res.writeHead(204, security).end(); // no updater (tests): nothing to show, and no 404 in the browser's console
    if (req.method === 'GET') return json(200, updater.state());
    if (req.method !== 'POST') return json(405, { error: 'method' });
    if (!/^application\/json\b/.test(String(req.headers['content-type'] ?? ''))) return json(415, { error: 'json_only' });
    let body: any;
    try { body = JSON.parse(await readBody(req, 1024)) } catch { return json(400, { error: 'bad_request' }) }
    if (body?.action === 'check') { await updater.check(); return json(200, updater.state()) }
    if (body?.action === 'cancel') return json(updater.cancel() ? 200 : 409, updater.state());
    if (body?.action !== 'apply' || typeof body.version !== 'string') return json(400, { error: 'bad_request' });
    const r = await updater.apply(body.version);
    return json(r.ok ? 202 : 409, { ...updater.state(), ...(r.code ? { code: r.code } : {}) });
  }
  async function busyTurns(): Promise<number> {
    let n = 0;
    for (const s of await sql.store.listSpaces()) n += runningTurns(await sql.store.listThreads(s.id, 0) as unknown as StoredThread[], Date.now());
    return n;
  }
  /** One agent: an invitation for the space (or the space only, when this machine's bridge already serves it), then the bridge. */
  async function launch(space: string, agent: string, command: string[]): Promise<string> {
    if (machine.state(agent)?.state === 'running') return 'running'; // its bridge may still be joining: no second invitation
    const isServed = await served(agent);
    if (isServed && !machine.joined(agent)) return 'served_elsewhere'; // the same name plugged in from another machine
    let code: string | undefined, result = '';
    const sp = await sql.store.getSpace(space);
    await agentInvite(deps, { kind: 'human', id: ADMIN_USER }, { client_id: 'local', space, agent, renew: !isServed && (sp?.agents ?? []).includes(agent) },
      async f => { if (f.type === 'agent.invited') { result = f.result; code = f.code } return true });
    if (code) await adoptDefault(space, agent);
    await machine.start(agent, command, code ? `${origin}/agent.md?code=${code}` : null);
    return code ? 'joining' : result || 'started';
  }
  /** The space's agent in charge is a name nobody serves (the first start's placeholder): the launched agent takes its place. */
  async function adoptDefault(space: string, agent: string) {
    for (let i = 0; i < 3; i++) {
      const cur = await sql.store.getSpace(space);
      if (!cur || cur.defaultAgent === agent || await served(cur.defaultAgent)) return;
      const agents = [agent, ...(cur.agents ?? []).filter(a => a !== agent && a !== cur.defaultAgent)];
      if (!(await sql.store.updateSpace({ ...cur, agents, defaultAgent: agent, version: (cur.version ?? 0) + 1 }, cur.version ?? 0))) continue;
      // its pending link (printed at each start) has nothing left to join
      for (const inv of await sql.store.listAgentInvites())
        if (inv.space === space && inv.agent === cur.defaultAgent && inv.state === 'pending') await sql.store.setAgentInvite(inv.hash, 'pending', { state: 'revoked' });
      return;
    }
  }

  /** The human of a token: the admin token without OIDC, else an invited person's ID token (their first sign-in binds
   *  them; an admin of the config gets the role, and the Home space when they are a new user). Throws = issuer unreachable. */
  async function humanOf(token: string): Promise<string | null> {
    if (!oidc) return auth.human(token);
    const r = await oidc.human(token, Date.now());
    if (!r) return null;
    if (r.admin && !(await sql.store.isAdmin(r.id))) sql.seedAdmin(r.id);
    if (r.first && r.admin && r.id !== ADMIN_USER) await joinHome(r.id, r.name);
    return r.id;
  }
  async function joinHome(id: string, name: string) {
    for (let i = 0; i < 3; i++) {
      const cur = await sql.store.getSpace(HOME);
      if (!cur || cur.archived || cur.members.includes(id)) return;
      const next = { ...cur, members: [...cur.members, id], trusted: [...(cur.trusted ?? []), id], names: { ...(cur.names ?? {}), [id]: name }, version: (cur.version ?? 0) + 1 };
      if (await sql.store.updateSpace(next, cur.version ?? 0)) return;
    }
  }
  // The authorizer: who the offered token is, or null (refused before the upgrade).
  async function principal(token: string): Promise<Principal | null> {
    if (token.startsWith('join.')) {
      const code = token.slice(5);
      if (!AGENT_CODE_RE.test(code)) return null;
      const hash = createHash('sha256').update(code).digest('hex');
      return (await sql.store.getAgentInvite(hash)) ? { kind: 'join', id: hash } : null;
    }
    if (token.startsWith('bl1.')) {
      const id = auth.instance(token, Date.now());
      return id && auth.hasKey(id) && await sql.store.getInstance(id) ? { kind: 'instance', id } : null;
    }
    const human = await humanOf(token);
    return human ? { kind: 'human', id: human } : null;
  }
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME, handleProtocols: p => p.has(PROTOCOL) ? PROTOCOL : false });
  const boot = randomBytes(4).toString('hex'); // connection ids never collide with a previous run's leftover subscriptions
  let seq = 0;
  server.on('upgrade', async (req, socket, head) => {
    const refuse = (code: number) => { socket.end(`HTTP/1.1 ${code} ${code === 401 ? 'Unauthorized' : 'Forbidden'}\r\nConnection: close\r\n\r\n`) };
    try {
      if (!hosts.has(String(req.headers.host)) || new URL(req.url ?? '/', origin).pathname !== '/ws') return refuse(403);
      // A browser always sends its Origin: another site's page never reaches the hub (agents send none).
      const from = req.headers.origin;
      if (from !== undefined && from !== origin && from !== `http://localhost:${port}`) return refuse(403);
      const parts = String(req.headers['sec-websocket-protocol'] ?? '').split(',').map(s => s.trim());
      const who = parts.length === 2 && parts[0] === PROTOCOL ? await principal(parts[1]) : null;
      if (!who) return refuse(401);
      wss.handleUpgrade(req, socket, head, ws => connected(ws, who));
    } catch (e) { log(`upgrade_failed ${(e as Error)?.name}`); refuse(403) }
  });
  function connected(ws: WebSocket, who: Principal) {
    const connId = `${boot}${(++seq).toString(36)}`;
    conns.set(connId, ws);
    const cut = setTimeout(() => ws.close(1001, 'max duration'), CONN_MAX_MS);
    ws.on('message', async (data, binary) => {
      const body = binary ? '' : data.toString();
      try { await handle(deps, connId, who, body) } catch (e) {
        log(`handle_failed ${bodyKind(body)} ${(e as Error)?.name} ${(e as Error)?.message?.slice(0, 200)}`);
        await sender.send(connId, { v: 2, type: 'error', code: 'internal' });
      }
    });
    ws.on('close', async () => {
      clearTimeout(cut);
      conns.delete(connId);
      // $disconnect: the subscriptions go (last input of an away one kept for the last seen), then presence.
      const left: { space: string; idle?: number }[] = [];
      try {
        for (const s of await sql.store.connSpaces(connId)) {
          const sub = (await sql.store.listSubs(s)).find(x => x.connId === connId);
          await sql.store.deleteSub(s, connId);
          left.push({ space: s, ...(sub?.away && typeof sub.idle === 'number' ? { idle: sub.idle } : {}) });
        }
        await presenceLeft({ store: sql.store, sender }, who, left, Date.now());
      } catch (e) { log(`disconnect_failed ${(e as Error)?.name}`) }
    });
  }

  // First start: the admin's first space, with its agent (space.save only takes known members and served agents: the
  // admin and the agent would otherwise have no way in, like scripts/bootstrap-spaces.ts on AWS). While no instance
  // serves that agent, each start issues its invitation through the same path as the admin's « Invite » (agents.ts).
  const firstStart = !(await sql.store.listSpaces()).length;
  if (firstStart) {
    const agent = o.agent ?? 'agent';
    await sql.store.createSpace({ id: HOME, name: 'Home', members: [ADMIN_USER], trusted: [ADMIN_USER], agents: [agent], defaultAgent: agent,
      names: { [ADMIN_USER]: 'Admin' }, version: 1 } as Space);
  }
  let joinLink: string | null = null;
  const home = await sql.store.getSpace(HOME);
  if (home && !home.archived && !(await sql.store.listInstances()).some(i => i.agents.includes(home.defaultAgent))) {
    await agentInvite(deps, { kind: 'human', id: ADMIN_USER }, { client_id: 'boot', space: HOME, agent: home.defaultAgent, renew: true },
      async f => { if (f.type === 'agent.invited' && f.code) joinLink = `${origin}/agent.md?code=${f.code}`; return true });
  }
  // First start only: every agent of this machine that can run (nothing missing, uv there) is launched into Home, the
  // first one takes the placeholder's place (its link is revoked). Later starts only resume: an agent the admin stopped
  // stays stopped. Ports not probed: models are not launched.
  const autoLaunched: string[] = [];
  if (m.autoLaunch && firstStart && home && !home.archived) {
    const found = await scan({ path: m.path, ports: {} });
    for (const a of found.uv ? found.agents.filter(x => !x.missing) : []) {
      try { await launch(HOME, a.id, a.command); autoLaunched.push(a.label) } catch (e) { log(`agent ${a.id}: not launched (${(e as Error)?.message})`) }
    }
    if (autoLaunched.length && (await sql.store.getSpace(HOME))?.defaultAgent !== home.defaultAgent) joinLink = null; // revoked by adoptDefault
  }

  // The `hermes` service of docker-compose.yml joins with this file (read-only for it); none once the agent is served.
  if (o.inviteDir) {
    mkdirSync(o.inviteDir, { recursive: true, mode: 0o700 });
    const file = join(o.inviteDir, 'join-link');
    if (joinLink) { writeFileSync(`${file}.tmp`, joinLink + '\n', { mode: 0o600 }); renameSync(`${file}.tmp`, file) } else rmSync(file, { force: true });
  }

  // Subscriptions left by the previous run (its connections are gone; a hard stop skips their cleanup): dropped, else
  // presence shows agents online that are not, and their deliveries go nowhere until a send fails.
  for (const s of await sql.store.listSpaces()) for (const sub of await sql.store.listSubs(s.id)) await sql.store.deleteSub(s.id, sub.connId);
  const servedNow = new Set((await sql.store.listInstances()).flatMap(i => i.agents));
  machine.resume(id => servedNow.has(id)); // the agents of this machine that joined before come back
  const tick = (now = Date.now()) => schedules.tick(now, input => fireSchedule({ store: sql.store, sender, now: () => Date.now(), newId }, input as any));
  const timers = o.tick === false ? [] : [setInterval(() => void tick().catch(() => {}), TICK_MS), setInterval(() => sql.purgeExpired(), PURGE_MS)];
  const u = o.update;
  updater = u ? makeUpdater({ current: u.current, mode: u.mode, enabled: u.enabled, dataDir: o.dataDir, registry: u.registry, fetch: u.fetch, log,
    busy: busyTurns, backup: path => sql.db.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`),
    restart: async () => { await running.close(); (u.exit ?? process.exit)(75) } }) : null;
  updater?.start();
  const running: Running = {
    url: origin, port, adminToken: oidc ? '' : auth.adminToken, joinLink, autoLaunched, tick, scan: scanHere, updater,
    async close() {
      updater?.stop();
      timers.forEach(clearInterval);
      machine.stopAll();
      for (const ws of conns.values()) ws.terminate();
      await new Promise<void>(res => { wss.close(); server.close(() => res()); server.closeAllConnections() });
      sql.close();
    },
  };
  return running;
}

/** The server as `npm run standalone`, the image and the `briefling` command (hub/src/cli.ts) start it, from the
 * BRIEFLING_* environment. `dataDir`/`clientDir`: where the data and the built PWA are (default `data` in the working
 * directory, `client/dist` of the checkout). `service`: started by launchd/systemd (`briefling install`): the admin
 * token is not printed (the service log or journal may be readable by others), `briefling url` gives it. */
export async function runFromEnv(e: NodeJS.ProcessEnv, at: { dataDir?: string; clientDir?: string; service?: boolean; version?: string; mode?: InstallMode } = {}): Promise<Running> {
  const dataDir = resolve(at.dataDir ?? e.BRIEFLING_DATA ?? 'data');
  // The version: the bundle's (hub/src/cli.ts), else the package manifest of this checkout or image.
  let version = at.version;
  if (!version) try { version = JSON.parse(readFileSync(new URL('../../packaging/npm/package.json', import.meta.url), 'utf8')).version } catch { version = 'dev' }
  const mode: InstallMode = at.service ? 'service' : e.BRIEFLING_CONTAINER === '1' ? 'docker' : at.mode ?? 'dev';
  let oidcCfg: OidcConfig | null = null;
  try { oidcCfg = oidcFromEnv(e) } catch (err) { console.error((err as Error).message); process.exit(1) }
  const turnUrls = (e.BRIEFLING_TURN_URLS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const s = await startServer({ dataDir, clientDir: at.clientDir, host: e.BRIEFLING_HOST, agent: e.BRIEFLING_AGENT, port: e.BRIEFLING_PORT ? Number(e.BRIEFLING_PORT) : undefined,
    // ACP_FROM: a bridge checkout (dev), else the pinned tag. AUTO_LAUNCH=0: the first start launches no agent.
    machine: { cwd: e.BRIEFLING_AGENT_CWD, from: e.BRIEFLING_ACP_FROM, autoLaunch: e.BRIEFLING_AUTO_LAUNCH !== '0' },
    ...(oidcCfg ? { oidc: oidcCfg } : {}), publicUrl: e.BRIEFLING_URL || undefined, container: e.BRIEFLING_CONTAINER === '1', inviteDir: e.BRIEFLING_INVITE_DIR || undefined,
    turn: turnUrls.length && e.BRIEFLING_TURN_SECRET ? { urls: turnUrls, secret: e.BRIEFLING_TURN_SECRET } : undefined,
    // BRIEFLING_UPDATE_CHECK=0: never asks npm. A checkout (dev) never does, unless =1 (tests, with a local registry).
    update: { current: version!, mode, enabled: e.BRIEFLING_UPDATE_CHECK !== '0' && (mode !== 'dev' || e.BRIEFLING_UPDATE_CHECK === '1'),
      registry: e.BRIEFLING_UPDATE_REGISTRY || undefined } })
    .catch(err => { console.error((err as Error).message); process.exit(1) });
  const signIn = oidcCfg ? `${s.url}/` : at.service ? `${s.url}/ (sign-in link: briefling url)` : `${s.url}/#token=${s.adminToken}`;
  console.log(`briefling standalone: data in ${dataDir}\n\n  Open ${signIn}\n`);
  if (oidcCfg) console.log(`  Sign-in: ${oidcCfg.issuer} (admins: ${oidcCfg.admins.join(', ')}); others need an invitation.\n`);
  const found = await s.scan();
  if (found.agents.length) {
    const launched = s.autoLaunched.length ? `  Launched into Home on this first start: ${s.autoLaunched.join(', ')}.\n` : '';
    console.log(`  Agents on this machine: ${found.agents.map(a => a.label + (a.missing ? ` (needs ${a.missing})` : '')).join(', ')}.\n${launched}  Launch or stop them from the app:\n    ${oidcCfg || at.service ? `${s.url}/#` : `${signIn}&`}/${HOME}/settings/agents\n`);
    if (!found.uv) console.log(`  The agents need uv (it runs the ACP bridge): https://docs.astral.sh/uv/getting-started/installation/\n    macOS: brew install uv    Linux/macOS: curl -LsSf https://astral.sh/uv/install.sh | sh\n`);
  } else console.log('  No ACP agent found on the PATH (claude, codex, copilot, cursor-agent/agent, gemini, agy, kiro-cli, hermes).\n');
  if (found.models.length) console.log(`  Local models: ${found.models.map(x => `${x.kind} at ${x.url} (${x.models.length} model${x.models.length === 1 ? '' : 's'})`).join(', ')}\n`);
  if (s.joinLink && !at.service) console.log(`  Agent of the Home space (valid 24 h, a new one at each start until it joined):\n    hermes briefling join '${s.joinLink}'\n`);
  const stop = () => void s.close().then(() => process.exit(0));
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  return s;
}

// Run directly (node hub/src/server.ts), not when bundled into the `briefling` command (its import.meta.url is the bundle's).
const self = fileURLToPath(import.meta.url);
if (self.endsWith('server.ts') && process.argv[1] && resolve(process.argv[1]) === self) await runFromEnv(process.env);
