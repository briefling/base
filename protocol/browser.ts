// Live thumbnail of the agent's browser: while an agent drives the Hermes browser tool, its plugin
// sends a small JPEG capture of the page after each browser action (at most one per BROWSER_MIN_MS, only when the
// image changed). The hub relays it to the human connections that have that conversation on screen (`browser.watch`),
// writes nothing for it, and tells the agent when nobody watches (`browser.watchers` n = 0) so the plugin stops
// capturing for BROWSER_IDLE_MS. The client shows it in the conversation's working line and drops it at the turn's
// end, at `end`, or BROWSER_STALE_MS after the last capture. Out of scope: video, control of the browser, history.

/** Base64 length cap of one capture: ~67 KB of JPEG, far below API Gateway's 128 KB frame with the envelope. */
export const BROWSER_JPEG_MAX = 90_000;
/** Plugin: at most one capture per this delay for a conversation. */
export const BROWSER_MIN_MS = 1_000;
/** Plugin: after « nobody watches », no capture for that long (a viewer who opens the conversation waits at most this). */
export const BROWSER_IDLE_MS = 10_000;
/** Client: a capture older than this (no newer one, no end) is dropped: navigation stopped. */
export const BROWSER_STALE_MS = 30_000;
/** No new capture for this long: the client shows the thumbnail as still (slower, paler glow), the « Live » badge stays. */
export const BROWSER_STILL_MS = 5_000;

/** One capture as the hub relays it (`browser.frame` event). `end`: the agent closed its browser, no image. */
export interface BrowserFrame { thread: string; agent: string; at: number; jpeg?: string; w?: number; h?: number; end?: true }

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const dim = (x: unknown) => x === undefined || (Number.isSafeInteger(x) && (x as number) > 0 && (x as number) <= 4096);

/** Hub: the agent's frame is well formed (a capture or an end, never both). */
export function browserFrameOk(f: any): boolean {
  if (!Number.isSafeInteger(f?.at) || f.at <= 0) return false;
  if (f.end === true) return f.jpeg === undefined;
  return typeof f.jpeg === 'string' && f.jpeg.length > 0 && f.jpeg.length <= BROWSER_JPEG_MAX && f.jpeg.length % 4 === 0
    && B64.test(f.jpeg) && dim(f.w) && dim(f.h);
}

/** Client: the capture to keep for a conversation, `next` arriving while `cur` is shown. Frames may arrive out of order:
 *  the most recent by `at` wins; an end newer than the capture removes it (null). */
export function keepFrame(cur: BrowserFrame | undefined, next: BrowserFrame): BrowserFrame | null {
  if (cur && cur.at >= next.at) return cur;
  return next.end ? null : next;
}

/** Client: the capture to show now, or null (none, stale, or the agent no longer works in the conversation). */
export function shownFrame(f: BrowserFrame | undefined, got: number, now: number, working: boolean): BrowserFrame | null {
  return f && !f.end && working && now - got < BROWSER_STALE_MS ? f : null;
}
