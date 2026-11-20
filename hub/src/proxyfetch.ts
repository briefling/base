// fetch through the proxy of the environment, for the server's own calls to the internet (the update check and download,
// hub/src/update.ts). Node's global fetch ignores HTTP(S)_PROXY unless the process was started with NODE_USE_ENV_PROXY=1
// (read once at start, too late for `npx briefling`), so on a machine whose only way out is a proxy the check failed with
// « fetch failed ». node:https's Agent takes the same variables at run time (`proxyEnv`, Node 22.21+; an older Node
// ignores the option and goes direct, as before). Loopback never goes through the proxy, whatever NO_PROXY says.
import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';

const LOOPBACK = ['localhost', '127.0.0.1', '::1'];
const get = (env: NodeJS.ProcessEnv, k: string) => env[k] || env[k.toLowerCase()] || undefined;

/** The proxy settings Node's Agent reads, NO_PROXY completed with loopback; null without any proxy. */
export function proxyEnv(env: NodeJS.ProcessEnv): Record<string, string> | null {
  const https_ = get(env, 'HTTPS_PROXY'), http_ = get(env, 'HTTP_PROXY');
  if (!https_ && !http_) return null;
  const no = (get(env, 'NO_PROXY') ?? '').split(',').map(s => s.trim()).filter(Boolean);
  for (const h of LOOPBACK) if (!no.includes(h)) no.push(h);
  return { ...(https_ ? { HTTPS_PROXY: https_ } : {}), ...(http_ ? { HTTP_PROXY: http_ } : {}), NO_PROXY: no.join(',') };
}

/** A fetch (GET, no redirect followed) through the environment's proxy; the global fetch when there is none. */
export function proxyFetch(env: NodeJS.ProcessEnv = process.env): typeof fetch {
  const pe = proxyEnv(env);
  if (!pe) return fetch;
  const agents = { 'https:': new https.Agent({ proxyEnv: pe } as https.AgentOptions), 'http:': new http.Agent({ proxyEnv: pe } as http.AgentOptions) };
  return ((input: string | URL, init: RequestInit = {}) => new Promise<Response>((resolve, reject) => {
    const url = new URL(String(input));
    const mod = url.protocol === 'https:' ? https : url.protocol === 'http:' ? http : null;
    if (!mod) return reject(new TypeError(`unsupported protocol ${url.protocol}`));
    const req = mod.request(url, { method: 'GET', agent: agents[url.protocol as 'https:' | 'http:'],
      headers: Object.fromEntries(new Headers(init.headers).entries()), signal: init.signal ?? undefined }, res => {
      const headers = new Headers();
      for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
      const status = res.statusCode ?? 502, empty = status === 204 || status === 304;
      if (empty) res.resume();
      resolve(new Response(empty ? null : Readable.toWeb(res) as ReadableStream, { status, headers }));
    });
    req.on('error', reject);
    req.end();
  })) as typeof fetch;
}
