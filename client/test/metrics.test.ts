import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ranked, stateRows, totals, BUCKETS, metricsKey, worthShowing, closedShare, dayBars, dayLabel, radarRows, radarPerPass } from '../src/metrics.ts';
import type { SpaceMetrics } from '../../protocol/frames.ts';

const m = (over: Partial<SpaceMetrics> = {}): SpaceMetrics => ({
  period: '30d', since: 0, at: 1, threads: {}, topics: { open: 0, archived: 0 }, openers: [], topicAuthors: [], owners: [], messages: [],
  cost: { total: null, byAgent: [], costed: 0, items: 0, median: null, top: [], split: {} }, days: [], ...over });
const name = (id: string, kind?: string) => id === '' ? 'Unknown' : kind === 'agent' ? id.toUpperCase() : `@${id}`;
const others = (k: number) => `${k} others`;

test('ranked: names resolved, bars relative to the first row, unknown initiator named', () => {
  assert.deepEqual(ranked([{ id: 'blair', n: 8 }, { id: '', n: 2 }], name, others), [
    { id: 'blair', label: '@blair', n: 8, share: 100 }, { id: '', label: 'Unknown', n: 2, share: 25 }]);
  assert.deepEqual(ranked([{ id: 'milan', n: 3, kind: 'agent' }], name, others), [{ id: 'milan', label: 'MILAN', n: 3, share: 100, kind: 'agent' }]);
  assert.deepEqual(ranked([], name, others), []);
});

test('ranked: past the limit, the rest is summed into one row, never more rows than the limit', () => {
  const counts = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, n: 10 - i }));
  const r = ranked(counts, name, others, 4);
  assert.equal(r.length, 4);
  assert.deepEqual(r.map(x => x.label), ['@p0', '@p1', '@p2', '3 others']);
  assert.equal(r[3].n, 7 + 6 + 5);
  assert.equal(r[3].share, 100, 'the summed row may be the largest: bars stay within 0-100');
  assert.equal(r[0].share, 56);
  assert.equal(ranked(counts.slice(0, 4), name, others, 4).length, 4, 'exactly the limit: no "others" row');
});

test('stateRows: only non-empty states, in the fixed order of the lists', () => {
  const rows = stateRows(m({ threads: { archived: 1, you: 2, done: 4 } }), b => b);
  assert.deepEqual(rows.map(r => [r.id, r.n, r.share]), [['you', 2, 50], ['done', 4, 100], ['archived', 1, 25]]);
  assert.deepEqual(BUCKETS, ['you', 'run', 'wait', 'calm', 'idea', 'done', 'archived']);
});

test('totals: threads of every state, topics open + archived, messages split human / agent', () => {
  assert.deepEqual(totals(m({ threads: { calm: 3, archived: 1 }, topics: { open: 4, archived: 2 },
    messages: [{ id: 'milan', kind: 'agent', n: 30 }, { id: 'blair', kind: 'human', n: 12 }, { id: 'joachim', kind: 'human', n: 1 }] })),
    { threads: 4, topics: 6, messages: 43, human: 13, agent: 30 });
  assert.equal(metricsKey('briefling', '7d'), 'briefling|7d');
});

test('worthShowing: a list with a single entry is hidden', () => {
  assert.equal(worthShowing(ranked([{ id: 'milan', n: 70 }], name, others)), false);
  assert.equal(worthShowing(ranked([{ id: 'blair', n: 65 }, { id: 'b2', n: 1 }], name, others)), true);
  assert.equal(worthShowing([]), false);
});

test('closedShare: Closed over every thread created (archived included), null without threads', () => {
  assert.equal(closedShare(m({ threads: { done: 58, calm: 8, run: 2, you: 1, idea: 1 } })), 83);
  assert.equal(closedShare(m({ threads: { done: 1, archived: 1 } })), 50);
  assert.equal(closedShare(m()), null);
});

test('dayBars: stacked heights relative to the busiest day, a label every step from today', () => {
  const b = dayBars([{ day: '2026-10-18', human: 2, agent: 8 }, { day: '2026-10-19', human: 30, agent: 70 }, { day: '2026-10-20', human: 0, agent: 0 }]);
  assert.deepEqual(b.map(x => [x.human100, x.agent100]), [[2, 8], [30, 70], [0, 0]]);
  assert.ok(b.every(x => x.label), 'few days: every day labelled');
  const many = dayBars(Array.from({ length: 30 }, (_, i) => ({ day: `2026-09-${String(i + 1).padStart(2, '0')}`, human: 0, agent: 0 })));
  assert.equal(many.filter(x => x.label).length, 8);
  assert.equal(many.at(-1)!.label, true, 'today always labelled');
  assert.equal(many.every(x => x.human100 === 0), true, 'no division by zero on an empty period');
  assert.deepEqual(dayBars([]), []);
});

test('dayLabel: day and month, no time zone shift', () => {
  assert.equal(dayLabel('2026-10-20', 'fr'), '20/10');
  assert.equal(dayLabel('2026-10-20', 'en'), '10/20');
  assert.equal(dayLabel('2026-01-01', 'fr'), '01/01');
});

test('radar: per type, most signals first, share opened and dismissed; cost per ended pass', () => {
  const r = m({ radar: { kinds: [{ kind: 'tech', n: 2, thread: 1, dismissed: 0 }, { kind: 'competitor', n: 4, thread: 1, dismissed: 3 }], passes: 4, usd: 1, signals: 6 } });
  assert.deepEqual(radarRows(r), [{ kind: 'competitor', n: 4, share: 100, opened: 25, dismissed: 75 }, { kind: 'tech', n: 2, share: 50, opened: 50, dismissed: 0 }]);
  assert.equal(radarPerPass(r), 0.25);
  assert.equal(radarPerPass(m({ radar: { kinds: [], passes: 0, usd: 0, signals: 0 } })), null);
  assert.deepEqual(radarRows(m()), [], 'an older hub: no block');
  const t = m({ radar: { kinds: [{ kind: 'competitor', n: 4, thread: 1, topic: 2, dismissed: 1 }], passes: 1, usd: 1, signals: 4 } });
  assert.equal(radarRows(t)[0].opened, 75, 'a topic opened counts as opened (kinds without `topic`: an older hub)');
});
