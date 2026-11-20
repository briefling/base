// Lines « Next » of a summary (hub/src/nextsteps.ts): who each line is for, and the thread a lead opened from it.
// Pure: DOM-free, tested in client/test/nextsteps.test.ts. The view is client/src/nextstepsview.ts. Who a line is for
// is shared with the hub's pending leads (protocol/leads.ts).
import type { PublicThread } from '../../protocol/frames.ts';
export { stepKind, type StepKind } from '../../protocol/leads.ts';

/** The thread a lead opened from this line (`nextOpened`, keyed by the line's text), if any. */
export const openedFrom = (f: Pick<PublicThread, 'nextOpened'>, what: string): string | undefined => f.nextOpened?.find(n => n.what === what)?.thread;
