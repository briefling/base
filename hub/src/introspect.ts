// Introspection (`space_threads`, `thread_read`, `space_metrics` agent tools): an agent reads back conversations of a
// space it serves, read only. The router keeps the dispatch (behind the agent turn gate of fromInstance) and
// readableSpace, shared with the project memory.
import { LINEAGE_PERIODS, METRICS_MAX_THREADS, METRICS_PERIODS, THREAD_STATES, type HubFrame, type IntrospectMessage, type IntrospectRead, type IntrospectThread, type Message } from '../../protocol/frames.ts';
import { backstageAgent } from '../../protocol/memory.ts';
import { threadDetails } from './details.ts';
import { lineageOf } from './lineage.ts';
import { metricsOf } from './metrics.ts';
import { METRICS_READS, byActivity, id, need, pool, publicThread, readableSpace, str, type Deps, type Instance, type StoredThread } from './router.ts';

/** Introspection pages stay under API Gateway's 128 KB per message, like `history`. */
export const INTROSPECT_PAGE = 30, INTROSPECT_MESSAGES = 60, INTROSPECT_MAX_BYTES = 100_000;
const bytes = (x: unknown) => Buffer.byteLength(JSON.stringify(x));
/** A message as the agent reads it back: file names only, no secret line detail, no preview session, no held GitHub card. */
function introspectMessage(m: Message): IntrospectMessage {
  const out: IntrospectMessage = { id: m.id, at: m.at, author: m.author, type: m.type, text: m.text };
  for (const k of ['ask', 'propose', 'ci', 'stop', 'deleted', 'edited', 'notice'] as const) if (m[k] !== undefined) (out as any)[k] = m[k];
  if (m.files?.length) out.files = m.files.map(x => x.name);
  return out;
}

/**
 * Introspection (`space_threads`, `thread_read`, `space_metrics` tools): an agent reads back conversations of a space it
 * serves, read only, to understand what went wrong. Gates of readableSpace (as memory_search). Hidden conversations
 * (memory review, titling) never have an index row: never listed, and refused by id like an unknown one.
 */
export async function introspect(deps: Deps, inst: Instance, cur: StoredThread, as: string, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  need(str(f.client_id, 64) && (f.space === undefined || id(f.space)));
  // A backstage memory agent gets the memory proposals, never the conversations (less surface).
  const home = await deps.store.getSpace(cur.space);
  need(!home || as !== backstageAgent(home), 'forbidden');
  const ok = (x: Omit<Extract<HubFrame, { type: 'introspect.result' }>, 'v' | 'type' | 'client_id'>) => reply({ v: 2, type: 'introspect.result', client_id: f.client_id, ...x });
  const ms = (x: unknown) => x === undefined || (Number.isSafeInteger(x) && (x as number) >= 0);
  if (f.type === 'space.threads') {
    need(ms(f.since) && ms(f.until) && ms(f.offset) && (f.offset ?? 0) <= METRICS_MAX_THREADS && (f.state === undefined || THREAD_STATES.includes(f.state))
      && (f.kind === undefined || f.kind === 'thread' || f.kind === 'topic') && (f.who === undefined || id(f.who)));
    const space = await readableSpace(deps, inst, cur, as, f.space);
    const all = (await deps.store.listThreads(space.id, f.since ?? 0))
      .filter(x => (f.until === undefined || x.updatedAt <= f.until) && (f.state === undefined || x.state === f.state)
        && (f.kind === undefined || (x.kind ?? 'thread') === f.kind) && (f.who === undefined || x.owner === f.who || x.author === f.who))
      .sort(byActivity);
    const offset = f.offset ?? 0, page = all.slice(offset, offset + INTROSPECT_PAGE);
    const threads: IntrospectThread[] = await pool(page, METRICS_READS, async x => {
      const s = await deps.store.getSummary(x.id);
      const row: IntrospectThread = { id: x.id, kind: x.kind ?? 'thread', title: x.title, owner: x.owner, state: x.state, updatedAt: x.updatedAt };
      for (const k of ['author', 'from', 'archived', 'outcome', 'usage'] as const) if (x[k] !== undefined) (row as any)[k] = x[k];
      if (s) row.summary = { status: s.status, decisions: s.decisions, next_steps: s.next_steps, waiting_on: s.waiting_on };
      return row;
    });
    while (threads.length > 1 && bytes(threads) > INTROSPECT_MAX_BYTES) threads.pop();
    const next = offset + threads.length, more = next < all.length;
    await ok({ space: space.id, threads, more, ...(more ? { offset: next } : {}) });
    return;
  }
  if (f.type === 'thread.read') {
    need(id(f.target) && (f.before === undefined || id(f.before)));
    const target = await deps.store.getThread(f.target);
    // The target's own space goes through the same gate (another space: served by the agent, the human a member).
    const space = await readableSpace(deps, inst, cur, as, target?.space ?? cur.space);
    need(!!target && !target.memoryReview && !target.titleFor, 'not_found');
    const raw = await deps.store.lastMessages(target!.id, INTROSPECT_MESSAGES, f.before);
    const messages = raw.filter(m => !m.gh?.held).map(introspectMessage);
    const first = f.before === undefined;
    const events = first ? threadDetails(target!.id, await deps.store.threadDetails(target!.id), null).events : [];
    const read: IntrospectRead = { thread: publicThread(target!), summary: first ? await deps.store.getSummary(target!.id) : null, messages, events,
      more: raw.length === INTROSPECT_MESSAGES, names: {} };
    // Oldest messages dropped first, then the oldest events: the newest part of the story is what the agent asked for.
    while (bytes(read) > INTROSPECT_MAX_BYTES && (read.messages.length > 1 || read.events.length)) {
      if (read.events.length > read.messages.length) read.events.shift(); else { read.messages.shift(); read.more = true; }
    }
    const who = new Set(read.messages.filter(m => m.author.kind === 'human').map(m => m.author.id));
    read.names = Object.fromEntries([...who].filter(x => space.names?.[x]).map(x => [x, space.names![x]]));
    await ok({ space: space.id, read });
    return;
  }
  // space.metrics: what the Metrics and Flow views compute for a member.
  need((f.view === 'metrics' && METRICS_PERIODS.includes(f.period)) || (f.view === 'lineage' && LINEAGE_PERIODS.includes(f.period)));
  need(f.tz === undefined || (typeof f.tz === 'string' && f.tz.length <= 64));
  const space = await readableSpace(deps, inst, cur, as, f.space);
  const out = f.view === 'metrics' ? { metrics: await metricsOf(deps, space, f.period, f.tz) } : { lineage: await lineageOf(deps, space, f.period) };
  need(bytes(out) <= INTROSPECT_MAX_BYTES, 'too_big');
  await ok({ space: space.id, ...out });
}
