// Web Push (tab closed, phone): who gets a push when a thread becomes Your turn or a human writes, and what it says.
// Who: protocol/notify.ts (Your turn = the humans concerned by the thread; a message = the list computed at post).
// Pure logic (injected store and sender), tested in hub/test/push.test.ts; the AWS side is handlers/push.ts.
// Same rule as the open-tab alert (client/src/notify.ts): a thread (not a Lounge topic), not archived, that BECOMES
// Your turn. Text: a plain excerpt of what the agent asks (its `waiting` action, else its last message) or of the new
// message, read at send time. Never the text of a message by an untrusted author (set aside: the agent never acts on
// it) nor of a memory review thread. The payload is end-to-end encrypted (RFC 8291); hiding it on the lock screen is
// the phone's own preview setting.
import { createHash } from 'node:crypto';
import type { Outcome, PushPayload, PushSub, Thread } from '../../protocol/frames.ts';
import { translate } from '../../client/src/i18n.ts';
import type { Store } from './router.ts';
import { isMemoryReviewer } from '../../protocol/memory.ts';
import { isMyTurn, yourTurnTo } from '../../protocol/notify.ts';
import { canSee } from './router.ts';
import { strongSeverity, type Signal } from '../../protocol/radar.ts';
import type { ReminderPushJob } from './reminders.ts';
import { pushModule } from './modules.ts';

export interface StoredPush extends PushSub { id: string; lang: 'en' | 'fr'; at: number }
/** Queued by the Message Lambda on the transition (thread id + the version that became Your turn), or for a human's new
 *  message (`to` = its recipients, `by` = its author: no state to re-check, the message stays posted). */
export interface ThreadPushJob { thread: string; version: number; to?: string[]; by?: string; /** The new message (its excerpt, read at send time). */ msg?: string; /** `by` is an agent (topic it opened on its own): its id, capitalised, is its name. */ byAgent?: true }
/** Memory reminder (every MEMORY_NUDGE_EVERY entries waiting for a human): to the space's reviewers. */
export interface MemoryPushJob { memory: string }
/** A new strong Radar signal (protocol/radar.ts): to the space's members, re-read at send time. */
export interface RadarPushJob { signal: string; space: string }
export type PushJob = ThreadPushJob | MemoryPushJob | RadarPushJob | ReminderPushJob;

// Push services of the browsers we serve (Chrome/Edge/Android = FCM, Firefox = autopush, Safari = Apple, legacy Edge =
// WNS). The Push Lambda POSTs to the endpoint: anything else is refused at subscribe, so a member can't make the hub
// call an address of their choice (SSRF).
const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'push.services.mozilla.com'];
const PUSH_SUFFIXES = ['.push.services.mozilla.com', '.push.apple.com', '.notify.windows.com'];
const MAX_ENDPOINT = 1024;
export function pushEndpointOk(x: unknown): x is string {
  if (typeof x !== 'string' || x.length > MAX_ENDPOINT) return false;
  let u: URL;
  try { u = new URL(x) } catch { return false }
  if (u.protocol !== 'https:' || u.port !== '' || u.username || u.password) return false;
  return PUSH_HOSTS.includes(u.hostname) || PUSH_SUFFIXES.some(s => u.hostname.endsWith(s));
}
const B64URL_RE = /^[A-Za-z0-9_-]+={0,2}$/;
const b64len = (s: unknown, max: number) => typeof s === 'string' && s.length <= max && B64URL_RE.test(s) ? Buffer.from(s, 'base64url').length : -1;
/** Browser subscription (PushSubscription.toJSON()): P-256 public key (65 bytes, uncompressed) and 16-byte auth secret. */
export function validPushSub(x: any): x is PushSub {
  return !!x && typeof x === 'object' && pushEndpointOk(x.endpoint) && !!x.keys && typeof x.keys === 'object'
    && b64len(x.keys.p256dh, 100) === 65 && Buffer.from(x.keys.p256dh, 'base64url')[0] === 4 && b64len(x.keys.auth, 32) === 16;
}
const hash = (s: string, n: number) => createHash('sha256').update(s).digest('base64url').slice(0, n);
/** One record per device: the endpoint identifies it (re-subscribing the same device overwrites its record). */
export const pushId = (endpoint: string) => hash(endpoint, 22);
/** RFC 8030 Topic (32 base64url chars max): a pending push of the same thread is replaced, not stacked. */
export const pushTopic = (thread: string) => hash(thread, 32);

type Yours = Pick<Thread, 'kind' | 'archived' | 'state'>;
export const yours = (f: Yours) => f.kind !== 'topic' && !f.archived && f.state === 'you';
/** The thread just became Your turn (an existing thread only, like `becameYours` in client/src/notify.ts). */
export const becameYours = (before: Yours | null, after: Yours) => !!before && !yours(before) && yours(after);

/** Notification text cap (code points): about two lines on a lock screen. */
export const PUSH_EXCERPT_MAX = 140;
/** Cap of the notification title, below the service worker's 200 (client/src/push.ts `notificationOf`). */
const PUSH_TITLE_MAX = 120;
const cut = (s: string, max: number) => { const cps = [...s]; return cps.length > max ? cps.slice(0, max - 1).join('').trimEnd() + '…' : s };

/**
 * Message text -> one line of plain text for a notification: Markdown marks dropped (fences, headings, quotes, list
 * markers, emphasis, inline code, link and image targets), control and bidi-override characters removed, whitespace
 * collapsed, cut at a word boundary (by code point, never inside an emoji) with « … ». '' = nothing readable left.
 * Display only (the OS shows it as text, never as HTML): a lossy strip, not a Markdown parser.
 */
export function pushExcerpt(text: string, max = PUSH_EXCERPT_MAX): string {
  const s = text
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g, ' ')
    .replace(/^[ \t]*(```|~~~).*$/gm, '')                       // code fences (their content stays)
    .replace(/^[ \t]*([-*_][ \t]*){3,}$/gm, '')                  // horizontal rules
    .replace(/^[ \t]*\|?([ \t]*:?-+:?[ \t]*\|)+([ \t]*:?-+:?[ \t]*)?$/gm, '') // table separator rows
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')                    // headings
    .replace(/^[ \t]*(>[ \t]?)+/gm, '')                          // quotes
    .replace(/^[ \t]*([-*+]|\d{1,3}[.)])[ \t]+(\[[ xX]\][ \t]+)?/gm, '') // list markers, task boxes
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')                    // image -> its alt text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')                     // link -> its text
    .replace(/<(https?:\/\/[^>\s]+)>/g, '$1')                      // autolink
    .replace(/`+([^`]*?)`+/g, '$1')                              // inline code
    .replace(/(\*\*|__|~~)(?=\S)(.+?)(?<=\S)\1/g, '$2')          // bold, strikethrough
    .replace(/(^|[^\w*])\*(?=\S)(.+?)(?<=\S)\*(?![\w*])/g, '$1$2') // *italic*
    .replace(/(^|[^\w])_(?=\S)(.+?)(?<=\S)_(?!\w)/g, '$1$2')      // _italic_ (never snake_case)
    .replace(/[ \t]*\|[ \t]*/g, ' ')                               // table cells
    .replace(/\s+/g, ' ').trim();
  const cps = [...s];
  if (cps.length <= max) return s;
  const head = cps.slice(0, max - 1).join('');
  const sp = head.lastIndexOf(' ');
  return (sp >= max * 0.6 ? head.slice(0, sp) : head).replace(/[\s,;:.\-–—]+$/, '') + '…';
}

/**
 * `by`: display name of a new message's author, none = Your turn. `excerpt` ('' = none: untrusted author, no text):
 * message = title « <name> · <thread> », body = the excerpt; Your turn = body « Your turn: <excerpt> · <space> ».
 * Without an excerpt, the short forms « <name> wrote · <space> » / « Your turn · <space> » under the thread title.
 * `msg`: id of the message it is about (the click jumps to it), none = the thread opens as usual.
 * `approve`: Your turn on a command approval: « To approve: <command> · <space> » instead.
 */
export const pushPayload = (thread: Pick<Thread, 'id' | 'space' | 'title'>, spaceName: string, lang: 'en' | 'fr', by?: string, badge?: number, excerpt = '', msg?: string, approve = false): PushPayload =>
  ({ title: by !== undefined && excerpt ? cut(`${by} · ${thread.title}`, PUSH_TITLE_MAX) : cut(thread.title, PUSH_TITLE_MAX),
    body: by === undefined ? (excerpt ? translate(lang, approve ? 'notif_approve_body' : 'notif_turn_body', { what: excerpt, space: spaceName }) : translate(lang, approve ? 'notif_approve_short' : 'notif_body', { space: spaceName }))
      : excerpt || translate(lang, 'notif_msg_body', { name: by, space: spaceName }),
    thread: thread.id, space: thread.space, ...(msg ? { msg } : {}), ...(badge === undefined ? {} : { badge }) });

/**
 * The command of an approval card (hermes-plugin approval_question: « Command to approve: » then a fenced block), as
 * a notification line; the card's whole text when it has no fence.
 */
export function approvalCommand(text: string): string {
  const m = /^(`{3,})[^\n]*\n([\s\S]*?)\n\1[ \t]*$/m.exec(text);
  return m ? pushExcerpt(m[2].replace(/`/g, '')) : pushExcerpt(text);
}

/** Messages read back to find the agent's last answer (Your turn without a `waiting` action). */
const LAST_READ = 20;
/**
 * Excerpt of a push, read at send time. Message: its own text, only when its author is trusted (a lead) or an agent:
 * an untrusted member's message is set aside (the agent never acts on it), so it is never shown. Your turn: the
 * agent's `waiting` action, else its last answer. '' = none (failed read included: the short form still goes out).
 * `msg`: the message the click jumps to: the new message itself (even when its text is not shown), the agent's last
 * answer for Your turn; none when unknown (the thread then opens as usual).
 */
async function excerptOf(store: PushDeps['store'], thread: StoredThreadLike, trusted: readonly string[], job: ThreadPushJob): Promise<{ text: string; msg?: string }> {
  const msg = job.to !== undefined ? job.msg : undefined;
  try {
    if (job.to !== undefined) {
      if (!job.msg) return { text: '' };
      const m = await store.getMessage(thread.id, job.msg);
      return { text: m && (m.author.kind === 'agent' || (m.author.kind === 'human' && trusted.includes(m.author.id))) ? pushExcerpt(m.text) : '', ...(m ? { msg: m.id } : {}) };
    }
    const ask = thread.facts?.pendingApproval ? thread.facts.pendingAsk : null;
    if (ask) { // an open approval: its command, the click jumps to the card
      const m = await store.getMessage(thread.id, ask);
      if (m) return { text: approvalCommand(m.text), msg: m.id };
    }
    const o = thread.facts?.outcome;
    const last = (await store.lastMessages(thread.id, LAST_READ)).filter(m => m.author.kind === 'agent' && (m.type === 'text' || m.type === 'ask')).at(-1);
    const text = o?.kind === 'waiting' && o.action ? pushExcerpt(o.action) : last ? pushExcerpt(last.text) : '';
    return { text, ...(last ? { msg: last.id } : {}) };
  } catch (e) { console.error('push_excerpt_failed', (e as Error)?.name); return { text: '', ...(msg ? { msg } : {}) } }
}
type StoredThreadLike = Pick<Thread, 'id'> & { facts?: { outcome?: Outcome | null; pendingAsk?: string | null; pendingApproval?: boolean } };

/** Memory reminder: the count waiting now (never an entry's text: lock screen), opens the space's Memory view. */
export const memoryPushPayload = (space: string, spaceName: string, n: number, lang: 'en' | 'fr', badge?: number): PushPayload =>
  ({ title: translate(lang, 'notif_mem_title'), body: translate(lang, new Intl.PluralRules(lang).select(n) === 'one' ? 'notif_mem_body_one' : 'notif_mem_body_other', { n, space: spaceName }), space, view: 'memory',
    ...(badge === undefined ? {} : { badge }) });

/** Answer of the push service: HTTP status (201 = accepted). */
export type PushSend = (sub: StoredPush, payload: string, topic: string) => Promise<number>;
export interface PushDeps { store: Pick<Store, 'getThread' | 'getSpace' | 'listPushes' | 'deletePush' | 'listSpaces' | 'activeThreads' | 'getMessage' | 'lastMessages' | 'getSignal' | 'getItem' | 'mutedIn' | 'mutesOf'>; send: PushSend }

/**
 * App icon badge of each recipient: their Your turn total over every space they see, read at send time (`isMyTurn`,
 * the client's rule, their mutes included). One `activeThreads` per space, shared by the recipients of the job (measured Nov 1 on the live
 * table: 0.5-20 RCU and ~25 ms per space, run in parallel). A failed read = no badge (the push still goes out).
 */
export function badgeCounter(store: PushDeps['store']): (member: string) => Promise<number | undefined> {
  let spaces: Promise<Awaited<ReturnType<Store['listSpaces']>>> | null = null;
  const active = new Map<string, ReturnType<Store['activeThreads']>>();
  return async member => {
    try {
      spaces ??= store.listSpaces();
      const mine = (await spaces).filter(s => canSee(s, member));
      const muted = new Set((await store.mutesOf(member, mine.map(s => s.id))).filter(m => m.on).map(m => m.space)); // one batch get
      const per = await Promise.all(mine.map(async s => {
        if (!active.has(s.id)) active.set(s.id, store.activeThreads(s.id));
        return (await active.get(s.id)!).filter(f => isMyTurn(f, member, s.members, muted.has(s.id))).length;
      }));
      return per.reduce((a, b) => a + b, 0);
    } catch (e) { console.error('badge_failed', member, e); return undefined }
  };
}

/**
 * Sends the push of a job to every device of its recipients (still members): Your turn = the humans concerned by the
 * thread (`yourTurnTo`), skipped when it is no longer Your turn (answered in the meantime); a message = `job.to`, skipped
 * on an archived thread. Skipped too when the space is archived. 404/410 = the device unsubscribed: its record is deleted.
 * Never throws for one device (a failure elsewhere must not stop the others nor trigger an SQS retry = duplicates).
 */
export async function sendPushes(deps: PushDeps, job: PushJob): Promise<{ sent: number; gone: number; failed: number; skipped?: string }> {
  const out = { sent: 0, gone: 0, failed: 0 };
  if ('memory' in job) return sendMemoryPushes(deps, job.memory);
  if ('signal' in job) return sendRadarPushes(deps, job.space, job.signal);
  const mod = pushModule(job);
  if (mod) return mod.push!.send(deps, job);
  if (!('thread' in job)) return { ...out, skipped: 'unknown' };
  const thread = await deps.store.getThread(job.thread);
  const message = job.to !== undefined;
  if (!thread || (message ? thread.archived || thread.memoryReview : !yours(thread))) return { ...out, skipped: message ? 'archived' : 'not_yours' };
  const space = await deps.store.getSpace(thread.space);
  if (!space || space.archived) return { ...out, skipped: 'no_space' };
  const topic = pushTopic(thread.id);
  // Your turn with nobody known: every member but those who muted the space (the mutes are read only in that case).
  const fallback = !message && !thread.people?.some(p => space.members.includes(p));
  const to = message ? job.to!.filter(p => space.members.includes(p)) : yourTurnTo(thread.people, space.members, fallback ? new Set(await deps.store.mutedIn(space.id)) : undefined);
  const by = !message ? undefined : job.byAgent && job.by ? job.by[0].toUpperCase() + job.by.slice(1) : space.names?.[job.by ?? ''] ?? (job.by ?? '').slice(0, 6);
  const { text: excerpt, msg } = await excerptOf(deps.store, thread, space.trusted, job);
  const badgeOf = badgeCounter(deps.store);
  for (const member of new Set(to)) {
    const subs = await deps.store.listPushes(member);
    const badge = subs.length ? await badgeOf(member) : undefined; // no device: no read
    for (const sub of subs) {
      // Background work lost (hub/src/background.ts): said as such, the goals after it.
      const what = !message && thread.facts?.outcome?.lost ? pushExcerpt(translate(sub.lang, 'notif_bg_lost', { what: excerpt })) : excerpt;
      const payload = JSON.stringify(pushPayload(thread, space.name ?? space.id, sub.lang, by, badge, what, msg, !message && !!thread.facts?.pendingAsk && !!thread.facts.pendingApproval));
      let status = 0;
      try { status = await deps.send(sub, payload, topic) } catch { status = 0 }
      if (status >= 200 && status < 300) out.sent++;
      else if (status === 404 || status === 410) { out.gone++; await deps.store.deletePush(member, sub.id); }
      else out.failed++;
    }
  }
  return out;
}

/** Radar: « <severity> · <space> » over the signal's title; opens the space's Radar view, one per signal. */
export const radarPushPayload = (space: string, spaceName: string, s: Pick<Signal, 'severity' | 'title'>, lang: 'en' | 'fr', badge?: number): PushPayload =>
  ({ title: cut(translate(lang, 'notif_radar_title', { severity: translate(lang, `rd_sev_${s.severity}`), space: spaceName }), PUSH_TITLE_MAX),
    body: pushExcerpt(s.title) || translate(lang, 'radar'), space, view: 'radar', ...(badge === undefined ? {} : { badge }) });

/** Radar push to every device of the space's members, skipped once the signal is no longer new and strong (sorted
 *  between the queueing and the send). Same per-device handling as sendPushes. */
async function sendRadarPushes(deps: PushDeps, spaceId: string, id: string) {
  const out = { sent: 0, gone: 0, failed: 0 };
  const space = await deps.store.getSpace(spaceId);
  if (!space || space.archived) return { ...out, skipped: 'no_space' };
  const s = await deps.store.getSignal(space.id, id);
  if (!s || s.state !== 'new' || !strongSeverity(s.severity)) return { ...out, skipped: 'not_strong' };
  const topic = pushTopic(`radar:${space.id}:${s.id}`);
  const badgeOf = badgeCounter(deps.store);
  for (const member of new Set(space.members)) {
    const subs = await deps.store.listPushes(member);
    const badge = subs.length ? await badgeOf(member) : undefined;
    for (const sub of subs) {
      let status = 0;
      try { status = await deps.send(sub, JSON.stringify(radarPushPayload(space.id, space.name ?? space.id, s, sub.lang, badge)), topic) } catch { status = 0 }
      if (status >= 200 && status < 300) out.sent++;
      else if (status === 404 || status === 410) { out.gone++; await deps.store.deletePush(member, sub.id); }
      else out.failed++;
    }
  }
  return out;
}

/** Memory reminder to every device of the space's reviewers, with the count read now (skipped once nothing waits: all
 *  decided between the queueing and the send). Same per-device handling as sendPushes. */
async function sendMemoryPushes(deps: PushDeps, spaceId: string) {
  const out = { sent: 0, gone: 0, failed: 0 };
  const space = await deps.store.getSpace(spaceId);
  if (!space || space.archived) return { ...out, skipped: 'no_space' };
  const n = space.memPending ?? 0;
  if (n <= 0) return { ...out, skipped: 'none_waiting' };
  const topic = pushTopic(`memory:${space.id}`); // a newer reminder replaces a pending one
  const badgeOf = badgeCounter(deps.store);
  for (const member of space.members.filter(m => isMemoryReviewer(space, m))) {
    const subs = await deps.store.listPushes(member);
    const badge = subs.length ? await badgeOf(member) : undefined;
    for (const sub of subs) {
      let status = 0;
      try { status = await deps.send(sub, JSON.stringify(memoryPushPayload(space.id, space.name ?? space.id, n, sub.lang, badge)), topic) } catch { status = 0 }
      if (status >= 200 && status < 300) out.sent++;
      else if (status === 404 || status === 410) { out.gone++; await deps.store.deletePush(member, sub.id); }
      else out.failed++;
    }
  }
  return out;
}
