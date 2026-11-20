// Pinned applet (`#/<space>/applets/<id>`, client/src/appletsview.ts): one applet alone, as a mini-app of the home
// screen. Its own app (protocol/pinapp.ts): on opening, the client asks the hub where it lives (`pinapp.get`); the first
// time, or after a rename or a new emoji, it draws the 192 and 512 px icons from the emoji, uploads them like
// attachments and the hub publishes the manifest and icons under `/a/<token>/`; then the page moves to
// `/a/<token>/#/<space>/applets/<id>` and links that manifest (own `id`, `scope`, name, icons): Chrome on Android
// installs each applet as its own app. iOS « Add to Home Screen » takes the `apple-mobile-web-app-title` meta and an
// `apple-touch-icon` drawn here too (canvas, PNG data URL, no request). Outside `/a/<token>/` (no site storage, hub
// unreachable) the page keeps step 1's head: no manifest link, iOS would take briefling's `start_url` (`/`). Any other
// view puts briefling's own head back.
import type { HubFrame } from '../../protocol/frames.ts';
import { PIN_DRAWN, PIN_SIZES, pinRoot, pinTokenOf } from '../../protocol/pinapp.ts';

/** Home-screen icon size iOS asks for (px). */
const ICON = 180;

/** What made it onto the icon: the emoji at full size, the emoji drawn small then enlarged, the initial, or nothing. */
export type Drawn = typeof PIN_DRAWN[number];

/** `text` alone on a transparent square of `box` px, or null when the browser painted (almost) nothing: WebKit has
 *  been seen giving a blank glyph on a phone (an applet's home-screen icon came out as its tint alone). */
function glyph(text: string, font: string, color: string, box: number): HTMLCanvasElement | null {
  const c = document.createElement('canvas');
  c.width = c.height = box;
  const g = c.getContext('2d');
  if (!g) return null;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.font = font;
  g.fillText(text, box / 2, box * 0.54);
  try {
    const d = g.getImageData(0, 0, box, box).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 64) n++;
    return n >= box * box * 0.03 ? c : null;
  } catch { return null; }
}

const EMOJI_FONTS = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

function draw(name: string, emoji: string | undefined, hue: number, size: number): { c: HTMLCanvasElement; drawn: Drawn } | null {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) return null;
  const grad = g.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, `hsl(${hue} 70% 64%)`);
  grad.addColorStop(1, `hsl(${hue + 40} 65% 46%)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size); // full bleed: iOS and Android's masks round the corners themselves
  // the emoji in the central 56% (inside the maskable safe zone), drawn apart then laid on the tint; if the browser
  // paints nothing at that size, at 64 px enlarged; then the initial; never a blank icon without saying so
  const em = Math.round(size * 0.56), box = Math.round(em * 1.25); // the glyph's square, with room for its overhang
  const tries: [Drawn, () => HTMLCanvasElement | null][] = [
    ...(emoji ? [['emoji', () => glyph(emoji, `${em}px ${EMOJI_FONTS}`, '#000', box)], ['emoji-small', () => glyph(emoji, `64px ${EMOJI_FONTS}`, '#000', 80)]] as [Drawn, () => HTMLCanvasElement | null][] : []),
    ['letter', () => glyph(([...name][0] ?? '?').toUpperCase(), `600 ${Math.round(size * 0.5)}px system-ui, sans-serif`, '#fff', box)],
  ];
  for (const [drawn, make] of tries) {
    const l = make();
    if (!l) continue;
    g.imageSmoothingQuality = 'high';
    g.drawImage(l, (size - box) / 2, (size - box) / 2, box, box);
    return { c, drawn };
  }
  return { c, drawn: 'none' };
}

/** PNG (data URL) of the applet's emoji, else its initial, on its tint; '' when the browser draws none. */
export function pinIcon(name: string, emoji: string | undefined, hue: number): string {
  const d = draw(name, emoji, hue, ICON);
  try { return d ? d.c.toDataURL('image/png') : ''; } catch { return ''; }
}
/** The same icon as a PNG of `size` px and what it shows, null when the browser draws none. */
export const pinIconBlob = (name: string, emoji: string | undefined, hue: number, size: number) => new Promise<{ png: Blob; drawn: Drawn } | null>(res => {
  const d = draw(name, emoji, hue, size);
  if (!d) return res(null);
  try { d.c.toBlob(b => res(b ? { png: b, drawn: d.drawn } : null), 'image/png'); } catch { res(null); }
});

/** briefling's own head while an applet's is on (null: briefling's is on). */
let saved: { title: string; icon: string; manifest: HTMLLinkElement | null; href: string } | null = null;
let shown = '';

/** The head of the page for the applet on screen (null: briefling's own). Called on each render: only a change touches the DOM. */
export function pinHead(a: { id: string; name: string; emoji?: string; hue: number } | null): void {
  const key = a ? `${a.id}|${a.name}|${a.emoji ?? ''}` : '';
  if (key === shown) return;
  shown = key;
  const title = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
  const icon = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
  const token = pinTokenOf(location.pathname);
  if (a) {
    if (!saved) { const m = document.querySelector<HTMLLinkElement>('link[rel="manifest"]'); saved = { title: title?.getAttribute('content') ?? '', icon: icon?.getAttribute('href') ?? '', manifest: m, href: m?.getAttribute('href') ?? '' }; }
    // its own app: its manifest; else none (step 1, see the header)
    if (token && saved.manifest) { saved.manifest.setAttribute('href', `${pinRoot(token)}manifest.webmanifest`); if (!saved.manifest.isConnected) document.head.append(saved.manifest); }
    else saved.manifest?.remove();
    title?.setAttribute('content', a.name);
    icon?.setAttribute('href', pinIcon(a.name, a.emoji, a.hue) || saved.icon);
  } else if (saved) {
    title?.setAttribute('content', saved.title);
    icon?.setAttribute('href', saved.icon);
    if (saved.manifest) { saved.manifest.setAttribute('href', saved.href); if (!saved.manifest.isConnected) document.head.append(saved.manifest); }
    saved = null;
  }
}

/** What `pinApp` needs, injected (client/test/pinapp.test.ts). */
export interface PinDeps {
  request(f: { type: string; [k: string]: unknown }, ms?: number): Promise<HubFrame | null>;
  /** The applet's icon as a PNG of `size` px and what it shows (pinIconBlob). */
  icon(size: number): Promise<{ png: Blob; drawn: Drawn } | null>;
  /** Posts the upload form (`upload.ready.post`, the file last); true when stored. */
  upload(post: { url: string; fields: Record<string, string> }, file: Blob): Promise<boolean>;
  /** Path of the page (location.pathname). */
  path(): string;
  /** Opens the app's page (location.replace). */
  go(url: string): void;
}

/**
 * Makes sure the applet's app is published and fresh, then moves the page into it (`/a/<token>/` + the same hash).
 * Returns what happened, for the tests: 'moved', 'here' (already in it), or why it stays on step 1.
 */
export async function pinApp(d: PinDeps, space: string, id: string, hash: string): Promise<'moved' | 'here' | 'off' | 'failed'> {
  let st = await d.request({ type: 'pinapp.get', space, id }, 8000);
  if (st?.type !== 'pinapp.state') return 'off'; // pin_off, not_found, offline: the page stays as it is
  if (!st.fresh) {
    const icons: string[] = [], drawn: Drawn[] = [];
    for (const size of PIN_SIZES) {
      const ic = await d.icon(size);
      if (!ic) return 'failed';
      const png = ic.png;
      drawn.push(ic.drawn);
      const up = await d.request({ type: 'upload', space, name: `icon-${size}.png`, mime: 'image/png', size: png.size }, 8000);
      if (up?.type !== 'upload.ready' || !(await d.upload(up.post, png))) return 'failed';
      icons.push(up.file.id);
    }
    st = await d.request({ type: 'pinapp.get', space, id, icons, drawn }, 15000);
    if (st?.type !== 'pinapp.state' || !st.token) return 'failed';
  }
  if (!st.token) return 'failed';
  if (pinTokenOf(d.path()) === st.token) return 'here';
  d.go(`${pinRoot(st.token)}${hash}`);
  return 'moved';
}

/**
 * « Install » tapped inside an installed briefling (a home-screen app cannot add another one): the URL that opens the
 * applet in the phone's browser instead, where « Add to Home Screen » / « Install app » exist. iOS 17+: the
 * `x-safari-https://` scheme opens Safari; Android: an intent URL for Chrome (no fragment there, hence the query read
 * back by `installRoute`). null elsewhere (desktop): the applet opens in place.
 */
export function installUrl(os: 'ios' | 'android' | null, origin: string, space: string, id: string): string | null {
  const u = new URL(origin);
  if (os === 'ios') return `x-safari-${u.origin}/#/${encodeURIComponent(space)}/applets/${encodeURIComponent(id)}`;
  if (os === 'android') return `intent://${u.host}/?install=${encodeURIComponent(space)}/${encodeURIComponent(id)}#Intent;scheme=https;package=com.android.chrome;end`;
  return null;
}
/** The route a `?install=<space>/<applet>` query stands for (`#/<space>/applets/<applet>`), null without one. */
export function installRoute(search: string): string | null {
  const v = new URLSearchParams(search).get('install');
  const m = v ? /^([^/]+)\/([^/]+)$/.exec(v) : null;
  return m ? `#/${encodeURIComponent(m[1])}/applets/${encodeURIComponent(m[2])}` : null;
}
/** The phone's system, from the user agent (an iPad says « Macintosh » but has touch points). */
export const phoneOs = (ua: string, touch: number): 'ios' | 'android' | null =>
  /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touch > 1) ? 'ios' : /Android/.test(ua) ? 'android' : null;
