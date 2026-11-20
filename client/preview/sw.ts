// Preview origin service worker (bundled to dist-preview/sw.js, scope /). Every request of this origin made by the
// previewed page (its iframe navigation and all it then loads) is tunnelled to the viewer page through a MessagePort,
// which relays it on the WebRTC data channel to the agent's peer (client/preview/wire.ts). Never intercepted: the
// viewer's own files, this script, `/config.json` (swBypass), other origins, a top-level navigation.
// Cache: only responses whose `cache-control` says `immutable` (hashed build assets), in a cache per preview key
// (agent + port, sent by the viewer with the port), served from it on the next load before going to the channel.
import { cacheName, immutable, swBypass } from './bridge.ts';

// Minimal service worker types (the project compiles against the DOM lib, not WebWorker).
interface ExtEvent extends Event { waitUntil(p: Promise<unknown>): void }
interface FetchEv extends ExtEvent { request: Request; respondWith(r: Promise<Response>): void }
interface SwMsgEv extends Event { data: unknown; ports: readonly MessagePort[] }
interface WinClient { id: string; postMessage(m: unknown): void }
interface Scope {
  location: Location;
  clients: { claim(): Promise<void>; matchAll(o: { type: 'window'; includeUncontrolled: boolean }): Promise<WinClient[]> };
  skipWaiting(): Promise<void>;
  addEventListener(t: 'install' | 'activate', f: (e: ExtEvent) => void): void;
  addEventListener(t: 'fetch', f: (e: FetchEv) => void): void;
  addEventListener(t: 'message', f: (e: SwMsgEv) => void): void;
}
declare const self: Scope;
export type PreviewSwEntry = true; // lets a test `import type` this file so `tsc -p .` checks it

type Reply = { id: number; type: 'head'; s: number; h: Record<string, string> } | { id: number; type: 'chunk'; data: ArrayBuffer; last: boolean }
  | { id: number; type: 'error'; msg: string };
interface Pending { resolve(r: Response): void; reject(e: Error): void; method: string; ctl?: ReadableStreamDefaultController<Uint8Array> }

let port: MessagePort | null = null, key: string | null = null, nextId = 1;
let waiters: (() => void)[] = [];
const pending = new Map<number, Pending>();

self.addEventListener('install', () => { void self.skipWaiting(); });
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('message', (e) => {
  const d = e.data as { type?: unknown; key?: unknown } | null;
  if (d?.type !== 'port' || !e.ports[0]) return;
  port = e.ports[0]; port.onmessage = (m) => onReply(m.data as Reply);
  key = typeof d.key === 'string' ? d.key : null;
  waiters.splice(0).forEach(w => w());
});

function onReply(m: Reply) {
  const p = pending.get(m.id);
  if (!p) return;
  if (m.type === 'head') {
    const nullBody = m.s === 204 || m.s === 304 || p.method === 'HEAD';
    const body = nullBody ? null : new ReadableStream<Uint8Array>({ start: (c) => { p.ctl = c; } });
    p.resolve(new Response(body, { status: m.s, headers: m.h }));
    if (nullBody) pending.delete(m.id);
  } else if (m.type === 'chunk') {
    if (m.data.byteLength) p.ctl?.enqueue(new Uint8Array(m.data));
    if (m.last) { p.ctl?.close(); pending.delete(m.id); }
  } else {
    if (p.ctl) p.ctl.error(new Error(m.msg)); else p.reject(new Error(m.msg));
    pending.delete(m.id);
  }
}

/** The viewer's port; after a worker restart it is lost: ask every window again (`need-port`), 5 s at most. */
async function getPort(): Promise<MessagePort> {
  if (port) return port;
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  wins.forEach(c => c.postMessage({ type: 'need-port' }));
  await new Promise<void>((res, rej) => { waiters.push(res); setTimeout(() => rej(new Error('no viewer')), 5000); });
  return port!;
}

async function tunnel(req: Request): Promise<Response> {
  const p = await getPort();
  const url = new URL(req.url), id = nextId++;
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => { headers[k] = v; });
  const body = req.method === 'GET' || req.method === 'HEAD' ? null : await req.arrayBuffer();
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, method: req.method });
    p.postMessage({ id, m: req.method, u: url.pathname + url.search, h: headers, b: body }, body ? [body] : []);
  });
}

async function handle(req: Request): Promise<Response> {
  await getPort(); // brings the key back too after a restart
  const cache = req.method === 'GET' && key ? await caches.open(cacheName(key)) : null;
  const hit = cache ? await cache.match(req) : undefined;
  if (hit) return hit;
  const r = await tunnel(req);
  if (cache && r.status === 200 && immutable(r.headers.get('cache-control'))) void cache.put(req, r.clone()).catch(() => {});
  return r;
}

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (url.origin !== self.location.origin || swBypass(url.pathname)) return;
  // Path rule, not client ids (FetchEvent.resultingClientId is not everywhere): a top-level navigation always goes to
  // the network (the previewed page only ever loads inside the viewer's iframe, destination 'iframe').
  if (req.mode === 'navigate' && req.destination === 'document') return;
  e.respondWith(handle(req).catch((err: Error) => new Response(`preview tunnel: ${err.message}`, { status: 502 })));
});
