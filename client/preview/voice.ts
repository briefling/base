// Voice channel, app side (bundled into app.js, imported by main.ts). Runs in the APP page, never in the preview
// iframe: the app holds the user's identity and the socket that posts the transcript, a top-level getUserMedia needs
// no iframe permission, and no agent-served content is rendered (so the preview origin's isolation is not needed).
// One RTCPeerConnection with one ordered data channel PREVIEW_VOICE_CHANNEL to the agent's peer, which relays it to
// the local voice daemon (wire grammar: protocol/preview.ts « Voice »):
// - microphone: getUserMedia (echo cancellation, noise suppression, AGC) -> AudioWorklet ./voice-worklet.ts ->
//   int16 24 kHz chunks of 3840 bytes -> dc.send;
// - daemon text -> voiceDaemonMsg -> hooks.onMsg; binary TTS [u32 id] + int16 PCM -> played back to back;
// - playback goes through a MediaStreamAudioDestinationNode into an <audio> element (srcObject): browsers feed media
//   element output to their echo canceller more reliably than plain Web Audio output (unverified on real hardware);
// - `tts_stop` (barge-in) fades out and stops every scheduled source and drops the queue;
// - an audio route change (Bluetooth on/off, a call) takes the microphone again (`rebuild`).
// The offer/answer/candidate code is a minimal copy of ../preview/viewer.ts (that file keeps module-level state for
// its single session; extracting it would have meant restructuring the viewer).
import { PREVIEW_GATHER_MS, PREVIEW_RELAY_GRACE_MS, PREVIEW_VOICE_CHANNEL, VOICE_CHUNK, VOICE_RATE, voiceClientMsg, voiceDaemonMsg,
  type VoiceClientMsg, type VoiceDaemonMsg } from '../../protocol/preview.ts';

/** After the answer, the data channel must open within this delay (same as the viewer). */
const OPEN_MS = 20_000;
/** First buffer of a burst starts this far ahead of the clock (no click when the next fragment arrives a bit late). */
const LEAD_S = 0.05;
/** Mic chunks are dropped while the channel holds more than this (a stalled link must not grow memory). */
const MIC_BACKLOG = 1 << 20;
/** Barge-in fade: a source stopped at full level clicks, a 15 ms ramp to 0 does not. */
const FADE_S = 0.015;
/** Route change: events of one switch come in a burst, rebuild once they settle; then ignore the events our own
 *  getUserMedia and new context cause for a while (else a rebuild would trigger the next one). */
export const ROUTE_SETTLE_MS = 500, ROUTE_QUIET_MS = 2000;

/** Context states that mean « the audio route moved under us »: running again after an interruption (WebKit's
 *  `interrupted`, or `suspended` since this code never suspends). The start (suspended -> running) does not count.
 *  One instance per context. */
export class CtxWatch {
  private ran = false;
  private cut = false;
  /** Feed each new `ctx.state`; true when the context is back from an interruption. */
  state(st: string): boolean {
    if (st === 'running') { const back = this.ran && this.cut; this.ran = true; this.cut = false; return back; }
    if (this.ran && (st === 'interrupted' || st === 'suspended')) this.cut = true;
    return false;
  }
}

/** A TTS fragment from the agent: [u32 LE id] + int16 LE PCM at VOICE_RATE. null when malformed. */
export function ttsFrame(buf: ArrayBuffer): { id: number; pcm: Int16Array } | null {
  if (!(buf instanceof ArrayBuffer) || buf.byteLength < 6 || buf.byteLength > VOICE_CHUNK || (buf.byteLength - 4) % 2) return null;
  const v = new DataView(buf), pcm = new Int16Array((buf.byteLength - 4) / 2);
  for (let i = 0; i < pcm.length; i++) pcm[i] = v.getInt16(4 + 2 * i, true);
  return { id: v.getUint32(0, true), pcm };
}

/** Back-to-back schedule of playback items (AudioBufferSourceNode in the app, plain objects in tests). */
export class PlayQueue<T> {
  private items: { item: T; end: number }[] = [];
  private end = 0;
  /** Start time of an item of `dur` seconds queued at clock `now`: right after the previous one, or now + lead. */
  add(item: T, dur: number, now: number, lead = LEAD_S): number {
    this.items = this.items.filter(x => x.end > now);
    const at = Math.max(this.end, now + (this.items.length ? 0 : lead));
    this.end = at + dur;
    this.items.push({ item, end: this.end });
    return at;
  }
  /** Something still playing or scheduled at `now`. */
  busy(now: number): boolean { return this.end > now; }
  /** Barge-in or close: every item scheduled (to stop), the queue empty. */
  clear(): T[] { const out = this.items.map(x => x.item); this.items = []; this.end = 0; return out; }
}

export interface VoiceHooks {
  /** Complete offer, to send as preview.offer. */
  onOffer(sdp: string): void;
  onOpen(): void;
  onMsg(m: VoiceDaemonMsg): void;
  /** First TTS fragment of a sentence scheduled; `ms` = when it will be heard (performance.now() clock). */
  onAudio(id: number, ms: number): void;
  /** Level of each microphone chunk sent (80 ms), 0 (silence) to MIC_LEVELS: the panel's small meter. */
  onLevel?(level: number): void;
  /** mic: getUserMedia refused or failed; channel: the connection did not open. */
  onFail(code: 'mic' | 'mic_dead' | 'channel'): void;
  /** The open channel dropped (the agent's gateway restarted, the network went away). The peer connection is already
   *  dropped; true = the page resumes (the microphone and the playback stay, `connect` may run again), false = closed. */
  onLost?(): boolean;
  onClosed(): void;
}
export interface VoiceSession {
  connect(ice: RTCIceServer[]): void;
  answer(sdp: string): void;
  candidate(candidate: string, mid: string | null): void;
  /** Speak one sentence (false: not sent, channel not open or text refused). */
  say(text: string): boolean;
  /** Stop speaking: drop the local queue and tell the daemon. */
  stop(): void;
  /** Drop the peer connection only (an open the hub or the agent refused): the microphone and the playback stay, and
   *  `connect` may run again for a new session. */
  reset(): void;
  close(): void;
}

const MIC: MediaStreamConstraints = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } };
/** Mic watchdog (see `watch` in startVoice). */
export const MIC_SILENT_MS = 2000, MIC_RETRIES = 2;

/** Keeps the screen on while the voice is open (Screen Wake Lock): a locked iPhone cuts the voice, and taking the
 *  microphone again after an unlock shows its permission prompt again (a Home Screen web app keeps that permission for
 *  the launch only: bugs.webkit.org 280394, 327237). Works in Home Screen web apps since iOS 18.4 (bugs.webkit.org
 *  254545). The browser drops the lock whenever the page is hidden: asked again when it is visible. No API or a
 *  refusal (low battery): nothing, the voice works as before. */
export class ScreenAwake {
  private lock: { release(): Promise<void> } | null = null;
  private on = false;
  private readonly onVis = () => { if (this.on && document.visibilityState === 'visible') this.take(); };
  start() { this.on = true; this.take(); document.addEventListener('visibilitychange', this.onVis); }
  stop() {
    this.on = false; document.removeEventListener('visibilitychange', this.onVis);
    const l = this.lock; this.lock = null; void l?.release().catch(() => {});
  }
  private take() {
    const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
    if (!wl) return;
    void wl.request('screen').then((l) => { if (this.on) this.lock = l; else void l.release().catch(() => {}); }, () => {});
  }
}

/** Starts the microphone and the audio context at once (call it inside the click: iOS needs the gesture), the peer
 *  connection on `connect` (preview.ready). */
export function startVoice(hooks: VoiceHooks, worklet: string): VoiceSession {
  const awake = new ScreenAwake();
  awake.start(); // in the tap, like the microphone
  let pc: RTCPeerConnection | null = null, dc: RTCDataChannel | null = null;
  let remoteSet = false, opened = false, done = false;
  let gen = 0; // peer connection generation: timers and events of a dropped one do nothing
  const early: RTCIceCandidateInit[] = [];
  const ctx = new AudioContext();
  void ctx.resume().catch(() => {});
  const dest = ctx.createMediaStreamDestination();
  const out = ctx.createGain(); // every TTS source goes through it: hush fades it out
  out.connect(dest);
  const audio = new Audio();
  audio.srcObject = dest.stream; audio.autoplay = true;
  void audio.play().catch(() => {});
  const queue = new PlayQueue<AudioBufferSourceNode>();
  let lastId = -1; // id of the sentence whose first fragment was already reported
  let stream: MediaStream | null = null, node: AudioWorkletNode | null = null, src: MediaStreamAudioSourceNode | null = null;
  let chunks = 0; // mic chunks the worklet produced: none after the channel opened = a dead capture (see watch)
  let rebuilding = false, quietUntil = 0, routeT = 0;

  const fail = (code: 'mic' | 'mic_dead' | 'channel') => { if (done) return; done = true; hooks.onFail(code); teardown(); };
  const onChunk = (e: MessageEvent) => {
    chunks++;
    if (dc?.readyState === 'open' && dc.bufferedAmount < MIC_BACKLOG) dc.send(e.data as ArrayBuffer);
    hooks.onLevel?.(micLevel(new Int16Array(e.data as ArrayBuffer)));
  };
  /** Microphone stream -> worklet of context `c`. One output, pulled through a zero-gain node into the destination:
   *  Safari never runs the process() of a worklet that nothing pulls (no error, just silence; seen on an iPhone,
   *  documented by Lightning Jar « Safari does not render a worklet that nothing pulls », and Chromium issue 41377033
   *  for older Chrome). */
  async function wire(c: AudioContext, s: MediaStream) {
    await c.audioWorklet.addModule(worklet);
    const n = new AudioWorkletNode(c, 'briefling-mic', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1 });
    n.port.onmessage = onChunk;
    const sr = c.createMediaStreamSource(s); sr.connect(n);
    const mute = c.createGain();
    mute.gain.value = 0;
    n.connect(mute).connect(c.destination);
    return { n, sr };
  }
  function watchCtx(c: AudioContext) {
    const w = new CtxWatch();
    c.onstatechange = () => { if (w.state(c.state)) onRoute(); };
  }
  void (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia(MIC);
      if (done) { stream.getTracks().forEach(t => t.stop()); return; }
      const w = await wire(ctx, stream);
      if (done) return;
      node = w.n; src = w.sr;
      watchCtx(ctx);
      navigator.mediaDevices.addEventListener('devicechange', onRoute);
    } catch (e) { if (done) return; console.warn('voice: microphone', e); fail('mic'); } // closed while loading: not a failure
  })();

  /** The audio route changed (Bluetooth headset or car connected or gone, a call ended). WebKit can then keep feeding
   *  the capture at the old route's rate (the daemon got 44.1 kHz audio labelled 48 kHz after a Bluetooth switch in a
   *  car, and the STT heard nothing; bugs.webkit.org 232822, 258864). The mismatch shows nowhere in the page (the
   *  context clock stays right), so take the microphone again on the event: a new capture is set up for the current
   *  route. The context is kept: a new one made outside a tap stays suspended on iOS (seen on an iPhone: the worklet
   *  never ran, `mic_dead`), and this one was unlocked by the tap that opened the voice. */
  function onRoute() {
    if (done || !node || rebuilding || performance.now() < quietUntil) return;
    clearTimeout(routeT);
    routeT = window.setTimeout(() => void rebuild(), ROUTE_SETTLE_MS);
  }
  async function rebuild() {
    if (done || rebuilding) return;
    rebuilding = true;
    try {
      void ctx.resume().catch(() => {});
      await reopenMic();
      console.info('voice route: microphone taken again', ctx.sampleRate, stream?.getAudioTracks()[0]?.getSettings().sampleRate); // not « voice: », the prefix of failures
    } catch (e) { console.warn('voice: route change', e); fail('mic'); }
    finally { rebuilding = false; quietUntil = performance.now() + ROUTE_QUIET_MS; }
  }

  function play(buf: ArrayBuffer) {
    const f = ttsFrame(buf);
    if (!f || done) return;
    const b = ctx.createBuffer(1, f.pcm.length, VOICE_RATE), ch = b.getChannelData(0);
    for (let i = 0; i < f.pcm.length; i++) ch[i] = f.pcm[i] / 0x8000;
    const src = ctx.createBufferSource();
    src.buffer = b; src.connect(out);
    const at = queue.add(src, b.duration, ctx.currentTime);
    src.start(at);
    if (f.id !== lastId) { lastId = f.id; hooks.onAudio(f.id, performance.now() + Math.max(0, at - ctx.currentTime) * 1000); }
  }
  /** The channel is open and the worklet produced no chunk in MIC_SILENT_MS (it posts even silence, so none means no
   *  input at all): resume the context and take the microphone again, at most MIC_RETRIES times, then fail with
   *  `mic_dead`. WebKit can give a page's later capture a track that never delivers, cleared only by a reload
   *  (bugs.webkit.org/show_bug.cgi?id=180748: « stop the track, then getUserMedia again », sometimes twice). */
  function watch(tries: number) {
    const seen = chunks;
    setTimeout(() => {
      if (done || chunks > seen) return;
      const tr = stream?.getAudioTracks()[0];
      console.warn('voice: no microphone audio', ctx.state, tr?.readyState, tr?.muted);
      if (tries >= MIC_RETRIES || !node) return fail('mic_dead');
      void ctx.resume().catch(() => {});
      void reopenMic().then(() => watch(tries + 1), () => fail('mic'));
    }, MIC_SILENT_MS);
  }
  async function reopenMic() {
    stream?.getTracks().forEach(t => t.stop()); src?.disconnect();
    const s = await navigator.mediaDevices.getUserMedia(MIC);
    if (done) { s.getTracks().forEach(t => t.stop()); return; }
    stream = s; src = ctx.createMediaStreamSource(s); src.connect(node!);
  }
  /** Stop every queued sentence: a short fade on `out`, then the sources stop (a hard stop mid-waveform clicks). */
  function hush() {
    const now = ctx.currentTime, g = out.gain;
    g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(0, now + FADE_S);
    g.setValueAtTime(1, now + FADE_S); // the next sentence starts LEAD_S ahead, after the fade
    for (const s of queue.clear()) {
      s.onended = () => s.disconnect();
      try { s.stop(now + FADE_S); } catch { /* not started */ }
    }
  }
  function onData(e: MessageEvent) {
    if (typeof e.data !== 'string') { play(e.data as ArrayBuffer); return; }
    let o: unknown;
    try { o = JSON.parse(e.data); } catch { return; }
    const m = voiceDaemonMsg(o);
    if (!m) return;
    if (m.type === 'tts_stop') hush();
    hooks.onMsg(m);
  }
  function send(m: VoiceClientMsg | null): boolean {
    if (!m || dc?.readyState !== 'open') return false;
    dc.send(JSON.stringify(m)); return true;
  }
  function dropPeer() {
    gen++;
    hush();
    const p = pc, d = dc;
    pc = null; dc = null; remoteSet = false; opened = false; early.length = 0;
    try { d?.close(); } catch { /* closed */ }
    p?.close();
  }
  function lost() {
    if (done) return;
    dropPeer();
    if (hooks.onLost?.()) return;
    done = true; hooks.onClosed(); teardown();
  }
  function teardown() {
    awake.stop();
    clearTimeout(routeT);
    navigator.mediaDevices?.removeEventListener('devicechange', onRoute);
    ctx.onstatechange = null;
    hush();
    try { dc?.close(); } catch { /* closed */ }
    pc?.close();
    stream?.getTracks().forEach(t => t.stop());
    src?.disconnect(); node?.disconnect();
    audio.pause(); audio.srcObject = null;
    void ctx.close().catch(() => {});
  }

  async function connect(ice: RTCIceServer[]) {
    if (pc || done) return;
    pc = new RTCPeerConnection({ iceServers: ice });
    const d = dc = pc.createDataChannel(PREVIEW_VOICE_CHANNEL, { ordered: true });
    d.binaryType = 'arraybuffer';
    d.onopen = () => { if (d !== dc) return; opened = true; hooks.onOpen(); watch(0); };
    d.onclose = () => { if (d === dc && opened) lost(); };
    d.onmessage = onData;
    const p = pc;
    p.onconnectionstatechange = () => { if (p === pc && p.connectionState === 'failed') { if (opened) lost(); else fail('channel'); } };
    // Complete offer (the agent's plugin hands it to its peer once): same gathering rule as the viewer.
    const gathered = new Promise<void>((res) => {
      p.onicegatheringstatechange = () => { if (p.iceGatheringState === 'complete') res(); };
      p.onicecandidate = (e) => {
        if (!e.candidate) res();
        else if (/ typ relay /.test(e.candidate.candidate)) setTimeout(res, PREVIEW_RELAY_GRACE_MS);
      };
      setTimeout(res, PREVIEW_GATHER_MS);
    });
    try {
      await p.setLocalDescription(await p.createOffer());
      await gathered;
    } catch { if (p === pc) fail('channel'); return; }
    if (!done && p === pc) hooks.onOffer(p.localDescription!.sdp);
  }
  async function answer(sdp: string) {
    if (!pc || remoteSet || done) return;
    const p = pc, g = gen;
    try { await p.setRemoteDescription({ type: 'answer', sdp }); } catch { if (g === gen) fail('channel'); return; }
    if (g !== gen) return;
    remoteSet = true;
    for (const c of early.splice(0)) await p.addIceCandidate(c).catch(() => {});
    setTimeout(() => { if (g === gen && !opened) fail('channel'); }, OPEN_MS);
  }
  async function candidate(c: string, mid: string | null) {
    const init: RTCIceCandidateInit = { candidate: c, ...(mid === null ? { sdpMLineIndex: 0 } : { sdpMid: mid }) };
    if (!pc) return;
    if (!remoteSet) { early.push(init); return; }
    await pc.addIceCandidate(init).catch(() => {});
  }
  return {
    connect: (ice) => void connect(ice),
    answer: (sdp) => void answer(sdp),
    candidate: (c, mid) => void candidate(c, mid),
    say: (text) => send(voiceClientMsg({ type: 'say', text })),
    stop: () => { hush(); send({ type: 'stop' }); },
    reset: () => { if (!done) dropPeer(); },
    close: () => { if (done) return; done = true; teardown(); },
  };
}

/** Meter steps of the voice panel (CSS classes l1..l8 of the audio player's bars). */
export const MIC_LEVELS = 8;
/** Level of one int16 chunk: its RMS in dBFS mapped from -55 dB (0, silence and room noise) to -15 dB (MIC_LEVELS,
 *  loud speech close to the phone), rounded to a step. */
export function micLevel(pcm: Int16Array): number {
  if (!pcm.length) return 0;
  let sq = 0;
  for (let i = 0; i < pcm.length; i++) sq += pcm[i] * pcm[i];
  const db = 20 * Math.log10(Math.sqrt(sq / pcm.length) / 32768 + 1e-9);
  return Math.max(0, Math.min(MIC_LEVELS, Math.round(((db + 55) / 40) * MIC_LEVELS)));
}
/** Meter level smoothed over chunks (continuous, not rounded): fast attack, slow release, so the bars follow the voice
 *  without flickering between syllables. */
export function smoothLevel(prev: number, raw: number): number {
  return prev + (raw - prev) * (raw > prev ? 0.5 : 0.2);
}
