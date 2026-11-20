import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FileRef, Message } from '../../protocol/frames.ts';
import { convImages, opensViewer, stepImage } from '../src/viewer.ts';
import { convOrder } from '../src/order.ts';

const file = (id: string, mime: string): FileRef => ({ id, name: `${id}.bin`, mime, size: 1 });
const msg = (id: string, at: number, files?: FileRef[], type: Message['type'] = 'text', kind: Message['author']['kind'] = 'human'): Message =>
  ({ id, thread: 't', author: { kind, id: kind === 'agent' ? 'milan' : 'blair' }, type, text: id, at, ...(files ? { files } : {}) });

test('images of the conversation in display order, other files left out', () => {
  const all = [msg('b', 2, [file('i3', 'image/png')]), msg('a', 1, [file('i1', 'image/jpeg'), file('d1', 'application/pdf'), file('v1', 'video/mp4'), file('i2', 'image/webp')]),
    msg('c', 3), msg('d', 4, [file('s1', 'image/svg+xml'), file('a1', 'audio/webm')])];
  assert.deepEqual(convImages(convOrder(all)).map(f => f.id), ['i1', 'i2', 'i3']);
});

test('follows convOrder: a card moved after the agent text keeps its place in the walk', () => {
  const all = [msg('q', 1, [file('i1', 'image/png')]), msg('card', 2, [file('i2', 'image/png')], 'propose', 'system'), msg('ans', 3, [file('i3', 'image/png')], 'text', 'agent')];
  assert.deepEqual(convImages(convOrder(all)).map(f => f.id), ['i1', 'i3', 'i2']);
});

test('step: previous / next, null at both ends and for an unknown image', () => {
  const list = ['a', 'b', 'c'].map(id => file(id, 'image/png'));
  assert.equal(stepImage(list, 'b', 1), 'c');
  assert.equal(stepImage(list, 'b', -1), 'a');
  assert.equal(stepImage(list, 'c', 1), null);
  assert.equal(stepImage(list, 'a', -1), null);
  assert.equal(stepImage(list, 'zz', 1), null);
  assert.equal(stepImage([], 'a', 1), null);
});

test('only a plain primary click opens the viewer', () => {
  const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
  assert.equal(opensViewer(click), true);
  for (const k of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const) assert.equal(opensViewer({ ...click, [k]: true }), false, k);
  assert.equal(opensViewer({ ...click, button: 1 }), false, 'middle click');
  assert.equal(opensViewer({ ...click, button: 2 }), false, 'right click');
});
