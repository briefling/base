// Image viewer: a thumbnail opened full screen over the conversation, ←/→ through the conversation's images
// (rules: client/src/viewer.ts). Its own file since the modules refactor: main.ts reads `viewer` (open or not) for its
// dialogs and the render, and draws `viewerEl()`. Built once at load, at the place the block had in main.ts, so its
// window key listener keeps its order.
import type { FileRef, Message } from '../../protocol/frames.ts';
import type { UiKit } from './modules.ts';
import { convOrder } from './order.ts';
import { convImages, stepImage } from './viewer.ts';

/** The part of main.ts' app state the viewer reads and writes. */
export interface ViewerShared {
  msgs: Map<string, Map<string, Message>>;
  menu: unknown;
  picker: string;
}
export interface ViewerDeps {
  iconBtn(name: string, text: string, onclick: (e: Event) => void, extra?: Record<string, any>): HTMLElement;
  /** Signed read URL of a file (null: asked, not there yet). */
  urlFor(fid: string): string | null | undefined;
  downloadFile(f: FileRef): Promise<void>;
}

export function viewerModule(k: UiKit, S: ViewerShared, d: ViewerDeps) {
  const { h, t, icon, render } = k;
  const { iconBtn, urlFor, downloadFile } = d;
  /** Image viewer open over the conversation: the image shown and the thumbnail that opened it (focus goes back there). */
  let viewer: { thread: string; fid: string; from: string } | null = null;
  // ---------------------------------------------------------------- image viewer
  // A plain click on an image thumbnail opens it full screen over a dark scrim (Cmd/Ctrl/middle click still open the
  // link in a new tab). ←/→ walk the images of the same conversation in display order (`convOrder`), no wrap-around;
  // Esc, a click beside the image or the close button close it, and the focus goes back to the thumbnail. It shows the
  // same signed read URL as the thumbnail (`urlFor`). While it is open, keys never reach the page (composer, ⌘K, ↑ edit)
  // and the focus stays inside it; the composer autofocus skips it like the other dialogs.
  function openViewer(thread: string, fid: string) {
    viewer = { thread, fid, from: fid }; S.menu = null; S.picker = ''; render();
    (document.querySelector('.viewer .vw-close') as HTMLElement | null)?.focus();
  }
  function closeViewer() {
    const from = viewer?.from; viewer = null; render();
    if (from) (document.querySelector(`.conv .media[data-fid="${CSS.escape(from)}"] a`) as HTMLElement | null)?.focus({ preventScroll: true });
  }
  function viewerImages(thread: string) { return convImages(convOrder(S.msgs.get(thread)?.values() ?? [])); }
  function stepViewer(dir: -1 | 1) {
    const id = viewer && stepImage(viewerImages(viewer.thread), viewer.fid, dir);
    if (id && viewer) { viewer.fid = id; render(); }
    // A nav button that just got disabled (first / last image) drops the focus (at the next frame): put it on Close now.
    const a = document.activeElement as HTMLButtonElement | null;
    if (viewer && (!a?.closest('.viewer') || a.disabled)) (document.querySelector('.viewer .vw-close') as HTMLElement | null)?.focus();
  }
  function viewerEl() {
    const v = viewer!, list = viewerImages(v.thread), i = list.findIndex(x => x.id === v.fid), f = list[i];
    if (!f) return null; // its message is gone: nothing to show (render() closes it on the next conversation change)
    const u = urlFor(f.id);
    const nav = (dir: -1 | 1) => h('button', { class: `vw-nav ${dir < 0 ? 'vw-prev' : 'vw-next'}`, type: 'button', title: t(dir < 0 ? 'viewer_prev' : 'viewer_next'),
      'aria-label': t(dir < 0 ? 'viewer_prev' : 'viewer_next'), disabled: dir < 0 ? i === 0 : i === list.length - 1, onclick: () => stepViewer(dir) },
      icon(dir < 0 ? 'chevronLeft' : 'chevronRight', 28) as unknown as Node);
    return h('div', { class: 'viewer', 'data-k': 'viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('viewer') },
      h('div', { class: 'scrim', onclick: closeViewer }),
      h('div', { class: 'vw-bar' }, h('span', { class: 'vw-name', title: f.name }, f.name),
        list.length > 1 ? h('span', { class: 'vw-count' }, `${i + 1} / ${list.length}`) : null,
        iconBtn('download', t('download'), () => void downloadFile(f), { class: 'btn ic vw-dl' }),
        iconBtn('x', t('viewer_close'), closeViewer, { class: 'btn ic vw-close' })),
      nav(-1), nav(1),
      u ? h('img', { class: 'vw-img', src: u, alt: f.name }) : h('div', { class: 'vw-ph' }, t('ex_loading')));
  }
  // Capture phase on window: runs before every other key handler (document listeners, the composer's own), and stops them.
  // Default actions still happen: Tab moves the focus, Enter/Space press the focused button.
  window.addEventListener('keydown', (e) => {
    if (!viewer) return;
    e.stopImmediatePropagation();
    if (e.key === 'Escape') { e.preventDefault(); closeViewer(); }
    else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); stepViewer(e.key === 'ArrowLeft' ? -1 : 1); }
    else if (e.key === 'Tab') { // focus trap: Tab / Shift+Tab cycle through the viewer's buttons only
      const els = [...document.querySelectorAll<HTMLElement>('.viewer button:not(:disabled)')], i = els.indexOf(document.activeElement as HTMLElement), n = els.length;
      e.preventDefault(); els[i < 0 ? (e.shiftKey ? n - 1 : 0) : (i + (e.shiftKey ? n - 1 : 1)) % n]?.focus();
    }
  }, true);
  return { openViewer, closeViewer, viewerEl, get viewer() { return viewer; }, set viewer(v) { viewer = v; } };
}
