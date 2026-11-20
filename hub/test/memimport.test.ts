// Memory import (unstrikeable format): parsing and mapping of one file (protocol/memory.ts memoryFileIn), paths kept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEMORY_IMPORT_RE, memoryFileIn } from '../../protocol/memory.ts';
import { importId } from '../src/memimport.ts';

const REPO = 'uplift/hq';
// Real files of uplift/hq (Oct 2026), one per shape.
const AGENT = '---\ntitle: Learned on uplift/lab#2: uns move needs --agent like every write command, b\nauthor: jordan\ncreated: 1791497674\n---\n'
  + 'uns move needs --agent like every write command, because it acts with the agent\'s App\n\nSource: uplift/lab#2\n';
const SHARED = '# Bench runners (decision-bench)\n\n- A runner ported from jev-bench to decision-bench must send the `criteria` field of bench-v2 items\n'
  + '  \"as is\" scores that model on a harder prompt. Source: decision-bench#21\n  (checked in `jev_bench/runners/kev.py`).\n';

test('memory import: paths read are memory/shared/*.md and memory/agents/<agent>/*.md only', () => {
  for (const p of ['memory/shared/bench-runners.md', 'memory/agents/camille/2026-10-09-learned-on-x.md']) assert.ok(MEMORY_IMPORT_RE.test(p), p);
  for (const p of ['memory/inbox/gideon/x.md', 'memory/inbox/x.md', 'memory/shared/.gitkeep', 'memory/agents/.gitkeep', 'memory/agents/a/sub/x.md',
    'memory/shared/x.txt', 'hq/memory/shared/x.md', 'memory/agents/../shared/x.md', 'memory/x.md']) assert.ok(!MEMORY_IMPORT_RE.test(p), p);
});

test('memory import: an agent note loses its frontmatter and Source line; sources = that line + the path; author and date from the frontmatter', () => {
  const path = 'memory/agents/jordan/2026-10-08-learned-on-uplift-lab-2-uns-move-needs-agent-like-every-writ.md';
  assert.deepEqual(memoryFileIn(REPO, path, AGENT), {
    text: 'uns move needs --agent like every write command, because it acts with the agent\'s App',
    sources: ['uplift/lab#2', `uplift/hq:${path}`], author: 'jordan', at: 1791497674000 });
  // CRLF and a BOM change nothing
  assert.deepEqual(memoryFileIn(REPO, path, '\uFEFF' + AGENT.replace(/\n/g, '\r\n')), memoryFileIn(REPO, path, AGENT));
});

test('memory import: a shared note is kept whole (an inline « Source: » is text), author shared, no date', () => {
  const r = memoryFileIn(REPO, 'memory/shared/bench-runners.md', SHARED) as any;
  assert.equal(r.text, SHARED.trim());
  assert.deepEqual(r.sources, ['uplift/hq:memory/shared/bench-runners.md']);
  assert.equal(r.author, 'shared');
  assert.equal(r.at, undefined);
});

test('memory import: author falls back to the agent folder; a frontmatter author wins; a bad date is dropped', () => {
  const p = 'memory/agents/gideon/x.md';
  assert.equal((memoryFileIn(REPO, p, '---\ntitle: t\n---\nBody.\n') as any).author, 'gideon');
  assert.equal((memoryFileIn(REPO, p, '---\nauthor: camille\n---\nBody.\n') as any).author, 'camille');
  assert.equal((memoryFileIn(REPO, p, '---\ncreated: 12\n---\nBody.\n') as any).at, undefined);
  assert.equal((memoryFileIn(REPO, p, '---\ncreated: 99999999999\n---\nBody.\n') as any).at, undefined);
});

test('memory import: refused, never truncated: too long, empty, malformed frontmatter, bad author, control characters, bad Source', () => {
  const p = 'memory/agents/gideon/x.md';
  assert.equal((memoryFileIn(REPO, p, 'x'.repeat(1000)) as any).error, undefined, '1000 characters pass');
  assert.deepEqual(memoryFileIn(REPO, p, 'x'.repeat(1001)), { error: 'too_long' });
  assert.deepEqual(memoryFileIn(REPO, p, '---\nauthor: gideon\n---\n\nSource: uplift/loom#1\n'), { error: 'empty' });
  assert.deepEqual(memoryFileIn(REPO, p, '---\nauthor: gideon\nBody without closing\n'), { error: 'bad_frontmatter' });
  assert.deepEqual(memoryFileIn(REPO, p, '---\nnot a key line\n---\nBody.\n'), { error: 'bad_frontmatter' });
  assert.deepEqual(memoryFileIn(REPO, p, '---\nauthor: Gideon le grand\n---\nBody.\n'), { error: 'bad_author' });
  assert.deepEqual(memoryFileIn(REPO, p, 'Body \u0007 bell.\n'), { error: 'bad_chars' });
  assert.deepEqual(memoryFileIn(REPO, p, `Body.\nSource: ${'y'.repeat(301)}\n`), { error: 'bad_sources' });
  assert.deepEqual(memoryFileIn(REPO, p, 'Body.\n' + [1, 2, 3, 4, 5].map(n => `Source: uplift/loom#${n}`).join('\n')), { error: 'bad_sources' }, '5 + the path = 6 sources');
});

test('memory import: the id derives from the repo (any case) and the path, and fits an entry id', () => {
  const a = importId('uplift/hq', 'memory/shared/a.md');
  assert.equal(a, importId('Uplift/HQ', 'memory/shared/a.md'));
  assert.notEqual(a, importId('uplift/hq', 'memory/shared/b.md'));
  assert.notEqual(a, importId('uplift/hq-sandbox', 'memory/shared/a.md'));
  assert.match(a, /^[A-Za-z0-9_-]{1,64}$/);
});
