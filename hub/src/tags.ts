// Conversation tags (protocol/tags.ts), hub side: the vocabulary (the space's project-memory tags + the tags created on
// conversations while it was open), the agent's tags checked for `topic.title` (cards.ts) and `thread.outcome`
// (router.ts) and written in the same thread write, the lead's correction (`tags.set`), and the conversations left
// untagged that a compaction offers the memory agent (memory.ts). A module without on/off (not in MODULES), plugged in
// through hub/src/modules.ts.
import { isGeneralId, type HubFrame, type Principal } from '../../protocol/frames.ts';
import { CREATED_TAGS_MAX, emptyVocab, retagWith, vocabTagsIn, type MemoryEntry, type MemoryVocab } from '../../protocol/memory.ts';
import { TAG_VOCAB_MAX, UNTAGGED_OFFERED_MAX, tagMaxOf, tagVocab, threadTagsIn, type UntaggedConversation } from '../../protocol/tags.ts';
import { broadcast, id, memberSpace, mutateThread, need, publicThread, str, type Deps, type StoredThread } from './router.ts';
import type { HubModule } from './modules.ts';

type Reply = (f: HubFrame) => Promise<boolean>;

/**
 * The space's tags (memory entries most used first, then the tags created on conversations) and aliases: what a written
 * tag is checked against. `room`: new tags the space's cap (tagMaxOf) still allows; `open` while there is room.
 */
export type SpaceCap = { id: string; tagMax?: number };
async function vocabulary(deps: Deps, s: SpaceCap) {
  const [all, v] = await Promise.all([deps.store.listMemory(s.id), deps.store.getMemoryVocab(s.id)]);
  const vocab: MemoryVocab = v ?? emptyVocab(s.id);
  const list = tagVocab(all, vocab.created), room = Math.max(0, tagMaxOf(s) - list.length);
  return { list, known: new Set(list), aliases: vocab.aliases, room, open: room > 0, vocab, stored: !!v };
}

/**
 * Tags written on a memory entry (agent or human), against the same capped vocabulary: mapped (alias, plural, kind tags
 * dropped); a tag outside it only while the cap has room, else `unknown_tag` (the writer reuses the space's tags).
 * `all` = the entries the write is checked against.
 */
export function memoryTags(s: SpaceCap, tags: string[], all: MemoryEntry[], vocab: MemoryVocab): string[] {
  const list = tagVocab(all, vocab.created);
  const r = vocabTagsIn(tags, vocab.aliases, new Set(list), tagMaxOf(s) - list.length);
  need(!('unknown' in r), 'unknown_tag');
  return (r as { ok: string[] }).ok;
}

/**
 * Tags written by `by` checked against the vocabulary: refused `bad_frame` (malformed) or `unknown_tag` (closed
 * vocabulary, or `closed` asked). Under the threshold a new tag is recorded in the vocabulary first (MEMTAGS, optimistic,
 * retried on a concurrent write), so the next check counts it.
 */
async function checked(deps: Deps, s: SpaceCap, x: unknown): Promise<string[]> {
  const space = s.id;
  for (let tries = 0; ; tries++) {
    const v = await vocabulary(deps, s), r = threadTagsIn(x, v.aliases, v.known, v.room);
    need(!('bad' in r));
    need(!('unknown' in r), 'unknown_tag');
    const ok = (r as { ok: string[] }).ok, fresh = ok.filter(t => !v.known.has(t));
    if (!fresh.length) return ok;
    const created = [...(v.vocab.created ?? []), ...fresh];
    need(created.length <= CREATED_TAGS_MAX, 'unknown_tag');
    if (await deps.store.putMemoryVocab({ ...v.vocab, created, version: v.vocab.version + 1 }, v.stored ? v.vocab.version : null)) {
      console.log('tag_created', JSON.stringify({ space, tags: fresh, vocab: v.list.length }));
      return ok;
    }
    need(tries < 2, 'stale');
  }
}

/**
 * The agent's tags in a `topic.title` / `thread.outcome` frame, checked BEFORE anything of the frame is written (an
 * unknown tag refuses it whole, the agent retries with tags of the list). Undefined when none is given.
 */
export async function agentTags(deps: Deps, space: SpaceCap, x: unknown): Promise<string[] | undefined> {
  if (x === undefined || x === null) return undefined;
  const list = await checked(deps, space, x);
  return list.length ? list : undefined;
}

/** Thread write patch: the agent's tags, unless a lead set them (a human's choice is never overwritten). */
export const withAgentTags = (t: StoredThread, list: string[] | undefined, agent: string, now: number): StoredThread =>
  !list || t.tags?.by.kind === 'human' ? t : { ...t, tags: { list, by: { kind: 'agent', id: agent }, at: now } };

/** What the agent of a turn may tag with (`context.tag_vocab`, `tag_open`): the list, and whether a new tag is accepted. */
export interface TagChoice { list: string[]; open: boolean }
export async function tagVocabFor(deps: Deps, space: SpaceCap): Promise<TagChoice> {
  try { const v = await vocabulary(deps, space); return { list: v.list.slice(0, TAG_VOCAB_MAX), open: v.open } }
  catch (e) { console.error('tag_vocab_failed', (e as Error)?.message?.slice(0, 200)); return { list: [], open: false } }
}

/**
 * For a compaction: the Lounge topics and threads of the space without tags (most recent first, the memory agent tags
 * them) and how many conversations carry each tag (the created tags have no memory use to count).
 */
export async function conversationTags(deps: Deps, space: string): Promise<{ untagged: UntaggedConversation[]; uses: Map<string, number> }> {
  const all = (await deps.store.listThreads(space, 0)).filter(t => !t.archived && !isGeneralId(t.id));
  const uses = new Map<string, number>();
  for (const t of all) for (const x of t.tags?.list ?? []) uses.set(x, (uses.get(x) ?? 0) + 1);
  const untagged = all.filter(t => !t.tags).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, UNTAGGED_OFFERED_MAX)
    .map(t => ({ id: t.id, kind: t.kind === 'topic' ? 'topic' as const : 'thread' as const, title: [...(t.heading?.text ?? t.title ?? '')].slice(0, 120).join('') }));
  return { untagged, uses };
}

/**
 * The memory agent's tags on untagged conversations (compaction turn, gates checked by the caller): vocabulary only
 * (never a new tag), never over tags set meanwhile (agent or lead). Not activity. Returns how many were tagged and the
 * ids skipped (not a conversation of the space, already tagged, or a tag outside the vocabulary).
 */
export async function tagConversations(deps: Deps, s: SpaceCap, agent: string, items: { id: string; tags: string[] }[]): Promise<{ updated: number; skipped: string[] }> {
  let updated = 0; const skipped: string[] = [];
  const space = s.id, v = await vocabulary(deps, s);
  for (const it of items) {
    const r = threadTagsIn(it.tags, v.aliases, v.known);
    const list = 'ok' in r ? r.ok : [];
    const cur = list.length ? await deps.store.getThread(it.id) : null;
    if (!cur || cur.space !== space || cur.memoryReview || cur.general || cur.archived || cur.tags) { skipped.push(it.id); continue }
    let wrote = false;
    const next = await mutateThread(deps, cur.id, { type: 'noop' }, undefined, undefined, x => {
      if (x.tags) return x;
      wrote = true; return { ...x, tags: { list, by: { kind: 'agent', id: agent }, at: deps.now() } };
    }, false);
    if (!wrote) { skipped.push(it.id); continue }
    updated++;
    await broadcast(deps, space, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(next) });
  }
  return { updated, skipped };
}

/** Merges approved (memory.vocab): the conversations carrying a key of `map` now carry its value (who set them is kept). */
export async function retagConversations(deps: Deps, space: string, map: Record<string, string>): Promise<number> {
  let n = 0;
  for (const t of await deps.store.listThreads(space, 0)) {
    if (!retagWith(t.tags?.list, map)) continue;
    const next = await mutateThread(deps, t.id, { type: 'noop' }, undefined, undefined, x => {
      const list = retagWith(x.tags?.list, map);
      return list && x.tags ? { ...x, tags: { ...x.tags, list } } : x;
    }, false);
    n++;
    await broadcast(deps, space, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(next) });
  }
  return n;
}

/** tags.set: a lead sets or clears (`[]`) the tags of a topic or a thread. Not activity: no reorder, no unread. */
async function setTags(deps: Deps, who: Principal, f: any, reply: Reply) {
  need(f.type === 'tags.set', 'unknown_type');
  need(str(f.client_id, 64) && id(f.thread));
  const cur = await deps.store.getThread(f.thread);
  need(!!cur && !cur.memoryReview && !cur.general, 'forbidden');
  const space = await memberSpace(deps, who, cur!.space);
  need(space.trusted.includes(who.id) && !space.archived, 'forbidden');
  const list = await checked(deps, space, f.tags);
  const thread = await mutateThread(deps, cur!.id, { type: 'noop' }, undefined, undefined, x => {
    const { tags, ...rest } = x;
    return list.length ? { ...rest, tags: { list, by: { kind: 'human', id: who.id }, at: deps.now() } } : rest;
  }, false);
  await broadcast(deps, thread.space, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(thread) });
  await reply({ v: 2, type: 'ack', client_id: f.client_id, thread: thread.id, msg_id: '' });
}

export const tags: HubModule = { prefix: 'tags', human: (deps, who, f, reply) => setTags(deps, who, f, reply) };
