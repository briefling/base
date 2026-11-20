import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costLabel, costTitle, splitRows, reasoningShare } from '../src/cost.ts';
import { costSplit } from '../../protocol/frames.ts';
import type { Usage } from '../../protocol/frames.ts';

const u = (usd: number, status: Usage['status'] = 'estimated'): Usage =>
  ({ usd, input: 12345, output: 2000, cacheRead: 1_234_567, cacheWrite: 800, reasoning: 300, calls: 1, status });
const sp = (s: string) => s.replace(/[\u00a0\u202f]/g, ' '); // Intl uses (narrow) no-break spaces in French

test('label: "~" when estimated, none when billed, "+" when some calls are unpriced', () => {
  assert.equal(costLabel(u(0.4234), 'en'), '~$0.42');
  assert.equal(costLabel(u(0.4234, 'actual'), 'en'), '$0.42');
  assert.equal(costLabel(u(0.4234, 'unknown'), 'en'), '~$0.42+');
  assert.equal(costLabel(u(0, 'included'), 'en'), '~$0.00');
  assert.equal(sp(costLabel(u(1.5), 'fr')), '~1,50 $');
});

test('label: tiny amounts say "<$0.01", large ones drop the cents', () => {
  assert.equal(costLabel(u(0.0004), 'en'), '~<$0.01');
  assert.equal(costLabel(u(0), 'en'), '~$0.00');
  assert.equal(costLabel(u(123.456), 'en'), '~$123');
  assert.equal(sp(costLabel(u(1234.5), 'fr')), '~1 235 $');
});

test('tooltip: status first, then every token bucket and the number of calls, in the UI language', () => {
  assert.equal(costTitle(u(0.42), 'en'), [
    'Estimated cost (list price, not an invoice)', 'Input: 12,345 tokens', 'Output: 2,000 tokens (reasoning: 300)',
    'Cache read: 1,234,567 tokens', 'Cache write: 800 tokens', '1 LLM call'].join('\n'));
  const fr = sp(costTitle({ ...u(0.42, 'unknown'), calls: 3 }, 'fr')).split('\n');
  assert.equal(fr[0], 'Coût estimé, minimum : certains appels n\'ont pas pu être chiffrés');
  assert.equal(fr[1], 'Entrée : 12 345 tokens');
  assert.equal(fr.at(-1), '3 appels LLM');
});

test('splitRows: largest first, « not split » always last, shares of the dollars, empty buckets dropped', () => {
  const rows = splitRows({ unsplit: { usd: 5, calls: 9 }, read: { usd: 1, calls: 4 }, test: { usd: 3, calls: 2 }, git: { usd: 0, calls: 0 }, answer: { usd: 0.004, calls: 1 } });
  assert.deepEqual(rows.map(r => [r.id, r.pct]), [['test', 33], ['read', 11], ['answer', 0], ['unsplit', 56]]);
  assert.deepEqual(splitRows(undefined), []);
  assert.deepEqual(splitRows({ other: { usd: 0, calls: 3 } }).map(r => [r.id, r.pct]), [['other', 0]], 'free calls (subscription) still listed');
});

test('reasoningShare: share of the output tokens, null when the provider reports none (Claude)', () => {
  assert.equal(reasoningShare({ ...u(1), output: 2000, reasoning: 300 }), 15);
  assert.equal(reasoningShare({ ...u(1), reasoning: 0 }), null);
  assert.equal(reasoningShare({ ...u(1), output: 0 }), null);
  assert.equal(reasoningShare(null), null);
});

test('costSplit: a topic is discussion as a whole; a thread by activity plus its older turns as « not split »', () => {
  const usage = { ...u(1), calls: 5, activity: { code: { usd: 0.6, calls: 3 } } };
  assert.deepEqual(costSplit({ kind: 'topic', usage }), { discussion: { usd: 1, calls: 5 } });
  assert.deepEqual(costSplit({ kind: 'thread', usage }), { code: { usd: 0.6, calls: 3 }, unsplit: { usd: 0.4, calls: 2 } });
  assert.deepEqual(costSplit({ usage: { ...usage, calls: 3, usd: 0.6000001 } }), { code: { usd: 0.6, calls: 3 } }, 'a rounding drift with no call is not a spend');
  assert.deepEqual(costSplit({ kind: 'thread' }), {});
});

test('costSplit: a stored « delegate » (sub-agents, retired) reads as other (what it did is unknown), never as an unknown bucket', () => {
  const usage = { ...u(1), calls: 4, activity: { delegate: { usd: 0.5, calls: 2 }, other: { usd: 0.25, calls: 1 }, coordination: { usd: 0.25, calls: 1 } } } as never;
  assert.deepEqual(costSplit({ kind: 'thread', usage }), { other: { usd: 0.75, calls: 3 }, coordination: { usd: 0.25, calls: 1 } });
});
