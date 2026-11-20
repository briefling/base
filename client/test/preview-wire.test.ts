import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PREVIEW_CHUNK } from '../../protocol/preview.ts';
import { CHUNK_HEAD, PREVIEW_BODY_MAX, b64decode, chunkBody, decodeChunk, encodeChunk, headFrame, parseHead, parseRequest, requestFrame } from '../preview/wire.ts';
// Type-only: makes `tsc -p .` check the two entry files (erased at run time, so their browser code never runs here).
import type { ViewerEntry } from '../preview/viewer.ts';
import type { PreviewSwEntry } from '../preview/sw.ts';
const entries: [ViewerEntry, PreviewSwEntry] = [true, true];
void entries;

const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) & 0xff);
/** Viewer-side reassembly of what the peer sends for one body. */
function reassemble(frames: Uint8Array[], id: number) {
  const parts: Uint8Array[] = [];
  let lasts = 0;
  for (const f of frames) {
    const c = decodeChunk(f.slice().buffer)!; // as received: a standalone ArrayBuffer
    assert.equal(c.id, id);
    parts.push(c.data); if (c.last) lasts++;
  }
  return { body: Buffer.concat(parts), lasts };
}

test('wire: request frame round trip (GET has no body, POST body in base64, header names lower-cased)', () => {
  const g = parseRequest(requestFrame(7, 'GET', '/src/main.tsx?t=1', { Accept: '*/*' })!)!;
  assert.deepEqual(g, { id: 7, m: 'GET', u: '/src/main.tsx?t=1', h: { accept: '*/*' } });
  const body = bytes(1000), p = parseRequest(requestFrame(0xffffffff, 'POST', '/api', { 'content-type': 'application/json' }, body)!)!;
  assert.equal(p.id, 0xffffffff);
  assert.deepEqual(Buffer.from(b64decode(p.b!)), Buffer.from(body));
  assert.equal('b' in parseRequest(requestFrame(1, 'GET', '/', {}, bytes(3))!)!, false, 'no body on GET');
});

test('wire: requests that never go on the channel (path not relative, body over 1 MiB, bad id or method)', () => {
  for (const u of ['http://evil/', '//evil/x', 'x', '/a\\b', '/a\nb']) assert.equal(requestFrame(1, 'GET', u, {}), null, u);
  assert.equal(requestFrame(1, 'POST', '/', {}, new Uint8Array(PREVIEW_BODY_MAX + 1)), null);
  assert.notEqual(requestFrame(1, 'POST', '/', {}, new Uint8Array(PREVIEW_BODY_MAX)), null);
  assert.equal(requestFrame(-1, 'GET', '/', {}), null);
  assert.equal(requestFrame(2 ** 32, 'GET', '/', {}), null);
  assert.equal(requestFrame(1, 'get x', '/', {}), null);
  assert.equal(parseRequest('{"id":1,"m":"GET","u":"//evil","h":{}}'), null, 'the peer checks the path again');
  assert.equal(parseRequest('not json'), null);
});

test('wire: response head (status + headers, or err) and malformed heads', () => {
  assert.deepEqual(parseHead(headFrame({ id: 3, s: 200, h: { 'content-type': 'text/html' } })), { id: 3, s: 200, h: { 'content-type': 'text/html' } });
  assert.deepEqual(parseHead(headFrame({ id: 4, err: 'refused' })), { id: 4, err: 'refused' });
  for (const x of ['{"id":1,"s":99,"h":{}}', '{"id":1,"s":200,"h":{"a":1}}', '{"s":200,"h":{}}', '[]', '']) assert.equal(parseHead(x), null, x);
});

test('wire: chunk boundaries (0 byte, exactly 16 KiB, 16 KiB + 1), always one last frame at the end', () => {
  for (const [n, frames] of [[0, 1], [1, 1], [PREVIEW_CHUNK, 1], [PREVIEW_CHUNK + 1, 2], [3 * PREVIEW_CHUNK, 3]] as const) {
    const body = bytes(n), out = chunkBody(9, body);
    assert.equal(out.length, frames, `${n} bytes`);
    const r = reassemble(out, 9);
    assert.equal(r.lasts, 1, `${n}: one last`);
    assert.equal(decodeChunk(out.at(-1)!)!.last, true);
    assert.deepEqual(r.body, Buffer.from(body));
    for (const f of out) assert.ok(f.byteLength <= CHUNK_HEAD + PREVIEW_CHUNK);
  }
  assert.equal(chunkBody(1, new Uint8Array(0))[0].byteLength, CHUNK_HEAD, 'empty body = one 5-byte frame');
});

test('wire: chunk head is 4-byte big-endian id + 1 flag byte (the Python peer packs >IB)', () => {
  const f = encodeChunk(0x01020304, true, Uint8Array.of(0xaa));
  assert.deepEqual([...f], [1, 2, 3, 4, 1, 0xaa]);
  assert.deepEqual([...encodeChunk(5, false, new Uint8Array(0))], [0, 0, 0, 5, 0]);
  assert.throws(() => encodeChunk(1, true, new Uint8Array(PREVIEW_CHUNK + 1)));
  assert.equal(decodeChunk(new Uint8Array(4)), null, 'shorter than its head');
  assert.equal(decodeChunk(Uint8Array.of(0, 0, 0, 1, 2)), null, 'flag not 0/1');
  assert.equal(decodeChunk(new Uint8Array(CHUNK_HEAD + PREVIEW_CHUNK + 1)), null, 'over a chunk');
  const sub = new Uint8Array(20); sub.set([0, 0, 0, 8, 1, 42], 10);
  assert.deepEqual(decodeChunk(sub.subarray(10, 16)), { id: 8, last: true, data: Uint8Array.of(42) }, 'offset view');
});
