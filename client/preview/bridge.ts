// postMessage contract between the app (parent, client/src/main.ts) and the viewer page (iframe on the PREVIEW
// origin, client/preview/viewer.ts), plus the service worker's pure rules. Pure module, bundled by both sides.
//
// Security gates (protocol/preview.ts, docs of the feature):
// - The viewer accepts a message only from `window.parent` AND from an origin listed in the preview origin's
//   `/config.json` `parents` (`fromParent`). The app accepts one only from the overlay iframe's `contentWindow` AND
//   from the preview origin of its own `/config.json` `previewUrl` (`fromViewer`). Both post with an explicit
//   targetOrigin, never '*'.
// - Only the session's signaling crosses (ICE servers, SDP, candidates, states): never a token, a session id or
//   anything of the app. The previewed page is same-origin with the viewer, so it can read all of it.
//
// Messages, every one tagged `bp: 1` (anything else is ignored):
//   app -> viewer   {bp:1, type:'ready', ice: IceServer[], screen?: true}  hub preview.ready (TURN credentials; a screen share)
//                   {bp:1, type:'gesture', g: ScreenGesture}               a screen button of the app (key, text): to the channel
//                   {bp:1, type:'answer', sdp}                             hub preview.answer
//                   {bp:1, type:'candidate', candidate, mid}               hub preview.candidate ('' = end of candidates)
//                   {bp:1, type:'failed', code}                            hub preview.failed / error: stop the peer
//   viewer -> app   {bp:1, type:'hello'}                                   listening (the app holds messages until then)
//                   {bp:1, type:'offer', sdp}                              complete offer -> hub preview.offer
//                   {bp:1, type:'open'}                                    data channel open
//                   {bp:1, type:'loaded'}                                  previewed page `load`
//                   {bp:1, type:'failed', code: ViewerError}               the viewer gave up
//                   {bp:1, type:'closed'}                                  the channel closed after it was open
import { screenGesture, type IceServer, type ScreenGesture } from '../../protocol/preview.ts';

/** channel: ICE/data channel did not open (or failed); sw: no service worker; config: the viewer refused its parent;
 *  codec: no H.264 VideoDecoder (WebCodecs) for a screen share. */
export const VIEWER_ERRORS = ['channel', 'sw', 'config', 'codec'] as const;
export type ViewerError = typeof VIEWER_ERRORS[number];

export type ToViewer =
  | { bp: 1; type: 'ready'; ice: IceServer[]; screen?: true }
  | { bp: 1; type: 'gesture'; g: ScreenGesture }
  | { bp: 1; type: 'answer'; sdp: string }
  | { bp: 1; type: 'candidate'; candidate: string; mid: string | null }
  | { bp: 1; type: 'failed'; code: string };
export type FromViewer =
  | { bp: 1; type: 'hello' | 'open' | 'loaded' | 'closed' }
  | { bp: 1; type: 'offer'; sdp: string }
  | { bp: 1; type: 'failed'; code: ViewerError };

/** What a MessageEvent offers to the checks (structural, so the tests need no DOM). */
export interface MsgLike { origin: string; source: unknown; data: unknown }

/** Viewer side: from our parent window, at an allowed app origin. `parentWin === self` (not framed) never passes. */
export function fromParent(e: MsgLike, parents: readonly string[], parentWin: unknown, self: unknown): boolean {
  return !!parentWin && parentWin !== self && e.source === parentWin && parents.includes(e.origin);
}
/** App side: from the overlay iframe's window, at the preview origin. */
export function fromViewer(e: MsgLike, previewOrigin: string | null, frameWin: unknown): boolean {
  return !!previewOrigin && !!frameWin && e.source === frameWin && e.origin === previewOrigin;
}

const str = (x: unknown, max: number): x is string => typeof x === 'string' && x.length <= max;
const iceOk = (x: unknown): x is IceServer[] => Array.isArray(x) && x.length <= 16 && x.every(s => !!s && typeof s === 'object'
  && Array.isArray(s.urls) && s.urls.every((u: unknown) => str(u, 512)) && (s.username === undefined || str(s.username, 512))
  && (s.credential === undefined || str(s.credential, 512)));

/** A well-formed app -> viewer message, else null. */
export function toViewer(d: unknown): ToViewer | null {
  const o = d as Record<string, unknown>;
  if (!o || typeof o !== 'object' || o.bp !== 1) return null;
  if (o.type === 'ready' && iceOk(o.ice)) return o.screen === true ? { bp: 1, type: 'ready', ice: o.ice, screen: true } : { bp: 1, type: 'ready', ice: o.ice };
  if (o.type === 'gesture') { const g = screenGesture(o.g); return g ? { bp: 1, type: 'gesture', g } : null; }
  if (o.type === 'answer' && str(o.sdp, 65536)) return { bp: 1, type: 'answer', sdp: o.sdp };
  if (o.type === 'candidate' && str(o.candidate, 2048) && (o.mid === null || str(o.mid, 64))) return { bp: 1, type: 'candidate', candidate: o.candidate, mid: o.mid };
  if (o.type === 'failed' && str(o.code, 64)) return { bp: 1, type: 'failed', code: o.code };
  return null;
}
/** A well-formed viewer -> app message, else null. */
export function fromViewerMsg(d: unknown): FromViewer | null {
  const o = d as Record<string, unknown>;
  if (!o || typeof o !== 'object' || o.bp !== 1) return null;
  if (o.type === 'hello' || o.type === 'open' || o.type === 'loaded' || o.type === 'closed') return { bp: 1, type: o.type };
  if (o.type === 'offer' && str(o.sdp, 65536)) return { bp: 1, type: 'offer', sdp: o.sdp };
  if (o.type === 'failed' && (VIEWER_ERRORS as readonly unknown[]).includes(o.code)) return { bp: 1, type: 'failed', code: o.code as ViewerError };
  return null;
}

// ---------------------------------------------------------------- service worker rules
/** Paths the service worker never intercepts: the viewer's own files, itself, the preview origin's config. */
export const swBypass = (path: string) => path.startsWith('/__viewer/') || path === '/sw.js' || path === '/config.json';

/** Cached in Cache Storage only when `cache-control` carries the `immutable` directive (hashed build assets). */
export function immutable(cacheControl: string | null | undefined): boolean {
  return !!cacheControl && cacheControl.toLowerCase().split(',').some(d => d.trim() === 'immutable');
}

/** Preview key (agent + port): names the cache, so two previews never share entries. */
export const previewKey = (agent: string, port: number) => `${agent.toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 40)}-${port}`;
export const cacheName = (key: string) => `preview-${key}`;
/** Key carried in the viewer URL's hash (`#key=<key>`), or null. */
export function keyOfHash(hash: string): string | null {
  const m = /(?:^#|&)key=([a-z0-9_-]{1,40}-\d{1,5})(?:&|$)/.exec(hash);
  return m ? m[1] : null;
}
