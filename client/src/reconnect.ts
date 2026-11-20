/** Hub connection retries (client/src/main.ts `connect()`). Every failure schedules the next attempt with the same backoff:
 *  a lost WebSocket (`failed()` from `onclose`) as well as `open()` itself rejecting, typically the Cognito token refresh
 *  thrown offline when the Mac wakes up with a token near its expiry; that one has no WebSocket, hence no `onclose`, and used
 *  to leave the app on « Reconnecting… » for good. `now()` skips the wait (back online, tab shown again, banner clicked). */
export const BACKOFF = [500, 1000, 2000, 5000, 10000, 30000];

export interface Timers { set(fn: () => void, ms: number): number; clear(id: number): void }

export interface Reconnector {
  /** First attempt (app start), or another one right away. */
  start(): Promise<void>;
  /** The connection was lost: next attempt after the backoff. */
  failed(): void;
  /** The connection opened: the backoff starts again from its first step. */
  opened(): void;
  /** Waiting out the backoff: attempt now. Returns false when there is nothing to skip (connected, or an attempt running). */
  now(): boolean;
  /** An attempt is scheduled (the backoff is running). */
  waiting(): boolean;
}

export function reconnector(open: () => Promise<void>, onError: (e: unknown) => void, timers: Timers): Reconnector {
  let step = 0, pending: number | undefined, busy = false;
  async function run() {
    pending = undefined; busy = true;
    try { await open(); }
    catch (e) { busy = false; onError(e); failed(); return; }
    busy = false;
  }
  function failed() {
    if (pending !== undefined || busy) return; // one attempt at a time
    pending = timers.set(() => { void run(); }, BACKOFF[Math.min(step++, BACKOFF.length - 1)]);
  }
  return {
    start: run,
    failed,
    opened: () => { step = 0; },
    now() {
      if (pending === undefined) return false;
      timers.clear(pending); void run(); return true;
    },
    waiting: () => pending !== undefined,
  };
}
