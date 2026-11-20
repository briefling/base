// Service worker (bundled to /sw.js, scope /). Two jobs only:
// 1. App shell, network first: online the app is always the deployed one; offline the shell still opens (then shows
//    « offline »). Never a message, an attachment or anything of another origin (offline reading is out of scope).
// 2. Web Push: shows « Your turn » when no briefling tab is visible and focused (that tab already alerts by itself),
//    a click opens the thread (focuses an open tab, or opens the app); sets the app icon badge from the payload's total.
import { NOTIF_CACHE, NOTIF_CHANNEL, NOTIF_KEY, SHELL, anyFocused, notificationOf, setBadge, shellKey, type BadgeNav, type NotifTarget } from './push.ts';

// Minimal service worker types (the project compiles against the DOM lib, not WebWorker).
interface ExtEvent extends Event { waitUntil(p: Promise<unknown>): void }
interface FetchEv extends ExtEvent { request: Request; respondWith(r: Promise<Response>): void }
interface PushEv extends ExtEvent { data: { json(): unknown } | null }
interface ClickEv extends ExtEvent { notification: Notification }
interface WinClient { focused: boolean; visibilityState: string; url: string; focus(): Promise<WinClient>; postMessage(m: unknown): void }
interface Scope {
  location: Location; registration: ServiceWorkerRegistration;
  clients: { matchAll(o: { type: 'window'; includeUncontrolled: boolean }): Promise<WinClient[]>; openWindow(url: string): Promise<unknown>; claim(): Promise<void> };
  skipWaiting(): Promise<void>; addEventListener(type: string, fn: (e: any) => void): void;
}
const sw = self as unknown as Scope;
const CACHE = 'shell-v1';

sw.addEventListener('install', (e: ExtEvent) => {
  // Best effort: a shell file missing at install must not block the worker (push matters more than offline).
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(SHELL.map(u => c.add(new Request(u, { cache: 'no-cache' }))))).then(() => sw.skipWaiting()));
});
sw.addEventListener('activate', (e: ExtEvent) => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== NOTIF_CACHE).map(k => caches.delete(k)))).then(() => sw.clients.claim()));
});

sw.addEventListener('fetch', (e: FetchEv) => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const key = shellKey(r.url, sw.location.origin, r.mode === 'navigate');
  if (!key) return; // not ours: the browser handles it as if there were no worker
  e.respondWith((async () => {
    try {
      const res = await fetch(r);
      if (res.ok && res.type === 'basic') { const copy = res.clone(); e.waitUntil(caches.open(CACHE).then(c => c.put(key, copy))); }
      return res;
    } catch (err) {
      const hit = await caches.match(key);
      if (hit) return hit;
      throw err;
    }
  })());
});

sw.addEventListener('push', (e: PushEv) => {
  e.waitUntil((async () => {
    let data: unknown = null;
    try { data = e.data?.json() ?? null } catch { /* not JSON: not ours */ }
    const n = notificationOf(data);
    if (!n) return;
    // Badge first, even when a tab is focused: that tab skips the notification, not the icon's count.
    if (n.badge !== undefined) await setBadge(navigator as BadgeNav, n.badge);
    if (anyFocused(await sw.clients.matchAll({ type: 'window', includeUncontrolled: true }))) return;
    await sw.registration.showNotification(n.title, { body: n.body, tag: n.tag, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url: n.url, thread: n.thread, space: n.space, ...(n.msg ? { msg: n.msg } : {}), ...(n.view ? { view: n.view } : {}) } });
  })());
});

sw.addEventListener('notificationclick', (e: ClickEv) => {
  e.notification.close();
  const d = e.notification.data as { url?: string; thread?: string; space?: string; msg?: string; view?: string } | null;
  const url = d?.url;
  if (!url || !url.startsWith('/#/')) return;
  e.waitUntil((async () => {
    const wins = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = wins.find(c => c.focused) ?? wins[0];
    // Message before focus: a refused focus() must not swallow it.
    if (w) { w.postMessage({ type: 'open', space: d!.space, thread: d!.thread, ...(d!.msg ? { msg: d!.msg } : {}), ...(d!.view ? { view: d!.view } : {}) }); await w.focus().catch(() => null); return; }
    // No window listed: iOS opens a closed installed app on start_url without the hash (WebKit 259212), and may list
    // no window for an app in the background, then openWindow brings it back without reloading it. The page reads
    // this target at start and when it comes back to the foreground.
    const target: NotifTarget = { space: d!.space ?? '', thread: d!.thread ?? '', ...(d!.msg ? { msg: d!.msg } : {}), ...(d!.view ? { view: d!.view } : {}), at: Date.now() };
    await caches.open(NOTIF_CACHE).then(c => c.put(NOTIF_KEY, new Response(JSON.stringify(target)))).catch(() => { /* the URL still carries it */ });
    // The app may even be on screen (iOS lists no window and shows the notification anyway): no reload, no focus or
    // visibility event, so tell any open page to read the stored target now (BroadcastChannel skips the client list).
    try { new BroadcastChannel(NOTIF_CHANNEL).postMessage('notif'); } catch { /* no BroadcastChannel: start/foreground reads remain */ }
    await sw.clients.openWindow(url); // a message link when the push named one: the app jumps to it on load
  })());
});
