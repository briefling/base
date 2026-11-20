import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ciWorst, ciTip, ciTone, ciRef, ciRunning, commitUrl, ciLineParts, ciLineTail, checkUrl } from '../src/ci.ts';
import { setLang } from '../src/i18n.ts';
import type { CiPill, CiReport } from '../../protocol/frames.ts';

const S1 = '58b07b1' + '0'.repeat(33), S2 = 'abcdef1' + '0'.repeat(33);
const pill = (repo: string, verdict: CiPill['verdict'], at = 1, extra: Partial<CiPill> = {}): CiPill => ({ repo, sha: S1, verdict, at, n: 0, failed: 0, ...extra });

test('CI dot: the worst pill wins (red, running, grey, green), the most recent on a tie; nothing when nothing was followed', () => {
  assert.equal(ciWorst(undefined), null);
  assert.equal(ciWorst([]), null);
  assert.equal(ciWorst([pill('o/a', 'green'), pill('o/b', 'running'), pill('o/c', 'red')])!.repo, 'o/c');
  assert.equal(ciWorst([pill('o/a', 'green'), pill('o/b', 'none')])!.repo, 'o/b');
  assert.equal(ciWorst([pill('o/a', 'timeout', 1), pill('o/b', 'unknown', 2)])!.repo, 'o/b');
  assert.deepEqual(['running', 'green', 'red', 'none', 'cancelled', 'timeout', 'missing', 'unknown'].map(v => ciTone(v as any)),
    ['run', 'green', 'red', 'grey', 'grey', 'grey', 'grey', 'grey']);
  assert.equal(ciRunning([pill('o/a', 'green'), pill('o/b', 'running')]), true);
  assert.equal(ciRunning([pill('o/a', 'red')]), false);
});

test('CI tooltip: one line per repo, worst first, counts and reasons (EN, FR)', () => {
  setLang('en');
  const pills = [pill('uplift/loom', 'green', 1, { n: 14 }), pill('uplift/lab', 'red', 2, { n: 3, failed: 2, sha: S2 }), pill('o/x', 'unknown', 3, { reason: 'not_installed' })];
  assert.equal(ciTip(pills), 'CI failed · lab@abcdef1 · 2 of 3 failed\nCI unknown · x@58b07b1 · briefling App not installed on this organization\nCI passed · loom@58b07b1 · 14 checks');
  assert.equal(ciTip([pill('o/a', 'green', 1, { n: 1 })]), 'CI passed · a@58b07b1 · 1 check');
  assert.equal(ciTip([pill('o/a', 'running')]), 'CI running · a@58b07b1');
  setLang('fr');
  assert.equal(ciTip([pill('o/a', 'red', 1, { n: 2, failed: 1 })]), 'CI en échec · a@58b07b1 · 1 sur 2 en échec');
  setLang('en');
});

test('CI line: translated head around the commit link, tail with « and N more » and the passed count; links built or checked here', () => {
  setLang('en');
  const red: CiReport = { repo: 'uplift/loom', sha: S1, verdict: 'red', failed: [{ name: 'tests', conclusion: 'failure' }], more: 2, passed: 1 };
  assert.deepEqual(ciLineParts(red), { before: 'CI failed on ', after: ':' });
  assert.deepEqual(ciLineTail(red), ['and 2 more', '1 passed']);
  assert.deepEqual(ciLineParts({ ...red, verdict: 'timeout' }), { before: 'CI on ', after: ' still not finished after one hour: follow-up stopped.' });
  assert.deepEqual(ciLineTail({ ...red, verdict: 'missing' }), []);
  setLang('fr');
  assert.deepEqual(ciLineParts(red), { before: 'CI en échec sur ', after: ' :' });
  assert.deepEqual(ciLineTail({ ...red, more: 0, passed: 3 }), ['3 réussis']);
  setLang('en');
  assert.equal(ciRef({ repo: 'uplift/loom', sha: S1 }), 'loom@58b07b1');
  assert.equal(commitUrl({ repo: 'uplift/loom', sha: S1 }), `https://github.com/uplift/loom/commit/${S1}`);
  assert.equal(commitUrl({ repo: 'uplift/loom"><x', sha: S1 }), null);
  assert.equal(commitUrl({ repo: 'uplift/loom', sha: 'abc' }), null);
  assert.equal(checkUrl('https://github.com/o/r/runs/1'), 'https://github.com/o/r/runs/1');
  assert.equal(checkUrl('https://evil.test/github.com/'), null);
  assert.equal(checkUrl(undefined), null);
});
