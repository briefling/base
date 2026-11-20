import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VOICE_AUTOSEND_MS, VOICE_BUSY_MAX_MS, exchangeDeltas, gatePost, gateThread, newGate, markExchange, newExchange, newReply, nextSentences, replyFlush, replyStep, speakable, voiceDrafts, addPiece } from '../src/voicesay.ts';
import { VOICE_SAY_MAX } from '../../protocol/preview.ts';

/** Feeds growing prefixes of `text` (as message.updated would), then a final call: every sentence said, in order. */
function stream(text: string, step = 3): string[] {
  const out: string[] = [];
  let spoken = 0;
  for (let n = step; n < text.length; n += step) { const r = nextSentences(spoken, text.slice(0, n), false); out.push(...r.say); spoken = r.spokenLen; }
  const r = nextSentences(spoken, text, true);
  return [...out, ...r.say];
}

test('nextSentences: cuts a sentence once it is followed by a space, keeps the partial one until final', () => {
  assert.deepEqual(nextSentences(0, 'Salut. Ça', false), { say: ['Salut.'], spokenLen: 6 });
  assert.deepEqual(nextSentences(6, 'Salut. Ça va ?', false), { say: [], spokenLen: 6 }, '« ? » at the very end: the sentence may go on');
  assert.deepEqual(nextSentences(6, 'Salut. Ça va ?', true), { say: ['Ça va ?'], spokenLen: 14 });
  assert.deepEqual(nextSentences(0, 'Wait… really?! Yes', false).say, ['Wait…', 'really?!']);
  assert.deepEqual(nextSentences(0, 'Pi is 3.14 today. Ok', false).say, ['Pi is 3.14 today.'], 'a dot inside a number is not an end');
});

test('nextSentences: streamed prefixes say each sentence exactly once, whatever the chunking', () => {
  const text = 'First one. Second one!\nA line without dot\nThird? Last';
  const want = ['First one.', 'Second one!', 'A line without dot', 'Third?', 'Last'];
  for (const step of [1, 2, 5, 17, 100]) assert.deepEqual(stream(text, step), want, `step ${step}`);
});

test('nextSentences: markdown stripped, numbered items not cut at « 1. », empty pieces skipped', () => {
  const md = '## Plan\n1. Read the **docs** at [the guide](https://x.test/g).\n2. Run `npm test` then see https://ci.test/run/1 now.\n- _done_\n\n---\n';
  assert.deepEqual(stream(md, 4), ['Plan', 'Read the docs at the guide.', 'Run npm test then see now.', 'done']);
  assert.equal(speakable('> quoted *bold* | cell | ~~old~~'), 'quoted bold cell old');
  assert.equal(speakable('![a cat](c.png) here'), 'a cat here');
});

test('nextSentences: code fences are skipped entirely, an open fence waits (dropped when final)', () => {
  const text = 'Here it is:\n```ts\nconst a = 1. b = 2.\n```\nThen run it. Done.';
  assert.deepEqual(stream(text, 2), ['Here it is:', 'Then run it.', 'Done.']);
  assert.deepEqual(nextSentences(12, 'Here it is:\n```ts\nconst a = 1. b', false), { say: [], spokenLen: 12 }, 'inside an open fence: wait');
  assert.deepEqual(nextSentences(12, 'Here it is:\n```ts\nconst a = 1. b', true).say, [], 'final with the fence never closed: nothing said');
  assert.deepEqual(stream('~~~\nx. y.\n~~~\nAfter.'), ['After.']);
});

test('nextSentences: a rewrite of the spoken part says nothing; only text past spokenLen is spoken', () => {
  assert.deepEqual(nextSentences(20, 'Shorter now.', true), { say: [], spokenLen: 20 });
  assert.deepEqual(nextSentences(6, 'Hello. World. More', false), { say: ['World.'], spokenLen: 13 });
});

test('nextSentences: every say fits the daemon cap, a run-on streamed text is cut at a word', () => {
  const long = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
  const r = nextSentences(0, long, false);
  assert.ok(r.say.length >= 1 && r.say.every(s => s.length <= VOICE_SAY_MAX));
  assert.ok(r.spokenLen > 0 && r.spokenLen < long.length);
  const all = [...r.say, ...nextSentences(r.spokenLen, long, true).say];
  assert.equal(all.join(' '), long, 'nothing lost or doubled');
  assert.ok(nextSentences(0, `${long}.`, true).say.every(s => s.length <= VOICE_SAY_MAX));
});

test('reply follower: only agent messages after the acked post; a newer one flushes the old; barge-in silences', () => {
  const r = newReply('c1');
  assert.deepEqual(replyStep(r, 'm2', 'Too early. '), [], 'not acked yet');
  r.after = 'm5';
  assert.deepEqual(replyStep(r, 'm4', 'Older. '), [], 'before the user post');
  assert.deepEqual(replyStep(r, 'm6', 'Salut. Ça'), ['Salut.']);
  assert.deepEqual(replyStep(r, 'm6', 'Salut. Ça va ?'), []);
  assert.deepEqual(replyStep(r, 'm7', 'Second msg. '), ['Ça va ?', 'Second msg.'], 'm6 flushed first');
  assert.deepEqual(replyStep(r, 'm6', 'Salut. Ça va ? Edited later.'), [], 'an edit of the older message');
  assert.deepEqual(replyStep(r, 'm7', 'Second msg. Tail'), []);
  assert.deepEqual(replyFlush(r), ['Tail']);
  assert.deepEqual(replyFlush(r), [], 'flushed once');
  r.off = true;
  assert.deepEqual(replyStep(r, 'm7', 'Second msg. Tail. More text. '), [], 'after tts_stop barge_in');
  assert.deepEqual(replyFlush(r), []);
});

test('exchange timings: first mark only, deltas per step, « – » while unknown', () => {
  const ex = newExchange(1_700_000_000_000, 1000);
  assert.equal(markExchange(ex, 'sent', 2500), true);
  assert.equal(markExchange(ex, 'sent', 9000), false);
  markExchange(ex, 'acked', 2620); markExchange(ex, 'text', 4620);
  assert.deepEqual({ sent: ex.sent, acked: ex.acked, text: ex.text }, { sent: 1500, acked: 1620, text: 3620 });
  assert.deepEqual(exchangeDeltas(ex, 'en'), { sent: '1.50 s', ack: '0.12 s', text: '2.00 s', say: '–', audio: '–' });
  assert.equal(exchangeDeltas(ex, 'fr').ack, '0,12 s');
  assert.equal(VOICE_AUTOSEND_MS, 300);
});


test('gate: sentences said while the agent works are held, then posted as one message when its turn ends', () => {
  const g = newGate();
  assert.equal(gatePost(g, 'Et bonjour Gideon, comment tu vas ?', 0), 'Et bonjour Gideon, comment tu vas ?');
  assert.equal(gateThread(g, 'idle'), '', 'state before the turn started: nothing released');
  assert.equal(gatePost(g, 'Moi, ça va bien.', 4000), null);
  assert.equal(gateThread(g, 'run'), '');
  assert.equal(gatePost(g, 'Tu peux me répondre ?', 9000), null);
  assert.equal(gateThread(g, 'idle'), 'Moi, ça va bien. Tu peux me répondre ?');
  assert.equal(g.busy, false);
  assert.equal(gateThread(g, 'idle'), '', 'released once');
});

test('gate: a turn that never comes frees the gate after VOICE_BUSY_MAX_MS', () => {
  const g = newGate();
  gatePost(g, 'a', 0);
  assert.equal(gatePost(g, 'b', VOICE_BUSY_MAX_MS - 1), null);
  assert.equal(gatePost(g, 'c', VOICE_BUSY_MAX_MS), 'c');
});

test('voiceDrafts: held, about to be sent, sent until its message is in the thread', () => {
  const none = () => false;
  assert.deepEqual(voiceDrafts({ held: '', pending: '', sent: null, reply: null }, none), []);
  assert.deepEqual(voiceDrafts({ held: '', pending: 'Bonjour', sent: null, reply: null }, none), [{ phase: 'soon', text: 'Bonjour' }]);
  const r = newReply('c1');
  const sent = { text: 'Bonjour', cid: 'c1' };
  assert.deepEqual(voiceDrafts({ held: '', pending: '', sent, reply: r }, none), [{ phase: 'sending', text: 'Bonjour' }], 'not acked yet');
  r.after = 'm9';
  assert.deepEqual(voiceDrafts({ held: '', pending: '', sent, reply: r }, none), [{ phase: 'sending', text: 'Bonjour' }], 'acked, message not received');
  assert.deepEqual(voiceDrafts({ held: '', pending: '', sent, reply: r }, id => id === 'm9'), [], 'the real message replaces it');
  assert.deepEqual(voiceDrafts({ held: 'Et aussi', pending: 'Encore', sent, reply: r }, id => id === 'm9'),
    [{ phase: 'held', text: 'Et aussi' }, { phase: 'soon', text: 'Encore' }]);
  assert.deepEqual(voiceDrafts({ held: '', pending: '', sent, reply: newReply('c2') }, () => true), [{ phase: 'sending', text: 'Bonjour' }], 'another post followed');
});

test('addPiece: SentencePiece pieces joined into words, no « ▁ » left, the end kept', () => {
  const join = (ps: string[]) => ps.reduce((w, p) => addPiece(w, p), '');
  assert.equal(join(['\u2581Bonjour', '\u2581Gi', 'deon', '.']), 'Bonjour Gideon.');
  assert.equal(join(['\u2581Ça', '\u2581marche', '\u2581super', '\u2581bien']), 'Ça marche super bien');
  assert.equal(addPiece('', '\u2581'), '');
  assert.equal(addPiece('a'.repeat(10), '\u2581fin', 8), 'aaaa fin');
});
