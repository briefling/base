// Narrow screens (phone) and touch: DOM-free rules, tested in client/test/mobile.test.ts.
// Layout: below 700 px (the @media in style.css) the shell shows one pane at a time and the sidebar is a drawer;
// touch: a long press opens the menu of what the mouse gets on hover (card pin/archive, message reactions).

export type Pane = 'list' | 'conv' | 'full';
/**
 * Pane shown alone on a narrow screen: the conversation as soon as something is open (thread, topic, new-topic
 * composer), the list otherwise. Board and Settings have a single pane anyway.
 */
export function paneOf(isList: boolean, sel: string | null): Pane {
  return !isList ? 'full' : sel ? 'conv' : 'list';
}

/**
 * Back button of a conversation: through the browser history when the entry before is that list or that space's
 * Lounge (feed or a topic: a thread opened from a card there goes back to it, back gesture and button then agree, no
 * duplicate entry), otherwise by replacing the URL (opened from a link, a refresh, another space or Now).
 * `state` = history.state, `{ prev }` written by syncUrl on every push.
 */
export function backBy(state: unknown, listRoute: string): 'history' | 'replace' {
  const prev = state && typeof state === 'object' ? (state as { prev?: unknown }).prev : null;
  if (typeof prev !== 'string') return 'replace';
  const lounge = `${listRoute}/lounge`;
  return prev === listRoute || prev === lounge || prev.startsWith(`${lounge}/`) ? 'history' : 'replace';
}

export type CardAction = { kind: 'pin' | 'unpin' | 'unarchive' };
/**
 * Long-press menu of a list card: same actions as its hover menu. No Archive in lists (one slip of the pointer hid a
 * thread for the whole space): it stays in the thread header. Unarchive stays, it repairs a mistake.
 */
export function cardActions(f: { pinned: boolean; archived: boolean }): CardAction[] {
  const pin: CardAction = { kind: f.pinned ? 'unpin' : 'pin' };
  return f.archived ? [pin, { kind: 'unarchive' }] : [pin];
}

/** Hold time and finger travel of a long press (close to the platforms' own: ~500 ms, ~10 px). */
export const LONG_MS = 500, SLOP = 10;

/**
 * Touch long press, one at a time (one finger). `down` arms a timer, moving more than SLOP px or lifting cancels it.
 * `fireNow` = the platform's own long-press signal (Android `contextmenu`): fires at once if still armed.
 * The click that may follow a fired press is swallowed (`swallow`), otherwise the card would open under the menu;
 * `touchStart` (every new pointerdown, capture phase) forgets it so a later tap is never eaten.
 */
export function longPress<T>(timer: { set: (fn: () => void, ms: number) => T; clear: (t: T) => void }) {
  let armed: { x: number; y: number; t: T; fire: () => void } | null = null, fired = false;
  const cancel = () => { if (armed) timer.clear(armed.t); armed = null; };
  const fire = () => { const a = armed; if (!a) return; cancel(); fired = true; a.fire(); };
  return {
    touchStart() { fired = false; },
    down(x: number, y: number, fn: () => void) {
      cancel();
      const a = { x, y, fire: fn, t: undefined as unknown as T };
      armed = a; a.t = timer.set(fire, LONG_MS);
    },
    move(x: number, y: number) { if (armed && Math.hypot(x - armed.x, y - armed.y) > SLOP) cancel(); },
    up: cancel,
    fireNow: fire,
    /** A touch press is armed or just fired: the native callout / context menu must be prevented. */
    touching: () => !!armed || fired,
    swallow() { const f = fired; fired = false; return f; },
  };
}
