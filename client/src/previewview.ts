// Agent web preview (`Message.preview`, protocol/preview.ts): its conversation line or card, the « Open preview »
// overlay and its signaling relay, the voice channel (preview kind `voice`) docked in the composer, and the visitor
// link. Their own file since the modules refactor: main.ts keeps the socket, `render()` and the composer, and calls
// what this returns (frames, the composer's Voice button, the dock after each render). Built once at load, at the
// place the block had in main.ts, so its window listeners keep their order.
import type { HubFrame, Message, PublicThread } from '../../protocol/frames.ts';
import { VOICE_ASK_MS, VOICE_ASK_TEXT, visitorLive } from '../../protocol/preview.ts';
import { canTalk, type Presence } from '../../protocol/presence.ts';
import { lang } from './i18n.ts';
import type { UiKit } from './modules.ts';
import { patch } from './patch.ts';
import { previewBase, previewOrigin, previewReason, previewReshareText, previewStateText, voiceLineOf, voiceResumeStep, previewStep, type PreviewState, type VoiceResume } from './preview.ts';
import { routeOf, type View } from './route.ts';
import { VOICE_AUTOSEND_MS, addPiece, exchangeDeltas, gatePost, gateThread, markExchange, newExchange, newGate, newReply, replyFlush, replyStep, voiceDrafts, type VoiceExchange, type VoiceGate, type VoiceReply } from './voicesay.ts';
import { fromViewer, fromViewerMsg, previewKey, type ToViewer } from '../preview/bridge.ts';
import { MIC_LEVELS, smoothLevel, startVoice, type VoiceSession } from '../preview/voice.ts';
import { visitRetry } from '../preview/visitlogic.ts';

declare const __VOICE_WORKLET__: string; // set by the build (scripts/build-client.ts), as in main.ts

/** The part of main.ts' app state the preview reads. */
export interface PreviewShared {
  me: string;
  view: View;
  sel: string | null;
  threads: Map<string, PublicThread>;
  msgs: Map<string, Map<string, Message>>;
  presence: Map<string, Presence[]>;
  trusted: Set<string>;
}
/** main.ts helpers the preview uses. */
export interface PreviewDeps {
  rand(): string;
  cap(s: string): string;
  iconBtn(name: string, text: string, onclick: (e: Event) => void, extra?: Record<string, any>): HTMLElement;
  fullDate(ts: number): string;
  cardBand(icon: string, label: string, sub: string): HTMLElement;
  kindIc(name: string): HTMLElement;
  noteMentions(space: string, text: string): void;
  toBottom(): void;
  notePosted(f: PublicThread): void;
  avatarClass(a: Message['author']): string;
  face(src: string, name: string): Node;
  /** Config `previewUrl`: origin of the previews, absent = off. */
  previewUrl: string | undefined;
  voiceAgentOf(th: PublicThread): string;
}

export function previewModule(k: UiKit, S: PreviewShared, d: PreviewDeps) {
  const { h, t, icon, render, send, request, personName, personAvatar, cardBand, go, withIcon } = k;
  const { rand, cap, iconBtn, fullDate, kindIc, noteMentions, toBottom, notePosted, avatarClass, face, voiceAgentOf } = d;
  const cfg = { previewUrl: d.previewUrl };
  // ---------------------------------------------------------------- agent web preview
  // Line `Message.preview` (« <agent> shares a preview… »), and for a trusted human of the space, while it is on, the
  // « Open preview » overlay: a full-viewport iframe of the viewer page on the PREVIEW origin (config `previewUrl`, its
  // own CloudFront distribution: the previewed page can never read this app's storage or tokens). The app only relays
  // the session's signaling between the hub and that iframe (protocol/preview.ts, client/preview/bridge.ts).
  const PV_BASE = previewBase(cfg.previewUrl), PV_ORIGIN = PV_BASE ? previewOrigin(PV_BASE) : null;
  /** No preview.ready in this delay = the hub did not answer. */
  const PV_READY_MS = 10_000;
  // A voice channel (`voice`): no iframe (`frame` null), the WebRTC peer runs in this page (client/preview/voice.ts).
  type Pv = { cid: string; thread: string; label: string; screen: boolean; route: string; session: string; state: PreviewState; t0: number;
    hello: boolean; queue: ToViewer[]; el: HTMLElement; bar: HTMLElement; frame: HTMLIFrameElement | null; voice: VoiceUi | null;
    /** The line it shows and the times it came back by itself after a cut (pvReopen). */
    line?: Message; reopened?: number[] };
  let pv: Pv | null = null;
  let pvLate = ''; // client_id of a preview closed before its preview.ready: that session is closed as soon as it comes
  /** Raw send that never shows « offline » (closing on a dead socket has nothing to tell the hub). */
  const pvSend = (f: object) => { k.post(f as { type: string }); };
  function openPreview(m: Message) {
    const p = m.preview;
    if (!p || p.status !== 'on') return;
    if (p.voice) return openVoice(m); // no preview origin involved
    if (!PV_BASE) return;
    if (pv) closePreview();
    const cid = rand().slice(0, 20);
    if (!send({ type: 'preview.open', client_id: cid, thread: m.thread, msg: m.id })) return;
    // Loaded at once, in parallel with the hub round trip: the viewer's service worker registers meanwhile.
    // sandbox: the previewed page may run scripts on its own origin but never navigate this app (no allow-top-navigation).
    const frame = h('iframe', { class: 'pv-frame', title: p.label, sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads',
      src: `${PV_BASE}/__viewer/index.html#key=${previewKey(p.agent, p.port ?? 0)}` }) as HTMLIFrameElement;
    const bar = h('div', { class: 'pv-bar' });
    // Outside the morphed #app tree: a patch() that moved the iframe would reload it.
    const screen = p.device !== undefined;
    // A screen share: Android's navigation bar under the picture (the viewer sends the key on its channel).
    const key = (k: 'back' | 'home' | 'recents') => () => pvToViewer({ bp: 1, type: 'gesture', g: { k: 'key', key: k } });
    const nav = screen ? h('div', { class: 'pv-nav', 'data-k': 'pv-nav' },
      iconBtn('navBack', t('screen_back'), key('back'), { class: 'btn ic pv-key', 'data-k': 'pv-back' }),
      iconBtn('navHome', t('screen_home'), key('home'), { class: 'btn ic pv-key', 'data-k': 'pv-home' }),
      iconBtn('navRecents', t('screen_recents'), key('recents'), { class: 'btn ic pv-key', 'data-k': 'pv-recents' })) : null;
    const el = h('div', { class: `pv${screen ? ' pv-screen' : ''}`, 'data-k': 'preview', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('preview_dlg', { label: p.label }) },
      bar, frame, ...(nav ? [nav] : []));
    pv = { cid, thread: m.thread, label: p.label, screen, route: routeOf(S.view, S.sel), session: '', state: { k: 'connecting' }, t0: performance.now(),
      hello: false, queue: [], el, bar, frame, voice: null, line: m };
    document.body.append(el);
    pvBar();
    const mine = pv;
    window.setTimeout(() => { if (pv === mine && !mine.session) pvFail('timeout'); }, PV_READY_MS);
  }
  function closePreview() {
    const p = pv;
    if (!p) return;
    pv = null;
    if (p.session) pvSend({ type: 'preview.close', session: p.session }); else pvLate = p.cid;
    if (p.voice) { window.clearTimeout(p.voice.pending?.timer); window.clearInterval(p.voice.wait); p.voice.s.close(); }
    p.el.remove();
    if (p.voice) queueMicrotask(render); // the composer comes back in place of the docked panel
  }
  /** After each render: the open voice panel goes into its host in the voice thread's composer slot (not a dialog). */
  function voiceDock(app: HTMLElement) {
    if (!pv?.voice) return;
    const host = app.querySelector(`[data-k="vc-host:${CSS.escape(pv.thread)}"]`);
    if (!host || pv.el.parentElement === host) return;
    pv.el.classList.add('docked'); pv.el.setAttribute('role', 'region'); pv.el.removeAttribute('aria-modal');
    host.append(pv.el);
  }
  /** Header: label, state (connecting / connected in X.X s / failed: reason / closed), close button. */
  function pvBar() {
    if (!pv) return;
    const s = pv.state;
    patch(pv.bar, icon(pv.voice ? 'mic' : pv.screen ? 'smartphone' : 'monitor', 15) as unknown as Node, h('span', { class: 'pv-label', title: pv.label }, pv.label),
      h('span', { class: `pv-st ${s.k}`, role: 'status', 'data-k': 'pv-st' }, s.k === 'failed' && s.code === 'mic' ? t('voice_mic_denied') : s.k === 'failed' && s.code === 'mic_dead' ? t('voice_mic_dead') : s.k === 'failed' && s.code === 'ask_timeout' ? t('voice_ask_timeout', { agent: pv.label }) : s.k === 'failed' && s.code === 'agent_offline' ? t('voice_agent_offline', { agent: cap(S.threads.get(pv.thread)?.owner ?? pv.label) }) : previewStateText(s, t, lang())),
      iconBtn('x', t(pv.voice ? 'voice_close' : 'preview_close'), closePreview, { class: 'btn ic pv-close', 'data-k': 'pv-close' }));
  }
  function pvState(ev: Parameters<typeof previewStep>[1]) {
    if (!pv) return;
    pv.state = previewStep(pv.state, ev, performance.now() - pv.t0);
    pvBar();
  }
  function pvFail(code: string) {
    if (!pv) return;
    pvToViewer({ bp: 1, type: 'failed', code });
    pvState({ failed: code });
    if (pv.voice) { window.clearTimeout(pv.voice.pending?.timer); window.clearInterval(pv.voice.wait); pv.voice.pending = null; pv.voice.s.close(); vcRender(); }
  }
  /** To the viewer at the preview origin only; held until its `hello` (the iframe loads while the hub answers). */
  function pvToViewer(m: ToViewer) {
    if (!pv) return;
    if (!pv.frame) return; // a voice channel: no viewer page
    if (!pv.hello) { pv.queue.push(m); return; }
    pv.frame.contentWindow?.postMessage(m, PV_ORIGIN!);
  }
  /** Hub frames of the open preview (true = consumed). */
  function onPreviewFrame(f: HubFrame): boolean {
    if (f.type === 'preview.ready' && !(pv && f.client_id === pv.cid)) { if (f.client_id === pvLate) { pvLate = ''; pvSend({ type: 'preview.close', session: f.session }); } return true; }
    if (f.type !== 'preview.ready' && f.type !== 'preview.answer' && f.type !== 'preview.candidate' && f.type !== 'preview.failed' && !(f.type === 'error' && pv && f.ref === pv.cid)) return false;
    if (!pv) return true;
    if (f.type === 'error') voiceOrFail(f.code);
    else if (f.type === 'preview.ready' && pv.voice) { pv.session = f.session; pv.voice.s.connect(f.ice); }
    else if (f.type === 'preview.ready') { pv.session = f.session; pvToViewer(pv.screen ? { bp: 1, type: 'ready', ice: f.ice, screen: true } : { bp: 1, type: 'ready', ice: f.ice }); }
    else if (f.session !== pv.session) return true; // another (old) session
    else if (f.type === 'preview.answer' && pv.voice) pv.voice.s.answer(f.sdp);
    else if (f.type === 'preview.candidate' && pv.voice) pv.voice.s.candidate(f.candidate, f.mid);
    else if (f.type === 'preview.answer') pvToViewer({ bp: 1, type: 'answer', sdp: f.sdp });
    else if (f.type === 'preview.candidate') pvToViewer({ bp: 1, type: 'candidate', candidate: f.candidate, mid: f.mid });
    else voiceOrFail(f.code);
    return true;
  }
  window.addEventListener('message', (e) => {
    if (!pv?.frame || !fromViewer(e, PV_ORIGIN, pv.frame.contentWindow)) return; // gate: the overlay iframe, at the preview origin
    const m = fromViewerMsg(e.data);
    if (!m) return;
    if (m.type === 'hello') { pv.hello = true; for (const x of pv.queue.splice(0)) pvToViewer(x); }
    else if (m.type === 'offer') { if (pv.session && pv.state.k === 'connecting') pvSend({ type: 'preview.offer', session: pv.session, sdp: m.sdp }); }
    else if (m.type === 'failed') { pvState({ failed: m.code }); if (pv.session) pvSend({ type: 'preview.close', session: pv.session }); }
    else if (m.type === 'closed' && pvReopen()) return;
    else pvState(m.type);
  });
  /** The open channel dropped (network change, the agent's peer at its cap): the same preview opens again by itself, a
   *  new session with fresh TURN credentials, within the visitor page's budget (client/preview/visitlogic.ts). */
  function pvReopen(): boolean {
    const p = pv, now = Date.now();
    if (!p?.line || p.state.k === 'connecting' || !visitRetry(p.reopened ?? [], now, null)) return false;
    closePreview();
    openPreview(p.line);
    if (pv) pv.reopened = [...(p.reopened ?? []), now];
    return true;
  }
  // Leaving the page: the agent's peer stops (a new page or connection can't own this session).
  window.addEventListener('pagehide', closePreview);
  window.addEventListener('keydown', (e) => {
    if (!pv || e.key !== 'Escape') return;
    e.preventDefault(); e.stopImmediatePropagation(); closePreview();
  }, true);
  // ---------------------------------------------------------------- voice channel (preview kind `voice`)
  // Same line, session, gates and overlay frame as a screen share, but no iframe: the peer connection, the microphone and
  // the playback run in this page (client/preview/voice.ts). Show-then-send: a transcript (`turn`) shows with Send /
  // Cancel and is posted after VOICE_AUTOSEND_MS through the normal composer `post`, as the human; the agent's reply
  // (its message.created/updated after that post's ack) is spoken sentence by sentence (client/src/voicesay.ts).
  type VoiceUi = { s: VoiceSession; space: string; panel: HTMLElement; mode: 'start' | 'listen' | 'speak'; words: string; note: string;
    pending: { text: string; timer: number } | null; reply: VoiceReply | null; ex: VoiceExchange | null; gate: VoiceGate;
    sent: { text: string; cid: string } | null; lv: number[]; lvs: number;
    /** Voice on request: the agent was asked (`post{voice}`) and its voice line is not there yet. */
    asking: boolean;
    /** Resume after a cut (voiceResume), cleared when the channel opens again; `wait` = its timer. */
    resume: VoiceResume | null; wait: number };
  const voiceMetrics = () => ((window as unknown as { __voiceMetrics?: VoiceExchange[] }).__voiceMetrics ??= []);
  function openVoice(m: Message) {
    const th = S.threads.get(m.thread);
    if (!th) return;
    if (pv) closePreview();
    const cid = rand().slice(0, 20);
    if (!send({ type: 'preview.open', client_id: cid, thread: m.thread, msg: m.id })) return;
    voicePanel(th, m.preview!.label, cid, false);
  }
  /** « Voice » with no voice line on (protocol/preview.ts « Voice on request »): the microphone starts now (iOS needs the
   *  tap), the agent in charge is asked to open its channel, and its voice line is opened as soon as it comes
   *  (voiceOnLine). A refusal of the request (`error` ref = this cid) fails the panel like a preview error. */
  function askVoice(th: PublicThread) {
    if (pv) closePreview();
    const cid = rand().slice(0, 20);
    if (!send({ type: 'post', client_id: cid, space: th.space, thread: th.id, text: VOICE_ASK_TEXT, voice: true })) return;
    voicePanel(th, cap(voiceAgentOf(th)), cid, true);
  }
  /** The voice line asked for is on: open it in the panel already listening (the 10 s ready timer starts then). */
  function voiceOnLine(m: Message) {
    const mine = pv;
    if (!mine?.voice?.asking || m.thread !== mine.thread || voiceLineOf([m]) !== m) return;
    const cid = rand().slice(0, 20);
    if (!send({ type: 'preview.open', client_id: cid, thread: m.thread, msg: m.id })) return pvFail('offline');
    mine.voice.asking = false; mine.cid = cid; mine.label = m.preview!.label;
    pvBar(); vcRender();
    window.setTimeout(() => { if (pv === mine && mine.cid === cid && !mine.session) voiceOrFail('timeout'); }, PV_READY_MS);
  }
  function voicePanel(th: PublicThread, label: string, cid: string, asking: boolean) {
    const bar = h('div', { class: 'pv-bar' }), panel = h('div', { class: 'vc', 'data-k': 'vc' });
    const el = h('div', { class: 'pv pv-voice', 'data-k': 'preview', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('voice_dlg', { label }) }, bar, panel);
    const mine: Pv = { cid, thread: th.id, label, screen: false, route: routeOf(S.view, S.sel), session: '', state: { k: 'connecting' }, t0: performance.now(),
      hello: false, queue: [], el, bar, frame: null, voice: null };
    const live = () => pv === mine ? mine.voice : null;
    // In the click: the AudioContext and getUserMedia need the user gesture (iOS).
    const s = startVoice({
      onOffer: (sdp) => { if (live() && mine.session && mine.state.k === 'connecting') pvSend({ type: 'preview.offer', session: mine.session, sdp }); },
      onOpen: () => { const v = live(); if (v) { v.resume = null; pvState('open'); vcRender(); } },
      onMsg: (d) => { const v = live(); if (v) voiceMsg(v, d); },
      onLevel: (l) => { const v = live(); if (v) vcLevel(v, l); },
      onAudio: () => { const v = live(); if (!v) return; v.mode = 'speak'; if (v.ex) markExchange(v.ex, 'audio', performance.now()); vcRender(); },
      onFail: (code) => { if (!live()) return; pvState({ failed: code }); if (mine.session) pvSend({ type: 'preview.close', session: mine.session }); },
      onLost: () => !!live() && voiceResume(mine, 'lost'),
      onClosed: () => { if (live()) { pvState('closed'); vcRender(); } },
    }, __VOICE_WORKLET__);
    mine.voice = { s, space: th.space, panel, mode: 'start', words: '', note: '', pending: null, reply: null, ex: null, gate: newGate(), sent: null, lv: [0, 0, 0, 0, 0], lvs: 0, asking, resume: null, wait: 0 };
    pv = mine;
    pvBar(); vcRender();
    render(); // the composer of the voice thread becomes the panel's host (voiceDock)
    if (!el.isConnected) document.body.append(el); // no composer on screen: full-screen panel as before
    window.setTimeout(() => { if (pv === mine && mine.cid === cid && !mine.session) voiceOrFail(asking ? 'ask_timeout' : 'timeout'); }, asking ? VOICE_ASK_MS : PV_READY_MS);
  }
  /** A failure of the open voice panel: resumed when the rule allows it (voiceResumeStep), else shown. */
  function voiceOrFail(code: string) {
    if (pv?.voice && voiceResume(pv, code)) return;
    pvFail(code);
  }
  /** The voice channel dropped or its open failed (`code`): keep the microphone, wait for the agent to be back
   *  (presence with voice), then open its voice line again or, when the share died with its gateway, ask for the voice
   *  (a short turn of the agent). False = no resume (shown as a failure). Rule: voiceResumeStep. */
  const VOICE_RESUME_GAP_MS = 2000; // first try after a cut: the hub sees a dead gateway's connection go a moment later
  function voiceResume(mine: Pv, code: string): boolean {
    const v = mine.voice, th = S.threads.get(mine.thread);
    if (pv !== mine || !v || !th) return false;
    const step = voiceResumeStep(code, v.resume, Date.now());
    if (!step) return false;
    window.clearInterval(v.wait);
    if (step === 'offline') { pvFail('agent_offline'); return true; }
    console.info('voice resume:', code, '->', step.stage); // not « voice: », the prefix of failures
    v.resume = step; v.asking = false; v.mode = 'start';
    if (mine.session) pvSend({ type: 'preview.close', session: mine.session });
    mine.session = ''; mine.cid = ''; mine.state = { k: 'connecting' };
    v.s.reset();
    const from = Date.now();
    v.wait = window.setInterval(() => {
      if (pv !== mine) return window.clearInterval(v.wait);
      if (Date.now() - from < VOICE_RESUME_GAP_MS) return;
      if (!canTalk(voiceAgentOf(th), S.presence.get(th.space))) { if (Date.now() > step.until) voiceOrFail('not_connected'); return; }
      window.clearInterval(v.wait);
      const line = step.stage === 'reopen' ? voiceLineOf(S.msgs.get(th.id)?.values() ?? []) : null, cid = rand().slice(0, 20);
      mine.cid = cid;
      if (line) mine.label = line.preview!.label;
      else { step.stage = 'ask'; v.asking = true; mine.label = cap(voiceAgentOf(th)); }
      const ok = line ? send({ type: 'preview.open', client_id: cid, thread: th.id, msg: line.id })
        : send({ type: 'post', client_id: cid, space: th.space, thread: th.id, text: VOICE_ASK_TEXT, voice: true });
      if (!ok) return pvFail('offline');
      pvBar(); vcRender();
      window.setTimeout(() => { if (pv === mine && mine.cid === cid && !mine.session) voiceOrFail(line ? 'timeout' : 'ask_timeout'); }, line ? PV_READY_MS : VOICE_ASK_MS);
    }, 500);
    pvBar(); vcRender();
    return true;
  }
  /** « Retry » of a failed or closed voice panel (a tap: the microphone may start again): its line if still on, else a
   *  new voice request. */
  function voiceRetry() {
    const th = pv ? S.threads.get(pv.thread) : undefined;
    if (!th) return;
    closePreview();
    const line = voiceLineOf(S.msgs.get(th.id)?.values() ?? []);
    if (line) openPreview(line); else askVoice(th);
  }
  function voiceMsg(v: VoiceUi, d: Parameters<Parameters<typeof startVoice>[0]['onMsg']>[0]) {
    if (d.type === 'ready') v.mode = 'listen';
    else if (d.type === 'word') v.words = addPiece(v.words, d.text);
    else if (d.type === 'turn') {
      const text = d.text.trim();
      v.words = '';
      if (!text) return vcRender();
      // Talking on before the send: one message (the timer starts again)
      if (v.pending) window.clearTimeout(v.pending.timer);
      v.pending = { text: v.pending ? `${v.pending.text} ${text}` : text, timer: window.setTimeout(voiceSend, VOICE_AUTOSEND_MS) };
      v.note = '';
      v.ex = newExchange(Date.now(), performance.now()); voiceMetrics().push(v.ex);
    }
    else if (d.type === 'tts_stop') { if (d.reason === 'barge_in' && v.reply) v.reply.off = true; v.mode = 'listen'; }
    else if (d.type === 'tts_end') v.mode = 'listen';
    vcRender();
    if (d.type === 'turn') render(); // the transcript shows in the conversation (voiceDraftEls)
  }
  function voiceSend() {
    const v = pv?.voice;
    if (!pv || !v?.pending) return;
    const th = S.threads.get(pv.thread), cid = rand().slice(0, 20);
    window.clearTimeout(v.pending.timer);
    const text = gatePost(v.gate, v.pending.text, Date.now());
    v.pending = null;
    if (text === null) { render(); return vcRender(); } // held: shown in the conversation until it is posted
    v.note = '';
    if (th) notePosted(th);
    if (send({ type: 'post', client_id: cid, space: v.space, thread: pv.thread, text })) {
      noteMentions(v.space, text); v.reply = newReply(cid); v.sent = { text, cid };
      if (v.ex) markExchange(v.ex, 'sent', performance.now());
      toBottom();
    }
    vcRender(); render();
  }
  function voiceCancel() {
    const v = pv?.voice;
    if (!v?.pending) return;
    window.clearTimeout(v.pending.timer); v.pending = null; v.note = t('voice_cancelled');
    vcRender(); render();
  }
  function voiceAcked(cid: string, msg: string) {
    const v = pv?.voice;
    if (!v?.reply || v.reply.cid !== cid) return;
    v.reply.after = msg;
    if (v.ex) markExchange(v.ex, 'acked', performance.now());
    vcRender();
  }
  function voiceSay(say: string[]) {
    const v = pv?.voice;
    if (!v || !say.length) return;
    for (const s of say) if (v.s.say(s) && v.ex) markExchange(v.ex, 'say', performance.now());
    vcRender();
  }
  /** An agent message of the voice thread: its new sentences are spoken (voicesay.ts decides which). */
  function voiceOnMessage(m: Message) {
    const v = pv?.voice;
    if (!pv || !v?.reply || m.thread !== pv.thread || m.author.kind !== 'agent' || m.notice || m.preview || m.deleted || m.type !== 'text') return;
    const say = replyStep(v.reply, m.id, m.text);
    if (v.reply.msg === m.id && m.text.trim() && v.ex) markExchange(v.ex, 'text', performance.now());
    voiceSay(say);
    vcRender();
  }
  /** The agent's turn ended: the last partial sentence. */
  function voiceOnThread(f: PublicThread) {
    const v = pv?.voice;
    if (!pv || !v || f.id !== pv.thread) return;
    if (v.reply && f.state !== 'run') voiceSay(replyFlush(v.reply));
    const held = gateThread(v.gate, f.state);
    if (held) v.pending = { text: held, timer: window.setTimeout(voiceSend, 0) };
  }
  /** Panel body. Docked in the composer slot: one line (state, the words heard, the header's stop on its right), the
   *  transcript about to be sent shows in the conversation (voiceDraftEls). Full screen (no composer on screen): the
   *  transcript with Send / Cancel in the panel as before. The exchange's timings: hover on the state. */
  function vcRender() {
    const v = pv?.voice;
    if (!v) return;
    const failed = pv!.state.k === 'failed' || pv!.state.k === 'closed', docked = pv!.el.classList.contains('docked');
    const mode = failed ? '' : v.asking ? t('voice_asking', { agent: pv!.label }) : v.resume ? t('voice_resuming', { agent: (th => th ? cap(voiceAgentOf(th)) : pv!.label)(S.threads.get(pv!.thread)) }) : v.mode === 'start' ? t('voice_starting') : v.mode === 'speak' ? t('voice_speaking') : t('voice_listening');
    const timings = v.ex ? t('voice_metrics', exchangeDeltas(v.ex, lang())) : '';
    patch(v.panel, ...[
      h('div', { class: `vc-mode ${failed ? 'off' : v.mode}`, 'data-k': 'vc-mode', ...(timings ? { title: timings } : {}) }, icon('mic', 28) as unknown as Node,
        failed ? null : h('span', { class: 'ap-wave vc-lvl', 'data-k': 'vc-lvl', 'aria-hidden': 'true' }, ...v.lv.map(l => h('i', { class: `l${Math.max(1, l)}` }))), h('span', {}, mode),
        failed ? h('button', { class: 'btn vc-retry', type: 'button', 'data-k': 'vc-retry', onclick: voiceRetry }, t('voice_retry')) : null),
      v.words && (docked || !v.pending) ? h('div', { class: 'vc-words', 'data-k': 'vc-words' }, h('span', {}, v.words)) : null,
      !docked && v.pending ? h('div', { class: 'vc-turn', 'data-k': 'vc-turn' },
        h('div', { class: 'vc-lab' }, t('voice_heard')),
        h('div', { class: 'vc-text', 'data-k': 'vc-text' }, v.pending.text),
        h('div', { class: 'pc' }, t('voice_autosend')),
        h('div', { class: 'opts' },
          h('button', { class: 'btn pri', type: 'button', 'data-k': 'vc-send', onclick: voiceSend }, t('voice_send')),
          h('button', { class: 'btn', type: 'button', 'data-k': 'vc-cancel', onclick: voiceCancel }, t('voice_cancel'))))
        : !v.words && v.note ? h('div', { class: 'pc vc-note' }, v.note) : null,
      timings ? h('div', { class: 'vc-metrics', 'data-k': 'vc-metrics' }, timings) : null,
    ].filter((x): x is HTMLElement => !!x));
  }
  /** Microphone meter next to the mic icon: the last 5 chunk levels, newest on the right, set in place (12 per second:
   *  no render). Same bars as the audio player's waveform (`.ap-wave i.l1..l8`). */
  function vcLevel(v: VoiceUi, l: number) {
    v.lvs = smoothLevel(v.lvs, Math.min(MIC_LEVELS, l));
    v.lv.push(Math.round(v.lvs)); v.lv.shift();
    v.panel.querySelectorAll('.vc-lvl i').forEach((el, i) => { el.className = `l${Math.max(1, v.lv[i])}`; });
  }
  /** Voice mode docked in this conversation: what the user said and is not stored yet, as their own messages at the end
   *  of the list (held while the agent works, or sending). The auto-send delay (VOICE_AUTOSEND_MS) is too short to cancel,
   *  so « about to be sent » looks exactly like « sending »: no Send / Cancel row flashing in and out. Rules: voiceDrafts. */
  function voiceDraftEls(f: PublicThread): HTMLElement[] {
    const v = pv?.voice;
    if (!pv || !v || pv.thread !== f.id || !pv.el.classList.contains('docked')) return [];
    const msgs = S.msgs.get(f.id), name = personName(S.me) ?? t('you');
    return voiceDrafts({ held: v.gate.held, pending: v.pending?.text ?? '', sent: v.sent, reply: v.reply }, id => !!msgs?.has(id)).map(d =>
      h('div', { class: `m human vc-draft ${d.phase}`, 'data-k': `vc-draft:${f.id}:${d.phase}`, role: 'status' },
        h('div', { class: `avatar ${avatarClass({ kind: 'human', id: S.me })}` }, face(personAvatar(S.me, 'human'), name)),
        h('div', { class: 'm-body' },
          h('div', { class: 'm-head' }, h('span', { class: 'm-name' }, name),
            h('span', { class: 'm-time vc-st' }, d.phase === 'held' ? t('voice_held') : t('sending'))),
          h('div', { class: 'md' }, h('p', {}, d.text)))));
  }
  // Preview share (`preview_share`): while on, a conversation card like the others (band + icon, title, primary pill);
  // once stopped, a plain small line (like a card that is done).
  function previewLineEl(m: Message, th: PublicThread) {
    const p = m.preview!, screen = p.device !== undefined, ic = p.voice ? 'mic' : screen ? 'smartphone' : 'monitor';
    const trusted = S.trusted.has(th.space);
    // Stopped (by the agent, or by the hub when the agent lost the share): a lead asks the agent for it again in the thread.
    const reshare = () => {
      const text = previewReshareText(p, t);
      if (send({ type: 'post', client_id: rand().slice(0, 20), space: th.space, thread: th.id, text })) { noteMentions(th.space, text); toBottom(); }
    };
    // Voice: a plain small line, on or off, no button (the app opens it by itself; « Voice » in the composer opens or
    // asks for it again).
    if (p.voice)
      return h('div', { class: `propose off pv-line off pv-voice-line${p.status === 'on' ? ' on' : ' pv-dead'}`, title: fullDate(m.at), 'data-k': `pv:${m.id}` },
        icon(ic, 13) as unknown as Node, ' ', h('span', { class: 'md' }, t(p.status === 'on' ? 'preview_line_voice' : 'preview_line_off_voice', { agent: cap(p.agent) })));
    // Stopped: still a card (it was one), greyed and reduced to its band, the lead's button on the right.
    if (p.status !== 'on')
      return h('div', { class: 'propose pv-line pv-dead', title: fullDate(m.at), 'data-k': `pv:${m.id}` },
        h('div', { class: 'k-band' }, kindIc(ic),
          h('div', { class: 'k-lab' }, h('div', { class: 'k-t' }, t('preview_line_off', { label: p.label })),
            h('div', { class: 'k-s' }, screen ? t('preview_by_screen', { agent: cap(p.agent), device: p.device! }) : t('preview_by', { agent: cap(p.agent), port: p.port ?? 0 }))),
          trusted ? h('button', { class: 'btn pv-reshare', type: 'button', 'data-k': `pv-reshare:${m.id}`, onclick: reshare }, t('preview_reshare_btn')) : null));
    if (!PV_BASE)
      return h('div', { class: 'propose off pv-line off', title: fullDate(m.at), 'data-k': `pv:${m.id}` }, icon(ic, 13) as unknown as Node, ' ',
        h('span', { class: 'md' }, screen ? t('preview_line_screen', { agent: cap(p.agent), label: p.label }) : t('preview_line', { agent: cap(p.agent), label: p.label, port: p.port ?? 0 })));
    return h('div', { class: 'propose pv-line on k-preview', title: fullDate(m.at), 'data-k': `pv:${m.id}` },
      screen ? cardBand(ic, t('preview_card_screen'), t('preview_by_screen', { agent: cap(p.agent), device: p.device! }))
        : cardBand(ic, t('preview_card'), t('preview_by', { agent: cap(p.agent), port: p.port ?? 0 })),
      h('div', { class: 'k-body' },
        h('div', { class: 'ni-title md' }, p.label),
        h('div', { class: 'pc' }, t(screen ? 'preview_hint_screen' : 'preview_hint')),
        h('div', { class: 'opts' },
          trusted ? h('button', { class: 'btn pri pv-open', type: 'button', 'data-k': `pv-open:${m.id}`, onclick: () => openPreview(m) }, ...go(t(screen ? 'preview_open_screen' : 'preview_open')))
            : h('span', { class: 'pc' }, t('preview_lead_only')),
          trusted ? h('button', { class: 'btn pv-visit-new', type: 'button', 'data-k': `pv-visit:${m.id}`, disabled: pvVisitBusy === m.id, onclick: () => void visitLink(m, true) },
            withIcon('link', t(visitorLive(p, Date.now()) ? 'visit_new' : 'visit_btn'))) : null),
        trusted ? visitBox(m) : null));
  }
  // ---------------------------------------------------------------- visitor link (protocol/preview.ts « Visitor link »)
  // A lead makes a link for someone without an account; the token comes back to this tab only, kept in memory (never
  // stored): the card shows it with Copy / Share until the link ends. Any lead sees that a link is live and can revoke it.
  const pvVisits = new Map<string, { url: string; until: number; copied: boolean }>();
  let pvVisitBusy = '', pvVisitErr: { msg: string; text: string } | null = null;
  async function visitLink(m: Message, make: boolean) {
    if (!PV_BASE || pvVisitBusy) return;
    pvVisitBusy = m.id; pvVisitErr = null; render();
    const f = await request({ type: make ? 'preview.visitor' : 'preview.unvisitor', thread: m.thread, msg: m.id }, 10_000, true);
    pvVisitBusy = '';
    if (f?.type === 'preview.visitor') pvVisits.set(m.id, { url: `${PV_BASE}/__viewer/visit.html#t=${f.token}`, until: f.until, copied: false });
    else if (f?.type === 'ack') pvVisits.delete(m.id);
    else pvVisitErr = { msg: m.id, text: t('visit_err', { reason: previewReason(f?.type === 'error' ? f.code : 'timeout', t) }) };
    render();
  }
  function visitBox(m: Message) {
    const live = visitorLive(m.preview, Date.now()), mine = pvVisits.get(m.id);
    const err = pvVisitErr?.msg === m.id ? h('div', { class: 'err pv-visit-err', role: 'status' }, pvVisitErr.text) : null;
    if (!live) return err;
    const at = new Intl.DateTimeFormat(lang(), { hour: '2-digit', minute: '2-digit' }).format(live.until);
    const url = mine && mine.until === live.until ? mine.url : null;
    const copy = () => { if (!mine || !url) return;
      navigator.clipboard?.writeText(url).then(() => { mine.copied = true; render(); }, () => (document.getElementById(`pv-visit-url-${m.id}`) as HTMLInputElement | null)?.select()); };
    const share = () => { if (url) void navigator.share?.({ url }).catch(() => {}); };
    return h('div', { class: 'pv-visit', 'data-k': `pv-visit-box:${m.id}` },
      h('div', { class: 'pv-visit-head' }, h('span', { class: 'pc' }, withIcon('link', t('visit_live', { t: at }), 13)),
        h('button', { class: 'btn ghost pv-visit-revoke', type: 'button', 'data-k': `pv-visit-revoke:${m.id}`, disabled: pvVisitBusy === m.id, onclick: () => void visitLink(m, false) }, t('visit_revoke'))),
      url ? h('div', { class: 'sp-invite-row pv-visit-row' },
        h('input', { id: `pv-visit-url-${m.id}`, value: url, readonly: true, spellcheck: 'false', 'aria-label': t('visit_label'), onfocus: (e: Event) => (e.target as HTMLInputElement).select() }),
        h('button', { class: 'btn pri', type: 'button', 'data-k': `pv-visit-copy:${m.id}`, onclick: copy }, withIcon(mine!.copied ? 'check' : 'copy', t(mine!.copied ? 'visit_copied' : 'visit_copy'), 14)),
        typeof navigator.share === 'function' ? h('button', { class: 'btn', type: 'button', onclick: share }, t('visit_share')) : null) : null,
      url ? h('div', { class: 'sp-hint' }, t('visit_hint', { t: at })) : null, err);
  }
  return { openPreview, closePreview, onPreviewFrame, voiceDock, pvBar, askVoice, voiceAcked, voiceOnLine, voiceOnMessage, voiceOnThread, voiceDraftEls, previewLineEl, open: () => pv };
}
