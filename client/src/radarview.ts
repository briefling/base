// Radar view (protocol/radar.ts): the space's signals, listed on every entry then kept live by `radar.updated`. A lead
// opens a thread from a new signal (the hub starts the agent's turn), a Lounge topic to discuss it first (the agent
// posts its analysis; a thread can still follow), or dismisses it with a short reason.
// Its own file since the modules refactor: main.ts keeps the sidebar entry (badge from `by`), the route hook and
// Settings › Radar (radarcfg.*, whose answer also feeds the « last pass · next » line here).
import type { HubFrame } from '../../protocol/frames.ts';
import { RADAR_TYPES, SIGNAL_REASON_MAX, type RadarConfig, type Signal, type SignalType } from '../../protocol/radar.ts';
import { RD_ICON, filterSignals, radarEmpty, radarPasses, radarPrimary, signalCounts, signalTodo, summarySections, upsertSignal, type StateFilter, type TypeFilter } from './radar.ts';
import { routeOf } from './route.ts';
import { lang, type Key } from './i18n.ts';
import type { UiKit } from './modules.ts';

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const newCid = () => b64url(crypto.getRandomValues(new Uint8Array(32))).slice(0, 20); // same ids as main.ts' rand()

export interface RadarModule {
  el(space: string): HTMLElement;
  /** The hub's `radar.list` answer: true = handled (the caller renders). */
  frame(f: HubFrame): boolean;
  /** `radar.updated`: true = handled (the caller renders). */
  event(f: HubFrame): boolean;
  /** The route shows the view: listed on every entry (admins: the Radar config too), then kept live by the events. */
  entered(space: string, online: boolean, admin: boolean): void;
  left(): void;
  /** Signals per space (sidebar badge). */
  by: Map<string, Signal[]>;
  /** The unfolded signal ('' = none): a detail screen for the view transition. */
  detail(): string;
}

/** `opened`: a thread or topic opened from a signal, shown; `goThread`: shows a thread; `radarCfgBy`: Settings › Radar's
 *  config of a space (main.ts), for the « last pass · next » line. */
export function radarModule(k: UiKit, admin: (space: string) => boolean, opened: (thread: string) => unknown, goThread: (id: string) => void,
  radarCfgBy: { get(space: string): RadarConfig | undefined }): RadarModule {
  const { h, t, tn, icon, render, request, errText, spaceName, menuBtn, ago, withIcon } = k;
  const radarBy = new Map<string, Signal[]>();
  let radarFor = '';
  let rdType: TypeFilter = 'all', rdState: StateFilter = 'new';
  let rdBusy = '', rdErr = '', rdAsk = '', rdReason = '';
  async function rdSend(space: string, frame: { type: string; [k: string]: unknown }, s: Signal) {
    rdBusy = s.id; rdErr = ''; render();
    const r = await request({ ...frame, space, id: s.id, version: s.version }, 8000, true);
    rdBusy = '';
    if (!r || r.type === 'error') { rdErr = r?.type === 'error' && r.code === 'stale' ? t('rd_err_stale') : errText(r?.type === 'error' ? r.code : 'timeout'); render(); return; }
    if (frame.type === 'radar.dismiss') { rdAsk = ''; rdReason = ''; }
    if ((frame.type === 'radar.open' || frame.type === 'radar.topic') && r.type === 'ack' && r.thread) { return opened(r.thread); }
    render();
  }
  /** Calm radar scope of the empty « All » list: rings, cross-hair, a still sweep. Decorative. */
  function radarScope(): SVGSVGElement {
    const NS = 'http://www.w3.org/2000/svg', el = (tag: string, a: Record<string, string | number>) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(a)) e.setAttribute(k, String(v)); return e; };
    const svg = el('svg', { viewBox: '0 0 120 120', width: 120, height: 120, fill: 'none', stroke: 'currentColor', class: 'rd-scope', 'aria-hidden': 'true' }) as SVGSVGElement;
    svg.append(el('circle', { cx: 60, cy: 60, r: 56, 'stroke-width': 1.2 }), el('circle', { cx: 60, cy: 60, r: 38, opacity: .7 }), el('circle', { cx: 60, cy: 60, r: 20, opacity: .5 }),
      el('path', { d: 'M60 4v112M4 60h112', 'stroke-width': .7, opacity: .35 }),
      el('path', { d: 'M60 60 L60 4 A56 56 0 0 1 108.5 32 Z', fill: 'currentColor', stroke: 'none', opacity: .16, class: 'rd-sweep' }),
      el('path', { d: 'M60 60 L108.5 32', 'stroke-width': 1.4, class: 'rd-sweep' }), el('circle', { cx: 60, cy: 60, r: 2.5, fill: 'currentColor', stroke: 'none' }));
    return svg;
  }
  /** Empty list (rules in radarEmpty / radarPasses): scope or type icon, title, sentence, « last pass · next », settings link (admins). */
  function radarEmptyView(space: string) {
    const e = radarEmpty(rdType, rdState), p = radarPasses(radarCfgBy.get(space), Date.now());
    const last = p.last === null ? null : Date.now() - p.last < 60_000 ? t('rd_pass_last_now') : t('rd_pass_last', { when: ago(p.last) });
    const next = p.next === null ? null : t('rd_pass_next', { when: new Date(p.next).toLocaleString(lang(), { weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) });
    return h('div', { class: `rd-empty mem-none${e.kind ? ` rd-t-${e.kind}` : ''}`, 'data-k': 'rd-empty' },
      e.scope ? radarScope() : h('div', { class: 'rd-big' }, icon(e.icon!, 26)),
      h('h3', {}, t(e.title as Key)), e.text ? h('p', {}, t(e.text as Key)) : null,
      last || next ? h('div', { class: 'rd-passes', 'data-k': 'rd-passes' }, [last, next].filter(Boolean).join(' · ')) : null,
      admin(space) ? h('a', { href: routeOf({ kind: 'settings', id: space, tab: 'radar' }, null), 'data-k': 'rd-settings' }, t('rd_settings')) : null);
  }
  let rdOpen = '';
  function radarView(space: string) {
    const list = radarBy.get(space);
    const head = h('header', { class: 'mx-head' }, menuBtn(), h('div', {}, h('h2', {}, withIcon('radar', t('rd_title', { space: spaceName(space) }), 18)), h('p', {}, list ? t('rd_intro') : t('ex_loading'))));
    if (!list) return h('section', { class: 'overview radar' }, head);
    const trusted = k.trusted(space), n = signalCounts(list, rdType, rdState);
    const pills = <K extends string>(keys: readonly K[], cur: K, counts: Record<K, number>, label: (k: K) => string, pick: (k: K) => void, kind: string, cls: string) =>
      h('div', { class: cls, role: 'group', 'aria-label': t('rd_filters') },
        ...keys.map(k => h('button', { class: `${cur === k ? 'on' : ''}${kind === 'type' ? ` rd-t-${k}` : ''}`, type: 'button', 'aria-pressed': String(cur === k), 'data-k': `rd-${kind}-${k}`, onclick: () => { pick(k); rdOpen = ''; render(); } },
          kind === 'type' && k !== 'all' ? icon(RD_ICON[k as SignalType], 13) : null, label(k), h('span', { class: 'n' }, String(counts[k])))));
    const filters = h('div', { class: 'rd-filters' },
      pills(['all', ...RADAR_TYPES] as TypeFilter[], rdType, n.types, k => t(`rd_type_${k}` as Key), k => { rdType = k; }, 'type', 'rd-types'),
      pills(['new', 'topic', 'thread', 'dismissed'] as StateFilter[], rdState, n.states, k => t(`rd_state_${k}` as Key), k => { rdState = k; }, 'state', 'theme mem-tabs rd-states'));
    const shown = filterSignals(list, rdType, rdState);
    const sel = shown.find(s => s.id === rdOpen) ?? shown[0];
    const sevDot = (s: Signal) => h('span', { class: `rd-dot rd-sev-${s.severity}`, title: t(`rd_sev_${s.severity}` as Key), 'aria-label': t(`rd_sev_${s.severity}` as Key) });
    const line = (s: Signal) => {
      const todo = signalTodo(s);
      return h('button', { class: `rd-li rd-st-${s.state}${sel?.id === s.id ? ' on' : ''}`, type: 'button', 'data-signal': s.id, 'aria-current': sel?.id === s.id ? 'true' : undefined,
        onclick: () => { rdOpen = s.id; rdAsk = ''; rdErr = ''; render(); } },
        sevDot(s), h('span', { class: `rd-ic rd-t-${s.kind}`, title: t(`rd_type_${s.kind}` as Key) }, icon(RD_ICON[s.kind], 15)),
        h('span', { class: 'rd-main' }, h('span', { class: 'rd-title' }, s.suspect ? h('span', { class: 'rd-suspect', title: t('rd_suspect_tip') }, t('rd_suspect')) : null, s.title),
          todo ? h('span', { class: 'rd-todo', 'data-k': 'rd-todo' }, todo) : null),
        h('span', { class: 'rd-side' }, s.sources.length > 1 ? h('span', { class: 'rd-nsrc' }, tn('rd_sources_n', s.sources.length)) : null, h('span', { class: 'rd-age' }, ago(s.lastAt))));
    };
    const detail = (s: Signal) => {
      const busy = rdBusy === s.id;
      // the main action by type (radarPrimary) in orange, the other one plain; a discussed signal can still become a thread
      // « threads » module off: only the topic button (radar.open is refused).
      const openBtn = (what: 'topic' | 'thread', pri: boolean) => what === 'thread' && !k.modOn(space, 'threads') ? null : what === 'thread'
        ? h('button', { class: `btn${pri ? ' pri' : ''}`, type: 'button', 'data-k': `rd-open-${s.id}`, disabled: busy || !!rdBusy, onclick: () => rdSend(space, { type: 'radar.open' }, s) }, t('rd_open'))
        : h('button', { class: `btn${pri ? ' pri' : ''}`, type: 'button', 'data-k': `rd-topic-${s.id}`, disabled: busy || !!rdBusy, onclick: () => rdSend(space, { type: 'radar.topic' }, s) }, t('rd_open_topic'));
      const main = radarPrimary(s.kind);
      const actions = s.state === 'topic' && trusted ? h('div', { class: 'rd-actions' }, openBtn('thread', true))
        : s.state === 'new' && trusted ? (rdAsk === s.id
        ? h('div', { class: 'rd-dismiss' },
            h('input', { 'data-draft': `rd-reason-${s.id}`, 'data-k': 'rd-reason', maxlength: SIGNAL_REASON_MAX, placeholder: t('rd_reason_ph'), 'aria-label': t('rd_reason_ph'), value: rdReason, autocomplete: 'off',
              oninput: (e: Event) => { rdReason = (e.target as HTMLInputElement).value; render(); },
              onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' && rdReason.trim()) rdSend(space, { type: 'radar.dismiss', reason: rdReason.trim() }, s); else if (e.key === 'Escape') { rdAsk = ''; render(); } } }),
            h('button', { class: 'btn ghost', type: 'button', 'data-k': 'rd-cancel', onclick: () => { rdAsk = ''; rdReason = ''; render(); } }, t('cancel')),
            h('button', { class: 'btn', type: 'button', 'data-k': 'rd-dismiss-ok', disabled: busy || !rdReason.trim(), onclick: () => rdSend(space, { type: 'radar.dismiss', reason: rdReason.trim() }, s) }, t('rd_dismiss_ok')))
        : h('div', { class: 'rd-actions' },
            openBtn(main, true), openBtn(main === 'topic' ? 'thread' : 'topic', false),
            h('button', { class: 'btn ghost', type: 'button', 'data-k': `rd-dismiss-${s.id}`, disabled: busy, onclick: () => { rdAsk = s.id; rdReason = ''; render(); } }, t('rd_dismiss')))) : null;
      const goto = (id: string, key: Key, k: string) => h('a', { href: '#', class: 'rd-goto', 'data-k': k, onclick: (e: Event) => { e.preventDefault(); goThread(id); } }, t(key));
      const after = s.state === 'thread' && s.thread ? h('span', {}, s.topic ? goto(s.topic, 'rd_goto_topic', 'rd-goto-topic') : null, s.topic ? ' · ' : null, goto(s.thread, 'rd_goto', 'rd-goto'))
        : s.state === 'topic' && s.topic ? goto(s.topic, 'rd_goto_topic', 'rd-goto-topic')
        : s.state === 'dismissed' && s.reason ? h('span', { class: 'rd-reason' }, t('rd_reason', { reason: s.reason })) : null;
      return h('article', { class: `rd-detail rd-${s.severity}`, 'data-detail': s.id },
        h('div', { class: 'rd-dhead' }, h('button', { class: 'btn ic rd-back', type: 'button', 'data-k': 'rd-back', title: t('mem_back'), 'aria-label': t('mem_back'), onclick: () => { rdOpen = ''; rdAsk = ''; render(); } }, '‹'),
          h('span', { class: `rd-sev rd-sev-${s.severity}` }, sevDot(s), t(`rd_sev_${s.severity}` as Key)), h('span', { class: `rd-kind rd-t-${s.kind}` }, icon(RD_ICON[s.kind], 13), t(`rd_type_${s.kind}` as Key)),
          s.suspect ? h('span', { class: 'rd-suspect', title: t('rd_suspect_tip') }, t('rd_suspect')) : null),
        h('h3', { class: 'rd-dtitle' }, s.title),
        h('div', { class: 'rd-secs' }, ...summarySections(s.summary).map(x => h('section', { class: 'rd-sec' },
          x.label ? h('div', { class: 'rd-lbl' }, x.label, x.note ? h('span', { class: 'rd-note' }, ` · ${x.note}`) : null) : null, h('p', {}, x.text)))),
        s.date || s.gain || s.trial ? h('ul', { class: 'rd-facts' },
          s.date ? h('li', { 'data-k': 'rd-date' }, t('rd_date', { date: s.date })) : null,
          s.gain ? h('li', { 'data-k': 'rd-gain' }, t('rd_gain', { gain: s.gain })) : null,
          s.trial ? h('li', { 'data-k': 'rd-trial' }, t('rd_trial', { trial: s.trial })) : null) : null,
        h('div', { class: 'rd-lbl' }, tn('rd_sources_n', s.sources.length)),
        h('ul', { class: 'rd-sources' }, ...s.sources.map(u => h('li', {}, h('a', { href: u, target: '_blank', rel: 'noopener noreferrer nofollow' }, u.replace(/^https:\/\/(www\.)?/, ''))))),
        h('div', { class: 'rd-meta' }, t('rd_seen', { n: s.seen, when: ago(s.lastAt) }), ' · ', t('rd_by', { agent: cap(s.agent) }), after ? ' · ' : null, after),
        rdErr ? h('div', { class: 'err', role: 'status' }, rdErr) : null,
        actions);
    };
    return h('section', { class: `overview radar${rdOpen && sel?.id === rdOpen ? ' has-open' : ''}` }, head, h('div', { class: 'scroll' }, filters,
      shown.length ? h('div', { class: 'rd-lay' }, h('div', { class: 'rd-items', role: 'list' }, ...shown.map(line)), detail(sel!)) : radarEmptyView(space)));
  }
  return {
    el: radarView,
    frame(f) { if (f.type !== 'radar.list') return false; radarBy.set(f.space, f.signals); return true; },
    event(f) {
      if (f.type !== 'event' || f.event !== 'radar.updated') return false;
      const l = radarBy.get(f.data.space); if (l) radarBy.set(f.data.space, upsertSignal(l, f.data));
      return true;
    },
    entered(space, online, adm) {
      if (radarFor !== space && online) { radarFor = space; k.post({ type: 'radar.list', client_id: newCid(), space });
        // Admins: the Radar config too, for the « last pass · next » line of the empty list (radarcfg.get is admin-only).
        if (adm) k.post({ type: 'radarcfg.get', client_id: newCid(), space }); }
    },
    left() { radarFor = ''; rdAsk = ''; rdErr = ''; rdOpen = ''; },
    by: radarBy,
    detail: () => rdOpen,
  };
}
