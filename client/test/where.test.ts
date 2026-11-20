import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whereText } from '../src/where.ts';

test('where line: Now = space · agent; a space list names the agent only when it is not the only one', () => {
  assert.equal(whereText('Ops', 'testbot', ['testbot']), 'Ops · testbot');
  assert.equal(whereText(null, 'testbot', ['testbot']), null, 'one agent in the space');
  assert.equal(whereText(null, 'testbot', ['testbot', 'otherbot']), 'testbot', 'several agents');
  assert.equal(whereText(null, 'oldbot', ['testbot']), 'oldbot', 'owner no longer an agent of the space');
  assert.equal(whereText(null, 'testbot', []), 'testbot');
});
