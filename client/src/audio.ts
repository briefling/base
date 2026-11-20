// Audio attachments, DOM-free part: recorded format, file name, durations. The player and the recorder live in main.ts.
import { INLINE_AUDIO_MIME } from '../../protocol/frames.ts';

/** Shown with a player: exactly the types the hub serves inline (anything else is a download chip). */
export const isAudio = (mime: string) => INLINE_AUDIO_MIME.includes(mime);

/** Recording stops by itself after this (64 kbit/s: ~7 MB, well under the 20 MB attachment cap). */
export const REC_MAX_MS = 15 * 60_000;
export const REC_BITS = 64_000;

/** `audio/webm;codecs=opus` -> `audio/webm`: the hub only keeps a bare type (MIME_RE), a parameter would make it opaque. */
export const baseMime = (type: string) => type.split(';')[0].trim().toLowerCase();

/** First recording format the browser supports, opus first ('' = let the browser choose). */
export function recMime(supported: (m: string) => boolean): string {
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(supported) ?? '';
}

const EXT: Record<string, string> = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' };
const two = (n: number) => String(n).padStart(2, '0');
/** `audio-2026-10-21-1432.webm`, local time. */
export function recName(d: Date, mime: string): string {
  return `audio-${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}.${EXT[baseMime(mime)] ?? 'audio'}`;
}

/** 0:07, 12:30, 1:02:03; '' when unknown (a WebM straight from MediaRecorder reports Infinity until read through). */
export function fmtDur(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '';
  const n = Math.floor(s), h = Math.floor(n / 3600), m = Math.floor(n / 60) % 60, sec = two(n % 60);
  return h ? `${h}:${two(m)}:${sec}` : `${m}:${sec}`;
}

/** Waveform of the player: BARS bars, each at a height level 1..LEVELS (CSS classes `l1`..`l8`: the CSP forbids inline
 *  heights). Peak of each slice of the samples, scaled to the loudest one, so a quiet recording still fills the pill. */
export const BARS = 36;
export const LEVELS = 8;
export function peaksOf(samples: ArrayLike<number>, n = BARS): number[] {
  const out: number[] = [], len = samples.length;
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let j = Math.floor(i * len / n), end = Math.floor((i + 1) * len / n); j < end; j++) { const v = Math.abs(samples[j]); if (v > m) m = v; }
    out.push(m);
  }
  const top = Math.max(...out);
  return out.map(v => top > 0 ? Math.max(1, Math.ceil(v / top * LEVELS)) : 1);
}
/** Waveform shown until (or when) the file can't be analysed: a neutral, regular pattern. */
export const FLAT_PEAKS: number[] = Array.from({ length: BARS }, (_, i) => [3, 5, 4, 6, 3, 4][i % 6]);
/** Bars already played. */
export const playedBars = (t: number, dur: number, n = BARS) => Math.round(seekValue(t, dur) / 1000 * n);

/** Seek bar position, 0..1000 (the range input works in permille so it needs no known duration to render). */
export const seekValue = (t: number, dur: number) => dur > 0 && Number.isFinite(dur) ? Math.min(1000, Math.max(0, Math.round(t / dur * 1000))) : 0;
