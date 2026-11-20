import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validRole, MAX_ROLE, maxFileBytes, MAX_FILE_BYTES, MAX_VIDEO_BYTES } from '../../protocol/frames.ts';

test('function (role): spaces collapsed, empty allowed, refused when too long or with a control or bidi character', () => {
  assert.equal(validRole('  Gérant   opcode '), 'Gérant opcode');
  assert.equal(validRole(''), '');
  assert.equal(validRole('a'.repeat(MAX_ROLE)), 'a'.repeat(MAX_ROLE));
  assert.equal(validRole('a'.repeat(MAX_ROLE + 1)), null);
  for (const c of ['\u202e', '\u2066', '\u200f', '\u200b', '\u0085']) assert.equal(validRole(`a${c}b`), null, JSON.stringify(c));
  assert.equal(validRole('a\ufeffb'), 'a b', 'a BOM is JS whitespace: collapsed to a space before the check');
  assert.equal(validRole(3), null);
});

test('attachment cap per type: 100 MB for a video the app plays inline or a zip archive, 20 MB for anything else', () => {
  assert.equal(MAX_FILE_BYTES, 20 * 1024 * 1024);
  assert.equal(MAX_VIDEO_BYTES, 100 * 1024 * 1024);
  for (const m of ['video/mp4', 'video/webm', 'video/quicktime']) assert.equal(maxFileBytes(m), MAX_VIDEO_BYTES, m);
  for (const m of ['application/zip', 'application/x-zip-compressed']) assert.equal(maxFileBytes(m), MAX_VIDEO_BYTES, m);
  for (const m of ['image/png', 'audio/webm', 'video/x-matroska', 'application/x-7z-compressed', 'application/gzip', 'application/pdf', '']) assert.equal(maxFileBytes(m), MAX_FILE_BYTES, m);
});
