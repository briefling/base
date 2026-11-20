import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PIN_SIZES, pinFileOk, pinKey, pinManifest, pinRoot, pinTokenOf, pngSize } from '../../protocol/pinapp.ts';
import { installRoute, installUrl, phoneOs, pinApp, type PinDeps } from '../src/pinapp.ts';

const TOK = 'AbCdEfGhIjKlMnOpQrSt_-';

test('pinManifest: its own id and scope per token, start_url on the applet alone inside it, PNG icons 192 and 512', () => {
  const m = pinManifest({ id: 'ap1', name: 'Devis pivot' }, 'jyd', TOK);
  assert.equal(m.id, `/a/${TOK}/`);
  assert.equal(m.scope, `/a/${TOK}/`);
  assert.equal(m.start_url, `/a/${TOK}/#/jyd/applets/ap1`);
  assert.ok(m.start_url.startsWith(m.scope), 'start_url inside the scope (Chrome refuses it otherwise)');
  assert.deepEqual([m.name, m.short_name, m.display], ['Devis pivot', 'Devis pivot', 'standalone']);
  assert.deepEqual(m.icons.map(i => [i.sizes, i.purpose]), [['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable']]);
  assert.ok(m.icons.every(i => i.src.startsWith(m.scope) && i.type === 'image/png'));
  const other = pinManifest({ id: 'ap2', name: 'Autre' }, 'jyd', 'ZZZZZZZZZZZZZZZZZZZZZZ');
  assert.ok(!other.scope.startsWith(m.scope) && !m.scope.startsWith(other.scope), 'two applets: scopes that do not overlap (two apps on Android)');
});

test('pinFileOk / pinTokenOf: only the three files of a 22-char token, never a path out of it', () => {
  for (const f of ['manifest.webmanifest', 'icon-192.png', 'icon-512.png']) assert.ok(pinFileOk(`a/${TOK}/${f}`), f);
  for (const k of [`a/${TOK}/index.html`, `a/${TOK}/../index.html`, `a/short/icon-192.png`, `f/${TOK}/icon-192.png`, `a/${TOK}/icon-192.png/x`, `a/${TOK}`])
    assert.equal(pinFileOk(k), false, k);
  assert.equal(pinTokenOf(`/a/${TOK}/`), TOK);
  assert.equal(pinTokenOf(`/a/${TOK}/index.html`), TOK);
  assert.equal(pinTokenOf('/'), null);
  assert.equal(pinTokenOf(`/a/${TOK}/icon-192.png`), null);
  assert.equal(pinRoot(TOK), `/a/${TOK}/`);
  assert.notEqual(pinKey({ name: 'A', emoji: '🚜' }), pinKey({ name: 'A' }), 'a new emoji makes the files stale');
});

/** A real PNG header of w×h (signature + IHDR). */
const png = (w: number, h: number) => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h);
  return b;
};
test('pngSize: reads IHDR, refuses what is not a PNG', () => {
  assert.deepEqual(pngSize(png(192, 192)), { w: 192, h: 192 });
  assert.deepEqual(pngSize(png(512, 300)), { w: 512, h: 300 });
  assert.equal(pngSize(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  const bad = png(1, 1); bad[12] = 0x58; assert.equal(pngSize(bad), null, 'no IHDR first');
});

function fakeDeps(answers: any[], path = '/') {
  const sent: any[] = [], posted: string[] = [], went: string[] = [];
  const d: PinDeps = {
    request: async f => { sent.push(f); return (answers.shift() ?? null) as any },
    icon: async size => ({ png: new Blob([`png${size}`], { type: 'image/png' }), drawn: size === 512 ? 'emoji-small' as const : 'emoji' as const }),
    upload: async (post, file) => { posted.push(`${post.url}:${file.size}`); return true },
    path: () => path,
    go: url => { went.push(url) },
  };
  return { d, sent, posted, went };
}

test('pinApp: first time draws and uploads both icons, publishes, then moves into /a/<token>/ with the same hash', async () => {
  const up = (id: string) => ({ type: 'upload.ready', client_id: 'x', file: { id, name: 'i', mime: 'image/png', size: 6 }, post: { url: 'https://s3/', fields: {} } });
  const f = fakeDeps([{ type: 'pinapp.state', fresh: false }, up('f192'), up('f512'), { type: 'pinapp.state', fresh: true, token: TOK }]);
  assert.equal(await pinApp(f.d, 'jyd', 'ap1', '#/jyd/applets/ap1'), 'moved');
  assert.deepEqual(f.sent.map(x => x.type), ['pinapp.get', 'upload', 'upload', 'pinapp.get']);
  assert.deepEqual(f.sent.slice(1, 3).map(x => [x.name, x.mime]), PIN_SIZES.map(s => [`icon-${s}.png`, 'image/png']));
  assert.deepEqual(f.sent[3].icons, ['f192', 'f512'], 'icons in PIN_SIZES order');
  assert.deepEqual(f.sent[3].drawn, ['emoji', 'emoji-small'], 'what each icon shows, for the hub\'s log');
  assert.equal(f.posted.length, 2);
  assert.deepEqual(f.went, [`/a/${TOK}/#/jyd/applets/ap1`]);
});

test('pinApp: fresh and already in its app = nothing; fresh elsewhere = move only; refused or offline = stays (step 1)', async () => {
  const here = fakeDeps([{ type: 'pinapp.state', fresh: true, token: TOK }], `/a/${TOK}/`);
  assert.equal(await pinApp(here.d, 'jyd', 'ap1', '#/jyd/applets/ap1'), 'here');
  assert.deepEqual([here.sent.length, here.went.length], [1, 0]);
  const move = fakeDeps([{ type: 'pinapp.state', fresh: true, token: TOK }]);
  assert.equal(await pinApp(move.d, 'jyd', 'ap1', '#/x'), 'moved');
  assert.deepEqual(move.sent.map(x => x.type), ['pinapp.get'], 'fresh: no icon redrawn');
  const off = fakeDeps([]);
  assert.equal(await pinApp(off.d, 'jyd', 'ap1', '#/x'), 'off');
  assert.equal(off.went.length, 0);
  const upFail = fakeDeps([{ type: 'pinapp.state', fresh: false }, null]);
  assert.equal(await pinApp(upFail.d, 'jyd', 'ap1', '#/x'), 'failed');
  assert.equal(upFail.went.length, 0);
});

test('installUrl / installRoute / phoneOs: « Install » in the installed app leaves for the phone\'s browser on the applet', () => {
  assert.equal(installUrl('ios', 'https://app.test/', 'jyd', 'ap1'), 'x-safari-https://app.test/#/jyd/applets/ap1');
  const and = installUrl('android', 'https://app.test/', 'jyd', 'ap1')!;
  assert.equal(and, 'intent://app.test/?install=jyd/ap1#Intent;scheme=https;package=com.android.chrome;end');
  assert.equal(installRoute(new URL(and.replace(/^intent:/, 'https:').replace(/#Intent.*$/, '')).search), '#/jyd/applets/ap1', 'Chrome lands on the applet');
  assert.equal(installUrl(null, 'https://app.test/', 'jyd', 'ap1'), null, 'desktop: opens in place');
  assert.equal(installRoute(''), null);
  assert.equal(installRoute('?install=a/b/c'), null);
  assert.equal(installRoute('?code=x&state=y'), null, 'the OAuth return is not touched');
  const ua = (s: string) => `Mozilla/5.0 (${s}) AppleWebKit/605.1.15`;
  assert.equal(phoneOs(ua('iPhone; CPU iPhone OS 18_0 like Mac OS X'), 5), 'ios');
  assert.equal(phoneOs(ua('Macintosh; Intel Mac OS X 10_15_7'), 5), 'ios', 'an iPad');
  assert.equal(phoneOs(ua('Macintosh; Intel Mac OS X 10_15_7'), 0), null, 'a Mac');
  assert.equal(phoneOs(ua('Linux; Android 14; Pixel 8'), 5), 'android');
});
