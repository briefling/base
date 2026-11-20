// Pinned applet as its own installable app (docs/design-applets.md « Pinned applet »). The hub publishes, per applet,
// a web app manifest and two PNG icons on the site under `/a/<token>/` (a random token: the files never name the applet
// to someone without the link). Each applet is its own app for Chrome on Android: its own `id` and its own `scope`, so
// two applets give two icons (same-origin apps with one shared scope collapse into one). The page is index.html, served
// at `/a/<token>/` (CloudFront Function / standalone server), routed by its hash like everywhere else.
// Pure helpers shared by the hub (hub/src/pinapp.ts), the standalone server and the client (client/src/pinapp.ts).

/** Icon sizes published (px): what Chrome asks for an installable app and its splash screen. */
export const PIN_SIZES = [192, 512] as const;
/** Largest icon accepted (bytes): a 512 px emoji on a tint weighs ~30-90 KB. */
export const PIN_ICON_MAX = 400 * 1024;
/** Site path prefix of the pinned applets (S3 key prefix `a/`, CloudFront behaviour `/a/*`). */
export const PIN_PREFIX = 'a';
/** A token: 128 random bits, base64url (22 chars). */
export const PIN_TOKEN = /^[A-Za-z0-9_-]{22}$/;
/** The only files under `a/<token>/`. */
export const PIN_FILES = ['manifest.webmanifest', 'icon-192.png', 'icon-512.png'] as const;
/** A site key the hub may write or a server may serve: `a/<token>/<one of PIN_FILES>`. */
export const pinFileOk = (key: string) => {
  const [p, tok, file, ...rest] = key.split('/');
  return p === PIN_PREFIX && PIN_TOKEN.test(tok ?? '') && (PIN_FILES as readonly string[]).includes(file ?? '') && !rest.length;
};
/** The app's root path (its scope and the page it opens). */
export const pinRoot = (token: string) => `/${PIN_PREFIX}/${token}/`;
/** Token of the pinned app this page path belongs to, null elsewhere. */
export const pinTokenOf = (path: string): string | null => {
  const m = /^\/a\/([A-Za-z0-9_-]{22})\/(?:index\.html)?$/.exec(path);
  return m ? m[1] : null;
};
/** What the published files depend on: a rename or a new emoji makes them stale (icons redrawn, manifest rewritten). */
// `ICON_V`: bumped when the drawing changes, so published icons are drawn again (2: a blank glyph is retried, Nov 17).
const ICON_V = 2;
export const pinKey = (a: { name: string; emoji?: string }) => `${ICON_V}\n${a.name}\n${a.emoji ?? ''}`;
/** What the client managed to draw on the icons (logged by the hub: a blank icon gets explained). */
export const PIN_DRAWN = ['emoji', 'emoji-small', 'letter', 'none'] as const;

/** The applet's manifest. `start_url` opens the applet alone (`#/<space>/applets/<id>`, plan step 1) inside its scope. */
export function pinManifest(a: { id: string; name: string }, space: string, token: string) {
  const root = pinRoot(token);
  return {
    id: root,
    name: a.name,
    short_name: a.name,
    start_url: `${root}#/${encodeURIComponent(space)}/applets/${encodeURIComponent(a.id)}`,
    scope: root,
    display: 'standalone',
    background_color: '#f0ece5',
    theme_color: '#efebe4',
    // full-bleed tint, emoji within the central 56%: inside the maskable safe zone (80% circle)
    icons: [
      { src: `${root}icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${root}icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `${root}icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Width and height of a PNG (signature, then IHDR first), null when the bytes are not one. */
export function pngSize(b: Uint8Array): { w: number; h: number } | null {
  if (b.length < 24 || SIG.some((x, i) => b[i] !== x)) return null;
  if (String.fromCharCode(b[12], b[13], b[14], b[15]) !== 'IHDR') return null;
  const u32 = (i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  return { w: u32(16), h: u32(20) };
}
