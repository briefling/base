// Plans (`propose_plan`): a card of ordered steps a trusted human launches or stops; each step becomes a thread (or an
// issue in a board-driven space), opened one after the other as the previous one finishes (`advancePlan`).
import { MAX_BRIEF, type Plan, PLAN_STEPS_MAX, PLAN_TITLE_MAX, PLAN_STEP_TITLE_MAX, type HubFrame, type Message, type Principal } from '../../protocol/frames.ts';
import { type Deps, type Space, type StoredThread, agentsOf, boardDriven, broadcast, modOn, id, inTurn, kickoff, memberSpace, mutateThread, need, publicThread, reposOf, str, take, turnAuthor, exchangeOf } from './router.ts';
import { cardContext, supersedeOpenCard } from './cards.ts';

/** Steps of a `plan.propose` frame, trimmed: 2 to PLAN_STEPS_MAX, each a one-line title and a brief. Null = malformed. */
function planSteps(x: unknown): { title: string; brief: string }[] | null {
  if (!Array.isArray(x) || x.length < 2 || x.length > PLAN_STEPS_MAX) return null;
  const out: { title: string; brief: string }[] = [];
  for (const s of x) {
    if (!s || typeof s !== 'object' || typeof s.title !== 'string' || typeof s.brief !== 'string') return null;
    const title = s.title.trim(), brief = s.brief.trim();
    if (!title || title.length > PLAN_STEP_TITLE_MAX || /[\u0000-\u001f\u007f]/.test(title) || !brief || brief.length > MAX_BRIEF) return null;
    out.push({ title, brief });
  }
  return out;
}

/**
 * The agent proposes a plan of ordered steps (`propose_plan` tool) in a Lounge topic or a thread. Same gates as the
 * other cards (running turn triggered by a trusted human, one open card per conversation); the driver is the space's:
 * a board-driven space needs `repo`, one of its attached repos (the steps become issues), any other refuses it (the
 * steps become threads). The card does nothing by itself: a trusted human launches it.
 */
export async function proposePlan(deps: Deps, src: StoredThread, as: string, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  const steps = planSteps(f.steps);
  need(str(f.client_id, 64) && typeof f.title === 'string' && f.title.trim().length > 0 && f.title.trim().length <= PLAN_TITLE_MAX && !/[\u0000-\u001f\u007f]/.test(f.title)
    && !!steps && (f.why === undefined || typeof f.why === 'string' && f.why.length <= 500) && cardContext(f.context) !== null && (f.repo === undefined || typeof f.repo === 'string'));
  need(inTurn(src, as), 'no_turn');
  const space = await deps.store.getSpace(src.space); need(!!space, 'forbidden');
  need(modOn(space!, 'threads'), 'module_off'); // « threads » module off: no new thread (each step is one)
  if (boardDriven(space!)) need(typeof f.repo === 'string' && reposOf(space!).includes(f.repo), 'repo_not_attached');
  else need(f.repo === undefined, 'not_board');
  need(!!(await turnAuthor(deps, space!, src)), 'no_turn');
  const msgs = await deps.store.lastMessages(src.id, 100);
  const why = typeof f.why === 'string' && f.why.trim() ? f.why.trim() : undefined;
  const cardId = deps.newId();
  await supersedeOpenCard(deps, space!.id, msgs, as, cardId);
  const card: Message = { id: cardId, thread: src.id, author: { kind: 'system', id: 'briefling' }, type: 'plan', text: 'Launch this plan?',
    plan: { title: f.title.trim(), ...(why ? { why } : {}), ...(cardContext(f.context) && f.repo === undefined ? { context: cardContext(f.context)! } : {}), steps: steps!, by: as, status: 'open', ...(f.repo !== undefined ? { repo: f.repo } : {}) }, at: deps.now(), rev: 0 };
  await deps.store.upsertMessage(card);
  await broadcast(deps, space!.id, { v: 2, type: 'event', event: 'message.created', data: card });
  await reply({ v: 2, type: 'ack', client_id: f.client_id, thread: src.id, msg_id: card.id });
}

/** Rewrites a plan card in a conditional write (`rev`) and broadcasts it; null = another write won. */
async function writePlan(deps: Deps, space: string, card: Message, plan: Plan): Promise<Message | null> {
  const r = await deps.store.upsertMessage({ ...card, plan, rev: (card.rev ?? 0) + 1 });
  if (!r) return null;
  await broadcast(deps, space, { v: 2, type: 'event', event: 'message.updated', data: r.message });
  return r.message;
}

/**
 * "Launch the plan" / "Stop the plan" on a "Launch this plan?" card: trusted humans only (launching makes agents work,
 * on GitHub too). Launch, briefling driver: the card goes running and step 1's thread opens at once, attributed to the
 * human who clicked (the whole plan was on the card). Board driver: pending, then the GitHub Lambda creates the issues
 * (also the retry of a failed one). Stop: no next step opens; the step in progress goes on. Conditional writes on
 * `rev`: a double click or two tabs do it once.
 */
export async function planAction(deps: Deps, who: Principal, f: any) {
  need(id(f.thread) && id(f.msg));
  const cur = await deps.store.getThread(f.thread); need(!!cur, 'forbidden');
  const space = await memberSpace(deps, who, cur!.space);
  need(space.trusted.includes(who.id), 'forbidden');
  const card = await deps.store.getMessage(cur!.id, f.msg);
  const p = card?.type === 'plan' ? card.plan : undefined; need(!!p, 'stale');
  if (f.kind === 'plan_stop') {
    need(p!.status === 'running', 'stale');
    need(!!(await writePlan(deps, space.id, card!, { ...p!, status: 'stopped', stoppedBy: who.id })), 'stale');
    return;
  }
  need(modOn(space, 'threads'), 'module_off'); // « threads » module off: no new thread (a plan card left open from before)
  if (p!.repo) {
    need(p!.status === 'open' || (p!.status === 'failed' && !p!.claimed), 'stale');
    need(boardDriven(space) && reposOf(space).includes(p!.repo), 'repo_not_attached');
    need(!!deps.queueGithub, 'github_off');
    const { error, ...rest } = p!;
    need(!!(await writePlan(deps, space.id, card!, { ...rest, status: 'pending', approver: who.id, claimed: false })), 'stale');
    await deps.queueGithub!({ kind: 'newplan', thread: cur!.id, msg: card!.id, by: who.id });
    return;
  }
  need(p!.status === 'open', 'stale');
  need(!boardDriven(space), 'board_driven'); // the space switched to a board meanwhile: work starts from its issues
  need(agentsOf(space).includes(p!.by), 'stale');
  const threadId = deps.newId();
  const started = await writePlan(deps, space.id, card!, { ...p!, status: 'running', approver: who.id, current: 0, steps: p!.steps.map((s, k) => k === 0 ? { ...s, thread: threadId } : s) });
  need(!!started, 'stale');
  const before = cur!.kind === 'topic' ? (await deps.store.lastMessages(cur!.id, 100)).filter(m => m.id < card!.id) : [];
  await openPlanStep(deps, space, cur!, started!, 0, threadId, who.id, before);
}

/**
 * Opens the thread of step `i` of a running plan (id already written on the card): agent = the plan's, first message =
 * the step's brief signed by the agent, attributed to the approver `by`, linked to the parent like a card's thread.
 * Kicked off now, or queued behind the agent's other threads. A failure marks the card failed (`thread`), never retried.
 */
async function openPlanStep(deps: Deps, space: Space, parent: StoredThread, card: Message, i: number, threadId: string, by: string, before: Message[]) {
  const p = card.plan!, step = p.steps[i];
  let thread: StoredThread, first: Message;
  try {
    thread = await mutateThread(deps, null, { type: 'human.post', trusted: true }, { id: threadId, space: space.id, title: step.title.slice(0, 80), owner: p.by, from: parent.id, opener: by },
      undefined, x => ({ ...x, people: [by], plan: { parent: parent.id, card: card.id, step: i, of: p.steps.length }, ...exchangeOf(parent) }));
    first = { id: deps.newId(), thread: threadId, author: { kind: 'agent', id: p.by }, type: 'text', text: step.brief, at: deps.now() };
    await deps.store.upsertMessage(first);
    const t2 = await mutateThread(deps, parent.id, { type: 'noop' }, undefined, undefined, x => ({ ...x, spawned: [...(x.spawned ?? []), threadId] }));
    await broadcast(deps, space.id, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(thread) });
    await broadcast(deps, space.id, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(t2) });
    await broadcast(deps, space.id, { v: 2, type: 'event', event: 'message.created', data: first });
  } catch (e) {
    console.error('plan_step_failed', card.id, i, (e as Error)?.message?.slice(0, 200));
    const now = await deps.store.getMessage(card.thread, card.id);
    if (now?.plan) await writePlan(deps, space.id, now, { ...now.plan, status: 'failed', error: 'thread' });
    return;
  }
  if (!(await take(deps, space, thread, first.at, by))) return; // the agent is busy: started when its turn comes
  await kickoff(deps, space, thread, by, [first], { card, before, parent });
}

/**
 * A plan step's thread ended (`done` outcome, or a trusted human's Done on its wait): the next step opens, attributed
 * to the human who launched the plan, if the plan still runs on this very step (a later `done` of an older step, a
 * stopped plan or a redelivery do nothing). Gate re-read now: approver still trusted, agent still in the space, space
 * not board-driven; otherwise the card goes failed (`refused`). Last step: the plan is done.
 */
export async function advancePlan(deps: Deps, space: Space, thread: StoredThread) {
  const link = thread.plan;
  if (!link) return;
  const card = await deps.store.getMessage(link.parent, link.card);
  const p = card?.type === 'plan' ? card.plan : undefined;
  if (!p || p.repo || p.status !== 'running' || p.current !== link.step || p.steps[link.step]?.thread !== thread.id) return;
  const i = link.step + 1;
  if (i >= p.steps.length) { await writePlan(deps, space.id, card!, { ...p, status: 'done' }); return; }
  const parent = await deps.store.getThread(link.parent);
  const fresh = await deps.store.getSpace(space.id);
  if (!parent || !fresh || boardDriven(fresh) || !p.approver || !fresh.trusted.includes(p.approver) || !agentsOf(fresh).includes(p.by)) {
    await writePlan(deps, space.id, card!, { ...p, status: 'failed', error: 'refused' });
    return;
  }
  const threadId = deps.newId();
  const next = await writePlan(deps, space.id, card!, { ...p, current: i, steps: p.steps.map((s, k) => k === i ? { ...s, thread: threadId } : s) });
  if (!next) return; // another delivery advanced it
  await openPlanStep(deps, fresh, parent, next, i, threadId, p.approver, []);
}
