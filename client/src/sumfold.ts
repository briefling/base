// Summary card folds when the human scrolls up in a thread's messages (the open Summary is in the way when going
// back through the conversation). Only a human gesture counts (wheel, finger), never the `scroll` event: the app
// scrolls by itself (older pages loaded on top, the iPhone loop of topsentinel.ts) and must not fold it. Nothing
// reopens it; the chevron does, and it stays open until the next upward gesture.

/** Upward travel (px) of one gesture before the Summary folds: a small nudge or a trackpad wobble does not. */
export const FOLD_UP_PX = 40;
/** A wheel pause longer than this starts a new gesture (a trackpad sends many small events per swipe). */
export const WHEEL_GAP_MS = 300;

/** Pixels of a wheel event (`deltaMode` 1 = lines, 2 = pages); negative = up. */
export function wheelPx(deltaY: number, deltaMode: number): number {
  return deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 800 : deltaY;
}

/** Upward travel of one gesture: `up(px)` adds a step (positive = towards older messages), true once past the threshold. */
export function upTracker(threshold = FOLD_UP_PX) {
  let acc = 0;
  return {
    /** A step of the gesture; a step down cancels what was gathered, a zero step changes nothing. */
    up(px: number): boolean {
      acc = px < 0 ? 0 : acc + px;
      return acc >= threshold;
    },
    reset() { acc = 0; },
  };
}

/** What a click acts on, so it must not fold: the list would jump under the action. Thumbnails are links, choice and ask
 *  cards are `.ask`; the Summary itself folds only through its chevron. */
export const CLICK_KEEPS = 'a, button, input, textarea, select, label, summary, details, video, audio, [role="button"], [tabindex], [contenteditable], .ask, .sumcard';

/** A click in a thread's messages folds the Summary, unless it lands on something active or ends a text selection. */
export function clickFolds(target: Pick<Element, 'closest'> | null, selection: string): boolean {
  return !!target && !!target.closest('.conv.work .msgs') && !target.closest(CLICK_KEEPS) && !selection;
}

/** Wires the gesture listeners once on the document; `fold` runs on an upward gesture or a plain click inside a thread's
 *  messages. The click folds on `click`, never on pointerdown: nothing moves before the action of the tap is done. */
export function installSummaryFold(fold: () => void, now: () => number = () => Date.now()): void {
  const tr = upTracker();
  let lastWheel = 0, touchY: number | null = null, done = false;
  const inMsgs = (t: EventTarget | null) => t instanceof Element && !!t.closest('.conv.work .msgs');
  const step = (px: number) => { if (!done && tr.up(px)) { done = true; fold(); } };
  const start = () => { tr.reset(); done = false; };
  document.addEventListener('wheel', (e: WheelEvent) => {
    if (!inMsgs(e.target) || e.ctrlKey) return; // Ctrl + wheel = pinch zoom
    const t = now();
    if (t - lastWheel > WHEEL_GAP_MS) start();
    lastWheel = t;
    step(-wheelPx(e.deltaY, e.deltaMode));
  }, { passive: true, capture: true });
  document.addEventListener('touchstart', (e: TouchEvent) => {
    touchY = e.touches.length === 1 && inMsgs(e.target) ? e.touches[0].clientY : null;
    start();
  }, { passive: true, capture: true });
  document.addEventListener('touchmove', (e: TouchEvent) => {
    if (touchY === null || e.touches.length !== 1) return;
    const y = e.touches[0].clientY;
    step(y - touchY); // finger going down = content going up, towards older messages
    touchY = y;
  }, { passive: true, capture: true });
  document.addEventListener('touchend', () => { touchY = null; }, { passive: true, capture: true });
  document.addEventListener('click', (e: MouseEvent) => {
    if (e.target instanceof Element && clickFolds(e.target, String(window.getSelection() ?? ''))) fold();
  }, { passive: true });
}
