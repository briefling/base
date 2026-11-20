// « Recents »: the topics of a space on a rail, their threads as branches (client/src/recents.ts), in a
// pane on the right on a wide screen and a bottom sheet on a phone, opened by the Recents button of the Lounge header
// (it replaces the « Topics only » switch). Also the flat list ⌘K shows while nothing is typed. Same UiKit as the
// module views, plus what only main.ts knows (thread states, unread marks, how a conversation opens).
import type { PublicThread } from '../../protocol/frames.ts';
import { nowTree, RECENTS_FILTERS, rowClass, recentsFlat, recentsTags, recentsTree, recentsUnread, tagHue, tagTerms, tagsOf, toggleTag, type FlatRecent, type RecentRow, type RecentsFilter } from './recents.ts';
import { topicName } from './lounge.ts';
import type { RowMark } from './spawned.ts';
import type { Key } from './i18n.ts';
import type { UiKit } from './modules.ts';

/** What main.ts lends the pane besides the kit. */
export interface RecentsHost {
  threads(): Iterable<PublicThread>;
  unread(f: PublicThread): boolean;
  /** State mark of the feed's checklist (done, in progress, my turn, idle), from the state as shown. */
  mark(f: PublicThread): RowMark;
  /** Moving now as shown: in progress, my turn, waiting. */
  active(f: PublicThread): boolean;
  /** The words of a thread line of the feed (« Your turn », « Milan working »), null = none. */
  label(f: PublicThread): HTMLElement | null;
  /** Full state, for the tooltip of a mark. */
  say(f: PublicThread): string;
  /** Opens the conversation where it lives (a topic in the Lounge, a thread next to it). */
  go(f: PublicThread): void;
  /** The new-topic composer of the space (a topic without a Bar message: « + Topic » lived in « Topics only »). */
  newTopic(space: string): void;
  sel(): string | null;
  narrow(): boolean;
  /** More thread pages to load in the space, and the request of the next one. */
  more(space: string): boolean;
  loadMore(space: string): void;
}

export interface RecentsModule {
  /** Lounge header button, with the unread count of the pane. */
  button(space: string): HTMLElement;
  /** The list pane of a space whose « general » module is off: the same tree, always there (no close button). */
  inline(space: string): HTMLElement[];
  /** The pane (wide) or sheet (phone) when open on this space, else null. */
  pane(space: string | undefined): HTMLElement | null;
  /** The wide pane is on screen (the shell keeps a column for it). */
  docked(space: string | undefined): boolean;
  close(): void;
  /** After a render: pages more threads when the bottom of the pane shows. */
  watch(): void;
  /** ⌘K with nothing typed: the rows, then their list. */
  flat(space: string | undefined): FlatRecent[];
  /** The Now view: the tree of every space, Active only, my turns first (client/src/recents.ts `nowTree`). */
  nowEl(o: NowHooks): HTMLElement;
  /** `keys`: the ⌘1…9 hint of each row (⌘K only: the switcher's rows open on release). */
  flatEl(items: FlatRecent[], sel: number, pick: (i: number) => void, hover: (i: number) => void, allSpaces: boolean, keys?: boolean): HTMLElement;
}

/** What only the Now list adds to a row (main.ts): its owner's turn, the card's chips and its menu. */
export interface NowHooks {
  /** My turn (turnof.ts `myTurn`): bold, and its branch first. */
  mine(f: PublicThread): boolean;
  /** The spaces I muted (client/src/mute.ts): only my turns of them show. */
  muted?: ReadonlySet<string>;
  /** Lines under a thread's title: board column, « Holds a slot », « I am waiting for: … » (none = nothing). */
  extra(f: PublicThread): (Node | null)[];
  /** Hover menu of the row (Pin, Release), and the long-press attributes of the phone. */
  menu(f: PublicThread): HTMLElement | null;
  press(f: PublicThread): Record<string, unknown>;
  /** Shown above the tree (exchanges due to a lead), and the line when nothing is there at all. */
  top: HTMLElement | null;
}

/** ⌘ on Apple keyboards, Ctrl elsewhere (the shortcut accepts both). */
const MOD = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl ';
const FILTER_LABEL: Record<RecentsFilter, Key> = { all: 'rct_f_all', active: 'rct_f_active', unread: 'rct_f_unread' };

export function recentsModule(k: UiKit, host: RecentsHost): RecentsModule {
  const { h, t, tn, icon, render, ago, spaceName } = k;
  const R = { open: '', filter: 'all' as RecentsFilter, q: '' };
  let obs: IntersectionObserver | null = null;
  const close = () => { R.open = ''; render(); };
  const toggle = (space: string) => { R.open = R.open === space ? '' : space; render(); };
  const opts = (filter: RecentsFilter, q: string) => ({ filter, q, unread: host.unread, active: host.active });

  /** Round node of a row: a topic is its bubble in a ring, a thread the feed's state mark. */
  const node = (f: PublicThread, cls: string) => f.kind === 'topic'
    ? h('span', { class: `rc-n rc-topic ${cls}` }, icon('messageCircle', 12) as unknown as Node)
    : h('span', { class: `rc-n fc-mark m-${host.mark(f)} ${cls}`, role: 'img', 'aria-label': host.say(f), title: host.say(f) },
      ...(host.mark(f) === 'later' ? [icon('later', 13) as unknown as Node] : host.mark(f) === 'archived' ? [icon('archive', 13) as unknown as Node] : []));  // Later = the clock of its entry, archived = the archive box
  /** Lines of the graph: classes only (no inline style: the CSP refuses it), one column per depth. */
  const gutter = (r: RecentRow, first: boolean) => h('span', { class: `rc-g g${r.depth}`, 'aria-hidden': 'true' },
    ...r.rails.map(c => h('span', { class: `rc-v c${c}` })),
    r.depth === 0 && !first ? h('span', { class: 'rc-up c0' }) : null,
    r.depth > 0 ? h('span', { class: `rc-elb c${r.depth}` }) : null,
    r.down ? h('span', { class: `rc-dn c${r.depth}` }) : null,
    node(r.f, `c${r.depth}`));
  const sub = (r: RecentRow) => r.f.kind !== 'topic' ? t('rct_kind_thread') : r.kids ? tn('rct_topic', r.kids) : t('rct_topic_none');
  const when = (at: number, un: boolean) => at ? h('span', { class: `rc-w${un ? ' un' : ''}` }, ago(at)) : null;
  /** `#tag` in the filter, or out of it (a pill of a row, a filter of the bar). */
  const flip = (tag: string) => { R.q = toggleTag(R.q, tag); render(); };
  /** Pills of a row's tags: inside the row's link, so a tap filters instead of opening the conversation. */
  const pills = (f: PublicThread) => tagsOf(f).map(x => h('span', { class: `rc-tg ${tagHue(x)}`, role: 'button', tabindex: '0', 'data-tag': x, title: `#${x}`,
    onclick: (e: Event) => { e.preventDefault(); e.stopPropagation(); flip(x); },
    onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); flip(x); } } }, x));

  const row = (r: RecentRow, i: number, now?: NowHooks) => {
    const un = host.unread(r.f), name = r.f.kind === 'topic' ? topicName(r.f) : r.f.title;
    // Now: the space before the kind on a rail row (every space mixed); a thread's chips with its pills, its « I am
    // waiting for » on a line of its own.
    const extra = now && r.f.kind !== 'topic' && !r.ctx ? now.extra(r.f).filter((x): x is Node => !!x) : [];
    const chips = extra.filter(x => !(x as HTMLElement).classList?.contains('await-line')), wait = extra.filter(x => !chips.includes(x));
    return h('a', { href: '#', class: rowClass(r, { unread: un, mark: host.mark(r.f), mine: !!now?.mine(r.f), sel: host.sel() === r.f.id }),
      'data-k': `rc:${r.f.id}`, title: r.f.archived ? `${name}\n${host.say(r.f)}` : name, 'aria-current': host.sel() === r.f.id ? 'true' : undefined, ...(now ? now.press(r.f) : {}),
      onclick: (e: Event) => { e.preventDefault(); if (host.narrow()) R.open = ''; host.go(r.f); } },
      gutter(r, i === 0),
      // A topic's pills on its meta line, a thread's on a line of their own under its title (beside it they cut the
      // title too early on a phone).
      h('span', { class: 'rc-main' }, h('span', { class: 'rc-t' }, name),
        r.depth === 0 ? h('span', { class: 'rc-s' }, now ? h('b', { class: 'rc-sp' }, spaceName(r.f.space)) : null, now ? ' · ' : null, sub(r), ...chips, ...pills(r.f))
          : chips.length || tagsOf(r.f).length ? h('span', { class: 'rc-s rc-tgs' }, ...chips, ...pills(r.f)) : null,
        ...wait),
      h('span', { class: 'rc-end' }, host.label(r.f), when(r.at, un)),
      un ? h('span', { class: 'rc-dot', 'aria-hidden': 'true' }) : null,
      now && !r.ctx ? now.menu(r.f) : null);
  };

  /** `#tag` filters of the space's tags (most used first), under Tout / Actifs / Non lus; none without tags. */
  function tagBar(space: string) {
    const all = recentsTags(host.threads(), space), on = new Set(tagTerms(R.q));
    return all.length ? h('div', { class: 'rc-tags', role: 'group', 'aria-label': t('rct_tags') },
      ...all.map(x => h('button', { type: 'button', class: `rc-tf${on.has(x) ? ' on' : ''}`, 'aria-pressed': String(on.has(x)), 'data-k': `rct:${x}`,
        onclick: () => flip(x) }, `#${x}`))) : null;
  }

  function body(space: string, inline = false) {
    const rows = recentsTree(host.threads(), space, opts(R.filter, R.q)), n = recentsUnread(host.threads(), space, host.unread);
    const seg = h('div', { class: 'seg rc-seg', role: 'group', 'aria-label': t('rct_btn') },
      ...RECENTS_FILTERS.map(x => h('button', { type: 'button', class: R.filter === x ? 'on' : '', 'aria-pressed': String(R.filter === x), 'data-k': `rcf:${x}`,
        onclick: () => { R.filter = x; render(); } }, t(FILTER_LABEL[x]), x === 'unread' && n ? h('span', { class: 'n' }, ` · ${n}`) : null)));
    const q = h('input', { type: 'search', class: 'rc-q', 'data-draft': 'rc-q', placeholder: t('rct_filter'), 'aria-label': t('rct_filter'), autocomplete: 'off', spellcheck: 'false',
      oninput: (e: Event) => { R.q = (e.target as HTMLInputElement).value; render(); } }) as HTMLInputElement;
    q.value = R.q;
    const head = h('div', { class: 'rc-head' },
      h('div', { class: 'rc-top' }, h('h3', {}, icon('later', 15) as unknown as Node, t('rct_btn')), h('span', { class: 'rc-hint' }, t('rct_hint')),
        h('button', { class: 'btn ic topic-btn', type: 'button', title: t('new_topic_title', { space: spaceName(space) }), 'aria-label': t('new_topic_title', { space: spaceName(space) }),
          onclick: () => { if (host.narrow()) R.open = ''; host.newTopic(space); } }, icon('messageSquarePlus', 18) as unknown as Node, h('span', {}, t('topic_btn'))),
        inline ? null : h('button', { class: 'btn ic rc-x', type: 'button', title: t('pane_close'), 'aria-label': t('pane_close'), onclick: close }, icon('x', 16) as unknown as Node)),
      h('div', { class: 'rc-flt' }, seg, q), tagBar(space));
    const empty = !rows.length && !host.more(space) ? h('div', { class: 'blank', 'data-k': 'rc-blank' }, t(R.filter === 'unread' && !R.q ? 'rct_none_unread' : 'rct_none')) : null;
    const more = host.more(space) ? h('div', { class: 'rc-more', 'data-k': 'rc-more', 'data-space': space }, t('ex_loading')) : null;
    return [head, h('div', { class: 'rc-list', role: 'list' }, ...rows.map((r, i) => row(r, i)), empty, more)];
  }

  return {
    nowEl(o) {
      const rows = nowTree(host.threads(), opts('active', ''), o.mine, o.muted);
      return h('div', { class: 'rc-list now-tree', role: 'list' }, o.top, ...rows.map((r, i) => row(r, i, o)),
        !rows.length && !o.top ? h('div', { class: 'blank', 'data-k': 'now-blank' }, t('now_empty')) : null);
    },
    button(space) {
      const n = recentsUnread(host.threads(), space, host.unread), on = R.open === space;
      return h('button', { type: 'button', class: `btn rc-btn${on ? ' on' : ''}${n ? ' has' : ''}`, 'data-k': 'rc-btn', 'aria-pressed': String(on),
        title: t('rct_tip'), 'aria-label': n ? `${t('rct_btn')} · ${tn('rct_unread', n)}` : t('rct_btn'), onclick: () => toggle(space) },
        icon('later', 14) as unknown as Node, h('span', { class: 'rc-lbl' }, t('rct_btn')), n ? h('span', { class: 'rc-badge' }, String(n)) : null);
    },
    pane(space) {
      if (!space || R.open !== space) return null;
      if (!host.narrow()) return h('aside', { class: 'recents', 'data-k': 'recents', 'aria-label': t('rct_btn') }, ...body(space));
      return h('div', { class: 'sheet-wrap', 'data-k': 'rc-sheet' }, h('div', { class: 'scrim', onclick: close }),
        h('div', { class: 'sheet recents rc-sheet', role: 'dialog', 'aria-label': t('rct_btn') }, h('div', { class: 'rc-grab' }), ...body(space)));
    },
    inline: space => body(space, true),
    docked: space => !!space && R.open === space && !host.narrow(),
    close() { if (R.open) close(); },
    watch() {
      obs?.disconnect(); obs = null;
      const m = document.querySelector('.recents .rc-more, .rc-only .rc-more') as HTMLElement | null;
      if (!m) return;
      obs = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) host.loadMore(m.dataset.space!); },
        { root: m.closest('.rc-list'), rootMargin: '0px 0px 400px 0px' });
      obs.observe(m);
    },
    flat: space => recentsFlat(host.threads(), space),
    flatEl(items, sel, pick, hover, allSpaces, keys = true) {
      const line = (x: FlatRecent, i: number) => {
        const f = x.f, un = host.unread(f), name = f.kind === 'topic' ? topicName(f) : f.title;
        const where = [t(f.kind === 'topic' ? 'rct_kind_topic' : 'rct_kind_thread'), x.root ? topicName(x.root) : '', allSpaces ? spaceName(f.space) : ''].filter(Boolean).join(' · ');
        return h('div', { class: `rc-hit${i === sel ? ' on' : ''}${un ? ' unread' : ''}`, 'data-k': `rh:${f.id}`, role: 'option', 'aria-selected': String(i === sel),
          onclick: () => pick(i), onmousemove: () => { if (i !== sel) hover(i); } },
          un ? h('span', { class: 'rc-dot' }) : h('span', { class: 'rc-dot off' }), node(f, ''),
          h('div', { class: 'pal-main' }, h('div', { class: 'pal-top' }, h('span', { class: 'pal-title' }, name)), h('div', { class: 'pal-meta' }, where)),
          h('span', { class: 'rc-end' }, host.label(f), when(f.updatedAt, un)),
          keys && i < 9 ? h('kbd', { class: 'rc-kbd' }, `${MOD}${i + 1}`) : null);
      };
      return h('div', { class: 'pal-list rc-flat', role: 'listbox', 'aria-label': t('rct_btn') },
        h('div', { class: 'group label' }, t('rct_btn')), ...items.map(line));
    },
  };
}
