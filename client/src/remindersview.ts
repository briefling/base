// Reminders view (module `reminders`, protocol/reminders.ts), after Apple's Reminders app: smart-list tiles (Today,
// Scheduled, All, For me, Completed) and the space's lists on the left, the selected one on the right with a round box
// to check, a quick-add line that understands « tomorrow 6pm », and an inline editor per reminder (date, time, list,
// who it is for). Phone: the tiles and lists, then the list on its own screen. Pure parts: client/src/reminders.ts.
import { INBOX, LIST_COLORS, REMINDER_LIST_NAME_MAX, REMINDER_NOTES_MAX, REMINDER_TITLE_MAX, SMART, byDay, dayOf, myTodayCount,
  type ListColor, type Reminder, type ReminderList, type Smart } from '../../protocol/reminders.ts';
import type { HubFrame, Message, PublicThread } from '../../protocol/frames.ts';
import type { ClientModule, UiKit } from './modules.ts';
import type { Key } from './i18n.ts';
import { lang } from './i18n.ts';
import { applyUpdate, counts, dueLabel, fromList, listSel, parseQuick, selList, shown, type RmSel, type SpaceReminders } from './reminders.ts';

const SMART_ICON: Record<Smart, string> = { today: 'sun', scheduled: 'calendar', all: 'inbox', mine: 'you', done: 'check' };
/** How long a checked reminder stays on screen before leaving its list (Apple: about a second). */
const KEEP_MS = 1200;
const cid = () => Math.random().toString(36).slice(2, 14);
const cap = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : s;

interface Edit { id: string; title: string; notes: string; date: string; time: string; list: string; for: string }

export function remindersModule(k: UiKit): ClientModule {
  const { h, icon, t } = k;
  const data = new Map<string, SpaceReminders>();
  const loading = new Set<string>();
  const sel = new Map<string, RmSel>();
  const keep = new Set<string>();
  const cardPick = new Map<string, { list?: string; for?: string }>();
  let phoneMain = false;   // phone: the selected list on its own screen
  let showDone = false;
  let draft = '';
  let edit: Edit | null = null;
  let listEdit: { space: string; id?: string; version?: number; name: string; color: ListColor } | null = null;
  let listDelAsk = '';
  let err = '';
  let busy = '';
  const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = () => dayOf(Date.now(), tz());
  const humans = (space: string) => k.people(space).filter(p => p.kind === 'human' && !p.gone);
  const nameOf = (space: string, id: string) => id === k.me() ? t('you') : humans(space).find(p => p.id === id)?.name ?? k.people(space).find(p => p.id === id)?.name ?? t('a_member');
  const listsOf = (sp: SpaceReminders) => [{ id: INBOX, name: t('rm_inbox'), color: 'blue' as ListColor }, ...sp.lists];
  const listOf = (sp: SpaceReminders, id: string) => listsOf(sp).find(l => l.id === id) ?? listsOf(sp)[0];

  async function load(space: string) {
    if (loading.has(space)) return;
    loading.add(space);
    const r = await k.request({ type: 'reminder.list', space }, 8000);
    loading.delete(space);
    if (r?.type === 'reminder.list') { data.set(space, fromList(r.lists, r.reminders)); k.render(); }
  }
  /** One write: the answer applies at once (the event follows for the other devices); an error says why. */
  async function write(space: string, f: { type: string; [x: string]: unknown }): Promise<boolean> {
    busy = f.type; err = ''; k.render();
    const r = await k.request({ ...f, space }, 8000, true);
    busy = '';
    const cur = data.get(space);
    if (r?.type === 'reminder.saved' && cur) data.set(space, applyUpdate(cur, { ...(r.reminder ? { reminders: [r.reminder] } : {}), ...(r.list ? { lists: [r.list] } : {}) }));
    if (r?.type === 'error') { err = k.errText(r.code); void load(space); }
    else if (!r) err = t('rm_err_timeout');
    k.render();
    return r?.type === 'reminder.saved';
  }
  const dueOf = (date: string, time: string) => date ? { date, ...(time ? { time } : {}), tz: tz() } : {};
  const fields = (r: Reminder) => ({ title: r.title, ...(r.notes ? { notes: r.notes } : {}), list: r.list, for: r.for,
    ...(r.due ? { date: r.due.date, ...(r.due.time ? { time: r.due.time } : {}), tz: r.due.tz } : {}) });

  function check(space: string, r: Reminder) {
    const done = !r.done, sp = data.get(space)!;
    // Optimistic: the box fills at once, the row leaves its list after KEEP_MS.
    data.set(space, applyUpdate(sp, { reminders: [{ ...r, ...(done ? { done: { by: k.me(), at: Date.now() } } : { done: undefined }), version: r.version }] }));
    if (done) { keep.add(r.id); setTimeout(() => { keep.delete(r.id); k.render(); }, KEEP_MS); }
    void write(space, { type: 'reminder.done', id: r.id, version: r.version, done });
  }
  function quickAdd(space: string, s: RmSel) {
    const q = parseQuick(draft, today(), new Date().toTimeString().slice(0, 5));
    if (!q.title) return;
    const list = selList(s) ?? INBOX;
    // Today and Scheduled add for today when the line names no date (as Apple does).
    const date = q.date ?? (s === 'today' || s === 'scheduled' ? today() : '');
    draft = '';
    void write(space, { type: 'reminder.save', title: q.title.slice(0, REMINDER_TITLE_MAX), list, for: k.me(), ...dueOf(date, q.time ?? '') });
  }
  function saveEdit(space: string) {
    const e = edit!, r = data.get(space)?.items.get(e.id);
    if (!r || !e.title.trim()) return;
    edit = null;
    void write(space, { type: 'reminder.save', id: r.id, version: r.version, title: e.title.trim(), notes: e.notes, list: e.list, for: e.for, ...dueOf(e.date, e.date ? e.time : '') });
  }

  // ---------------------------------------------------------------- rows
  const box = (space: string, r: Reminder, color: string) => h('button', { class: `rm-check rm-c-${color}${r.done ? ' on' : ''}`, type: 'button', 'data-t': 'rm-check',
    role: 'checkbox', 'aria-checked': String(!!r.done), 'aria-label': t(r.done ? 'rm_uncheck' : 'rm_check'), title: t(r.done ? 'rm_uncheck' : 'rm_check'),
    onclick: (ev: Event) => { ev.stopPropagation(); check(space, r); } }, r.done ? icon('check', 12) as unknown as Node : null);

  /** « ↳ Topic: <title> » under a reminder added from a conversation; none when the conversation is no longer visible. */
  function source(r: Reminder) {
    const th = r.source ? k.thread(r.source.thread) : undefined;
    if (!r.source || !th) return null;
    const { thread, msg } = r.source;
    return h('button', { class: 'linkbtn rm-src', type: 'button', 'data-t': 'rm-src',
      onclick: (ev: Event) => { ev.stopPropagation(); k.goMessage(thread, msg ?? null); } },
      '↳ ', t(th.kind === 'topic' ? 'rm_src_topic' : 'rm_src_thread', { title: th.title }));
  }

  function row(space: string, sp: SpaceReminders, r: Reminder, s: RmSel) {
    const l = listOf(sp, r.list), due = dueLabel(r, Date.now(), tz(), lang(), { today: t('rm_today'), tomorrow: t('rm_tomorrow'), yesterday: t('rm_yesterday') });
    const open = edit?.id === r.id;
    const meta = [
      due ? h('span', { class: `rm-due${due.overdue ? ' late' : ''}`, 'data-t': 'rm-due' }, icon('calendar', 12) as unknown as Node, due.text) : null,
      selList(s) === null ? h('span', { class: `rm-inlist rm-c-${l.color}` }, l.name) : null,
      r.for !== k.me() || s === 'all' ? h('span', { class: 'rm-for', 'data-t': 'rm-for' }, icon('you', 12) as unknown as Node, t('rm_for', { name: nameOf(space, r.for) })) : null,
    ].filter(Boolean) as Node[];
    return h('div', { class: `rm-row${r.done ? ' done' : ''}${keep.has(r.id) ? ' going' : ''}${open ? ' open' : ''}`, 'data-rm': r.id, 'data-k': `rm-r-${r.id}`, role: 'listitem' },
      box(space, r, l.color),
      h('div', { class: 'rm-body', onclick: () => { if (!open) { edit = { id: r.id, title: r.title, notes: r.notes ?? '', date: r.due?.date ?? '', time: r.due?.time ?? '', list: r.list, for: r.for }; render(); focus('rm-et'); } } },
        open ? editor(space, sp, r) : h('div', { class: 'rm-t' }, r.title),
        !open && r.notes ? h('div', { class: 'rm-n' }, r.notes) : null,
        !open && r.source?.why ? h('div', { class: 'rm-why', 'data-t': 'rm-why' }, r.source.why) : null,
        !open ? source(r) : null,
        !open && meta.length ? h('div', { class: 'rm-meta' }, ...meta.flatMap((m, i) => i ? [h('span', { class: 'rm-sep' }, '·'), m] : [m])) : null),
      open ? null : h('button', { class: 'btn ic rm-info', type: 'button', title: t('rm_details'), 'aria-label': t('rm_details'),
        onclick: (ev: Event) => { ev.stopPropagation(); edit = { id: r.id, title: r.title, notes: r.notes ?? '', date: r.due?.date ?? '', time: r.due?.time ?? '', list: r.list, for: r.for }; render(); focus('rm-et'); } }, icon('info', 16) as unknown as Node));
  }
  const render = () => k.render();
  /** Focus after the render that shows it (autofocus does not fire on a patched node). */
  const focus = (key: string) => setTimeout(() => (document.querySelector(`[data-k="${key}"]`) as HTMLInputElement | null)?.focus(), 0);

  function editor(space: string, sp: SpaceReminders, r: Reminder) {
    const e = edit!;
    const set = (patch: Partial<Edit>) => { edit = { ...e, ...patch }; render(); };
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { edit = null; render(); } else if (ev.key === 'Enter' && !(ev.target instanceof HTMLTextAreaElement)) saveEdit(space); };
    const field = (label: Key, el: HTMLElement) => h('label', { class: 'rm-f' }, h('span', { class: 'label' }, t(label)), el);
    return h('div', { class: 'rm-edit', 'data-k': 'rm-edit', onclick: (ev: Event) => ev.stopPropagation() },
      h('input', { class: 'rm-et', 'data-k': 'rm-et', value: e.title, maxlength: REMINDER_TITLE_MAX, 'aria-label': t('rm_title_label'), autocomplete: 'off', autofocus: true,
        oninput: (ev: Event) => { e.title = (ev.target as HTMLInputElement).value; }, onkeydown: key }),
      h('textarea', { class: 'rm-en', 'data-k': 'rm-en', rows: 2, maxlength: REMINDER_NOTES_MAX, placeholder: t('rm_notes'), 'aria-label': t('rm_notes'),
        oninput: (ev: Event) => { e.notes = (ev.target as HTMLTextAreaElement).value; }, onkeydown: key }, e.notes),
      h('div', { class: 'rm-fields' },
        field('rm_date', h('input', { type: 'date', 'data-k': 'rm-date', value: e.date, onchange: (ev: Event) => set({ date: (ev.target as HTMLInputElement).value, title: e.title, notes: e.notes }) })),
        field('rm_time', h('input', { type: 'time', 'data-k': 'rm-time', value: e.time, disabled: !e.date, onchange: (ev: Event) => set({ time: (ev.target as HTMLInputElement).value, title: e.title, notes: e.notes }) })),
        field('rm_list_label', h('select', { 'data-k': 'rm-list', onchange: (ev: Event) => set({ list: (ev.target as HTMLSelectElement).value, title: e.title, notes: e.notes }) },
          ...listsOf(sp).map(l => h('option', { value: l.id, selected: l.id === e.list }, l.name)))),
        field('rm_for_label', h('select', { 'data-k': 'rm-forsel', onchange: (ev: Event) => set({ for: (ev.target as HTMLSelectElement).value, title: e.title, notes: e.notes }) },
          ...humans(space).map(p => h('option', { value: p.id, selected: p.id === e.for }, p.id === k.me() ? `${p.name} (${t('you_lc')})` : p.name))))),
      h('div', { class: 'rm-eact' },
        h('button', { class: 'btn ghost rm-del', type: 'button', 'data-k': 'rm-del', onclick: () => { edit = null; void write(space, { type: 'reminder.delete', id: r.id, version: r.version }); } }, icon('trash', 14) as unknown as Node, t('rm_delete')),
        h('span', { class: 'rm-grow' }),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { edit = null; render(); } }, t('cancel')),
        h('button', { class: 'btn pri', type: 'button', 'data-k': 'rm-save', disabled: !e.title.trim(), onclick: () => saveEdit(space) }, t('rm_ok'))));
  }

  // ---------------------------------------------------------------- side: tiles and lists
  function side(space: string, sp: SpaceReminders, s: RmSel) {
    const n = counts(sp, k.me(), Date.now(), tz());
    const pick = (x: RmSel) => () => { sel.set(space, x); edit = null; listEdit = null; phoneMain = true; render(); };
    const tiles = h('div', { class: 'rm-tiles', role: 'group', 'aria-label': t('rm_smart') },
      ...SMART.map(x => h('button', { class: `rm-tile rm-s-${x}${s === x ? ' on' : ''}`, type: 'button', 'data-k': `rm-tile-${x}`, 'aria-pressed': String(s === x), onclick: pick(x) },
        h('span', { class: 'rm-tic' }, icon(SMART_ICON[x], 16) as unknown as Node), h('b', { class: 'rm-tn' }, String(n.smart[x])), h('span', { class: 'rm-tl' }, t(`rm_s_${x}` as Key)))));
    const lrow = (l: { id: string; name: string; color: ListColor; version?: number }) => h('div', { class: `rm-li${s === listSel(l.id) ? ' on' : ''}`, 'data-k': `rm-li-${l.id}` },
      h('button', { class: 'rm-lb', type: 'button', onclick: pick(listSel(l.id)), 'aria-current': s === listSel(l.id) ? 'true' : undefined },
        h('span', { class: `rm-ldot rm-c-${l.color}` }, icon('list', 13) as unknown as Node), h('span', { class: 'rm-ln' }, l.name), h('b', { class: 'rm-lc' }, String(n.lists[l.id] ?? 0))),
      l.id === INBOX ? h('span', { class: 'rm-ledit-ph', 'aria-hidden': 'true' }) : h('button', { class: 'btn ic rm-ledit', type: 'button', title: t('rm_list_edit'), 'aria-label': t('rm_list_edit'),
        onclick: () => { listEdit = { space, id: l.id, version: l.version, name: l.name, color: l.color }; listDelAsk = ''; render(); focus('rm-lname'); } }, icon('pencil', 13) as unknown as Node));
    return h('aside', { class: 'rm-side' }, tiles,
      h('div', { class: 'rm-lh label' }, t('rm_my_lists')),
      h('div', { class: 'rm-lists', role: 'list' }, ...listsOf(sp).map(l => listEdit?.id === l.id && listEdit.space === space ? listForm(space, sp) : lrow(l as ReminderList))),
      listEdit && !listEdit.id && listEdit.space === space ? listForm(space, sp) : h('button', { class: 'btn ghost rm-addlist', type: 'button', 'data-k': 'rm-addlist',
        onclick: () => { listEdit = { space, name: '', color: LIST_COLORS[(sp.lists.length + 1) % LIST_COLORS.length] }; render(); focus('rm-lname'); } }, icon('plus', 14) as unknown as Node, t('rm_add_list')));
  }
  function listForm(space: string, sp: SpaceReminders) {
    const f = listEdit!;
    const nItems = f.id ? [...sp.items.values()].filter(r => r.list === f.id).length : 0;
    const save = async () => {
      if (!f.name.trim()) return;
      const ok = await write(space, { type: 'reminder.list_save', ...(f.id ? { id: f.id, version: f.version } : {}), name: f.name.trim(), color: f.color });
      if (ok) listEdit = null; render();
    };
    return h('div', { class: 'rm-lform', 'data-k': 'rm-lform' },
      h('input', { 'data-k': 'rm-lname', value: f.name, maxlength: REMINDER_LIST_NAME_MAX, placeholder: t('rm_list_name'), 'aria-label': t('rm_list_name'), autocomplete: 'off', autofocus: true,
        oninput: (ev: Event) => { f.name = (ev.target as HTMLInputElement).value; }, onkeydown: (ev: KeyboardEvent) => { if (ev.key === 'Enter') void save(); else if (ev.key === 'Escape') { listEdit = null; render(); } } }),
      h('div', { class: 'rm-swatches', role: 'radiogroup', 'aria-label': t('rm_list_color') },
        ...LIST_COLORS.map(c => h('button', { class: `rm-sw rm-c-${c}${f.color === c ? ' on' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(f.color === c), 'aria-label': c,
          onclick: () => { f.color = c; render(); } }))),
      listDelAsk === f.id ? h('div', { class: 'rm-ask' }, h('span', {}, k.tn('rm_list_del', nItems, { name: f.name })),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { listDelAsk = ''; render(); } }, t('cancel')),
        h('button', { class: 'btn danger', type: 'button', 'data-k': 'rm-ldel-ok', onclick: async () => { const ok = await write(space, { type: 'reminder.list_delete', id: f.id, version: f.version });
          if (ok) { listEdit = null; listDelAsk = ''; if (sel.get(space) === listSel(f.id!)) sel.set(space, 'today'); const cur = data.get(space); if (cur) data.set(space, applyUpdate(cur, { removedLists: [f.id!] })); } render(); } }, t('rm_delete')))
        : h('div', { class: 'rm-eact' },
          f.id ? h('button', { class: 'btn ghost rm-del', type: 'button', 'data-k': 'rm-ldel', onclick: () => { listDelAsk = f.id!; render(); } }, icon('trash', 14) as unknown as Node, t('rm_delete')) : null,
          h('span', { class: 'rm-grow' }),
          h('button', { class: 'btn ghost', type: 'button', onclick: () => { listEdit = null; render(); } }, t('cancel')),
          h('button', { class: 'btn pri', type: 'button', 'data-k': 'rm-lsave', disabled: busy === 'reminder.list_save', onclick: () => void save() }, t('rm_ok'))));
  }

  // ---------------------------------------------------------------- main: the selected list
  function main(space: string, sp: SpaceReminders, s: RmSel) {
    const list = selList(s), l = list !== null ? listOf(sp, list) : null;
    const color = l ? l.color : `s-${s}`;
    const items = shown(sp, s, k.me(), Date.now(), tz(), showDone, keep);
    const nDone = list !== null ? [...sp.items.values()].filter(r => r.list === list && r.done).length : 0;
    const title = l ? l.name : t(`rm_s_${s as Smart}` as Key);
    const q = draft ? parseQuick(draft, today(), new Date().toTimeString().slice(0, 5)) : null;
    const qDue = q?.date ? dueLabel({ due: { date: q.date, ...(q.time ? { time: q.time } : {}), tz: tz(), at: 0 } }, Date.now(), tz(), lang(), { today: t('rm_today'), tomorrow: t('rm_tomorrow'), yesterday: t('rm_yesterday') }) : null;
    const adder = s === 'done' ? null : h('div', { class: 'rm-row rm-adder', 'data-k': 'rm-adder' },
      h('span', { class: `rm-check rm-c-${l?.color ?? 'blue'} ghost`, 'aria-hidden': 'true' }, icon('plus', 12) as unknown as Node),
      h('div', { class: 'rm-body' },
        h('input', { class: 'rm-quick', 'data-k': 'rm-quick', value: draft, maxlength: REMINDER_TITLE_MAX + 40, placeholder: t('rm_new_ph'), 'aria-label': t('rm_new'), autocomplete: 'off', enterkeyhint: 'done',
          oninput: (ev: Event) => { draft = (ev.target as HTMLInputElement).value; render(); },
          onkeydown: (ev: KeyboardEvent) => { if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); quickAdd(space, s); } else if (ev.key === 'Escape') { draft = ''; render(); } } }),
        qDue && q?.title !== draft.trim() ? h('div', { class: 'rm-meta' }, h('span', { class: 'rm-due rm-qdue', 'data-k': 'rm-qdue' }, icon('calendar', 12) as unknown as Node, qDue.text)) : null));
    const rows = s === 'scheduled'
      ? byDay(items).flatMap(g => [h('div', { class: 'rm-day label', 'data-k': `rm-day-${g.day}` }, dueLabel({ due: { date: g.day, tz: tz(), at: 0 } }, Date.now(), tz(), lang(), { today: t('rm_today'), tomorrow: t('rm_tomorrow'), yesterday: t('rm_yesterday') })!.text),
          ...g.items.map(r => row(space, sp, r, s))])
      : items.map(r => row(space, sp, r, s));
    const empty = !items.length ? h('div', { class: 'rm-empty', 'data-k': 'rm-empty' }, t(s === 'today' ? 'rm_empty_today' : s === 'done' ? 'rm_empty_done' : 'rm_empty')) : null;
    return h('div', { class: 'rm-main', 'data-k': 'rm-main' },
      h('div', { class: `rm-mhead rm-c-${color}` },
        h('button', { class: 'btn ic mob rm-back', type: 'button', 'data-k': 'rm-back', title: t('rm_back'), 'aria-label': t('rm_back'), onclick: () => { phoneMain = false; edit = null; render(); } }, icon('chevronLeft', 18) as unknown as Node),
        h('h3', { class: 'rm-mt' }, title),
        l && l.id !== INBOX ? h('button', { class: 'btn ic rm-hedit', type: 'button', 'data-k': 'rm-hedit', title: t('rm_list_edit'), 'aria-label': t('rm_list_edit'),
          onclick: () => { const x = l as ReminderList; listEdit = { space, id: x.id, version: x.version, name: x.name, color: x.color }; listDelAsk = ''; phoneMain = false; render(); focus('rm-lname'); } }, icon('pencil', 15) as unknown as Node) : null,
        h('b', { class: 'rm-mn' }, String(items.filter(r => !r.done).length || (s === 'done' ? items.length : 0)))),
      list !== null && nDone ? h('div', { class: 'rm-donebar' }, h('span', {}, k.tn('rm_done_n', nDone)), h('span', { class: 'rm-sep' }, '·'),
        h('button', { class: 'linkbtn rm-lnk', type: 'button', 'data-k': 'rm-showdone', onclick: () => { showDone = !showDone; render(); } }, t(showDone ? 'rm_hide' : 'rm_show')),
        showDone ? h('button', { class: 'linkbtn rm-lnk', type: 'button', 'data-k': 'rm-clear', onclick: () => void write(space, { type: 'reminder.clear', list }) }, t('rm_clear')) : null) : null,
      h('div', { class: 'rm-rows', role: 'list' }, ...rows, adder),
      empty,
      err ? h('div', { class: 'err', role: 'status', 'data-k': 'rm-err' }, err) : null);
  }

  // ---------------------------------------------------------------- the agent's card
  function card(m: Message, th: PublicThread) {
    const c = m.reminder!, space = th.space, sp = data.get(space);
    const pick = cardPick.get(m.id) ?? {};
    const due = c.date ? dueLabel({ due: { date: c.date, ...(c.time ? { time: c.time } : {}), tz: c.tz ?? tz(), at: 0 } }, Date.now(), tz(), lang(), { today: t('rm_today'), tomorrow: t('rm_tomorrow'), yesterday: t('rm_yesterday') }) : null;
    const forId = pick.for ?? c.to ?? k.me(), listId = pick.list ?? INBOX;
    const add = async () => {
      busy = 'reminder.accept'; err = ''; render();
      const r = await k.request({ type: 'reminder.accept', thread: m.thread, msg: m.id, list: listId, for: forId, tz: c.tz ?? tz() }, 8000, true);
      busy = '';
      if (r?.type === 'reminder.saved' && r.reminder) { const cur = data.get(space); if (cur) data.set(space, applyUpdate(cur, { reminders: [r.reminder] })); }
      else err = r?.type === 'error' ? k.errText(r.code) : t('rm_err_timeout');
      render();
    };
    const foot = c.added
      ? h('div', { class: 'pc rm-added', 'data-t': 'rm-added' }, icon('check', 14) as unknown as Node, t('rm_card_added', { name: nameOf(space, c.added.by) }), ' · ',
        h('a', { href: '#', class: 'apl-open', onclick: (ev: Event) => { ev.preventDefault(); k.open(space, 'reminders'); } }, t('rm_card_open')))
      : !sp ? h('div', { class: 'pc' }, t('rm_card_off'))
      : h('div', { class: 'opts rm-copts' },
        h('label', { class: 'rm-f' }, h('span', { class: 'label' }, t('rm_list_label')), h('select', { 'data-t': 'rm-card-list', onchange: (ev: Event) => { cardPick.set(m.id, { ...pick, list: (ev.target as HTMLSelectElement).value }); render(); } },
          ...listsOf(sp).map(l => h('option', { value: l.id, selected: l.id === listId }, l.name)))),
        h('label', { class: 'rm-f' }, h('span', { class: 'label' }, t('rm_for_label')), h('select', { 'data-t': 'rm-card-for', onchange: (ev: Event) => { cardPick.set(m.id, { ...pick, for: (ev.target as HTMLSelectElement).value }); render(); } },
          ...humans(space).map(p => h('option', { value: p.id, selected: p.id === forId }, p.name)))),
        h('span', { class: 'rm-grow' }),
        h('button', { class: 'btn pri', type: 'button', 'data-t': 'rm-accept', disabled: busy === 'reminder.accept', onclick: () => void add() }, icon('plus', 14) as unknown as Node, t('rm_card_add')));
    return h('div', { class: 'propose k-reminder', 'data-t': 'rm-card' }, k.cardBand('reminder', t('rm_card_q'), t('card_by', { agent: cap(c.by) })),
      h('div', { class: 'k-body' }, c.why ? h('div', { class: 'pw' }, c.why) : null,
        h('div', { class: 'rm-row rm-cardrow' }, h('span', { class: `rm-check rm-c-blue${c.added ? ' on' : ''}`, 'aria-hidden': 'true' }, c.added ? icon('check', 12) as unknown as Node : null),
          h('div', { class: 'rm-body' }, h('div', { class: 'rm-t' }, c.title), c.notes ? h('div', { class: 'rm-n' }, c.notes) : null,
            due ? h('div', { class: 'rm-meta' }, h('span', { class: 'rm-due' }, icon('calendar', 12) as unknown as Node, due.text)) : null)),
        foot,
        err && busy === '' && !c.added && sp ? h('div', { class: 'err', role: 'status' }, err) : null));
  }

  return {
    view: 'reminders', module: 'reminders', icon: 'reminder', label: 'rm_nav',
    badge: space => { const sp = data.get(space); return sp ? myTodayCount([...sp.items.values()], k.me(), Date.now(), tz()) || undefined : undefined; },
    synced: space => void load(space),
    leave: () => { edit = null; listEdit = null; listDelAsk = ''; err = ''; phoneMain = false; },
    frame: (f: HubFrame) => {
      if (f.type === 'event' && f.event === 'reminder.updated') { const cur = data.get(f.data.space); if (cur) data.set(f.data.space, applyUpdate(cur, f.data)); return true; }
      return false;
    },
    card: { type: 'reminder', el: card },
    el: space => {
      const sp = data.get(space);
      const head = h('header', { class: 'mx-head' }, k.menuBtn(), h('div', {}, h('h2', {}, h('span', { class: 'with-ic' }, icon('reminder', 18) as unknown as Node, t('rm_title', { space: k.spaceName(space) }))),
        h('p', {}, sp ? t('rm_intro') : t('ex_loading'))));
      if (!sp) { void load(space); return h('section', { class: 'overview reminders' }, head); }
      const s = sel.get(space) ?? 'today';
      return h('section', { class: `overview reminders${phoneMain ? ' has-open' : ''}` }, head,
        h('div', { class: 'scroll' }, h('div', { class: 'rm-lay' }, side(space, sp, s), main(space, sp, s))));
    },
  };
}
