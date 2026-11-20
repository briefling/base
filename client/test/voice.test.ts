import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chunker, Resampler, toInt16 } from '../preview/voicedsp.ts';
import { CtxWatch, MIC_LEVELS, PlayQueue, ScreenAwake, micLevel, smoothLevel, ttsFrame } from '../preview/voice.ts';
import type { WorkletEntry } from '../preview/voice-worklet.ts';
import { VOICE_CHUNK, VOICE_CHUNK_SAMPLES, VOICE_SAY_MAX, voiceClientMsg, voiceDaemonMsg } from '../../protocol/preview.ts';

const _w: WorkletEntry = true; void _w; // tsc checks the worklet file

test('resample 48 kHz -> 24 kHz: half the samples across blocks, pairs averaged', () => {
  const rs = new Resampler(48_000);
  let n = 0, out: number[] = [];
  for (let b = 0; b < 375; b++) { const x = new Float32Array(128).map((_, i) => ((b * 128 + i) % 2 ? 1 : 0)); const y = rs.push(x); n += y.length; out = [...out.slice(-4), ...y]; }
  assert.equal(n, 375 * 64, '1 s in, 0.5 s out... of 24 kHz = 24000 samples');
  assert.ok(out.every(v => v === 0.5), 'the Nyquist tone is averaged out (low-pass)');
  const odd = new Resampler(48_000);
  assert.equal(odd.push(new Float32Array([0.2, 0.4, 0.6])).length, 1);
  assert.deepEqual([...odd.push(new Float32Array([0.8]))].map(v => +v.toFixed(3)), [0.7], 'an odd sample waits for its pair');
});

test('resample 44.1 kHz and 16 kHz: linear, the right count over a second, continuous at block edges', () => {
  for (const from of [44_100, 16_000, 96_000]) {
    const rs = new Resampler(from);
    let n = 0, prev = -Infinity, mono = true;
    for (let i = 0; i < from; i += 128) {
      const x = new Float32Array(Math.min(128, from - i)).map((_, k) => (i + k) / from); // a ramp 0 -> 1
      for (const v of rs.push(x)) { if (v < prev) mono = false; prev = v; n++; }
    }
    assert.ok(Math.abs(n - 24_000) <= 1, `${from}: ${n}`);
    assert.ok(mono, `${from}: the ramp stays monotonic across blocks`);
  }
  assert.deepEqual([...new Resampler(24_000).push(new Float32Array([0.5, -0.5]))], [0.5, -0.5], 'same rate: a copy');
});

test('toInt16 clamps and scales', () => {
  assert.deepEqual([...toInt16(new Float32Array([0, 1, -1, 2, -3, 0.5]))], [0, 32767, -32768, 32767, -32768, 16384]);
});

test('chunker: exact 80 ms chunks (1920 samples = 3840 bytes), the rest kept for the next push', () => {
  const ch = new Chunker();
  assert.equal(ch.push(new Int16Array(1000)).length, 0);
  const a = ch.push(new Int16Array(3000).fill(7));
  assert.equal(a.length, 2);
  assert.ok(a.every(c => c.length === VOICE_CHUNK_SAMPLES && c.buffer.byteLength === 3840));
  assert.equal(a[0][999], 0); assert.equal(a[0][1000], 7);
  assert.notEqual(a[0].buffer, a[1].buffer, 'each chunk owns its buffer (transferred to the main thread)');
  assert.equal(ch.push(new Int16Array(1759)).length, 0, '4000 - 3840 = 160 kept, + 1759 = one short');
  assert.equal(ch.push(new Int16Array(1)).length, 1);
});

test('ttsFrame: u32 LE id then int16 LE PCM; malformed fragments refused', () => {
  const b = new ArrayBuffer(10), v = new DataView(b);
  v.setUint32(0, 0x01020304, true); v.setInt16(4, -2, true); v.setInt16(6, 300, true); v.setInt16(8, 32767, true);
  const f = ttsFrame(b)!;
  assert.equal(f.id, 0x01020304);
  assert.deepEqual([...f.pcm], [-2, 300, 32767]);
  assert.equal(ttsFrame(new ArrayBuffer(4)), null, 'id only');
  assert.equal(ttsFrame(new ArrayBuffer(7)), null, 'half a sample');
  assert.equal(ttsFrame(new ArrayBuffer(VOICE_CHUNK + 2)), null, 'over the fragment cap');
  assert.ok(ttsFrame(new ArrayBuffer(VOICE_CHUNK)));
});

test('PlayQueue: back to back after a small lead, clear() returns everything to stop and resets the clock', () => {
  const q = new PlayQueue<string>();
  assert.equal(q.add('a', 0.5, 10), 10.05);
  assert.equal(q.add('b', 0.25, 10.1), 10.55, 'right after a');
  assert.equal(q.busy(10.7), true);
  assert.deepEqual(q.clear(), ['a', 'b'], 'barge-in: both stopped');
  assert.equal(q.busy(10.7), false);
  assert.equal(q.add('c', 0.1, 10.7), 10.75, 'after a clear: a fresh start, not after b');
  assert.equal(q.add('d', 0.1, 20), 20.05, 'idle gap: lead again');
  assert.deepEqual(q.clear(), ['d'], 'finished items are not kept');
});

test('voiceClientMsg / voiceDaemonMsg: only the known shapes, bounded', () => {
  assert.deepEqual(voiceClientMsg({ type: 'say', text: 'Salut.', extra: 1 }), { type: 'say', text: 'Salut.' });
  assert.equal(voiceClientMsg({ type: 'say', text: '' }), null);
  assert.equal(voiceClientMsg({ type: 'say', text: 'a\u0007b' }), null);
  assert.equal(voiceClientMsg({ type: 'say', text: 'x'.repeat(VOICE_SAY_MAX + 1) }), null);
  assert.deepEqual(voiceClientMsg({ type: 'stop' }), { type: 'stop' });
  assert.equal(voiceClientMsg({ type: 'post', text: 'x' }), null);
  assert.deepEqual(voiceDaemonMsg({ type: 'turn', text: 'Bonjour', flush_ms: 120 }), { type: 'turn', text: 'Bonjour', flush_ms: 120 });
  assert.deepEqual(voiceDaemonMsg({ type: 'tts_stop', reason: 'barge_in' }), { type: 'tts_stop', reason: 'barge_in' });
  assert.equal(voiceDaemonMsg({ type: 'tts_stop', reason: 'other' }), null);
  assert.equal(voiceDaemonMsg({ type: 'word', text: 'x'.repeat(201) }), null);
  assert.equal(voiceDaemonMsg({ type: 'tts_end', id: -1 }), null);
  assert.equal(voiceDaemonMsg(null), null);
});

test('micLevel: silence 0, room noise 0, speech in the middle, a loud chunk at the top', () => {
  const tone = (amp: number) => Int16Array.from({ length: 1920 }, (_, i) => Math.round(amp * Math.sin(i / 3)));
  assert.equal(micLevel(new Int16Array(0)), 0);
  assert.equal(micLevel(new Int16Array(1920)), 0);
  assert.equal(micLevel(tone(30)), 0, 'about -63 dBFS');
  const mid = micLevel(tone(1500));
  assert.ok(mid > 0 && mid < MIC_LEVELS, String(mid));
  assert.equal(micLevel(tone(32767)), MIC_LEVELS);
  assert.ok(micLevel(tone(3000)) > mid, 'louder = higher');
});

test('smoothLevel: rises faster than it falls, converges on a sustained level, decays to 0 in a few steps', () => {
  assert.ok(smoothLevel(0, 8) - 0 > 8 - smoothLevel(8, 0), 'attack faster than release');
  let v = 0;
  for (let i = 0; i < 12; i++) v = smoothLevel(v, 5);
  assert.equal(Math.round(v), 5);
  assert.ok(Math.abs(v - 5) < 0.01, 'a sustained level converges');
  v = smoothLevel(8, 0);
  assert.ok(Math.round(v) > 0, 'one silent chunk does not drop the bar to 0');
  for (let i = 0; i < 15; i++) v = smoothLevel(v, 0);
  assert.equal(Math.round(v), 0, 'silence decays to 0 within ~1.3 s');
});

test('CtxWatch: back from an interruption counts as a route change, the start and a plain run do not', () => {
  const w = new CtxWatch();
  assert.equal(w.state('suspended'), false, 'a new context starts suspended');
  assert.equal(w.state('running'), false, 'then runs: the start, not a route change');
  assert.equal(w.state('running'), false);
  assert.equal(w.state('interrupted'), false, 'WebKit: a call or a route switch takes the audio');
  assert.equal(w.state('running'), true, 'given back: rebuild');
  assert.equal(w.state('running'), false, 'once');
  assert.equal(w.state('suspended'), false);
  assert.equal(w.state('running'), true, 'suspended by the system (this code never suspends) counts too');
  assert.equal(w.state('closed'), false);
  const fresh = new CtxWatch();
  assert.equal(fresh.state('interrupted'), false);
  assert.equal(fresh.state('running'), false, 'interrupted before it ever ran: still the start');
});

test('ScreenAwake: screen lock taken at start, again when the page is visible, released at stop; no API = nothing', async () => {
  const g = globalThis as unknown as { navigator?: unknown; document?: unknown };
  const saved = [Object.getOwnPropertyDescriptor(g, 'navigator'), Object.getOwnPropertyDescriptor(g, 'document')];
  const ev = new EventTarget() as EventTarget & { visibilityState: string };
  ev.visibilityState = 'visible';
  let asked = 0, released = 0;
  const wakeLock = { request: async (t: string) => { assert.equal(t, 'screen'); asked++; return { release: async () => { released++; } }; } };
  const tick = () => new Promise(r => setTimeout(r, 0));
  try {
    Object.defineProperty(g, 'navigator', { value: { wakeLock }, configurable: true });
    Object.defineProperty(g, 'document', { value: ev, configurable: true });
    const a = new ScreenAwake();
    a.start(); await tick();
    assert.equal(asked, 1);
    ev.visibilityState = 'hidden'; ev.dispatchEvent(new Event('visibilitychange')); await tick();
    assert.equal(asked, 1, 'hidden: no request (the browser refuses it)');
    ev.visibilityState = 'visible'; ev.dispatchEvent(new Event('visibilitychange')); await tick();
    assert.equal(asked, 2, 'visible again: asked again (the browser dropped it)');
    a.stop(); await tick();
    assert.equal(released, 1);
    ev.dispatchEvent(new Event('visibilitychange')); await tick();
    assert.equal(asked, 2, 'stopped: never asked again');
    Object.defineProperty(g, 'navigator', { value: {}, configurable: true });
    const b = new ScreenAwake(); b.start(); b.stop(); // no wakeLock: no throw
  } finally {
    for (const [k, d] of [['navigator', saved[0]], ['document', saved[1]]] as const)
      if (d) Object.defineProperty(g, k, d); else delete (g as Record<string, unknown>)[k];
  }
});
