// Agent web preview: a trusted human opens, in briefling, a page an agent serves on 127.0.0.1:<port> of its own
// machine (a Vite dev server), without any port or public endpoint on the agent side.
//
// Path of the bytes: the previewed page runs in an iframe of the PREVIEW origin (its own CloudFront distribution, so
// its service worker can take scope `/` and absolute paths like `/src/main.tsx` stay on it). That service worker
// tunnels every request of the origin (but the viewer's own files) to the viewer page, which relays it on one WebRTC
// data channel to a headless Chromium the plugin starts in the agent's terminal sandbox, on a blank page served ON
// http://127.0.0.1:<port>: its fetch() is same-origin to the dev server by construction. Only relative paths are
// fetched (`previewPathOk`), so the channel can never reach another host or port.
//
// The hub only signals (never sees the bytes): offer/answer/candidates between the viewer's connection and the agent's
// instance, and the TURN credentials of both peers (AWS KVS `GetIceServerConfig`, one signaling channel per stack,
// 5-minute credentials). A relay is mandatory: an agent in a Docker Desktop container is behind a symmetric NAT
// (spike `spike/preview-webrtc`, Nov 2026), STUN alone fails from any normally filtered network.
//
// Sequence (frames in protocol/frames.ts):
//   agent  preview.share {thread, port, label}   -> hub writes the line `Message.preview` (status on), answers `preview.shared`
//          (or {thread, device, label}: screen share, or {thread, voice: true, label}: voice channel, see « Voice »)
//   human  preview.open {client_id, thread, msg} -> hub answers `preview.ready {session, ice}` (viewer credentials)
//   human  preview.offer {session, sdp}          -> agent gets `preview.offer {session, port, sdp, ice}` (agent credentials)
//   agent  preview.answer / preview.candidate    -> viewer gets the same frames (agent trickles its candidates)
//   either preview.close / preview.failed        -> the other side gets it, the agent's peer stops
// The viewer gathers its candidates BEFORE sending the offer (complete offer, capped by PREVIEW_GATHER_MS): the
// plugin hands the offer to the peer process once, through its stdin (Hermes sandboxes give no live stdin).
// agent  preview.stop {thread, msg}             -> the line goes off (status off); the plugin also kills its open peers.

/** Shared port: an unprivileged TCP port of the agent's 127.0.0.1. */
export const PREVIEW_PORT_MIN = 1024;
export const PREVIEW_PORT_MAX = 65535;
export const PREVIEW_LABEL_MAX = 80;
/** SDP bound (a complete offer with ~10 candidates is ~3 KB): far under the 128 KB WebSocket frame. */
export const PREVIEW_SDP_MAX = 16_384;
export const PREVIEW_CANDIDATE_MAX = 1024;
/** A session (hub record) lives this long; the peers keep their channel open past it, only signaling stops. */
export const PREVIEW_SESSION_S = 600;
/** Viewer side: wait at most this long for ICE gathering before sending the offer with what it has. */
export const PREVIEW_GATHER_MS = 1500;
/** ... but only this long after its first relay (TURN) candidate: that one reaches the agent from any network. */
export const PREVIEW_RELAY_GRACE_MS = 150;
/** Data channel framing (viewer <-> agent peer): request = JSON text frame; response = JSON text head then binary
 *  chunks of at most PREVIEW_CHUNK bytes, each prefixed by the request id (4 bytes, big endian) and a last flag (1 byte). */
export const PREVIEW_CHUNK = 16_384;
export const PREVIEW_CHANNEL = 'http';

export const PREVIEW_SESSION_RE = /^[A-Za-z0-9_-]{22,64}$/;

export type PreviewStatus = 'on' | 'off';
/** `Message.preview`: line « <agent> shares a preview: <label> (port <port>) », posted by the agent's `preview_share`.
 *  A SCREEN share (`device`, no `port`) shows an Android device of the agent's machine instead: see « Screen » below.
 *  A VOICE channel (`voice: true`) talks to a local voice daemon of the agent's machine: see « Voice » below.
 *  Exactly one of `port`, `device`, `voice`. */
export interface PreviewLine { agent: string; port?: number; device?: string; voice?: true; label: string; status: PreviewStatus;
  /** The live visitor link of this line (« Visitor link » below): until when, made by which lead. Never the token. */
  visitor?: { until: number; by: string } }

// ---------------------------------------------------------------- Visitor link (Nov 2026)
// A lead hands ONE web or screen preview to someone without a briefling account (a customer on the phone): the card's
// « Visitor link » asks the hub (`preview.visitor`) for a link to the preview origin's visitor page
// (`/__viewer/visit.html#t=<token>`, the token in the hash: never sent to CloudFront nor in a Referer). Token =
// `<msg>.<secret>`, secret = 32 random bytes; the hub keeps only sha256(secret) in the line's VISITOR record, with its
// deadline (VISITOR_MIN_DEFAULT, at most VISITOR_MIN_MAX). One link per line: a new one replaces the old one (whose
// token then stops working), « Revoke » (`preview.unvisitor`) deletes it; both cut the visitor's live session.
// Why a random token kept hashed, not an HMAC-signed one: the hub must keep a record anyway (revocation, one viewer),
// and the record alone is enough to check it: no signing key to store, rotate or leak (same model as the agent
// invitation codes).
// The page opens its own WebSocket to the hub with `Sec-WebSocket-Protocol: briefling.v2, visitor.<token>`; the
// authorizer checks the record (hash, deadline) and the connection is a `visitor` principal whose id is the line. It
// may only send `preview.open {client_id}` / `preview.offer` / `preview.close` of that line (no thread, no space, no
// other frame), each one checked again against the record; one session at a time (a new open closes the previous
// one: a visitor whose network changed comes back in place of their dead session). Each open is logged
// (`visitor_open`). The agent's peer gets the time left (`max_s` of preview.offer) and stops at the deadline.
// Out of scope: voice lines (no visitor link), sound, iOS devices.
export const VISITOR_MIN_DEFAULT = 30;
export const VISITOR_MIN_MIN = 5;
export const VISITOR_MIN_MAX = 120;
export const VISITOR_PREFIX = 'visitor.';
export const VISITOR_MSG_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const VISITOR_SECRET_RE = /^[A-Za-z0-9_-]{43}$/;
/** Link lifetime asked by a lead: absent = the default, else whole minutes within bounds; null = refused. */
export function visitorMinutes(x: unknown): number | null {
  if (x === undefined) return VISITOR_MIN_DEFAULT;
  return Number.isInteger(x) && (x as number) >= VISITOR_MIN_MIN && (x as number) <= VISITOR_MIN_MAX ? x as number : null;
}
/** `<msg>.<secret>` -> its parts, else null. */
export function visitorToken(x: unknown): { msg: string; secret: string } | null {
  if (typeof x !== 'string') return null;
  const i = x.indexOf('.');
  if (i < 0) return null;
  const msg = x.slice(0, i), secret = x.slice(i + 1);
  return VISITOR_MSG_RE.test(msg) && VISITOR_SECRET_RE.test(secret) ? { msg, secret } : null;
}
/** Token carried in the visitor page's hash (`#t=<token>`), or null. */
export function visitorTokenOfHash(hash: string): string | null {
  const m = /(?:^#|&)t=([A-Za-z0-9_.-]{1,120})(?:&|$)/.exec(hash);
  return m && visitorToken(m[1]) ? m[1] : null;
}
/** A line that can get a visitor link: on, a web page or a screen (not a voice channel). */
export const visitorOk = (p: PreviewLine | undefined): boolean => !!p && p.status === 'on' && !p.voice;
/** The line's visitor link, if still valid at `now`. */
export const visitorLive = (p: PreviewLine | undefined, now: number) => p?.visitor && p.visitor.until > now ? p.visitor : null;

// ---------------------------------------------------------------- Screen (Android device, Nov 2026)
// `preview_share(device=<adb serial>)`: the same line, session and signaling as a web preview, but the agent's peer
// streams the device's screen (scrcpy-server, H.264 packets as the device's encoder emits them) on a data channel
// labelled PREVIEW_SCREEN_CHANNEL, and the viewer decodes it in a canvas (WebCodecs) and sends gestures back on the
// same channel. Why scrcpy-server, not `adb exec-out screenrecord`: screenrecord's raw H.264 has no frame boundary
// (spike spikes/emulator-screen: pipe reads cut NAL units, idle gaps inside a NAL overlap gaps between NALs).
//
// agent -> viewer, binary: [flags u8][payload <= PREVIEW_SCREEN_CHUNK - 1]; flags: 1 = codec config (SPS/PPS),
//   2 = key frame, 0x80 = last fragment of this packet (a packet is cut into fragments; fragments of one packet are
//   consecutive, the channel is ordered).
// viewer -> agent, text JSON, one gesture per frame (`screenGesture` is the exact grammar, the agent checks it again):
//   {k:'touch', a:'down'|'move'|'up', x, y}   x, y in [0, 1] of the picture
//   {k:'key', key: one of SCREEN_KEYS}          {k:'text', s: printable, <= SCREEN_TEXT_MAX}   {k:'reset'} key frame
// Nothing the viewer sends ever reaches a shell: the agent turns a gesture into a fixed-size scrcpy control message.
export const PREVIEW_SCREEN_CHANNEL = 'screen';
export const PREVIEW_SCREEN_CHUNK = 16_384;
export const SCREEN_KEYS = ['back', 'home', 'recents', 'enter', 'del'] as const;
export type ScreenKey = typeof SCREEN_KEYS[number];
export const SCREEN_TEXT_MAX = 300;
export type ScreenGesture =
  | { k: 'touch'; a: 'down' | 'move' | 'up'; x: number; y: number }
  | { k: 'key'; key: ScreenKey }
  | { k: 'text'; s: string }
  | { k: 'reset' };
const unit = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1;
/** A well-formed gesture, else null (unknown fields dropped). Text: no control character. */
export function screenGesture(o: unknown): ScreenGesture | null {
  const g = o as Record<string, unknown>;
  if (!g || typeof g !== 'object') return null;
  if (g.k === 'touch' && (g.a === 'down' || g.a === 'move' || g.a === 'up') && unit(g.x) && unit(g.y)) return { k: 'touch', a: g.a, x: g.x, y: g.y };
  if (g.k === 'key' && (SCREEN_KEYS as readonly unknown[]).includes(g.key)) return { k: 'key', key: g.key as ScreenKey };
  if (g.k === 'text' && typeof g.s === 'string' && g.s.length > 0 && g.s.length <= SCREEN_TEXT_MAX && !/[\u0000-\u001f\u007f]/.test(g.s)) return { k: 'text', s: g.s };
  if (g.k === 'reset') return { k: 'reset' };
  return null;
}

/** adb serial of a shared device (`emulator-5554`, `host.docker.internal:5555`, a USB serial): no shell character. */
export const PREVIEW_DEVICE_RE = /^[A-Za-z0-9._:-]{1,64}$/;
export const previewDeviceOk = (x: unknown): x is string => typeof x === 'string' && PREVIEW_DEVICE_RE.test(x);

// ---------------------------------------------------------------- Voice (local voice daemon, Nov 2026)
// `preview_share(voice=<url-file path>)`: the same line, session and signaling as a screen share, but the agent's peer
// relays a data channel labelled PREVIEW_VOICE_CHANNEL to the voice daemon of the agent's machine (voice/, a WebSocket
// on 127.0.0.1:<port>/<token>, one client at a time). The hub never sees the url-file path, the URL or the token: the
// plugin keeps the path in its own share and hands it to the peer on stdin; the peer reads the file in the sandbox.
//
// viewer -> agent, binary: int16 LE mono PCM at VOICE_RATE (microphone), chunks of at most VOICE_CHUNK bytes.
// viewer -> agent, text JSON (`voiceClientMsg` is the exact grammar, the agent checks it again):
//   {type:'say', text}   one sentence to speak, 1..VOICE_SAY_MAX characters, no control character
//   {type:'stop'}        drop every queued or playing sentence
// agent -> viewer, text JSON (`voiceDaemonMsg`): {type:'ready'} | {type:'word', text} | {type:'turn', text, flush_ms}
//   | {type:'tts_stop', reason:'barge_in'|'stop'} | {type:'tts_end', id}
// agent -> viewer, binary: [u32 LE id] + int16 LE mono PCM at VOICE_RATE (TTS), one fragment of at most VOICE_CHUNK
//   bytes, each fragment with its own id prefix (fragments of one sentence are consecutive: the channel is ordered).
// Security: the agent side only returns transcripts and audio and never posts; the client posts the transcript as the
// human (a normal `post`), so the hub's trusted-author gates apply as for typed text. Every message is re-serialized
// by the peer in both directions; nothing the viewer sends reaches a shell or any URL but the daemon's.
// Voice on request (Nov 2026): a host whose agents can talk sets BRIEFLING_VOICE (a directory of the agent's terminal
// holding `start`, an executable that runs the daemon with `--url-file <dir>/url`). Its plugin says so at `subscribe`
// (`plugin.voice`), the hub copies it into the agent's presence (`Presence.voice`), and the composer of each thread of
// that agent shows « Voice » even with no voice line. The tap starts the microphone (iOS: inside the gesture), then
// posts `post{voice:true}`: a lead only, an existing thread or Lounge topic (not General), the agent it is for
// (`voiceAgent`: a thread's agent in charge, a topic's last agent that spoke, else its owner) connected with voice. The hub stores
// it as a normal message (`voiceAsk`, text VOICE_ASK_TEXT) and delivers it like any other (the agent's hand and queue
// apply: no action on the sandbox outside a turn). The plugin turns it into a hidden « call voice_open » for the turn;
// voice_open starts the daemon if its url-file does not answer, waits for it (VOICE_START_S), then shares the voice
// line as preview_share does. The client opens the first voice line on that comes after its request (VOICE_ASK_MS).
export const VOICE_ASK_TEXT = 'Voice channel requested.';
/** Client: how long the panel waits for the agent's voice line after the request (a turn + a daemon cold start). */
export const VOICE_ASK_MS = 120_000;
export const PREVIEW_VOICE_CHANNEL = 'voice';
export const VOICE_RATE = 24_000;
/** 80 ms of microphone at VOICE_RATE (the daemon's STT frame). */
export const VOICE_CHUNK_SAMPLES = 1920;
/** The daemon cuts a sentence at 1000 characters. */
export const VOICE_SAY_MAX = 1000;
/** Max binary message on the voice channel, both ways. */
export const VOICE_CHUNK = 16_384;
export const VOICE_WORD_MAX = 200;
export const VOICE_TURN_MAX = 4000;
export type VoiceClientMsg = { type: 'say'; text: string } | { type: 'stop' };
export type VoiceDaemonMsg =
  | { type: 'ready' }
  | { type: 'word'; text: string }
  | { type: 'turn'; text: string; flush_ms: number }
  | { type: 'tts_stop'; reason: 'barge_in' | 'stop' }
  | { type: 'tts_end'; id: number };
const CTRL = /[\u0000-\u001f\u007f]/;
const textOk = (x: unknown, max: number, min = 0): x is string => typeof x === 'string' && x.length >= min && x.length <= max;
const u32 = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0 && (x as number) <= 0xffffffff;
/** A well-formed viewer message, else null (unknown fields dropped). */
export function voiceClientMsg(o: unknown): VoiceClientMsg | null {
  const m = o as Record<string, unknown>;
  if (!m || typeof m !== 'object') return null;
  if (m.type === 'say' && textOk(m.text, VOICE_SAY_MAX, 1) && !CTRL.test(m.text)) return { type: 'say', text: m.text };
  if (m.type === 'stop') return { type: 'stop' };
  return null;
}
/** A well-formed daemon message, else null (unknown types and fields dropped). Transcripts may hold a newline. */
export function voiceDaemonMsg(o: unknown): VoiceDaemonMsg | null {
  const m = o as Record<string, unknown>;
  if (!m || typeof m !== 'object') return null;
  if (m.type === 'ready') return { type: 'ready' };
  if (m.type === 'word' && textOk(m.text, VOICE_WORD_MAX)) return { type: 'word', text: m.text };
  if (m.type === 'turn' && textOk(m.text, VOICE_TURN_MAX)) return { type: 'turn', text: m.text, flush_ms: u32(m.flush_ms) ? m.flush_ms : 0 };
  if (m.type === 'tts_stop' && (m.reason === 'barge_in' || m.reason === 'stop')) return { type: 'tts_stop', reason: m.reason };
  if (m.type === 'tts_end' && u32(m.id)) return { type: 'tts_end', id: m.id };
  return null;
}

/** ICE server as RTCPeerConnection takes it. */
export interface IceServer { urls: string[]; username?: string; credential?: string }

/** Why a session did not open or stopped. not_shared: the line is off or unknown; not_connected: no live instance of
 *  the agent; preview_off: the stack has no TURN channel; gone: the plugin no longer has that share (gateway restarted,
 *  sandbox gone); no_browser: no Playwright Chromium in the agent's sandbox; port_closed: nothing listens on the port;
 *  busy: too many sessions on the agent; peer_failed: the agent's peer crashed or ICE failed; timeout: no answer.
 *  Screen only: no_device: no adb or the device is not online; no_scrcpy: scrcpy-server could not be fetched/checked.
 *  Voice only: no_voice: the url-file is missing or invalid, or the daemon refused or is not listening (it takes one
 *  client at a time, so a second viewer gets it too). */
export const PREVIEW_ERRORS = ['not_shared', 'not_connected', 'preview_off', 'gone', 'no_browser', 'port_closed', 'busy', 'peer_failed', 'timeout',
  'no_device', 'no_scrcpy', 'no_voice'] as const;
export type PreviewError = typeof PREVIEW_ERRORS[number];
export const isPreviewError = (x: unknown): x is PreviewError => typeof x === 'string' && (PREVIEW_ERRORS as readonly string[]).includes(x);

export const previewPortOk = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= PREVIEW_PORT_MIN && (x as number) <= PREVIEW_PORT_MAX;

/** Label as stored: one line, trimmed, bounded; empty = `localhost:<port>` (or the device of a screen share, or
 *  `'voice'` passed by a voice channel). */
export function previewLabel(x: unknown, port: number | string): string {
  const s = typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, PREVIEW_LABEL_MAX) : '';
  return s || (typeof port === 'string' ? port : `localhost:${port}`);
}

/** A path the agent's peer may fetch: relative to the shared port only (no scheme, no `//host`, no backslash trick). */
export function previewPathOk(p: unknown): p is string {
  return typeof p === 'string' && p.length <= 8192 && p.startsWith('/') && !p.startsWith('//') && !p.includes('\\') && !/[\u0000-\u001f]/.test(p);
}

export const previewSdpOk = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= PREVIEW_SDP_MAX && x.startsWith('v=0');

/** Trickled candidate (`RTCIceCandidate.candidate` + `sdpMid`); candidate '' = end of candidates. */
export function previewCandidateOk(c: unknown, mid: unknown): boolean {
  return typeof c === 'string' && c.length <= PREVIEW_CANDIDATE_MAX && (c === '' || c.startsWith('candidate:'))
    && (mid === null || (typeof mid === 'string' && mid.length <= 32));
}
