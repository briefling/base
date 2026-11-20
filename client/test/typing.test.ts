import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TYPING_EVERY_MS, TYPING_TTL_MS, noteTyping, typersOf, typingFrame, typingWho, type Typing } from '../src/typing.ts';
import { setLang, tn } from '../src/i18n.ts';

test('typingFrame: on at the first key, then at most every 3 s; off once emptied, only after an on', () => {
  assert.equal(typingFrame(undefined, 'h', 1000), 'on');
  assert.equal(typingFrame(1000, 'he', 1000 + TYPING_EVERY_MS - 1), null);
  assert.equal(typingFrame(1000, 'hel', 1000 + TYPING_EVERY_MS), 'on');
  assert.equal(typingFrame(1000, '', 1500), 'off', 'sent or cleared');
  assert.equal(typingFrame(1000, '  \n', 1500), 'off', 'blanks only = empty');
  assert.equal(typingFrame(undefined, '', 1500), null, 'nothing to stop');
  assert.equal(typingFrame(undefined, '   ', 1500), null, 'blanks never start it');
});

test('typersOf: expire 6 s after the last frame, off and a message drop at once, order of arrival', () => {
  const m: Typing = new Map();
  noteTyping(m, 't', 'blair', false, 0);
  noteTyping(m, 't', 'paul', false, 1000);
  noteTyping(m, 'u', 'lea', false, 1000);
  assert.deepEqual(typersOf(m, 't', 2000), ['blair', 'paul']);
  noteTyping(m, 't', 'blair', false, 3000); // refreshed: still there after its first TTL
  assert.deepEqual(typersOf(m, 't', TYPING_TTL_MS + 500), ['paul', 'blair']);
  assert.deepEqual(typersOf(m, 't', 1000 + TYPING_TTL_MS), ['blair'], 'paul expired');
  noteTyping(m, 't', 'blair', true, 4000);
  assert.deepEqual(typersOf(m, 't', 4000), []);
  assert.ok(!m.has('t'), 'empty conversation forgotten');
  assert.deepEqual(typersOf(m, 'u', 1000), ['lea'], 'per conversation');
  assert.deepEqual(typersOf(m, 'none', 0), []);
});

test('typing line: one name singular, several plural, joined per language', () => {
  setLang('fr');
  assert.equal(tn('typing', 1, { who: typingWho(['Blair'], 'fr') }), 'Blair écrit…');
  assert.equal(tn('typing', 2, { who: typingWho(['Blair', 'Paul'], 'fr') }), 'Blair et Paul écrivent…');
  assert.equal(tn('typing', 3, { who: typingWho(['Blair', 'Paul', 'Léa'], 'fr') }), 'Blair, Paul et Léa écrivent…');
  setLang('en');
  assert.equal(tn('typing', 1, { who: typingWho(['Blair'], 'en') }), 'Blair is typing…');
  assert.equal(tn('typing', 2, { who: typingWho(['Blair', 'Paul'], 'en') }), 'Blair and Paul are typing…');
});
