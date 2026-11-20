// The viewer's WebRTC side, shared by the overlay's viewer page (./viewer.ts, signaling through the app by
// postMessage) and the visitor page (./visit.ts, signaling on its own hub WebSocket): opens the peer connection with
// the session's ICE servers, sends its complete offer, then relays the service worker's requests on the data channel
// (framing: ./wire.ts) and shows the previewed page in a full-size inner iframe at `/`, or the device screen
// (./screen.ts). Everything this page holds is readable by the previewed page (same origin): it only ever holds this
// session's signaling (and, on the visitor page, the link's token: it grants this preview only).
import { PREVIEW_CHANNEL, PREVIEW_GATHER_MS, PREVIEW_RELAY_GRACE_MS, PREVIEW_SCREEN_CHANNEL, type ScreenGesture } from '../../protocol/preview.ts';
import type { ViewerError } from './bridge.ts';
import { startScreen } from './screen.ts';
import { decodeChunk, parseHead, requestFrame } from './wire.ts';

/** After the answer, the data channel must open within this delay. */
const OPEN_MS = 20_000;

/** What the peer tells its page: the same vocabulary as the viewer -> app messages (./bridge.ts). */
export type PeerEvent = { type: 'offer'; sdp: string } | { type: 'open' | 'loaded' | 'closed' } | { type: 'failed'; code: ViewerError };
export interface ViewerPeer {
  /** Session ready: connect with these ICE servers; `key` names the service worker's cache (web preview). */
  connect(ice: RTCIceServer[], screen: boolean, key: string | null): void;
  answer(sdp: string): void;
  candidate(candidate: string, mid: string | null): void;
  gesture(g: ScreenGesture): void;
  /** The other side gave up: stop, report nothing. */
  stop(): void;
  /** The service worker registration (null: none, the web preview cannot run). */
  sw: Promise<ServiceWorkerRegistration | null>;
}

export function createViewerPeer(emit: (e: PeerEvent) => void): ViewerPeer {
  let pc: RTCPeerConnection | null = null, dc: RTCDataChannel | null = null;
  let remoteSet = false, opened = false, done = false, screen = false, key: string | null = null;
  let gesture: ((g: ScreenGesture) => void) | null = null; // a screen share's channel, once open
  const early: RTCIceCandidateInit[] = []; // trickled before the answer was applied
  const sw = navigator.serviceWorker ? navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => null) : Promise.resolve(null);

  function closed() {
    if (!opened || done) return;
    done = true; emit({ type: 'closed' });
  }
  function fail(code: ViewerError) {
    if (done) return;
    done = true; emit({ type: 'failed', code }); pc?.close();
  }

  async function connect(ice: RTCIceServer[], isScreen: boolean) {
    if (pc) return; // one session per peer
    screen = isScreen;
    pc = new RTCPeerConnection({ iceServers: ice });
    dc = pc.createDataChannel(screen ? PREVIEW_SCREEN_CHANNEL : PREVIEW_CHANNEL, { ordered: true });
    dc.binaryType = 'arraybuffer';
    dc.onopen = () => void onOpen();
    dc.onclose = closed;
    pc.onconnectionstatechange = () => { if (pc?.connectionState === 'failed') { if (opened) closed(); else fail('channel'); } };
    const p = pc;
    // Complete offer: the trickle events are collected into localDescription; send once gathering is complete,
    // PREVIEW_RELAY_GRACE_MS after the first relay candidate (a TURN candidate reaches the agent from any network: the
    // slower TURN/TLS URIs would only add copies of it; measured live: 2.2 s to connect waiting for the cap), or after
    // PREVIEW_GATHER_MS with what we have (the agent's plugin hands the offer to its peer once, no trickle that way).
    const gathered = new Promise<void>((res) => {
      p.onicegatheringstatechange = () => { if (p.iceGatheringState === 'complete') res(); };
      p.onicecandidate = (e) => {
        if (!e.candidate) res();
        else if (/ typ relay /.test(e.candidate.candidate)) setTimeout(res, PREVIEW_RELAY_GRACE_MS);
      };
      setTimeout(res, PREVIEW_GATHER_MS);
    });
    await p.setLocalDescription(await p.createOffer());
    await gathered;
    if (done) return;
    emit({ type: 'offer', sdp: p.localDescription!.sdp });
  }

  async function onAnswer(sdp: string) {
    if (!pc || remoteSet) return;
    try { await pc.setRemoteDescription({ type: 'answer', sdp }); } catch { return fail('channel'); }
    remoteSet = true;
    for (const c of early.splice(0)) await pc.addIceCandidate(c).catch(() => {});
    setTimeout(() => { if (!opened) fail('channel'); }, OPEN_MS);
  }
  function candidateInit(candidate: string, mid: string | null): RTCIceCandidateInit {
    // '' = end of candidates (an empty candidate is the standard end-of-candidates signal)
    return { candidate, ...(mid === null ? { sdpMLineIndex: 0 } : { sdpMid: mid }) };
  }
  async function onCandidate(candidate: string, mid: string | null) {
    const c = candidateInit(candidate, mid);
    if (!pc) return;
    if (!remoteSet) { early.push(c); return; }
    await pc.addIceCandidate(c).catch(() => {});
  }

  // ---------------------------------------------------------------- relay: service worker <-> data channel
  type SwReq = { id: number; m: string; u: string; h: Record<string, string>; b: ArrayBuffer | null };
  let nextId = 1;
  const routes = new Map<number, { port: MessagePort; id: number }>(); // channel id -> the worker request

  function sendPort(reg: ServiceWorkerRegistration) {
    const ch = new MessageChannel();
    ch.port1.onmessage = (e) => {
      const r = e.data as SwReq, id = nextId++;
      const f = requestFrame(id, r.m, r.u, r.h, r.b ? new Uint8Array(r.b) : null);
      if (!f || dc?.readyState !== 'open') { ch.port1.postMessage({ id: r.id, type: 'error', msg: f ? 'channel closed' : 'refused' }); return; }
      routes.set(id, { port: ch.port1, id: r.id });
      dc.send(f);
    };
    (reg.active ?? navigator.serviceWorker.controller)?.postMessage({ type: 'port', key }, [ch.port2]);
  }

  function onData(e: MessageEvent) {
    if (typeof e.data === 'string') {
      const head = parseHead(e.data), r = head && routes.get(head.id);
      if (!head || !r) return;
      if ('err' in head) { routes.delete(head.id); r.port.postMessage({ id: r.id, type: 'error', msg: head.err }); }
      else r.port.postMessage({ id: r.id, type: 'head', s: head.s, h: head.h });
      return;
    }
    const c = decodeChunk(e.data as ArrayBuffer), r = c && routes.get(c.id);
    if (!c || !r) return;
    if (c.last) routes.delete(c.id);
    const data = c.data.buffer as ArrayBuffer;
    r.port.postMessage({ id: r.id, type: 'chunk', data, last: c.last }, [data]);
  }

  async function onOpen() {
    opened = true;
    emit({ type: 'open' });
    if (screen) { gesture = startScreen(dc!, () => emit({ type: 'loaded' }), fail); return; }
    const reg = await sw;
    if (!reg) return fail('sw');
    await navigator.serviceWorker.ready;
    if (done) return;
    dc!.onmessage = onData;
    navigator.serviceWorker.addEventListener('message', (e) => { if ((e.data as { type?: unknown })?.type === 'need-port') sendPort(reg); });
    sendPort(reg);
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;background:#fff';
    frame.onload = () => emit({ type: 'loaded' });
    frame.src = '/';
    document.body.append(frame);
  }

  return {
    connect(ice, isScreen, k) { key = k; void connect(ice, isScreen).catch(() => fail('channel')); },
    answer: (sdp) => void onAnswer(sdp),
    candidate: (c, mid) => void onCandidate(c, mid),
    gesture: (g) => gesture?.(g),
    stop() { done = true; pc?.close(); },
    sw,
  };
}
