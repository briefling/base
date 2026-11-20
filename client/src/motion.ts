// Discreet motion (all ≤ 200 ms, none under prefers-reduced-motion): what the render may animate, decided here.
// - Arrival: a message or a card that patch() inserted into a part of the page already on screen fades in and rises
//   4 px. A whole pane put in (a conversation opened, another list) never animates: its nodes are not « inserted into a
//   kept parent ». A burst (history page, sync, filter switch) does not animate either: more than BURST of a kind in
//   one patch is a refresh, not an arrival.
// - Pop: a badge or an unread dot that appears (inserted, or lit on a kept element) scales up once.
// - View change (route, detail opened): a View Transition; on a phone, a lateral slide whose direction follows depth.
// Played with the Web Animations API, not a CSS class: the next render rewrites `class` on kept nodes (morphdom copies
// the attributes of the new tree), which would cut a class-driven animation midway.

export type Kind = 'arrive' | 'pop' | 'pop-dot';
export const BURST = 3;
export const ARRIVE_MS = 160, POP_MS = 180;

/** Kind of a node patch() inserted into a kept parent: messages (`m:`) and cards (`c:`), badges; null = no motion. */
export function insertedKind(key: string | null, tag: string, parentCls: string): Kind | null {
  if (key && (key.startsWith('m:') || key.startsWith('c:'))) return 'arrive';
  if (tag === 'b' && /(^|\s)nav(\s|$)|(^|\s)menu-btn(\s|$)/.test(parentCls)) return 'pop'; // count badge of a sidebar entry / the phone menu button
  if (key?.startsWith('pill:') || key?.startsWith('fab:')) return 'pop';                     // « new messages », « unread » pills
  return null;
}

const has = (cls: string, c: string) => cls.split(/\s+/).includes(c);
/** Kind of a kept element whose class changed: a sidebar badge leaving its empty `zero` look, a Lounge row turning unread. */
export function litKind(tag: string, from: string, to: string): Kind | null {
  if (tag === 'b' && has(from, 'zero') && !has(to, 'zero')) return 'pop';
  if (has(to, 'thread') && has(to, 'topic') && has(to, 'unread') && !has(from, 'unread')) return 'pop-dot';
  return null;
}

/** Drops every kind seen more than `burst` times in one patch (a refresh), keeps the rest in order. */
export function capBursts<T extends { kind: Kind }>(xs: T[], burst = BURST): T[] {
  const n = new Map<Kind, number>();
  for (const x of xs) n.set(x.kind, (n.get(x.kind) ?? 0) + 1);
  return xs.filter(x => (n.get(x.kind) ?? 0) <= burst);
}

/** Depth of a screen for the phone slide: 0 = a list or a page, 1 = a conversation or a detail opened from it. */
export type Screen = { key: string; depth: number };
/** Direction of a view change, or null when nothing changed (no transition). */
export function vtDir(prev: Screen | null, next: Screen): 'fwd' | 'back' | 'fade' | null {
  if (!prev || prev.key === next.key) return null; // first render: no transition
  return next.depth > prev.depth ? 'fwd' : next.depth < prev.depth ? 'back' : 'fade';
}

export const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const FRAMES: Record<Kind, Keyframe[]> = {
  arrive: [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }],
  pop: [{ transform: 'scale(.6)', opacity: 0 }, { transform: 'scale(1.12)', opacity: 1, offset: .6 }, { transform: 'none', opacity: 1 }],
  'pop-dot': [{ transform: 'scale(.3)' }, { transform: 'scale(1.2)', offset: .6 }, { transform: 'none' }],
};

/** Plays each motion once (skipped under reduced motion or without the API). */
export function play(xs: { el: Element; kind: Kind }[]) {
  if (!xs.length || reduced()) return;
  for (const { el, kind } of xs) {
    if (typeof el.animate !== 'function') return;
    try { el.animate(FRAMES[kind], { duration: kind === 'arrive' ? ARRIVE_MS : POP_MS, easing: 'ease-out', pseudoElement: kind === 'pop-dot' ? '::before' : undefined }); }
    catch { /* pseudo-element animation unsupported: no motion */ }
  }
}
