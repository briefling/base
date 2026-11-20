// Visitor page of the preview origin (protocol/preview.ts « Visitor link »), bundled to __viewer/visit.js and loaded by
// __viewer/visit.html: someone without a briefling account opens ONE preview from a link a lead gave them. No app, no
// login: the page opens its own WebSocket to the hub with the link's token (`#t=`, never sent to a server but the
// hub's authorizer) and runs the same WebRTC peer as the overlay's viewer (./peer.ts). The hub only takes the preview
// frames of that line from this socket. A cut (network change, agent peer restarted) reloads the page within a small
// budget (./visitlogic.ts): the hub then gives a new session in place of the dead one.
import { PROTOCOL } from '../../protocol/frames.ts';
import { VISITOR_PREFIX, visitorTokenOfHash, type IceServer } from '../../protocol/preview.ts';
import { previewKey } from './bridge.ts';
import { createViewerPeer, type ViewerPeer } from './peer.ts';
import { VISIT_PING_MS, VISIT_RETRY_DELAY_MS, visitOutcome, visitRetry, visitText, type VisitEnd, type VisitKey } from './visitlogic.ts';

export type VisitEntry = true; // lets a test `import type` this file so `tsc -p .` checks it

const RETRIES = 'briefling.visit.retries';
const lang = navigator.language || 'en';
const token = visitorTokenOfHash(location.hash);
let ws: WebSocket | null = null, peer: ViewerPeer | null = null, session = '', until: number | null = null, ended = false;

const bar = document.createElement('div');
bar.className = 'visit-bar';
bar.setAttribute('role', 'status');
function say(k: VisitKey) { bar.textContent = visitText(k, lang); bar.hidden = false; }

/** The page stops for good (until a manual retry): the message replaces the preview. */
function end(why: VisitEnd) {
  if (ended) return;
  ended = true; peer?.stop(); ws?.close();
  document.querySelectorAll('.stage, iframe, .visit-nav').forEach(e => e.remove());
  const box = document.createElement('div');
  box.className = 'visit-end';
  const p = document.createElement('p');
  p.textContent = visitText(why, lang);
  box.append(p);
  if (why !== 'expired' && why !== 'stopped') {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = visitText('retry', lang);
    b.onclick = () => { sessionStorage.removeItem(RETRIES); location.reload(); };
    box.append(b);
  }
  bar.hidden = true;
  document.body.append(box);
}
/** A cut that may heal: reload within the budget, else stop. */
function cut(code: string) {
  if (ended) return;
  const o = visitOutcome(code);
  if (o !== 'retry') return end(o);
  let past: number[] = [];
  try { past = JSON.parse(sessionStorage.getItem(RETRIES) ?? '[]') as number[]; } catch { past = []; }
  const now = Date.now();
  if (!visitRetry(Array.isArray(past) ? past : [], now, until)) return end(until !== null && now >= until ? 'expired' : 'error');
  sessionStorage.setItem(RETRIES, JSON.stringify([...past, now]));
  ended = true; peer?.stop(); ws?.close();
  say('reconnecting');
  setTimeout(() => location.reload(), VISIT_RETRY_DELAY_MS);
}
const send = (f: object) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ v: 2, ...f })); };

function onReady(f: { session: string; ice: IceServer[]; device?: string; port?: number; until?: number }) {
  session = f.session;
  until = typeof f.until === 'number' ? f.until : null;
  if (until !== null) setTimeout(() => end('expired'), Math.max(0, until - Date.now()));
  const screen = typeof f.device === 'string';
  if (screen) navBar();
  peer = createViewerPeer((e) => {
    if (e.type === 'offer') send({ type: 'preview.offer', session, sdp: e.sdp });
    else if (e.type === 'open') bar.hidden = true;
    else if (e.type === 'loaded') { sessionStorage.removeItem(RETRIES); }
    else if (e.type === 'closed') cut('closed');
    else if (e.type === 'failed') { send({ type: 'preview.close', session }); cut(e.code === 'channel' ? 'channel' : 'error'); }
  });
  peer.connect(f.ice, screen, previewKey('visit', f.port ?? 0));
}

/** Android's navigation bar under the picture (the overlay has it in the app's header). */
function navBar() {
  document.documentElement.classList.add('visit-screen');
  const nav = document.createElement('div');
  nav.className = 'visit-nav';
  for (const [k, label] of [['back', '◀'], ['home', '●'], ['recents', '■']] as const) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label; b.setAttribute('aria-label', k);
    b.onclick = () => peer?.gesture({ k: 'key', key: k });
    nav.append(b);
  }
  document.body.append(nav);
}

async function main() {
  document.documentElement.classList.add('visit');
  document.body.append(bar);
  if (!token) return end('expired');
  say('connecting');
  let wsUrl = '';
  try { const c = await (await fetch('/config.json', { cache: 'no-store' })).json() as { wsUrl?: unknown }; wsUrl = typeof c.wsUrl === 'string' ? c.wsUrl : ''; }
  catch { wsUrl = ''; }
  if (!/^wss:\/\//.test(wsUrl)) return end('error');
  let opened = false;
  ws = new WebSocket(wsUrl, [PROTOCOL, `${VISITOR_PREFIX}${token}`]);
  ws.onopen = () => { opened = true; send({ type: 'preview.open', client_id: 'visit' }); };
  // Refused at the handshake = the hub's authorizer said no: the link is over. Closed later = a cut.
  ws.onclose = () => { if (!opened) end('expired'); else cut('socket'); };
  ws.onmessage = (e) => {
    let f: any;
    try { f = JSON.parse(String(e.data)); } catch { return; }
    if (!f || f.v !== 2) return;
    if (f.type === 'preview.ready') onReady(f);
    else if (f.session !== session && f.type !== 'error') return;
    else if (f.type === 'preview.answer') peer?.answer(f.sdp);
    else if (f.type === 'preview.candidate') peer?.candidate(f.candidate, f.mid ?? null);
    else if (f.type === 'preview.failed') cut(String(f.code));
    else if (f.type === 'error') cut(String(f.code));
  };
  setInterval(() => send({ type: 'ping' }), VISIT_PING_MS);
}
void main();
