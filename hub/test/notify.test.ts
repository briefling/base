// Who gets notified: protocol/notify.ts (Blair's rule, Oct 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PEOPLE_MAX, agentMentionTo, messageTo, unmuted, withPerson, yourTurnFor, yourTurnTo } from '../../protocol/notify.ts';

test('notify: withPerson keeps the order of arrival, no duplicate, capped at PEOPLE_MAX', () => {
  assert.deepEqual(withPerson(undefined, 'a'), ['a']);
  assert.deepEqual(withPerson(['a', 'b'], 'a'), ['a', 'b']);
  assert.deepEqual(withPerson(['a'], 'b'), ['a', 'b']);
  const full = Array.from({ length: PEOPLE_MAX }, (_, i) => `p${i}`);
  assert.deepEqual(withPerson(full, 'late'), full, 'past the cap the earliest stay');
  const src = ['a']; withPerson(src, 'b'); assert.deepEqual(src, ['a'], 'input not mutated');
});

test('notify: Your turn goes to the humans concerned still members; none known = every member', () => {
  const members = ['blair', 'gaston', 'aurore'];
  assert.deepEqual(yourTurnTo(['blair', 'gaston'], members), ['blair', 'gaston'], 'Aurore never set foot in it');
  assert.deepEqual(yourTurnTo(undefined, members), members, 'older thread: as before the rule');
  assert.deepEqual(yourTurnTo([], members), members);
  assert.deepEqual(yourTurnTo(['gone', 'blair'], members), ['blair'], 'an ex-member is dropped');
  assert.deepEqual(yourTurnTo(['gone'], members), members, 'only ex-members known: every member');
});

test('notify: a message goes to the others concerned + the mentioned members, never its author', () => {
  const members = ['blair', 'gaston', 'aurore'];
  assert.deepEqual(messageTo(['blair', 'gaston'], [], 'blair', members), ['gaston'], 'Blair writes: Gaston, not Aurore');
  assert.deepEqual(messageTo(['blair'], ['aurore'], 'blair', members), ['aurore'], '@aurore pulls him in');
  assert.deepEqual(messageTo(['blair'], ['blair'], 'blair', members), [], 'mentioning oneself notifies no one');
  assert.deepEqual(messageTo(['gaston'], [], 'blair', members), ['gaston'], 'Lounge: A wrote, B replies, A is notified');
  assert.deepEqual(messageTo(['blair'], [], 'blair', members), [], 'a topic where nobody else wrote: no one');
  assert.deepEqual(messageTo(undefined, [], 'blair', members), [], 'nobody known before: no one (mentions aside)');
  assert.deepEqual(messageTo(['gaston', 'gone'], ['gaston', 'mallory'], 'blair', members), ['gaston'], 'members only, no duplicate');
});

test('notify: open-tab Your turn alert concerns me when I am among the people, or when none is known', () => {
  assert.equal(yourTurnFor(['blair'], 'blair'), true);
  assert.equal(yourTurnFor(['gaston'], 'blair'), false);
  assert.equal(yourTurnFor(undefined, 'blair'), true, 'older thread: everyone, as before');
  assert.equal(yourTurnFor([], 'blair'), true);
  assert.equal(yourTurnFor(['blair'], null), false, 'not signed in yet');
});

test('notify: in a space I muted, a Your turn concerns me only when I am named in its people (Blair, Nov 14)', () => {
  assert.equal(yourTurnFor(['blair'], 'blair', true), true);
  assert.equal(yourTurnFor(undefined, 'blair', true), false, 'nobody known: no fallback for me');
  assert.equal(yourTurnFor([], 'blair', true), false);
  const members = ['blair', 'gaston', 'aurore'];
  assert.deepEqual(yourTurnTo(undefined, members, new Set(['blair'])), ['gaston', 'aurore'], 'fallback: everyone but who muted');
  assert.deepEqual(yourTurnTo(['gone'], members, new Set(['blair'])), ['gaston', 'aurore']);
  assert.deepEqual(yourTurnTo(['blair'], members, new Set(['blair'])), ['blair'], 'named: still rings despite the mute');
  assert.deepEqual(yourTurnTo(undefined, members, new Set()), members);
});

test('unmuted: a member who muted the space is left out unless mentioned', () => {
  assert.deepEqual(unmuted(['a', 'b', 'c'], new Set(['b', 'c']), ['c']), ['a', 'c']);
  assert.deepEqual(unmuted(['a'], new Set(), []), ['a']);
});

test('agentMentionTo: the mentioned members, once per turn', () => {
  assert.deepEqual(agentMentionTo(['a', 'x', 'a'], ['a', 'b'], 10, undefined), ['a'], 'members only, no duplicate');
  assert.deepEqual(agentMentionTo(['a'], ['a'], 10, 10), [], 'this turn already rang');
  assert.deepEqual(agentMentionTo(['a'], ['a'], 20, 10), ['a'], 'a new turn rings again');
});
