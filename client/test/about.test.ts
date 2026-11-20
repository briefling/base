import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRepos, draftRequest, lineDiff } from '../src/about.ts';

test('repos: GitHub https URLs only, canonical owner/repo, deduplicated; the rest is reported', () => {
  const r = parseRepos([
    ' https://github.com/omnico-fr/briefling ',
    'https://github.com/omnico-fr/briefling.git',
    'https://github.com/omnico-fr/Briefling/',            // same repo, other case
    'https://github.com/uplift/loom/tree/main/docs',       // deep link -> the repo
    '',
    'http://github.com/a/b',                              // not https
    'https://gitlab.com/a/b',
    'https://github.com.evil.com/a/b',
    'https://user:pw@github.com/a/b',
    'https://github.com/only-owner',
    'https://github.com/../etc',
    'omnico-fr/briefling',                                // not a URL
    'javascript:alert(1)',
  ].join('\n'));
  assert.deepEqual(r.repos, ['https://github.com/omnico-fr/briefling', 'https://github.com/uplift/loom']);
  assert.deepEqual(r.bad, ['http://github.com/a/b', 'https://gitlab.com/a/b', 'https://github.com.evil.com/a/b', 'https://user:pw@github.com/a/b',
    'https://github.com/only-owner', 'https://github.com/../etc', 'omnico-fr/briefling', 'javascript:alert(1)']);
  assert.deepEqual(parseRepos('  \n '), { repos: [], bad: [] });
});

test('request: mentions the agent in charge, names the tool, asks for changes only when a brief exists', () => {
  const first = draftRequest('milan', ['https://github.com/omnico-fr/hestia'], '  IoT meters, Adeunis  ', false);
  assert.ok(first.startsWith('@milan '));
  assert.ok(first.includes('propose_space_about'));
  assert.ok(first.includes('\n- https://github.com/omnico-fr/hestia'));
  assert.ok(first.endsWith('\nIoT meters, Adeunis'));
  assert.ok(!first.includes('already has a brief'));
  const update = draftRequest('milan', [], 'add the deploy steps', true);
  assert.ok(update.includes('already has a brief'));
  assert.ok(!update.includes('Repos:'));
});

test('line diff: unchanged lines kept, removed before added, empty sides', () => {
  assert.deepEqual(lineDiff('a\nb\nc', 'a\nB\nc\nd'), [
    { op: '=', text: 'a' }, { op: '-', text: 'b' }, { op: '+', text: 'B' }, { op: '=', text: 'c' }, { op: '+', text: 'd' }]);
  assert.deepEqual(lineDiff('', 'x\ny'), [{ op: '+', text: 'x' }, { op: '+', text: 'y' }]);
  assert.deepEqual(lineDiff('x', ''), [{ op: '-', text: 'x' }]);
  assert.deepEqual(lineDiff('same', 'same'), [{ op: '=', text: 'same' }]);
});

test('line diff: very long texts fall back to remove-all/add-all (bounded work)', () => {
  const a = Array.from({ length: 600 }, (_, i) => `a${i}`).join('\n'), b = Array.from({ length: 600 }, (_, i) => `b${i}`).join('\n');
  const d = lineDiff(a, b);
  assert.equal(d.length, 1200);
  assert.ok(d.slice(0, 600).every(x => x.op === '-') && d.slice(600).every(x => x.op === '+'));
});
