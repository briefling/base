/**
 * Messages no connection of the agent received (hub event `message.undelivered`, ephemeral): one notice per thread,
 * under that message, until the agent shows life in the thread (a turn starts, or it posts). Not replayed by the hub:
 * the person posts again once the agent is back.
 */
export interface Undelivered { message: string; agent: string }
export type UndeliveredMap = Map<string, Undelivered>;

export function noteUndelivered(m: UndeliveredMap, d: { thread: string; message: string; agent: string }) {
  m.set(d.thread, { message: d.message, agent: d.agent });
}
/** The agent is there after all: a turn runs in the thread (`thread.upserted` state run), or one of its messages arrived. */
export function agentActive(m: UndeliveredMap, thread: string, ev: { state: string } | { author: { kind: string } }) {
  if ('state' in ev ? ev.state === 'run' : ev.author.kind === 'agent') m.delete(thread);
}
/** Where to show the notice: under its message when loaded, otherwise at the end of the conversation (null = no notice). */
export function noticeAfter(m: UndeliveredMap, thread: string, ids: string[]): { agent: string; after: string | null } | null {
  const u = m.get(thread);
  return u ? { agent: u.agent, after: ids.includes(u.message) ? u.message : null } : null;
}
