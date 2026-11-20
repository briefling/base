// PWA + Web Push, pure parts (no DOM nor service worker globals: tested in client/test/push.test.ts).
// Used by main.ts (subscription of this device) and sw.ts (what the service worker shows and caches).
import type { PushPayload } from '../../protocol/frames.ts';
import { msgRoute } from './link.ts';
import { pinTokenOf } from '../../protocol/pinapp.ts';

/** VAPID public key (base64url, from the hub) -> the browser's applicationServerKey. */
export function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4));
  const out = new Uint8Array(new ArrayBuffer(b.length));
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}
/** The device's subscription was made with this key (false = rotated on the hub, or another person's: re-subscribe). */
export function sameKey(current: ArrayBuffer | null | undefined, b64: string): boolean {
  if (!current) return false;
  const a = new Uint8Array(current), b = b64urlToBytes(b64);
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Device state of Web Push for the bell: what main.ts should do on a connection or a click. */
export type PushPlan = 'off' | 'subscribe' | 'unsubscribe';
/**
 * on: the bell; supported: service worker + PushManager (iOS: only in the installed app); perm: Notification
 * permission; owner: the person this browser's subscription was made for (localStorage), me: who is signed in.
 * Another person's subscription on this browser is dropped first (it would keep receiving their threads' titles).
 */
export function pushPlan(on: boolean, supported: boolean, perm: string, hasSub: boolean, owner: string | null, me: string): PushPlan {
  if (!supported) return 'off';
  if (hasSub && owner !== null && owner !== me) return 'unsubscribe';
  if (on && perm === 'granted') return 'subscribe';
  return hasSub ? 'unsubscribe' : 'off';
}

/**
 * One-time « Turn on notifications » banner: in the installed app only (iOS gives push to it alone, and nothing there
 * shows the bell's tooltip), push supported, permission never asked (a reinstall resets it on iOS), alerts on, not
 * dismissed. Answering the browser's prompt changes the permission, so the banner goes by itself.
 */
/** Web Push belongs to briefling's own app: a pinned applet's app (`/a/<token>/`) has its own storage on iOS, so a
 *  subscription there is a second device and every notification came twice. */
export const pushApp = (path: string) => !pinTokenOf(path);

export const showAskBanner = (installed: boolean, supported: boolean, perm: string, alertsOn: boolean, dismissed: boolean) =>
  installed && supported && perm === 'default' && alertsOn && !dismissed;

/** Window clients of the service worker: a visible and focused tab already alerts (pop) by itself. */
export const anyFocused = (clients: readonly { focused: boolean; visibilityState: string }[]) => clients.some(c => c.focused && c.visibilityState === 'visible');

/** Decrypted push data -> the notification, null if it is not ours (shape checked: data from the network). */
export function notificationOf(data: unknown): { title: string; body: string; tag: string; url: string; thread: string; space: string; msg?: string; view?: 'memory' | 'radar' | 'reminders'; badge?: number } | null {
  const p = data as PushPayload | null;
  const str = (x: unknown, max: number): x is string => typeof x === 'string' && x.length > 0 && x.length <= max;
  if (!p || typeof p !== 'object' || !str(p.title, 200) || !str(p.body, 300) || !str(p.space, 64)) return null;
  // App icon badge (Your turn total): a bad value is dropped, the notification still shows.
  const badge = Number.isSafeInteger(p.badge) && p.badge! >= 0 && p.badge! <= BADGE_MAX ? { badge: p.badge! } : {};
  // Memory reminder: no thread, opens the space's Memory view; one per space, the newer replaces the older.
  if (p.view === 'memory') return { title: p.title, body: p.body, tag: `memory:${p.space}`, thread: '', space: p.space, view: 'memory', url: `/#/${encodeURIComponent(p.space)}/memory`, ...badge };
  // Strong Radar signal: opens the space's Radar view; one per space, the newer replaces the older.
  if (p.view === 'radar') return { title: p.title, body: p.body, tag: `radar:${p.space}`, thread: '', space: p.space, view: 'radar', url: `/#/${encodeURIComponent(p.space)}/radar`, ...badge };
  // A reminder due: opens the space's Reminders view; one notification per reminder title (two due at once both show).
  // With its source conversation (`thread`, `msg`: the card), it opens that conversation on the card instead.
  if (p.view === 'reminders' && !str(p.thread, 64)) return { title: p.title, body: p.body, tag: `reminders:${p.space}:${p.title}`, thread: '', space: p.space, view: 'reminders', url: `/#/${encodeURIComponent(p.space)}/reminders`, ...badge };
  if (!str(p.thread, 64)) return null;
  // tag = thread, like the open-tab Notification: one notification per thread, the newer replaces the older.
  // msg: the message it is about; the URL is then its message link (a new window jumps to it like a search result).
  const msg = notifMsg(p.msg), route = `#/${encodeURIComponent(p.space)}/${encodeURIComponent(p.thread)}`;
  return { title: p.title, body: p.body, tag: p.view === 'reminders' ? `reminders:${p.space}:${p.title}` : p.thread, thread: p.thread, space: p.space, url: `/${msg ? msgRoute(route, msg) : route}`, ...(msg ? { msg } : {}), ...badge };
}
/** Message id carried by a notification (push data, the service worker's `open` message): null when absent or bad. */
export const notifMsg = (x: unknown): string | null => typeof x === 'string' && x.length > 0 && x.length <= 64 ? x : null;
const BADGE_MAX = 99999;

/** Notification tapped while no window was open: what the service worker's `open` message would have carried.
 *  The worker stores it (Cache API, shared with the page) before `openWindow()`, because iOS opens an installed app
 *  that was closed on its `start_url`, without the URL's hash (WebKit bug 259212); the page reads it once at start. */
export interface NotifTarget { space: string; thread: string; msg?: string; view?: string; at: number }
export const NOTIF_CACHE = 'notif-v1', NOTIF_KEY = '/notif-target', NOTIF_TTL = 60_000, NOTIF_CHANNEL = 'briefling-notif';
/** Stored target -> the one to open, null when bad or older than NOTIF_TTL (an old tap must not move a later start). */
export function pendingTarget(raw: unknown, now: number): NotifTarget | null {
  const p = raw as Partial<NotifTarget> | null;
  const str = (x: unknown, max: number): x is string => typeof x === 'string' && x.length <= max;
  if (!p || typeof p !== 'object' || !str(p.space, 64) || !p.space || !str(p.thread, 64) || typeof p.at !== 'number') return null;
  if (!(now - p.at >= 0 && now - p.at < NOTIF_TTL)) return null;
  if (!p.thread && !str(p.view, 32)) return null;
  const msg = notifMsg(p.msg);
  return { space: p.space, thread: p.thread, ...(msg ? { msg } : {}), ...(str(p.view, 32) && p.view ? { view: p.view } : {}), at: p.at };
}

/** Badging API of the page or the service worker (`navigator`): Chrome/Edge installed app, Safari Dock web app, iOS 16.4+ home-screen app. */
export interface BadgeNav { setAppBadge?(n: number): Promise<void>; clearAppBadge?(): Promise<void> }
/** Sets the app icon badge to `n` (0 clears it). Nothing where the API is missing (Android, Firefox); never throws. */
export async function setBadge(nav: BadgeNav, n: number): Promise<void> {
  if (!nav.setAppBadge || !nav.clearAppBadge) return;
  try { await (n > 0 ? nav.setAppBadge(n) : nav.clearAppBadge()) } catch { /* permission not granted: no badge */ }
}

// App shell served by the service worker when the network fails (never a message, a file or config of another origin:
// the hub is a WebSocket, attachments live on the files bucket). Network first: online, the app is always the fresh one.
export const SHELL = ['/', '/app.js', '/style.css', '/favicon.svg', '/config.json', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];
/** Cache key of a same-origin GET, null when the service worker must not touch it. Navigations map to the index. */
export function shellKey(url: string, origin: string, navigate: boolean): string | null {
  let u: URL;
  try { u = new URL(url) } catch { return null }
  if (u.origin !== origin) return null;
  // a pinned applet's own app (`/a/<token>/`, protocol/pinapp.ts) is the same page: same shell, offline too
  if (navigate) return u.pathname === '/' || u.pathname === '/index.html' || pinTokenOf(u.pathname) ? '/' : null;
  return SHELL.includes(u.pathname) && u.pathname !== '/' ? u.pathname : null;
}
