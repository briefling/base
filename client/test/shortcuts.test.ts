import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bumpMru, parseMru, switchMod, spaceIndex, isHelp, startSwitch, stepSwitch, MRU_KEEP, SWITCH_SHOWN, type Keys } from '../src/shortcuts.ts';

const k = (key: string, m: Partial<Keys> = {}): Keys => ({ key, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...m });

test('bumpMru: the opened conversation goes first, once, the list capped', () => {
  assert.deepEqual(bumpMru(['a', 'b', 'c'], 'c'), ['c', 'a', 'b']);
  assert.deepEqual(bumpMru([], 'a'), ['a']);
  const long = Array.from({ length: MRU_KEEP }, (_, i) => `t${i}`);
  const out = bumpMru(long, 'x');
  assert.equal(out.length, MRU_KEEP); assert.equal(out[0], 'x'); assert.ok(!out.includes(`t${MRU_KEEP - 1}`));
});

test('parseMru: anything unexpected in storage reads as empty', () => {
  assert.deepEqual(parseMru(null), []);
  assert.deepEqual(parseMru('{oops'), []);
  assert.deepEqual(parseMru('{"a":1}'), []);
  assert.deepEqual(parseMru('["a",2,"",null,"b"]'), ['a', 'b']);
});

test('switchMod: Ctrl+Tab or ⌥Tab alone (Shift goes back), nothing else', () => {
  assert.equal(switchMod(k('Tab', { ctrlKey: true })), 'Control');
  assert.equal(switchMod(k('Tab', { altKey: true, shiftKey: true })), 'Alt');
  assert.equal(switchMod(k('Tab')), null); // plain Tab: focus moves as usual
  assert.equal(switchMod(k('Tab', { ctrlKey: true, altKey: true })), null);
  assert.equal(switchMod(k('Tab', { metaKey: true, altKey: true })), null); // ⌘Tab belongs to macOS
  assert.equal(switchMod(k('a', { ctrlKey: true })), null);
});

test('spaceIndex: ⌘1…9 on a Mac, Ctrl elsewhere, no other modifier', () => {
  assert.equal(spaceIndex(k('1', { metaKey: true }), true), 0);
  assert.equal(spaceIndex(k('9', { metaKey: true }), true), 8);
  assert.equal(spaceIndex(k('0', { metaKey: true }), true), null);
  assert.equal(spaceIndex(k('1', { ctrlKey: true }), true), null);
  assert.equal(spaceIndex(k('1', { ctrlKey: true }), false), 0);
  assert.equal(spaceIndex(k('1', { metaKey: true, shiftKey: true }), true), null);
  assert.equal(spaceIndex(k('&', { metaKey: true }), true), null); // AZERTY without Shift: not a digit, not taken
});

test('isHelp: ⌘/ with or without Shift (AZERTY Mac)', () => {
  assert.ok(isHelp(k('/', { metaKey: true }), true));
  assert.ok(isHelp(k('/', { metaKey: true, shiftKey: true }), true));
  assert.ok(!isHelp(k('/', { metaKey: true, altKey: true }), true));
  assert.ok(!isHelp(k('/'), true)); // typing a slash in the composer
  assert.ok(isHelp(k('/', { ctrlKey: true }), false));
});

test('startSwitch: from a conversation, the previous one; a quick press flips between the last two', () => {
  const all = () => true;
  const s = startSwitch(['b', 'a', 'c'], all, 'b', 'Control', false)!;
  assert.deepEqual(s, { ids: ['b', 'a', 'c'], i: 1, mod: 'Control' });
  // a opened (release on it): it went first, the next quick press comes back to b
  assert.equal(startSwitch(['a', 'b', 'c'], all, 'a', 'Control', false)!.ids[1], 'b');
});

test('startSwitch: from a list (no conversation on screen) the last one; Shift from the end; unknown ids skipped', () => {
  assert.equal(startSwitch(['a', 'b'], () => true, null, 'Alt', false)!.i, 0);
  assert.equal(startSwitch(['a', 'b', 'c'], () => true, 'a', 'Alt', true)!.i, 2);
  const s = startSwitch(['a', 'gone', 'b'], id => id !== 'gone', 'a', 'Alt', false)!;
  assert.deepEqual(s.ids, ['a', 'b']);
  assert.equal(startSwitch(['a'], () => true, 'a', 'Alt', false), null); // nowhere to go
  assert.equal(startSwitch([], () => true, null, 'Alt', false), null);
  const many = Array.from({ length: 15 }, (_, i) => `t${i}`);
  assert.equal(startSwitch(many, () => true, 't0', 'Alt', false)!.ids.length, SWITCH_SHOWN);
});

test('stepSwitch: Tab next, Shift+Tab back, wrapping around', () => {
  const s = { ids: ['a', 'b', 'c'], i: 1, mod: 'Control' as const };
  assert.equal(stepSwitch(s, false).i, 2);
  assert.equal(stepSwitch(stepSwitch(s, false), false).i, 0);
  assert.equal(stepSwitch({ ...s, i: 0 }, true).i, 2);
});
