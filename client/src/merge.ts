// Merge button of an issue thread (board-driven space, issue in the flow's `approved` column, « To merge » by default). Display only: the hub and the GitHub
// Lambda check everything again (trust, column, the issue's only open PR, its mergeability, its head sha).
import { MERGE_COLUMN, type MergeInfo, type PublicThread } from '../../protocol/frames.ts';
import { canEditLabels } from './labels.ts';

/** A trusted human, in an issue thread whose issue is OPEN in the merge column (`synced.mergeColumn`, else MERGE_COLUMN). */
export function canMerge(f: Pick<PublicThread, 'kind' | 'issue' | 'board'>, boardDriven: boolean, trusted: boolean, column: string = MERGE_COLUMN): boolean {
  return canEditLabels(f, boardDriven, trusted) && f.board!.state === 'OPEN' && (f.board!.column ?? '').toLowerCase() === column.toLowerCase();
}

/** What the client knows about one thread's merge: asked (`cid`) for the board state `sig`, answer or error, click state. */
export interface MergeEntry { cid: string; sig: string; info: MergeInfo | null; err: string; busy: boolean; confirm: boolean }

/** Ask GitHub again: never asked, or the board moved since (the poller saw a change on the issue or its PR). */
export const mergeStale = (e: MergeEntry | undefined, sig: string) => !e || e.sig !== sig;

/**
 * What the header shows: nothing (no PR, several PRs: the button exists only for exactly one), « checking », a reason
 * (disabled), or the button. `retry`: the state may change by itself (GitHub computing, read failure): offer to ask again.
 */
export type MergeView = { kind: 'none' } | { kind: 'checking' } | { kind: 'error'; err: string }
  | { kind: 'ready' | 'blocked'; pr: NonNullable<MergeInfo['pr']>; blocked: MergeInfo['blocked']; retry: boolean };
export function mergeView(e: MergeEntry | undefined): MergeView {
  if (!e || (!e.info && !e.err)) return { kind: 'checking' };
  if (e.err) return { kind: 'error', err: e.err };
  const { pr, blocked } = e.info!;
  if (!pr) return { kind: 'none' };
  return blocked ? { kind: 'blocked', pr, blocked, retry: blocked === 'unknown' || blocked === 'checks' } : { kind: 'ready', pr, blocked: null, retry: false };
}
