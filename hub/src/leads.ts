// Pending leads of a space (protocol/leads.ts): a closed thread's lines « Next » for an agent that nobody
// opened are kept as leads of the space (generic space items, kind LEAD), recalled once at the start of a new topic or
// thread on the same subject, and listed, deleted or opened from the Leads view. Gated by the « threads » module: a lead
// is only worth something if it can become a thread. Plugged in through hub/src/modules.ts.
import { isGeneralId, topicText, type HubFrame, type LeadDecision, type LeadRecalled, type Message, type Principal } from '../../protocol/frames.ts';
import { LEADS_MAX, LEAD_TEXT_MAX, leadId, leadMatch, recallLeads, stepKind, type Lead } from '../../protocol/leads.ts';
import { messageTo, withPerson } from '../../protocol/notify.ts';
import { mentionedIds } from '../../client/src/recent.ts';
import { type Deps, type Space, type StoredThread, afterHumanMessage, agentsOf, boardDriven, broadcast, canSee, deliver, humansOf, id as isId, modOn, mutateThread,
  need, peopleOf as threadPeople, publicThread, str, unarchive } from './router.ts';
import type { HubModule } from './modules.ts';

type Reply = (f: HubFrame) => Promise<boolean>;
const KIND = 'LEAD';
const list = (deps: Deps, space: string) => deps.store.listItems<Lead>(space, KIND);
const changed = (deps: Deps, space: string, data: { leads?: Lead[]; removed?: string[] }) =>
  broadcast(deps, space, { v: 2, type: 'event', event: 'lead.updated', data: { space, ...data } });

/** Spaces where leads exist: the « threads » module on, not a board-driven space (work starts from issues there). */
const leadsOn = (space: Space) => !space.archived && modOn(space, 'threads') && !boardDriven(space);
/** The people a summary line's `who` is matched against: the space's agents and humans. */
const peopleOf = (space: Space) => [...agentsOf(space).map(id => ({ id, name: id, kind: 'agent' as const })),
  ...space.members.map(id => ({ id, name: space.names?.[id] ?? id, kind: 'human' as const }))];

/**
 * A thread closed (turn_outcome done, Closed by a lead): its summary's lines for an agent that nobody opened become
 * leads. Skipped: a line already opened (the button, `nextOpened`) or whose thread already exists (a conversation of the
 * space whose title matches: the next step of a plan, a card opened by hand).
 * Idempotent: a lead's id is its line, a lead already stored is left as it is (its recall stays done).
 */
export async function captureLeads(deps: Deps, space: Space, thread: StoredThread): Promise<Lead[]> {
  if (!leadsOn(space) || thread.kind === 'topic' || thread.memoryReview || thread.applet || thread.routine || isGeneralId(thread.id)) return [];
  const sum = await deps.store.getSummary(thread.id);
  const people = peopleOf(space);
  const lines = (sum?.next_steps ?? []).filter(s => s.what.trim() && s.what.length <= LEAD_TEXT_MAX && stepKind(s.who, people) === 'agent'
    && !thread.nextOpened?.some(n => n.what === s.what));
  if (!lines.length) return [];
  const others = (await deps.store.listThreads(space.id, 0)).filter(t => t.id !== thread.id && !isGeneralId(t.id));
  const have = new Map((await list(deps, space.id)).map(l => [l.id, l]));
  const saved: Lead[] = [];
  for (const s of lines) {
    const id = leadId(thread.id, s.what);
    if (have.has(id) || others.some(t => leadMatch(s.what, t.title ?? ''))) continue;
    const lead: Lead = { id, space: space.id, from: thread.id, fromTitle: thread.title, agent: thread.owner, who: s.who, what: s.what, at: deps.now(), version: 1,
      tags: thread.tags?.list ?? [] };
    if (await deps.store.putItem(space.id, KIND, lead, null)) { saved.push(lead); have.set(id, lead); }
  }
  // Past LEADS_MAX the oldest go: a lead nobody took for that long is not worth a recall.
  const over = [...have.values()].sort((a, b) => a.at - b.at).slice(0, Math.max(0, have.size - LEADS_MAX));
  for (const l of over) await deps.store.deleteItem(space.id, KIND, l.id);
  if (saved.length || over.length) await changed(deps, space.id, { leads: saved.filter(l => !over.includes(l)), removed: over.map(l => l.id) });
  if (saved.length) console.log('leads_saved', JSON.stringify({ space: space.id, from: thread.id, n: saved.length }));
  return saved;
}

/**
 * First delivery of a new topic or thread: the pending leads close to its title and first message (strict threshold,
 * protocol/leads.ts), each marked recalled in a conditional write, so a lead is recalled once even by two Lambdas at
 * the same time. The conversation keeps them (`leadsRecalled`) for the button under the agent's reply. Not for a plan
 * step, a thread opened from a line « Next » (already decided), a guest, a hidden run, General.
 */
export async function recallFor(deps: Deps, space: Space, thread: StoredThread, msg: Message, agent: string): Promise<{ thread: StoredThread; leads: LeadRecalled[] }> {
  const none = { thread, leads: [] };
  if (!leadsOn(space) || thread.lastTurnAt !== 0 || thread.leadsRecalled || thread.plan || thread.nextOf || thread.memoryReview || thread.applet
    || thread.routine || thread.radar || isGeneralId(thread.id) || (thread.kind !== 'topic' && agent !== thread.owner) || msg.author.kind !== 'human') return none;
  const pool = await list(deps, space.id);
  if (!pool.length) return none;
  const got: LeadRecalled[] = [];
  for (const l of recallLeads(pool, `${thread.title}\n${msg.text}`, thread.id)) {
    const next: Lead = { ...l, recalled: { thread: thread.id, at: deps.now() }, version: l.version + 1 };
    if (!(await deps.store.putItem(space.id, KIND, next, l.version))) continue; // recalled elsewhere meanwhile
    got.push({ id: l.id, from: l.from, fromTitle: l.fromTitle, what: l.what, at: next.recalled!.at, ...(l.who ? { who: l.who } : {}) });
    await changed(deps, space.id, { leads: [next] });
  }
  if (!got.length) return none;
  const t = await mutateThread(deps, thread.id, { type: 'noop' }, undefined, undefined, x => ({ ...x, leadsRecalled: got }), false);
  await broadcast(deps, space.id, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(t) });
  console.log('leads_recalled', JSON.stringify({ space: space.id, thread: thread.id, leads: got.map(g => g.id) }));
  return { thread: t, leads: got };
}

/** A recall still waits for a decision: none recorded, no thread opened from it (before Nov 18, `thread` alone). */
export const undecided = (r: LeadRecalled) => !r.decided && !r.thread;

/**
 * A lead's decision on the conversation that recalled it, once (conditional write through mutateThread's version): of
 * two clicks or two tabs, only one records it, and only that one acts (posts, opens). `link`: the thread or topic it became.
 */
async function decide(deps: Deps, space: Space, conv: string, id: string, d: LeadDecision, link?: string): Promise<boolean> {
  const t = await deps.store.getThread(conv);
  if (!t?.leadsRecalled?.some(r => r.id === id && undecided(r))) return false;
  let won = false;
  const next = await mutateThread(deps, conv, { type: 'noop' }, undefined, undefined, x => {
    won = !!x.leadsRecalled?.some(r => r.id === id && undecided(r));
    return won ? { ...x, leadsRecalled: x.leadsRecalled!.map(r => r.id === id ? { ...r, decided: d, ...(link ? { thread: link } : {}) } : r) } : x;
  }, false);
  if (won) await broadcast(deps, space.id, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(next) });
  return won;
}

/** A lead leaves the space's list (its item gone, the views told). */
async function forget(deps: Deps, space: Space, id: string) {
  if (!(await deps.store.getItem<Lead>(space.id, KIND, id))) return;
  await deps.store.deleteItem(space.id, KIND, id);
  await changed(deps, space.id, { removed: [id] });
}

/** A lead's summary line was opened as a thread (`next.open`): it leaves the list; the conversation that recalled it links the thread. */
export async function dropLead(deps: Deps, space: Space, id: string, opened: string, by: string) {
  const l = await deps.store.getItem<Lead>(space.id, KIND, id);
  if (!l) return;
  await forget(deps, space, id);
  if (l.recalled) await decide(deps, space, l.recalled.thread, id, { how: 'thread', by, at: deps.now() }, opened);
}

/** The agent of a topic opened from a lead: the agent of its closed thread while still in the space, else the one of
 *  the conversation that recalled it, else the space's agent. */
function topicAgent(space: Space, origin: StoredThread | null, conv: StoredThread | null): string {
  const agents = agentsOf(space);
  return [origin?.owner, conv?.kind === 'thread' || conv?.kind === undefined ? conv?.owner : undefined].find(a => a && agents.includes(a)) ?? space.defaultAgent;
}

/** The lead's ask in a topic opened from a lead (never stored): its view in one message, then a wait. */
export function leadTopicGo(topic: StoredThread, by: string, first: Message, fromTitle: string, from: string, deps: Pick<Deps, 'newId' | 'now'>): Message {
  return { id: deps.newId(), thread: topic.id, author: { kind: 'human', id: by }, type: 'text', at: deps.now(),
    text: `Topic opened from a pending lead: a step planned when the thread "${fromTitle.replace(/\s+/g, ' ').slice(0, 120)}" (id ${from}) closed, `
      + 'never started. We discuss it before acting. Post your view in one message: is it still needed, what it involves, '
      + 'the risks, what you recommend. Then wait for the team: start no work and open no thread on your own.\n\n' + first.text };
}

/**
 * « Discuss it apart » (Leads view, or under the agent's reply): a Lounge topic written by the lead who clicked, with
 * the lead's agent, whose first message is the step; the agent gives its view and waits (Blair Nov 18: no thread
 * started straight from a lead any more). Claimed first (the lead's item, else the recall), so a second click only
 * answers with the same topic.
 */
async function openTopic(deps: Deps, who: Principal, space: Space, f: any, reply: Reply) {
  const conv = f.thread === undefined ? null : await deps.store.getThread(f.thread);
  need(f.thread === undefined || (!!conv && conv.space === space.id), 'forbidden');
  const rec = conv?.leadsRecalled?.find(r => r.id === f.id);
  const l = await deps.store.getItem<Lead>(space.id, KIND, f.id);
  need(!!l || !!rec, 'not_found');
  const ack = (thread: string) => reply({ v: 2, type: 'ack', client_id: f.client_id, thread, msg_id: '' });
  if (l?.topic) return void await ack(l.topic);
  if (rec && !undecided(rec)) return void await ack(rec.thread ?? conv!.id);
  const src = l ?? rec!;
  const topicId = deps.newId();
  const recallIn = l?.recalled?.thread ?? conv?.id;
  if (l) {
    if (!(await deps.store.putItem(space.id, KIND, { ...l, topic: topicId, version: l.version + 1 } as Lead, l.version))) {
      const again = await deps.store.getItem<Lead>(space.id, KIND, l.id);
      return void await ack(again?.topic ?? (recallIn ? (await deps.store.getThread(recallIn))?.leadsRecalled?.find(r => r.id === l.id)?.thread : undefined) ?? '');
    }
  } else if (!(await decide(deps, space, conv!.id, rec!.id, { how: 'topic', by: who.id, at: deps.now() }, topicId)))
    return void await ack((await deps.store.getThread(conv!.id))?.leadsRecalled?.find(r => r.id === rec!.id)?.thread ?? '');
  const origin = await deps.store.getThread(src.from);
  const from = origin?.space === space.id ? origin.id : undefined;
  const topic = await mutateThread(deps, null, { type: 'human.post', trusted: true },
    { id: topicId, space: space.id, title: src.what.replace(/\s+/g, ' ').trim().slice(0, 80), owner: topicAgent(space, origin, conv), kind: 'topic', author: who.id,
      text: topicText(src.what), ...(from ? { from } : {}) },
    undefined, x => ({ ...x, people: [who.id] }));
  const first: Message = { id: deps.newId(), thread: topicId, author: { kind: 'human', id: who.id }, type: 'text', text: src.what, at: deps.now() };
  await deps.store.upsertMessage(first);
  await broadcast(deps, space.id, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(topic) });
  if (from) {
    const o2 = await mutateThread(deps, from, { type: 'noop' }, undefined, undefined, x => ({ ...x, spawned: [...(x.spawned ?? []), topicId] }), false);
    await broadcast(deps, space.id, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(o2) });
  }
  await broadcast(deps, space.id, { v: 2, type: 'event', event: 'message.created', data: first });
  if (l) {
    await forget(deps, space, l.id);
    if (recallIn) await decide(deps, space, recallIn, l.id, { how: 'topic', by: who.id, at: deps.now() }, topicId);
  }
  console.log('lead_topic', JSON.stringify({ space: space.id, lead: src.id, topic: topicId, by: who.id }));
  await reply({ v: 2, type: 'ack', client_id: f.client_id, thread: topicId, msg_id: first.id });
  await deliver(deps, space, topic, leadTopicGo(topic, who.id, first, src.fromTitle, src.from, deps), []);
}

/**
 * « Add it to this thread / topic », under the agent's reply that recalled it: the decision first (once), then the
 * lead leaves the list and `text` is posted in the conversation as the lead's own message, through the same path as a
 * post, so the agent is woken (or gets it at the end of its turn). `text` must carry the step: it is the lead's
 * message about this lead, never any other text.
 */
async function takeHere(deps: Deps, who: Principal, space: Space, f: any, reply: Reply) {
  need(isId(f.thread) && str(f.text, LEAD_TEXT_MAX + 300));
  const conv = await deps.store.getThread(f.thread);
  need(!!conv && conv.space === space.id, 'forbidden');
  const rec = conv!.leadsRecalled?.find(r => r.id === f.id);
  need(!!rec, 'not_found');
  need((f.text as string).includes(rec!.what), 'stale');
  if (!(await decide(deps, space, conv!.id, rec!.id, { how: 'here', by: who.id, at: deps.now() })))
    return void await reply({ v: 2, type: 'ack', client_id: f.client_id, thread: conv!.id, msg_id: '' });
  await forget(deps, space, rec!.id);
  const msg: Message = { id: deps.newId(), thread: conv!.id, author: { kind: 'human', id: who.id }, type: 'text', text: f.text, at: deps.now() };
  const seed = await threadPeople(deps, conv!);
  let before: string[] = [];
  const thread = await mutateThread(deps, conv!.id, { type: 'human.post', trusted: true }, undefined, undefined,
    x => { before = x.people ?? seed; return { ...unarchive(x), people: withPerson(before, who.id) }; });
  await deps.store.upsertMessage(msg);
  console.log('lead_take', JSON.stringify({ space: space.id, lead: rec!.id, thread: conv!.id, by: who.id }));
  await reply({ v: 2, type: 'ack', client_id: f.client_id, thread: thread.id, msg_id: msg.id });
  await afterHumanMessage(deps, space, who, thread, msg, 'message.created', messageTo(before, mentionedIds(msg.text, humansOf(space)), who.id, space.members));
}

/** Leads saved before they carried their thread's tags get them once (one read per closed thread, a conditional write
 *  each; a lost race keeps the other write). */
async function withTags(deps: Deps, space: string, leads: Lead[]): Promise<Lead[]> {
  const from = new Map<string, string[]>();
  const out: Lead[] = [];
  for (const l of leads) {
    if (l.tags) { out.push(l); continue; }
    if (!from.has(l.from)) from.set(l.from, (await deps.store.getThread(l.from))?.tags?.list ?? []);
    const next = { ...l, tags: from.get(l.from)!, version: l.version + 1 };
    out.push(await deps.store.putItem(space, KIND, next, l.version) ? next : { ...l, tags: from.get(l.from)! });
  }
  return out;
}

async function spaceOf(deps: Deps, who: Principal, f: any, lead: boolean): Promise<Space> {
  need(str(f.client_id, 64) && typeof f.space === 'string');
  const space = await deps.store.getSpace(f.space);
  need(!!space && canSee(space, who.id), 'forbidden');
  need(leadsOn(space!), 'module_off');
  need(!lead || space!.trusted.includes(who.id), 'forbidden'); // deciding a lead: a lead, as the summary's button
  return space!;
}

async function human(deps: Deps, who: Principal, f: any, reply: Reply) {
  if (f.type === 'lead.list') {
    const space = await spaceOf(deps, who, f, false);
    const leads = (await withTags(deps, space.id, await list(deps, space.id))).sort((a, b) => b.at - a.at);
    return void await reply({ v: 2, type: 'lead.list', client_id: f.client_id, space: space.id, leads });
  }
  if (f.type === 'lead.delete' || f.type === 'lead.open' || f.type === 'lead.take') {
    const space = await spaceOf(deps, who, f, true);
    need(str(f.id, 200) && (f.thread === undefined || isId(f.thread)));
    if (f.type === 'lead.open') return await openTopic(deps, who, space, f, reply);
    if (f.type === 'lead.take') return await takeHere(deps, who, space, f, reply);
    const l = await deps.store.getItem<Lead>(space.id, KIND, f.id); need(!!l, 'not_found');
    await forget(deps, space, l!.id);
    if (l!.recalled) await decide(deps, space, l!.recalled.thread, l!.id, { how: 'dropped', by: who.id, at: deps.now() });
    return void await reply({ v: 2, type: 'ack', client_id: f.client_id, thread: l!.from, msg_id: '' });
  }
  need(false, 'unknown_type');
}

export const leads: HubModule = { module: 'threads', prefix: 'lead', human };
