// Agent web preview, app side (DOM-free helpers; the overlay itself is in main.ts). Architecture and gates:
// protocol/preview.ts; postMessage contract with the viewer page: client/preview/bridge.ts.
import { isPreviewError, type PreviewLine } from '../../protocol/preview.ts';
import { VIEWER_ERRORS } from '../preview/bridge.ts';
import type { Key, Params } from './i18n.ts';

/** `previewUrl` of the app's /config.json: an http(s) URL, kept without trailing slash; anything else = feature off. */
export function previewBase(x: unknown): string | null {
  if (typeof x !== 'string' || !x) return null;
  try {
    const u = new URL(x);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return `${u.origin}${u.pathname}`.replace(/\/+$/, '');
  } catch { return null; }
}
export const previewOrigin = (base: string) => new URL(base).origin;

/** Overlay header state. `open`: ms from the click to the data channel; `shown`: to the previewed page's load. */
export type PreviewState =
  | { k: 'connecting' }
  | { k: 'connected'; open: number }
  | { k: 'shown'; open: number; shown: number }
  | { k: 'failed'; code: string }
  | { k: 'closed' };

type T = (k: Key, p?: Params) => string;
const secs = (ms: number, lang: string) => new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(ms / 1000);

/** Reason of a failure in plain words: hub codes (PREVIEW_ERRORS, forbidden), viewer codes, else the raw code. */
export function previewReason(code: string, t: T): string {
  if (isPreviewError(code) || code === 'forbidden' || (VIEWER_ERRORS as readonly string[]).includes(code)) return t(`preview_err_${code}` as Key);
  return t('preview_err_code', { code });
}

export function previewStateText(s: PreviewState, t: T, lang: string): string {
  if (s.k === 'connecting') return t('preview_connecting');
  if (s.k === 'connected') return t('preview_connected', { s: secs(s.open, lang) });
  if (s.k === 'shown') return t('preview_shown', { s: secs(s.shown, lang), c: secs(s.open, lang) });
  if (s.k === 'failed') return t('preview_failed', { reason: previewReason(s.code, t) });
  return t('preview_closed');
}

/** Message a trusted member posts in the thread to get a stopped share back. A turn of the agent, never a silent
 *  restart: its server usually died with it (gateway restarted, sandbox stopped). */
export function previewReshareText(p: PreviewLine, t: T): string {
  return p.device !== undefined ? t('preview_reshare_screen', { agent: p.agent, label: p.label, device: p.device })
    : t('preview_reshare', { agent: p.agent, label: p.label, port: p.port ?? 0 });
}

/** Next state on a viewer event (`now` = ms since the click). A failure or a close is final. */
export function previewStep(s: PreviewState, ev: 'open' | 'loaded' | 'closed' | { failed: string }, now: number): PreviewState {
  if (s.k === 'failed' || s.k === 'closed') return s;
  if (typeof ev === 'object') return { k: 'failed', code: ev.failed };
  if (ev === 'open') return s.k === 'connecting' ? { k: 'connected', open: now } : s;
  if (ev === 'loaded') return s.k === 'connected' ? { k: 'shown', open: s.open, shown: now } : s; // an inner reload keeps the first time
  return { k: 'closed' };
}

/** The voice channel an agent shares in a conversation, if any: its latest voice line still on. The composer's voice
 *  button opens it (a lead only, like the card's « Start voice »); the card stays the way to open it by hand. */
/** What the composer's « Voice » button does (a lead only): open the voice line on; else, when the agent the request
 *  is for (voiceAgent) announces voice (`talks`: connected, its gateway runs a voice daemon), ask it to open one
 *  (`post{voice}`); else no button. Threads and Lounge topics alike (not General: no agent turn there). */
export function voiceAction<M extends { preview?: PreviewLine; deleted?: unknown }>(msgs: Iterable<M>, lead: boolean, talks: boolean): { line: M } | 'ask' | null {
  if (!lead) return null;
  const line = voiceLineOf(msgs);
  if (line) return { line };
  return talks ? 'ask' : null;
}

/** The agent a voice request is for, same rule as the hub (hub/src/router.ts voiceAgent): in a topic the last agent
 *  that spoke there, else its owner; in a thread the agent in charge. */
export function voiceAgent(msgs: Iterable<{ author: { kind: string; id: string } }>, owner: string, topic: boolean): string {
  if (!topic) return owner;
  let agent = owner;
  for (const m of msgs) if (m.author.kind === 'agent') agent = m.author.id;
  return agent;
}

/** Voice resume (protocol/preview.ts « Voice on request »): the agent's gateway restarted or the network dropped.
 *  One resume per cut, within VOICE_RESUME_MS of it: `reopen` = the same voice line again once the agent is back (its
 *  peer may still run), `ask` = a new voice request (the share died with the gateway: `gone`), which costs one short
 *  turn of the agent. Codes: `lost` = the open channel dropped, `timeout` = no preview.ready in time, `not_connected` /
 *  `no_voice` = the agent is not back yet (tried again in the same stage until the deadline, `not_connected` alone is
 *  also what the page reports when that deadline passes), `gone` / `not_shared` = the share is dead. Once the agent
 *  was asked, only a refused ask (the agent not back: no turn spent) is tried again, so a cut costs one turn at most.
 *  Anything else (the mic, a refusal, the ask not answered) ends with the error. */
export const VOICE_RESUME_MS = 60_000;
export type VoiceResume = { stage: 'reopen' | 'ask'; until: number };
const RESUME_WAIT = ['lost', 'timeout', 'not_connected', 'no_voice'], RESUME_DEAD = ['gone', 'not_shared'];
export function voiceResumeStep(code: string, r: VoiceResume | null, now: number): VoiceResume | 'offline' | null {
  const wait = RESUME_WAIT.includes(code), dead = RESUME_DEAD.includes(code);
  if (!r) return wait ? { stage: 'reopen', until: now + VOICE_RESUME_MS } : dead ? { stage: 'ask', until: now + VOICE_RESUME_MS } : null;
  if (!wait && !dead) return null;
  if (r.stage === 'ask' && code !== 'not_connected' && code !== 'no_voice') return null; // the ask was taken: one turn at most
  if (now > r.until) return 'offline';
  return dead ? { stage: 'ask', until: r.until } : r;
}

export function voiceLineOf<M extends { preview?: PreviewLine; deleted?: unknown }>(msgs: Iterable<M>): M | null {
  let line: M | null = null;
  for (const m of msgs) if (m.preview?.voice && !m.deleted) line = m.preview.status === 'on' ? m : null;
  return line;
}
