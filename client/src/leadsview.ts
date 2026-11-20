// Pending leads (protocol/leads.ts, hub/src/leads.ts), module « threads »: the Leads view of a space (each lead, the
// closed thread it comes from, where it was recalled; Discuss it apart and Delete for a lead), always in the sidebar,
// and under the agent's reply in a conversation that recalled some, one block per closed thread they come from (Blair
// Nov 18, mock design/leads-recall-states.png): « N steps never started », to decide / settled, each step cut to two
// lines with whom it was for, its two choices (add it here, discuss it apart) or, once decided, who, when and what.
// Pure rules: protocol/leads.ts, recallUnder and recallGroups below.
import type { HubFrame, LeadRecalled, Message, PublicThread } from '../../protocol/frames.ts';
import type { Lead } from '../../protocol/leads.ts';
import type { ClientModule, UiKit } from './modules.ts';
import { tagHue } from './recents.ts';

/** Still to decide: no decision recorded, no thread opened from it (recalls stored before Nov 18 have `thread` alone). */
export const undecided = (r: Pick<LeadRecalled, 'decided' | 'thread'>) => !r.decided && !r.thread;

/** The recalled leads by the closed thread they come from, in recall order: one block each. */
export function recallGroups<R extends Pick<LeadRecalled, 'from'>>(rs: readonly R[]): { from: string; rs: R[] }[] {
  const out = new Map<string, R[]>();
  for (const r of rs) out.set(r.from, [...(out.get(r.from) ?? []), r]);
  return [...out].map(([from, rs]) => ({ from, rs }));
}

/** The tags of a space's leads, most used first (then by name): the filter bar of the Leads view. */
export function leadTags(ls: readonly Pick<Lead, 'tags'>[]): { tag: string; n: number }[] {
  const n = new Map<string, number>();
  for (const l of ls) for (const tg of new Set(l.tags ?? [])) n.set(tg, (n.get(tg) ?? 0) + 1);
  return [...n].map(([tag, n]) => ({ tag, n })).sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag));
}

/** The agent message a conversation's recalled leads go under: its first reply after the recall (none yet: nowhere). */
export function recallUnder(th: Pick<PublicThread, 'leadsRecalled'>, all: readonly Pick<Message, 'id' | 'at' | 'author' | 'deleted'>[]): string | null {
  const at = Math.min(...(th.leadsRecalled ?? []).map(r => r.at));
  if (!Number.isFinite(at)) return null;
  return all.find(m => m.author.kind === 'agent' && !m.deleted && m.at >= at)?.id ?? null;
}

export function leadsModule(k: UiKit, x: { goThread(id: string): void }): ClientModule & { recallEl(th: PublicThread, m: Message, all: readonly Message[]): HTMLElement | null } {
  const { h, icon, t } = k;
  const data = new Map<string, Map<string, Lead>>();
  const loading = new Map<string, number>(); // space -> number of its request in flight
  const failed = new Map<string, string>(); // the list did not come: why, with a Retry
  let busy = '';
  const err = new Map<string, string>();
  const picked = new Map<string, string>(); // space -> tag filtering its Leads view (a click again clears it)
  let ask = ''; // lead whose deletion waits for a confirmation

  /** The space's list. A new sync asks again even while a request is out (it may have gone on the dead socket); the
   *  answer of an older request is dropped. */
  async function load(space: string) {
    const n = (loading.get(space) ?? 0) + 1;
    loading.set(space, n);
    const r = await k.request({ type: 'lead.list', space }, 8000, true);
    if (loading.get(space) !== n) return;
    loading.delete(space);
    if (r?.type === 'lead.list') { failed.delete(space); data.set(space, new Map(r.leads.map(l => [l.id, l]))); }
    else failed.set(space, r?.type === 'error' ? k.errText(r.code) : t('rm_err_timeout')); // never « Loading… » forever
    k.render();
  }

  /** lead.open (a topic to discuss it, opened on screen), lead.take (posted in `thread`, stays here), lead.delete. */
  async function act(space: string, type: 'lead.open' | 'lead.delete' | 'lead.take', id: string, more: { thread?: string; text?: string } = {}) {
    if (busy) return;
    busy = id; err.delete(id); ask = ''; k.render();
    const r = await k.request({ type, space, id, ...more }, 8000, true);
    busy = '';
    if (r?.type === 'error') err.set(id, k.errText(r.code));
    else if (!r) err.set(id, t('rm_err_timeout'));
    else if (r.type === 'ack') { data.get(space)?.delete(id); if (type === 'lead.open' && r.thread) x.goThread(r.thread); }
    k.render();
  }
  const canAct = (space: string) => k.trusted(space) && k.modOn(space, 'threads');

  /** One lead in its closed thread's card: who it was for, the step on two lines, when, where it was recalled; the
   *  actions on the right (a lead), the deletion confirmed in place. */
  function row(space: string, l: Lead) {
    const e = err.get(l.id);
    const who = l.who.trim();
    return h('div', { class: 'ld-row', 'data-t': 'lead', 'data-k': `lead:${l.id}` },
      h('span', { class: 'ld-av', 'aria-hidden': 'true' }, (who[0] ?? '?').toUpperCase()),
      h('div', { class: 'ld-main' },
        h('div', { class: 'ld-what', title: l.what }, l.what),
        h('div', { class: 'ld-sub' },
          who ? h('span', {}, t('ld_for', { who })) : null,
          h('span', { class: 'ld-dot' }, k.since(l.at)),
          l.recalled ? h('button', { class: 'ld-tag', type: 'button', 'data-t': 'lead-recalled', onclick: () => x.goThread(l.recalled!.thread) },
            icon('link', 11) as unknown as Node, t('ld_recalled', { title: k.threadTitle(l.recalled.thread) ?? '…' })) : null),
        e ? h('div', { class: 'err', role: 'status' }, e) : null),
      canAct(space) ? h('div', { class: `ld-acts${ask === l.id ? ' asking' : ''}` },
        ...(ask === l.id
          ? [h('span', { class: 'ld-ask' }, t('ld_delete_ask')),
            h('button', { class: 'btn ghost', type: 'button', onclick: () => { ask = ''; k.render(); } }, t('cancel')),
            h('button', { class: 'btn danger', type: 'button', 'data-t': 'lead-del-yes', disabled: busy === l.id, onclick: () => void act(space, 'lead.delete', l.id) }, t('ld_delete'))]
          : [h('button', { class: 'btn ghost ld-go', type: 'button', 'data-t': 'lead-open', disabled: busy === l.id, title: t('ld_apart'), onclick: () => void act(space, 'lead.open', l.id) },
              icon('messageSquarePlus', 14) as unknown as Node, t('ld_apart_short')),
            h('button', { class: 'ld-del', type: 'button', 'data-t': 'lead-del', disabled: busy === l.id, title: t('ld_delete'), 'aria-label': t('ld_delete'), onclick: () => { ask = l.id; k.render(); } },
              icon('trash', 14) as unknown as Node)])) : null);
  }

  const pick = (space: string, tg: string) => { if (picked.get(space) === tg) picked.delete(space); else picked.set(space, tg); k.render(); };
  const tagBtn = (space: string, tg: string, cls: string, n?: number) => {
    const on = picked.get(space) === tg;
    return h('button', { class: `${cls} ${tagHue(tg)}${on ? ' on' : ''}`, type: 'button', 'aria-pressed': String(on), 'data-tag': tg,
      title: t('mem_tag_pick', { tag: tg }), onclick: () => pick(space, tg) }, `#${tg}`, n === undefined ? null : h('span', { class: 'n' }, String(n)));
  };

  /** The leads of one closed thread: its title (link), when they were left, how many. */
  function group(space: string, from: string, ls: Lead[]) {
    return h('section', { class: 'ld-group', 'data-t': 'lead-group', 'data-k': `lg:${from}` },
      h('header', { class: 'ld-ghead' },
        h('span', { class: 'ld-gic' }, icon('thread', 15) as unknown as Node),
        h('div', { class: 'ld-gtitle' },
          h('button', { class: 'ld-gname', type: 'button', onclick: () => x.goThread(from) }, k.threadTitle(from) ?? ls[0].fromTitle),
          h('div', { class: 'ld-gsub' }, t('ld_closed', { when: k.since(Math.max(...ls.map(l => l.at))) }),
            ...[...new Set(ls.flatMap(l => l.tags ?? []))].map(tg => tagBtn(space, tg, 'ld-gtag')))),
        h('span', { class: 'ld-count' }, k.tn('ld_count', ls.length))),
      h('div', { class: 'ld-items' }, ...ls.map(l => row(space, l))));
  }

  /** A decided step: ✓ what was chosen, by whom, when, and the conversation it became. */
  function decidedEl(th: PublicThread, r: LeadRecalled) {
    const how = r.decided?.how ?? 'thread';
    const label = how === 'here' ? t(th.kind === 'topic' ? 'ld_d_here_topic' : 'ld_d_here') : t(`ld_d_${how}`);
    const by = r.decided ? `${r.decided.by === k.me() ? t('you') : k.personName(r.decided.by) ?? t('a_member')}, ${k.since(r.decided.at)}` : null;
    return h('div', { class: 'ld-dec', 'data-t': 'lead-decided', 'data-how': how },
      h('span', { class: `chip ${how === 'dropped' ? 'c-calm' : 'c-ok'}` }, icon(how === 'dropped' ? 'x' : 'check', 11) as unknown as Node, label),
      by ? h('span', { class: 'ld-by' }, by) : null,
      r.thread ? h('button', { class: 'linkbtn', type: 'button', 'data-t': 'lead-opened', onclick: () => x.goThread(r.thread!) },
        k.threadTitle(r.thread) ?? (how === 'topic' ? t('ld_topic') : t('ns_opened'))) : null);
  }

  /** Under the agent's reply: one block per closed thread its leads come from, each step with its choice or decision. */
  function recallEl(th: PublicThread, m: Message, all: readonly Message[]): HTMLElement | null {
    if (!th.leadsRecalled?.length || recallUnder(th, all) !== m.id) return null;
    const can = canAct(th.space);
    const step = (r: LeadRecalled) => {
      const text = t(th.kind === 'topic' ? 'ld_take_msg_topic' : 'ld_take_msg', { agent: `@${m.author.id[0].toUpperCase()}${m.author.id.slice(1)}`, what: r.what });
      return h('div', { class: 'ld-step', 'data-t': 'lead-recall', 'data-k': `lr:${r.id}` },
        h('div', { class: 'ld-what', title: r.what }, r.what),
        r.who ? h('div', { class: 'ld-for' }, t('ld_for', { who: r.who })) : null,
        !undecided(r) ? decidedEl(th, r)
          : can ? h('div', { class: 'ld-acts' },
            h('button', { class: 'btn pri', type: 'button', 'data-t': 'lead-take', disabled: busy === r.id,
              onclick: () => void act(th.space, 'lead.take', r.id, { thread: th.id, text }) }, icon('check', 13) as unknown as Node, t(th.kind === 'topic' ? 'ld_take_topic' : 'ld_take')),
            h('button', { class: 'btn ghost', type: 'button', 'data-t': 'lead-apart', disabled: busy === r.id,
              onclick: () => void act(th.space, 'lead.open', r.id, { thread: th.id }) }, icon('messageSquarePlus', 13) as unknown as Node, t('ld_apart'))) : null,
        err.get(r.id) ? h('div', { class: 'err', role: 'status' }, err.get(r.id)!) : null);
    };
    const block = (g: { from: string; rs: LeadRecalled[] }) => {
      const open = g.rs.filter(undecided).length;
      const done = open === 0;
      return h('div', { class: `ld-block${done ? ' done' : ''}`, 'data-t': 'lead-block', 'data-k': `lb:${g.from}` },
        h('div', { class: 'ld-head' }, icon('link', 14) as unknown as Node,
          h('b', {}, k.tn('ld_never', g.rs.length)),
          h('span', { class: `chip ${done ? 'c-ok' : 'c-wait'}`, 'data-t': 'lead-state' },
            done ? icon('check', 11) as unknown as Node : null, done ? t('ld_settled') : open === g.rs.length ? t('ld_to_decide') : t('ld_n_to_decide', { n: open }))),
        h('div', { class: 'ld-why' }, t('ld_planned_at'), ' ',
          h('button', { class: 'linkbtn', type: 'button', 'data-t': 'lead-from', onclick: () => x.goThread(g.from) }, k.threadTitle(g.from) ?? g.rs[0].fromTitle),
          done ? '.' : t('ld_nobody')),
        ...g.rs.map(step));
    };
    return h('div', { class: 'ld-recalls' }, ...recallGroups(th.leadsRecalled).map(block));
  }

  return {
    view: 'leads', module: 'threads', icon: 'link', label: 'ld_nav',
    badge: () => undefined,
    synced: space => void load(space),
    leave: () => { ask = ''; err.clear(); },
    frame: (f: HubFrame) => {
      if (f.type !== 'event' || f.event !== 'lead.updated') return false;
      const cur = data.get(f.data.space);
      if (!cur) return true;
      for (const l of f.data.leads ?? []) cur.set(l.id, l);
      for (const id of f.data.removed ?? []) cur.delete(id);
      return true;
    },
    el: space => {
      const sp = data.get(space);
      const head = h('header', { class: 'mx-head' }, k.menuBtn(), h('div', {},
        h('h2', {}, h('span', { class: 'with-ic' }, icon('link', 18) as unknown as Node, t('ld_title', { space: k.spaceName(space) })),
          sp?.size ? h('span', { class: 'ld-total' }, String(sp.size)) : null),
        h('p', {}, sp || failed.has(space) ? t('ld_intro') : t('ex_loading'))));
      if (!sp && failed.has(space)) return h('section', { class: 'overview leads' }, head,
        h('div', { class: 'scroll' }, h('p', { class: 'err', role: 'status', 'data-t': 'lead-list-err' }, failed.get(space)!, ' ',
          h('button', { class: 'btn ghost', type: 'button', onclick: () => { failed.delete(space); void load(space); k.render(); } }, t('ni_retry')))));
      if (!sp) { if (!loading.has(space)) void load(space); return h('section', { class: 'overview leads' }, head); }
      const all = [...sp.values()].sort((a, b) => b.at - a.at);
      const tags = leadTags(all);
      const tg = tags.some(x => x.tag === picked.get(space)) ? picked.get(space)! : '';
      const list = tg ? all.filter(l => l.tags?.includes(tg)) : all;
      const groups = recallGroups(list) as { from: string; rs: Lead[] }[]; // newest first, by closed thread
      return h('section', { class: 'overview leads' }, head,
        h('div', { class: 'scroll' },
          tags.length ? h('div', { class: 'ld-tagbar', 'data-t': 'lead-tags' }, ...tags.map(x => tagBtn(space, x.tag, 'ld-tag-f', x.n))) : null,
          list.length ? h('div', { class: 'ld-list' }, ...groups.map(g => group(space, g.from, g.rs)))
          : h('div', { class: 'ld-empty' }, icon('check', 22) as unknown as Node, h('b', {}, t('ld_empty')), h('span', {}, t('ld_empty_sub')))));
    },
    recallEl,
  };
}
