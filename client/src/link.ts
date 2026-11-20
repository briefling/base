// « Copy link »: a thread link is its route (`#/<space>/<thread>`); a message link adds `/m/<msg>`, and opening it
// jumps to the message like a search result. DOM-free, tested in client/test/link.test.ts.

/** Route of a message: the thread route + `/m/<msg>`. */
export function msgRoute(threadRoute: string, msg: string): string {
  return `${threadRoute}/m/${encodeURIComponent(msg)}`;
}

/** Splits the `/m/<msg>` suffix off a route (it needs a space and a thread before it); any other route comes back
 *  unchanged with no message, so every older link keeps parsing as before. */
export function splitMsg(hash: string): { route: string; msg: string | null } {
  const m = /^(#\/[^/]+\/(?:[^/]+\/)?[^/]+)\/m\/([^/]+)\/?$/.exec(hash);
  if (!m) return { route: hash, msg: null };
  try { return { route: m[1], msg: decodeURIComponent(m[2]) || null }; } catch { return { route: m[1], msg: null }; }
}

/** Absolute URL of a route on the page the app runs from (what gets copied). */
export function linkUrl(loc: { origin: string; pathname: string }, route: string): string {
  return `${loc.origin}${loc.pathname}${route}`;
}
