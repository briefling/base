// Voice channel, DOM-free parts of the app side (the overlay is in main.ts, the WebRTC/audio session in
// ../preview/voice.ts): which sentences of the agent's streamed reply to speak, and the per-exchange timings.
// Streaming is not message.delta: the plugin edits its message, so the client gets message.created then
// message.updated events with the FULL text so far (growing rev). `nextSentences` is called with each full text and
// returns the sentences completed since the last call; the end of the agent's turn (thread state leaves 'run')
// flushes the last partial one.
import { VOICE_SAY_MAX } from '../../protocol/preview.ts';

/** Show-then-send: a transcript is posted this long after it is shown, unless the user cancels. Short on purpose: the
 *  daemon already waited for the end of the turn, and this delay adds up to every reply (1.5 s measured as ~30 % of
 *  it). */
export const VOICE_AUTOSEND_MS = 300;

const FENCE = /^[ \t]*(```|~~~)/;
const HAS_WORD = /[\p{L}\p{N}]/u;

/** Markdown of one sentence to plain speech: links and images keep their text, inline code its content, bare URLs,
 *  emphasis marks, heading/quote/list markers and table pipes go. */
export function speakable(s: string): string {
  return s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\bhttps?:\/\/\S+/g, '')
    .replace(/^[ \t]*(#{1,6}|>+|[-*+]|\d+[.)])[ \t]+/gm, '')
    .replace(/[*_~|]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/** Splits a long sentence at word boundaries, each piece at most `max` characters. */
function cap(s: string, max = VOICE_SAY_MAX): string[] {
  const out: string[] = [];
  while (s.length > max) {
    let k = s.lastIndexOf(' ', max);
    if (k <= 0) k = max;
    out.push(s.slice(0, k).trim()); s = s.slice(k).trim();
  }
  if (s) out.push(s);
  return out;
}

/** End of the next sentence in `text` from `from` (exclusive index after its last character), or -1. A sentence ends
 *  on `.!?…` followed by whitespace, or at a line break; « 1. » opening a numbered list item is not an end. */
function sentenceEnd(text: string, from: number, to: number): number {
  const re = /[.!?…]+(?=\s)|\n/g;
  re.lastIndex = from;
  for (let m = re.exec(text); m && m.index < to; m = re.exec(text)) {
    const end = m.index + m[0].length;
    if (m[0] !== '\n') {
      const lineStart = text.lastIndexOf('\n', m.index - 1) + 1;
      if (/^[ \t]*\d+$/.test(text.slice(lineStart, m.index))) continue;
    }
    return end;
  }
  return -1;
}

/** Sentences of `text` completed after `spokenLen` (an index in the raw text), and the new index. `final`: the text
 *  will not grow any more (flush the partial last sentence). Code fences are skipped entirely (an unclosed fence
 *  waits for its end, or is dropped when final). A rewrite that shortens what was already spoken says nothing:
 *  only text past `spokenLen` is ever spoken. */
export function nextSentences(spokenLen: number, text: string, final: boolean): { say: string[]; spokenLen: number } {
  const say: string[] = [];
  let pos = Math.max(0, spokenLen);
  const push = (raw: string) => { const s = speakable(raw); if (HAS_WORD.test(s)) say.push(...cap(s)); };
  while (pos < text.length) {
    const lineStart = text.lastIndexOf('\n', pos - 1) + 1, nl = text.indexOf('\n', pos);
    // A fence opening on this line (only blanks before pos on it): skip to the line after its closing fence
    if (!text.slice(lineStart, pos).trim() && FENCE.test(text.slice(pos, nl < 0 ? text.length : nl))) {
      const close = nl < 0 ? -1 : text.slice(nl + 1).search(/^[ \t]*(```|~~~)/m);
      if (close < 0) { if (final) pos = text.length; break; } // still open: wait for its end (dropped when final)
      const closeNl = text.indexOf('\n', nl + 1 + close);
      pos = closeNl < 0 ? text.length : closeNl + 1;
      continue;
    }
    // Prose up to the next line that opens a fence (always past pos: the search starts at a line break)
    const fence = text.slice(pos).search(/\n[ \t]*(```|~~~)/);
    const to = fence < 0 ? text.length : pos + fence + 1;
    const end = sentenceEnd(text, pos, to);
    if (end >= 0) { push(text.slice(pos, end)); pos = end; continue; }
    if (to < text.length) { push(text.slice(pos, to)); pos = to; continue; } // a fence closes the paragraph
    // The last partial sentence: said when final, or when it outgrew a say (streamed run-on text)
    if (final) { push(text.slice(pos)); pos = text.length; }
    else if (text.length - pos > VOICE_SAY_MAX) {
      const k = text.lastIndexOf(' ', pos + VOICE_SAY_MAX);
      const cut = k > pos ? k : pos + VOICE_SAY_MAX;
      push(text.slice(pos, cut)); pos = cut; continue;
    }
    break;
  }
  return { say, spokenLen: pos };
}

/** The agent reply a voice exchange follows: the agent messages of the thread after the user's acked post. */
export interface VoiceReply { cid: string; after: string; msg: string; text: string; spoken: number; off: boolean }
export const newReply = (cid: string): VoiceReply => ({ cid, after: '', msg: '', text: '', spoken: 0, off: false });

/** Sentences to say for an agent message `id` with full `text` (author/thread already checked by the caller). A newer
 *  message than the one followed flushes the old one first; older ones, and everything after a barge-in, say nothing. */
export function replyStep(r: VoiceReply, id: string, text: string, final = false): string[] {
  if (r.off || !r.after || id <= r.after || (r.msg && id < r.msg)) return [];
  const out: string[] = [];
  if (r.msg && id !== r.msg) { out.push(...replyFlush(r)); r.spoken = 0; }
  r.msg = id; r.text = text;
  const n = nextSentences(r.spoken, text, final);
  r.spoken = n.spokenLen;
  return [...out, ...n.say];
}
/** End of the agent's turn: the partial last sentence of the followed message. */
export function replyFlush(r: VoiceReply): string[] {
  if (r.off || !r.msg) return [];
  const n = nextSentences(r.spoken, r.text, true);
  r.spoken = n.spokenLen;
  return n.say;
}

/** One post at a time: while the agent works on a voice post, what the human says next is held, then posted as one
 *  message when that turn ends. Posting it at once would interrupt the agent's turn on every sentence (seen live: the
 *  agent never got to answer). A turn that never shows up (agent offline) frees the gate after VOICE_BUSY_MAX_MS. */
export interface VoiceGate { busy: boolean; sawRun: boolean; held: string; since: number }
export const VOICE_BUSY_MAX_MS = 120_000;
export const newGate = (): VoiceGate => ({ busy: false, sawRun: false, held: '', since: 0 });
/** The text to post now, or null when it is held for later. */
export function gatePost(g: VoiceGate, text: string, now: number): string | null {
  if (g.busy && now - g.since < VOICE_BUSY_MAX_MS) { g.held = g.held ? `${g.held} ${text}` : text; return null; }
  g.busy = true; g.sawRun = false; g.since = now;
  return text;
}
/** A state of the voice thread: when the agent's turn on our post is over, the held text to post now ('' if none). */
export function gateThread(g: VoiceGate, state: string): string {
  if (state === 'run') { g.sawRun = true; return ''; }
  if (!g.busy || !g.sawRun) return '';
  g.busy = false;
  const held = g.held;
  g.held = '';
  return held;
}

/** Timings of one exchange, ms after the transcript was received (`turn`), for the overlay and window.__voiceMetrics. */
export interface VoiceExchange { at: number; t0: number; sent?: number; acked?: number; text?: number; say?: number; audio?: number }
export type VoiceStep = 'sent' | 'acked' | 'text' | 'say' | 'audio';
export const newExchange = (at: number, t0: number): VoiceExchange => ({ at, t0 });
/** First time only: a later edit, sentence or fragment does not move it. */
export function markExchange(ex: VoiceExchange, k: VoiceStep, now: number): boolean {
  if (ex[k] !== undefined) return false;
  ex[k] = Math.max(0, Math.round(now - ex.t0)); return true;
}
/** Each step's delay after the previous one, as « 0.12 s » (lang's decimal mark), « – » while unknown. */
export function exchangeDeltas(ex: VoiceExchange, lang: string): Record<'sent' | 'ack' | 'text' | 'say' | 'audio', string> {
  const f = new Intl.NumberFormat(lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const d = (a: number | undefined, b: number | undefined) => a === undefined || b === undefined ? '–' : `${f.format(Math.max(0, b - a) / 1000)} s`;
  return { sent: d(0, ex.sent), ack: d(ex.sent, ex.acked), text: d(ex.acked, ex.text), say: d(ex.text, ex.say), audio: d(ex.say, ex.audio) };
}

/** What the voice mode shows in the conversation as messages of the user not posted yet, in order: the text held while
 *  the agent works (`held`), the transcript about to be auto-sent (`soon`, with Send / Cancel), the post sent and not
 *  stored yet (`sending`, until its message is in the thread: `landed` of the acked id). */
export type VoiceDraft = { phase: 'held' | 'soon' | 'sending'; text: string };
export function voiceDrafts(v: { held: string; pending: string; sent: { text: string; cid: string } | null; reply: VoiceReply | null },
  landed: (id: string) => boolean): VoiceDraft[] {
  const out: VoiceDraft[] = [];
  const r = v.reply;
  if (v.sent && !(r && r.cid === v.sent.cid && r.after && landed(r.after))) out.push({ phase: 'sending', text: v.sent.text });
  if (v.held) out.push({ phase: 'held', text: v.held });
  if (v.pending) out.push({ phase: 'soon', text: v.pending });
  return out;
}

/** The words heard so far plus one piece of the daemon's live transcript. Pieces come as the STT tokenizer emits them
 *  (SentencePiece): « ▁ » (U+2581) opens a new word, a piece without it continues the previous word (« ▁Gé » + « rard »).
 *  Kept to the last `max` characters (the panel shows the end). */
export function addPiece(words: string, piece: string, max = 160): string {
  const s = (words + piece.replace(/\u2581/g, ' ')).replace(/\s+/g, ' ').trimStart();
  return s.length > max ? s.slice(-max).trimStart() : s;
}
