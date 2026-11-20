// Microphone DSP of the voice channel, DOM-free: shared by the AudioWorklet (./voice-worklet.ts) and the unit tests.
// The AudioContext runs at the device's default rate (Firefox refuses a MediaStream source in a context at another
// rate), so the worklet resamples to VOICE_RATE, converts to int16 and cuts VOICE_CHUNK_SAMPLES chunks (80 ms).
import { VOICE_CHUNK_SAMPLES, VOICE_RATE } from '../../protocol/preview.ts';

/** Streaming resampler, state kept across blocks (the worklet gets 128 frames at a time). An exact 2:1 ratio (48 kHz)
 *  averages each pair (a small low-pass against aliasing); any other ratio interpolates linearly. */
export class Resampler {
  private pos = 0; // read position of the next output sample, in input samples, relative to the current block
  private last = 0; // last input sample of the previous block (index -1)
  private half: number | null = null; // 2:1 only: an odd sample waiting for its pair
  readonly from: number; readonly to: number; readonly step: number;
  constructor(from: number, to = VOICE_RATE) { this.from = from; this.to = to; this.step = from / to; }
  push(x: Float32Array): Float32Array {
    if (this.from === this.to) return x.slice();
    if (this.step === 2) {
      const out: number[] = [];
      let i = 0;
      if (this.half !== null && x.length) { out.push((this.half + x[0]) / 2); this.half = null; i = 1; }
      for (; i + 1 < x.length; i += 2) out.push((x[i] + x[i + 1]) / 2);
      if (i < x.length) this.half = x[i];
      return Float32Array.from(out);
    }
    const out: number[] = [];
    // sample at fractional index p (-1 <= p < n - 1): between x[floor] and the next one; x[-1] = last of the previous block
    const at = (k: number) => k < 0 ? this.last : x[k];
    while (this.pos <= x.length - 1) {
      const k = Math.floor(this.pos), f = this.pos - k;
      out.push(f === 0 ? at(k) : at(k) + (at(k + 1) - at(k)) * f);
      this.pos += this.step;
    }
    this.pos -= x.length;
    if (x.length) this.last = x[x.length - 1];
    return Float32Array.from(out);
  }
}

/** Float [-1, 1] to int16, clamped. */
export function toInt16(x: Float32Array): Int16Array {
  const out = new Int16Array(x.length);
  for (let i = 0; i < x.length; i++) { const v = Math.max(-1, Math.min(1, x[i])); out[i] = v < 0 ? Math.round(v * 0x8000) : Math.round(v * 0x7fff); }
  return out;
}

/** Cuts a stream of int16 samples into chunks of exactly `n` samples (the daemon's STT frame). */
export class Chunker {
  private buf: Int16Array;
  private len = 0;
  readonly n: number;
  constructor(n = VOICE_CHUNK_SAMPLES) { this.n = n; this.buf = new Int16Array(n); }
  push(s: Int16Array): Int16Array[] {
    const out: Int16Array[] = [];
    let i = 0;
    while (i < s.length) {
      const take = Math.min(this.n - this.len, s.length - i);
      this.buf.set(s.subarray(i, i + take), this.len); this.len += take; i += take;
      if (this.len === this.n) { out.push(this.buf); this.buf = new Int16Array(this.n); this.len = 0; }
    }
    return out;
  }
}
