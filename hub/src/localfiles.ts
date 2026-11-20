// Standalone server's attachments (hub/src/server.ts): the `Files` of the S3 bucket, on disk under the data folder.
// Same contract as the presigned S3 form and GET (hub/src/aws.ts): the hub signs, with the server key, an upload
// form bound to one key, type and maximum size (5 min), and read URLs bound to one key, served type and disposition
// (10 min). The browser posts the form to /files/upload (multipart parsed by the platform's Request.formData()) and
// reads /files/get/<key>. Read responses carry nosniff and a sandbox CSP: an uploaded HTML file never runs here.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { dirname, join } from 'node:path';
import { MAX_VIDEO_BYTES, MAX_FILE_BYTES } from '../../protocol/frames.ts';
import { servedAs, type Files, type Site } from './router.ts';
import { pinFileOk } from '../../protocol/pinapp.ts';

const KEY_RE = /^[a-z]{1,8}(?:\/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,63}){1,4}$/; // f/<space>/<id>, x/<space>/<xid>/<id>.txt (never a dot first: no `..`)
const UPLOAD_S = 300, READ_S = 600;
const MAX_BODY = Math.max(MAX_VIDEO_BYTES, MAX_FILE_BYTES) + 64 * 1024; // form fields around the file

/** The request body, refused past its declared length (a lying client cannot make the parser buffer more). */
async function* capped(req: IncomingMessage, max: number) {
  let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > max) throw new Error('body too long'); yield c as Buffer }
}

export interface DiskFiles extends Files {
  /** Answers /files/upload and /files/get/*; false when the path is not one of them. */
  serve(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean>;
}

export function diskFiles(dir: string, base: string, key: string, now: () => number = Date.now): DiskFiles {
  const sign = (s: string) => createHmac('sha256', key).update(s).digest('base64url');
  const ok = (got: string, want: string) => got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
  const path = (k: string) => { if (!KEY_RE.test(k)) throw new Error('bad file key'); return join(dir, k) };
  const put = async (k: string, data: Uint8Array | string) => {
    const p = path(k);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(`${p}.part`, data);
    await rename(`${p}.part`, p); // never a half-written file under the key
  };
  const end = (res: ServerResponse, status: number, text = '') => { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(text) };

  async function upload(req: IncomingMessage, res: ServerResponse) {
    const len = Number(req.headers['content-length']);
    if (!Number.isSafeInteger(len) || len <= 0) return end(res, 411);
    if (len > MAX_BODY) return end(res, 413);
    let form: FormData;
    try {
      form = await new Request('http://local/', { method: 'POST', headers: { 'content-type': String(req.headers['content-type'] ?? '') },
        body: Readable.toWeb(Readable.from(capped(req, len))) as ReadableStream, duplex: 'half' } as RequestInit).formData();
    } catch { return end(res, 400) }
    const [k, mime, size, exp, sig, file] = ['key', 'Content-Type', 'size', 'exp', 'sig', 'file'].map(n => form.get(n));
    if (typeof k !== 'string' || typeof mime !== 'string' || typeof size !== 'string' || typeof exp !== 'string' || typeof sig !== 'string' || !(file instanceof Blob))
      return end(res, 400);
    if (!ok(sig, sign(`up|${k}|${mime}|${size}|${exp}`)) || Number(exp) * 1000 <= now()) return end(res, 403);
    // The policy of the S3 form: declared size as the cap (content-length-range 1..size), declared type.
    if (file.size < 1 || file.size > Number(size)) return end(res, 400, 'size');
    await put(k, new Uint8Array(await file.arrayBuffer()));
    res.writeHead(204).end();
  }

  async function read(req: IncomingMessage, res: ServerResponse, url: URL) {
    const k = decodeURIComponent(url.pathname.slice('/files/get/'.length));
    const [t, d, e, s] = ['t', 'd', 'e', 's'].map(n => url.searchParams.get(n) ?? '');
    if (!KEY_RE.test(k) || !ok(s, sign(`get|${k}|${t}|${d}|${e}`)) || Number(e) * 1000 <= now()) return end(res, 403);
    let size: number;
    try { size = (await stat(path(k))).size } catch { return end(res, 404) }
    const head = { 'Content-Type': t, 'Content-Disposition': d, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=600',
      'Content-Security-Policy': "default-src 'none'; sandbox", 'Accept-Ranges': 'bytes' };
    // One byte range (the audio and video players ask for them); anything else gets the whole file.
    const r = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    if (r && (r[1] || r[2])) {
      const start = r[1] ? Number(r[1]) : Math.max(0, size - Number(r[2])), last = r[1] && r[2] ? Math.min(Number(r[2]), size - 1) : size - 1;
      if (start > last || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return }
      res.writeHead(206, { ...head, 'Content-Length': last - start + 1, 'Content-Range': `bytes ${start}-${last}/${size}` });
      createReadStream(path(k), { start, end: last }).pipe(res);
      return;
    }
    res.writeHead(200, { ...head, 'Content-Length': size });
    createReadStream(path(k)).pipe(res);
  }

  return {
    async presignPost(k, mime, size) {
      path(k);
      const exp = String(Math.floor(now() / 1000) + UPLOAD_S);
      // Field names of the S3 form the client already posts (`Content-Type` included); the file goes last.
      return { url: `${base}/files/upload`, fields: { key: k, 'Content-Type': mime, size: String(size), exp, sig: sign(`up|${k}|${mime}|${size}|${exp}`) } };
    },
    async presignGet(k, f) {
      path(k);
      const { type, disposition } = servedAs(f), e = String(Math.floor(now() / 1000) + READ_S);
      const q = new URLSearchParams({ t: type, d: disposition, e, s: sign(`get|${k}|${type}|${disposition}|${e}`) });
      return `${base}/files/get/${k}?${q}`;
    },
    async size(k) { try { return (await stat(path(k))).size } catch { return null } },
    async remove(k) { await rm(path(k), { force: true }) },
    async putText(k, text) { await put(k, text) },
    async getText(k) { try { return await readFile(path(k), 'utf8') } catch { return null } },
    async getBytes(k) { try { return new Uint8Array(await readFile(path(k))) } catch { return null } },
    async serve(req, res, url) {
      if (url.pathname === '/files/upload' && req.method === 'POST') { await upload(req, res); return true }
      if (url.pathname.startsWith('/files/get/') && (req.method === 'GET' || req.method === 'HEAD')) { await read(req, res, url); return true }
      return false;
    },
  };
}

/** Standalone server's public site files (the pinned applets' manifests and icons, hub/src/pinapp.ts), on disk under
 *  `dir`: the hub writes them like the S3 site bucket, `serve` answers `GET /a/<token>/<file>` (pinFileOk keys only). */
export function diskSite(dir: string): Site & { serve(res: ServerResponse, path: string, headers: Record<string, string>): Promise<boolean> } {
  const at = (k: string) => { if (!pinFileOk(k)) throw new Error('bad site key'); return join(dir, k) };
  return {
    async put(k, body, _type) {
      const p = at(k);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(`${p}.part`, body);
      await rename(`${p}.part`, p);
    },
    async remove(k) { await rm(at(k), { force: true }) },
    async serve(res, path, headers) {
      const k = path.slice(1);
      if (!pinFileOk(k)) return false;
      let body: Buffer;
      try { body = await readFile(join(dir, k)) } catch { res.writeHead(404, headers).end(); return true }
      res.writeHead(200, { ...headers, 'Content-Type': k.endsWith('.png') ? 'image/png' : 'application/manifest+json', 'Cache-Control': 'public, max-age=300' }).end(body);
      return true;
    },
  };
}
