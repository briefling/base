// Search palette (⌘K): the query, the hub's answer, the scope (space, period) and the recents shown while nothing
// is typed. Its own file since the modules refactor: main.ts keeps its state `P` (the search frames fill it) and
// shows `paletteEl()` while `P.open`. Built once at load, at the place the block had in main.ts, so its keydown
// listener keeps its order.
import type { Message, PublicThread, SearchHit } from '../../protocol/frames.ts';
import { searchTerms, searchable, SEARCH_MAX_Q, SEARCH_PERIODS, searchSince, type SearchPeriod } from '../../protocol/search.ts';
import type { Key } from './i18n.ts';
import type { RecentsModule } from './recentsview.ts';
import type { View } from './route.ts';
import { viewOf, pieces, moveSel } from './search.ts';
import type { UiKit } from './modules.ts';

/** The palette's state, kept in main.ts (the search frames fill it). */
export interface PaletteState {
  open: boolean; q: string; hits: SearchHit[]; threads: Map<string, PublicThread>; more: boolean; wait: boolean; sel: number; rs: number;
  all: boolean; period: SearchPeriod; asked: { scope: string; space: string | undefined; since: number | undefined };
}
/** The part of main.ts' app state the palette reads or writes. */
export interface PaletteShared {
  view: View; sel: string | null; err: string; drawer: boolean; menu: unknown;
  threads: Map<string, PublicThread>; msgs: Map<string, Map<string, Message>>; loaded: Set<string>;
  jump: { thread: string; msg: string; asked?: string } | null;
}
export interface PaletteDeps {
  rc(): RecentsModule;
  goRecent(f: PublicThread): void;
  upsertThread(f: PublicThread): void;
  loadHistory(thread: string): void;
  walkBack(thread: string, oldest: string | undefined): void;
  who(m: Message): string;
  profileOn(): boolean;
  closeProfile(): void;
  viewerOn(): boolean;
}

export function paletteModule(k: UiKit, S: PaletteShared, P: PaletteState, d: PaletteDeps) {
  const { h, icon, t, render, spaceName, send, since } = k;
  const { rc, goRecent, upsertThread, loadHistory, walkBack, who, profileOn, closeProfile, viewerOn } = d;
  // ---------------------------------------------------------------- search palette (⌘K)
  let searchTimer: number | undefined;
  /** Space the palette searches by default: the open one; none from Now (every space, like before). */
  const paletteSpace = () => S.view.kind === 'now' || S.view.kind === 'newspace' ? undefined : S.view.id;
  /** Space actually searched: none when « All projects » is on or no space is open. */
  const searchSpace = () => P.all ? undefined : paletteSpace();
  const searchScope = () => `${searchSpace() ?? ''}|${P.period}`;
  function openPalette() {
    P.open = true; P.all = false; P.period = 'all'; P.rs = 0; S.drawer = false; S.menu = null;
    // Last query kept; asked again only if the reset scope (or the open space) differs from its results'.
    if (searchable(searchTerms(P.q)) && searchScope() !== P.asked.scope) onQuery(P.q); else render();
    (document.querySelector('.palette input') as HTMLInputElement | null)?.select();
  }
  function closePalette() { P.open = false; window.clearTimeout(searchTimer); render(); }
  function onQuery(q: string, delay = 400) {
    P.q = q; window.clearTimeout(searchTimer);
    if (!searchable(searchTerms(q))) { P.hits = []; P.threads.clear(); P.more = false; P.wait = false; P.sel = -1; render(); return; }
    P.wait = true; render();
    // One hub search (a Scan of the table) per pause in typing, not per key; a scope change asks at once.
    searchTimer = window.setTimeout(() => {
      const space = searchSpace(), since = searchSince(P.period, Date.now());
      P.asked = { scope: searchScope(), space, since };
      if (!send({ type: 'search', q, ...(space ? { space } : {}), ...(since !== undefined ? { since } : {}) })) P.wait = false;
    }, delay);
  }
  const SEARCH_PERIOD_LABEL: Record<SearchPeriod, Key> = { '7d': 'metrics_7d', '30d': 'metrics_30d', '1y': 'search_1y', all: 'metrics_all' };
  /** Opens the result where its thread lives, loads the history back to the message, scrolls to it and flashes it. */
  function pick(x: SearchHit | undefined) {
    const f = x && P.threads.get(x.thread);
    if (!x || !f) return;
    upsertThread(f); // opened right below: render() marks it read
    P.open = false;
    S.view = { kind: viewOf(S.threads.get(f.id) ?? f), id: f.space }; S.sel = f.id; S.err = ''; S.drawer = false;
    S.jump = x.msg ? { thread: f.id, msg: x.msg } : null;
    if (!S.loaded.has(f.id)) loadHistory(f.id);
    else if (S.jump) walkBack(f.id, [...(S.msgs.get(f.id)?.keys() ?? [])].sort()[0]); // ids are time-sortable
    render();
  }
  function paletteEl() {
    const terms = searchTerms(P.q);
    // Nothing typed: the recents, flat (client/src/recentsview.ts); the first key typed goes back to the search.
    const blank = !P.q.trim(), flat = blank ? rc().flat(paletteSpace()) : [];
    const goFlat = (i: number) => { const x = flat[i]; if (!x) return; P.open = false; window.clearTimeout(searchTimer); goRecent(x.f); };
    const input = h('input', { type: 'search', value: P.q, placeholder: t('search_ph'), maxlength: SEARCH_MAX_Q, autocomplete: 'off', spellcheck: 'false', 'aria-label': t('search'),
      oninput: (e: Event) => { P.rs = 0; onQuery((e.target as HTMLInputElement).value); },
      onkeydown: (e: KeyboardEvent) => {
        if (e.isComposing) return;
        if (blank) {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); P.rs = moveSel(P.rs, flat.length, e.key === 'ArrowDown' ? 1 : -1); render(); document.querySelector('.rc-hit.on')?.scrollIntoView({ block: 'nearest' }); }
          else if (e.key === 'Enter') { e.preventDefault(); goFlat(P.rs); }
          else if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && /^[1-9]$/.test(e.key)) { e.preventDefault(); goFlat(Number(e.key) - 1); }
          else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
          return;
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); P.sel = moveSel(P.sel, P.hits.length, e.key === 'ArrowDown' ? 1 : -1); render(); document.querySelector('.pal-hit.on')?.scrollIntoView({ block: 'nearest' }); }
        else if (e.key === 'Enter') { e.preventDefault(); pick(P.hits[P.sel]); }
        else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
      } });
    if (blank) return h('div', { class: 'pal-wrap', 'data-k': 'palette' },
      h('div', { class: 'scrim', onclick: closePalette }),
      h('div', { class: 'palette', role: 'dialog', 'aria-label': t('search') },
        h('div', { class: 'pal-in' }, icon('search', 18) as unknown as Node, input),
        flat.length ? rc().flatEl(flat, Math.min(P.rs, flat.length - 1), goFlat, i => { P.rs = i; render(); }, !paletteSpace()) : null,
        h('div', { class: 'pal-foot' }, h('span', {}, ''), h('span', { class: 'pal-keys' }, t('rct_keys')))));
    const marked = (text: string) => pieces(text, terms).map(p => p.hit ? h('mark', {}, p.text) : document.createTextNode(p.text));
    const row = (x: SearchHit, i: number) => {
      const f = P.threads.get(x.thread);
      if (!f) return null;
      const where = h('span', { class: 'pal-where' }, spaceName(f.space), f.kind === 'topic' ? ` · ${t('lounge')}` : '');
      const meta = x.field === 'title' ? t('search_in_title') : `${who({ author: x.author } as Message)} · ${since(x.at)}${x.field === 'file' ? ` · ${t('search_in_file')}` : ''}`;
      return h('div', { class: `pal-hit ${i === P.sel ? 'on' : ''}`, 'data-k': `h:${x.thread}:${x.msg ?? ''}`, role: 'option', 'aria-selected': String(i === P.sel),
        onclick: () => pick(x), onmousemove: () => { if (P.sel !== i) { P.sel = i; render(); } } },
        icon(f.kind === 'topic' ? 'coffee' : 'thread', 16) as unknown as Node,
        h('div', { class: 'pal-main' },
          h('div', { class: 'pal-top' }, h('span', { class: 'pal-title' }, ...(x.field === 'title' ? marked(f.title) : [f.title])), where,
            f.archived ? h('span', { class: 'chip c-calm' }, t('archived_b')) : null),
          x.field !== 'title' ? h('div', { class: 'pal-snip' }, ...marked(x.snippet)) : null,
          h('div', { class: 'pal-meta' }, meta)));
    };
    const status = !searchable(terms) ? t('search_short') : P.wait ? t('search_wait') : !P.hits.length ? t('search_none') : P.more ? t('search_more') : '';
    // Scope row: « All projects » only when a space is open (from Now the search already covers every space), then the period.
    const rescope = (fn: () => void) => () => { fn(); onQuery(P.q, 0); (document.querySelector('.palette input') as HTMLInputElement | null)?.focus(); };
    const seg = (on: boolean, text: string, onclick: () => void, cls = '') =>
      h('button', { class: `${cls} ${on ? 'on' : ''}`.trim(), type: 'button', 'aria-pressed': String(on), onclick }, text);
    const scope = h('div', { class: 'pal-scope' },
      paletteSpace() ? h('div', { class: 'seg' }, seg(P.all, t('search_all'), rescope(() => { P.all = !P.all; }), 'pal-all')) : null,
      h('div', { class: 'seg pal-period', role: 'group', 'aria-label': t('metrics_period') },
        ...SEARCH_PERIODS.map(p => seg(P.period === p, t(SEARCH_PERIOD_LABEL[p]), rescope(() => { P.period = p; }), `p-${p}`))));
    return h('div', { class: 'pal-wrap', 'data-k': 'palette' },
      h('div', { class: 'scrim', onclick: closePalette }),
      h('div', { class: 'palette', role: 'dialog', 'aria-label': t('search') },
        h('div', { class: 'pal-in' }, icon('search', 18) as unknown as Node, input),
        scope,
        P.hits.length && searchable(terms) ? h('div', { class: 'pal-list', role: 'listbox' }, ...P.hits.map(row)) : null,
        h('div', { class: 'pal-foot' }, h('span', {}, status), h('span', { class: 'pal-keys' }, t('search_keys')))));
  }
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); if (P.open) closePalette(); else openPalette(); }
    else if (e.key === 'Escape' && P.open) closePalette();
    else if (e.key === 'Escape' && profileOn()) closeProfile();
    else if (e.key === 'Escape' && !viewerOn() && !(e.target instanceof HTMLTextAreaElement) && document.querySelector('.recents')) rc().close();
  });
  return { openPalette, paletteEl };
}
