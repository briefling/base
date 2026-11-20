// Screen share, viewer side (protocol/preview.ts « Screen »): the agent streams an Android device's screen as H.264
// packets on the `screen` data channel; this module decodes them in a canvas (WebCodecs) and sends the gestures made
// on it back on the same channel. The pure parts (fragment reassembly, codec string, pointer -> device coordinates)
// are exported for the tests; `startScreen` holds the DOM and the decoder.
import { PREVIEW_SCREEN_CHUNK, SCREEN_TEXT_MAX, screenGesture, type ScreenGesture } from '../../protocol/preview.ts';

export type ScreenEntry = true; // lets a test `import type` this file so `tsc -p .` checks it

export const F_CONFIG = 1, F_KEY = 2, F_LAST = 0x80;
/** A packet larger than this is refused (a 1080p key frame is ~100-200 KB). */
export const SCREEN_PACKET_MAX = 4 * 1024 * 1024;
/** Above this many bytes queued on the channel, moves are dropped (a down/up/key is always sent). */
const MOVE_BUFFER_MAX = 64 * 1024;

export interface Packet { flags: number; data: Uint8Array }

/** Fragments -> packets. A fragment that does not fit (oversize) drops the packet being built. */
export class Reassembler {
  private parts: Uint8Array[] = [];
  private size = 0;
  private flags = 0;
  push(frag: Uint8Array): Packet | null {
    if (frag.length < 1 || frag.length > PREVIEW_SCREEN_CHUNK) return null;
    const f = frag[0], body = frag.subarray(1);
    if (!this.parts.length) this.flags = f & (F_CONFIG | F_KEY);
    this.size += body.length;
    if (this.size > SCREEN_PACKET_MAX) { this.parts = []; this.size = 0; return null; }
    this.parts.push(body);
    if (!(f & F_LAST)) return null;
    const data = new Uint8Array(this.size);
    let at = 0;
    for (const p of this.parts) { data.set(p, at); at += p.length; }
    this.parts = []; this.size = 0;
    return { flags: this.flags, data };
  }
}

/** `avc1.PPCCLL` from an Annex B config packet (first NAL = SPS), else null. */
export function avcCodec(config: Uint8Array): string | null {
  let i = 0;
  while (i + 3 < config.length && !(config[i] === 0 && config[i + 1] === 0 && config[i + 2] === 1)) i++;
  const s = i + 3;
  if (s + 3 >= config.length || (config[s] & 0x1f) !== 7) return null;
  const hex = (b: number) => b.toString(16).padStart(2, '0');
  return `avc1.${hex(config[s + 1])}${hex(config[s + 2])}${hex(config[s + 3])}`;
}

export interface Box { left: number; top: number; width: number; height: number }
/** A pointer at (cx, cy) on an element `box` showing a `vw` x `vh` picture letterboxed (object-fit: contain) ->
 *  [0, 1] coordinates of the picture, or null outside it. */
export function toUnit(cx: number, cy: number, box: Box, vw: number, vh: number, slack = 0): { x: number; y: number } | null {
  if (!(vw > 0 && vh > 0 && box.width > 0 && box.height > 0)) return null;
  const k = Math.min(box.width / vw, box.height / vh), w = vw * k, h = vh * k;
  const px = cx - box.left - (box.width - w) / 2, py = cy - box.top - (box.height - h) / 2;
  if (px < -slack || px > w + slack || py < -slack || py > h + slack) return null;
  const c = (v: number) => Math.min(1, Math.max(0, v));
  return { x: c(px / w), y: c(py / h) };
}
/** A finger put down this close (CSS px) outside the picture lands on its edge: pulling the notification shade starts at
 *  the very top, where a thumb often lands just outside. */
export const EDGE_SLACK = 24;
/** Same, clamped to the picture's edge: a swipe that leaves the picture keeps moving along its border. */
export function toUnitClamped(cx: number, cy: number, box: Box, vw: number, vh: number): { x: number; y: number } | null {
  if (!(vw > 0 && vh > 0 && box.width > 0 && box.height > 0)) return null;
  const k = Math.min(box.width / vw, box.height / vh), w = vw * k, h = vh * k;
  const c = (v: number) => Math.min(1, Math.max(0, v));
  return { x: c((cx - box.left - (box.width - w) / 2) / w), y: c((cy - box.top - (box.height - h) / 2) / h) };
}

/** Clipboard text as one typed string: line breaks and other control characters become spaces, cut to the limit. */
export const pasteText = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, SCREEN_TEXT_MAX);

const cat = (a: Uint8Array, b: Uint8Array) => { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };

/** Runs the screen on an open channel. `shown` once, at the first decoded picture; `fail('codec')` when this browser
 *  has no H.264 VideoDecoder. Returns `send` for the app's buttons (keys, text). */
export function startScreen(dc: RTCDataChannel, shown: () => void, fail: (code: 'codec') => void): (g: ScreenGesture) => void {
  const send = (g: ScreenGesture) => {
    const ok = screenGesture(g);
    if (!ok || dc.readyState !== 'open') return;
    if (ok.k === 'touch' && ok.a === 'move' && dc.bufferedAmount > MOVE_BUFFER_MAX) return;
    dc.send(JSON.stringify(ok));
  };
  const Dec = (globalThis as { VideoDecoder?: typeof VideoDecoder }).VideoDecoder;
  if (!Dec) { fail('codec'); return send; }
  // Layout: client/preview/viewer.css (a file: the preview origin's CSP is style-src 'self', an inline <style> is
  // ignored there; this is why the picture showed at its own size on the iPhone).
  document.documentElement.classList.add('screen');
  const ph = document.createElement('div');
  ph.className = 'stage wait';
  const cv = document.createElement('canvas');
  cv.width = 360; cv.height = 800; // placeholder ratio until the first picture
  ph.append(cv);
  document.body.append(ph);
  const g = cv.getContext('2d');
  let cfg: Uint8Array | null = null, codec = '', first = true, broken = false, asked = 0;
  const output = (f: VideoFrame) => {
    if (cv.width !== f.displayWidth || cv.height !== f.displayHeight) { cv.width = f.displayWidth; cv.height = f.displayHeight; }
    g?.drawImage(f, 0, 0); f.close();
    if (first) { first = false; ph.classList.remove('wait'); shown(); }
  };
  // A decode error closes the decoder (WebCodecs): make a new one, wait for a key frame and ask the agent for one.
  const make = (): VideoDecoder => new Dec({ output, error: () => { broken = true; cur = make(); if (codec) cur.configure({ codec, optimizeForLatency: true }); send({ k: 'reset' }); } });
  let cur = make();
  const rs = new Reassembler();
  let ts = 0;
  dc.binaryType = 'arraybuffer';
  dc.onmessage = (e) => {
    if (typeof e.data === 'string') return;
    const p = rs.push(new Uint8Array(e.data as ArrayBuffer));
    if (!p) return;
    if (p.flags & F_CONFIG) {
      cfg = p.data;
      const c = avcCodec(p.data);
      if (c && c !== codec) {
        codec = c;
        cur.configure({ codec: c, optimizeForLatency: true });
      }
      return;
    }
    // A packet before any config (the start missed): the encoder restarts on a config + key frame when asked.
    if (!codec) { const now = Date.now(); if (now - asked > 1000) { asked = now; send({ k: 'reset' }); } return; }
    if (cur.state !== 'configured') return;
    const key = !!(p.flags & F_KEY);
    if (broken && !key) return;
    if (key) broken = false;
    ts += 16_666;
    try { cur.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: ts, data: key && cfg ? cat(cfg, p.data) : p.data })); }
    catch { broken = true; send({ k: 'reset' }); }
  };
  void Dec.isConfigSupported({ codec: 'avc1.42c029' }).then((r) => { if (!r.supported) fail('codec'); }).catch(() => {});

  // Gestures: one finger. Coordinates of the decoded picture (letterboxed in the canvas).
  let down = false;
  const box = () => cv.getBoundingClientRect();
  cv.addEventListener('pointerdown', (e) => {
    const u = toUnit(e.clientX, e.clientY, box(), cv.width, cv.height, EDGE_SLACK);
    if (!u || down) return;
    down = true; cv.setPointerCapture(e.pointerId); e.preventDefault();
    send({ k: 'touch', a: 'down', ...u });
  });
  cv.addEventListener('pointermove', (e) => {
    if (!down) return;
    const u = toUnitClamped(e.clientX, e.clientY, box(), cv.width, cv.height);
    if (u) send({ k: 'touch', a: 'move', ...u });
  });
  const up = (e: PointerEvent) => {
    if (!down) return;
    down = false;
    const u = toUnitClamped(e.clientX, e.clientY, box(), cv.width, cv.height);
    if (u) send({ k: 'touch', a: 'up', ...u });
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('contextmenu', (e) => e.preventDefault());

  // Keyboard of a desktop (the phone's own keyboard is Android's, on the picture): printable keys are typed, Enter and
  // Backspace are keys, a paste (Cmd/Ctrl+V) types the clipboard's text. Escape is left to the page (nothing here).
  cv.tabIndex = 0;
  cv.addEventListener('pointerdown', () => cv.focus());
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    if (e.key === 'Enter') send({ k: 'key', key: 'enter' });
    else if (e.key === 'Backspace') send({ k: 'key', key: 'del' });
    else if (e.key.length === 1) send({ k: 'text', s: e.key });
    else return;
    e.preventDefault();
  });
  window.addEventListener('paste', (e) => {
    const s = pasteText(e.clipboardData?.getData('text/plain') ?? '');
    if (s) { e.preventDefault(); send({ k: 'text', s }); }
  });
  return send;
}
