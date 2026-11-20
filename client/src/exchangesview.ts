// Exchanges view (protocol/exchanges.ts, docs/design-mail-exchanges.md): the mails of the space's correspondents,
// imported on a lead's request by an agent. Leads only (the hub checks every frame). A mail is untrusted data: plain
// text only, links never clickable, never rendered as Markdown nor HTML.
// Its own file since the modules refactor: main.ts keeps the sidebar entry, the route hook, Your turn and Settings ›
// Correspondents (which reads EX_ROLE and the lists kept here).
import type { HubFrame } from '../../protocol/frames.ts';
import { correspondentLabel, exchangeWho, needsSummary, openRequests, splitQuote, summaryStale, type Correspondent, type Exchange, type ExchangeMail, type ExchangeRequest } from '../../protocol/exchanges.ts';
import { EX_FILTERS, correspondentById, exchangeCounts, filterExchanges, requestOrder, upsertExchange, type ExFilter } from './exchanges.ts';
import { routeOf } from './route.ts';
import { lang, type Key } from './i18n.ts';
import type { UiKit } from './modules.ts';
import type { View } from './route.ts';

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export const EX_ROLE: Record<Correspondent['role'], Key> = { client: 'ex_role_client', supplier: 'ex_role_supplier', other: 'ex_role_misc' };

export interface ExchangesModule {
  el(space: string): HTMLElement;
  /** `exchange.updated` / `exchange.removed`: true = handled (the caller renders). */
  event(f: HubFrame): boolean;
  /** The route shows the view: listed on every entry, then kept up to date by the events (never polled). */
  entered(space: string, online: boolean): void;
  left(): void;
  /** Correspondents and exchanges per space (Your turn, Settings › Correspondents). */
  by: Map<string, { correspondents: Correspondent[]; exchanges: Exchange[] }>;
  /** Asks the list of a space (`quiet`: at sync, for Your turn). */
  list(space: string, quiet?: boolean): Promise<void>;
  /** Your turn card of an exchange due. */
  dueCard(x: Exchange): HTMLElement;
  /** The unfolded exchange ('' = none). */
  unfold(id: string): void;
  /** Opens a mail of an exchange (a `mail:` source of a memory entry): all states, any correspondent, mail unfolded. */
  openMail(exchange: string, mail: string): void;
  /** The unfolded exchange ('' = none): a detail screen for the view transition. */
  detail(): string;
}

/** `opened`: a thread or topic created by a request, shown; `go`: another view of the app, no selection. */
export function exchangesModule(k: UiKit, admin: (space: string) => boolean, opened: (thread: string) => unknown, go: (view: View) => void): ExchangesModule {
  const { h, t, tn, icon, render, request, errText, spaceName, menuBtn, ago, withIcon } = k;
  const exBy = new Map<string, { correspondents: Correspondent[]; exchanges: Exchange[] }>();
  let exFor = '', exState: ExFilter = 'all', exCorr = '', exOpen = '', exBusy = '', exErr = '', exDelAsk = '', exNote = '';
  let exDetail: { id: string; version: number; mails: ExchangeMail[] } | null = null, exLoading = '';
  const exBodies = new Map<string, string>(), exUnfold = new Set<string>(), exQuote = new Set<string>();
  const exDate = (ms: number, time = true) => new Date(ms).toLocaleString(lang(), time ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : { day: 'numeric', month: 'short' });
  async function exList(space: string, quiet = false) {
    const r = await request({ type: 'exchange.list', space }, 8000, true);
    if (r?.type === 'exchange.list') exBy.set(space, { correspondents: r.correspondents, exchanges: r.exchanges });
    else if (!quiet) exErr = errText(r?.type === 'error' ? r.code : 'timeout');
    render();
  }
  /** Mails of the open exchange, asked again when its version moves (a new mail, a closing). */
  async function exLoad(space: string, x: Exchange) {
    const k = `${x.id}:${x.version}`;
    if (exLoading === k || (exDetail?.id === x.id && exDetail.version === x.version)) return;
    exLoading = k;
    const r = await request({ type: 'exchange.get', space, id: x.id }, 8000, true);
    if (exLoading !== k) return;
    exLoading = '';
    if (r?.type === 'exchange.get') { exDetail = { id: r.exchange.id, version: r.exchange.version, mails: r.mails }; for (const m of r.mails) if (m.body !== undefined) exBodies.set(m.id, m.body); }
    else exErr = errText(r?.type === 'error' ? r.code : 'timeout');
    render();
  }
  /** A memory source « mail:<exchange>/<mail> » (Propose to memory): a link to the mail for a lead, a plain label for the others. */
  /** A body kept out of `exchange.get` (large, or beyond the frame budget): text from the hub, or a short-lived S3 link. */
  async function exBody(space: string, x: string, m: ExchangeMail) {
    if (exBodies.has(m.id)) return;
    exBodies.set(m.id, '');
    const r = await request({ type: 'exchange.body', space, id: x, mail: m.id }, 8000, true);
    let text: string | null = r?.type === 'exchange.body' && typeof r.text === 'string' ? r.text : null;
    if (text === null && r?.type === 'exchange.body' && r.url) text = await fetch(r.url).then(res => res.ok ? res.text() : null).catch(() => null);
    if (text === null) { exBodies.delete(m.id); exErr = t('ex_err_body'); } else exBodies.set(m.id, text);
    render();
  }
  const exErrOf = (code: string) => code === 'stale' ? t('rd_err_stale') : code === 'no_agent' ? t('ex_err_no_agent') : code === 'running' ? t('ex_err_running')
    : code === 'unreached' ? t('ex_err_unreached') : errText(code);
  /** « Summarise » on an exchange, or « Propose to memory » on one of its mails: a hidden run of the summary agent. */
  async function exRun(space: string, x: Exchange, mail?: string) {
    exBusy = x.id; exErr = ''; exNote = ''; render();
    const r = await request(mail ? { type: 'exchange.remember', space, id: x.id, mail } : { type: 'exchange.summarize', space, id: x.id }, 8000, true);
    exBusy = '';
    if (!r || r.type === 'error') exErr = exErrOf(r?.type === 'error' ? r.code : 'timeout'); else exNote = t(mail ? 'ex_remember_started' : 'ex_summarize_started');
    render();
  }
  /** A lead on a request: tick, untick, remove, or open a thread or a Lounge topic from it (then go to it). */
  async function exReq(space: string, x: Exchange, rq: ExchangeRequest, op: 'done' | 'open' | 'delete' | 'thread' | 'topic') {
    exBusy = x.id; exErr = ''; exNote = ''; render();
    const r = await request({ type: 'exchange.request', space, id: x.id, version: x.version, req: rq.id, op }, 8000, true);
    exBusy = '';
    if (!r || r.type === 'error') { exErr = exErrOf(r?.type === 'error' ? r.code : 'timeout'); render(); return; }
    if ((op === 'thread' || op === 'topic') && r.type === 'ack' && r.thread) { return opened(r.thread); }
    render();
  }
  /** Now › Your turn: an exchange ours for 3 days (leads only, no push); a click opens it in its space's Exchanges. */
  function exDueCard(x: Exchange) {
    const l = exBy.get(x.space), c = l ? correspondentById(l.correspondents, x.correspondent) : null;
    return h('button', { class: 'ex-due', type: 'button', 'data-k': `exdue:${x.id}`, onclick: () => { go({ kind: 'exchanges', id: x.space }); exOpen = x.id; exState = 'all'; exCorr = ''; render(); } },
      h('span', { class: 'rd-ic' }, icon('mail', 15)),
      h('span', { class: 'ex-due-main' }, h('b', {}, x.subject), h('span', { class: 'ex-who' }, [c ? exchangeWho(x, c) : '', spaceName(x.space)].filter(Boolean).join(' · '))),
      h('span', { class: 'ex-st ex-us' }, t('ex_state_us'), ` · ${t('ex_since', { when: ago(x.lastIn ?? x.lastAt) })}`));
  }
  async function exAct(space: string, x: Exchange, type: 'exchange.close' | 'exchange.reopen' | 'exchange.delete') {
    exBusy = x.id; exErr = ''; render();
    const r = await request({ type, space, id: x.id, version: x.version }, 8000, true);
    exBusy = '';
    if (!r || r.type === 'error') { exErr = r?.type === 'error' && r.code === 'stale' ? t('rd_err_stale') : errText(r?.type === 'error' ? r.code : 'timeout'); render(); return; }
    if (type === 'exchange.delete') { exDelAsk = ''; exOpen = ''; exDetail = null; const l = exBy.get(space); if (l) l.exchanges = l.exchanges.filter(e => e.id !== x.id); }
    render();
  }
  function exchangesView(space: string) {
    const data = exBy.get(space);
    const head = h('header', { class: 'mx-head' }, menuBtn(), h('div', {}, h('h2', {}, withIcon('mail', t('ex_title', { space: spaceName(space) }), 18)), h('p', {}, data ? t('ex_intro') : t('ex_loading'))));
    if (!data) return h('section', { class: 'overview exchanges' }, head, exErr ? h('div', { class: 'scroll' }, h('div', { class: 'err', role: 'status' }, exErr)) : null);
    const cs = data.correspondents, n = exchangeCounts(data.exchanges, exCorr);
    const filters = h('div', { class: 'rd-filters' },
      h('div', { class: 'theme mem-tabs rd-states', role: 'group', 'aria-label': t('rd_filters') }, ...EX_FILTERS.map(k => h('button', { class: exState === k ? 'on' : '', type: 'button', 'aria-pressed': String(exState === k), 'data-k': `ex-state-${k}`,
        onclick: () => { exState = k; exOpen = ''; render(); } }, t(`ex_state_${k}` as Key), h('span', { class: 'n' }, String(n[k]))))),
      cs.length > 1 ? h('select', { class: 'ex-sel', 'data-k': 'ex-corr', 'aria-label': t('ex_corr_all'), onchange: (e: Event) => { exCorr = (e.target as HTMLSelectElement).value; exOpen = ''; render(); } },
        h('option', { value: '', selected: !exCorr }, t('ex_corr_all')), ...cs.map(c => h('option', { value: c.id, selected: exCorr === c.id }, correspondentLabel(c)))) : null);
    const shown = filterExchanges(data.exchanges, exState, exCorr);
    const sel = shown.find(x => x.id === exOpen) ?? shown[0];
    if (sel) void exLoad(space, sel);
    const who = (x: Exchange) => { const c = correspondentById(cs, x.correspondent); return c ? exchangeWho(x, c) : t('ex_corr_gone'); };
    const role = (x: Exchange) => { const c = correspondentById(cs, x.correspondent); return c ? h('span', { class: 'ex-role' }, t(EX_ROLE[c.role])) : null; };
    const pill = (x: Exchange) => h('span', { class: `ex-st ex-${x.state}` }, t(`ex_state_${x.state}` as Key));
    const line = (x: Exchange) => h('button', { class: `rd-li ex-li ex-li-${x.state}${sel?.id === x.id ? ' on' : ''}`, type: 'button', 'data-exchange': x.id, 'aria-current': sel?.id === x.id ? 'true' : undefined,
      onclick: () => { exOpen = x.id; exDelAsk = ''; exErr = ''; exNote = ''; render(); } },
      h('span', { class: `ex-dot ex-${x.state}`, title: t(`ex_state_${x.state}` as Key) }), h('span', { class: 'rd-ic' }, icon('mail', 15)),
      h('span', { class: 'rd-main' }, h('span', { class: 'rd-title' }, x.subject), h('span', { class: 'ex-who' }, who(x), role(x), ` · ${tn('ex_mails_n', x.count)}`,
        openRequests(x) ? h('span', { class: 'ex-nreq', 'data-k': 'ex-nreq' }, ` · ${tn('ex_reqs_n', openRequests(x))}`) : null)),
      h('span', { class: 'rd-side' }, pill(x), h('span', { class: 'rd-age' }, ago(x.lastAt))));
    const mailEl = (x: Exchange, m: ExchangeMail, last: boolean) => {
      const open = last || exUnfold.has(m.id), body = exBodies.get(m.id);
      const dir = h('span', { class: `ex-dir${m.dir === 'out' ? ' ex-o' : ''}`, title: t(m.dir === 'out' ? 'ex_sent' : 'ex_received') }, icon(m.dir === 'out' ? 'arrowUp' : 'arrowDown', 14));
      const name = m.from.name || m.from.addr;
      if (!open) return h('button', { class: 'ex-mail ex-fold', type: 'button', 'data-mail': m.id, onclick: () => { exUnfold.add(m.id); render(); } },
        dir, h('b', {}, name.split(/\s+/)[0]), h('span', { class: 'ex-sn' }, (body ?? '').replace(/\s+/g, ' ').slice(0, 160)), h('span', { class: 'ex-date' }, exDate(m.date)));
      if (body === undefined) void exBody(space, x.id, m);
      const parts = body ? splitQuote(body) : null;
      return h('article', { class: 'ex-mail', 'data-mail': m.id },
        h('div', { class: 'ex-mh' }, dir, h('b', {}, name), h('span', { class: 'ex-date' }, exDate(m.date)),
          last ? null : h('button', { class: 'btn ic ex-close', type: 'button', title: t('ex_fold'), 'aria-label': t('ex_fold'), onclick: () => { exUnfold.delete(m.id); render(); } }, '×')),
        h('div', { class: 'ex-to' }, t('ex_to', { who: [...m.to, ...(m.cc ?? [])].map(a => a.name || a.addr).join(', ') })),
        body ? h('div', { class: 'ex-body' }, parts!.own) : h('div', { class: 'ex-body ex-wait' }, t('ex_loading')),
        parts?.quote ? (exQuote.has(m.id) ? h('div', { class: 'ex-body ex-quoted' }, parts.quote)
          : h('button', { class: 'linkbtn ex-q', type: 'button', onclick: () => { exQuote.add(m.id); render(); } }, t('ex_quote'))) : null,
        m.truncated ? h('div', { class: 'ex-q' }, t('ex_truncated')) : null,
        h('div', { class: 'ex-macts' }, h('button', { class: 'linkbtn', type: 'button', 'data-k': 'ex-remember', disabled: exBusy === x.id, title: t('ex_remember_tip'), onclick: () => exRun(space, x, m.id) }, t('ex_remember'))));
    };
    const mailDay = (id: string) => { const m = exDetail?.mails.find(y => y.id === id); return m ? exDate(m.date, false) : ''; };
    const sumEl = (x: Exchange) => {
      const s = x.summary;
      return h('div', { class: 'ex-sum', 'data-k': 'ex-sum' },
        h('div', { class: 'rd-lbl' }, t('ex_sum'), summaryStale(x) ? h('span', { class: 'ex-stale', 'data-k': 'ex-stale' }, t('ex_sum_stale')) : null,
          needsSummary(x) ? h('button', { class: 'linkbtn ex-sumgo', type: 'button', 'data-k': 'ex-summarize', disabled: exBusy === x.id, onclick: () => exRun(space, x) }, t('ex_summarize')) : null),
        s ? h('div', { class: 'ex-sum-text' }, s.status) : h('div', { class: 'ex-sum-none' }, t('ex_sum_none')),
        s?.decisions.length ? h('ul', { class: 'ex-dec', 'aria-label': t('ex_decisions') }, ...s.decisions.map(d => h('li', {}, d))) : null,
        s ? h('div', { class: 'ex-q' }, t('ex_sum_through', { when: exDate(s.throughAt) }), ` · ${cap(s.agent)}`) : null);
    };
    // Keys carry the request: morphdom matches `data-k` across the whole list, so a key shared by two rows kept the old
    // button beside the new link when one row switched.
    const reqEl = (x: Exchange, r: ExchangeRequest) => h('div', { class: `ex-req${r.done ? ' done' : ''}`, 'data-req': r.id },
      h('input', { type: 'checkbox', checked: !!r.done, disabled: exBusy === x.id, 'data-k': 'ex-req-done', 'aria-label': r.what, onchange: () => exReq(space, x, r, r.done ? 'open' : 'done') }),
      h('span', { class: `ex-side ex-side-${r.side}`, title: t(r.side === 'us' ? 'ex_req_us_tip' : 'ex_req_them_tip') }, t(r.side === 'us' ? 'ex_req_us' : 'ex_req_them')),
      h('span', { class: 'ex-req-what' }, r.what, mailDay(r.mail) ? h('button', { class: 'linkbtn ex-req-mail', type: 'button', onclick: () => { exUnfold.add(r.mail); render(); requestAnimationFrame(() => document.querySelector(`[data-mail="${r.mail}"]`)?.scrollIntoView({ block: 'nearest' })); } },
        t('ex_req_mail', { when: mailDay(r.mail) })) : null),
      r.thread ? h('a', { class: 'btn ghost', href: routeOf({ kind: 'space', id: space }, r.thread), 'data-k': `ex-req-go:${r.id}` }, t('ex_req_go'))
        : r.done || !k.modOn(space, 'threads') ? null : h('button', { class: 'btn ghost', type: 'button', 'data-k': `ex-req-thread:${r.id}`, disabled: exBusy === x.id, onclick: () => exReq(space, x, r, 'thread') }, t('ex_req_thread')),
      r.topic ? h('a', { class: 'btn ghost', href: routeOf({ kind: 'lounge', id: space }, r.topic), 'data-k': `ex-req-topic-go:${r.id}` }, t('ex_req_topic_go'))
        : r.done ? null : h('button', { class: 'btn ghost', type: 'button', 'data-k': `ex-req-topic:${r.id}`, disabled: exBusy === x.id, title: t('ex_req_topic_tip'), onclick: () => exReq(space, x, r, 'topic') }, t('ex_req_topic')),
      h('button', { class: 'btn ic ghost ex-req-del', type: 'button', 'data-k': 'ex-req-del', title: t('ex_req_del'), 'aria-label': t('ex_req_del'), disabled: exBusy === x.id, onclick: () => exReq(space, x, r, 'delete') }, '×'));
    const detail = (x: Exchange) => {
      const busy = exBusy === x.id, mails = exDetail?.id === x.id ? exDetail.mails : null;
      const by = x.source.startsWith('agent:') ? cap(x.source.slice(6)) : x.source;
      return h('article', { class: 'rd-detail ex-detail', 'data-detail': x.id },
        h('div', { class: 'rd-dhead' }, h('button', { class: 'btn ic rd-back', type: 'button', 'data-k': 'ex-back', title: t('mem_back'), 'aria-label': t('mem_back'), onclick: () => { exOpen = ''; render(); } }, '‹'),
          h('span', { class: `ex-st ex-${x.state}` }, t(`ex_state_${x.state}` as Key), x.state === 'closed' || Date.now() - x.lastAt < 60_000 ? null : ` · ${t('ex_since', { when: ago(x.lastAt) })}`),
          h('span', { class: 'rd-kind' }, icon('mail', 13), who(x)), role(x)),
        h('h3', { class: 'rd-dtitle' }, x.subject),
        h('div', { class: 'rd-meta ex-meta' }, tn('ex_mails_n', x.count), ' · ', t('ex_span', { from: exDate(x.firstAt, false), to: exDate(x.lastAt, false) }), ' · ', t('ex_imported', { who: by, when: exDate(x.at, false) })),
        exErr ? h('div', { class: 'err', role: 'status' }, exErr) : null,
        exNote ? h('div', { class: 'sp-notice', role: 'status', 'data-k': 'ex-note' }, exNote) : null,
        h('div', { class: 'rd-actions ex-actions' },
          x.state === 'closed'
            ? h('button', { class: 'btn', type: 'button', 'data-k': 'ex-reopen', disabled: busy, onclick: () => exAct(space, x, 'exchange.reopen') }, t('ex_reopen'))
            : h('button', { class: 'btn', type: 'button', 'data-k': 'ex-close', disabled: busy, onclick: () => exAct(space, x, 'exchange.close') }, t('ex_close')),
          h('span', { class: 'grow' }),
          h('button', { class: 'btn ghost', type: 'button', 'data-k': 'ex-delete', disabled: busy, onclick: () => { if (exDelAsk !== x.id) { exDelAsk = x.id; render(); return; } exAct(space, x, 'exchange.delete'); } },
            exDelAsk === x.id ? tn('ex_delete_confirm', x.count) : t('ex_delete'))),
        sumEl(x),
        h('div', { class: 'ex-reqs', 'data-k': 'ex-reqs' }, h('div', { class: 'rd-lbl' }, t('ex_reqs')),
          ...(x.requests?.length ? requestOrder(x.requests).map(r => reqEl(x, r)) : [h('div', { class: 'ex-sum-none' }, t('ex_reqs_none'))])),
        h('div', { class: 'rd-lbl' }, t('ex_mails')),
        mails ? h('div', { class: 'ex-mails' }, ...mails.map((m, i) => mailEl(x, m, i === mails.length - 1))) : h('div', { class: 'ex-mails' }, h('div', { class: 'empty' }, t('ex_loading'))));
    };
    const empty = h('div', { class: 'rd-empty mem-none', 'data-k': 'ex-empty' }, h('div', { class: 'rd-big' }, icon('mail', 26)),
      h('h3', {}, t(!cs.length ? 'ex_none_corr' : data.exchanges.length ? 'mem_none' : 'ex_none')),
      h('p', {}, t(!cs.length ? 'ex_none_corr_text' : 'ex_none_text')),
      !cs.length && admin(space) ? h('a', { href: routeOf({ kind: 'settings', id: space, tab: 'contacts' }, null), 'data-k': 'ex-settings' }, t('ex_settings')) : null);
    return h('section', { class: `overview exchanges${exOpen && sel?.id === exOpen ? ' has-open' : ''}` }, head, h('div', { class: 'scroll' }, cs.length ? filters : null,
      shown.length ? h('div', { class: 'rd-lay' }, h('div', { class: 'rd-items', role: 'list' }, ...shown.map(line)), detail(sel!)) : empty));
  }
  return {
    el: exchangesView,
    event(f) {
      if (f.type !== 'event') return false;
      if (f.event === 'exchange.updated') { const l = exBy.get(f.data.space); if (l) l.exchanges = upsertExchange(l.exchanges, f.data); }
      else if (f.event === 'exchange.removed') { const l = exBy.get(f.data.space); if (l) l.exchanges = l.exchanges.filter(e => e.id !== f.data.id); if (exOpen === f.data.id) exOpen = ''; }
      else return false;
      return true;
    },
    entered(space, online) { if (exFor !== space && online) { exFor = space; exErr = ''; exDetail = null; void exList(space); } },
    left() { exFor = ''; exOpen = ''; exDelAsk = ''; exErr = ''; exDetail = null; exUnfold.clear(); exQuote.clear(); },
    by: exBy,
    list: exList,
    dueCard: exDueCard,
    unfold(id) { exOpen = id; },
    openMail(exchange, mail) { exOpen = exchange; exState = 'all'; exCorr = ''; exUnfold.add(mail); },
    detail: () => exOpen,
  };
}
