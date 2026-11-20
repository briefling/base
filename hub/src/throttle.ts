// API Gateway throttling of PostToConnection (429): a few retries with a growing, bounded wait, then a log line.

/** The names AWS gives a 429 on the management API. */
export const THROTTLED = new Set(['TooManyRequestsException', 'LimitExceededException']);
/** Waits between tries: at most ~1 s per frame and connection (+ up to 50 % jitter), well under the 10 s Lambda timeout. */
export const RETRY_WAITS_MS = [100, 200, 400];

const pause = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Runs `post`, retrying while it is throttled; after the last try, logs `send_throttled <label>` and throws the 429. */
export async function retryThrottled<T>(post: () => Promise<T>, label: string, sleep: (ms: number) => Promise<void> = pause): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await post(); }
    catch (e) {
      if (!THROTTLED.has((e as { name?: string })?.name ?? '')) throw e;
      if (i >= RETRY_WAITS_MS.length) { console.error('send_throttled', label); throw e; }
      await sleep(RETRY_WAITS_MS[i] * (1 + Math.random() / 2));
    }
  }
}

const NAME = /^[a-z][a-z0-9._]{0,39}$/i;
/** A short, log-safe label of a frame: its type (`event:<name>` for events), `?` when absent or odd. */
export function frameKind(f: unknown): string {
  const o = f as { type?: unknown; event?: unknown } | null;
  if (!o || typeof o !== 'object' || typeof o.type !== 'string' || !NAME.test(o.type)) return '?';
  return o.type === 'event' && typeof o.event === 'string' && NAME.test(o.event) ? `event:${o.event}` : o.type;
}

/** Same label from a raw client body (never logs the body itself). */
export function bodyKind(body: string): string {
  try { return frameKind(JSON.parse(body)); } catch { return '?'; }
}
