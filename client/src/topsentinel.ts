// Infinite scroll up (Lounge feed, conversation): the top sentinel's observer and the scroll fix once a page lands
// above. iPhone loop (Nov 17): render() made a fresh IntersectionObserver every time, and a fresh observer reports at
// once a sentinel already near the top, so every render (each page landing) asked one more page. The scroll fix that
// normally pushes the sentinel out is ignored by WebKit during a fling's momentum, so the feed paged up its whole
// history on its own and froze under ever heavier renders.

/** The sentinel being watched (null: none on screen). */
export interface TopWatch { el: Element | null; root: Element | null; obs: IntersectionObserver | null }
export const newTopWatch = (): TopWatch => ({ el: null, root: null, obs: null });

/** Watch `el` (the top sentinel in `root`): `onIn` fires when it comes within 400 px of the top. The observer is kept
 *  while the sentinel is the same node (morphdom keeps it), so a page is asked only when the sentinel came back into
 *  view after leaving it, never again because a render ran while it sat in view. */
export function watchTop(w: TopWatch, el: HTMLElement | null, root: Element | null, onIn: () => void) {
  if (el && el === w.el && root === w.root) return;
  w.obs?.disconnect();
  w.el = el; w.root = root; w.obs = null;
  if (!el) return;
  w.obs = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) onIn(); }, { root, rootMargin: '400px 0px 0px 0px' });
  w.obs.observe(el);
}

/** Set a scroller's `scrollTop` so it holds on iOS: WebKit ignores (or overrides) a write made during a fling's
 *  momentum. `overflow: hidden` for the write stops the momentum (workaround discussed in bvaughn/react-window#122),
 *  given back on the next frame, the position written again if the momentum still moved it. */
export function pinScroll(sc: HTMLElement, top: number) {
  if (Math.abs(sc.scrollTop - top) < 1) return;
  sc.classList.add('scroll-pin');
  sc.scrollTop = top;
  requestAnimationFrame(() => {
    sc.classList.remove('scroll-pin');
    if (Math.abs(sc.scrollTop - top) >= 1) sc.scrollTop = top;
  });
}
