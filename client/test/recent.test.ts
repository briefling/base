import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Person } from '../../protocol/frames.ts';
import { bump, mentionedIds, parseRecent, rankPeople, RECENT_MAX, recentKey } from '../src/recent.ts';

const P = (id: string, name: string, kind: Person['kind'] = 'human', gone?: boolean): Person => ({ id, name, kind, ...(gone ? { gone } : {}) });
const people = [P('me', 'Blair'), P('u1', 'Aurore'), P('u2', 'émilie'), P('milan', 'Milan', 'agent'), P('gaston', 'Gaston', 'agent'), P('old', 'Ancien', 'agent', true)];
const names = (xs: Person[]) => xs.map(p => p.name);

test('no recency: alphabetical, accents and case ignored, self and former agents left out', () => {
  assert.deepEqual(names(rankPeople(people, '', [], 'me')), ['Aurore', 'émilie', 'Gaston', 'Milan']);
});

test('bare @: recent first (most recent on top), humans and agents alike, then the rest alphabetically', () => {
  assert.deepEqual(names(rankPeople(people, '', ['milan', 'u1'], 'me')), ['Milan', 'Aurore', 'émilie', 'Gaston']);
});

test('the typed prefix still filters; recency orders what is left', () => {
  const ps = [...people, P('u3', 'Mia')];
  assert.deepEqual(names(rankPeople(ps, 'mi', [], 'me')), ['Mia', 'Milan']);
  assert.deepEqual(names(rankPeople(ps, 'Mi', ['milan'], 'me')), ['Milan', 'Mia']);
});

test('recent ids of people no longer in the space are ignored', () => {
  assert.deepEqual(names(rankPeople(people, '', ['ghost', 'old', 'gaston'], 'me')), ['Gaston', 'Aurore', 'émilie', 'Milan']);
});

test('mentionedIds: matches names like the renderer (case, accents), text order, no duplicates, unknown ignored', () => {
  assert.deepEqual(mentionedIds('@gaston puis @Emilie, et @Gaston encore @personne', people), ['gaston', 'u2']);
  assert.deepEqual(mentionedIds('mail a@b.fr', people), []);
});

test('bump: mentioned ids go first in order, the others keep theirs, capped', () => {
  assert.deepEqual(bump(['u1', 'milan', 'gaston'], ['gaston', 'u2']), ['gaston', 'u2', 'u1', 'milan']);
  const many = Array.from({ length: RECENT_MAX }, (_, i) => `x${i}`);
  const out = bump(many, ['new']);
  assert.equal(out.length, RECENT_MAX);
  assert.equal(out[0], 'new');
  assert.ok(!out.includes(`x${RECENT_MAX - 1}`), 'oldest dropped');
});

test('parseRecent: malformed storage counts as empty', () => {
  assert.deepEqual(parseRecent(null), []);
  assert.deepEqual(parseRecent('{bad'), []);
  assert.deepEqual(parseRecent('{"a":1}'), []);
  assert.deepEqual(parseRecent('["a",2,"b"]'), ['a', 'b']);
});

test('one list per space', () => {
  assert.notEqual(recentKey('e2e'), recentKey('manta'));
});
