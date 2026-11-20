// Routines of a space (Settings › Routines): CRUD for the admins (global, or of this space), and the run itself (EventBridge Scheduler, or
// « Run now »). Rules in protocol/routines.ts; Product decisions in docs/project-status.md (« Routines »).
import { visibleAgents } from '../../protocol/memory.ts';
import { AGENT_TOPICS_PER_DAY, topicText, type HubFrame, type Message, type Principal } from '../../protocol/frames.ts';
import { ROUTINES_MAX, ROUTINE_RUNNING_MS, routineCron, routineIn, routinePrompt, scheduleName, type Routine, type RoutineResult } from '../../protocol/routines.ts';
import { broadcast, deliver, mutateThread, need, publicThread, reachable, type Deps, type Space, type StoredThread } from './router.ts';
import { withoutMuted } from './mute.ts';

/** What a schedule hands the Routine Lambda (EventBridge Scheduler input): ids only, everything else is re-read. */
export interface RoutineFire { space: string; routine?: string; radar?: true } // radar: the space's Radar schedule (hub/src/radar.ts)

/** Admin frames (`routine.*`); the caller checked the admin (global, or of this space). */
export async function routineFrame(deps: Deps, who: Principal, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  need(typeof f.client_id === 'string' && f.client_id.length > 0 && f.client_id.length <= 64 && typeof f.space === 'string');
  const space = await deps.store.getSpace(f.space);
  need(!!space, 'forbidden');
  const list = async () => void await reply({ v: 2, type: 'routine.list', client_id: f.client_id, space: space!.id, routines: sorted(await deps.store.listRoutines(space!.id)) });
  if (f.type === 'routine.list') return await list();
  need(!space!.archived, 'forbidden');
  // The runs are this admin's turns: the agent only acts for a lead of the space (as for any delivery).
  need(space!.trusted.includes(who.id), 'not_trusted');
  const all = await deps.store.listRoutines(space!.id);
  if (f.type === 'routine.save') {
    const d = routineIn(f); need(!!d);
    need(visibleAgents(space!).includes(d!.agent), 'forbidden');
    const cur = f.id === undefined ? null : all.find(r => r.id === f.id);
    if (f.id !== undefined) { need(!!cur, 'not_found'); need(f.version === cur!.version, 'stale'); }
    else need(all.length < ROUTINES_MAX, 'too_many');
    const next: Routine = { ...(cur?.lastRun ? { lastRun: cur.lastRun } : {}), ...d!, id: cur?.id ?? deps.newId(), by: who.id, at: deps.now(), version: (cur?.version ?? 0) + 1 };
    need(await deps.store.putRoutine(space!.id, next, cur ? cur.version : null), 'stale');
    await syncSchedule(deps, space!.id, next);
    return await list();
  }
  const cur = all.find(r => r.id === f.id); need(!!cur, 'not_found');
  if (f.type === 'routine.delete') {
    need(f.version === cur!.version, 'stale');
    await deps.schedules?.remove(scheduleName(space!.id, cur!.id)); // first: a schedule left behind would fire for nothing
    await deps.store.deleteRoutine(space!.id, cur!.id);
    return await list();
  }
  need(f.type === 'routine.run');
  await runRoutine(deps, space!.id, cur!.id, who.id);
  return await list();
}

const sorted = (rs: Routine[]) => [...rs].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

async function syncSchedule(deps: Deps, space: string, r: Routine) {
  if (!deps.schedules) return; // tests and local runs: no scheduler
  try { await deps.schedules.put(scheduleName(space, r.id), routineCron(r), r.active, JSON.stringify({ space, routine: r.id } satisfies RoutineFire)); }
  catch (e) { console.error('routine_schedule_failed', JSON.stringify({ space, routine: r.id, err: (e as Error)?.name })); need(false, 'schedule_failed'); }
}

/** A run whose turn has not ended yet (or not started), younger than ROUTINE_RUNNING_MS. */
async function stillRunning(deps: Deps, r: Routine): Promise<boolean> {
  const last = r.lastRun;
  if (last?.result !== 'started' || !last.thread || deps.now() - last.at >= ROUTINE_RUNNING_MS) return false;
  const t = await deps.store.getThread(last.thread);
  const turn = t?.turns?.[r.agent];
  return !!t && !t.archived && !(turn && turn.at > 0 && !turn.active);
}

/**
 * One run: opens a Lounge topic signed by the agent and delivers the routine's instruction to it as a turn of `by`
 * (the admin who clicks; scheduled: the admin who saved it last). Gates, re-read at each run: the space is not archived,
 * `by` is still a lead there, the agent still serves it and one of its instances is connected, the previous run is
 * over, and the agent's daily topic cap (shared with `topic.open`) holds. The result is written in `lastRun` under the
 * routine's version: of two concurrent fires, only one opens a topic.
 */
export async function runRoutine(deps: Deps, spaceId: string, id: string, manualBy?: string): Promise<RoutineResult | 'gone'> {
  const space = await deps.store.getSpace(spaceId);
  const r = space ? (await deps.store.listRoutines(spaceId)).find(x => x.id === id) : undefined;
  if (!space || !r) return 'gone';
  const by = manualBy ?? r.by;
  const result: RoutineResult = !manualBy && !r.active ? 'inactive' : space.archived ? 'archived' : !space.trusted.includes(by) ? 'untrusted'
    : !visibleAgents(space).includes(r.agent) ? 'agent' : await stillRunning(deps, r) ? 'running'
    : !(await reachable(deps, space.id, r.agent)) ? 'unreached' : 'started';
  const topicId = result === 'started' ? deps.newId() : undefined;
  const next: Routine = { ...r, version: r.version + 1, lastRun: { at: deps.now(), result, by, ...(topicId ? { thread: topicId } : {}) } };
  // Running: the run in progress keeps its lastRun (the next check still sees it).
  if (result === 'running') { log(space.id, r, by, result); return result; }
  if (!(await deps.store.putRoutine(space.id, next, r.version))) { log(space.id, r, by, 'running'); return 'running'; } // another fire won
  if (result !== 'started') { log(space.id, r, by, result); return result; }
  const day = new Date(deps.now()).toISOString().slice(0, 10);
  if (!(await deps.store.countAgentTopic(space.id, r.agent, day, AGENT_TOPICS_PER_DAY))) {
    await deps.store.putRoutine(space.id, { ...next, version: next.version + 1, lastRun: { at: next.lastRun!.at, result: 'limit', by } }, next.version);
    log(space.id, r, by, 'limit'); return 'limit';
  }
  await openRun(deps, space, r, by, topicId!);
  log(space.id, r, by, 'started', topicId);
  return 'started';
}

const log = (space: string, r: Routine, by: string, result: string, thread?: string) =>
  console.log('routine_run', JSON.stringify({ space, routine: r.id, agent: r.agent, by, result, ...(thread ? { thread } : {}) }));

async function openRun(deps: Deps, space: Space, r: Routine, by: string, topicId: string) {
  const text = `**${r.name}**\n\n${r.instruction.split('\n').map(l => `> ${l}`).join('\n')}`;
  const topic: StoredThread = await mutateThread(deps, null, { type: 'noop' },
    { id: topicId, space: space.id, title: r.name.slice(0, 80), owner: r.agent, kind: 'topic', author: r.agent, authorAgent: true, text: topicText(r.name) },
    undefined, t => ({ ...t, routine: { id: r.id, by, ...(r.radar ? { radar: true as const } : {}) }, turns: { [r.agent]: { at: 0, active: false } } }));
  const first: Message = { id: deps.newId(), thread: topic.id, author: { kind: 'agent', id: r.agent }, type: 'text', text, at: deps.now() };
  await deps.store.upsertMessage(first);
  const notify = await withoutMuted(deps, space, [...new Set(space.members)], text); // muted: only if mentioned
  await broadcast(deps, space.id, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(topic) });
  await broadcast(deps, space.id, { v: 2, type: 'event', event: 'message.created', data: first, ...(notify.length ? { notify } : {}) });
  if (notify.length && deps.queuePush)
    await deps.queuePush({ thread: topic.id, version: topic.version, to: notify, by: r.agent, byAgent: true, msg: first.id }).catch(e => console.error('push_queue_failed', (e as Error)?.name));
  // The turn: the instruction as a message of `by`, never stored (the topic shows it quoted by the agent).
  const ask: Message = { id: deps.newId(), thread: topic.id, author: { kind: 'human', id: by }, type: 'text', text: routinePrompt(r.name, r.instruction, r.radar === true), at: deps.now() };
  await deliver(deps, space, topic, ask, []);
}
