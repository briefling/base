// Reminders module (protocol/reminders.ts, Blair Nov 2026, after Apple's Reminders): lists and reminders shared with
// the space, every member creates, edits, checks and deletes them. A reminder with a date gets ONE EventBridge
// Scheduler schedule `at(...)` in the routines' group (deleted by the scheduler once it fired, or by the hub when the
// reminder is checked, deleted or moved), whose fire queues a Web Push to the reminder's « for » member only. An agent
// never writes one: `reminder.propose` posts a card, a member adds it (`reminder.accept`). Records: `SPACE#<s>` /
// `RLIST#<id>` and `REMINDER#<id>` (JSON `data` + `version`, conditional writes), through the store's module items.
import type { HubFrame, Message, Principal, PushPayload } from '../../protocol/frames.ts';
import { ROUTINE_TZ } from '../../protocol/routines.ts';
import {
  INBOX, REMINDERS_MAX, REMINDER_LISTS_MAX, cardIn, dueAt, listIn, okId, reminderAt, reminderIn, reminderSchedule, sourceIn,
  type Reminder, type ReminderCard, type ReminderFire, type ReminderList, type ReminderSource,
} from '../../protocol/reminders.ts';
import { translate } from '../../client/src/i18n.ts';
import { broadcast, canSee, inTurn, modOn, need, turnAuthor, type Deps, type Space, type StoredThread } from './router.ts';
import { badgeCounter, pushExcerpt, pushTopic, type PushDeps } from './push.ts';
import type { HubModule } from './modules.ts';

type Reply = (f: HubFrame) => Promise<boolean>;
const LIST = 'RLIST', ITEM = 'REMINDER';
const cid = (x: unknown) => typeof x === 'string' && x.length > 0 && x.length <= 64;
/** Margin under which a due time counts as past: no schedule (the scheduler refuses or fires at once). */
const SOON_MS = 30_000;

/** Reminder push job (Push Lambda): ids only, everything re-read at send time. */
export interface ReminderPushJob { reminder: string; space: string; at: number }

async function spaceOf(deps: Deps, id: unknown, who: string): Promise<Space> {
  need(typeof id === 'string');
  const space = await deps.store.getSpace(id as string);
  need(!!space && canSee(space, who), 'forbidden');
  need(modOn(space!, 'reminders'), 'module_off');
  return space!;
}
const lists = (deps: Deps, space: string) => deps.store.listItems<ReminderList>(space, LIST);
const items = (deps: Deps, space: string) => deps.store.listItems<Reminder>(space, ITEM);
const changed = (deps: Deps, space: string, data: { lists?: ReminderList[]; reminders?: Reminder[]; removed?: string[]; removedLists?: string[] }) =>
  broadcast(deps, space, { v: 2, type: 'event', event: 'reminder.updated', data: { space, ...data } });

/** Puts (or removes) the reminder's one-shot schedule. A failure is logged and reported: the reminder stays saved. */
async function sync(deps: Deps, space: string, r: Reminder): Promise<boolean> {
  if (!deps.schedules) return true; // tests without a scheduler, local runs
  const name = reminderSchedule(space, r.id);
  try {
    if (!r.due || r.done || r.due.at <= deps.now() + SOON_MS) await deps.schedules.remove(name);
    else await deps.schedules.put(name, reminderAt(r.due), true, JSON.stringify({ space, reminder: r.id, at: r.due.at } satisfies ReminderFire), { tz: r.due.tz, once: true });
    return true;
  } catch (e) { console.error('reminder_schedule_failed', JSON.stringify({ space, reminder: r.id, err: (e as Error)?.name })); return false }
}
const unschedule = async (deps: Deps, space: string, id: string) => {
  try { await deps.schedules?.remove(reminderSchedule(space, id)) } catch (e) { console.error('reminder_unschedule_failed', JSON.stringify({ space, reminder: id, err: (e as Error)?.name })) }
};

/** Validated reminder of a frame, against the space: its list exists, its recipient is a member. */
async function draftOf(deps: Deps, space: Space, f: any) {
  const d = reminderIn(f); need(!!d);
  need(d!.list === INBOX || (await lists(deps, space.id)).some(l => l.id === d!.list), 'not_found');
  need(space.members.includes(d!.for), 'bad_member');
  return d!;
}
/** The `source` of a new reminder's frame: absent, or a conversation of this space (else refused). */
async function sourceOf(deps: Deps, space: Space, f: any): Promise<ReminderSource | undefined> {
  if (f.source === undefined) return undefined;
  const s = sourceIn(f.source); need(!!s);
  const th = await deps.store.getThread(s!.thread); need(!!th && th.space === space.id, 'not_found');
  return s!;
}
/** Writes a reminder (new: `cur` null), schedules it, tells the space, answers with it. An edit keeps its source. */
async function write(deps: Deps, space: Space, who: string, cur: Reminder | null, d: ReturnType<typeof reminderIn> & {}, f: any, reply: Reply, done?: Reminder['done'] | null, src?: ReminderSource) {
  const { due, ...rest } = d;
  const keepDone = done === undefined ? cur?.done : done ?? undefined;
  const source = cur ? cur.source : src;
  const next: Reminder = { ...rest, ...(due ? { due: { ...due, at: dueAt(due) } } : {}), ...(keepDone ? { done: keepDone } : {}), ...(source ? { source } : {}),
    id: cur?.id ?? deps.newId(), by: cur?.by ?? who, at: deps.now(), version: (cur?.version ?? 0) + 1 };
  need(await deps.store.putItem(space.id, ITEM, next, cur ? cur.version : null), 'stale');
  const scheduled = await sync(deps, space.id, next);
  await changed(deps, space.id, { reminders: [next] });
  console.log('reminder_save', JSON.stringify({ space: space.id, reminder: next.id, by: who, created: !cur, due: !!next.due, done: !!next.done }));
  need(scheduled, 'schedule_failed');
  await reply({ v: 2, type: 'reminder.saved', client_id: f.client_id, space: space.id, reminder: next });
  return next;
}

/** Human frames `reminder.*`: every member of the space, the module on. */
async function human(deps: Deps, who: Principal, f: any, reply: Reply) {
  need(cid(f.client_id));
  if (f.type === 'reminder.accept') return await accept(deps, who, f, reply);
  const space = await spaceOf(deps, f.space, who.id);
  if (f.type === 'reminder.list') {
    const [ls, rs] = await Promise.all([lists(deps, space.id), items(deps, space.id)]);
    return void await reply({ v: 2, type: 'reminder.list', client_id: f.client_id, space: space.id, lists: ls.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)), reminders: rs });
  }
  if (f.type === 'reminder.list_save') {
    const d = listIn(f); need(!!d && (f.id === undefined || okId(f.id)));
    const all = await lists(deps, space.id);
    const cur = f.id === undefined ? null : all.find(l => l.id === f.id) ?? null;
    if (f.id !== undefined) { need(!!cur, 'not_found'); need(f.version === cur!.version, 'stale'); } else need(all.length < REMINDER_LISTS_MAX, 'too_many');
    const next: ReminderList = { ...d!, id: cur?.id ?? deps.newId(), by: who.id, at: cur?.at ?? deps.now(), version: (cur?.version ?? 0) + 1 };
    need(await deps.store.putItem(space.id, LIST, next, cur ? cur.version : null), 'stale');
    await changed(deps, space.id, { lists: [next] });
    return void await reply({ v: 2, type: 'reminder.saved', client_id: f.client_id, space: space.id, list: next });
  }
  if (f.type === 'reminder.list_delete') {
    need(okId(f.id) && f.id !== INBOX && Number.isSafeInteger(f.version));
    const cur = (await lists(deps, space.id)).find(l => l.id === f.id); need(!!cur, 'not_found'); need(cur!.version === f.version, 'stale');
    // Its reminders first (schedules included): a list left behind is harmless, an orphan reminder would still fire.
    const gone = (await items(deps, space.id)).filter(r => r.list === cur!.id);
    for (const r of gone) { await unschedule(deps, space.id, r.id); await deps.store.deleteItem(space.id, ITEM, r.id); }
    await deps.store.deleteItem(space.id, LIST, cur!.id);
    console.log('reminder_list_delete', JSON.stringify({ space: space.id, list: cur!.id, reminders: gone.length, by: who.id }));
    await changed(deps, space.id, { removed: gone.map(r => r.id), removedLists: [cur!.id] });
    return void await reply({ v: 2, type: 'reminder.saved', client_id: f.client_id, space: space.id });
  }
  if (f.type === 'reminder.clear') {
    need(f.list === undefined || okId(f.list));
    const gone = (await items(deps, space.id)).filter(r => r.done && (f.list === undefined || r.list === f.list));
    for (const r of gone) await deps.store.deleteItem(space.id, ITEM, r.id);
    await changed(deps, space.id, { removed: gone.map(r => r.id) });
    return void await reply({ v: 2, type: 'reminder.saved', client_id: f.client_id, space: space.id });
  }
  if (f.type === 'reminder.save' && f.id === undefined) {
    const d = await draftOf(deps, space, f), src = await sourceOf(deps, space, f);
    need((await items(deps, space.id)).length < REMINDERS_MAX, 'too_many');
    return void await write(deps, space, who.id, null, d, f, reply, undefined, src);
  }
  need(okId(f.id) && Number.isSafeInteger(f.version));
  const cur = (await deps.store.getItem<Reminder>(space.id, ITEM, f.id)); need(!!cur, 'not_found'); need(cur!.version === f.version, 'stale');
  if (f.type === 'reminder.save') return void await write(deps, space, who.id, cur, await draftOf(deps, space, f), f, reply);
  if (f.type === 'reminder.done') {
    need(typeof f.done === 'boolean');
    const { id: _i, by: _b, at: _a, version: _v, done: _d, source: _s, due, ...rest } = cur!;
    return void await write(deps, space, who.id, cur, { ...rest, ...(due ? { due: { date: due.date, ...(due.time ? { time: due.time } : {}), tz: due.tz } } : {}) },
      f, reply, f.done ? { by: who.id, at: deps.now() } : null);
  }
  need(f.type === 'reminder.delete');
  await unschedule(deps, space.id, cur!.id);
  await deps.store.deleteItem(space.id, ITEM, cur!.id);
  console.log('reminder_delete', JSON.stringify({ space: space.id, reminder: cur!.id, by: who.id }));
  await changed(deps, space.id, { removed: [cur!.id] });
  await reply({ v: 2, type: 'reminder.saved', client_id: f.client_id, space: space.id });
}

/** A member adds the reminder of an agent's card, with the list, recipient and any field they changed on it. */
async function accept(deps: Deps, who: Principal, f: any, reply: Reply) {
  need(okId(f.thread) && okId(f.msg));
  const thread = await deps.store.getThread(f.thread); need(!!thread, 'forbidden');
  const space = await spaceOf(deps, thread!.space, who.id);
  const card = await deps.store.getMessage(thread!.id, f.msg);
  need(!!card && card.type === 'reminder' && !!card.reminder, 'not_found');
  const c = card!.reminder!;
  need(!c.added, 'closed');
  const pick = (k: string, dflt: unknown) => f[k] === undefined ? dflt : f[k];
  const d = await draftOf(deps, space, { title: pick('title', c.title), notes: pick('notes', c.notes), list: pick('list', INBOX), for: pick('for', c.to ?? who.id),
    date: pick('date', c.date), time: pick('time', c.time), tz: pick('tz', c.tz ?? ROUTINE_TZ) });
  need((await items(deps, space.id)).length < REMINDERS_MAX, 'too_many');
  const id = deps.newId();
  // The card is claimed first (its rev): of two members adding it at once, one only writes the reminder.
  const rev = (card!.rev ?? 0) + 1;
  const r = await deps.store.upsertMessage({ ...card!, reminder: { ...c, added: { id, by: who.id, at: deps.now() } }, rev });
  need(!!r, 'closed');
  await broadcast(deps, space.id, { v: 2, type: 'event', event: 'message.updated', data: r!.message });
  const { due, ...rest } = d;
  // Its source: the card's conversation and message, with the agent's reason (the « why » of the card).
  const source: ReminderSource = { thread: thread!.id, msg: card!.id, ...(c.why ? { why: c.why } : {}) };
  const next: Reminder = { ...rest, ...(due ? { due: { ...due, at: dueAt(due) } } : {}), source, id, by: who.id, at: deps.now(), version: 1 };
  need(await deps.store.putItem(space.id, ITEM, next, null), 'stale');
  const scheduled = await sync(deps, space.id, next);
  await changed(deps, space.id, { reminders: [next] });
  console.log('reminder_accept', JSON.stringify({ space: space.id, reminder: id, thread: thread!.id, by: who.id }));
  need(scheduled, 'schedule_failed');
  await reply({ v: 2, type: 'reminder.saved', client_id: f.client_id, space: space.id, reminder: next });
}

/**
 * Agent `reminder.propose`: a reminder card in the conversation. Gates: a running turn of this agent, started by a
 * human it acts for (turnAuthor), the module on in the space. Prefilled for that human; never stored as a reminder.
 */
async function propose(deps: Deps, cur: StoredThread, as: string, f: any, reply: Reply) {
  const d = cardIn({ ...f, tz: f.tz ?? ROUTINE_TZ });
  need(cid(f.client_id) && !!d);
  need(inTurn(cur, as), 'no_turn');
  const space = await deps.store.getSpace(cur.space); need(!!space && !space.archived, 'forbidden');
  need(modOn(space!, 'reminders'), 'module_off');
  const by = await turnAuthor(deps, space!, cur);
  need(!!by, 'no_turn');
  const reminder: ReminderCard = { ...d!, by: as, to: by! };
  const msg: Message = { id: deps.newId(), thread: cur.id, author: { kind: 'agent', id: as }, type: 'reminder', text: `Reminder: ${d!.title}`, reminder, at: deps.now() };
  await deps.store.upsertMessage(msg);
  await broadcast(deps, space!.id, { v: 2, type: 'event', event: 'message.created', data: msg });
  await reply({ v: 2, type: 'ack', client_id: f.client_id, thread: cur.id, msg_id: msg.id });
}

/** The schedule fired (Routine Lambda): re-read, then queue the push unless checked, moved, deleted or no longer due. */
export async function fireReminder(deps: Deps, e: ReminderFire): Promise<string> {
  const space = await deps.store.getSpace(e.space);
  const r = space ? await deps.store.getItem<Reminder>(space.id, ITEM, e.reminder) : null;
  const result = !space || space.archived ? 'no_space' : !modOn(space, 'reminders') ? 'module_off' : !r ? 'gone' : r.done ? 'done'
    : r.due?.at !== e.at ? 'moved' : !space.members.includes(r.for) ? 'not_member' : 'queued';
  if (result === 'queued' && deps.queuePush) await deps.queuePush({ reminder: r!.id, space: space!.id, at: e.at } satisfies ReminderPushJob);
  console.log('reminder_fire', JSON.stringify({ space: e.space, reminder: e.reminder, result }));
  return result;
}

/** Notification: the reminder's title over « <list> · <space> »; opens its source conversation (on the card's message)
 *  when it has one, else the space's Reminders view. */
export const reminderPushPayload = (space: string, spaceName: string, r: Pick<Reminder, 'title' | 'source'>, listName: string, lang: 'en' | 'fr', badge?: number): PushPayload =>
  ({ title: pushExcerpt(r.title, 120) || translate(lang, 'rm_title_short'), body: translate(lang, 'notif_rm_body', { list: listName, space: spaceName }), space, view: 'reminders',
    ...(r.source ? { thread: r.source.thread, ...(r.source.msg ? { msg: r.source.msg } : {}) } : {}), ...(badge === undefined ? {} : { badge }) });

/** Push to every device of the reminder's recipient, re-read at send time (same per-device handling as sendPushes). */
async function sendReminderPush(deps: PushDeps, job: ReminderPushJob) {
  const out = { sent: 0, gone: 0, failed: 0 };
  const space = await deps.store.getSpace(job.space);
  if (!space || space.archived) return { ...out, skipped: 'no_space' };
  const r = await deps.store.getItem<Reminder>(space.id, ITEM, job.reminder);
  if (!r || r.done || r.due?.at !== job.at || !space.members.includes(r.for)) return { ...out, skipped: 'not_due' };
  const list = r.list === INBOX ? null : await deps.store.getItem<ReminderList>(space.id, LIST, r.list);
  // Its source conversation only while it still exists in this space (else the notification opens Reminders).
  const src = r.source ? await deps.store.getThread(r.source.thread) : null;
  if (r.source && (!src || src.space !== space.id)) delete r.source;
  const subs = await deps.store.listPushes(r.for);
  const badge = subs.length ? await badgeCounter(deps.store)(r.for) : undefined;
  for (const sub of subs) {
    const payload = reminderPushPayload(space.id, space.name ?? space.id, r, list?.name ?? translate(sub.lang, 'rm_inbox'), sub.lang, badge);
    let status = 0;
    try { status = await deps.send(sub, JSON.stringify(payload), pushTopic(`reminder:${r.id}`)) } catch { status = 0 }
    if (status >= 200 && status < 300) out.sent++;
    else if (status === 404 || status === 410) { out.gone++; await deps.store.deletePush(r.for, sub.id); }
    else out.failed++;
  }
  return out;
}

export const reminders: HubModule = {
  module: 'reminders',
  prefix: 'reminder',
  human,
  agent: { 'reminder.propose': propose },
  fire: { owns: (e: any) => !!e && typeof e.space === 'string' && typeof e.reminder === 'string' && okId(e.reminder) && Number.isSafeInteger(e.at), run: fireReminder },
  push: { owns: (j: any) => !!j && typeof j.reminder === 'string', label: (j: ReminderPushJob) => `reminder:${j.space}`, send: sendReminderPush },
};
