// Pinned applet as its own app on the home screen (protocol/pinapp.ts, docs/design-applets.md « Pinned applet »).
// `pinapp.get`: whoever may launch the applet asks where its app lives; the first time, and after a rename or a new
// emoji, the client draws the two icons (it has the emoji fonts, the hub has none), uploads them like attachments and
// sends their ids: the hub checks they are this person's fresh PNG uploads of the right sizes, copies them to the site
// under `a/<token>/`, writes the manifest from the applet as stored (never a name sent by the client) and drops the
// uploads. One token per applet, kept across updates (an installed app keeps its id); deleting the applet deletes the
// files (applets.ts). Stored as `SPACE#<s>` / `APPIN#<applet>`. Off when the hub has no site storage (`pin_off`).
import { randomBytes } from 'node:crypto';
import type { HubFrame, Principal } from '../../protocol/frames.ts';
import { canLaunch } from '../../protocol/applets.ts';
import { PIN_DRAWN, PIN_FILES, PIN_ICON_MAX, PIN_PREFIX, PIN_SIZES, pinKey, pinManifest, pngSize } from '../../protocol/pinapp.ts';
import { appletRole } from './applets.ts';
import { fileKey, id, memberSpace, need, type Deps } from './router.ts';
import type { HubModule } from './modules.ts';

const KIND = 'APPIN';
interface StoredPin { id: string; token: string; key: string; at: number; version: number }

const siteKey = (token: string, file: typeof PIN_FILES[number]) => `${PIN_PREFIX}/${token}/${file}`;

async function human(deps: Deps, who: Principal, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  need(f.type === 'pinapp.get', 'unknown_type');
  need(typeof f.client_id === 'string' && f.client_id.length > 0 && f.client_id.length <= 64 && typeof f.space === 'string' && id(f.id));
  need(f.icons === undefined || (Array.isArray(f.icons) && f.icons.length === PIN_SIZES.length && f.icons.every(id)));
  need(f.drawn === undefined || (Array.isArray(f.drawn) && f.drawn.length <= PIN_SIZES.length && f.drawn.every((x: unknown) => (PIN_DRAWN as readonly unknown[]).includes(x))));
  const space = await memberSpace(deps, who, f.space);
  const a = (await deps.store.listApplets(space.id)).find(x => x.id === f.id);
  need(!!a && canLaunch(a, appletRole(space, who.id)), 'not_found');
  need(!!deps.site && !!deps.files?.getBytes, 'pin_off');
  const cur = await deps.store.getItem<StoredPin>(space.id, KIND, a!.id);
  const key = pinKey(a!);
  const state = (p: StoredPin | null) => reply({ v: 2, type: 'pinapp.state', client_id: f.client_id, space: space.id, id: a!.id,
    ...(p ? { token: p.token } : {}), fresh: !!p && p.key === key });
  if (!f.icons) return void await state(cur);
  // The icons: this person's uploads in this space, not posted anywhere, PNGs of the published sizes.
  const found = await deps.store.getAttachments(f.icons);
  const bytes: Uint8Array[] = [];
  for (const [i, fid] of (f.icons as string[]).entries()) {
    const up = found.find(x => x.id === fid);
    need(!!up && up.space === space.id && up.by === who.id && !up.msg && up.mime === 'image/png' && up.size <= PIN_ICON_MAX, 'bad_file');
    const b = await deps.files!.getBytes!(fileKey(space.id, fid));
    need(!!b && b.length <= PIN_ICON_MAX, 'file_not_uploaded');
    const dim = pngSize(b!);
    need(!!dim && dim.w === PIN_SIZES[i] && dim.h === PIN_SIZES[i], 'bad_file');
    bytes.push(b!);
  }
  const token = cur?.token ?? randomBytes(16).toString('base64url');
  // icons first: the manifest never points at a missing one
  for (const [i, size] of PIN_SIZES.entries()) await deps.site!.put(siteKey(token, `icon-${size}.png`), bytes[i], 'image/png');
  await deps.site!.put(siteKey(token, 'manifest.webmanifest'), JSON.stringify(pinManifest(a!, space.id, token)), 'application/manifest+json');
  const next: StoredPin = { id: a!.id, token, key, at: deps.now(), version: (cur?.version ?? 0) + 1 };
  need(await deps.store.putItem(space.id, KIND, next, cur ? cur.version : null), 'stale');
  for (const fid of f.icons as string[]) await deps.files!.remove(fileKey(space.id, fid)); // copied: the uploads go
  console.log('pinapp_put', JSON.stringify({ space: space.id, applet: a!.id, by: who.id, created: !cur, drawn: f.drawn ?? null }));
  await state(next);
}

/** The applet is deleted: its app's files and record go (an installed icon then opens on « applet gone »). */
export async function dropPin(deps: Deps, space: string, applet: string) {
  const cur = await deps.store.getItem<StoredPin>(space, KIND, applet);
  if (!cur) return;
  if (deps.site) for (const file of PIN_FILES) await deps.site.remove(siteKey(cur.token, file));
  await deps.store.deleteItem(space, KIND, applet);
}

export const pinapp: HubModule = { prefix: 'pinapp', human };
