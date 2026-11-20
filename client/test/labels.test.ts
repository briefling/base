import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canEditLabels, fixedLabel, pickable } from '../src/labels.ts';

const issueThread = { kind: 'thread' as const, issue: { repo: 'uplift/loom', number: 1, url: 'https://github.com/uplift/loom/issues/1' },
  board: { node: 'I1', column: 'Ready', labels: [], state: 'OPEN' as const, vetting: false, sig: '' } };

test('labels: editable by a trusted human in an issue thread of a board-driven space only', () => {
  assert.equal(canEditLabels(issueThread, true, true), true);
  assert.equal(canEditLabels(issueThread, true, false), false);
  assert.equal(canEditLabels(issueThread, false, true), false);
  assert.equal(canEditLabels({ ...issueThread, board: undefined }, true, true), false);
  assert.equal(canEditLabels({ ...issueThread, kind: 'topic' }, true, true), false);
});

test('labels: the picker offers the repo labels not on the issue, never needs:vetting, sorted', () => {
  const l = (name: string) => ({ name, color: '', description: '' });
  assert.deepEqual(pickable([l('needs:vetting'), l('spec:question'), l('Dev:Gideon'), l('agent:pause')], ['dev:gideon']).map(x => x.name), ['agent:pause', 'spec:question']);
  assert.equal(fixedLabel('Needs:Vetting'), true);
  assert.equal(fixedLabel('needs:human'), false);
});
