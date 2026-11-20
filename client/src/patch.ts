// render() builds a fresh tree on every state change; `patch` diffs it into the live DOM with morphdom (MIT,
// https://github.com/patrick-steele-idem/morphdom), so unchanged nodes survive: scroll, text selection, focus, caret.
//
// Two rules follow from keeping the old nodes:
// - Event handlers: morphdom copies attributes, not listeners. Every handler goes through `on()` (h() uses it), which
//   records it per element; patch hands the new tree's handlers to the kept node, so a click always runs the closure
//   of the latest render (fresh thread version, right row), never a stale one.
// - Element references: a closure of the latest render holds the NEW element, which morphdom may have discarded in
//   favour of the old one. Resolve it with `cur(el)` before reading or touching it (textarea value, focus, click).
// Keys: an element with `data-k` only morphs into the old element with the same key (panes per route and thread,
// cards per thread, messages per id): switching thread gives a fresh composer, a new card is inserted, not rewritten.
import morphdomModule from 'morphdom';

// The package's types are CommonJS (`export default` = `.default` under nodenext), while esbuild bundles its ESM
// build (`module` field), whose default export is the function itself: accept both.
const morphdom = (morphdomModule as unknown as { default?: typeof morphdomModule.default }).default ?? (morphdomModule as unknown as typeof morphdomModule.default);

type Fn = (e: any) => unknown;
const handlers = new WeakMap<EventTarget, Map<string, Fn[]>>(); // `type` (bubble) or `type!` (capture) -> handlers
function bubble(this: EventTarget, e: Event) { for (const fn of handlers.get(this)?.get(e.type) ?? []) fn(e); }
function capture(this: EventTarget, e: Event) { for (const fn of handlers.get(this)?.get(`${e.type}!`) ?? []) fn(e); }

/** addEventListener that survives patch(): the kept node runs the handlers of the latest render. */
export function on(el: EventTarget, type: string, fn: Fn, useCapture = false) {
  let m = handlers.get(el);
  if (!m) handlers.set(el, m = new Map());
  const k = useCapture ? `${type}!` : type;
  m.set(k, [...(m.get(k) ?? []), fn]);
  el.addEventListener(type, useCapture ? capture : bubble, useCapture); // same function: added once per type
}

function takeHandlers(from: Element, to: Element) {
  const m = handlers.get(to) ?? new Map<string, Fn[]>();
  handlers.set(from, m); // types the new tree no longer has: their dispatcher finds nothing and does nothing
  for (const k of m.keys()) { const c = k.endsWith('!'); from.addEventListener(c ? k.slice(0, -1) : k, c ? capture : bubble, c); }
}

const kept = new WeakMap<Element, Element>(); // new element -> live element it was merged into
/** The element actually in the page for an element built by the latest render. */
export const cur = <T extends Element>(el: T): T => (kept.get(el) as T | undefined) ?? el;

const keyOf = (n: Node) => (n as Element).getAttribute?.('data-k') || undefined;
// morphdom handles a NEW keyed child badly: it walks past every old keyed sibling, appends the new one at the end, then
// moves every old sibling after it (each move loses the selection inside it and defeats scroll anchoring). So before
// a parent's children are diffed, an empty placeholder with the new key is put where the new child goes; morphdom
// then matches it in place and fills it. Rule that goes with it: in a keyed list, key every child (headers too),
// otherwise an unkeyed new child hits the same slow path.
function placeNew(from: Element, to: Element, live: Set<string>, fresh: WeakSet<Node>, out: Change) {
  const here = new Map<string, Element>();
  for (const c of from.children) { const k = keyOf(c); if (k) here.set(k, c); }
  for (const c of to.children) {
    const k = keyOf(c);
    if (!k || live.has(k)) continue; // already somewhere in the page: morphdom finds and moves it
    let at: Element | null = null;
    for (let n = c.nextElementSibling; n && !at; n = n.nextElementSibling) at = here.get(keyOf(n) ?? '') ?? null;
    const ph = document.createElementNS(c.namespaceURI, c.localName);
    ph.setAttribute('data-k', k);
    ph.setAttribute('data-ph', ''); // dropped by morphAttrs once filled; any left unmatched is removed after the diff
    from.insertBefore(ph, at);
    live.add(k);
    fresh.add(ph);
    if (!fresh.has(from)) out.added.push(ph); // a new node in a part of the page already on screen (filled in place)
  }
}

/** What a patch changed that motion may show: nodes inserted into a kept parent (not inside an inserted subtree), and
 * kept elements whose class changed (`was` = the old class). */
export type Change = { added: Element[]; restyled: { el: Element; was: string }[] };

/** Replaces the children of `root` with `kids`, keeping every node that did not change. */
export function patch(root: HTMLElement, ...kids: Node[]): Change {
  const next = root.cloneNode(false) as HTMLElement;
  next.append(...kids);
  const live = new Set([...root.querySelectorAll('[data-k]')].map(e => e.getAttribute('data-k')!));
  const fresh = new WeakSet<Node>(), out: Change = { added: [], restyled: [] };
  morphdom(root, next, {
    childrenOnly: true,
    getNodeKey: keyOf,
    // `data-keep`: a host whose children live outside the render (the docked voice panel): never diffed.
    onBeforeElChildrenUpdated(from, to) { if (from.hasAttribute('data-keep')) return false; placeNew(from, to, live, fresh, out); return true; },
    onNodeAdded(node) {
      if (node.nodeType === 1 && !fresh.has(node.parentNode!)) out.added.push(node as Element);
      fresh.add(node);
      return node;
    },
    onBeforeElUpdated(from, to) {
      // A summary folded by the reader stays folded (the tree always builds it open).
      if (from instanceof HTMLDetailsElement) (to as HTMLDetailsElement).open = from.open;
      takeHandlers(from, to);
      kept.set(to, from);
      if (!fresh.has(from)) { const was = from.getAttribute('class') ?? ''; if (was !== (to.getAttribute('class') ?? '')) out.restyled.push({ el: from, was }); }
      return true;
    },
  });
  // A placeholder morphdom did not use (e.g. an unkeyed sibling came first) is not in its keyed lookup: remove it here.
  for (const ph of root.querySelectorAll('[data-ph]')) ph.remove();
  out.added = out.added.filter(e => e.isConnected); // unused placeholders, nodes dropped later in the same diff
  return out;
}
