import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spaceGroups, INACTIVE_AFTER } from '../src/spacegroups.ts';
import type { PublicThread } from '../../protocol/frames.ts';

const NOW = 1_800_000_000_000, H = 3600_000;
const thread = (o: Partial<PublicThread> = {}): PublicThread => ({
  id: 'f1', space: 'a', title: 'x', owner: 'milan', kind: 'thread', state: 'calm', version: 1, updatedAt: NOW - H, ...o,
} as PublicThread);
const sp = (...names: string[]) => names.map(n => ({ id: n.toLowerCase(), name: n }));
const ids = (g: { active: { id: string }[]; inactive: { id: string }[] }) => ({ active: g.active.map(s => s.id), inactive: g.inactive.map(s => s.id) });
const run = (threads: PublicThread[], open: string | null = null, unknown?: Set<string>) =>
  ids(spaceGroups(sp('Zeta', 'alpha', 'Beta'), threads, { now: NOW, open, unknown }));

test('48 h threshold on the latest thread or topic of the space', () => {
  assert.equal(INACTIVE_AFTER, 48 * H);
  const r = run([
    thread({ space: 'zeta', updatedAt: NOW - 47 * H }),
    thread({ space: 'alpha', updatedAt: NOW - 48 * H }),                     // exactly 48 h: inactive
    thread({ space: 'beta', updatedAt: NOW - 100 * H }), thread({ space: 'beta', kind: 'topic', updatedAt: NOW - 2 * H }),
  ]);
  assert.deepEqual(r, { active: ['beta', 'zeta'], inactive: ['alpha'] });
});

test('alphabetical in each group, case and accents ignored, not by recency', () => {
  const g = spaceGroups([{ id: 'e', name: 'éclair' }, { id: 'd', name: 'Delta' }, { id: 'f', name: 'flow' }],
    [thread({ space: 'f', updatedAt: NOW }), thread({ space: 'd', updatedAt: NOW - 5 * H }), thread({ space: 'e', updatedAt: NOW - 3 * H })], { now: NOW, open: null });
  assert.deepEqual(g.active.map(s => s.id), ['d', 'e', 'f']);
});

test('no loaded thread = inactive; not loaded yet = active', () => {
  assert.deepEqual(run([]), { active: [], inactive: ['alpha', 'beta', 'zeta'] });
  assert.deepEqual(run([], null, new Set(['beta'])), { active: ['beta'], inactive: ['alpha', 'zeta'] });
});

test('old but kept active: open space, Your turn, agent at work', () => {
  const old = NOW - 10 * 24 * H;
  assert.deepEqual(run([], 'zeta').active, ['zeta']);
  assert.deepEqual(run([thread({ space: 'alpha', state: 'you', updatedAt: old })]).active, ['alpha']);
  assert.deepEqual(run([thread({ space: 'alpha', state: 'run', updatedAt: old })]).active, ['alpha']);
  assert.deepEqual(run([thread({ space: 'alpha', kind: 'topic', working: ['milan'], updatedAt: old })]).active, ['alpha']);
});

test('archived Your turn and the memory review topic do not keep a space active', () => {
  const old = NOW - 10 * 24 * H;
  assert.deepEqual(run([thread({ space: 'alpha', state: 'you', archived: { by: 'u', at: old }, updatedAt: old })]).active, []);
  assert.deepEqual(run([thread({ space: 'alpha', kind: 'topic', memoryReview: true, updatedAt: NOW })]).active, []);
  assert.deepEqual(run([thread({ space: 'alpha', kind: 'topic', memoryReview: true, working: ['milan'], updatedAt: old })]).active, []);
});

test('muted spaces: their own group at the bottom, whatever their activity, open or Your turn (Blair, Nov 13)', () => {
  const g = spaceGroups(sp('Zeta', 'alpha', 'Beta'), [thread({ space: 'zeta', updatedAt: NOW }), thread({ space: 'beta', state: 'you' })],
    { now: NOW, open: 'beta', muted: new Set(['beta', 'zeta']) });
  assert.deepEqual({ ...ids(g), muted: g.muted.map(s => s.id) }, { active: [], inactive: ['alpha'], muted: ['beta', 'zeta'] });
  assert.deepEqual(spaceGroups(sp('Zeta'), [], { now: NOW, open: null }).muted, [], 'none muted: empty group');
});
