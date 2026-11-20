import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAudio, baseMime, recMime, recName, fmtDur, seekValue, peaksOf, playedBars, FLAT_PEAKS, BARS, LEVELS } from '../src/audio.ts';

test('audio: the player is only for the types the hub serves inline', () => {
  for (const m of ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav']) assert.ok(isAudio(m), m);
  for (const m of ['audio/x-unknown', 'video/webm', 'image/png', 'audio/webm;codecs=opus']) assert.ok(!isAudio(m), m);
});

test('audio: recorded type is sent bare, so the hub keeps it', () => {
  assert.equal(baseMime('audio/webm;codecs=opus'), 'audio/webm');
  assert.equal(baseMime('Audio/MP4'), 'audio/mp4');
  assert.equal(baseMime(''), '');
});

test('audio: recording format, opus first, Safari falls back to mp4', () => {
  assert.equal(recMime(() => true), 'audio/webm;codecs=opus');
  assert.equal(recMime(m => m === 'audio/mp4'), 'audio/mp4');
  assert.equal(recMime(() => false), '');
});

test('audio: recording file name from the local time and the format', () => {
  const d = new Date(2026, 9, 21, 9, 5);
  assert.equal(recName(d, 'audio/webm;codecs=opus'), 'audio-2026-10-21-0905.webm');
  assert.equal(recName(d, 'audio/mp4'), 'audio-2026-10-21-0905.m4a');
  assert.equal(recName(d, 'audio/x-thing'), 'audio-2026-10-21-0905.audio');
});

test('audio: waveform peaks, scaled to the loudest slice, levels 1..8', () => {
  const s = new Float32Array(400);
  for (let i = 0; i < 100; i++) s[i] = i % 2 ? -0.5 : 0.5;  // first quarter: half the loudest
  for (let i = 200; i < 300; i++) s[i] = 0.25 * (i % 2 ? 1 : -1) * (i === 250 ? 4 : 1); // one spike at 1.0
  assert.deepEqual(peaksOf(s, 4), [4, 1, 8, 1]);
  assert.deepEqual(peaksOf(new Float32Array(10), 4), [1, 1, 1, 1]); // silence
  assert.equal(peaksOf(new Float32Array(1000)).length, BARS);
  assert.ok(FLAT_PEAKS.length === BARS && FLAT_PEAKS.every(l => l >= 1 && l <= LEVELS));
  assert.equal(playedBars(5, 10), 18);
  assert.equal(playedBars(0, 10), 0);
  assert.equal(playedBars(10, 10), BARS);
  assert.equal(playedBars(3, NaN), 0);
});

test('audio: durations and seek position', () => {
  assert.equal(fmtDur(7.9), '0:07');
  assert.equal(fmtDur(750), '12:30');
  assert.equal(fmtDur(3723), '1:02:03');
  assert.equal(fmtDur(Infinity), '');
  assert.equal(fmtDur(NaN), '');
  assert.equal(seekValue(5, 10), 500);
  assert.equal(seekValue(12, 10), 1000);
  assert.equal(seekValue(3, Infinity), 0);
  assert.equal(seekValue(3, 0), 0);
});
