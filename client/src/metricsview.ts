// Activity of the space over a period, computed by the hub (metrics.get). Cost = threads and topics created in the
// period (the hub keeps a running total per thread), said under the cards.
// Its own file since the modules refactor: main.ts keeps the sidebar entry, the route hook and the thread info pane's
// « Where the tokens go » (splitBar, reasoningLine, lent here).
import type { HubFrame, MetricsPeriod, SpaceMetrics, ThreadState, Usage } from '../../protocol/frames.ts';
import { METRICS_PERIODS } from '../../protocol/frames.ts';
import { closedShare, dayBars, dayLabel, DEFAULT_PERIOD, metricsKey, radarPerPass, radarRows, ranked, stateRows, totals, worthShowing, type DayBar, type Row } from './metrics.ts';
import { costLabel, costTitle, splitRows, usdLabel, type SplitRow } from './cost.ts';
import { lang, type Key } from './i18n.ts';
import type { UiKit } from './modules.ts';
import type { View } from './route.ts';

export interface MetricsModule {
  /** The view of a space, built on each render. */
  el(space: string): HTMLElement;
  /** The hub's `metrics` answer: true = handled (the caller renders). */
  frame(f: HubFrame): boolean;
  /** The route shows the view: asks the hub on entry and on each period change (never polled). */
  entered(space: string, online: boolean): void;
  left(): void;
}

/** `openIn`: shows a conversation in that view of the app; `splitBar` / `reasoningLine`: main.ts' cost helpers. */
export function metricsModule(k: UiKit, openIn: (view: View, id: string) => void, splitBar: (rows: SplitRow[], tip?: (r: SplitRow) => string) => Node[], reasoningLine: (u: Usage | null | undefined) => HTMLElement): MetricsModule {
  const { h, t, tn, render, me, spaceName, menuBtn, since, withIcon, personName } = k;
  const label = (st: ThreadState) => t(`state_${st}`);
  const M = {
    metrics: new Map<string, SpaceMetrics>(), // Metrics view, per space and period (metricsKey), asked again on every entry
    metricsPeriod: DEFAULT_PERIOD as MetricsPeriod,
    metricsAgent: '', // « Where the tokens go » filter: '' = all agents, else one agent id
  };
  let metricsFor = ''; // metricsKey last asked to the hub (asked again when re-entering the view)
  const PERIOD_LABEL: Record<MetricsPeriod, Key> = { '7d': 'metrics_7d', '30d': 'metrics_30d', all: 'metrics_all' };
  function metricsView(space: string) {
    const m = M.metrics.get(metricsKey(space, M.metricsPeriod));
    const lng = lang(), num = (n: number) => new Intl.NumberFormat(lng).format(n);
    const nameOf = (id: string, kind?: 'human' | 'agent') => id === '' ? t('metrics_unknown') : kind === 'agent' ? id[0].toUpperCase() + id.slice(1)
      : id === me() ? t('you') : personName(id) ?? t('member_id', { id: id.slice(0, 6) });
    const agentName = (id: string) => nameOf(id, 'agent'), humanName = (id: string) => nameOf(id, 'human');
    const others = (k: number) => tn('metrics_others', k);
    const period = h('div', { class: 'theme mx-period', role: 'group', 'aria-label': t('metrics_period') },
      ...METRICS_PERIODS.map(p => h('button', { class: M.metricsPeriod === p ? 'on' : '', 'aria-pressed': String(M.metricsPeriod === p),
        onclick: () => { M.metricsPeriod = p; render(); } }, t(PERIOD_LABEL[p]))));
    const head = h('header', { class: 'mx-head' }, menuBtn(), h('div', {}, h('h2', {}, withIcon('chart', t('metrics_title', { space: spaceName(space) }), 18)),
      h('p', {}, m ? t('metrics_computed', { ago: since(m.at) }) : t('ex_loading'))), period);
    const shell = (...kids: (Node | null)[]) => h('section', { class: 'overview metrics' }, head, h('div', { class: 'scroll' }, ...kids));
    if (!m) return shell(h('div', { class: 'blank' }, t('ex_loading')));
    const tot = totals(m), closed = closedShare(m);
    const card = (label: string, value: string, sub: string, title = '') => h('div', { class: 'mx-card', title }, h('div', { class: 'mx-k' }, label), h('div', { class: 'mx-v' }, value), h('div', { class: 'mx-s' }, sub));
    const panel = (...kids: (Node | null)[]) => h('section', { class: 'mx-panel' }, ...kids);
    const title = (text: string) => h('div', { class: 'mx-pt' }, text);
    const empty = () => h('div', { class: 'mx-empty' }, t('metrics_none'));
    const legend = (items: [cls: string, text: string, n?: string][]) => h('div', { class: 'mx-legend' },
      ...items.map(([c, text, n]) => h('span', { class: `mx-key ${c}` }, h('i', {}), text, n ? h('b', {}, n) : null)));
    // Charts in SVG: sizes are attributes, not inline styles (CSP); preserveAspectRatio none stretches them to their box.
    const NS = 'http://www.w3.org/2000/svg';
    const sv = (tag: string, attrs: Record<string, string | number>) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v)); return e; };
    const day = (b: DayBar) => {
      const svg = sv('svg', { viewBox: '0 0 10 100', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
      svg.append(sv('rect', { class: 'mx-h', x: 0, y: 100 - b.human100, width: 10, height: b.human100 }),
        sv('rect', { class: 'mx-a', x: 0, y: 100 - b.human100 - b.agent100, width: 10, height: b.agent100 }));
      return h('div', { class: 'mx-day tip', 'data-tip': `${dayLabel(b.day, lng)} · ${t('metrics_messages_sub', { h: num(b.human), a: num(b.agent) })}` },
        h('div', { class: 'mx-col' }, svg as unknown as Node), h('span', { class: 'mx-dl' }, b.label ? dayLabel(b.day, lng) : ''));
    };
    const bars = dayBars(m.days ?? []);
    const states = stateRows(m, b => b === 'archived' ? t('archived') : label(b));
    const stack = sv('svg', { class: 'mx-stack', viewBox: `0 0 ${Math.max(1, states.reduce((s, r) => s + r.n, 0))} 10`, preserveAspectRatio: 'none',
      role: 'img', 'aria-label': states.map(r => `${r.label} ${num(r.n)}`).join(', ') });
    let x = 0;
    for (const r of states) { stack.append(sv('rect', { class: `s-${r.id}`, x, y: 0, width: r.n, height: 10 })); x += r.n; }
    const toThread = (id: string) => { openIn({ kind: 'space', id: space }, id); };
    const top = (m.cost.top ?? []).map(c => h('a', { class: 'mx-tr', href: `#/${encodeURIComponent(space)}/${encodeURIComponent(c.id)}`,
      onclick: (e: Event) => { e.preventDefault(); toThread(c.id); } }, h('span', { class: 'mx-tt' }, c.title), h('span', { class: 'mx-n' }, usdLabel(c.usd, lng))));
    // Ranked lists, only when they have two entries or more.
    const row = (r: Row, value = num(r.n)) => h('div', { class: `mx-row ${r.id === '' ? 'muted' : ''}` },
      h('span', { class: 'mx-name' }, r.label, r.kind === 'agent' ? h('span', { class: 'mx-tag' }, t('metrics_agent')) : null),
      h('progress', { class: 'mx-bar', max: '100', value: String(r.share) }), h('span', { class: 'mx-n' }, value));
    const block = (title: string, ic: string, rows: HTMLElement[]) => h('section', { class: 'mx-block' }, h('div', { class: 'group label' }, withIcon(ic, title)), ...rows);
    const list = (title: string, ic: string, rows: Row[]) => worthShowing(rows) ? block(title, ic, rows.map(r => row(r))) : null;
    const costRows = m.cost.byAgent.length > 1 ? block(t('metrics_cost_by_agent'), 'dollar', withShare(m.cost.byAgent.map(a => ({ id: a.id, label: agentName(a.id), n: a.usage.usd })))
      .map((r, i) => { const u = m.cost.byAgent[i].usage; const el = row(r, costLabel(u, lng)); el.title = costTitle(u, lng); return el; })) : null;
    // Hidden turns (Radar runs, memory review, titling): no conversation to list, their spend per origin.
    const hidden = m.cost.hidden ?? [];
    const hiddenRows = hidden.length ? block(t('metrics_hidden'), 'dollar', withShare(hidden.map(x => ({ id: x.origin, label: t(`metrics_hidden_${x.origin}` as Key), n: x.usage.usd })))
      .map((r, i) => { const u = hidden[i].usage; const el = row(r, costLabel(u, lng)); el.title = costTitle(u, lng); el.dataset.k = `mx-hidden-${hidden[i].origin}`; return el; })) : null;
    // Radar: signals of the period per type, how the team sorted them, the cost of a pass.
    const rr = radarRows(m), perPass = radarPerPass(m);
    const radarBlock = m.radar ? block(t('metrics_radar'), 'radar', [
      ...rr.map(r => { const el = row({ id: r.kind, label: t(`rd_type_${r.kind}` as Key), n: r.n, share: r.share }, t('metrics_radar_row', { n: num(r.n), o: String(r.opened), d: String(r.dismissed) })); el.dataset.k = `mx-radar-${r.kind}`; return el; }),
      h('div', { class: 'mx-row muted', 'data-k': 'mx-radar-cost' }, h('span', { class: 'mx-name' }, tn('metrics_radar_passes', m.radar.passes)),
        h('span', { class: 'mx-n' }, perPass === null ? '—' : t('metrics_radar_per_pass', { usd: usdLabel(perPass, lng) })))]) : null;
    const lists = [list(t('metrics_by_agent'), 'bot', ranked(m.owners, agentName, others)), list(t('metrics_openers'), 'thread', ranked(m.openers, humanName, others)),
      list(t('metrics_topic_authors'), 'coffee', ranked(m.topicAuthors, humanName, others)), list(t('metrics_by_author'), 'you', ranked(m.messages, nameOf, others)), costRows, hiddenRows, radarBlock].filter(Boolean);
    const cost = m.cost.total;
    // Where the tokens go, all agents or one (filter shown only with two agents or more)
    const agentSel = m.cost.byAgent.find(a => a.id === M.metricsAgent);
    const split = splitRows(agentSel ? agentSel.split : m.cost.split);
    const agentSeg = m.cost.byAgent.length > 1 ? h('div', { class: 'theme mx-agents', role: 'group', 'aria-label': t('metrics_split') },
      ...[{ id: '', label: t('metrics_split_all') }, ...m.cost.byAgent.map(a => ({ id: a.id, label: agentName(a.id) }))].map(a => {
        const on = (agentSel?.id ?? '') === a.id;
        return h('button', { class: on ? 'on' : '', 'aria-pressed': String(on), 'data-k': `split-agent:${a.id}`, onclick: () => { M.metricsAgent = a.id; render(); } }, a.label);
      })) : null;
    const splitPanel = cost ? panel(h('div', { class: 'mx-pt' }, h('span', { class: 'tip tip-below', 'data-tip': t('metrics_split_tip') }, t('metrics_split'))), agentSeg,
      ...(split.length ? splitBar(split) : [empty()]), reasoningLine(agentSel ? agentSel.usage : cost)) : null;
    const method = [t(m.period === 'all' ? 'metrics_note_all' : 'metrics_note'), t('metrics_cost_sub', { n: num(m.cost.costed), of: num(m.cost.items) })].join(' ');
    return shell(
      h('div', { class: 'mx-cards' },
        card(t('metrics_threads'), num(tot.threads), tn('metrics_topics_sub', tot.topics)),
        card(t('metrics_messages'), num(tot.messages), t('metrics_messages_sub', { h: num(tot.human), a: num(tot.agent) })),
        card(t('metrics_cost'), cost ? costLabel(cost, lng) : '—', m.cost.median != null ? t('metrics_median', { usd: usdLabel(m.cost.median, lng) }) : '', cost ? costTitle(cost, lng) : ''),
        card(t('metrics_closed'), closed == null ? '—' : `${num(closed)} %`, t('metrics_closed_sub', { n: num(m.threads.done ?? 0), of: num(tot.threads) }))),
      h('div', { class: 'mx-dash' },
        panel(title(t('metrics_activity')), legend([['mx-h', t('metrics_people')], ['mx-a', t('metrics_agents')]]),
          bars.length ? h('div', { class: `mx-days${bars.length > 40 ? ' dense' : ''}` }, ...bars.map(day)) : empty()),
        panel(title(t('metrics_by_state')), ...(states.length ? [h('div', { class: 'mx-stackbox' }, stack as unknown as Node), legend(states.map(r => [`s-${r.id}`, r.label, num(r.n)]))] : [empty()]),
          title(t('metrics_top')), top.length ? h('div', { class: 'mx-top' }, ...top) : empty())),
      splitPanel ? h('div', { class: 'mx-split', 'data-k': 'metrics-split' }, splitPanel) : null,
      h('p', { class: 'mx-note' }, h('span', { class: 'tip tip-below', 'data-tip': method }, t('metrics_note_short')), m.partial ? ' ' + t('metrics_partial') : ''),
      lists.length ? h('div', { class: 'mx-grid' }, ...lists) : null);
  }
  /** Bars for amounts (cost): same 0-100 scale as `ranked`, relative to the largest. */
  const withShare = (rs: Omit<Row, 'share'>[]): Row[] => { const max = Math.max(...rs.map(r => r.n), 1e-9); return rs.map(r => ({ ...r, share: Math.round(100 * r.n / max) })); };
  return {
    el: metricsView,
    frame(f) { if (f.type !== 'metrics') return false; M.metrics.set(metricsKey(f.space, f.metrics.period), f.metrics); return true; },
    entered(space, online) {
      const key = metricsKey(space, M.metricsPeriod);
      if (metricsFor !== key && online) { metricsFor = key; k.post({ type: 'metrics.get', space, period: M.metricsPeriod, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }); }
    },
    left() { metricsFor = ''; },
  };
}
