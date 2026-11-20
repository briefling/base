// Conversation cards: the « Thread proposed » card (and its other-space variant), the « Create this issue? », AWS
// elevation, « Launch this plan? », brief draft and « To decide » cards, the Settings' « Draft with <agent> » panel,
// and the topic card of the Lounge feed. Their own file since the modules refactor: main.ts keeps `messageEl`, which
// picks the card, and the helpers other zones share (`cardBand`, `kindIc`, `chip`, `richText`, the GitHub links).
// `S` is main.ts' app state they read and write (view, selection, open folds, picks of the « To decide » cards).
import { ELEVATION_ROLE, type ElevationError, type Message, type PlanError, type PlanStep, type PublicThread, type SpaceSettings, type ThreadState } from '../../protocol/frames.ts';
import { parseRepos, draftRequest, lineDiff, MAX_DRAFT_REPOS } from './about.ts';
import { askStart, askAnswerText, askAnswered, type AskPick } from './ask.ts';
import { workingAgents } from './busy.ts';
import { elevationPageUrl, elevationState } from './elevation.ts';
import { aboutFold, foldsBrief, offCardLabel } from './fold.ts';
import type { Key } from './i18n.ts';
import { loungeCard, topicName, generalOf, topicCardWhen } from './lounge.ts';
import { renderMarkdown } from './markdown.ts';
import type { UiKit } from './modules.ts';
import { cur } from './patch.ts';
import { isBoardPlan, planButtons, planProgress, planStepState, type PlanStepState } from './plan.ts';
import type { View } from './route.ts';
import { dotMarks, linkChip, markCount, rowMark, topicFamily, type RowMark } from './spawned.ts';

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const newCid = () => b64url(crypto.getRandomValues(new Uint8Array(32))).slice(0, 20); // same ids as main.ts' rand()

/** The part of main.ts' app state the cards read and write. */
export interface CardsShared {
  me: string;
  view: View;
  sel: string | null;
  err: string;
  admin: boolean;
  threads: Map<string, PublicThread>;
  msgs: Map<string, Map<string, Message>>;
  trusted: Set<string>;
  askPicks: Map<string, AskPick[]>;
  askSent: Set<string>;
  briefOpen: Set<string>;
  aboutAsk: { space: string; repos: string; notes: string; err: string } | null;
  aboutApply: { space: string; text: string; base: string; thread: string; msg: string } | null;
  newTopicCid: string;
}
/** What main.ts lends the cards beyond the UiKit. */
export interface CardsDeps {
  /** Global admin, or admin of this space. */
  spaceAdmin(space: string): boolean;
  /** Shows a thread or topic (after the caller set the view). */
  open(id: string | null): void;
  goThread(id: string): void;
  /** State chip of a thread. */
  chip(f: PublicThread): HTMLElement | null;
  /** « Archived by X » of an archived thread (tooltip of its line), null otherwise. */
  archivedTip(f: PublicThread): string | null;
  richText(text: string, space: string): Node[];
  mdOpts(space: string): { fold: string } | undefined;
  /** Display name of a message's author. */
  who(m: Message): string;
  /** Link to a checked GitHub URL (plain text otherwise). */
  ghLink(u: string | undefined, text: string): HTMLElement | string;
  /** Round icon of a done card. */
  kindIc(name: string): HTMLElement;
  /** The Settings form has unsaved changes. */
  dirty(): boolean;
  /** Topic card of the Lounge feed. */
  unread(f: PublicThread): boolean;
  shown(f: PublicThread): ThreadState;
  label(st: ThreadState): string;
  pressAttrs(menu: { kind: 'card'; id: string }): Record<string, unknown>;
  cardMenu(f: PublicThread): HTMLElement | null;
  familyIndent(depth: number): { class?: string; style?: string };
  messageEl(m: Message, all: Message[], th: PublicThread, cont?: boolean): HTMLElement | null;
  avatarClass(a: Message['author']): string;
  face(src: string, name: string): Node;
  authorDot(a: Message['author'], space: string): HTMLElement | null;
  fullDate(ts: number): string;
  hhmm(ts: number): string;
}
export interface Cards {
  proposeEl(m: Message, all: Message[], f: PublicThread): HTMLElement;
  issueCardEl(m: Message, f: PublicThread): HTMLElement;
  elevationCardEl(m: Message, f: PublicThread): HTMLElement;
  planCardEl(m: Message, f: PublicThread): HTMLElement;
  aboutEl(m: Message, all: Message[], f: PublicThread): HTMLElement;
  decideEl(m: Message, all: Message[], th: PublicThread): HTMLElement;
  /** Settings, « Draft with <agent> » panel under the brief. */
  aboutAskEl(cur: SpaceSettings): HTMLElement;
  topicCard(f: PublicThread, at: number, cont?: boolean): HTMLElement;
  /** The only words left on a thread line (also the Recents pane's). */
  rowLabel(x: PublicThread, m: RowMark): HTMLElement | null;
}

export function cardsModule(kit: UiKit, S: CardsShared, d: CardsDeps): Cards {
  const { h, icon, t, tn, render, send, spaceName, personName, withIcon, ago, since, personAvatar, cardBand, go } = kit;
  const { spaceAdmin, open, goThread, chip, archivedTip, richText, mdOpts, who, ghLink, kindIc, dirty, unread, shown, label, pressAttrs, cardMenu, familyIndent, messageEl,
    avatarClass, face, authorDot, fullDate, hhmm } = d;
  /** Topic in the feed: an author line, then the topic as a round bubble (unread
   *  dot, bubble icon, title, last activity, its threads' marks in miniature) and every thread opened from it as a plain
   *  line under the bubble (no frame, no link line) on a faded graph-paper layer; the bubble opens the topic, a line that
   *  thread. A topic born from a Bar message shows that message as written (text, files, reactions) as its author line.
   *  Time = creation. */
  /** Chip of a link card (opened thread, created issue): « Archived » like the lists, else the state chip. */
  const linkChipEl = (x: PublicThread) => linkChip(x) === 'archived' ? h('span', { class: 'chip c-calm' }, t('archived_b')) : chip(x);
  /** State icon of a thread line on a topic card; its tooltip and aria-label say the full state (what the chip said). */
  const rowMarkEl = (x: PublicThread, m: RowMark) => {
    const say = archivedTip(x) ?? chip(x)?.textContent ?? '';
    return h('span', { class: `fc-mark m-${m}`, role: 'img', 'aria-label': say, title: say }, ...markIcon(m));
  };
  /** Later is the clock of the Later entry and filter, archived the archive box; the other marks are drawn in CSS. */
  const markIcon = (m: RowMark) => m === 'later' || m === 'archived' ? [icon(m === 'later' ? 'later' : 'archive', 13) as unknown as Node] : [];
  /** The only words left on a thread line (no chip per line): « Your turn », « Waiting », « <agent> working » during a turn. */
  const rowLabel = (x: PublicThread, m: RowMark) => m === 'you' || m === 'wait' ? h('span', { class: `fc-lbl m-${m}` }, m === 'you' && x.pendingApproval ? t('state_approve') : label(m))
    : m === 'run' && x.state === 'run' ? h('span', { class: 'fc-lbl m-run' }, t('fc_working', { agent: workingAgents(x).map(cap).join(', ') })) : null;
  function topicCard(f: PublicThread, at: number, cont = false) {
    const go = () => open(f.id), state = `${S.sel === f.id ? 'sel' : ''} ${unread(f) ? 'unread' : ''}`, act = topicCardWhen(f, unread);
    const kids = topicFamily(f, id => S.threads.get(id)); // threads opened from its threads too, under their parent
    const marks = kids.map(({ f: x }) => rowMark(x, shown(x))), cnt = markCount(marks);
    const block = h('div', { class: `fc-att ${state}`, ...pressAttrs({ kind: 'card', id: f.id }), tabindex: 0, role: 'link',
        onclick: (e: Event) => { e.stopPropagation(); go(); }, onkeydown: (e: KeyboardEvent) => e.key === 'Enter' && go() },
      h('div', { class: 'fc-head' }, act.unread ? h('span', { class: 'fc-dot', 'aria-hidden': 'true' }) : null, icon('messageCircle', 13) as unknown as Node,
        h('span', { class: 'fc-title' }, topicName(f)), act.at ? h('span', { class: 'fc-when', title: fullDate(act.at) }, ago(act.at)) : null,
        cnt ? h('span', { class: 'fc-dots', role: 'img', 'aria-label': tn('fc_count_tip', cnt.total, { done: cnt.done }), title: tn('fc_count_tip', cnt.total, { done: cnt.done }) },
          ...dotMarks(marks).map(d => d.n ? h('span', { class: `fc-mark m-${d.mark} fc-n`, 'data-n': String(d.n) }, `✓ ${d.n}`) : h('span', { class: `fc-mark m-${d.mark}` }, ...markIcon(d.mark)))) : null, f.state === 'run' ? chip(f) : null),
      cardMenu(f));
    // Its threads: plain lines under the bubble; the graph paper is a layer of its own so its fade never touches the text.
    const lines = kids.length ? h('div', { class: 'fc-threads' }, h('span', { class: 'fc-bg', 'aria-hidden': 'true' }),
      ...kids.map(({ f: x, depth }, i) => h('a', { href: '#', 'data-k': `fct:${x.id}`, 'data-st': marks[i], title: [x.title, archivedTip(x)].filter(Boolean).join('\n'), ...familyIndent(depth), onclick: (e: Event) => { e.preventDefault(); e.stopPropagation(); goThread(x.id); } },
        rowMarkEl(x, marks[i]), h('span', { class: 'sp-title' }, x.title), rowLabel(x, marks[i])))) : null;
    const gen = generalOf(S.threads, f.space), src = f.fromMsg && gen ? S.msgs.get(gen.id)?.get(f.fromMsg) : undefined;
    const el = src && gen ? messageEl(src, [src], gen, cont) : null;
    if (el) { // the « → topic » link would repeat the bubble
      el.querySelector('.subtopic')?.remove();
      el.querySelector(':scope > .m-body')!.after(block, ...(lines ? [lines] : []));
      el.classList.add('fc-msg', 'fc-from'); el.setAttribute('data-k', `c:${f.id}`);
      return el;
    }
    // Opened by an agent on its own (a cron's report): its avatar and name, like its messages.
    const kind = f.authorAgent ? 'agent' : 'human';
    if (cont) return h('div', { class: `m cont ${kind} fc-msg ${state}`, 'data-k': `c:${f.id}` }, h('span', { class: 'm-gut', title: fullDate(at) }, hhmm(at)), block, lines);
    const c = loungeCard(f, S.me, personName), name = c.author?.name ?? t('a_member_cap');
    return h('div', { class: `m ${kind} fc-msg ${state}`, 'data-k': `c:${f.id}` },
      h('div', { class: `avatar ${c.author ? avatarClass({ kind, id: c.author.id }) : ''}` }, face(c.author ? personAvatar(c.author.id, kind, f.space) : '', name), c.author?.agent ? authorDot({ kind: 'agent', id: c.author.id }, f.space) : null),
      h('div', { class: 'm-body' }, h('div', { class: 'm-head' }, h('span', { class: 'm-name' }, name), h('span', { class: 'm-time', title: fullDate(at) }, since(at)))),
      block, lines);
  }
  /** Card proposed for ANOTHER space (`propose.space`), or « Make it a topic? » (`propose.topic`, this space): opening it
   *  creates a topic in that space's Lounge. */
  function proposeAwayEl(m: Message, f: PublicThread) {
    const p = m.propose!, space = spaceName(p.space!), here = !!p.topic && p.space === f.space;
    if (p.status === 'done') {
      const x = p.thread ? S.threads.get(p.thread) : null;
      return x ? h('a', { class: 'opened k-thread', href: '#', title: t(here ? 'propose_here_go' : 'propose_away_go', { space, title: x.title }), 'aria-label': t(here ? 'propose_here_go' : 'propose_away_go', { space, title: x.title }),
          onclick: (e: Event) => { e.preventDefault(); S.view = { kind: 'lounge', id: x.space }; open(x.id); } },
          kindIc('coffee'), h('span', { class: 'ot' }, t(here ? 'propose_here_opened' : 'propose_away_opened', { space }), ' · ', ...richText(x.title, x.space)), icon('chevronRight', 14))
        : h('div', { class: 'propose off' }, t(here ? 'propose_here_opened' : 'propose_away_opened', { space }), ' : ', p.title);
    }
    const title = h('textarea', { class: 'k-title', name: 'title', autocomplete: 'off', rows: 2, maxlength: 80, 'aria-label': t('propose_title_aria'),
      onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') e.preventDefault(); } }, p.title) as HTMLTextAreaElement;
    return h('div', { class: 'propose k-thread' }, cardBand('coffee', t(here ? 'card_topic_here' : 'card_topic_away', { space }), t('card_by', { agent: p.by ? cap(p.by) : t('the_agent') })),
      h('div', { class: 'k-body' }, title,
        p.why ? h('div', { class: 'pw' }, p.why) : null,
        p.brief ? briefEl(m.id, p.brief, f.space) : null,
        h('div', { class: 'pc' }, t(here ? 'propose_ctx_here' : 'propose_ctx_away', { space })),
        h('div', { class: 'opts' },
          h('button', { class: 'btn pri', onclick: () => { const v = cur(title).value.replace(/\s+/g, ' ').trim(); if (v) send({ type: 'action', thread: f.id, kind: 'promote', msg: m.id, title: v }); } }, ...go(t(here ? 'open_topic_here' : 'open_topic_away', { space }))),
          h('button', { class: 'btn ghost', onclick: () => send({ type: 'action', thread: f.id, kind: 'dismiss', msg: m.id }) }, t('not_now')))));
  }
  function proposeEl(m: Message, all: Message[], f: PublicThread) {
    const p = m.propose!;
    if (p.space && (p.space !== f.space || p.topic) && p.status !== 'dismissed' && p.status !== 'superseded') return proposeAwayEl(m, f);
    const off = offCardLabel(p.status, 'propose_dismissed');
    if (off) return offCardEl('thread', t(off), p.title,
      p.why ? h('div', { class: 'pw' }, p.why) : null, p.brief ? h('div', { class: 'pb md' }, renderMarkdown(p.brief, x => richText(x, f.space), mdOpts(f.space))) : null);
    if (p.status === 'done') {
      const x = p.thread ? S.threads.get(p.thread) : null;
      // Small card, clickable on its whole surface: thread icon, title, state chip.
      return x ? h('a', { class: 'opened k-thread', href: '#', title: t('propose_opened_go', { title: x.title }), 'aria-label': t('propose_opened_go', { title: x.title }),
          onclick: (e: Event) => { e.preventDefault(); goThread(x.id); } },
          kindIc('thread'), h('span', { class: 'ot' }, ...richText(x.title, x.space)), linkChipEl(x), icon('chevronRight', 14))
        : h('div', { class: 'propose off' }, t('propose_opened'), p.title);
    }
    const n = all.filter(x => x.id < m.id && x.type !== 'propose' && x.type !== 'about').length;
    // The title on top, big and editable on two lines (a one-line input cut long titles); Enter does not add a line.
    const title = h('textarea', { class: 'k-title', name: 'title', autocomplete: 'off', rows: 2, maxlength: 120, 'aria-label': t('propose_title_aria'),
      onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') e.preventDefault(); } }, p.title) as HTMLTextAreaElement;
    return h('div', { class: 'propose k-thread' }, cardBand('thread', t('card_thread'), t('card_by', { agent: p.by ? cap(p.by) : t('the_agent') })),
      h('div', { class: 'k-body' }, title,
        p.why ? h('div', { class: 'pw' }, p.why) : null,
        // The plan the human approves by opening the thread (it becomes its first message, signed by the agent), whole.
        p.brief ? briefEl(m.id, p.brief, f.space) : null,
        p.context ? contextEl(m.id, p.context, f.space) : null,
        // From a thread, the new one gets only the brief and a link to this thread (not its history); with the agent's
        // context summary, the summary, a link and the newest attachments instead of the topic's messages.
        h('div', { class: 'pc' }, p.context ? t('propose_ctx_summary', { space: spaceName(f.space), owner: f.owner })
          : f.kind === 'topic' ? tn('propose_ctx', n, { space: spaceName(f.space), owner: f.owner }) : t('propose_ctx_thread', { space: spaceName(f.space), owner: f.owner })),
        // « threads » module off (a card for this space left open from before): no Open button, the hub refuses it anyway.
        !p.space || p.space === f.space ? (kit.modOn(f.space, 'threads') ? null : h('div', { class: 'pc', 'data-k': 'threads-off' }, t('threads_off'))) : null,
        h('div', { class: 'opts' },
          p.space && p.space !== f.space || kit.modOn(f.space, 'threads') ? h('button', { class: 'btn pri', onclick: () => { const v = cur(title).value.replace(/\s+/g, ' ').trim(); if (v) send({ type: 'action', thread: f.id, kind: 'promote', msg: m.id, title: v }); } }, ...go(t('open_thread'))) : null,
          h('button', { class: 'btn ghost', onclick: () => send({ type: 'action', thread: f.id, kind: 'dismiss', msg: m.id }) }, t('not_now')))));
  }

  // "Create this issue?" card (`propose_issue`): repo, title and Markdown body as they will be published. Only a trusted
  // human creates it (the hub checks again); the GitHub Lambda then opens its thread and the card becomes a link to it.
  const NI_ERR: Record<string, Key> = { not_installed: 'ni_err_not_installed', github: 'ni_err_github', refused: 'ni_err_refused', thread: 'ni_err_thread', project: 'ni_err_project' };
  function issueCardEl(m: Message, f: PublicThread) {
    const p = m.newIssue!;
    const ref = p.number ? `${p.repo}#${p.number}` : p.repo;
    const off = offCardLabel(p.status, 'ni_dismissed');
    if (off) return offCardEl('github', t(off), p.title, h('div', { class: 'pc' }, p.repo),
      p.body.trim() ? h('div', { class: 'pb md' }, renderMarkdown(p.body, x => richText(x, f.space), mdOpts(f.space))) : null);
    if (p.status === 'pending') return h('div', { class: 'propose off ni-pending' }, t('ni_pending', { repo: p.repo, who: p.approver === S.me ? t('you_lc') : personName(p.approver ?? '') ?? t('a_member') }));
    const err = p.error ? h('div', { class: 'ni-err', role: 'status' }, t(NI_ERR[p.error] ?? 'ni_err_github', { org: p.repo.split('/')[0] })) : null;
    if (p.status === 'done' || p.number) {
      const x = p.thread ? S.threads.get(p.thread) : null;
      const link = x ? h('a', { class: 'opened k-issue', href: '#', title: t('ni_go', { ref }), 'aria-label': t('ni_go', { ref }), onclick: (e: Event) => { e.preventDefault(); goThread(x.id); } },
          kindIc('github'), h('span', { class: 'ot' }, h('span', { class: 'ni-ref' }, ref), ' ', ...richText(x.title, x.space)), linkChipEl(x), icon('chevronRight', 14))
        : h('div', { class: 'propose off' }, t('ni_created'), ghLink(p.url, ref));
      return err ? h('div', { class: 'ni-done' }, link, err) : link;
    }
    const trusted = S.trusted.has(f.space);
    return h('div', { class: 'propose ni k-issue' }, cardBand('github', t('card_issue'), t('card_by_in', { agent: cap(p.by), repo: p.repo })),
      h('div', { class: 'k-body' },
        h('div', { class: 'ni-title' }, p.title),
        p.body.trim() ? h('div', { class: 'pb md' }, renderMarkdown(p.body, x => richText(x, f.space), mdOpts(f.space))) : null,
        h('div', { class: 'pc' }, t('ni_note', { repo: p.repo })),
        err,
        h('div', { class: 'opts' },
          trusted ? h('button', { class: 'btn pri', onclick: () => send({ type: 'action', thread: f.id, kind: 'create_issue', msg: m.id }) }, ...go(t(p.status === 'failed' ? 'ni_retry' : 'ni_create'))) : null,
          h('button', { class: 'btn ghost', onclick: () => send({ type: 'action', thread: f.id, kind: 'dismiss', msg: m.id }) }, t('not_now')),
          trusted ? null : h('span', { class: 'pc' }, t('ni_trusted_only')))));
  }
  // AWS elevation card (`request_elevation`, elevation/CONTRACT.md): approved with a passkey on the approval page of the
  // management account, never here (this app is served from an account the agents administer). The card follows it.
  // The approval page's address is kept on this device only (localStorage), never sent to the hub: the owner pastes it once
  // from the card. Opening it is safe even from an altered app: the passkey is bound to that page's domain, a look-alike
  // page on another domain cannot obtain a valid signature.
  const EL_URL_KEY = 'briefling.elevationUrl';
  let elUrlDraft = '', elUrlBad = false;
  // An open elevation card on screen follows its request by itself: every few seconds while the app is visible (and at
  // once when it becomes visible again), a lead's app sends `poll`, which the hub turns into a card change only once the
  // request is settled (granted, expired, failed). So approving on the page (any device) updates the conversation.
  const EL_POLL_MS = 8_000;
  function pollElevations() {
    if (document.visibilityState !== 'visible' || !S.sel || S.sel === 'new') return;
    const f = S.threads.get(S.sel);
    if (!f || !S.trusted.has(f.space)) return;
    for (const m of S.msgs.get(f.id)?.values() ?? [])
      if (m.type === 'elevation' && m.elevation && elevationState(m.elevation, Date.now()) === 'check')
        send({ type: 'action', thread: f.id, kind: 'elevation', msg: m.id, op: 'poll' });
  }
  setInterval(pollElevations, EL_POLL_MS);
  document.addEventListener('visibilitychange', pollElevations);
  const elevationUrl = () => elevationPageUrl(localStorage.getItem(EL_URL_KEY) ?? '');
  const EL_ERR: Record<ElevationError, Key> = { not_approved: 'el_err_not_approved', expired: 'el_err_expired', failed: 'el_err_failed', unavailable: 'el_err_unavailable' };
  function elevationCardEl(m: Message, f: PublicThread) {
    const e = m.elevation!;
    const st = elevationState(e, Date.now());
    const hm = (x?: number) => x ? new Date(x).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const facts = h('dl', { class: 'el-facts' }, h('dt', {}, t('el_account')), h('dd', {}, e.account), h('dt', {}, t('el_role')), h('dd', {}, ELEVATION_ROLE),
      h('dt', {}, t('el_duration')), h('dd', {}, `${e.minutes} min`));
    if (st === 'closed') return offCardEl('lock', t(e.status === 'revoked' ? 'el_revoked' : 'el_dismissed'), e.reason, facts);
    const trusted = S.trusted.has(f.space);
    const act = (op: 'check' | 'renew' | 'revoke' | 'dismiss') => () => send({ type: 'action', thread: f.id, kind: 'elevation', msg: m.id, op });
    const who = e.checker === S.me ? t('you_lc') : personName(e.checker ?? '') ?? t('a_member');
    const err = e.error && st !== 'renew' ? h('div', { class: 'ni-err', role: 'status' }, t(EL_ERR[e.error] ?? 'el_err_unavailable')) : null;
    const line = st === 'running' ? t('el_running', { who, time: hm(e.expiresAt) }) : st === 'over' ? t('el_over', { time: hm(e.expiresAt) })
      : st === 'renew' ? t('el_expired') : '';
    const buttons = !trusted ? (st === 'check' || st === 'renew' ? [h('span', { class: 'pc' }, t('el_trusted_only'))] : [])
      : st === 'check' ? [
          ...(elevationUrl() ? [h('button', { class: 'btn pri', 'data-k': 'el-open', onclick: () => { window.open(elevationUrl()!, '_blank', 'noopener,noreferrer'); } }, ...go(t('el_open')))] : []),
          h('button', { class: elevationUrl() ? 'btn' : 'btn pri', 'data-k': 'el-check', onclick: act('check') }, t('el_check')),
          h('button', { class: 'btn ghost', onclick: act('dismiss') }, t('not_now'))]
      : st === 'renew' ? [h('button', { class: 'btn pri', 'data-k': 'el-renew', onclick: act('renew') }, t('el_renew')), h('button', { class: 'btn ghost', onclick: act('dismiss') }, t('not_now'))]
      : st === 'running' ? [h('button', { class: 'btn', 'data-k': 'el-revoke', onclick: act('revoke') }, t('el_revoke'))] : [];
    return h('div', { class: `propose el k-elev${st === 'running' || st === 'over' ? ' el-granted' : ''}` }, cardBand('lock', t('card_elev'), t('el_by', { agent: cap(e.agent), minutes: e.minutes })),
      h('div', { class: 'k-body' },
        h('div', { class: 'ni-title' }, e.reason), facts,
        st === 'check' ? h('div', { class: 'pc' }, t('el_note')) : null,
        st === 'check' && trusted && !elevationUrl() ? h('div', { class: 'el-url' },
          h('input', { type: 'url', 'data-k': 'el-url', name: 'url', value: elUrlDraft, placeholder: t('el_url_ph'), autocomplete: 'off', spellcheck: 'false', autocapitalize: 'none',
            'aria-label': t('el_url_ph'), oninput: (ev: Event) => { elUrlDraft = (ev.target as HTMLInputElement).value; } }),
          elUrlBad ? h('div', { class: 'ni-err', role: 'status' }, t('el_url_bad')) : null,
          h('button', { class: 'btn', 'data-k': 'el-url-save', onclick: () => {
            const u = elevationPageUrl(elUrlDraft);
            if (!u) { elUrlBad = true; render(); return; }
            localStorage.setItem(EL_URL_KEY, u); elUrlDraft = ''; elUrlBad = false; render();
          } }, t('el_url_save'))) : null,
        line ? h('div', { class: 'pc', role: 'status' }, line) : null,
        err, buttons.length ? h('div', { class: 'opts' }, ...buttons) : null));
  }

  // "Launch this plan?" card (`propose_plan`): N steps run in order on one click of a trusted human (the hub checks again).
  // briefling driver: each step opens its own thread when the previous one ends; board driver (`repo`): the GitHub Lambda
  // creates one issue per step. What each step shows and which buttons apply: plan.ts.
  const PLAN_ERR: Record<PlanError, Key> = { refused: 'plan_err_refused', not_installed: 'plan_err_not_installed', github: 'plan_err_github', thread: 'plan_err_thread' };
  const PLAN_ST: Record<PlanStepState, Key> = { done: 'plan_st_done', active: 'plan_st_active', next: 'plan_st_next', off: 'plan_st_off' };
  function planCardEl(m: Message, f: PublicThread) {
    const p = m.plan!;
    const off = offCardLabel(p.status, 'plan_dismissed');
    if (off) return offCardEl(isBoardPlan(p) ? 'github' : 'track', t(off), p.title,
      p.why ? h('div', { class: 'pw' }, p.why) : null, h('ol', { class: 'd-steps' }, ...p.steps.map(s => h('li', {}, s.title))));
    const board = isBoardPlan(p);
    const stepEl = (s: PlanStep, i: number) => {
      const st = planStepState(p, i);
      const x = s.thread ? S.threads.get(s.thread) : null;
      return h('li', { class: 'pl-step', 'data-state': st },
        h('div', { class: 'pl-head' }, h('span', { class: 'pl-n', 'aria-hidden': 'true' }, String(i + 1)), h('span', { class: 'pl-t' }, s.title),
          st ? h('span', { class: `pl-st st-${st}` }, t(PLAN_ST[st])) : null,
          board && s.number ? h('span', { class: 'pl-ref' }, ghLink(s.url, `${p.repo}#${s.number}`)) : null),
        !board && s.thread ? h('a', { class: 'pl-thread', href: '#', onclick: (e: Event) => { e.preventDefault(); goThread(s.thread!); } },
          withIcon('thread', x ? x.title : t('plan_step_thread'), 12)) : null,
        s.brief.trim() ? h('details', { class: 'pl-brief' }, h('summary', {}, t('plan_brief')), h('div', { class: 'pb md' }, renderMarkdown(s.brief, y => richText(y, f.space), mdOpts(f.space)))) : null);
    };
    const { i, n } = planProgress(p);
    const line = p.status === 'pending' ? t('plan_pending') : p.status === 'running' ? t('plan_running', { i, n }) : p.status === 'done' ? t('plan_done')
      : p.status === 'stopped' ? t('plan_stopped', { name: p.stoppedBy === S.me ? t('you_lc') : personName(p.stoppedBy ?? '') ?? t('a_member') }) : '';
    const err = p.status === 'failed' ? h('div', { class: 'ni-err', role: 'status' }, t(PLAN_ERR[p.error ?? 'github'] ?? 'plan_err_github', { org: (p.repo ?? '').split('/')[0] })) : null;
    const trusted = S.trusted.has(f.space);
    const act = (kind: 'plan_start' | 'plan_stop' | 'dismiss') => () => send({ type: 'action', thread: f.id, kind, msg: m.id });
    const btns = planButtons(p, trusted, kit.modOn(f.space, 'threads')).map(b => b === 'start' ? h('button', { class: 'btn pri', onclick: act('plan_start') }, ...go(t(p.status === 'failed' ? 'plan_retry' : 'plan_launch')))
      : b === 'stop' ? h('button', { class: 'btn ghost', onclick: act('plan_stop') }, t('plan_stop'))
      : h('button', { class: 'btn ghost', onclick: act('dismiss') }, t('not_now')));
    return h('div', { class: `propose plan ${board ? 'k-issue' : 'k-thread'}`, 'data-plan': m.id },
      cardBand(board ? 'github' : 'track', t('plan_q'), board ? t('card_by_in', { agent: cap(p.by), repo: p.repo! }) : t('card_by', { agent: cap(p.by) })),
      h('div', { class: 'k-body' },
        h('div', { class: 'ni-title' }, p.title),
        p.why ? h('div', { class: 'pw' }, p.why) : null,
        h('ol', { class: 'pl-steps' }, ...p.steps.map(stepEl)),
        p.context && p.status === 'open' ? contextEl(m.id, p.context, f.space) : null,
        line ? h('div', { class: `pl-line pl-${p.status}`, role: 'status' }, line) : null,
        err,
        p.status === 'open' ? h('div', { class: 'pc' }, board ? t('plan_note_board', { repo: p.repo! }) : t('plan_note')) : null,
        btns.length ? h('div', { class: 'opts' }, ...btns) : p.status === 'open' && !trusted ? h('div', { class: 'pc' }, t('plan_trusted_only')) : null));
  }

  // Brief draft proposed by the agent in charge (`about.propose`): plain text (textContent, never Markdown nor HTML),
  // diff against the brief it was written from. Only the admin applies it, to the Settings form: they review and save.
  // Applied (or replaced by a newer applied draft): folded to one line like a dismissed card, the text readable unfolded.
  function aboutEl(m: Message, all: Message[], f: PublicThread) {
    const d = m.about!;
    const off = aboutFold(m, all);
    if (off) return offCardEl('pencil', t(off), d.text.split('\n')[0], h('div', { class: 'pb ab-text' }, d.text));
    const diff = d.base.trim() ? lineDiff(d.base.trim(), d.text) : null;
    const body = !diff ? h('div', { class: 'pb ab-text' }, d.text)
      : diff.every(x => x.op === '=') ? h('div', { class: 'pc' }, t('about_card_same'))
      : h('div', { class: 'pb ab-diff', 'aria-label': t('about_card_diff') }, ...diff.map(x => h('div', { class: `ab-${x.op === '+' ? 'ins' : x.op === '-' ? 'del' : 'eq'}` },
        h('span', { class: 'ab-op', 'aria-hidden': 'true' }, x.op === '+' ? '+' : x.op === '-' ? '−' : ' '), x.text || ' ')));
    const apply = () => { S.aboutApply = { space: f.space, text: d.text, base: d.base, thread: m.thread, msg: m.id }; S.view = { kind: 'settings', id: f.space }; S.sel = null; S.err = ''; render(); };
    return h('div', { class: 'propose about-draft k-about' }, cardBand('pencil', t('about_card_q'), t('card_by', { agent: cap(d.by) })),
      h('div', { class: 'k-body' },
        d.why ? h('div', { class: 'pw' }, d.why) : null,
        diff && !diff.every(x => x.op === '=') ? h('div', { class: 'pc' }, t('about_card_diff')) : null,
        body,
        h('div', { class: 'pc' }, t('about_card_note')),
        spaceAdmin(f.space) ? h('div', { class: 'opts' }, h('button', { class: 'btn pri', onclick: apply }, ...go(t('about_card_apply')))) : h('div', { class: 'pc' }, t('about_card_admin'))));
  }

  // Conversation cards (question, thread proposed, issue to create, brief draft): one shape, the TYPE told by the icon
  // and the colour of the band (`.k-ask|k-thread|k-issue|k-about` set `--k`/`--ks` in style.css). The done state of a
  // card (link to the thread or issue) keeps the same round icon.
  // A dismissed or superseded card (thread, issue, plan) stays readable: folded to one line (icon, « Thread dismissed: <title> »),
  // unfolded = what it proposed, read-only (no button: reopening it would need a hub frame). The fold survives renders (patch.ts).
  function offCardEl(ic: string, label: string, title: string, ...body: (Node | null)[]) {
    return h('details', { class: 'propose off dismissed' },
      h('summary', {}, icon('chevronRight', 12) as unknown as Node, icon(ic, 14) as unknown as Node, h('span', { class: 'd-lbl' }, label), h('span', { class: 'd-t' }, title)),
      h('div', { class: 'd-body' }, ...body));
  }
  /**
   * « To decide » card (`ask.choices`): one line of choices per point, the recommended one marked and picked first,
   * « Other » with its field, Send. Open while the hub says so (`pendingAsk`); answered, it folds to each point and its
   * choice; closed by a message (or a newer card), it says so instead of looking broken.
   */
  function decideEl(m: Message, all: Message[], th: PublicThread) {
    const items = m.ask!.items!, id = m.id;
    const ans = all.find(x => x.type === 'answer' && x.ask?.id === id);
    const live = !ans && th.pendingAsk === id;
    const byMessage = !ans && !live && all.some(x => x.at > m.at && x.author.kind === 'human' && x.type === 'text');
    const agent = m.author.kind === 'agent' ? who(m) : th.owner ? cap(th.owner) : t('the_agent');
    const sub = live ? t('card_decide_wait', { agent }) : ans ? t('card_by', { agent }) : t(byMessage ? 'decide_by_message' : 'decide_closed');
    const intro = m.text.trim() ? h('div', { class: 'q md' }, renderMarkdown(m.text, x => richText(x, th.space), mdOpts(th.space))) : null;
    const head = (it: typeof items[number]) => h('div', { class: 'dq' }, h('span', { class: 'dl' }, it.label), h('span', { class: 'dt' }, it.q));
    const card = (...body: (Node | null)[]) => h('div', { class: `ask k-ask decide ${live ? '' : 'done'}` },
      cardBand('askCard', t('card_decide'), sub), h('div', { class: 'k-body' }, intro, ...body));
    if (ans) { // answered: the open card's row format, only the choice made, a box with a green tick
      const got = askAnswered(items, ans.text);
      return card(h('div', { class: 'dpts' }, ...items.map((it, i) => h('div', { class: 'dp' }, head(it),
        h('div', { class: 'dr dk on' }, h('span', { class: 'dbox', 'aria-hidden': 'true' }, icon('check', 12)), h('span', { class: 'drt' }, got[i] ?? '—'))))));
    }
    if (!live || !S.trusted.has(th.space)) return card(h('div', { class: 'dpts' }, ...items.map(it => h('div', { class: 'dp' }, head(it)))),
      live ? h('div', { class: 'ans' }, t('decide_trusted_only')) : null);
    const picks = S.askPicks.get(id) ?? askStart(items);
    const pick = (i: number, p: AskPick) => { const next = [...picks]; next[i] = p; S.askPicks.set(id, next); render(); };
    const text = askAnswerText(items, picks), sent = S.askSent.has(id);
    const submit = () => {
      if (!text || S.askSent.has(id)) return;
      S.askSent.add(id);
      send({ type: 'answer', client_id: newCid(), thread: th.id, ask_id: id, option: text });
      render();
    };
    return card(h('div', { class: 'dpts' }, ...items.map((it, i) => {
      const p = picks[i] ?? { choice: 0 }, other = 'other' in p;
      // Native radios (sober, not big buttons), one group per point; the state lives in S.askPicks.
      const opt = (label: string, on: boolean, act: () => void, reco = false) => h('label', { class: `dr ${on ? 'on' : ''}` },
        h('input', { type: 'radio', name: `d-${id}-${i}`, checked: on, disabled: sent, onchange: act }),
        h('span', { class: 'drt' }, label, reco ? h('span', { class: 'reco' }, t('decide_reco')) : null)); // tag right after the text, wraps with it
      return h('div', { class: 'dp', role: 'radiogroup', 'aria-label': it.label }, head(it),
        h('div', { class: 'dopts' }, ...it.options.map((o, j) => opt(o, !other && p.choice === j, () => pick(i, { choice: j }), j === 0)),
          opt(t('decide_else'), other, () => { if (!other) pick(i, { other: '' }); })),
        // autocomplete off + a name: iOS otherwise offers « Fill contact » over a free-text field.
        other ? h('input', { class: 'dother', type: 'text', name: 'answer', autocomplete: 'off', value: p.other, maxlength: 200, placeholder: t('decide_else_ph'), 'aria-label': `${it.label} · ${t('decide_else')}`, disabled: sent,
          oninput: (e: Event) => pick(i, { other: (e.target as HTMLInputElement).value }),
          onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(); } } }) : null);
    })), h('div', { class: 'opts' }, h('button', { class: 'btn pri', disabled: !text || sent, onclick: submit }, t('decide_send')),
      h('span', { class: 'ans' }, t('decide_or_message'))));
  }
  /** Brief of a « Thread proposed » card: a long one shows its first lines under a fade, with a link to see it whole. */
  function briefEl(id: string, brief: string, space: string) {
    const md = renderMarkdown(brief, x => richText(x, space), mdOpts(space));
    if (!foldsBrief(brief)) return h('div', { class: 'pb md' }, md);
    const open = S.briefOpen.has(id);
    const toggle = () => { if (open) S.briefOpen.delete(id); else S.briefOpen.add(id); render(); };
    return h('div', { class: 'pb-wrap' }, h('div', { class: `pb md ${open ? '' : 'folded'}` }, md),
      h('button', { class: 'pb-more', type: 'button', 'aria-expanded': String(open), onclick: toggle },
        h('span', {}, t(open ? 'brief_less' : 'brief_more')), icon(open ? 'chevronUp' : 'chevronDown', 14) as unknown as Node));
  }
  /** The agent's summary of the conversation sent with the brief at the kickoff (`context`): folded by default, the human
   *  unfolds it to check what goes before opening (the first turn runs in their name). */
  function contextEl(id: string, context: string, space: string) {
    const key = `ctx:${id}`, open = S.briefOpen.has(key);
    const toggle = () => { if (open) S.briefOpen.delete(key); else S.briefOpen.add(key); render(); };
    return h('div', { class: 'pb-wrap pctx' },
      h('button', { class: 'pb-more', type: 'button', 'aria-expanded': String(open), onclick: toggle },
        h('span', {}, t(open ? 'ctx_less' : 'ctx_more')), icon(open ? 'chevronUp' : 'chevronDown', 14) as unknown as Node),
      open ? h('div', { class: 'pb md' }, renderMarkdown(context, x => richText(x, space), mdOpts(space))) : null);
  }
  /**
   * Settings, "Draft with <agent>": GitHub repos + a few words become a Lounge topic that mentions the agent in charge
   * (a regular post: the hub's usual gates apply). Not while the form has unsaved changes (the page is left).
   */
  function aboutAskEl(cur: SpaceSettings) {
    const agent = cap(cur.defaultAgent);
    const blocked = dirty() ? t('about_draft_dirty') : !cur.trusted.includes(S.me) ? t('about_draft_untrusted', { agent }) : '';
    const a = S.aboutAsk?.space === cur.id ? S.aboutAsk : null;
    if (!a) return h('div', { class: 'sp-draft' }, h('button', { class: 'btn', disabled: !!blocked, title: blocked || t('about_draft_title', { agent }),
      onclick: () => { S.aboutAsk = { space: cur.id, repos: '', notes: '', err: '' }; render(); } }, t('about_draft_btn', { agent })), blocked ? h('span', { class: 'sp-hint' }, blocked) : null);
    const repos = h('textarea', { 'data-draft': 'sp-draft-repos', name: 'repos', autocomplete: 'off', rows: 3, spellcheck: 'false', 'aria-label': t('about_draft_repos'), placeholder: 'https://github.com/acme/api',
      oninput: (e: Event) => { a.repos = (e.target as HTMLTextAreaElement).value; } }) as HTMLTextAreaElement;
    repos.value = a.repos;
    const notes = h('textarea', { 'data-draft': 'sp-draft-notes', name: 'notes', autocomplete: 'off', rows: 3, 'aria-label': t('about_draft_notes'), placeholder: t('about_draft_notes_ph'),
      oninput: (e: Event) => { a.notes = (e.target as HTMLTextAreaElement).value; } }) as HTMLTextAreaElement;
    notes.value = a.notes;
    const go = () => {
      const p = parseRepos(a.repos);
      a.err = p.bad.length ? t('about_draft_bad', { url: p.bad[0] }) : p.repos.length > MAX_DRAFT_REPOS ? t('about_draft_many', { max: MAX_DRAFT_REPOS })
        : !p.repos.length && !a.notes.trim() ? t('about_draft_empty') : '';
      if (a.err || blocked) { render(); return; }
      const cid = newCid();
      const text = draftRequest(cur.defaultAgent, p.repos, a.notes, !!cur.about.trim());
      // Lounge with nothing selected: the ack opens the new topic (S.newTopicCid), where the draft card will land.
      // Short title (spawned threads, notifications): the request itself starts with the mention, unreadable as a title.
      if (!send({ type: 'post', client_id: cid, space: cur.id, kind: 'topic', title: t('about_req_title', { agent }), text })) { render(); return; }
      S.newTopicCid = cid; S.aboutAsk = null; S.view = { kind: 'lounge', id: cur.id }; S.sel = null; S.err = '';
      render();
    };
    return h('div', { class: 'sp-draft open' },
      h('div', { class: 'sp-hint' }, t('about_draft_sub', { agent })),
      h('label', { class: 'label' }, t('about_draft_repos')), repos,
      h('label', { class: 'label' }, t('about_draft_notes')), notes,
      a.err ? h('div', { class: 'err sp-err' }, a.err) : null,
      h('div', { class: 'sp-actions' }, h('button', { class: 'btn pri', disabled: !!blocked, onclick: go }, t('about_draft_send', { agent })),
        h('button', { class: 'btn ghost', onclick: () => { S.aboutAsk = null; render(); } }, t('cancel'))));
  }
  return { proposeEl, issueCardEl, elevationCardEl, planCardEl, aboutEl, decideEl, aboutAskEl, topicCard, rowLabel };
}
