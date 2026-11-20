// Data channel framing between the viewer page (client/preview/viewer.ts) and the agent's peer (headless Chromium
// driven by the plugin, Python). Pure module: the viewer bundles it, the unit tests pin it, and the agent peer
// implements the same contract (copy the shapes below, they are the whole protocol; kept from the proven spike).
//
// One ordered RTCDataChannel labelled PREVIEW_CHANNEL ('http'), created by the viewer before its offer,
// `binaryType = 'arraybuffer'`. Messages:
//
//   Request, viewer -> peer, TEXT frame, JSON:
//     {"id": <uint32>, "m": "GET", "u": "/path?query", "h": {"<lower-case name>": "<value>"}, "b": "<base64>"}
//     `b` only when there is a body (non-GET/HEAD), decoded size <= PREVIEW_BODY_MAX (1 MiB). `u` always passes
//     previewPathOk (protocol/preview.ts); the peer checks it again and drops `host` and `origin` before its fetch.
//
//   Response head, peer -> viewer, TEXT frame, JSON, one per request:
//     {"id": <same>, "s": <status>, "h": {"<name>": "<value>"}}
//     (the peer drops `content-encoding` and `content-length`: its fetch() already decoded the body)
//   or, when it could not fetch (no chunk follows):
//     {"id": <same>, "err": "refused" | "fetch" | "<text>"}
//     refused = path refused by previewPathOk, or a redirect that left http://127.0.0.1:<port>; fetch = network error.
//
//   Body, peer -> viewer, BINARY frames, after the head:
//     [id: uint32 big endian][last: uint8 0|1][payload: 0..PREVIEW_CHUNK (16384) bytes]
//     Always ends with exactly one frame last = 1 (its payload may be empty: a 0-byte body is one 5-byte frame).
//     The peer waits while `bufferedAmount > 1 MiB` (back-pressure).
//
// Python sketch of the peer side of a chunk:  struct.pack('>IB', id, 1 if last else 0) + payload
import { PREVIEW_CHUNK, previewPathOk } from '../../protocol/preview.ts';

/** 4-byte request id + 1-byte last flag. */
export const CHUNK_HEAD = 5;
/** Largest request body the viewer forwards (decoded bytes). */
export const PREVIEW_BODY_MAX = 1024 * 1024;
export const UINT32_MAX = 0xffff_ffff;

export type Headers = Record<string, string>;
export interface WireRequest { id: number; m: string; u: string; h: Headers; b?: string }
export type WireHead = { id: number; s: number; h: Headers } | { id: number; err: string };
export interface WireChunk { id: number; last: boolean; data: Uint8Array }

const idOk = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0 && (x as number) <= UINT32_MAX;
const headersOk = (x: unknown): x is Headers => !!x && typeof x === 'object' && !Array.isArray(x)
  && Object.values(x as object).every(v => typeof v === 'string');

export function b64encode(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64decode(s: string): Uint8Array {
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Request text frame, or null when it must not go on the channel (path not relative, body too big, bad id). */
export function requestFrame(id: number, method: string, path: string, headers: Headers, body?: Uint8Array | null): string | null {
  if (!idOk(id) || !previewPathOk(path) || !/^[A-Z]{1,16}$/.test(method)) return null;
  if (body && body.byteLength > PREVIEW_BODY_MAX) return null;
  const h: Headers = {};
  for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = v;
  const r: WireRequest = { id, m: method, u: path, h };
  if (body && method !== 'GET' && method !== 'HEAD') r.b = b64encode(body);
  return JSON.stringify(r);
}

/** Peer side (documented contract, used by the tests): the request, or null when it must be refused. */
export function parseRequest(text: string): WireRequest | null {
  let r: unknown;
  try { r = JSON.parse(text); } catch { return null; }
  const o = r as Partial<WireRequest>;
  if (!o || typeof o !== 'object' || !idOk(o.id) || typeof o.m !== 'string' || !previewPathOk(o.u) || !headersOk(o.h)) return null;
  if (o.b !== undefined && (typeof o.b !== 'string' || o.b.length > Math.ceil(PREVIEW_BODY_MAX / 3) * 4)) return null;
  return o as WireRequest;
}

/** Response head text frame (peer side). */
export const headFrame = (h: WireHead) => JSON.stringify(h);

/** Response head received by the viewer, or null when malformed. */
export function parseHead(text: string): WireHead | null {
  let r: unknown;
  try { r = JSON.parse(text); } catch { return null; }
  const o = r as Record<string, unknown>;
  if (!o || typeof o !== 'object' || !idOk(o.id)) return null;
  if (typeof o.err === 'string') return { id: o.id, err: o.err };
  if (!Number.isInteger(o.s) || (o.s as number) < 100 || (o.s as number) > 599 || !headersOk(o.h)) return null;
  return { id: o.id, s: o.s as number, h: o.h };
}

/** One binary frame. */
export function encodeChunk(id: number, last: boolean, payload: Uint8Array): Uint8Array {
  if (!idOk(id)) throw new RangeError('id');
  if (payload.byteLength > PREVIEW_CHUNK) throw new RangeError('payload over PREVIEW_CHUNK');
  const out = new Uint8Array(CHUNK_HEAD + payload.byteLength), v = new DataView(out.buffer);
  v.setUint32(0, id); v.setUint8(4, last ? 1 : 0); out.set(payload, CHUNK_HEAD);
  return out;
}

/** A whole body as frames: ceil(n / PREVIEW_CHUNK) frames (at least one), the last one flagged. */
export function chunkBody(id: number, body: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let at = 0; ; at += PREVIEW_CHUNK) {
    const end = Math.min(at + PREVIEW_CHUNK, body.byteLength), last = end >= body.byteLength;
    out.push(encodeChunk(id, last, body.subarray(at, end)));
    if (last) return out;
  }
}

/** Binary frame received by the viewer, or null when shorter than its head or with a bad flag/size. */
export function decodeChunk(buf: ArrayBuffer | Uint8Array): WireChunk | null {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (u.byteLength < CHUNK_HEAD || u.byteLength > CHUNK_HEAD + PREVIEW_CHUNK) return null;
  const v = new DataView(u.buffer, u.byteOffset, u.byteLength), flag = v.getUint8(4);
  if (flag > 1) return null;
  return { id: v.getUint32(0), last: flag === 1, data: u.slice(CHUNK_HEAD) };
}
