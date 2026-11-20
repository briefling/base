import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fold, foldMap, searchTerms, searchable, matchesAll, matchRanges, snippet, searchSince, SEARCH_PERIODS } from '../../protocol/search.ts';
import { viewOf, jumpTarget, pieces, moveSel } from '../src/search.ts';

test('fold: lower case, accents removed, map back to the original text', () => {
  assert.equal(fold('Évènement DÉPLOYÉ ça'), 'evenement deploye ca');
  const m = foldMap('aÉb');
  assert.equal(m.text, 'aeb'); assert.deepEqual(m.at, [0, 1, 2]);
  // Decomposed input (e + combining accent): the folded index points at the base letter.
  const d = foldMap('e\u0301t');
  assert.equal(d.text, 'et'); assert.deepEqual(d.at, [0, 2]);
  // A surrogate pair stays whole.
  assert.equal(fold('😀Ab'), '😀ab');
});

test('terms: split, deduplicated, folded; at least 3 characters to search', () => {
  assert.deepEqual(searchTerms('  Café  cafe HUB '), ['cafe', 'hub']);
  assert.equal(searchable(searchTerms('é')), false);
  assert.equal(searchable(searchTerms('hu')), false);
  assert.equal(searchable(searchTerms('hub')), true);
  assert.equal(searchable(searchTerms('a b c')), true, 'terms joined');
  assert.equal(matchesAll(fold('Le café du hub'), ['cafe', 'hub']), true);
  assert.equal(matchesAll(fold('Le café'), ['cafe', 'hub']), false);
  assert.equal(matchesAll('x', []), false);
});

test('ranges and pieces: matches mapped onto the original accented text, overlaps merged', () => {
  assert.deepEqual(matchRanges('Le Déploiement, déploiement', ['deploiement']), [[3, 14], [16, 27]]);
  assert.deepEqual(matchRanges('abcd', ['abc', 'bcd']), [[0, 4]]);
  assert.deepEqual(pieces('Le Café ici', ['cafe']), [{ text: 'Le ', hit: false }, { text: 'Café', hit: true }, { text: ' ici', hit: false }]);
  assert.deepEqual(pieces('rien', ['x']), [{ text: 'rien', hit: false }]);
});

test('snippet: whitespace collapsed, cut around the first match on a word, ellipses where cut', () => {
  assert.equal(snippet('a\n\n  b', ['a']), 'a b');
  const long = 'mot '.repeat(100) + 'CIBLE ' + 'fin '.repeat(100);
  const s = snippet(long, ['cible'], 60);
  assert.ok(s.startsWith('…mot') && s.endsWith('…') && s.includes('CIBLE'), s);
  assert.ok(s.length <= 62);
  assert.ok(snippet('CIBLE ' + 'x '.repeat(200), ['cible'], 40).startsWith('CIBLE'));
});

test('searchSince: 7 days, 30 days, 1 year back from now; nothing for all', () => {
  const now = 1_800_000_000_000, day = 86_400_000;
  assert.deepEqual(SEARCH_PERIODS.map(p => searchSince(p, now)), [now - 7 * day, now - 30 * day, now - 365 * day, undefined]);
});

test('viewOf: a result opens where the thread lives', () => {
  const f = { space: 's', updatedAt: 1 };
  assert.equal(viewOf({ ...f, kind: 'topic', state: 'calm' }), 'lounge');
  assert.equal(viewOf({ ...f, kind: 'topic', state: 'calm', archived: { by: 'b', at: 1 } }), 'closed');
  assert.equal(viewOf({ ...f, kind: 'thread', state: 'idea' }), 'later');
  assert.equal(viewOf({ ...f, kind: 'thread', state: 'done' }), 'closed');
  assert.equal(viewOf({ ...f, kind: 'thread', state: 'calm', outcome: { kind: 'done', at: 1 } }), 'closed');
  assert.equal(viewOf({ ...f, kind: 'thread', state: 'you' }), 'space');
});

test('jumpTarget: an answer scrolls to its question card; moveSel wraps', () => {
  const ask = { id: 'q1', type: 'ask', ask: { id: 'q1', options: ['A'] } } as any, ans = { id: 'a1', type: 'answer', ask: { id: 'q1', options: [] } } as any;
  assert.equal(jumpTarget([ask, ans], 'a1'), 'q1');
  assert.equal(jumpTarget([ask, ans], 'q1'), 'q1');
  assert.equal(jumpTarget([], 'zz'), 'zz');
  assert.equal(moveSel(0, 3, -1), 2); assert.equal(moveSel(2, 3, 1), 0); assert.equal(moveSel(0, 0, 1), -1);
});
