// Board flow, hub side (docs/design-flow.md): the agents' `flow.*` frames (task, done, live state, config status, switch
// by link), the flow editor (`flowcfg.*`), Settings › Driver (`flowpilot.*`), the board page's flow block
// (`flowstate.*`), the config pushed to the flow's agents and the `flow.wake`. Moved out of router.ts as is: the router
// keeps the dispatch (admin gate for `flowcfg.*`/`flowpilot.*`, instance frames outside a turn) and the turn-end delivery.
import { visibleAgents } from '../../protocol/memory.ts';
import { AGENT_CODE_BYTES, AGENT_CODE_RE, AGENT_RE, BUNDLE_SHA_RE, FLOW_HISTORY_MAX, FLOW_KEY_MAX, FLOW_OUTCOMES, FLOW_REF_RE, FLOW_STATUS_ERROR_MAX,
  FLOW_SWITCH_TTL_MS, FLOW_TASKS_SHOWN, FLOW_TITLE_MAX, FLOW_TRIGGER_RE, FLOW_WAKE_MS, GIT_SHA_RE, SPACE_ID_RE, type FlowAgentState, type FlowImported,
  type FlowPilot, type FlowTaskRow, type FlowVersion, type FlowVersionMeta, type HubFrame, type Message, type Principal } from '../../protocol/frames.ts';
import { validateFlow, type FlowDef } from '../../protocol/flowcfg.ts';
import { EMPTY_TEAM, bundleFiles, bundleIssues, sameSource, sourceOk, validateTeam, type BundleFile, type BundleTarget, type FlowSource, type FlowTeam } from '../../protocol/flowteam.ts';
import { createHash, randomBytes } from 'node:crypto';
import { parseFlowState } from './flowstate.ts';
import { boardDriven, broadcast, cap, codeHash, id, leave, memberSpace, mutateLock, mutateThread, need, publicThread, reposOf, sendOne, str, unarchive,
  type Deps, type Space, type StoredFlowRecord, type StoredPilot, type StoredThread } from './router.ts';

// ---------------------------------------------------------------- flow (docs/design-flow.md)
// The agent's plugin runs the board rules (unstrikeable's engine, ported) and asks the hub before starting a task: the
// board says what to do, the hub says where (the issue thread) and whether now (one task per agent and space, no turn
// already running there). The hub never holds the agent's GitHub identity.

/** The instance serving `agent` in a board-driven space it belongs to; refused otherwise. */
async function flowSpace(deps: Deps, who: Principal, f: any): Promise<{ space: Space; repo: string; number: number }> {
  need(str(f.client_id, 64) && typeof f.space === 'string' && SPACE_ID_RE.test(f.space) && typeof f.agent === 'string' && AGENT_RE.test(f.agent)
    && typeof f.ref === 'string' && FLOW_REF_RE.test(f.ref) && str(f.key, FLOW_KEY_MAX));
  const inst = await deps.store.getInstance(who.id);
  need(!!inst && inst.spaces.includes(f.space) && inst.agents.includes(f.agent), 'forbidden');
  const space = await deps.store.getSpace(f.space); need(!!space && visibleAgents(space).includes(f.agent), 'forbidden');
  need(boardDriven(space!), 'not_board');
  const [, repo, n] = FLOW_REF_RE.exec(f.ref)!;
  need(reposOf(space!).some(r => r.toLowerCase() === repo.toLowerCase()), 'repo_not_attached');
  return { space: space!, repo: reposOf(space!).find(r => r.toLowerCase() === repo.toLowerCase())!, number: Number(n) };
}

/** System line in a thread (task start / end), broadcast to the space. */
async function systemLine(deps: Deps, thread: StoredThread, text: string) {
  const line: Message = { id: deps.newId(), thread: thread.id, author: { kind: 'system', id: 'briefling' }, type: 'text', at: deps.now(), text };
  const r = await deps.store.upsertMessage(line);
  if (r) await broadcast(deps, thread.space, { v: 2, type: 'event', event: 'message.created', data: r.message });
}

/**
 * `flow.task`: the issue thread (found by the poller's `ISSUE#` index, else created and bound the same way), the hand on
 * it for the agent, the task recorded on the thread and its coming turn marked as the flow's. A retry of the task it
 * already holds (after `queued`, or a lost answer) is granted again without a second card.
 */
export async function flowTask(deps: Deps, who: Principal, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  const { space, repo, number } = await flowSpace(deps, who, f);
  need(typeof f.trigger === 'string' && FLOW_TRIGGER_RE.test(f.trigger) && typeof f.title === 'string' && f.title.length <= FLOW_TITLE_MAX);
  // One pilot per agent: only an agent switched to briefling starts tasks here (flow.done and flow.state stay open).
  need((await deps.store.listFlowPilots(space.id)).some(p => p.agent === f.agent && p.state === 'piloted'), 'not_piloted');
  const agent: string = f.agent, ref = `${repo}#${number}`, title = f.title.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() || ref;
  const key = `${repo}#${number}`;
  const id = (await deps.store.issueThreads(space.id))[key] ?? await deps.store.claimIssueThread(space.id, key, deps.newId());
  const found = await deps.store.getThread(id);
  need(!found || found.space === space.id, 'forbidden');
  const thread = found ?? await mutateThread(deps, null, { type: 'noop' }, { id, space: space.id, title, owner: agent, kind: 'thread' }, undefined,
    x => ({ ...x, issue: { repo, number, url: `https://github.com/${repo}/issues/${number}` } }));
  const result = (status: 'started' | 'queued' | 'busy', t?: string) => reply({ v: 2, type: 'flow.result', client_id: f.client_id, status, ...(t ? { thread: t } : {}) });
  if (thread.facts.turnActive) return void await result('queued'); // a human's turn runs there: the task waits for its end
  let busy = false;
  await mutateLock(deps, space.id, agent, l => {
    busy = false;
    if (l.holders.includes(thread.id)) return null;
    if (l.holders.length) { busy = true; return null; } // one task per agent and space
    return { ...l, holders: [thread.id], since: deps.now(), delivered: {} };
  });
  if (busy) return void await result('busy');
  const again = thread.flow?.key === f.key;
  const next = await mutateThread(deps, thread.id, { type: 'noop' }, undefined, undefined, x => ({ ...unarchive(x), owner: agent,
    flow: { agent, ref, key: f.key, trigger: f.trigger, since: again ? x.flow!.since : deps.now(), turn: deps.now() } }));
  await broadcast(deps, space.id, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(next) });
  if (!again) await systemLine(deps, next, `Task ${f.trigger} · ${cap(agent)} · ${ref}`);
  await result('started', next.id);
}

/** Whole numbers of a record (seconds, counters), bounded. */
const count = (x: unknown) => Number.isSafeInteger(x) && (x as number) >= 0 && (x as number) <= 1e10;

/**
 * `flow.done`: the task is closed on the plugin's side. The hand goes back (its thread only), the task leaves the thread
 * (if it is still this one) and the record is stored. Idempotent: a replay rewrites the same record, posts no new line.
 */
export async function flowDone(deps: Deps, who: Principal, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  const { space, repo, number } = await flowSpace(deps, who, f);
  const r = f.record;
  need(!!r && typeof r === 'object' && FLOW_OUTCOMES.includes(r.outcome) && (r.kind === null || r.kind === undefined || (typeof r.kind === 'string' && /^[a-z0-9_-]{1,40}$/.test(r.kind)))
    && typeof r.trigger === 'string' && FLOW_TRIGGER_RE.test(r.trigger) && count(r.start) && count(r.end) && count(r.retries) && count(r.runs) && count(r.reviews)
    && (r.cost === null || r.cost === undefined || (typeof r.cost === 'number' && Number.isFinite(r.cost) && r.cost >= 0 && r.cost <= 10_000)));
  const agent: string = f.agent, ref = `${repo}#${number}`;
  const id = (await deps.store.issueThreads(space.id))[ref] ?? null;
  const thread = id ? await deps.store.getThread(id) : null;
  const record: StoredFlowRecord = { space: space.id, agent, thread: thread?.id ?? null, ref, key: f.key, at: deps.now(), outcome: r.outcome, kind: r.kind ?? null,
    trigger: r.trigger, start: r.start, end: r.end, retries: r.retries, runs: r.runs, reviews: r.reviews, cost: r.cost ?? null };
  await deps.store.putFlowRecord(record);
  if (thread && thread.space === space.id) {
    const held = thread.flow?.agent === agent && thread.flow.key === f.key;
    if (held) {
      const next = await mutateThread(deps, thread.id, { type: 'noop' }, undefined, undefined, x => { if (x.flow?.key !== f.key) return x; const { flow, ...rest } = x; return rest as StoredThread });
      await broadcast(deps, space.id, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(next) });
      await systemLine(deps, next, `Task ${r.outcome}${r.kind ? ` · ${r.kind}` : ''} · ${cap(agent)}`);
    }
    if (thread.owner === agent) await leave(deps, space, { ...thread, owner: agent }, true);
  }
  await reply({ v: 2, type: 'ack', client_id: f.client_id, thread: thread?.id ?? '', msg_id: '' });
}

/**
 * Flow editor (admin, checked by the caller): the def is the truth, stored whole per version with its author; the YAML
 * is emitted from it by the client (protocol/flowcfg.ts), never parsed. Same validation as the editor's form, so a
 * crafted frame cannot store what the form would refuse (secrets included).
 */
export async function flowConfig(deps: Deps, who: Principal, f: any, reply: (f: HubFrame) => Promise<boolean>, connId: string) {
  const space = await deps.store.getSpace(f.space);
  need(!!space, 'forbidden');
  if (f.type === 'flowcfg.head') {
    need(str(f.client_id, 64) && !!f.source && sourceOk(f.source, reposOf(space!)), 'bad_source');
    need(!!deps.queueGithub, 'github_off');
    const repo = reposOf(space!).find(r => r.toLowerCase() === f.source.repo.toLowerCase())!;
    await deps.queueGithub!({ kind: 'flowgit', space: f.space, by: who.id, conn: connId, client_id: f.client_id, source: { ...f.source, repo } });
    return;
  }
  if (f.type === 'flowcfg.get') {
    need(f.version === undefined || (Number.isSafeInteger(f.version) && f.version > 0));
    const history = await deps.store.listFlowVersions(f.space, FLOW_HISTORY_MAX);
    const version = await deps.store.getFlowVersion(f.space, f.version ?? null);
    need(f.version === undefined || !!version, 'not_found');
    await reply({ v: 2, type: 'flowcfg', client_id: f.client_id, space: f.space, history, version, status: await deps.store.listFlowStatus(f.space),
      target: flowTarget(space!), agents: visibleAgents(space!) });
    // Git source: the branch head is read again (the base of the next save), answered with `flowcfg.git`.
    if (f.version === undefined && version?.source && deps.queueGithub) await deps.queueGithub({ kind: 'flowgit', space: f.space, by: who.id, conn: connId, client_id: f.client_id });
    return;
  }
  need(Number.isSafeInteger(f.base) && f.base >= 0);
  need(validateFlow(f.def).length === 0, 'bad_flow');
  const def = f.def as FlowDef;
  // No team in the frame (older client): the latest version's, so a save of the flow alone never drops the staff.
  const prev = f.team === undefined || f.source === undefined ? await deps.store.getFlowVersion(f.space, null) : null;
  const team: FlowTeam = f.team !== undefined ? f.team : prev?.team ?? EMPTY_TEAM;
  need(validateTeam(team, def, visibleAgents(space!)).length === 0, 'bad_team');
  need(bundleIssues(bundleFiles(def, team, flowTarget(space!))).length === 0, 'bad_flow');
  const source: FlowSource | null = f.source !== undefined ? f.source : prev?.source ?? null;
  need(sourceOk(source, reposOf(space!)), 'bad_source');
  const latest = (await deps.store.listFlowVersions(f.space, 1))[0]?.version ?? 0;
  need(latest === f.base, 'stale');
  if (source?.readonly) {
    // Read-only git source: nothing written to the repo. The version keeps the team and the flow for briefling; the
    // GitHub Lambda reads the head (FLOWGIT) and pushes the repo's own bundle to the agents.
    need(!!deps.queueGithub, 'github_off');
    const repo = reposOf(space!).find(r => r.toLowerCase() === source.repo.toLowerCase())!;
    const json = JSON.stringify({ def, team });
    const meta: FlowVersionMeta = { version: f.base + 1, by: who.id, at: deps.now(), sha: createHash('sha256').update(json).digest('hex') };
    need(await deps.store.putFlowVersion(f.space, { ...meta, ...JSON.parse(json), source: { ...source, repo } }), 'stale');
    await reply({ v: 2, type: 'flowcfg.saved', client_id: f.client_id, space: f.space, version: meta });
    await deps.queueGithub!({ kind: 'flowgit', space: f.space, by: who.id, conn: connId, client_id: f.client_id });
    return;
  }
  if (source) {
    // Git source: the GitHub Lambda commits (only the changed files, refused if one changed since `head`), then stores
    // the version and answers this connection (`flowcfg.saved` or `error`).
    need(typeof f.head === 'string' && GIT_SHA_RE.test(f.head));
    need(!!deps.queueGithub, 'github_off');
    const repo = reposOf(space!).find(r => r.toLowerCase() === source.repo.toLowerCase())!;
    await deps.queueGithub!({ kind: 'flowcommit', space: f.space, by: who.id, conn: connId, client_id: f.client_id, base: f.base, head: f.head, def, team, source: { ...source, repo } });
    return;
  }
  const json = JSON.stringify({ def, team });
  const meta: FlowVersionMeta = { version: f.base + 1, by: who.id, at: deps.now(), sha: createHash('sha256').update(json).digest('hex') };
  need(await deps.store.putFlowVersion(f.space, { ...meta, ...JSON.parse(json) }), 'stale');
  await reply({ v: 2, type: 'flowcfg.saved', client_id: f.client_id, space: f.space, version: meta });
  await pushFlowConfig(deps, space!).catch(e => console.error('flow_push_failed', f.space, (e as Error)?.message?.slice(0, 200)));
}

/** The engine's department for this space: its id, its GitHub Project (needed to poll), its attached repos. */
export const flowTarget = (s: Space): BundleTarget => ({ space: s.id, board: s.github?.project ? { owner: s.github.owner, number: s.github.project } : null, repos: reposOf(s) });
export const bundleSha = (files: BundleFile[]) => createHash('sha256').update(JSON.stringify(files)).digest('hex');

/**
 * Sends the space's latest flow config (docs/design-flow.md § 4.2) to the instances serving one of its staffed agents
 * that are in the space; `onlyConn`: that connection only (an instance connecting). The bundle is built from the
 * stored version and the space's current Project and repos, and checked again (paths, size, credentials) before it
 * leaves: the plugin checks it a third time.
 */
export async function pushFlowConfig(deps: Deps, s: Space, onlyConn?: string) {
  if (s.archived) return;
  const v = await deps.store.getFlowVersion(s.id, null);
  if (!v) return;
  const agents = staffed(s, v);
  if (!agents.size) return;
  // Git source: what the branch head holds (read by the GitHub Lambda), never the editor's copy.
  const git = v.source ? await deps.store.getFlowGit(s.id) : null;
  if (v.source && (!git || git.error || !sameSource(git.source, v.source))) return;
  const files = git ? git.files.map(({ path, text }) => ({ path, text })) : bundleFiles(v.def, v.team, flowTarget(s));
  const bad = bundleIssues(files);
  if (bad.length) { console.error('flow_bundle_refused', s.id, v.version, bad.map(x => `${x.code}:${x.path}`).join(',').slice(0, 200)); return; }
  const frame: HubFrame = { v: 2, type: 'flow.config', space: s.id, version: v.version, sha: bundleSha(files), files, ...(git ? { commit: git.head } : {}) };
  await sendToAgents(deps, s.id, agents, frame, onlyConn);
}

/** Agents of the version's team with a role and still in the space: the flow's agents. */
const staffed = (s: Space, v: FlowVersion) => new Set(v.team.agents.filter(a => a.roles.length && visibleAgents(s).includes(a.name)).map(a => a.name));

/** Sends `frame` to the instances in the space serving one of `agents` (`onlyConn`: that connection only); how many got it. */
async function sendToAgents(deps: Pick<Deps, 'store' | 'sender'>, space: string, agents: Set<string>, frame: HubFrame, onlyConn?: string): Promise<number> {
  let n = 0;
  for (const sub of await deps.store.listSubs(space)) {
    if (sub.kind !== 'instance' || (onlyConn && sub.connId !== onlyConn)) continue;
    const inst = await deps.store.getInstance(sub.principal);
    if (!inst?.agents.some(a => agents.has(a))) continue;
    const ok = await sendOne(deps, sub.connId, frame);
    if (ok) n++; else if (ok === false) await deps.store.deleteSub(space, sub.connId);
  }
  return n;
}

/**
 * `flow.wake` (docs/design-flow.md § 4.4): « read the board now » to the flow's agents, after briefling changed the board
 * or the poll saw it move. At most one per space per FLOW_WAKE_MS (shared slot in the table: several Lambdas send it).
 * Best effort: a failure is logged, never fails the action that triggered it. Returns whether one was sent.
 */
export async function wakeFlow(deps: Deps, s: Space): Promise<boolean> {
  try {
    if (s.archived || !boardDriven(s)) return false;
    const v = await deps.store.getFlowVersion(s.id, null);
    const agents = v ? staffed(s, v) : new Set<string>();
    if (!agents.size || !await deps.store.claimFlowWake(s.id, deps.now(), FLOW_WAKE_MS)) return false;
    return await sendToAgents(deps, s.id, agents, { v: 2, type: 'flow.wake', space: s.id }) > 0;
  } catch (e) {
    console.error('flow_wake_failed', s.id, (e as Error)?.message?.slice(0, 200));
    return false;
  }
}

/** `synced.flow`: the live states of the space's agents (others, e.g. an agent removed since, are not shown). */
export async function flowStatesOf(deps: Deps, s: Space): Promise<{ flow?: FlowAgentState[] }> {
  const states = (await deps.store.listFlowStates(s.id)).filter(x => visibleAgents(s).includes(x.agent));
  return states.length ? { flow: states } : {};
}

/**
 * `flow.state` from an agent's plugin (§ 4.6): its own agent in a space of its instance, cleaned (flowstate.ts); the
 * task's thread kept only if it is a thread of that space. Stored (last one wins) and broadcast to the space's humans.
 */
export async function flowState(deps: Deps, who: Principal, f: any) {
  need(typeof f.space === 'string' && SPACE_ID_RE.test(f.space) && typeof f.agent === 'string' && AGENT_RE.test(f.agent));
  const report = parseFlowState(f.state);
  need(!!report);
  const inst = await deps.store.getInstance(who.id);
  need(!!inst && inst.spaces.includes(f.space) && inst.agents.includes(f.agent), 'forbidden');
  const space = await deps.store.getSpace(f.space);
  need(!!space && visibleAgents(space).includes(f.agent), 'forbidden');
  const cur = report!.current;
  if (cur?.thread && (await deps.store.getThread(cur.thread))?.space !== space!.id) cur.thread = null;
  const state: FlowAgentState = { agent: f.agent, at: deps.now(), ...report! };
  await deps.store.putFlowState(space!.id, state);
  await broadcast(deps, space!.id, { v: 2, type: 'event', event: 'flowstate.updated', data: { space: space!.id, state } });
}

/**
 * Board page, flow block. `flowstate.get` (any member): the agents' live states and the latest closed tasks.
 * `flowstate.pause` (trusted human, board-driven space, an agent of the space): Pause / Resume sent to the instances
 * serving it (`flow.pause`, the human's name as `by`); `unreached` if none is connected (nothing is stored: the plugin
 * owns the pause, its `flow.state` shows the result).
 */
export async function flowStateFrame(deps: Deps, who: Principal, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  need(id(f.space));
  const space = await memberSpace(deps, who, f.space);
  if (f.type === 'flowstate.get') {
    const { flow } = await flowStatesOf(deps, space);
    const tasks: FlowTaskRow[] = (await deps.store.listFlowRecords(space.id, FLOW_TASKS_SHOWN)).map(r => ({ agent: r.agent, thread: r.thread, ref: r.ref,
      outcome: r.outcome, kind: r.kind, trigger: r.trigger, start: r.start, end: r.end, retries: r.retries, runs: r.runs, reviews: r.reviews, cost: r.cost }));
    await reply({ v: 2, type: 'flowstate', client_id: f.client_id, space: space.id, agents: flow ?? [], tasks });
    return;
  }
  need(typeof f.agent === 'string' && AGENT_RE.test(f.agent) && typeof f.paused === 'boolean');
  need(space.trusted.includes(who.id), 'forbidden'); // stops or restarts an agent's board work
  need(boardDriven(space), 'not_board');
  need(visibleAgents(space).includes(f.agent), 'forbidden');
  const by = space.names?.[who.id] ?? 'a member';
  const n = await sendToAgents(deps, space.id, new Set([f.agent]), { v: 2, type: 'flow.pause', space: space.id, agent: f.agent, paused: f.paused, by });
  need(n > 0, 'unreached');
  await reply({ v: 2, type: 'flowstate.paused', client_id: f.client_id, space: space.id, agent: f.agent, paused: f.paused });
}

// -- Switch by link (docs/design-flow.md § 13): one pilot per agent, chosen by the hub.

const publicPilot = ({ hash: _, ...p }: StoredPilot): FlowPilot => p;
async function pilotsOf(deps: Pick<Deps, 'store'>, s: Space): Promise<FlowPilot[]> {
  return (await deps.store.listFlowPilots(s.id)).filter(p => visibleAgents(s).includes(p.agent)).map(publicPilot);
}
/** `flow.pilot` on one instance connection: true or false for each of its agents in the (board-driven) space. */
export async function pushPilots(deps: Deps, s: Space, agents: string[], connId: string) {
  const piloted = new Set((await deps.store.listFlowPilots(s.id)).filter(p => p.state === 'piloted').map(p => p.agent));
  for (const a of agents) if (visibleAgents(s).includes(a))
    await deps.sender.send(connId, { v: 2, type: 'flow.pilot', space: s.id, agent: a, piloted: piloted.has(a) });
}
async function pilotsChanged(deps: Deps, s: Space): Promise<FlowPilot[]> {
  const pilots = await pilotsOf(deps, s);
  await broadcast(deps, s.id, { v: 2, type: 'event', event: 'flowpilot.updated', data: { space: s.id, pilots } });
  return pilots;
}

/**
 * Settings › Driver (global admin, checked by the caller). link: one-time code for an agent with a role in the flow
 * team, returned once (a new link replaces a pending one); back: the agent goes back to unstrikeable, or a pending link
 * is cancelled (its instances get `flow.pilot false`, the plugin hands unstrikeable's state file back).
 */
export async function flowPilotFrame(deps: Deps, who: Principal, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  const space = await deps.store.getSpace(f.space);
  need(!!space && !space.archived, 'forbidden');
  if (f.type === 'flowpilot.get') return void await reply({ v: 2, type: 'flowpilot.list', client_id: f.client_id, space: space!.id, pilots: await pilotsOf(deps, space!) });
  need(typeof f.agent === 'string' && AGENT_RE.test(f.agent) && visibleAgents(space!).includes(f.agent), 'forbidden');
  const cur = (await deps.store.listFlowPilots(space!.id)).find(p => p.agent === f.agent);
  if (f.type === 'flowpilot.link') {
    need(boardDriven(space!), 'not_board');
    const v = await deps.store.getFlowVersion(space!.id, null);
    need(!!v && staffed(space!, v).has(f.agent), 'not_flow_agent');
    need(cur?.state !== 'piloted', 'already_piloted');
    const code = randomBytes(AGENT_CODE_BYTES).toString('base64url'), now = deps.now();
    need(await deps.store.putFlowPilot(space!.id, { agent: f.agent, state: 'pending', by: who.id, at: now, expiresAt: now + FLOW_SWITCH_TTL_MS, hash: codeHash(code) }), 'already_piloted');
    const pilots = await pilotsChanged(deps, space!);
    await reply({ v: 2, type: 'flowpilot.linked', client_id: f.client_id, space: space!.id, agent: f.agent, code, pilots });
    return;
  }
  need(!!cur, 'not_piloted');
  await deps.store.deleteFlowPilot(space!.id, f.agent);
  if (cur!.state === 'piloted') await sendToAgents(deps, space!.id, new Set([f.agent]), { v: 2, type: 'flow.pilot', space: space!.id, agent: f.agent, piloted: false });
  await reply({ v: 2, type: 'flowpilot.list', client_id: f.client_id, space: space!.id, pilots: await pilotsChanged(deps, space!) });
}

const importedOk = (x: any): x is FlowImported => !!x && typeof x === 'object' && count(x.seen) && count(x.refs)
  && typeof x.spent === 'number' && Number.isFinite(x.spent) && x.spent >= 0 && x.spent <= 1e6;

/**
 * `flow.switch`: the agent's plugin redeems the code after importing unstrikeable's state (and pausing it). The code is
 * the gate (single use, bound to space + agent, 24 h); the instance must serve that agent there. A replay of the code
 * that switched it is answered again (lost answer), nothing else is.
 */
export async function flowSwitch(deps: Deps, who: Principal, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  need(str(f.client_id, 64) && typeof f.space === 'string' && SPACE_ID_RE.test(f.space) && typeof f.agent === 'string' && AGENT_RE.test(f.agent)
    && typeof f.code === 'string' && AGENT_CODE_RE.test(f.code) && importedOk(f.imported));
  const inst = await deps.store.getInstance(who.id);
  need(!!inst && inst.spaces.includes(f.space) && inst.agents.includes(f.agent), 'forbidden');
  const space = await deps.store.getSpace(f.space);
  need(!!space && !space.archived && visibleAgents(space).includes(f.agent), 'forbidden');
  need(boardDriven(space!), 'not_board');
  const hash = codeHash(f.code), now = deps.now();
  const cur = (await deps.store.listFlowPilots(space!.id)).find(p => p.agent === f.agent);
  const replay = cur?.state === 'piloted' && cur.hash === hash;
  if (!replay) {
    need(cur?.state === 'pending', 'bad_code');
    const imported: FlowImported = { seen: f.imported.seen, refs: f.imported.refs, spent: Math.round(f.imported.spent * 1e4) / 1e4 };
    need(await deps.store.claimFlowPilot(space!.id, f.agent, hash, now, { agent: f.agent, state: 'piloted', by: cur!.by, at: cur!.at, since: now, imported, hash }), 'bad_code');
  }
  await reply({ v: 2, type: 'flow.switched', client_id: f.client_id, space: space!.id, agent: f.agent });
  if (!replay) await pilotsChanged(deps, space!);
}

/** The plugin's answer to a pushed config, for one of its agents of the space: kept for the editor (last one wins). */
export async function flowConfigStatus(deps: Deps, who: Principal, f: any) {
  need(typeof f.space === 'string' && SPACE_ID_RE.test(f.space) && typeof f.agent === 'string' && AGENT_RE.test(f.agent)
    && Number.isSafeInteger(f.version) && f.version > 0 && typeof f.sha === 'string' && BUNDLE_SHA_RE.test(f.sha) && typeof f.ok === 'boolean'
    && (f.error === undefined || typeof f.error === 'string') && (f.commit === undefined || (typeof f.commit === 'string' && GIT_SHA_RE.test(f.commit))));
  const inst = await deps.store.getInstance(who.id);
  need(!!inst && inst.spaces.includes(f.space) && inst.agents.includes(f.agent), 'forbidden');
  const space = await deps.store.getSpace(f.space);
  need(!!space && visibleAgents(space).includes(f.agent), 'forbidden');
  const error = f.ok ? undefined : (String(f.error ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, FLOW_STATUS_ERROR_MAX) || 'error');
  await deps.store.putFlowStatus(f.space, { agent: f.agent, version: f.version, sha: f.sha, ok: f.ok, ...(error ? { error } : {}), ...(f.commit ? { commit: f.commit } : {}), at: deps.now() });
}
