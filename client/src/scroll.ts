// Where new content lands once render() keeps the DOM nodes (morphdom): DOM-free rules, tested in client/test.
// Conversation: newest at the bottom. Lists (threads, topics, Archived): newest at the top.

/** Distance (px) under which a scroller counts as at the bottom / at the top. */
export const NEAR = 48;

export const atBottom = (scrollTop: number, scrollHeight: number, clientHeight: number) => scrollHeight - scrollTop - clientHeight <= NEAR;

/**
 * Conversation after a render: stick to the bottom when the thread was just opened (or its history just arrived),
 * or when the reader was already at the bottom. Scrolled up in the history and a message arrives: stay put and
 * show the "New messages ↓" pill. Own send scrolls to the bottom on its own (see `go` in main.ts).
 * `older`: a page of older messages was just put above (infinite scroll up): keep the reader's place (anchor).
 */
export function convPlan(p: { opened: boolean; wasAtBottom: boolean; grew: boolean; older?: boolean }): 'bottom' | 'pill' | 'keep' | 'anchor' {
  if (p.older && !p.opened) return 'anchor';
  if (p.opened || p.wasAtBottom) return 'bottom';
  return p.grew ? 'pill' : 'keep';
}

/**
 * List after a render: true when an item that is new, or whose sort time changed, lands above the first card the
 * reader sees (they scrolled down): the "New ↑" pill. `before`: card key -> sort time of the list shown so far;
 * `after`: cards of the new list in order; `firstVisible`: key of the first visible card, null when at the top.
 */
export function newAbove(before: Map<string, string>, after: [key: string, at: string][], firstVisible: string | null): boolean {
  if (!firstVisible) return false;
  const i = after.findIndex(([k]) => k === firstVisible);
  return i > 0 && after.slice(0, i).some(([k, at]) => before.get(k) !== at);
}

/**
 * Phone shell sized to the visual viewport (`--vvh`): the page itself must never stay scrolled. iOS pans it on focus
 * to lift the field above the keyboard (`visualViewport.offsetTop` and/or `scrollY` > 0); once the shell has shrunk to
 * the visible height, that leftover pan shows the empty space under the page and the composer jumps to the top.
 * Pinch-zoomed (`scale` > 1): the pan is the reader's, leave it.
 */
export const pagePanned = (v: { scale: number; offsetTop: number; scrollY: number }) =>
  v.scale <= 1.01 && (v.offsetTop >= 1 || v.scrollY >= 1);

/**
 * Phone shell still sized for a keyboard that is gone (iOS installed app, back from the background: a black band the
 * height of the keyboard under the composer). WebKit can keep `innerHeight` / `visualViewport.height` shrunk until a
 * reflow forces it to measure again (WebKit bug 237961). Stuck = no field is being typed in (so no keyboard should be
 * up) and the visible height is clearly below the tallest one seen at this width (`tallest`, so rotation is its own
 * case). A few px of slack: the home indicator and rounding move the height a little on their own.
 */
export const viewportStuck = (v: { typing: boolean; height: number; tallest: number }) => !v.typing && v.tallest - v.height > 4;

/**
 * Virtual keyboard up: a field is being typed in AND the visible height is well below the tallest one seen at this
 * width (a hardware keyboard or a desktop focus leaves it whole). 120 px: more than the home indicator or a toolbar
 * sliding, less than any phone keyboard (~250 px and up).
 */
export const keyboardUp = (v: { typing: boolean; height: number; tallest: number }) => v.typing && v.tallest - v.height > 120;

/** Delays (ms) of the height re-reads after a return to the app: iOS reports the final size late, sometimes after 300 ms. */
export const WAKE_MS = [100, 400, 900];
