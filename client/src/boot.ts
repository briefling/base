/** First load of the app: when the splash leaves, and which spaces never answered. DOM-free (tested in node).
 *  The splash covers the app until the hub answered `subscribed` AND every space got its `synced`, shown at least
 *  MIN_SHOW ms (no flash). A space silent for TIMEOUT ms no longer holds it: the app shows, the space is marked
 *  « not loaded » until its `synced` arrives. A hub silent for TIMEOUT ms turns the splash into an error message;
 *  the splash stays and leaves on its own when the hub answers. Only the first load: reconnections never show it. */
export const MIN_SHOW = 1500, TIMEOUT = 10_000;

export type Boot = {
  start: number;
  /** First time each space showed in a `subscribed` answer: its own TIMEOUT starts there. */
  asked: Map<string, number>;
  synced: Set<string>;
  subscribed: boolean;
  /** The splash has left: never comes back (reconnections show the banner instead). */
  out: boolean;
};

export const newBoot = (now: number): Boot => ({ start: now, asked: new Map(), synced: new Set(), subscribed: false, out: false });

export function onSubscribed(b: Boot, spaces: string[], now: number) {
  b.subscribed = true;
  for (const s of spaces) if (!b.asked.has(s)) b.asked.set(s, now);
}
export const onSynced = (b: Boot, space: string) => { b.synced.add(space); };

/** Spaces of `spaces` asked more than TIMEOUT ago that never got a `synced`. */
export const unloaded = (b: Boot, spaces: Iterable<string>, now: number) =>
  [...spaces].filter(s => !b.synced.has(s) && b.asked.has(s) && now - b.asked.get(s)! >= TIMEOUT);

export type Splash =
  | { kind: 'wait' }          // splash up, loading
  | { kind: 'slow' }          // splash up, hub silent for TIMEOUT: error message, retries go on
  | { kind: 'leave' }         // take the splash down now
  | { kind: 'gone' };

export function splash(b: Boot, spaces: Iterable<string>, now: number): Splash {
  if (b.out) return { kind: 'gone' };
  if (!b.subscribed) return { kind: now - b.start >= TIMEOUT ? 'slow' : 'wait' };
  const pending = [...spaces].some(s => !b.synced.has(s) && !(b.asked.has(s) && now - b.asked.get(s)! >= TIMEOUT));
  return { kind: pending || now - b.start < MIN_SHOW ? 'wait' : 'leave' };
}

/** Delay until the next change `splash()` or `unloaded()` can see by time alone, null when nothing is pending
 *  (no timer left running once everything has answered). */
export function nextCheck(b: Boot, spaces: Iterable<string>, now: number): number | null {
  const at: number[] = [];
  if (!b.out) at.push(b.subscribed ? b.start + MIN_SHOW : b.start + TIMEOUT);
  for (const s of spaces) if (!b.synced.has(s) && b.asked.has(s)) at.push(b.asked.get(s)! + TIMEOUT);
  const next = at.filter(t => t > now);
  return next.length ? Math.min(...next) - now : null;
}
