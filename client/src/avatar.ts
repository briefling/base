// Profile photo picked in the browser -> data URL the hub accepts (protocol/frames.ts validAvatar): centred square,
// AVATAR_PX, webp (jpeg where the browser can't encode webp, Safari before 17). The hub checks it again.
import { AVATAR_PX, validAvatar } from '../../protocol/frames.ts';

/** Centred square of a w×h image: the part kept. */
export const squareOf = (w: number, h: number) => { const s = Math.min(w, h); return { sx: (w - s) / 2, sy: (h - s) / 2, s }; };
/** Decoding a huge file costs memory for nothing: past this, refused before reading. */
export const AVATAR_FILE_MAX = 20 * 1024 * 1024;
export type AvatarError = 'avatar_type' | 'avatar_read' | 'avatar_big';
/** Any raster image the browser decodes; SVG never (it can carry script, and the hub refuses it anyway). */
export const pickable = (type: string) => type.startsWith('image/') && !type.includes('svg');

export async function shrinkAvatar(file: Blob): Promise<string | AvatarError> {
  if (!pickable(file.type)) return 'avatar_type';
  if (file.size > AVATAR_FILE_MAX) return 'avatar_big';
  let img: ImageBitmap;
  try { img = await createImageBitmap(file); } catch { return 'avatar_read'; }
  const c = document.createElement('canvas'); c.width = c.height = AVATAR_PX;
  const g = c.getContext('2d');
  if (!g) return 'avatar_read';
  const { sx, sy, s } = squareOf(img.width, img.height);
  g.imageSmoothingQuality = 'high';
  const draw = () => g.drawImage(img, sx, sy, s, s, 0, 0, AVATAR_PX, AVATAR_PX);
  draw();
  for (const q of [0.85, 0.7, 0.5]) { const u = c.toDataURL('image/webp', q); if (u.startsWith('data:image/webp') && validAvatar(u)) return u; }
  // No webp encoder: jpeg on white (no transparency in jpeg, it would turn black).
  g.fillStyle = '#fff'; g.fillRect(0, 0, AVATAR_PX, AVATAR_PX); draw();
  for (const q of [0.85, 0.7, 0.5]) { const u = c.toDataURL('image/jpeg', q); if (validAvatar(u)) return u; }
  return 'avatar_big';
}
