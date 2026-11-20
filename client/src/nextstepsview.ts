// Actions on the lines « Next » of the summary card: on hover (long press on a phone, in the bottom
// sheet), a line for an agent gets « Open the thread » (a lead, « threads » on: `next.open`, hub/src/nextsteps.ts),
// a line for a human gets « Remind me » (« reminders » on: a reminder of the Reminders module, its date picked here).
// Once opened, the line keeps a link to its thread instead of the button. Pure rules: client/src/nextsteps.ts.
import type { PublicThread } from '../../protocol/frames.ts';
import { INBOX, REMINDER_TITLE_MAX } from '../../protocol/reminders.ts';
import type { UiKit } from './modules.ts';
import { openedFrom, stepKind } from './nextsteps.ts';

type Step = { who: string; what: string };
export interface NextAction { icon: string; label: string; run(): void }

export function nextStepsView(k: UiKit, x: { press(thread: string, i: number): Record<string, unknown>; goThread(id: string): void }) {
  const { h, icon, t } = k;
  let remind: { key: string; date: string; time: string } | null = null;
  let busy = '';
  const err = new Map<string, string>();
  const added = new Set<string>(); // reminders added from this tab: the line says so until the next summary
  const keyOf = (f: PublicThread, what: string) => `${f.id}\n${what}`;
  const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

  async function openThread(f: PublicThread, what: string) {
    const key = keyOf(f, what);
    if (busy) return;
    busy = key; err.delete(key); k.render();
    const r = await k.request({ type: 'next.open', thread: f.id, what }, 8000, true);
    busy = '';
    if (r?.type === 'error') err.set(key, k.errText(r.code));
    else if (!r) err.set(key, t('rm_err_timeout'));
    k.render(); // the link comes with the origin's thread.upserted (every tab), the ack only confirms
  }
  async function addReminder(f: PublicThread, what: string) {
    const key = keyOf(f, what);
    if (!remind || remind.key !== key || !remind.date || busy) return;
    busy = key; err.delete(key); k.render();
    // Its source: this conversation (the Reminders view links back to it, its notification opens it).
    const r = await k.request({ type: 'reminder.save', space: f.space, title: what.slice(0, REMINDER_TITLE_MAX), source: { thread: f.id },
      list: INBOX, for: k.me(), date: remind.date, ...(remind.time ? { time: remind.time } : {}), tz: tz() }, 8000, true);
    busy = '';
    if (r?.type === 'reminder.saved') { added.add(key); remind = null; }
    else err.set(key, r?.type === 'error' ? k.errText(r.code) : t('rm_err_timeout'));
    k.render();
  }

  /** The action a line offers now (none: nothing to do, or no right to). */
  function action(f: PublicThread, s: Step): NextAction | null {
    const kind = stepKind(s.who, k.people(f.space));
    if (kind === 'agent' && !openedFrom(f, s.what) && k.trusted(f.space) && k.modOn(f.space, 'threads'))
      return { icon: 'thread', label: t('open_thread'), run: () => void openThread(f, s.what) };
    if (kind === 'human' && !added.has(keyOf(f, s.what)) && k.modOn(f.space, 'reminders'))
      return { icon: 'reminder', label: t('ns_remind'), run: () => { remind = { key: keyOf(f, s.what), date: '', time: '' }; k.render(); setTimeout(() => (document.querySelector('[data-t="ns-date"]') as HTMLInputElement | null)?.focus(), 0); } };
    return null;
  }

  function form(f: PublicThread, s: Step) {
    const r = remind!, key = keyOf(f, s.what);
    return h('div', { class: 'ns-form', 'data-t': 'ns-form' },
      h('label', { class: 'rm-f' }, h('span', { class: 'label' }, t('rm_date')),
        h('input', { type: 'date', 'data-t': 'ns-date', value: r.date, onchange: (ev: Event) => { r.date = (ev.target as HTMLInputElement).value; k.render(); } })),
      h('label', { class: 'rm-f' }, h('span', { class: 'label' }, t('rm_time')),
        h('input', { type: 'time', 'data-t': 'ns-time', value: r.time, disabled: !r.date, onchange: (ev: Event) => { r.time = (ev.target as HTMLInputElement).value; k.render(); } })),
      h('span', { class: 'rm-grow' }),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => { remind = null; err.delete(key); k.render(); } }, t('cancel')),
      h('button', { class: 'btn pri', type: 'button', 'data-t': 'ns-add', disabled: !r.date || busy === key, onclick: () => void addReminder(f, s.what) }, icon('plus', 14) as unknown as Node, t('rm_card_add')));
  }

  /** One line « Next » of the summary card. */
  function row(f: PublicThread, i: number, s: Step): HTMLElement {
    const key = keyOf(f, s.what), opened = openedFrom(f, s.what), a = action(f, s), e = err.get(key);
    return h('div', { class: 'sc-nrow', 'data-k': `ns:${f.id}:${i}`, ...(a ? x.press(f.id, i) : {}) },
      h('span', { class: 'sc-who' }, s.who), ' ', s.what,
      opened ? h('button', { class: 'linkbtn sc-opened', type: 'button', 'data-t': 'ns-opened', onclick: () => x.goThread(opened) },
        icon('thread', 12) as unknown as Node, k.threadTitle(opened) ? t('ns_opened_t', { title: k.threadTitle(opened)! }) : t('ns_opened')) : null,
      added.has(key) ? h('span', { class: 'sc-added', 'data-t': 'ns-added' }, icon('check', 12) as unknown as Node, t('ns_added')) : null,
      a && remind?.key !== key ? h('button', { class: 'btn ghost sc-act', type: 'button', 'data-t': 'ns-act', disabled: busy === key, onclick: a.run }, icon(a.icon, 13) as unknown as Node, a.label) : null,
      remind?.key === key ? form(f, s) : null,
      e ? h('div', { class: 'err', role: 'status', 'data-t': 'ns-err' }, e) : null);
  }

  return { row, action };
}
