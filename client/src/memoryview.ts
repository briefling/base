// Memory view (project memory, protocol/memory.ts): entries agents proposed; review the waiting ones, archive or
// restore, edit tags, approve tag merges. Plain text only (never rendered as Markdown: an entry is agent-written data).
// The hub checks every decision again. Always-on module (client/src/modules.ts): its view, sidebar entry and frames;
// the « Import from repo » block of Settings › Memory also lives here (it shares the notices). Pure parts: memory.ts.
import { agentReviews, MEMORY_LIVE_MAX, type MemoryRun, MEMORY_TAGS_MAX, memoryVolume, type MemoryAction, type MemoryFileError, type MemoryEntry, type MemoryMode, type MemoryReviewVerdict, type MemoryVocab } from '../../protocol/memory.ts';
import { mailSourceOf } from '../../protocol/exchanges.ts';
import type { HubFrame } from '../../protocol/frames.ts';
import { MEMORY_TABS, actionsOf, compactBlock, counts as memCounts, defaultTab as memDefaultTab, importNotice, parseTags, queued as memQueued, replacedBy, sections as memSections, shown as memShown, tagColumn, untaggedCount, upsertEntry, vocabRows, newerVocab, wokenKey, runBanner, newerRun, type MemoryState, type MemoryTab } from './memory.ts';
import type { ClientModule, UiKit } from './modules.ts';
import { lang, type Key } from './i18n.ts';
import { routeOf } from './route.ts';

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const newCid = () => b64url(crypto.getRandomValues(new Uint8Array(32))).slice(0, 20); // same ids as main.ts' rand()
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** The memory module plus what main.ts still asks it outside its view (sync, space updates, Settings, routing). */
export interface MemoryModule extends ClientModule {
  /** Entries waiting for my review, per space, from the `subscribed` list (hub: reviewers only). */
  pendingFrom(list: { id: string; memPending?: number }[]): void;
  /** Same for one space (`space.updated`; 0 = no longer a reviewer, or nothing waits). */
  pendingSet(space: string, n: number): void;
  /** Settings › Memory: « Import from repo » (global admin) for the space's attached repos; null without one. */
  importEl(space: string, repos: string[]): HTMLElement | null;
  /** The route changed view kind: notices belong to the page that asked. */
  clearNotices(): void;
  /** Entering from the sidebar: first tab, no filter, no edit, no notice. */
  reset(): void;
  /** The unfolded entry ('' = none): a detail screen for the view transition. */
  detail(): string;
}

/** `openMail`: opens a mail of the Exchanges view (a `mail:` source of an entry). */
export function memoryModule(k: UiKit, openMail: (space: string, exchange: string, mail: string) => void): MemoryModule {
  const { h, t, tn, render, send, since, withIcon, personName, menuBtn, spaceName, errText } = k;
  // What the hub sent per space (asked again on every entry), tab and filter, decision in flight.
  const M = {
    memPending: new Map<string, number>(),      // memory entries waiting for my review, per space (hub: reviewers only)
    memRun: new Map<string, MemoryRun>(),       // the memory agent's turn per space (banner): running, or its result until closed
    memory: new Map<string, MemoryState>(), memTab: '' as MemoryTab | '', memQ: '', memBusy: '', memErr: '', memNotice: '',
    memTag: '', memTagEdit: '', memTagDraft: '', memTagErr: '', // tag picked as filter; entry whose tags are being edited, typed text, refusal
    memOpen: '', memRare: false, memPane: 'tags' as 'tags' | 'list', memMenu: false, // unfolded entry, rare tags shown, phone screen, « Actions » menu
    memRepo: '', memFailed: [] as { path: string; why: MemoryFileError }[], // « Import from repo » (admin): repo picked, files refused
  };
  let memoryFor = ''; // space whose list was last asked (asked again when re-entering the view)
  const MEM_TAB: Record<MemoryTab, Key> = { pending: 'mem_tab_pending', published: 'mem_tab_published', archived: 'mem_tab_archived', rejected: 'mem_tab_rejected' };
  const MEM_MODE: Record<MemoryMode, Key> = { agent: 'mem_mode_agent', agentAuto: 'mem_mode_agentAuto', auto: 'mem_mode_auto', human: 'mem_mode_human', trusted: 'mem_mode_trusted' };
  const MEM_REV: Record<MemoryReviewVerdict, Key> = { approve: 'mem_rev_approve', reject: 'mem_rev_reject', human: 'mem_rev_human' };
  const MEM_ACT: Record<MemoryAction, Key> = { approve: 'mem_approve', reject: 'mem_reject', archive: 'mem_archive', restore: 'mem_restore' };
  const MEM_BY: Record<MemoryAction, Key> = { approve: 'mem_by_approve', reject: 'mem_by_reject', archive: 'mem_by_archive', restore: 'mem_by_restore' };
  function upsertMemory(e: MemoryEntry) { const m = M.memory.get(e.space); if (m) m.entries = upsertEntry(m.entries, e); }
  function upsertVocab(v: MemoryVocab) { const m = M.memory.get(v.space); if (m) m.vocab = newerVocab(m.vocab, v); }
  function memVocab(space: string, version: number, action: 'approve' | 'approve_all' | 'reject' | 'unalias', tag: string) {
    const cid = newCid();
    if (!send({ type: 'memory.vocab', client_id: cid, space, version, action, tag })) return;
    M.memBusy = cid; M.memErr = ''; M.memNotice = ''; render();
  }
  function memDecide(e: MemoryEntry, action: MemoryAction) {
    const cid = newCid();
    if (!send({ type: 'memory.decide', client_id: cid, space: e.space, id: e.id, version: e.version, action })) return;
    M.memBusy = cid; M.memErr = ''; render();
  }

  function memSrc(space: string, x: string): Node | string {
    const m = mailSourceOf(x);
    if (!m) return x;
    if (!k.trusted(space)) return t('mem_src_mail_lead');
    return h('a', { href: routeOf({ kind: 'exchanges', id: space }, null), 'data-k': 'mem-src-mail', onclick: (e: Event) => { e.preventDefault(); openMail(space, m.exchange, m.mail); } }, t('mem_src_mail'));
  }
  function memoryView(space: string) {
    const m = M.memory.get(space);
    const agentName = m ? cap(m.agent) : '';
    const vol = m ? memoryVolume(m.entries) : null;
    const head = h('header', { class: 'mx-head' }, menuBtn(), h('div', {}, h('h2', {}, withIcon('memory', t('mem_title', { space: spaceName(space) }), 18)),
      h('p', {}, m ? t(MEM_MODE[m.mode], { agent: agentName }) : t('ex_loading')),
      vol ? h('p', { class: 'mem-vol', 'data-k': 'mem-vol' }, t('mem_volume', { n: vol.n, words: vol.words.toLocaleString(lang()) })) : null));
    if (!m) return h('section', { class: 'overview memory' }, head);
    const tab = M.memTab || memDefaultTab(m.entries), n = memCounts(m.entries), queued = memQueued(m.entries);
    const tabs = h('div', { class: 'theme mem-tabs', role: 'group', 'aria-label': t('memory') },
      ...MEMORY_TABS.map(k => h('button', { class: tab === k ? 'on' : '', 'aria-pressed': String(tab === k), 'data-k': `mem-tab-${k}`, 'data-n': k === 'pending' && n[k] ? String(n[k]) : undefined,
        onclick: () => { M.memTab = k; M.memOpen = ''; M.memPane = 'tags'; render(); } }, t(MEM_TAB[k]), h('span', { class: 'n' }, ` · ${n[k]}`))));
    const filter = h('input', { type: 'search', class: 'mem-q', 'data-draft': 'mem-q', placeholder: t('mem_filter'), 'aria-label': t('mem_filter'),
      oninput: (e: Event) => { M.memQ = (e.target as HTMLInputElement).value; M.memPane = 'list'; render(); } }) as HTMLInputElement;
    filter.value = M.memQ;
    const name = (id: string) => id === k.me() ? t('you') : personName(id) ?? t('member_id', { id: id.slice(0, 6) });
    const gateText = (e: MemoryEntry) => e.gate === 'queued' ? t('mem_gate_queued', { agent: agentName }) : e.gate === 'agent' ? t('mem_gate_agent', { agent: cap(e.review?.agent ?? m.agent) })
      : t(`mem_gate_${e.gate}` as Key);
    // Tags: a pill picks (or clears) the filter, like opening one folder; trusted humans edit an entry's tags inline.
    const pick = (tg: string) => { M.memTag = M.memTag === tg ? '' : tg; M.memPane = 'list'; render(); };
    const tagPill = (tg: string, on: boolean, n?: number) => h('button', { class: `mem-tag${on ? ' on' : ''}`, 'aria-pressed': String(on), 'data-tag': tg,
      title: t('mem_tag_pick', { tag: tg }), onclick: () => pick(tg) }, tg, n === undefined ? null : h('span', { class: 'n' }, String(n)));
    const canTag = (e: MemoryEntry) => m.trusted && e.status !== 'rejected';
    const tagSave = (e: MemoryEntry) => {
      const r = parseTags(M.memTagDraft);
      if ('error' in r) { M.memTagErr = r.error === 'bad' ? t('mem_tags_bad', { tag: r.bad }) : t('mem_tags_too_many', { max: MEMORY_TAGS_MAX }); render(); return; }
      const cid = newCid();
      if (!send({ type: 'memory.tags', client_id: cid, space: e.space, id: e.id, version: e.version, tags: r.tags })) return;
      M.memBusy = cid; M.memErr = ''; M.memTagErr = ''; render();
    };
    const tagEditor = (e: MemoryEntry) => {
      const inp = h('input', { class: 'mem-tag-in', 'data-draft': 'mem-tags', 'aria-label': t('mem_tags_edit'), placeholder: t('mem_tags_ph'), autocomplete: 'off', spellcheck: 'false',
        oninput: (ev: Event) => { M.memTagDraft = (ev.target as HTMLInputElement).value; },
        onkeydown: (ev: KeyboardEvent) => { if (ev.key === 'Enter') { ev.preventDefault(); tagSave(e); } else if (ev.key === 'Escape') { M.memTagEdit = ''; M.memTagErr = ''; render(); } } }) as HTMLInputElement;
      inp.value = M.memTagDraft;
      return h('div', { class: 'mem-tags editing' }, inp,
        h('button', { class: 'btn pri mem-tag-save', disabled: !!M.memBusy, onclick: () => tagSave(e) }, t('save')),
        h('button', { class: 'btn mem-tag-cancel', onclick: () => { M.memTagEdit = ''; M.memTagErr = ''; render(); } }, t('cancel')),
        M.memTagErr ? h('div', { class: 'err mem-tag-err' }, M.memTagErr) : null);
    };
    // Parts shared by the full card (To review: everything shown, buttons visible) and the unfolded row (other tabs).
    const chipsOf = (e: MemoryEntry) => {
      const drop = !!e.drop, rewrite = !drop && (e.supersedes?.length === 1 || !!e.replaces?.length);
      const by = e.supersededBy ? m.entries.find(x => x.id === e.supersededBy) : undefined;
      return [
        e.supersedes ? h('span', { class: `chip ${drop ? 'mem-drop' : 'mem-synth'}` }, drop ? t('mem_drop') : rewrite ? t('mem_rewrite') : t('mem_synth', { n: e.supersedes.length }))
          : e.replaces?.length ? h('span', { class: 'chip mem-synth mem-replaces' }, tn('mem_replaces', e.replaces.length)) : null,
        e.supersededBy ? h('span', { class: 'chip mem-superseded' }, t(by?.drop ? 'mem_dropped' : by?.replaces ? 'mem_replaced' : 'mem_superseded')) : null,
        e.kind === 'rule' ? h('span', { class: 'chip mem-rule' }, t('mem_rule')) : null,
        e.status === 'pending' ? h('span', { class: `chip mem-gate g-${e.gate}` }, gateText(e)) : null].filter((x): x is HTMLElement => !!x);
    };
    const originOf = (e: MemoryEntry) => e.imported ? h('span', { class: 'mem-imp' }, t('mem_imported_by', { who: name(e.imported.by), repo: e.imported.repo, sha: e.imported.sha.slice(0, 7) }))
      : e.supersedes ? h('span', {}, t('mem_synth_by'))
      : h('a', { href: routeOf({ kind: 'space', id: e.space }, e.thread) }, k.threadTitle(e.thread) || t('mem_thread'));
    const tagsOf = (e: MemoryEntry) => M.memTagEdit === e.id ? tagEditor(e) : e.tags?.length || canTag(e) ? h('div', { class: 'mem-tags' },
      ...(e.tags ?? []).map(tg => tagPill(tg, M.memTag === tg)),
      canTag(e) ? h('button', { class: 'mem-tag-edit', disabled: !!M.memBusy, title: t('mem_tags_edit'),
        onclick: () => { M.memTagEdit = e.id; M.memTagDraft = (e.tags ?? []).join(' '); M.memTagErr = ''; render(); document.querySelector<HTMLInputElement>('.memory .mem-tag-in')?.focus(); } }, t('mem_tags_edit')) : null) : null;
    const oldOf = (e: MemoryEntry) => {
      const old = replacedBy(m.entries, e), drop = !!e.drop, rewrite = !drop && (e.supersedes?.length === 1 || !!e.replaces?.length);
      const oldBlock = (label: Key) => h('div', { class: 'mem-old open', 'data-k': 'mem-old' }, h('div', { class: 'label' }, t(label)), ...old.map(x => h('div', { class: 'mem-old-e' }, x.text)));
      return { first: drop ? oldBlock('mem_drop_what') : h('div', { class: 'mem-text' }, e.text),
        why: drop ? h('div', { class: 'mem-why' }, h('span', { class: 'label' }, t('mem_drop_why')), ' ', e.text) : null,
        after: drop || !old.length ? null : rewrite ? oldBlock('mem_rewrite_old') : h('details', { class: 'mem-old', 'data-k': 'mem-old' }, h('summary', {}, t('mem_synth_show', { n: old.length })),
          ...old.map(x => h('div', { class: 'mem-old-e' }, x.text))) };
    };
    const reviewOf = (e: MemoryEntry) => e.review ? h('div', { class: 'mem-dec mem-rev' }, t(MEM_REV[e.review.verdict], { agent: cap(e.review.agent) }), ' : ', h('i', {}, e.review.why)) : null;
    const decidedOf = (e: MemoryEntry) => e.decided ? h('span', { class: 'mem-dec' }, t(MEM_BY[e.decided.action], { who: name(e.decided.by) }), ' · ', since(e.decided.at)) : null;
    const actsOf = (e: MemoryEntry) => actionsOf(e, m.review, m.trusted).map(a => h('button', { class: `btn ${a === 'approve' || a === 'restore' ? 'pri' : ''}`, disabled: !!M.memBusy,
      'data-k': `mem-${a}`, onclick: () => memDecide(e, a) }, t((e.supersedes || e.replaces) && a === 'approve' ? (e.drop ? 'mem_approve_drop' : 'mem_approve_synth') : MEM_ACT[a])));
    const when = (at: number) => h('span', { class: 'mem-date', title: new Date(at).toLocaleString(lang()) }, since(at));
    // To review: every entry waits for a decision, so all of it shows, buttons visible.
    const card = (e: MemoryEntry) => {
      const o = oldOf(e), acts = actsOf(e);
      return h('article', { class: `mem ${e.status}${e.drop ? ' drop' : ''}`, 'data-k': `mem-${e.id}` },
        o.first, o.why,
        h('div', { class: 'mem-meta' }, ...chipsOf(e), h('span', {}, cap(e.author)), h('span', { class: 'mem-sep' }, '·'), originOf(e), h('span', { class: 'mem-sep' }, '·'), when(e.at)),
        h('div', { class: 'mem-src' }, h('span', { class: 'label' }, t('mem_sources')), ' ', ...e.sources.flatMap((x, i) => i ? [' · ', memSrc(e.space, x)] : [memSrc(e.space, x)])),
        tagsOf(e), o.after, reviewOf(e),
        e.decided ? h('div', { class: 'mem-dec' }, t(MEM_BY[e.decided.action], { who: name(e.decided.by) }), ' · ', since(e.decided.at)) : null,
        acts.length ? h('div', { class: 'mem-acts' }, ...acts) : null);
    };
    // Other tabs: a compact row (text on 2 lines, tags and author in small type, date at the right); a click unfolds
    // it into a card with everything and its action in the footer. One unfolded at a time.
    const row = (e: MemoryEntry) => h('article', { class: `mem row ${e.status}`, 'data-k': `mem-${e.id}` },
      h('button', { class: 'mem-row', type: 'button', 'aria-expanded': 'false', onclick: () => { M.memOpen = e.id; M.memTagEdit = ''; render(); } },
        h('span', { class: 'mem-text' }, e.drop ? t('mem_drop_why') + ' ' + e.text : e.text), when(e.at),
        h('span', { class: 'mem-line' }, ...chipsOf(e), ...(e.tags ?? []).map(tg => h('span', { class: 'mem-ht' }, `#${tg}`)), h('span', {}, `· ${cap(e.author)}`))));
    const unfolded = (e: MemoryEntry) => {
      const o = oldOf(e), chips = chipsOf(e);
      return h('article', { class: `mem open ${e.status}${e.drop ? ' drop' : ''}`, 'data-k': `mem-${e.id}` },
        h('div', { class: 'mem-top' }, when(e.at), h('button', { class: 'mem-fold', type: 'button', 'aria-expanded': 'true', 'data-k': 'mem-fold', onclick: () => { M.memOpen = ''; M.memTagEdit = ''; render(); } }, '▲ ', t('mem_fold'))),
        o.first, o.why,
        chips.length ? h('div', { class: 'mem-meta' }, ...chips) : null,
        e.sources.length ? h('div', { class: 'mem-src' }, ...e.sources.map(x => h('code', { class: 'mem-sc' }, memSrc(e.space, x)))) : null,
        tagsOf(e), o.after, reviewOf(e),
        h('div', { class: 'mem-foot' }, h('span', { class: 'mem-av', 'aria-hidden': 'true' }, cap(e.author).slice(0, 1)), h('span', {}, cap(e.author)), h('span', { class: 'mem-sep' }, '·'), originOf(e),
          decidedOf(e) ? h('span', { class: 'mem-sep' }, '·') : null, decidedOf(e), h('span', { class: 'sp' }), ...actsOf(e)));
    };
    // Actions only (the thresholds, the mode and the import live in the space settings): « Review now », « Compact », « Tag entries ».
    const block = compactBlock(m.entries), untagged = untaggedCount(m.entries);
    const acts = m.trusted ? [
      agentReviews(m.mode) ? h('button', { class: 'btn', 'data-k': 'mem-wake', disabled: !!M.memBusy || !queued, onclick: () => memWake(space, 'memory.wake') }, t('mem_wake', { n: queued })) : null,
      h('button', { class: 'btn', 'data-k': 'mem-compact', disabled: !!M.memBusy || !!block, title: block ? t(block === 'pending' ? 'mem_compact_pending' : 'mem_compact_nothing') : t('mem_compact_hint', { agent: agentName }),
        onclick: () => memWake(space, 'memory.compact') }, t('mem_compact')),
      h('button', { class: 'btn', 'data-k': 'mem-autotag', disabled: !!M.memBusy || !untagged, title: untagged ? t('mem_autotag_hint', { agent: agentName, n: untagged }) : t('mem_tag_nothing'),
        onclick: () => memWake(space, 'memory.autotag') }, t('mem_autotag'))] : [];
    // « Compact », « Tag entries » and « Review now » are occasional: one « Actions » menu instead of three buttons.
    const menu = acts.length ? h('div', { class: 'mem-menu' },
      h('button', { class: 'btn', type: 'button', 'data-k': 'mem-actions', 'aria-haspopup': 'menu', 'aria-expanded': String(M.memMenu), onclick: () => { M.memMenu = !M.memMenu; render(); } }, t('mem_actions'), ' ▾'),
      M.memMenu ? h('div', { class: 'mem-pop', role: 'menu' }, ...acts) : null) : null;
    const list = memShown(m.entries, tab, M.memQ, M.memTag);
    const col = tagColumn(m.entries, tab, M.memTag);
    // Tag merges (compaction): what the memory agent proposes, approved by a trusted human; approved ones stay as aliases.
    const vr = vocabRows(m.entries, m.vocab), vv = m.vocab?.version ?? 0;
    const vocabBlock = vr.merges.length || vr.aliases.length ? h('div', { class: 'mem-vocab', 'data-k': 'mem-vocab' },
      vr.merges.length ? h('div', { class: 'mem-merges' }, h('div', { class: 'label' }, t('mem_merges', { n: vr.merges.length }),
          // the compaction's revised list, applied in one go (each row still approves alone)
          m.trusted && vr.merges.length > 1 ? h('button', { class: 'btn pri mem-merge-all', 'data-k': 'mem-merge-all', disabled: !!M.memBusy,
            onclick: () => memVocab(space, vv, 'approve_all', '') }, t('mem_merge_all')) : null),
        ...vr.merges.map(x => h('div', { class: 'mem-merge', 'data-k': `mem-merge-${x.from}` },
          h('span', { class: 'mem-tag' }, x.from), ' → ', h('span', { class: 'mem-tag' }, x.to), h('span', { class: 'n' }, t(x.n === 1 ? 'mem_merge_1' : 'mem_merge_n', { n: x.n })),
          m.trusted ? h('span', { class: 'mem-acts' },
            h('button', { class: 'btn pri', 'data-k': 'mem-merge-ok', disabled: !!M.memBusy, onclick: () => memVocab(space, vv, 'approve', x.from) }, t('mem_merge_ok')),
            h('button', { class: 'btn', 'data-k': 'mem-merge-no', disabled: !!M.memBusy, onclick: () => memVocab(space, vv, 'reject', x.from) }, t('mem_reject'))) : null))) : null,
      vr.aliases.length ? h('details', { class: 'mem-aliases', 'data-k': 'mem-aliases' }, h('summary', {}, t('mem_aliases', { n: vr.aliases.length })),
        h('p', { class: 'mx-note' }, t('mem_aliases_note')),
        ...vr.aliases.map(x => h('div', { class: 'mem-alias' }, h('span', { class: 'mem-tag' }, x.alias), ' → ', h('span', { class: 'mem-tag' }, x.tag),
          m.trusted ? h('button', { class: 'mem-tag-edit', 'data-k': `mem-unalias-${x.alias}`, disabled: !!M.memBusy, title: t('mem_unalias'),
            onclick: () => memVocab(space, vv, 'unalias', x.alias) }, t('mem_unalias')) : null))) : null) : null;
    // Tags as a column of folders (desktop) or as the first screen (phone, CSS): picking one opens its list.
    const tocItem = (tg: string, n: number) => h('button', { class: `mem-ti${M.memTag === tg ? ' on' : ''}`, type: 'button', 'aria-pressed': String(M.memTag === tg), 'data-tag': tg,
      onclick: () => { M.memTag = tg; M.memOpen = ''; M.memPane = 'list'; render(); } }, h('span', { class: 'l' }, tg || t('mem_tags_all')), h('span', { class: 'n' }, String(n)), h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'));
    const toc = h('nav', { class: 'mem-toc', 'aria-label': t('mem_tags'), 'data-k': 'mem-toc' }, tocItem('', col.all), ...col.main.map(x => tocItem(x.tag, x.n)),
      col.rare.length ? h('button', { class: 'mem-rare', type: 'button', 'aria-expanded': String(M.memRare), 'data-k': 'mem-rare', onclick: () => { M.memRare = !M.memRare; render(); } },
        `${M.memRare ? '−' : '+'} ${tn('mem_rare', col.rare.length)}`) : null,
      ...(M.memRare ? col.rare.map(x => tocItem(x.tag, x.n)) : []));
    // To review: everything visible, no sections; elsewhere decisions first inside a tag, rows unfold one at a time.
    const pending = tab === 'pending';
    const body = list.length ? memSections(list, pending ? '' : M.memTag).flatMap(sec => [
      sec.key ? h('div', { class: 'mem-sec', 'data-k': `mem-sec-${sec.key}` }, t(sec.key === 'decisions' ? 'mem_sec_decisions' : 'mem_sec_rest', { n: sec.entries.length })) : null,
      ...sec.entries.map(e => pending ? card(e) : M.memOpen === e.id ? unfolded(e) : row(e))]) : [h('div', { class: 'mx-empty' }, t('mem_none'))];
    // Phone, second screen: « ‹ » back to the tags, the tag's name and count (CSS hides it on desktop and in To review).
    const lhead = pending ? null : h('div', { class: 'mem-lhead' },
      h('button', { class: 'btn ic', type: 'button', 'data-k': 'mem-back', title: t('mem_back'), 'aria-label': t('mem_back'), onclick: () => { M.memPane = 'tags'; M.memOpen = ''; render(); } }, '‹'),
      h('b', {}, M.memTag || t('mem_tags_all')), h('span', { class: 'n' }, tn('mem_n', list.length)));
    return h('section', { class: `overview memory ${pending || M.memPane === 'list' ? 'pane-list' : 'pane-tags'}${pending ? ' tab-pending' : ''}` }, head,
      h('div', { class: 'scroll' },
        h('div', { class: 'mem-bar' }, tabs, filter, h('span', { class: 'sp' }), menu),
        vocabBlock,
        runEl(space, agentName),
        M.memNotice ? h('div', { class: 'mem-notice', 'data-k': 'mem-notice' }, M.memNotice) : null,
        M.memErr ? h('div', { class: 'err' }, M.memErr) : null,
        h('div', { class: 'mem-lay' }, toc,
          h('div', { class: 'mem-list' }, lhead, ...body, h('p', { class: 'mx-note' }, t('mem_note'))))));
  }
  // The memory agent's turn: « Gideon compacts the memory… » with a spinner while it runs, then its result (closable).
  function runEl(space: string, agent: string): HTMLElement | null {
    const run = M.memRun.get(space), b = runBanner(run, Date.now());
    if (!run || !b) return null;
    const close = () => { M.memRun.delete(space); render(); };
    return h('div', { class: `mem-run${b.busy ? ' busy' : ''}`, role: 'status', 'data-k': 'mem-run', 'data-what': run.what },
      b.busy ? h('span', { class: 'mem-run-spin', 'aria-hidden': 'true' }) : null,
      h('span', { class: 't' }, b.busy ? t(b.key, { agent }) : 'n' in b ? tn(b.key, b.n) : t(b.key)),
      b.busy ? h('span', { class: 'since' }, since(run.since)) : null,
      h('span', { class: 'sp' }),
      !b.busy && b.pending ? h('button', { class: 'btn', type: 'button', 'data-k': 'mem-run-see', onclick: () => { M.memTab = 'pending'; M.memOpen = ''; close(); } }, t('mem_run_see')) : null,
      b.busy ? null : h('button', { class: 'btn ic', type: 'button', 'data-k': 'mem-run-close', title: t('mem_run_close'), 'aria-label': t('mem_run_close'), onclick: close }, '×'));
  }
  function memImport(space: string, repo: string) {
    if (!confirm(t('mem_import_confirm', { repo }))) return;
    const cid = newCid();
    if (!send({ type: 'memory.import', client_id: cid, space, repo })) return;
    M.memBusy = cid; M.memErr = ''; M.memNotice = t('mem_import_running', { repo }); M.memFailed = []; render();
  }
  function onMemImported(f: Extract<HubFrame, { type: 'memory.imported' }>) {
    const n = importNotice(f);
    M.memFailed = f.failed;
    M.memNotice = '';
    if (n.kind === 'done') M.memNotice = t('mem_imported', { repo: n.repo, sha: n.sha, added: n.added, existing: n.existing, failed: n.failed });
    else if (n.kind === 'full') M.memErr = t('mem_import_full', { live: n.live, wanted: n.wanted, max: MEMORY_LIVE_MAX });
    else M.memErr = n.code === 'too_many' ? t('mem_import_too_many') : errText(n.code);
  }
  function memWake(space: string, type: 'memory.wake' | 'memory.compact' | 'memory.autotag') {
    const cid = newCid();
    M.memMenu = false;
    if (!send({ type, client_id: cid, space })) { render(); return; }
    M.memBusy = cid; M.memErr = ''; M.memNotice = ''; render();
  }
  document.addEventListener('click', (e) => { if (M.memMenu && !(e.target as Element).closest?.('.mem-menu')) { M.memMenu = false; render(); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && M.memMenu) { M.memMenu = false; render(); } });
  // Settings › Memory, « Import from repo » (global admin, the page's audience): the memory files of an attached repo, published at once.
  function importEl(space: string, repos: string[]): HTMLElement | null {
    const repo = repos.includes(M.memRepo) ? M.memRepo : repos[0] ?? '';
    return repo ? h('div', { class: 'sp-field mem-import' }, h('label', { class: 'label' }, t('mem_import')),
      h('div', { class: 'mem-batch' },
        repos.length > 1 ? (() => { const sel = h('select', { 'data-k': 'mem-import-repo', 'aria-label': t('mem_import_repo'), onchange: (e: Event) => { M.memRepo = (e.target as HTMLSelectElement).value; render(); } },
          ...repos.map(r => h('option', { value: r }, r))) as HTMLSelectElement; sel.value = repo; return sel })() : h('span', {}, repo),
        h('button', { class: 'btn', type: 'button', 'data-k': 'mem-import', disabled: !!M.memBusy, onclick: () => memImport(space, repo) }, t('mem_import'))),
      h('div', { class: 'sp-hint' }, t('mem_import_hint')),
      M.memNotice ? h('div', { class: 'mem-notice', 'data-k': 'mem-notice' }, M.memNotice) : null,
      M.memErr ? h('div', { class: 'err' }, M.memErr) : null,
      M.memFailed.length ? h('ul', { class: 'mem-notice mem-failed', 'data-k': 'mem-failed' },
        ...M.memFailed.map(x => h('li', {}, h('code', {}, x.path), ' : ', t(`mem_why_${x.why}` as Key)))) : null) : null;
  }
  return {
    view: 'memory', icon: 'memory', label: 'memory',
    badge: space => M.memPending.get(space),
    synced: () => {},
    // Listed by the hub on every entry, then kept up to date by `memory.updated` (never polled).
    el: space => { if (memoryFor !== space && k.post({ type: 'memory.list', space })) memoryFor = space; return memoryView(space); },
    leave: () => { memoryFor = ''; },
    frame: (f: HubFrame) => {
      if (f.type === 'memory') {
        M.memory.set(f.space, { mode: f.mode, entries: f.entries, review: f.review, trusted: f.trusted, agent: f.agent, vocab: f.vocab }); if (!M.memTab && !f.more) M.memTab = memDefaultTab(f.entries);
        // A run the hub no longer sees running ended unseen (no result to show); a result already shown stays until closed.
        const cur = M.memRun.get(f.space);
        if (f.run) M.memRun.set(f.space, newerRun(cur, f.run)); else if (cur && !cur.ended) M.memRun.delete(f.space);
      }
      else if (f.type === 'event' && f.event === 'memory.run') M.memRun.set(f.data.space, newerRun(M.memRun.get(f.data.space), f.data.run));
      else if (f.type === 'memory.entries') { // the next chunk of the list (hub: memoryChunks), appended in order
        const m = M.memory.get(f.space); if (m) { m.entries = m.entries.concat(f.entries); if (!M.memTab && !f.more) M.memTab = memDefaultTab(m.entries); } }
      else if (f.type === 'memory.vocabulary') { if (f.client_id === M.memBusy) { M.memBusy = ''; M.memErr = ''; M.memNotice = f.retagged ? t(f.retagged === 1 ? 'mem_merged_1' : 'mem_merged', { n: f.retagged }) : ''; } upsertVocab(f.vocab); }
      else if (f.type === 'memory.woken') { if (f.client_id === M.memBusy) M.memBusy = ''; const key = wokenKey(f.what, f.result); M.memNotice = key ? t(key as Key) : ''; }
      else if (f.type === 'memory.imported') { if (f.client_id === M.memBusy) { M.memBusy = ''; onMemImported(f); } }
      else if (f.type === 'memory.entry') { if (f.client_id === M.memBusy) { M.memBusy = ''; M.memErr = ''; M.memTagEdit = ''; } upsertMemory(f.entry); }
      else if (f.type === 'error' && f.ref && f.ref === M.memBusy) { M.memBusy = ''; M.memErr = errText(f.code); }
      else if (f.type === 'event' && f.event === 'memory.updated') upsertMemory(f.data);
      else if (f.type === 'event' && f.event === 'memory.pending') M.memPending.set(f.data.space, f.data.n);
      else if (f.type === 'event' && f.event === 'memory.vocab.updated') upsertVocab(f.data);
      else return false;
      return true;
    },
    pendingFrom: list => { M.memPending = new Map(list.filter(s => s.memPending).map(s => [s.id, s.memPending!])); },
    pendingSet: (space, n) => { M.memPending.set(space, n); },
    importEl,
    clearNotices: () => { M.memNotice = ''; M.memErr = ''; M.memFailed = []; },
    reset: () => { M.memTab = ''; M.memQ = ''; M.memTag = ''; M.memTagEdit = ''; M.memErr = ''; M.memNotice = ''; M.memFailed = []; },
    detail: () => M.memOpen,
  };
}
