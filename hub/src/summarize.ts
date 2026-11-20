// Living summary: called by the SQS queue (60 s delay) after every agent turn end.
import type { ThreadSummary } from '../../protocol/frames.ts';
import { broadcast, type Store, type Sender } from './router.ts';
import { SUMMARY_SYSTEM, summaryPrompt, parseSummary, type SummaryMessage } from './summary.ts';

export interface Llm { (system: string, user: string): Promise<string> }
export interface SummarizeDeps { store: Store; sender: Sender; llm: Llm }

const MAX_MESSAGES = 40;

export async function summarize(deps: SummarizeDeps, threadId: string, at: number): Promise<'done' | 'stale' | 'invalid' | 'gone'> {
  const thread = await deps.store.getThread(threadId);
  if (!thread || thread.kind === 'topic') return 'gone'; // no summary for Lounge topics
  // A more recent turn ended since: its own job (60 s later) will make the summary.
  if (thread.lastTurnAt > at) return 'stale';
  const prev = await deps.store.getSummary(threadId);
  if (prev && prev.at >= at) return 'stale';
  const space = await deps.store.getSpace(thread.space);
  const name = (id: string) => space?.names?.[id] ?? 'Member';
  const msgs: SummaryMessage[] = (await deps.store.lastMessages(threadId, MAX_MESSAGES)).filter(m => !m.deleted).map(m => ({
    who: m.author.kind === 'agent' ? m.author.id[0].toUpperCase() + m.author.id.slice(1) : m.author.kind === 'human' ? name(m.author.id) : 'briefling',
    kind: m.author.kind, text: m.text,
  }));
  const parsed = parseSummary(await deps.llm(SUMMARY_SYSTEM, summaryPrompt(thread.title, msgs, prev)));
  if (!parsed) return 'invalid';
  const s: ThreadSummary = { thread: threadId, at, ...parsed };
  if (!(await deps.store.putSummary(s))) return 'stale';
  await broadcast(deps, thread.space, { v: 2, type: 'event', event: 'summary.updated', data: s });
  return 'done';
}
