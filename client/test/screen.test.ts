import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EDGE_SLACK, F_CONFIG, F_KEY, F_LAST, Reassembler, SCREEN_PACKET_MAX, avcCodec, pasteText, toUnit, toUnitClamped } from '../preview/screen.ts';
import { toViewer, keyOfHash, previewKey } from '../preview/bridge.ts';
import { PREVIEW_SCREEN_CHUNK, SCREEN_TEXT_MAX, previewDeviceOk, previewLabel, screenGesture } from '../../protocol/preview.ts';
import { DICTS } from '../src/i18n.ts';

const frag = (flags: number, ...bytes: number[]) => Uint8Array.from([flags, ...bytes]);

test('screen gestures: the exact grammar, nothing else crosses the channel', () => {
  assert.deepEqual(screenGesture({ k: 'touch', a: 'down', x: 0, y: 1, extra: 'rm' }), { k: 'touch', a: 'down', x: 0, y: 1 }, 'unknown fields dropped');
  assert.deepEqual(screenGesture({ k: 'key', key: 'home' }), { k: 'key', key: 'home' });
  assert.deepEqual(screenGesture({ k: 'text', s: "l'été 42" }), { k: 'text', s: "l'été 42" });
  assert.deepEqual(screenGesture({ k: 'reset' }), { k: 'reset' });
  for (const bad of [null, 'tap', { k: 'touch', a: 'down', x: 1.01, y: 0 }, { k: 'touch', a: 'down', x: -0.1, y: 0 },
    { k: 'touch', a: 'down', x: NaN, y: 0 }, { k: 'touch', a: 'down', x: '0.5', y: 0 }, { k: 'touch', a: 'hover', x: 0, y: 0 },
    { k: 'key', key: 'power' }, { k: 'key', key: 26 }, { k: 'text', s: '' }, { k: 'text', s: 'a\nb' }, { k: 'text', s: 'x'.repeat(SCREEN_TEXT_MAX + 1) },
    { k: 'shell', cmd: 'reboot' }])
    assert.equal(screenGesture(bad), null, JSON.stringify(bad));
  assert.ok(screenGesture({ k: 'text', s: 'x'.repeat(SCREEN_TEXT_MAX) }));
});

test('screen device: an adb serial without any shell character; empty label = the device', () => {
  for (const ok of ['emulator-5554', 'host.docker.internal:5555', 'R58M123ABC', '192.168.1.20:5555']) assert.ok(previewDeviceOk(ok), ok);
  for (const bad of ['', 'a b', 'x;reboot', 'x$(id)', '`id`', 'x|y', "x'y", 'x'.repeat(65), 5555, null]) assert.ok(!previewDeviceOk(bad), String(bad));
  assert.equal(previewLabel('', 'emulator-5554'), 'emulator-5554');
  assert.equal(previewLabel('', 3000), 'localhost:3000');
});

test('screen fragments: reassembled in order, flags of the first fragment, oversize and bad fragments dropped', () => {
  const r = new Reassembler();
  assert.equal(r.push(frag(F_KEY, 1, 2)), null);
  assert.deepEqual(r.push(frag(F_LAST, 3)), { flags: F_KEY, data: Uint8Array.from([1, 2, 3]) });
  assert.deepEqual(r.push(frag(F_CONFIG | F_LAST, 9)), { flags: F_CONFIG, data: Uint8Array.from([9]) }, 'one-fragment packet');
  assert.equal(r.push(new Uint8Array(0)), null, 'empty fragment');
  assert.equal(r.push(new Uint8Array(PREVIEW_SCREEN_CHUNK + 1)), null, 'fragment over the chunk size');
  const big = new Uint8Array(PREVIEW_SCREEN_CHUNK);
  let out = null;
  for (let n = 0; n * (PREVIEW_SCREEN_CHUNK - 1) <= SCREEN_PACKET_MAX; n++) out = r.push(big) ?? out;
  assert.equal(out, null, 'a packet past SCREEN_PACKET_MAX never comes out');
  assert.deepEqual(r.push(frag(F_LAST, 7)), { flags: 0, data: Uint8Array.from([7]) }, 'the next packet starts clean');
});

test('screen codec string from the SPS of the config packet', () => {
  assert.equal(avcCodec(Uint8Array.from([0, 0, 0, 1, 0x67, 0x42, 0xc0, 0x29, 0xda, 0, 0, 0, 1, 0x68])), 'avc1.42c029');
  assert.equal(avcCodec(Uint8Array.from([0, 0, 1, 0x67, 0x64, 0x00, 0x1f, 0x01])), 'avc1.64001f');
  assert.equal(avcCodec(Uint8Array.from([0, 0, 0, 1, 0x68, 1, 2, 3])), null, 'not an SPS');
  assert.equal(avcCodec(Uint8Array.from([0, 0, 1, 0x67])), null, 'truncated');
});

test('screen pointer -> picture coordinates, letterboxed like object-fit: contain', () => {
  const box = { left: 100, top: 0, width: 400, height: 400 }; // a 200x400 picture shows 200 wide, centred: x 200..400
  assert.deepEqual(toUnit(300, 200, box, 200, 400), { x: 0.5, y: 0.5 });
  assert.deepEqual(toUnit(200, 0, box, 200, 400), { x: 0, y: 0 });
  assert.equal(toUnit(150, 200, box, 200, 400), null, 'in the black band');
  assert.deepEqual(toUnit(190, -10, box, 200, 400, 24), { x: 0, y: 0 }, 'just outside, within the slack: on the edge');
  assert.equal(toUnit(170, 200, box, 200, 400, 24), null, 'beyond the slack: nothing');
  assert.equal(toUnit(300, 200, box, 0, 0), null, 'before the first picture');
  assert.deepEqual(toUnitClamped(150, 500, box, 200, 400), { x: 0, y: 1 }, 'a swipe leaving the picture sticks to its edge');
});

test('screen edge slack stays small', () => assert.ok(EDGE_SLACK > 0 && EDGE_SLACK <= 32));

test('screen paste: one line, bounded', () => {
  assert.equal(pasteText(' a\r\nb\tc '), 'a b c');
  assert.equal(pasteText('x'.repeat(500)).length, SCREEN_TEXT_MAX);
  assert.equal(pasteText('\n\n'), '');
});

test('bridge: a screen ready and the app buttons\' gestures pass, checked like the channel', () => {
  assert.deepEqual(toViewer({ bp: 1, type: 'ready', ice: [], screen: true }), { bp: 1, type: 'ready', ice: [], screen: true });
  assert.deepEqual(toViewer({ bp: 1, type: 'ready', ice: [], screen: 'yes' }), { bp: 1, type: 'ready', ice: [] }, 'screen only when true');
  assert.deepEqual(toViewer({ bp: 1, type: 'gesture', g: { k: 'key', key: 'back' } }), { bp: 1, type: 'gesture', g: { k: 'key', key: 'back' } });
  assert.equal(toViewer({ bp: 1, type: 'gesture', g: { k: 'key', key: 'power' } }), null);
  assert.equal(keyOfHash(`#key=${previewKey('gaston', 0)}`), 'gaston-0', 'a screen (no port) keeps a valid viewer key');
});

test('i18n: every screen key in both languages', () => {
  for (const k of ['preview_line_screen', 'preview_card_screen', 'preview_by_screen', 'preview_hint_screen', 'preview_open_screen',
    'screen_back', 'screen_home', 'screen_recents', 'preview_err_no_device', 'preview_err_no_scrcpy', 'preview_err_codec'] as const)
    for (const l of ['en', 'fr'] as const) assert.ok(DICTS[l][k], `${l} ${k}`);
});
