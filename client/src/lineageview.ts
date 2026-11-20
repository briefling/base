// Who started which topic and thread, and what opened what, computed by the hub (lineage.get), laid out by
// client/src/lineage.ts: one lane per person, time left to right (a Map tab was shipped then removed).
// Its own file since the modules refactor: main.ts keeps the sidebar entry and the route hook.
import type { HubFrame, LineageNode, LineagePeriod, SpaceLineage, ThreadState } from '../../protocol/frames.ts';
import { LINEAGE_PERIODS } from '../../protocol/frames.ts';
import { anchorScroll, bestShippers, byAgent, DAY_MIN, DEFAULT_LINEAGE_PERIOD, LANE, lanes, lineageKey, personStats, prepare, related, short, textWidth, zoomStep, zoomWheel, type ViewNode } from './lineage.ts';
import { usdLabel } from './cost.ts';
import { cur, on } from './patch.ts';
import { lang, type Key } from './i18n.ts';
import type { UiKit } from './modules.ts';
import type { View } from './route.ts';

const SVGNS = 'http://www.w3.org/2000/svg';
function sv(tag: string, attrs: Record<string, string | number> = {}, ...kids: (Node | string)[]): SVGElement {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  for (const k of kids) e.append(k);
  return e;
}
const narrow = () => matchMedia('(max-width:700px)').matches; // same breakpoint as style.css: one pane at a time

export interface LineageModule {
  el(space: string): HTMLElement;
  /** The hub's `lineage` answer: true = handled (the caller renders). */
  frame(f: HubFrame): boolean;
  /** The route shows the view: asks the hub on entry and on each period change (never polled). */
  entered(space: string, online: boolean): void;
  left(): void;
}

/** `openIn`: shows a conversation in that view of the app. */
export function lineageModule(k: UiKit, openIn: (view: View, id: string) => void): LineageModule {
  const { h, t, tn, icon, render, me, spaceName, menuBtn, since, personAvatar, withIcon, personName } = k;
  const label = (st: ThreadState) => t(`state_${st}`);
  const M = {
    // Flow view: what the hub sent per space and period (lineageKey, asked again on every entry), tab, « hide quiet ».
    lineage: new Map<string, SpaceLineage>(), lineagePeriod: DEFAULT_LINEAGE_PERIOD as LineagePeriod, lineageHide: false, lineageBare: false, lineageZoom: 1, lineageBy: 'person' as 'person' | 'agent',
  };
  let lineageFor = '', lineageScrolled = '';
  let lineageTip = ''; // phone: the person whose name and stats card is open (tap on the avatar)
  /** Zoom of the Threads view: ⌘/Ctrl + wheel or a pinch (sent by the browser as Ctrl + wheel) around the pointer, or the
   *  −/+ buttons around the centre; dragging the background pans. It touches the live DOM at event time (render() morphs
   *  the new tree into the old nodes, so references built during render may be discarded): the SVGs keep their viewBox,
   *  only width/height change (attributes, CSP), from their `data-w`/`data-h`. Handlers go through on() (patch.ts). */
  const zoomBox = () => document.querySelector('.lineage .ln-scroll') as HTMLElement | null;
  function zoomTo(z2: number, at?: [number, number]) {
    const box = zoomBox(), z1 = M.lineageZoom;
    if (!box || z2 === z1) return;
    const [ax, ay] = at ?? [box.clientWidth / 2, box.clientHeight / 2];
    const sl = anchorScroll(box.scrollLeft, ax, z1, z2), st = anchorScroll(box.scrollTop, ay, z1, z2);
    for (const e of box.querySelectorAll('svg[data-w]')) {
      e.setAttribute('width', String(Math.round(+e.getAttribute('data-w')! * z2))); e.setAttribute('height', String(Math.round(+e.getAttribute('data-h')! * z2)));
    }
    M.lineageZoom = z2;
    const lab = document.querySelector('.lineage .ln-zoom .ln-zl'); if (lab) lab.textContent = `${Math.round(z2 * 100)} %`;
    box.scrollLeft = sl; box.scrollTop = st;
  }
  let panning: { x: number; y: number; sl: number; st: number; moved: boolean } | null = null;
  const panAttrs = {
    onwheel: (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return; // plain wheel scrolls
      e.preventDefault();
      const box = zoomBox(); if (!box) return;
      const r = box.getBoundingClientRect();
      zoomTo(zoomWheel(M.lineageZoom, e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1)), [e.clientX - r.left, e.clientY - r.top]);
    },
    onpointerdown: (e: PointerEvent) => { const box = zoomBox(); if (box && e.button === 0 && !(e.target as Element).closest('.ln-n')) panning = { x: e.clientX, y: e.clientY, sl: box.scrollLeft, st: box.scrollTop, moved: false }; },
    onpointermove: (e: PointerEvent) => {
      const box = zoomBox(); if (!panning || !box) return;
      const dx = e.clientX - panning.x, dy = e.clientY - panning.y;
      if (!panning.moved && Math.hypot(dx, dy) < 4) return;
      if (!panning.moved) { panning.moved = true; box.setPointerCapture(e.pointerId); box.classList.add('dragging'); }
      box.scrollLeft = panning.sl - dx; box.scrollTop = panning.st - dy;
    },
    onpointerup: () => { panning = null; zoomBox()?.classList.remove('dragging'); },
    onpointercancel: () => { panning = null; zoomBox()?.classList.remove('dragging'); },
  }; // lineageKey last asked to the hub; last one scrolled to « now »
  const LINEAGE_PERIOD_LABEL: Record<LineagePeriod, Key> = { '3d': 'lineage_3d', '7d': 'metrics_7d', '30d': 'metrics_30d' };
  function lineageView(space: string) {
    const raw = M.lineage.get(lineageKey(space, M.lineagePeriod)), perAgent = M.lineageBy === 'agent';
    // « By agent »: same nodes, one lane per agent in charge (byAgent); the initiator stays in the hover card.
    const l = raw && perAgent ? byAgent(raw) : raw;
    const lng = lang();
    const agentName = (id: string) => id ? id[0].toUpperCase() + id.slice(1) : '';
    const who = (id: string) => id === '' ? t('metrics_unknown') : personName(id) ?? (id === me() ? t('you') : t('member_id', { id: id.slice(0, 6) }));
    // Every toolbar control is a Board-style .seg (same height, weight, optional icon), so the row lines up.
    const seg = (on: boolean, text: string, onclick: () => void, ic?: string, cls = '') =>
      h('button', { class: `${cls} ${on ? 'on' : ''}`.trim(), 'aria-pressed': String(on), onclick }, ...(ic ? [icon(ic, 14) as unknown as Node] : []), text);
    const by = h('div', { class: 'seg ln-by', role: 'group', 'aria-label': t('lineage_by') },
      seg(!perAgent, t('lineage_by_person'), () => { M.lineageBy = 'person'; render(); }, 'you'), seg(perAgent, t('lineage_by_agent'), () => { M.lineageBy = 'agent'; render(); }, 'bot'));
    const period = h('div', { class: 'seg ln-period', role: 'group', 'aria-label': t('metrics_period') },
      ...LINEAGE_PERIODS.map(p => seg(M.lineagePeriod === p, t(LINEAGE_PERIOD_LABEL[p]), () => { M.lineagePeriod = p; render(); })));
    const quiet = h('div', { class: 'seg' }, seg(M.lineageHide, t('lineage_hide_quiet'), () => { M.lineageHide = !M.lineageHide; render(); }, undefined, 'ln-quiet'));
    // Topics that opened nothing are folded by default (most Lounge topics are a question); the button shows them.
    const bareN = l ? prepare(l, M.lineageHide, true).bare : 0;
    const bare = bareN || M.lineageBare ? h('div', { class: 'seg' }, seg(M.lineageBare, tn('lineage_bare', bareN), () => { M.lineageBare = !M.lineageBare; render(); }, undefined, 'ln-quiet ln-bare')) : null;
    const tools = h('div', { class: 'ln-tools' }, by, period, quiet, bare);
    const head = h('header', { class: 'mx-head' }, menuBtn(), h('div', {}, h('h2', {}, withIcon('branch', t('lineage_title', { space: spaceName(space) }), 18)),
      h('p', {}, l ? t('metrics_computed', { ago: since(l.at) }) + (l.partial ? ' ' + t('metrics_partial') : '') : t('ex_loading'))), tools);
    const shell = (...kids: (Node | null)[]) => h('section', { class: 'overview metrics lineage' }, head, ...kids);
    if (!l) return shell(h('div', { class: 'blank' }, t('ex_loading')));
    const p = prepare(l, M.lineageHide, !M.lineageBare);
    if (!p.nodes.length) return shell(h('div', { class: 'mx-empty ln-empty' }, t('lineage_none')));
    const go = (n: LineageNode) => {
      const target = n.kind === 'card' ? p.byId.get(n.parent ?? '') : n;
      if (!target) return;
      openIn({ kind: target.kind === 'topic' ? 'lounge' : 'space', id: space }, target.id);
    };
    // Hover card: the details the drawing leaves out (whole title, who, agent, state, cost, dates), drawn inside the SVG
    // (no inline style under the CSP), on top, where the pointer is.
    const initiatorOf = (n: LineageNode) => (n as ViewNode).initiator ?? n.who;
    const hoverLines = (n: LineageNode) => [
      (n.kind === 'card' ? t('lineage_card', { title: n.title }) : n.title).slice(0, 90),
      [n.kind === 'topic' ? t('lineage_topic_by', { who: who(initiatorOf(n)) }) : n.kind === 'card' ? agentName(n.who) : t('lineage_opened_by', { who: who(initiatorOf(n)) }),
        n.owner && n.kind === 'thread' ? agentName(n.owner) : ''].filter(Boolean).join(' · '),
      [n.state ? (n.state === 'archived' ? t('archived') : label(n.state)) : '', n.usd !== undefined ? usdLabel(n.usd, lng) : '',
        day(n.start) + (n.kind === 'thread' && day(n.last) !== day(n.start) ? ` → ${day(n.last)}` : ''), n.context ? t('lineage_context') : ''].filter(Boolean).join(' · '),
    ];
    const hover = (n: LineageNode, root: SVGSVGElement, e: PointerEvent) => {
      root.querySelector(':scope > .ln-hov')?.remove();
      const m = root.getScreenCTM(); if (!m) return;
      const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
      const ls = hoverLines(n), w = Math.max(...ls.map((s, i) => textWidth(s, i ? 10.5 : 11.5))) + 20, hh = 14 + ls.length * 15;
      const vb = root.viewBox.baseVal, right = vb && vb.width ? vb.x + vb.width : Infinity;
      const x = pt.x + 14 + w > right ? pt.x - 14 - w : pt.x + 14, y = pt.y + 12, line = p.color.get(p.rootOf.get(n.id) ?? '') ?? 0;
      // Card tinted with the line's colour, an accent bar on the left, a shadow (CSS filter) to lift it.
      root.append(sv('g', { class: `ln-hov lc${line}` }, sv('rect', { x, y, width: w + 4, height: hh, rx: 8, class: 'ln-hbg' }),
        sv('rect', { x, y: y + 6, width: 3, height: hh - 12, rx: 1.5, class: 'ln-hacc' }),
        ...ls.map((s, i) => text(x + 14, y + 18 + i * 15, s, i ? 'ln-hl' : 'ln-ht'))));
      // Highlight its lineage: ancestors up to the root and the whole subtree, the rest fades.
      const rel = related(p, n.id);
      root.classList.add('ln-focus');
      for (const el of root.querySelectorAll('[data-id],[data-of],[data-to]')) {
        const a = el.getAttribute('data-id') ?? el.getAttribute('data-of'), from = el.getAttribute('data-from'), to = el.getAttribute('data-to');
        el.classList.toggle('on', a ? rel.has(a) : !!to && rel.has(to) && (!from || rel.has(from)));
      }
    };
    const unhover = (root: SVGSVGElement) => {
      root.querySelector(':scope > .ln-hov')?.remove();
      root.classList.remove('ln-focus');
      for (const el of root.querySelectorAll('.on')) el.classList.remove('on');
    };
    const link = (n: LineageNode, cls: string, ...kids: Node[]) => {
      const g = sv('g', { class: `ln-n ${cls}`, tabindex: 0, role: 'link', 'data-id': n.id, 'aria-label': hoverLines(n).filter(Boolean).join(' · ') }, ...kids);
      // on() (patch.ts): the node kept by the morph runs these handlers; `cur` resolves it for the hover card.
      on(g, 'pointerenter', (e: PointerEvent) => { const r = (cur(g) as SVGGElement).ownerSVGElement; if (r) hover(n, r, e); });
      on(g, 'pointerleave', () => { const r = (cur(g) as SVGGElement).ownerSVGElement; if (r) unhover(r); });
      on(g, 'click', () => go(n));
      on(g, 'keydown', (e: KeyboardEvent) => { if (e.key === 'Enter') go(n); });
      return g;
    };
    const cup = (x: number, y: number, size: number) => { const c = icon('coffee', size); c.setAttribute('x', String(x - size / 2)); c.setAttribute('y', String(y - size / 2)); c.setAttribute('class', 'ln-cup'); return c; };
    const text = (x: number, y: number, s: string, cls: string, anchor = 'start') => sv('text', { x, y, class: cls, 'text-anchor': anchor }, s);
    const open_ = (n: LineageNode) => n.state === 'you' || n.state === 'run' || n.state === 'wait';
    const day = (ts: number) => new Date(ts).toLocaleDateString(lng, { day: 'numeric', month: 'short' });
    let body: Node, legend: Node;
    {
      // Phone: the column keeps the avatar (and the crown) only; a tap on it shows the name and stats in a card.
      const slim = narrow();
      const g = lanes(p, M.lineagePeriod, perAgent, slim ? LANE.X0_NARROW : LANE.X0), stats = personStats(l), best = bestShippers(stats);
      // People column: its own SVG, sticky on the left of the scroll box (names stay visible when scrolled to « now »).
      // The lanes SVG starts where the column ends (viewBox), both scale with the zoom (width/height attributes).
      const cw = g.x0 - 8, z = M.lineageZoom;
      const svg = sv('svg', { class: 'ln-lanes', viewBox: `${cw} 0 ${g.width - cw} ${g.height}`, width: Math.round((g.width - cw) * z), height: Math.round(g.height * z),
        'data-w': g.width - cw, 'data-h': g.height, role: 'img', 'aria-label': t('lineage') });
      const col = sv('svg', { class: `ln-lanes ln-whocol ${slim ? 'slim' : ''}`, viewBox: `0 0 ${cw} ${g.height}`, width: Math.round(cw * z), height: Math.round(g.height * z),
        'data-w': cw, 'data-h': g.height, 'aria-hidden': 'true' });
      let tip: Node | null = null;
      g.lanes.forEach((ln, i) => {
        const name = ln.agent ? agentName(ln.who) : who(ln.who);
        svg.append(sv('rect', { x: cw, y: ln.y + 2, width: g.width - cw, height: ln.h - 4, class: `ln-lane ${i % 2 ? 'odd' : ''}` }));
        // Name, crown for the best shipper of the period, and what they started: topics · threads, delivered · cost.
        const st = stats.get(ln.who), nm = short(name).slice(0, 18), crowned = best.has(ln.who);
        const cardsOnly = ln.agent && !perAgent; // by person, an agent lane only holds its proposed cards
        const lines = st ? (cardsOnly ? [tn('lineage_n_cards', st.cards)] : [`${tn('lineage_n_topics', st.topics)} · ${tn('lineage_n_threads', st.threads)}`,
          [tn('lineage_n_done', st.done), st.costed ? usdLabel(st.usd, lng) : ''].filter(Boolean).join(' · ')]) : [];
        const full = st && !cardsOnly ? [name, crowned ? t('lineage_best') : '', tn('lineage_n_topics', st.topics), tn('lineage_n_threads', st.threads), tn('lineage_n_done', st.done),
          tn('lineage_n_active', st.active), st.costed ? t('lineage_cost_of', { usd: usdLabel(st.usd, lng) }) : ''].filter(Boolean).join(' · ') : name;
        const crown = icon('crown', slim ? 11 : 12); crown.setAttribute('class', 'ln-crown');
        crown.setAttribute('x', String(slim ? 22 : 34 + textWidth(nm, 11.5) + 3)); crown.setAttribute('y', String(slim ? ln.y + 1 : ln.y + 11));
        const tone = ln.agent ? 5 : hashOf(ln.who) % 4; // card tint = avatar colour (lc0..lc3 match h0..h3)
        const person = sv('g', { class: 'ln-person', 'data-who': ln.who }, sv('title', {}, full),
          sv('rect', { x: 0, y: ln.y + 2, width: cw, height: ln.h - 4, class: `ln-lane ${i % 2 ? 'odd' : ''}` }),
          ln.agent ? sv('rect', { x: 10, y: ln.y + 8, width: 18, height: 18, rx: 5, class: 'ln-av agent' }) : sv('circle', { cx: 19, cy: ln.y + 17, r: 9, class: `ln-av h${tone}` }),
          ...lnFace(personAvatar(ln.who, ln.agent ? 'agent' : 'human', space), ln.agent, ln.y, i, () => text(19, ln.y + 21, (name[0] ?? '?').toUpperCase(), 'ln-avt', 'middle')), ...(slim ? [] : [text(34, ln.y + 21, nm, 'ln-who')]),
          ...(crowned ? [crown] : []), ...(slim ? [] : lines.map((x, k) => text(34, ln.y + 35 + k * 12, x, 'ln-stat'))));
        if (slim) {
          on(person, 'click', () => { lineageTip = lineageTip === ln.who ? '' : ln.who; render(); });
          if (lineageTip === ln.who) { // same card as the nodes' hover card, beside the column (the SVG overflows, CSS)
            const ls = [name, ...lines], w = Math.max(...ls.map((s, k) => textWidth(s, k ? 10.5 : 11.5))) + 20, hh = 14 + ls.length * 15;
            const x = cw + 4, y = Math.max(2, Math.min(ln.y + 4, g.height - hh - 2));
            tip = sv('g', { class: `ln-hov lc${tone}`, 'data-k': 'ln-tip' }, sv('rect', { x, y, width: w + 4, height: hh, rx: 8, class: 'ln-hbg' }),
              sv('rect', { x, y: y + 6, width: 3, height: hh - 12, rx: 1.5, class: 'ln-hacc' }),
              ...ls.map((s, k) => text(x + 14, y + 18 + k * 15, s, k ? 'ln-hl' : 'ln-ht')));
          }
        }
        col.append(person);
      });
      if (tip) col.append(tip);
      // Hours are as wide as they were busy (a dense day spreads hour by hour): a light band on the busy days, the date
      // where it fits, the hour above the wide hours.
      const hourOf = (ts: number) => new Date(ts).toLocaleTimeString(lng, { hour: 'numeric' });
      for (const d of g.days) {
        if (d.w > DAY_MIN * 2) svg.append(sv('rect', { x: d.x, y: 30, width: d.w, height: g.height - 30, class: 'ln-busy' }));
        svg.append(sv('line', { x1: d.x, y1: 4, x2: d.x, y2: g.height, class: 'ln-grid' }));
        if (d.w >= 46 && (g.nowX - d.x > 90 || d.x - g.nowX > 10)) svg.append(text(d.x + 4, 12, day(d.at), 'ln-day'));
      }
      let lastHour = -Infinity;
      for (const hr of g.hours) if (hr.w >= 26 && hr.x - lastHour >= 34 && new Date(hr.at).getHours() !== 0 && Math.abs(g.nowX - hr.x) > 30) {
        svg.append(sv('line', { x1: hr.x, y1: 22, x2: hr.x, y2: 30, class: 'ln-grid' }), text(hr.x + 3, 27, hourOf(hr.at), 'ln-hour'));
        lastHour = hr.x;
      }
      svg.append(sv('line', { x1: g.nowX, y1: 4, x2: g.nowX, y2: g.height, class: 'ln-nowl' }), text(g.nowX - 4, 12, t('lineage_today'), 'ln-day now', 'end'));
      const edges = sv('g', {}), bars = sv('g', {}), nodes = sv('g', {});
      for (const e of g.edges) edges.append(sv('path', { d: e.d, class: `ln-e lc${e.line} ${e.cross ? 'cross' : ''}`, 'data-from': e.from, 'data-to': e.to }));
      for (const v of g.nodes) {
        const n = v.n;
        if (n.kind === 'topic') { nodes.append(link(n, `ln-topic lc${v.line} ${n.context ? 'ctx' : ''}`, sv('circle', { cx: v.x, cy: v.y, r: 8, class: 'ln-tc' }), cup(v.x, v.y, 10))); continue; } // Lounge topic: no title (in the hover card)
        if (n.kind === 'card') { nodes.append(link(n, 'ln-card', sv('circle', { cx: v.x, cy: v.y, r: 5, class: 'ln-cc' }), text(v.x + 9, v.y + 4, short(n.title), 'ln-cn'))); continue; }
        const end = open_(n) ? g.nowX : v.x2;
        bars.append(sv('line', { x1: v.x, y1: v.y, x2: Math.max(end, v.x + 2), y2: v.y, class: `ln-base s-${n.state}`, 'data-of': n.id }));
        for (const s of v.segs) bars.append(sv('line', { x1: s[0], y1: v.y, x2: s[1], y2: v.y, class: `${s[2] ? 'ln-w' : 'ln-d'} s-${n.state}`, 'data-of': n.id }));
        // Invisible wide stroke along the bar: the whole life of the thread answers the hover, not only its dot.
        const kids: Node[] = [sv('line', { x1: v.x, y1: v.y, x2: Math.max(end, v.x + 2), y2: v.y, class: 'ln-hit' }),
          sv('circle', { cx: v.x, cy: v.y, r: 4, class: `ln-dot s-${n.state}` }), text(v.x + 1, v.y - 7, short(n.title), `ln-name ${n.state === 'you' ? 'you' : ''}`)];
        if (open_(n)) kids.push(sv('circle', { cx: g.nowX, cy: v.y, r: 3.5, class: `ln-dot s-${n.state}` }), sv('circle', { cx: g.nowX, cy: v.y, r: 7, class: `ln-halo s-${n.state}` }));
        nodes.append(link(n, `ln-thread ${n.context ? 'ctx' : ''}`, ...kids));
      }
      svg.append(edges, bars, nodes);
      // Phone: a tap anywhere else in the chart closes the person card.
      const box = h('div', { class: 'ln-scroll ln-pan', ...panAttrs, onclick: (e: MouseEvent) => { if (lineageTip && !(e.target as Element).closest('.ln-person')) { lineageTip = ''; render(); } } }, h('div', { class: 'ln-row' }, col as unknown as Node, svg as unknown as Node));
      // Open on « now » (right end) the first time this period is shown.
      const k = lineageKey(space, M.lineagePeriod);
      if (lineageScrolled !== k) { lineageScrolled = k; requestAnimationFrame(() => { box.scrollLeft = box.scrollWidth; }); }
      body = h('div', { class: 'ln-body' }, box);
      tools.append(h('div', { class: 'seg ln-zoom', role: 'group', 'aria-label': t('lineage_zoom') },
        h('button', { title: t('lineage_zoom_out'), 'aria-label': t('lineage_zoom_out'), onclick: () => zoomTo(zoomStep(M.lineageZoom, -1)) }, '−'), h('span', { class: 'ln-zl' }, `${Math.round(M.lineageZoom * 100)} %`),
        h('button', { title: t('lineage_zoom_in'), 'aria-label': t('lineage_zoom_in'), onclick: () => zoomTo(zoomStep(M.lineageZoom, 1)) }, '+')));
      legend = h('div', { class: 'ln-legend' }, h('span', { class: 'ln-k w' }, h('b', {}), t('lineage_legend_work')), h('span', { class: 'ln-k d' }, h('b', {}), t('lineage_legend_talk')),
        h('span', { class: 'ln-k i' }, h('b', {}), t('lineage_legend_idle')), h('span', { class: 'ln-k c' }, icon('crown', 11) as unknown as Node, t('lineage_best')), h('span', {}, t('lineage_legend_scale')), h('span', { class: 'grow' }), h('span', { class: 'ln-k x' }, h('b', {}), t(perAgent ? 'lineage_legend_cross_agent' : 'lineage_legend_cross')));
    }
    return shell(body, legend);
  }
  /** Lineage people column: the photo clipped to the avatar's shape (an SVG clipPath: no inline style under the CSP), else the initial. */
  function lnFace(src: string, agent: boolean, y: number, i: number, initial: () => Node): Node[] {
    if (!src) return [initial()];
    const id = `ln-clip-${i}`;
    return [sv('clipPath', { id }, agent ? sv('rect', { x: 10, y: y + 8, width: 18, height: 18, rx: 5 }) : sv('circle', { cx: 19, cy: y + 17, r: 9 })),
      sv('image', { href: src, x: 10, y: y + 8, width: 18, height: 18, preserveAspectRatio: 'xMidYMid slice', 'clip-path': `url(#${id})`, class: 'ln-avimg' })];
  }
  /** Small stable hash of a person id (avatar colour). */
  const hashOf = (s: string) => { let x = 0; for (const c of s) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x; };
  return {
    el: lineageView,
    frame(f) { if (f.type !== 'lineage') return false; M.lineage.set(lineageKey(f.space, f.lineage.period), f.lineage); return true; },
    entered(space, online) {
      const key = lineageKey(space, M.lineagePeriod);
      if (lineageFor !== key && online) { lineageFor = key; k.post({ type: 'lineage.get', space, period: M.lineagePeriod }); }
    },
    left() { lineageFor = ''; lineageScrolled = ''; },
  };
}
