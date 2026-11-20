import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newPaging, onPage, hasMore, takeNext, cancel } from '../src/paging.ts';

test('paging: nothing before the first sync, then one request at a time until the end', () => {
  const p = newPaging();
  assert.equal(hasMore(p, 'civic'), false);
  assert.equal(takeNext(p, 'civic'), null);
  onPage(p, 'civic', 'c1');
  assert.equal(hasMore(p, 'civic'), true);
  assert.equal(takeNext(p, 'civic'), 'c1');
  assert.equal(takeNext(p, 'civic'), null, 'already in flight: the sentinel firing again sends nothing');
  onPage(p, 'civic', 'c2');
  assert.equal(takeNext(p, 'civic'), 'c2');
  onPage(p, 'civic', null);
  assert.equal(hasMore(p, 'civic'), false);
  assert.equal(takeNext(p, 'civic'), null);
});

test('paging: spaces are independent; an unsent request can be asked again; a new sync unblocks', () => {
  const p = newPaging();
  onPage(p, 'a', 'x'); onPage(p, 'b', 'y');
  assert.equal(takeNext(p, 'a'), 'x');
  assert.equal(takeNext(p, 'b'), 'y');
  cancel(p, 'a');
  assert.equal(takeNext(p, 'a'), 'x');
  // reconnection: `synced` starts the list again, even if a page request was lost with the old socket
  onPage(p, 'b', 'y0');
  assert.equal(takeNext(p, 'b'), 'y0');
});
