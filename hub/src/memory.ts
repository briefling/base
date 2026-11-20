// Project memory (protocol/memory.ts), hub side: the agents' reads, proposals, reviews, syntheses and tags, the
// humans' Memory view frames, the memory agent's wake-ups (manual and the scheduled pass) and the entries pushed into
// each turn. A module without on/off (not in MODULES): plugged into the router through hub/src/modules.ts.
import { memoryChunks, MEMORY_ALIASES_MAX, approveMerge, approveAll, aliasesNamed, touchAliases, pruneAliases, retagWith, emptyVocab, mergesIn, newMerges, MEMORY_TAGS_LISTED, mergedTags,
  spaceTags, tagItemsIn, tagPrompt, tagsIn, untagged, DEFAULT_MEMORY_MODE, agentReviews, reviewedStatus, MEMORY_LIVE_MAX, MEMORY_PENDING_MAX,
  MEMORY_Q_MAX, agentView, canReview, isMemoryReviewer, nudgeDue, waitsForHuman, decide, gateOf, memoryForTurn, turnTags, needsTrust, proposalIn,
  searchMemory, DEFAULT_MEMORY_BATCH, MEMORY_REVIEW_MAX, MEMORY_REVIEW_RUNNING_MS, MEMORY_WHY_MAX, reviewable, reviewPrompt, shouldWake,
  DEFAULT_MEMORY_COMPACT, compactable, compactPrompt, inPendingSynthesis, replacedIds, memoryVolume, mergedSources, shouldCompact, synthesisGate,
  synthesisIn, type MemoryVocab, type PushedMemoryEntry, type MemoryBatch, type MemoryCompact, type MemoryConfig, type MemoryEntry,
  memoryRun, runSyntheses, runWhat, type MemoryMode, type MemoryVerdict, type MemoryWake } from '../../protocol/memory.ts';
import type { HubFrame, Message, Principal } from '../../protocol/frames.ts';
import { searchTerms } from '../../protocol/search.ts';
import { exchangeMemorySources } from './exchanges.ts';
import { agentsOf, broadcast, canAdmin, id, inTurn, memberSpace, mutateThread, need, readableSpace, Refused, reposOf, sendOne, str, toInstances, turnAuthor, turnsOf, wakes, workingIn, type Deps, type Instance, type Space, type StoredThread } from './router.ts';
import type { HubModule } from './modules.ts';
import { conversationTags, memoryTags, retagConversations, tagConversations, tagVocabFor } from './tags.ts';
import { tagMaxOf } from '../../protocol/tags.ts';
import { THREAD_TAGS_MAX, UNTAGGED_OFFERED_MAX, untaggedPrompt } from '../../protocol/tags.ts';

/**
 * Project memory pushed into the turn (`context.memory`): the published entries most related to the message
 * (memoryForTurn). Same gate as the agent's own memory reads: the turn is a trusted human's (turnAuthor), never the
 * hidden review/titling conversations. With the entries, the space's tags (turnTags). A failure never blocks the
 * delivery. Logged with the reads (`memory_use`).
 */
export async function turnMemory(deps: Deps, space: Space, thread: StoredThread, msg: Message, agent: string): Promise<{ memory: PushedMemoryEntry[]; tags: string[] }> {
  const none = { memory: [], tags: [] };
  if (thread.memoryReview) return none;
  try {
    const ok = msg.author.kind === 'human' ? wakes(space, msg.author.id, thread, msg) : !!(await turnAuthor(deps, space, thread));
    if (!ok) return none;
    const [all, vocab] = await Promise.all([deps.store.listMemory(space.id), vocabOf(deps, space.id)]);
    const memory = memoryForTurn(all, msg.text, undefined, undefined, vocab.aliases), tags = turnTags(all, memory.length);
    // An alias a human names stays alive (pruned at a compaction once idle): same version, so no lead's view goes stale.
    const touched = msg.author.kind === 'human' && vocab.version ? touchAliases(vocab, aliasesNamed(msg.text, vocab.aliases), deps.now()) : null;
    if (touched) await deps.store.putMemoryVocab(touched, vocab.version).catch(e => console.error('alias_seen_failed', (e as Error)?.message?.slice(0, 200)));
    logMemoryUse({ op: 'push', space: space.id, agent, thread: thread.id, n: memory.length, ids: memory.map(e => e.id), chars: memory.reduce((k, e) => k + e.text.length, 0), tags: tags.length });
    return { memory, tags };
  } catch (e) { console.error('memory_push_failed', (e as Error)?.message?.slice(0, 200)); return none }
}

/** One line per memory use by an agent (CloudWatch Logs Insights: `filter @message like 'memory_use'`). Never the query text. */
const logMemoryUse = (x: { op: 'push' | 'search' | 'read' | 'propose'; space: string; agent: string; thread: string } & Record<string, unknown>) =>
  console.log('memory_use', JSON.stringify(x));

export const memoryMode = (s: Space): MemoryMode => s.memory ?? DEFAULT_MEMORY_MODE;
export const memoryAgentOf = (s: Space): string => s.memoryAgent && agentsOf(s).includes(s.memoryAgent) ? s.memoryAgent : s.defaultAgent;
export const batchOf = (s: Space): MemoryBatch => s.memoryBatch ?? DEFAULT_MEMORY_BATCH;
export const compactOf = (s: Space): MemoryCompact => s.memoryCompact ?? DEFAULT_MEMORY_COMPACT;
const memoryConfig = async (deps: Deps, space: string): Promise<MemoryConfig> =>
  await deps.store.getMemoryConfig(space) ?? { space, version: 0 };
const isNewConfig = async (deps: Deps, space: string) => !(await deps.store.getMemoryConfig(space));
const vocabOf = async (deps: Deps, space: string): Promise<MemoryVocab> => await deps.store.getMemoryVocab(space) ?? emptyVocab(space);
/** Tags in use in the space (published and pending entries): what a written tag is mapped onto (canonTag). */
const knownTags = (all: MemoryEntry[]) => new Set(spaceTags(all).map(x => x.tag));

/**
 * The agent reads the memory (`memory_search` / `memory_read` tools): published entries only, agent view. Gates: running
 * turn of this agent started by a trusted human (topics included). Another space: the instance and the agent serve it
 * AND the human who started the turn is a member of it (an agent never carries a space's memory to someone who cannot
 * see it); the answer names the source space.
 */
async function memoryRead(deps: Deps, inst: Instance, cur: StoredThread, as: string, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  need(str(f.client_id, 64) && (f.space === undefined || id(f.space)));
  need(f.type === 'memory.search' ? typeof f.q === 'string' && f.q.length <= MEMORY_Q_MAX : id(f.id));
  const space = await readableSpace(deps, inst, cur, as, f.space);
  if (f.type === 'memory.read') {
    const e = await deps.store.getMemory(space.id, f.id);
    need(!!e && e.status === 'published', 'not_found');
    logMemoryUse({ op: 'read', space: space.id, agent: as, thread: cur.id, n: 1, ids: [e!.id] });
    await reply({ v: 2, type: 'memory.result', client_id: f.client_id, space: space.id, entries: [agentView(e!)] });
    return;
  }
  const [all, vocab] = await Promise.all([deps.store.listMemory(space.id), vocabOf(deps, space.id)]);
  const hits = searchMemory(all, f.q, undefined, vocab.aliases);
  logMemoryUse({ op: 'search', space: space.id, agent: as, thread: cur.id, n: hits.length, terms: searchTerms(f.q).length });
  // The space's tags ride every search answer: an agent searches before proposing, and reuses them (no `deploy` vs `deploiement`).
  const tags = spaceTags(all).slice(0, MEMORY_TAGS_LISTED).map(x => x.tag);
  await reply({ v: 2, type: 'memory.result', client_id: f.client_id, space: space.id, entries: hits.map(agentView), ...(tags.length ? { tags } : {}) });
}

/** The badge count for this person: reviewers only (nothing for the others, whatever the count). */
export const memPendingFor = (s: Space, who: string) => isMemoryReviewer(s, who) ? s.memPending ?? 0 : 0;
/** Live badge: the reviewers' open tabs get the new count (the others never see it). */
async function notifyReviewers(deps: Pick<Deps, 'store' | 'sender'>, s: Space, n: number) {
  for (const sub of await deps.store.listSubs(s.id)) {
    if (sub.kind !== 'human' || !isMemoryReviewer(s, sub.principal)) continue;
    if ((await sendOne(deps, sub.connId, { v: 2, type: 'event', event: 'memory.pending', data: { space: s.id, n } })) === false) await deps.store.deleteSub(s.id, sub.connId);
  }
}
/**
 * After a successful write of an entry (`before` = its previous version, null = created): keeps the space's count of
 * entries waiting for a human (badge) and, every MEMORY_NUDGE_EVERY arrivals, queues a Web Push to the reviewers. The
 * entry write is version-guarded, so each transition is counted once; the count is an atomic ADD (no lost update between
 * concurrent proposals). Best effort: a failure never fails the write, memory.list recounts and repairs.
 */
async function countPending(deps: Deps, s: Space, before: MemoryEntry | null, after: MemoryEntry) {
  const delta = (waitsForHuman(after) ? 1 : 0) - (before && waitsForHuman(before) ? 1 : 0);
  if (!delta) return;
  try {
    let { pending, arrivals } = await deps.store.addMemoryPending(s.id, delta, delta > 0);
    if (pending < 0) { pending = 0; await deps.store.setMemoryPending(s.id, 0); }
    await notifyReviewers(deps, s, pending);
    if (delta > 0 && nudgeDue(arrivals) && deps.queuePush) await deps.queuePush({ memory: s.id });
  } catch (e) { console.error('memory_pending_failed', (e as Error)?.name, (e as Error)?.message?.slice(0, 200)) }
}

/**
 * The agent proposes an entry (`memory_propose` tool), never a direct write: the space's gate decides (gateOf). Same
 * turn gate as the reads; the entry keeps its provenance (agent, conversation, human of the turn, sources). Auto mode
 * asks the classifier; it failing or missing keeps the entry for a human (fail closed).
 */
async function memoryPropose(deps: Deps, cur: StoredThread, as: string, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  need(str(f.client_id, 64));
  const p = proposalIn(f); need(!!p, 'bad_frame');
  need(inTurn(cur, as), 'no_turn');
  // « Propose to memory » on a mail: one rephrased fact, its source forced to the mail (only leads open it).
  if (cur.exRun) p!.sources = await exchangeMemorySources(deps, cur, as, p!.text);
  const space = await deps.store.getSpace(cur.space); need(!!space && !space.archived, 'forbidden');
  const by = await turnAuthor(deps, space!, cur); need(!!by, 'no_turn');
  const [all, vocab] = await Promise.all([deps.store.listMemory(space!.id), vocabOf(deps, space!.id)]);
  need(all.filter(e => e.status === 'published' || e.status === 'pending').length < MEMORY_LIVE_MAX, 'memory_full');
  const tagged = memoryTags(space!, p!.tags, all, vocab);
  need(all.filter(e => e.status === 'pending').length < MEMORY_PENDING_MAX, 'queue_full');
  // A replacement goes back on published entries of this space only; replacing a rule makes it a rule (a human decides).
  const replaced = p!.replaces.map(id => all.find(e => e.id === id));
  need(replaced.every(e => e?.status === 'published'), 'not_found');
  const kind = p!.kind === 'rule' || replaced.some(e => e!.kind === 'rule') ? 'rule' : 'fact';
  const mode = memoryMode(space!);
  let verdict: MemoryVerdict | null = null;
  if (mode === 'auto' && kind === 'fact' && p!.replaces.length) verdict = 'doubtful'; // the classifier never archives: a human decides
  else if (mode === 'auto' && kind === 'fact' && deps.classifyMemory) {
    try { verdict = await deps.classifyMemory(p!.text, p!.sources) } catch (e) { console.error('memory_classify_failed', (e as Error)?.name, (e as Error)?.message?.slice(0, 200)) }
  }
  const entry: MemoryEntry = { id: deps.newId(), space: space!.id, text: p!.text, kind, sources: p!.sources, author: as, thread: cur.id, by: by!,
    at: deps.now(), ...gateOf(mode, kind, verdict, as === memoryAgentOf(space!)), ...(tagged.length ? { tags: tagged } : {}),
    ...(p!.replaces.length ? { replaces: p!.replaces } : {}), version: 1 };
  need(await deps.store.putMemory(entry, null), 'stale');
  await countPending(deps, space!, null, entry);
  logMemoryUse({ op: 'propose', space: space!.id, agent: as, thread: cur.id, n: 1, ids: [entry.id], status: entry.status, gate: entry.gate });
  await broadcast(deps, space!.id, { v: 2, type: 'event', event: 'memory.updated', data: entry });
  await reply({ v: 2, type: 'memory.proposed', client_id: f.client_id, id: entry.id, status: entry.status, gate: entry.gate });
  if (cur.exRun) await mutateThread(deps, cur.id, { type: 'noop' }, undefined, undefined, x => x.exRun ? { ...x, exRun: { ...x.exRun, proposed: true } } : x, false);
  // A full batch wakes the memory agent at once; otherwise the poller wakes it when the oldest entry is old enough.
  if (entry.gate === 'queued') await wakeMemoryAgent(deps, space!, false).catch(e => console.error('memory_wake_failed', (e as Error)?.message?.slice(0, 200)));
}

/**
 * Wakes the space's memory agent in its hidden review conversation (a topic flagged `memoryReview`: no index row, never
 * Your turn, no summary, no push), to review the queued entries (agent mode, at most MEMORY_REVIEW_MAX) or to compact
 * the published memory (any mode). Batched (shouldWake / shouldCompact): never per proposal, never two memory turns at
 * once. The delivery is attributed to a trusted human (the one who asked, else the one whose turn produced the oldest
 * queued entry, else the first trusted human), as the plugin only acts on its allowlisted humans.
 */
export async function wakeMemoryAgent(deps: Deps, space: Space, manual: boolean, by?: string, what: 'review' | 'compact' | 'tag' = 'review'): Promise<MemoryWake> {
  if (space.archived || (what === 'review' && !agentReviews(memoryMode(space)))) return 'nothing';
  const entries = await deps.store.listMemory(space.id);
  const queue = reviewable(entries);
  if (what === 'review' && !queue.length) return 'nothing';
  const fresh = await isNewConfig(deps, space.id);
  const cfg = await memoryConfig(deps, space.id), now = deps.now(), agent = memoryAgentOf(space);
  const prev = cfg.thread ? await deps.store.getThread(cfg.thread) : null;
  const running = !!memoryRun(cfg, topicOf(prev), now);
  let text: string;
  if (what === 'review') {
    if (!shouldWake({ ...cfg, batch: batchOf(space) }, queue, now, running, manual)) return running ? 'running' : 'cooldown';
    text = reviewPrompt(queue.slice(0, MEMORY_REVIEW_MAX), entries);
  } else if (what === 'tag') {
    // Manual only (« Tag entries »): never two memory turns at once, no threshold nor cooldown.
    if (running) return 'running';
    const offered = untagged(entries);
    if (!offered.length) return 'nothing';
    text = tagPrompt(offered, spaceTags(entries).slice(0, MEMORY_TAGS_LISTED).map(x => x.tag));
  } else {
    const check = shouldCompact(cfg, compactOf(space), entries, now, running, manual);
    if (check !== 'go') return check;
    const offered = compactable(entries);
    if (offered.length < 2) return 'nothing';
    // Conversations left untagged (titled before the memory had tags, or nothing fitted) are offered with the vocabulary.
    const [stored, convs, choice] = await Promise.all([deps.store.getMemoryVocab(space.id), conversationTags(deps, space.id), tagVocabFor(deps, space)]);
    let vocab = stored ?? emptyVocab(space.id);
    const pruned = stored ? pruneAliases(vocab, now) : null;
    if (pruned && await deps.store.putMemoryVocab({ ...pruned.vocab, version: vocab.version + 1 }, vocab.version)) {
      vocab = { ...pruned.vocab, version: vocab.version + 1 };
      if (pruned.pruned.length) console.log('alias_pruned', JSON.stringify({ space: space.id, aliases: pruned.pruned }));
      await broadcast(deps, space.id, { v: 2, type: 'event', event: 'memory.vocab.updated', data: vocab });
    }
    const tags = spaceTags(entries), created = (vocab.created ?? []).filter(t => !tags.some(x => x.tag === t)).map(t => ({ tag: t, n: convs.uses.get(t) ?? 0 }));
    text = compactPrompt(offered, memoryVolume(entries), [...tags, ...created], vocab, untaggedPrompt(convs.untagged, choice.list), tagMaxOf(space), memoryMode(space) === 'agentAuto');
  }
  const human = by ?? [queue[0]?.by, ...space.trusted].find(h => !!h && space.trusted.includes(h));
  if (!human) return 'unreached';
  const thread = prev && prev.owner === agent ? prev : await mutateThread(deps, null, { type: 'noop' },
    { id: deps.newId(), space: space.id, title: 'Memory review', owner: agent, kind: 'topic' }, undefined, t => ({ ...t, memoryReview: true }));
  const next: MemoryConfig = { ...cfg, thread: thread.id, wokeAt: now, by: human, version: cfg.version + 1 };
  if (what === 'compact') next.compactAt = now; else delete next.compactAt; // a synthesis is only accepted in a compaction turn
  if (what === 'tag') next.tagAt = now; else delete next.tagAt;              // memory_tag only in a tagging turn
  if (!(await deps.store.putMemoryConfig(next, fresh ? null : cfg.version))) return 'running'; // another wake won
  // The topic's turns map lets the memory agent speak there (speakingAgent), like an agent called in a Lounge topic.
  const ready = await mutateThread(deps, thread.id, { type: 'noop' }, undefined, undefined, t => ({ ...t, turns: { ...turnsOf(t), [agent]: turnsOf(t)[agent] ?? { at: 0, active: false } } }));
  const msg: Message = { id: deps.newId(), thread: thread.id, author: { kind: 'human', id: human }, type: 'text', at: now, text };
  const reached = await toInstances(deps, space.id, agent, { v: 2, type: 'deliver', thread: ready.id, space: space.id, agent, message: msg, author_name: space.names?.[human] ?? 'Member',
    context: { title: ready.title, kind: 'topic', unseen: [] } });
  if (reached) await broadcast(deps, space.id, { v: 2, type: 'event', event: 'memory.run', data: { space: space.id, run: { what, since: now } } });
  return reached ? 'woken' : 'unreached';
}

/** The memory topic's turn state, as memoryRun reads it. */
const topicOf = (t: StoredThread | null) => t ? { busy: t.facts.turnActive || workingIn(t).length > 0, lastTurnAt: t.lastTurnAt } : null;

/**
 * A turn ended in a hidden topic (router, turn.ended): if it is the memory agent's run of the latest wake and nobody
 * works there any more, the Memory view's banner turns into its result (syntheses or entries waiting for a human).
 */
export async function memoryTurnEnded(deps: Deps, thread: StoredThread): Promise<void> {
  const cfg = await memoryConfig(deps, thread.space);
  if (cfg.thread !== thread.id || !cfg.wokeAt || topicOf(thread)!.busy) return;
  const what = runWhat(cfg), entries = await deps.store.listMemory(thread.space);
  const n = what === 'compact' ? runSyntheses(entries, cfg.wokeAt) : what === 'review' ? entries.filter(waitsForHuman).length : undefined;
  await broadcast(deps, thread.space, { v: 2, type: 'event', event: 'memory.run', data: { space: thread.space, run: { what, since: cfg.wokeAt, ended: deps.now(), ...(n !== undefined ? { n } : {}) } } });
}

/**
 * Poller pass (every 5 min): wakes the memory agent of every space whose review queue (agent mode) or published memory
 * (compaction thresholds) reached a threshold; a review first, the compaction at a later pass. Keys: `<space>` for the
 * review, `<space>/compact` for the compaction.
 */
export async function memoryPass(deps: Deps): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const s of await deps.store.listSpaces()) {
    if (s.archived) continue;
    try {
      if (agentReviews(memoryMode(s))) out[s.id] = await wakeMemoryAgent(deps, s, false);
      if (out[s.id] !== 'woken') out[`${s.id}/compact`] = await wakeMemoryAgent(deps, s, false, undefined, 'compact');
    } catch (e) { out[s.id] = `failed: ${(e as Error)?.message?.slice(0, 120)}`; }
  }
  return out;
}

/**
 * The memory agent's synthesis (`memory_compact` tool): replaces `supersedes` once a human approves it. Gates: the
 * space's review conversation, the current memory agent, during a compaction turn (woken for it within
 * MEMORY_REVIEW_RUNNING_MS); every replaced entry published in this space and in no other waiting synthesis. Same
 * control as the memory agent's own proposals (synthesisGate); not counted against the live / pending limits (it
 * shrinks the memory). Sources: its own, then the replaced entries'.
 */
async function memorySynthesis(deps: Deps, cur: StoredThread, as: string, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  need(str(f.client_id, 64));
  const p = synthesisIn(f); need(!!p, 'bad_frame');
  const space = await deps.store.getSpace(cur.space); need(!!space && !space.archived, 'forbidden');
  const cfg = await deps.store.getMemoryConfig(space!.id), now = deps.now();
  need(!!cur.memoryReview && cfg?.thread === cur.id && as === memoryAgentOf(space!) && !!cfg.compactAt && now - cfg.compactAt < MEMORY_REVIEW_RUNNING_MS, 'forbidden');
  need(inTurn(cur, as), 'no_turn');
  const by = cfg!.by && space!.trusted.includes(cfg!.by) ? cfg!.by : null; need(!!by, 'no_turn'); // the wake message is not stored
  const all = await deps.store.listMemory(space!.id);
  const replaced = p!.supersedes.map(id => all.find(e => e.id === id));
  need(replaced.every(e => e?.status === 'published'), 'not_found');
  const busy = inPendingSynthesis(all); need(!p!.supersedes.some(id => busy.has(id)), 'busy');
  // Rewrites of single entries make a pass able to propose one change per entry: a runaway pass stops here.
  need(all.filter(e => e.status === 'pending' && e.supersedes).length < MEMORY_PENDING_MAX, 'queue_full');
  const kind = p!.kind === 'rule' || replaced.some(e => e!.kind === 'rule') ? 'rule' : 'fact';
  const entry: MemoryEntry = { id: deps.newId(), space: space!.id, text: p!.text, kind, sources: mergedSources(p!.sources, replaced as MemoryEntry[]), author: as,
    thread: cur.id, by: by!, at: now, ...synthesisGate(memoryMode(space!), kind), supersedes: p!.supersedes, ...(p!.drop ? { drop: true } : {}), version: 1 };
  const tags = memoryTags(space!, mergedTags(p!.tags, replaced as MemoryEntry[]), all, await vocabOf(deps, space!.id)); if (tags.length) entry.tags = tags;
  need(await deps.store.putMemory(entry, null), 'stale');
  await countPending(deps, space!, null, entry);
  await broadcast(deps, space!.id, { v: 2, type: 'event', event: 'memory.updated', data: entry });
  await reply({ v: 2, type: 'memory.proposed', client_id: f.client_id, id: entry.id, status: entry.status, gate: entry.gate });
}

/**
 * The memory agent tags published entries (`memory_tag` tool). Gates: the space's review conversation, the current
 * memory agent, during a tagging turn (« Tag entries », within MEMORY_REVIEW_RUNNING_MS). Only the tags change (never
 * the text nor the status); ids not published in this space are skipped, a concurrent change is skipped too.
 */
async function memoryTag(deps: Deps, cur: StoredThread, as: string, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  need(str(f.client_id, 64));
  const items = tagItemsIn(f.items); need(!!items, 'bad_frame');
  const space = await deps.store.getSpace(cur.space); need(!!space && !space.archived, 'forbidden');
  const cfg = await deps.store.getMemoryConfig(space!.id), now = deps.now();
  need(!!cur.memoryReview && cfg?.thread === cur.id && as === memoryAgentOf(space!) && !!cfg.tagAt && now - cfg.tagAt < MEMORY_REVIEW_RUNNING_MS, 'forbidden');
  need(inTurn(cur, as), 'no_turn');
  const skipped: string[] = [];
  let updated = 0;
  const [all, vocab] = await Promise.all([deps.store.listMemory(space!.id), vocabOf(deps, space!.id)]);
  for (const it of items!) {
    const e = await deps.store.getMemory(space!.id, it.id);
    if (e?.status !== 'published') { skipped.push(it.id); continue; }
    let tags: string[];
    try { tags = memoryTags(space!, it.tags, all, vocab) } catch { skipped.push(it.id); continue; } // over the cap
    const next: MemoryEntry = { ...e, tags, version: e.version + 1 };
    if (!(await deps.store.putMemory(next, e.version))) { skipped.push(it.id); continue; }
    updated++;
    await broadcast(deps, space!.id, { v: 2, type: 'event', event: 'memory.updated', data: next });
  }
  console.log('memory_tagged', JSON.stringify({ space: space!.id, agent: as, updated, skipped: skipped.length }));
  await reply({ v: 2, type: 'memory.tagged', client_id: f.client_id, updated, skipped });
}

/**
 * The memory agent's tag merges (`memory_tag_merge` tool): same gates as a synthesis (review conversation, memory
 * agent, compaction turn). Nothing is rewritten here: the merges wait in the vocabulary for a trusted human.
 */
async function memoryTagMerge(deps: Deps, cur: StoredThread, as: string, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  need(str(f.client_id, 64));
  const items = mergesIn(f.merges); need(!!items, 'bad_frame');
  const space = await deps.store.getSpace(cur.space); need(!!space && !space.archived, 'forbidden');
  const cfg = await deps.store.getMemoryConfig(space!.id), now = deps.now();
  need(!!cur.memoryReview && cfg?.thread === cur.id && as === memoryAgentOf(space!) && !!cfg.compactAt && now - cfg.compactAt < MEMORY_REVIEW_RUNNING_MS, 'forbidden');
  need(inTurn(cur, as), 'no_turn');
  const [all, v] = await Promise.all([deps.store.listMemory(space!.id), deps.store.getMemoryVocab(space!.id)]);
  const vocab = v ?? emptyVocab(space!.id);
  const { kept, skipped } = newMerges(items!, new Set([...knownTags(all), ...(vocab.created ?? [])]), vocab); // created tags merge too
  // agentAuto: the memory agent already publishes alone, so its revised list is applied at once.
  const auto = memoryMode(space!) === 'agentAuto';
  let retagged = 0;
  if (kept.length) {
    const added = { ...vocab, merges: [...vocab.merges, ...kept.map(m => ({ ...m, agent: as, at: now }))] };
    const next: MemoryVocab = auto ? { ...added, ...appliedVocab(added, kept.map(m => m.from), now), version: vocab.version + 1 } : { ...added, version: vocab.version + 1 };
    need(Object.keys(next.aliases).length <= MEMORY_ALIASES_MAX, 'memory_full');
    need(await deps.store.putMemoryVocab(next, v ? vocab.version : null), 'stale');
    await broadcast(deps, space!.id, { v: 2, type: 'event', event: 'memory.vocab.updated', data: next });
    if (auto) retagged = await retagAll(deps, space!.id, Object.fromEntries(kept.map(m => [m.from, next.aliases[m.from]])), `agent:${as}`);
  }
  console.log('memory_tagmerge', JSON.stringify({ space: space!.id, agent: as, added: kept.length, skipped: skipped.length, auto }));
  await reply({ v: 2, type: 'memory.tagmerged', client_id: f.client_id, added: kept.length, skipped, ...(auto ? { applied: true, retagged } : {}) });
}

/**
 * The memory agent's tags on conversations left untagged (`memory_tag_threads` tool): same gates as a tag merge
 * (review conversation, memory agent, compaction turn); vocabulary only, never over existing tags (tags.ts).
 */
async function memoryThreadTag(deps: Deps, cur: StoredThread, as: string, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  need(str(f.client_id, 64) && Array.isArray(f.items) && f.items.length >= 1 && f.items.length <= UNTAGGED_OFFERED_MAX);
  const items = (f.items as any[]).filter(x => x && id(x.id) && Array.isArray(x.tags) && x.tags.length >= 1 && x.tags.length <= THREAD_TAGS_MAX);
  need(items.length === f.items.length && new Set(items.map(x => x.id)).size === items.length);
  const space = await deps.store.getSpace(cur.space); need(!!space && !space.archived, 'forbidden');
  const cfg = await deps.store.getMemoryConfig(space!.id), now = deps.now();
  need(!!cur.memoryReview && cfg?.thread === cur.id && as === memoryAgentOf(space!) && !!cfg.compactAt && now - cfg.compactAt < MEMORY_REVIEW_RUNNING_MS, 'forbidden');
  need(inTurn(cur, as), 'no_turn');
  const { updated, skipped } = await tagConversations(deps, space!, as, items.map(x => ({ id: x.id, tags: x.tags })));
  console.log('memory_threadtag', JSON.stringify({ space: space!.id, agent: as, updated, skipped: skipped.length }));
  await reply({ v: 2, type: 'memory.threadtagged', client_id: f.client_id, updated, skipped });
}

/**
 * A trusted human decides on the vocabulary (`memory.vocab`): approve a waiting merge (the alias is recorded first, so
 * matching and new writes follow it at once, then every entry carrying the old tag is rewritten), reject it, or remove
 * an alias (entries keep their tag). A concurrent change of an entry is retried once from a fresh read.
 */
async function memoryVocabDecide(deps: Deps, who: Principal, space: Space, trusted: boolean, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  need(str(f.client_id, 64) && Number.isSafeInteger(f.version) && ['approve', 'approve_all', 'reject', 'unalias'].includes(f.action)
    && (f.action === 'approve_all' || (typeof f.tag === 'string' && /^[a-z0-9-]{1,32}$/.test(f.tag))));
  need(trusted, 'forbidden');
  const v = await deps.store.getMemoryVocab(space.id), cur = v ?? emptyVocab(space.id);
  need(cur.version === f.version, 'stale');
  const merge = cur.merges.find(m => m.from === f.tag);
  let next: MemoryVocab, moved: string[] = [];
  if (f.action === 'approve_all') {
    need(cur.merges.length > 0, 'not_found');
    moved = cur.merges.map(m => m.from);
    next = { ...cur, ...approveAll(cur, deps.now()), version: cur.version + 1 };
    need(Object.keys(next.aliases).length <= MEMORY_ALIASES_MAX, 'memory_full');
  } else if (f.action === 'unalias') {
    need(!!cur.aliases[f.tag], 'not_found');
    const { [f.tag]: _gone, ...aliases } = cur.aliases;
    next = { ...cur, aliases, version: cur.version + 1 };
  } else {
    need(!!merge, 'not_found');
    if (f.action === 'approve') moved = [merge!.from];
    next = f.action === 'reject' ? { ...cur, merges: cur.merges.filter(m => m !== merge), version: cur.version + 1 }
      : { ...cur, ...approveMerge(cur, merge!.from, merge!.to, deps.now()), version: cur.version + 1 };
    need(Object.keys(next.aliases).length <= MEMORY_ALIASES_MAX, 'memory_full');
  }
  need(await deps.store.putMemoryVocab(next, v ? cur.version : null), 'stale');
  await broadcast(deps, space.id, { v: 2, type: 'event', event: 'memory.vocab.updated', data: next });
  // every approved `from` goes straight to its final tag (aliases never chain)
  const n = moved.length ? await retagAll(deps, space.id, Object.fromEntries(moved.map(t => [t, next.aliases[t]])), who.id) : 0;
  await reply({ v: 2, type: 'memory.vocabulary', client_id: f.client_id, vocab: next, retagged: n });
}

/** `from` tags approved (all of them in agentAuto): the vocabulary after their merges, in order. */
function appliedVocab(v: MemoryVocab, from: string[], now: number): MemoryVocab {
  let x = v;
  for (const t of from) { const m = x.merges.find(y => y.from === t); if (m) x = { ...x, ...approveMerge(x, m.from, m.to, now) }; }
  return x;
}

/**
 * Approved merges applied to the data: every entry and conversation carrying a key of `map` gets its value (a concurrent
 * change of an entry is retried once from a fresh read). Returns how many entries were retagged.
 */
async function retagAll(deps: Deps, space: string, map: Record<string, string>, by: string): Promise<number> {
  let n = 0;
  for (const e of await deps.store.listMemory(space)) {
    for (let tries = 0, x: MemoryEntry | null = e; x && tries < 2; tries++) {
      const tags = retagWith(x.tags, map); if (!tags) break;
      const done: MemoryEntry = { ...x, tags, version: x.version + 1 };
      if (await deps.store.putMemory(done, x.version)) { n++; await broadcast(deps, space, { v: 2, type: 'event', event: 'memory.updated', data: done }); break; }
      x = await deps.store.getMemory(space, e.id);
    }
  }
  const convs = await retagConversations(deps, space, map);
  console.log('memory_tag_merged', JSON.stringify({ space, map, by, retagged: n, conversations: convs }));
  return n;
}

/**
 * The memory agent's verdict (`memory_review` tool). Gates: the space's review conversation, the current memory agent,
 * during its turn there, an entry still waiting for it (queued: never its own proposal; a rule only in agentAuto mode,
 * whose approve alone publishes it, see reviewedStatus).
 */
async function memoryReview(deps: Deps, cur: StoredThread, as: string, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  need(str(f.client_id, 64) && id(f.id) && ['approve', 'reject', 'human'].includes(f.verdict) && typeof f.why === 'string'
    && f.why.trim().length > 0 && f.why.length <= MEMORY_WHY_MAX && !/[\u0000-\u001f\u007f]/.test(f.why));
  const space = await deps.store.getSpace(cur.space); need(!!space && !space.archived, 'forbidden');
  const cfg = await deps.store.getMemoryConfig(space!.id);
  const mode = memoryMode(space!);
  need(!!cur.memoryReview && cfg?.thread === cur.id && agentReviews(mode) && as === memoryAgentOf(space!), 'forbidden');
  need(inTurn(cur, as), 'no_turn');
  const e = await deps.store.getMemory(space!.id, f.id);
  need(!!e && e.status === 'pending' && e.gate === 'queued' && e.author !== as, 'not_found');
  const status = reviewedStatus(mode, e!.kind, f.verdict);
  const next: MemoryEntry = { ...e!, status, gate: 'agent', review: { agent: as, verdict: f.verdict, why: f.why.trim(), at: deps.now() }, version: e!.version + 1 };
  need(await deps.store.putMemory(next, e!.version), 'stale');
  await countPending(deps, space!, e!, next);
  await broadcast(deps, space!.id, { v: 2, type: 'event', event: 'memory.updated', data: next });
  await reply({ v: 2, type: 'memory.reviewed', client_id: f.client_id, id: next.id, status: next.status });
  if (next.status === 'published') await archiveReplaced(deps, space!.id, next); // an approved replacement: the old entries go
}

/**
 * An approved synthesis, drop or replacement: the entries it replaces that are still published are archived, linked to
 * it (`supersededBy`), restorable. `who` = the human who approved it; none when the memory agent did (its `review` says so).
 */
async function archiveReplaced(deps: Deps, space: string, by: MemoryEntry, who?: string) {
  for (const old of replacedIds(by)) {
    const e = await deps.store.getMemory(space, old);
    if (e?.status !== 'published') continue;
    const gone: MemoryEntry = { ...e, status: 'archived', supersededBy: by.id, ...(who ? { decided: { by: who, at: deps.now(), action: 'archive' as const } } : {}), version: e.version + 1 };
    if (await deps.store.putMemory(gone, e.version)) await broadcast(deps, space, { v: 2, type: 'event', event: 'memory.updated', data: gone });
  }
}

/** Memory view (humans): any member lists; reviewers approve/reject pending entries; trusted humans archive/restore. */
async function memoryHuman(deps: Deps, who: Principal, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  need(id(f.space));
  const space = await memberSpace(deps, who, f.space);
  const mode = memoryMode(space), trusted = space.trusted.includes(who.id);
  if (f.type === 'memory.list') {
    const entries = (await deps.store.listMemory(space.id)).sort((a, b) => b.at - a.at);
    // The view reads every entry anyway: repair the badge count if a counted write was lost (Lambda stopped between the two).
    const waiting = entries.filter(waitsForHuman).length;
    if (waiting !== (space.memPending ?? 0)) {
      await deps.store.setMemoryPending(space.id, waiting);
      console.log('memory_pending_repaired', JSON.stringify({ space: space.id, from: space.memPending ?? 0, to: waiting }));
      await notifyReviewers(deps, space, waiting);
    }
    const cfg = await memoryConfig(deps, space.id);
    const run = memoryRun(cfg, topicOf(cfg.thread ? await deps.store.getThread(cfg.thread) : null), deps.now());
    const [first, ...rest] = memoryChunks(entries);
    await reply({ v: 2, type: 'memory', space: space.id, mode, entries: first, review: canReview(mode, true, trusted), trusted, agent: memoryAgentOf(space), vocab: await vocabOf(deps, space.id), more: rest.length > 0, ...(run ? { run } : {}) });
    for (const [i, chunk] of rest.entries()) await reply({ v: 2, type: 'memory.entries', space: space.id, entries: chunk, more: i < rest.length - 1 });
    return;
  }
  if (f.type === 'memory.wake' || f.type === 'memory.compact' || f.type === 'memory.autotag') {
    need(str(f.client_id, 64));
    need(trusted, 'forbidden');
    const what = f.type === 'memory.wake' ? 'review' : f.type === 'memory.compact' ? 'compact' : 'tag';
    await reply({ v: 2, type: 'memory.woken', client_id: f.client_id, space: space.id, what, result: await wakeMemoryAgent(deps, space, true, who.id, what) });
    return;
  }
  if (f.type === 'memory.vocab') return await memoryVocabDecide(deps, who, space, trusted, f, reply);
  if (f.type === 'memory.tags') {
    // A trusted human corrects the tags (the agents' choice, or none); the text and status never change here.
    const tags = tagsIn(f.tags);
    need(str(f.client_id, 64) && id(f.id) && Number.isSafeInteger(f.version) && Array.isArray(f.tags) && !!tags);
    need(trusted, 'forbidden');
    const cur = await deps.store.getMemory(space.id, f.id); need(!!cur && cur.status !== 'rejected', 'not_found');
    need(cur!.version === f.version, 'stale');
    const { tags: _old, ...rest } = cur!;
    const canon = memoryTags(space, tags!, (await deps.store.listMemory(space.id)).filter(e => e.id !== cur!.id), await vocabOf(deps, space.id));
    const next: MemoryEntry = { ...rest, ...(canon.length ? { tags: canon } : {}), version: cur!.version + 1 };
    need(await deps.store.putMemory(next, cur!.version), 'stale');
    await broadcast(deps, space.id, { v: 2, type: 'event', event: 'memory.updated', data: next });
    await reply({ v: 2, type: 'memory.entry', client_id: f.client_id, entry: next });
    return;
  }
  need(str(f.client_id, 64) && id(f.id) && Number.isSafeInteger(f.version) && ['approve', 'reject', 'archive', 'restore'].includes(f.action));
  const cur = await deps.store.getMemory(space.id, f.id); need(!!cur, 'not_found');
  need(needsTrust(f.action, cur!) ? trusted : canReview(mode, true, trusted), 'forbidden');
  need(cur!.version === f.version, 'stale');
  const status = decide(cur!.status, f.action, !!cur!.drop); need(!!status, 'bad_action');
  const { supersededBy, ...rest } = cur!; // a restored entry no longer says it was replaced
  const next: MemoryEntry = { ...(f.action === 'restore' ? rest : cur!), status: status!, decided: { by: who.id, at: deps.now(), action: f.action }, version: cur!.version + 1 };
  need(await deps.store.putMemory(next, cur!.version), 'stale');
  await countPending(deps, space, cur!, next);
  await broadcast(deps, space.id, { v: 2, type: 'event', event: 'memory.updated', data: next });
  await reply({ v: 2, type: 'memory.entry', client_id: f.client_id, entry: next });
  // An approved synthesis, drop or replacement replaces its entries (archived, restorable, linked to it).
  if (f.action === 'approve') await archiveReplaced(deps, space.id, next, who.id);
}

/**
 * « Import from repo » (Memory view): global admin, member of the space, repo attached to it. The read and the writes
 * run in the GitHub Lambda (the App's token), which checks all of this again and answers `memory.imported`.
 */
async function memoryImportAsk(deps: Deps, connId: string, who: Principal, f: any) {
  need(str(f.client_id, 64) && id(f.space) && typeof f.repo === 'string' && f.repo.length <= 140);
  const space = await memberSpace(deps, who, f.space);
  need(await canAdmin(deps, who.id, space), 'forbidden');
  const repo = reposOf(space).find(r => r.toLowerCase() === f.repo.trim().toLowerCase());
  need(!!repo, 'repo_not_attached');
  need(!!deps.queueGithub, 'github_off');
  await deps.queueGithub!({ kind: 'memimport', space: space.id, by: who.id, conn: connId, client_id: f.client_id, repo: repo! });
}

const HUMAN = new Set(['memory.list', 'memory.decide', 'memory.compact', 'memory.wake', 'memory.tags', 'memory.autotag', 'memory.vocab']);
export const memory: HubModule = {
  prefix: 'memory',
  async human(deps, who, f, reply, connId) {
    if (f.type === 'memory.import') return await memoryImportAsk(deps, connId, who, f);
    if (HUMAN.has(f.type)) return await memoryHuman(deps, who, f, reply);
    throw new Refused('unknown_type');
  },
  agent: {
    'memory.search': (deps, cur, as, f, reply, inst) => memoryRead(deps, inst, cur, as, f, reply),
    'memory.read': (deps, cur, as, f, reply, inst) => memoryRead(deps, inst, cur, as, f, reply),
    'memory.propose': memoryPropose,
    'memory.review': memoryReview,
    'memory.synthesis': memorySynthesis,
    'memory.tag': memoryTag,
    'memory.tagmerge': memoryTagMerge,
    'memory.threadtag': memoryThreadTag,
  },
};
