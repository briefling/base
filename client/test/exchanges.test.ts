import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addrsOf, dueExchanges, exchangeCounts, filterExchanges, requestOrder, upsertExchange } from '../src/exchanges.ts';
import { routeOf, parseRoute } from '../src/route.ts';

const x = (id: string, state: any, lastAt: number, correspondent = 'c1', version = 1) => ({ id, state, lastAt, correspondent, version }) as any;
test('exchanges list: state and correspondent filters, urgent first, counts', () => {
  const l = [x('a', 'wait', 9), x('b', 'us', 5), x('c', 'closed', 1, 'c2'), x('d', 'us', 2, 'c2')];
  assert.deepEqual(filterExchanges(l, 'all', '').map(e => e.id), ['d', 'b', 'a', 'c']);
  assert.deepEqual(filterExchanges(l, 'us', 'c2').map(e => e.id), ['d']);
  assert.deepEqual(exchangeCounts(l, 'c2'), { all: 2, us: 1, wait: 0, closed: 1 });
});
test('upsertExchange never goes back to an older version', () => {
  const l = [x('a', 'us', 1, 'c1', 3)];
  assert.equal(upsertExchange(l, x('a', 'wait', 2, 'c1', 2))[0].state, 'us');
  assert.equal(upsertExchange(l, x('a', 'wait', 2, 'c1', 4))[0].state, 'wait');
  assert.equal(upsertExchange(l, x('b', 'wait', 2)).length, 2);
});
test('addrsOf splits, lowercases, dedups', () => {
  assert.deepEqual(addrsOf(' Ilan@Berlin.com, @berlin.com;\n@berlin.com '), ['ilan@berlin.com', '@berlin.com']);
});
test('route: #/<space>/exchanges and Settings › Correspondents', () => {
  assert.equal(routeOf({ kind: 'exchanges', id: 'manta' }, null), '#/manta/exchanges');
  assert.deepEqual(parseRoute('#/manta/exchanges', null).view, { kind: 'exchanges', id: 'manta' });
  assert.deepEqual(parseRoute(routeOf({ kind: 'settings', id: 'manta', tab: 'contacts' }, null), null).view, { kind: 'settings', id: 'manta', tab: 'contacts' });
});

test('Your turn: exchanges ours for 3 days in the spaces one leads, longest waiting first', () => {
  const D = 86_400_000, now = 10 * D;
  const by = new Map([['manta', { exchanges: [{ ...x('a', 'us', now), lastIn: now - 4 * D }, { ...x('b', 'us', now), lastIn: now - 2 * D }, { ...x('c', 'wait', 0), lastIn: 0 }, { ...x('d', 'us', now - 5 * D) }] }],
    ['other', { exchanges: [{ ...x('e', 'us', 0), lastIn: 0 }] }]]);
  assert.deepEqual(dueExchanges(by, new Set(['manta']), now).map(e => e.id), ['d', 'a'], 'only led spaces; not yet 3 days, theirs: out');
  assert.deepEqual(dueExchanges(by, new Set(), now), []);
});
test('requests: open ones first (ours, then theirs), then done, oldest first', () => {
  const r = (id: string, side: any, at: number, done = false) => ({ id, what: id, side, mail: 'm', at, ...(done ? { done: { by: 'b', at: 9 } } : {}) });
  assert.deepEqual(requestOrder([r('d', 'us', 1, true), r('t', 'them', 1), r('u2', 'us', 5), r('u1', 'us', 2)]).map(x => x.id), ['u1', 'u2', 't', 'd']);
});
