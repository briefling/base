// Image viewer (in-app, full screen): which images it walks through and which clicks open it. DOM-free, tested in
// client/test/viewer.test.ts; the view itself is `viewerEl()` in main.ts.
import { INLINE_IMAGE_MIME, type FileRef, type Message } from '../../protocol/frames.ts';

/** Images of a conversation, in display order: `msgs` must already be in `convOrder`. */
export function convImages(msgs: Iterable<Message>): FileRef[] {
  return [...msgs].flatMap(m => (m.files ?? []).filter(f => INLINE_IMAGE_MIME.includes(f.mime)));
}

/** A plain primary click opens the viewer; with a modifier (Cmd/Ctrl = new tab, Shift = new window, Alt = download)
 *  or another button (middle = new tab) the browser keeps its own behaviour on the link. */
export const opensViewer = (e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) =>
  e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

/** Image next to `fid` (-1 previous, +1 next); null at either end (no wrap-around) or when `fid` is not in the list. */
export function stepImage(list: FileRef[], fid: string, dir: -1 | 1): string | null {
  const i = list.findIndex(f => f.id === fid);
  return i < 0 ? null : list[i + dir]?.id ?? null;
}
