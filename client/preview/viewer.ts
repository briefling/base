// Viewer page of the preview origin (bundled to dist-preview/__viewer/viewer.js, loaded by __viewer/index.html in
// the app's overlay iframe). The WebRTC side is ./peer.ts; this page only carries its signaling by postMessage with
// the app (contract and gates: ./bridge.ts). The visitor page (./visit.ts) runs the same peer on its own hub socket.
import { fromParent, keyOfHash, toViewer, type FromViewer, type ViewerError } from './bridge.ts';
import { createViewerPeer } from './peer.ts';

export type ViewerEntry = true; // lets a test `import type` this file so `tsc -p .` checks it

const key = keyOfHash(location.hash);
let parents: string[] = [], parentOrigin: string | null = null;

function post(m: Omit<FromViewer, 'bp'> & { code?: ViewerError; sdp?: string }) {
  // Before the first message from the app we don't know which allowed origin it is: post to each one, only the
  // matching targetOrigin delivers.
  for (const o of parentOrigin ? [parentOrigin] : parents) window.parent.postMessage({ bp: 1, ...m }, o);
}
const peer = createViewerPeer(post);

async function main() {
  document.body.style.cssText = 'margin:0;background:#fff';
  try {
    const c = await (await fetch('/config.json', { cache: 'no-store' })).json() as { parents?: unknown };
    parents = Array.isArray(c.parents) ? c.parents.filter((x): x is string => typeof x === 'string') : [];
  } catch { parents = []; }
  if (window.parent === window || !parents.length) return; // not framed by an allowed app: nobody to talk to
  window.addEventListener('message', (e) => {
    if (!fromParent(e, parents, window.parent, window)) return; // gate: our parent, at an allowed app origin
    parentOrigin = e.origin;
    const m = toViewer(e.data);
    if (!m) return;
    if (m.type === 'ready') peer.connect(m.ice, m.screen === true, key);
    else if (m.type === 'gesture') peer.gesture(m.g);
    else if (m.type === 'answer') peer.answer(m.sdp);
    else if (m.type === 'candidate') peer.candidate(m.candidate, m.mid);
    else if (m.type === 'failed') peer.stop();
  });
  post({ type: 'hello' });
  if (!(await peer.sw)) { post({ type: 'failed', code: 'sw' }); peer.stop(); }
}
void main();
