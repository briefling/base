import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VOICE_SAY_MAX, VOICE_TURN_MAX, VOICE_WORD_MAX, isPreviewError, voiceClientMsg, voiceDaemonMsg } from '../../protocol/preview.ts';

test('voiceClientMsg: say (1..VOICE_SAY_MAX, no control character) and stop, re-built without unknown fields', () => {
  assert.deepEqual(voiceClientMsg({ type: 'say', text: "Ça va ? D'accord.", extra: 'x' }), { type: 'say', text: "Ça va ? D'accord." });
  assert.deepEqual(voiceClientMsg({ type: 'stop', text: 'x' }), { type: 'stop' });
  assert.ok(voiceClientMsg({ type: 'say', text: 'x'.repeat(VOICE_SAY_MAX) }));
  for (const bad of [null, 'say', 42, [], {}, { type: 'say' }, { type: 'say', text: '' }, { type: 'say', text: 'x'.repeat(VOICE_SAY_MAX + 1) },
    { type: 'say', text: 'a\nb' }, { type: 'say', text: 'a\u0000b' }, { type: 'say', text: 'a\u007fb' }, { type: 'say', text: 7 },
    { type: 'ready' }, { type: 'Say', text: 'x' }])
    assert.equal(voiceClientMsg(bad), null, JSON.stringify(bad));
});

test('voiceDaemonMsg: the five daemon types with bounded fields, anything else dropped', () => {
  assert.deepEqual(voiceDaemonMsg({ type: 'ready', x: 1 }), { type: 'ready' });
  assert.deepEqual(voiceDaemonMsg({ type: 'word', text: ' bonjour' }), { type: 'word', text: ' bonjour' });
  assert.deepEqual(voiceDaemonMsg({ type: 'turn', text: 'Bonjour.', flush_ms: 12 }), { type: 'turn', text: 'Bonjour.', flush_ms: 12 });
  assert.deepEqual(voiceDaemonMsg({ type: 'turn', text: 'x' }), { type: 'turn', text: 'x', flush_ms: 0 }, 'flush_ms defaults to 0');
  assert.deepEqual(voiceDaemonMsg({ type: 'tts_stop', reason: 'barge_in' }), { type: 'tts_stop', reason: 'barge_in' });
  assert.deepEqual(voiceDaemonMsg({ type: 'tts_stop', reason: 'stop' }), { type: 'tts_stop', reason: 'stop' });
  assert.deepEqual(voiceDaemonMsg({ type: 'tts_end', id: 4294967295 }), { type: 'tts_end', id: 4294967295 });
  for (const bad of [null, {}, { type: 'say', text: 'x' }, { type: 'word', text: 'x'.repeat(VOICE_WORD_MAX + 1) }, { type: 'word' },
    { type: 'turn', text: 'x'.repeat(VOICE_TURN_MAX + 1) }, { type: 'tts_stop', reason: 'other' }, { type: 'tts_end', id: -1 },
    { type: 'tts_end', id: 2 ** 32 }, { type: 'tts_end', id: 1.5 }, { type: 'tts_end', id: '3' }])
    assert.equal(voiceDaemonMsg(bad), null, JSON.stringify(bad));
});

test('no_voice is a preview error', () => assert.ok(isPreviewError('no_voice')));
