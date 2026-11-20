// The update check's fetch through the environment's proxy (hub/src/proxyfetch.ts): a fake proxy is the only one that
// knows the registry's name (`.invalid` never resolves), loopback stays direct, no proxy = the global fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { proxyEnv, proxyFetch } from '../src/proxyfetch.ts';

const listen = (s: Server) => new Promise<number>(r => s.listen(0, '127.0.0.1', () => r((s.address() as { port: number }).port)));
const manifest = (host: string) => ({ name: 'briefling', version: '9.9.9',
  dist: { tarball: `http://${host}/briefling/-/briefling-9.9.9.tgz`, integrity: `sha512-${'A'.repeat(86)}==` } });

test('proxyEnv: none without a proxy; either case; NO_PROXY kept and completed with loopback', () => {
  assert.equal(proxyEnv({ PATH: '/bin' }), null);
  assert.equal(proxyFetch({}), fetch);
  assert.deepEqual(proxyEnv({ https_proxy: 'http://p:3128' }), { HTTPS_PROXY: 'http://p:3128', NO_PROXY: 'localhost,127.0.0.1,::1' });
  assert.deepEqual(proxyEnv({ HTTP_PROXY: 'http://p:3128', NO_PROXY: '.corp, 127.0.0.1' }),
    { HTTP_PROXY: 'http://p:3128', NO_PROXY: '.corp,127.0.0.1,localhost,::1' });
});

test('proxyFetch: the registry through the proxy (http absolute URI, https CONNECT), loopback direct', async () => {
  const seen: string[] = [];
  const proxy = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    if (req.url === 'http://registry.invalid/briefling/latest') return void res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(manifest('registry.invalid')));
    res.writeHead(404).end();
  });
  proxy.on('connect', (req, sock) => { seen.push(`CONNECT ${req.url}`); sock.end('HTTP/1.1 403 Forbidden\r\n\r\n') });
  const local = createServer((_q, res) => res.writeHead(200).end('direct'));
  const [pp, lp] = await Promise.all([listen(proxy), listen(local)]);
  const P = `http://127.0.0.1:${pp}`;
  try {
    const f = proxyFetch({ HTTP_PROXY: P, HTTPS_PROXY: P });
    // without the proxy the name does not resolve: the manifest only comes through it
    await assert.rejects(fetch('http://registry.invalid/briefling/latest'));
    assert.deepEqual(await (await f('http://registry.invalid/briefling/latest', { headers: { Accept: 'application/json' } })).json(), manifest('registry.invalid'));
    await assert.rejects(f('https://registry.invalid/briefling/latest', { signal: AbortSignal.timeout(5000) }));
    assert.equal((await f('http://registry.invalid/nope')).status, 404);
    assert.equal(await (await f(`http://127.0.0.1:${lp}/x`)).text(), 'direct');
    assert.deepEqual(seen, ['GET http://registry.invalid/briefling/latest', 'CONNECT registry.invalid:443', 'GET http://registry.invalid/nope']);
  } finally { proxy.close(); local.close() }
});
