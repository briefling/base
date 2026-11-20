// Applets of a space (protocol/applets.ts, docs/design-applets.md). An agent proposes one as a card (`applet.propose`,
// tool applet_propose), a lead saves it (`applet.accept`), deletes it or sets who launches it (`applet.set`) in the
// Applets menu; a lead or, unless it is for leads only, a contributor launches it (`applet.run`): a new thread owned by the applet's agent, whose first message carries the form values; its delivery
// is wrapped in appletPrompt (deliver), and `turn_outcome done` archives the thread (outcome). With the « threads » module
// off, the run opens a Lounge topic instead (same first message, same agent, Lounge rules, never closed on its own). Stored as `SPACE#<s>` /
// `APPLET#<id>`, conditional writes on `version`. Each launch also leaves a run (`APRUN#<thread>`): the history, the
// result, « Relaunch » and « Discuss the result » of the Applets menu (docs/design-applets.md « Results »).
import { visibleAgents } from '../../protocol/memory.ts';
import type { FileRef, HubFrame, Message, Principal } from '../../protocol/frames.ts';
import { MAX_FILES, topicText } from '../../protocol/frames.ts';
import { APPLETS_MAX, APPLET_RUNS_MAX, APPLET_RUNS_SHOWN, acceptOk, appletIn, canLaunch, runState, runText, talkId, talkPrompt, valuesIn,
  type Applet, type AppletCard, type AppletRun, type AppletRunInfo, type AppletValue } from '../../protocol/applets.ts';
import { dropPin } from './pinapp.ts';
import { afterHumanMessage, attach, broadcast, canSee, inTurn, modOn, mutateThread, need, publicThread, turnAuthor, workingIn, type Deps, type Space, type StoredThread } from './router.ts';

const RUN = 'APRUN';
/** Messages of a run's conversation read for its state, files and final text (the newest ones). */
const RUN_READ = 50;

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const okId = (x: unknown): x is string => typeof x === 'string' && ID.test(x);
const cid = (x: unknown) => typeof x === 'string' && x.length > 0 && x.length <= 64;
/** A person's role for applets in a space: lead, contributor, or none (a member never launches nor sees them). */
export const appletRole = (space: { trusted: string[]; contributors?: string[] }, who: string) =>
  space.trusted.includes(who) ? 'lead' as const : (space.contributors ?? []).includes(who) ? 'contributor' as const : null;
const sorted = (xs: Applet[]) => [...xs].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

/** Human frames: leads (everything), contributors (list and launch what they may), nobody else. */
export async function appletHuman(deps: Deps, who: Principal, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  need(cid(f.client_id));
  if (f.type === 'applet.accept') return await accept(deps, who, f, reply);
  need(typeof f.space === 'string');
  const space = await deps.store.getSpace(f.space);
  need(!!space && canSee(space, who.id), 'forbidden');
  const role = appletRole(space!, who.id);
  need(!!role, 'not_trusted');
  const list = async () => void await reply({ v: 2, type: 'applet.list', client_id: f.client_id, space: space!.id,
    applets: sorted((await deps.store.listApplets(space!.id)).filter(a => canLaunch(a, role))) });
  if (f.type === 'applet.list') return await list();
  if (f.type === 'applet.result' || f.type === 'applet.talk') return await runFrame(deps, who, space!, role!, f, reply);
  need(okId(f.id) && (f.type === 'applet.runs' || Number.isSafeInteger(f.version)));
  const cur = (await deps.store.listApplets(space!.id)).find(x => x.id === f.id);
  need(!!cur && canLaunch(cur, role), 'not_found');
  if (f.type === 'applet.runs') return await runsOf(deps, space!, cur!, f, reply);
  if (f.type !== 'applet.run') need(role === 'lead', 'not_trusted');
  need(cur!.version === f.version, 'stale');
  if (f.type === 'applet.delete') {
    await deps.store.deleteApplet(space!.id, cur!.id);
    // its runs' index goes with it (their conversations stay)
    for (const x of await deps.store.listItems<AppletRun>(space!.id, RUN)) if (x.applet === cur!.id) await deps.store.deleteItem(space!.id, RUN, x.id);
    await dropPin(deps, space!.id, cur!.id); // its home-screen app's public files (pinapp.ts)
    console.log('applet_delete', JSON.stringify({ space: space!.id, applet: cur!.id, by: who.id }));
    return await list();
  }
  if (f.type === 'applet.set') {
    need(typeof f.leadsOnly === 'boolean');
    const { leadsOnly: _, ...rest } = cur!;
    const next: Applet = { ...rest, ...(f.leadsOnly ? { leadsOnly: true as const } : {}), by: who.id, at: deps.now(), version: cur!.version + 1 };
    need(await deps.store.putApplet(space!.id, next, cur!.version), 'stale');
    console.log('applet_set', JSON.stringify({ space: space!.id, applet: cur!.id, leadsOnly: f.leadsOnly, by: who.id }));
    return await list();
  }
  need(f.type === 'applet.run');
  // « threads » module off: the run opens a Lounge topic instead of a thread (a space without threads keeps its applets).
  const topic = !modOn(space!, 'threads');
  need(visibleAgents(space!).includes(cur!.agent), 'agent');
  const files = f.files ?? {};
  const v = valuesIn(cur!, f.values, files, okId);
  need(!('bad' in v), 'bad_value');
  const { values, files: fileIds } = v as Exclude<typeof v, { bad: string }>;
  need(Object.keys(fileIds).length <= MAX_FILES);
  // The thread and its first message: the launcher's, values as Markdown (shown), files attached as for `post`.
  const msgId = deps.newId(), threadId = deps.newId();
  const ids = cur!.fields.filter(x => fileIds[x.id]).map(x => fileIds[x.id]);
  need(new Set(ids).size === ids.length);
  // a file field asking for a type (accept): checked on the uploaded name before the files are claimed by the message
  const typed = cur!.fields.filter(x => x.accept && fileIds[x.id]);
  if (typed.length) {
    const found = await deps.store.getAttachments(typed.map(x => fileIds[x.id]));
    need(typed.every(x => acceptOk(x.accept, found.find(a => a.id === fileIds[x.id])?.name ?? '')), 'bad_value');
  }
  const refs = await attach(deps, who.id, space!.id, msgId, ids);
  const names = Object.fromEntries(cur!.fields.filter(x => fileIds[x.id]).map(x => [x.id, refs.find(r => r.id === fileIds[x.id])!.name]));
  const msg: Message = { id: msgId, thread: threadId, author: { kind: 'human', id: who.id }, type: 'text', text: runText(cur!, values, names), at: deps.now(),
    ...(refs.length ? { files: refs } : {}) };
  const thread = await mutateThread(deps, null, { type: 'human.post', trusted: true }, { id: threadId, space: space!.id, title: cur!.name.slice(0, 80), owner: cur!.agent,
      ...(topic ? { kind: 'topic' as const, author: who.id, text: topicText(msg.text) } : {}) },
    undefined, x => ({ ...x, people: [who.id], applet: { id: cur!.id, name: cur!.name, by: who.id, msg: msgId, instruction: cur!.instruction },
      // a contributor is invited into their run: wakes() lets their plain-text follow-ups reach the agent there
      ...(role === 'contributor' ? { invited: [who.id] } : {}) }));
  await deps.store.upsertMessage(msg);
  await saveRun(deps, space!.id, cur!, thread.id, who.id, values, names);
  console.log('applet_run', JSON.stringify({ space: space!.id, applet: cur!.id, agent: cur!.agent, by: who.id, thread: thread.id, topic, files: refs.length }));
  await reply({ v: 2, type: 'ack', client_id: f.client_id, thread: thread.id, msg_id: msg.id });
  await afterHumanMessage(deps, space!, who, thread, msg, 'message.created', []);
}

/** A lead saves the draft of an applet card: a new applet, or the update the card names (its version must still match). */
async function accept(deps: Deps, who: Principal, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  need(okId(f.thread) && okId(f.msg));
  const thread = await deps.store.getThread(f.thread); need(!!thread, 'forbidden');
  const space = await deps.store.getSpace(thread!.space);
  need(!!space && canSee(space, who.id), 'forbidden');
  need(space!.trusted.includes(who.id), 'not_trusted');
  const card = await deps.store.getMessage(thread!.id, f.msg);
  need(!!card && card.type === 'applet' && !!card.applet, 'not_found');
  const c = card!.applet!;
  need(!c.saved, 'closed');
  const all = await deps.store.listApplets(space!.id);
  const cur = c.id ? all.find(x => x.id === c.id) : undefined;
  if (c.id) { need(!!cur, 'not_found'); need(cur!.version === c.version, 'stale'); }
  else need(all.length < APPLETS_MAX, 'too_many');
  need(f.contributors === undefined || typeof f.contributors === 'boolean');
  // Who launches: chosen for a new applet (default: leads and contributors); an update keeps it (changed in the menu).
  const leadsOnly = cur ? cur.leadsOnly : f.contributors === false ? true as const : undefined;
  const next: Applet = { ...c.draft, id: cur?.id ?? deps.newId(), by: who.id, at: deps.now(), version: (cur?.version ?? 0) + 1, ...(leadsOnly ? { leadsOnly } : {}) };
  // The card is claimed first (its rev): of two leads saving it at once, one only writes the applet.
  const rev = (card!.rev ?? 0) + 1;
  const r = await deps.store.upsertMessage({ ...card!, applet: { ...c, saved: { id: next.id, by: who.id, at: deps.now() } }, rev });
  need(!!r, 'closed');
  if (!(await deps.store.putApplet(space!.id, next, cur ? cur.version : null))) {
    await deps.store.upsertMessage({ ...card!, applet: c, rev: rev + 1 }); // the card is open again
    need(false, 'stale');
  }
  await broadcast(deps, space!.id, { v: 2, type: 'event', event: 'message.updated', data: r!.message });
  console.log('applet_save', JSON.stringify({ space: space!.id, applet: next.id, version: next.version, by: who.id, created: !cur }));
  await reply({ v: 2, type: 'applet.list', client_id: f.client_id, space: space!.id, applets: sorted([...all.filter(x => x.id !== next.id), next]) });
}

/**
 * Agent: `applet.propose` posts an applet card in the conversation (thread or topic). Gates: running turn of this agent,
 * started by a lead (turnAuthor: never a member, a contributor, a board task), the applet's agent serves the space, an
 * update names an applet of the space. The draft is never stored as an applet: a lead saves it.
 */
/** Agent frame `applet.list`, during a turn: the space's applets as saved (to propose an update with the right id). */
export async function appletList(deps: Deps, cur: any, as: string, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  need(cid(f.client_id));
  need(inTurn(cur, as), 'no_turn');
  const space = await deps.store.getSpace(cur.space); need(!!space, 'forbidden');
  await reply({ v: 2, type: 'applet.list', client_id: f.client_id, space: space!.id, applets: sorted(await deps.store.listApplets(space!.id)) });
}

export async function appletPropose(deps: Deps, cur: any, as: string, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  const draft = appletIn(f.draft);
  need(cid(f.client_id) && !!draft && (f.id === undefined || okId(f.id)) && (f.why === undefined || (typeof f.why === 'string' && f.why.length <= 500)));
  need(inTurn(cur, as), 'no_turn');
  const space = await deps.store.getSpace(cur.space); need(!!space, 'forbidden');
  const by = await turnAuthor(deps, space!, cur);
  need(!!by && space!.trusted.includes(by), 'no_turn');
  need(visibleAgents(space!).includes(draft!.agent), 'agent');
  const all = await deps.store.listApplets(space!.id);
  const base = f.id ? all.find(x => x.id === f.id) : undefined;
  if (f.id) need(!!base, 'not_found'); else need(all.length < APPLETS_MAX, 'too_many');
  const why = typeof f.why === 'string' && f.why.trim() ? f.why.trim() : undefined;
  const applet: AppletCard = { draft: draft!, by: as, ...(base ? { id: base.id, version: base.version } : {}), ...(why ? { why } : {}) };
  const msg: Message = { id: deps.newId(), thread: cur.id, author: { kind: 'agent', id: as }, type: 'applet', text: `Applet: ${draft!.name}`, applet, at: deps.now() };
  await deps.store.upsertMessage(msg);
  await broadcast(deps, space!.id, { v: 2, type: 'event', event: 'message.created', data: msg });
  await reply({ v: 2, type: 'ack', client_id: f.client_id, thread: cur.id, msg_id: msg.id });
}


// ---------------------------------------------------------------- Results (docs/design-applets.md « Results »)

/** Records the run of a launch (best effort: the run already happened) and drops the oldest beyond APPLET_RUNS_MAX. */
async function saveRun(deps: Deps, space: string, a: Applet, thread: string, by: string, values: Record<string, AppletValue>, names: Record<string, string>) {
  try {
    const run: AppletRun = { id: thread, applet: a.id, by, at: deps.now(), values, ...(Object.keys(names).length ? { fileNames: names } : {}), version: 1 };
    await deps.store.putItem(space, RUN, run, null);
    const mine = (await deps.store.listItems<AppletRun>(space, RUN)).filter(x => x.applet === a.id).sort((x, y) => y.at - x.at);
    for (const old of mine.slice(APPLET_RUNS_MAX)) await deps.store.deleteItem(space, RUN, old.id);
  } catch (e) { console.error('applet_run_save_failed', JSON.stringify({ space, thread, err: (e as Error)?.name })) }
}

/** The run's conversation, if the reader may see it: in this space, not a hidden one. Null otherwise. */
async function runThread(deps: Deps, space: Space, run: AppletRun): Promise<StoredThread | null> {
  const t = await deps.store.getThread(run.id);
  return t && t.space === space.id && !t.memoryReview && t.applet?.id === run.applet ? t : null;
}

/** What the applet's agent delivered in the run: its messages (not erased), their files, its last text. */
function delivered(t: StoredThread, msgs: Message[]) {
  const first = t.applet ? msgs.findIndex(m => m.id === t.applet!.msg) : -1;
  const answers = msgs.slice(first + 1).filter(m => m.author.kind === 'agent' && m.author.id === t.owner && !m.deleted);
  const seen = new Set<string>(), files: FileRef[] = [];
  for (const m of answers) for (const x of m.files ?? []) if (!seen.has(x.id)) { seen.add(x.id); files.push({ id: x.id, name: x.name, mime: x.mime, size: x.size }) }
  const text = answers.filter(m => m.type === 'text' && m.text.trim()).at(-1)?.text ?? '';
  return { answered: answers.length > 0, files, text };
}

function infoOf(run: AppletRun, t: StoredThread, d: ReturnType<typeof delivered>): AppletRunInfo {
  const outcome = t.kind === 'topic' ? undefined : t.facts.outcome ?? undefined;
  const active = t.facts.turnActive || workingIn(t).includes(t.owner);
  const state = runState({ active, outcome: outcome?.kind, answered: d.answered, files: d.files.length });
  return { id: run.id, applet: run.applet, by: run.by, at: run.at, state, files: d.files,
    ...(state === 'failed' && outcome?.kind === 'waiting' && outcome.action ? { action: outcome.action } : {}), ...(t.kind === 'topic' ? { topic: true as const } : {}) };
}

/** `applet.runs`: the applet's runs the reader may see, newest first, state and files read live. */
async function runsOf(deps: Deps, space: Space, a: Applet, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  const mine = (await deps.store.listItems<AppletRun>(space.id, RUN)).filter(x => x.applet === a.id).sort((x, y) => y.at - x.at).slice(0, APPLET_RUNS_SHOWN);
  const runs: AppletRunInfo[] = [];
  for (const run of mine) {
    const t = await runThread(deps, space, run);
    if (t) runs.push(infoOf(run, t, delivered(t, await deps.store.lastMessages(t.id, RUN_READ))));
  }
  await reply({ v: 2, type: 'applet.runs', client_id: f.client_id, space: space.id, applet: a.id, runs });
}

/** A run the reader may read: its applet still there and open to their role, its conversation visible to them. */
async function readable(deps: Deps, space: Space, role: 'lead' | 'contributor', id: unknown) {
  need(okId(id));
  const run = await deps.store.getItem<AppletRun>(space.id, RUN, id as string);
  need(!!run, 'not_found');
  const a = (await deps.store.listApplets(space.id)).find(x => x.id === run!.applet);
  need(!!a && canLaunch(a, role), 'not_found');
  const t = await runThread(deps, space, run!);
  need(!!t, 'not_found');
  return { run: run!, a: a!, t: t! };
}

/** `applet.result` (the run, its values, the agent's final text) and `applet.talk` (its discussion topic). */
async function runFrame(deps: Deps, who: Principal, space: Space, role: 'lead' | 'contributor', f: any, reply: (f: HubFrame) => Promise<boolean>) {
  const { run, a, t } = await readable(deps, space, role, f.run);
  if (f.type === 'applet.result') {
    const d = delivered(t, await deps.store.lastMessages(t.id, RUN_READ));
    return void await reply({ v: 2, type: 'applet.result', client_id: f.client_id, space: space.id,
      result: { run: infoOf(run, t, d), values: run.values, ...(run.fileNames ? { fileNames: run.fileNames } : {}), text: d.text } });
  }
  // « Discuss the result »: a Lounge topic (never a thread), one per run (talkId): a second click reopens it.
  const id = talkId(run.id);
  const ack = () => reply({ v: 2, type: 'ack', client_id: f.client_id, thread: id, msg_id: `${id}-0` });
  if (await deps.store.getThread(id)) return void await ack();
  need(visibleAgents(space).includes(a.agent), 'agent');
  // Its first line, by briefling: the run's values as shown in the run (the agent gets them with the result, talkFor).
  const first = t.applet ? await deps.store.getMessage(t.id, t.applet.msg) : null;
  const msg: Message = { id: `${id}-0`, thread: id, author: { kind: 'system', id: 'briefling' }, type: 'text',
    text: first?.text ?? runText(a, run.values, run.fileNames ?? {}), at: deps.now() };
  let topic: StoredThread;
  try {
    topic = await mutateThread(deps, null, { type: 'noop' }, { id, space: space.id, title: `${t.title.slice(0, 66)} · discussion`, owner: a.agent, kind: 'topic', author: who.id, text: topicText(msg.text) },
      undefined, x => ({ ...x, people: [who.id], appletTalk: { applet: a.id, run: run.id } }));
  } catch (e) {
    if (await deps.store.getThread(id)) return void await ack(); // two clicks at once: the other one created it
    throw e;
  }
  await deps.store.upsertMessage(msg);
  console.log('applet_talk', JSON.stringify({ space: space.id, applet: a.id, run: run.id, by: who.id, topic: id }));
  await ack();
  await broadcast(deps, space.id, { v: 2, type: 'event', event: 'message.created', data: msg });
  await broadcast(deps, space.id, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(topic) });
}

/** A discussion topic: messages without a mention go to the applet's agent (its owner), while it serves the space. */
export const talksTo = (space: Space, t: StoredThread) => !!t.appletTalk && visibleAgents(space).includes(t.owner);

/**
 * First turn of the applet's agent in a discussion topic: the message wrapped with the run's values and result
 * (talkPrompt) and the files it delivered there. Null otherwise (another agent, or it already answered here).
 */
export async function talkFor(deps: Deps, space: Space, topic: StoredThread, msg: Message, agent: string): Promise<{ text: string; files: (FileRef & { by: string })[] } | null> {
  if (!topic.appletTalk || agent !== topic.owner) return null;
  if ((await deps.store.lastMessages(topic.id, 30)).some(m => m.author.kind === 'agent' && m.author.id === agent)) return null;
  const run = await deps.store.getItem<AppletRun>(space.id, RUN, topic.appletTalk.run);
  const t = run ? await runThread(deps, space, run) : null;
  if (!run || !t) return null;
  const msgs = await deps.store.lastMessages(t.id, RUN_READ);
  const d = delivered(t, msgs);
  const shown = msgs.find(m => m.id === t.applet?.msg)?.text ?? '';
  const by = space.names?.[run.by] ?? 'a member';
  const files = d.files.slice(-MAX_FILES).map(x => ({ ...x, by: agent }));
  return { text: talkPrompt(t.applet?.name ?? t.title, by, new Date(run.at).toISOString().slice(0, 10), shown, d.text, files.map(x => x.name), msg.text), files };
}
