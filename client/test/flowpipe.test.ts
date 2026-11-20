import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromTemplate } from '../src/workflow.ts';
import { flowPipe, pipeNotes } from '../src/flowpipe.ts';
import { EMPTY_TEAM, type FlowTeam } from '../../protocol/flowteam.ts';

const agent = (name: string, roles: string[]) => ({ name, roles, identity: '', limits: {}, sheet: '' });
// The loom case (Oct 23): camille is pm, nobody holds dev (assigned by hand with the label) nor review.
const loom: FlowTeam = { ...EMPTY_TEAM, agents: [agent('camille', ['pm']), agent('gideon', [])] };

test('pipe: one entry per column in board order, the roles acting there, their holders and triggers in canonical order', () => {
  const p = flowPipe(fromTemplate('dev'), loom);
  assert.deepEqual(p.map(c => c.column), ['Backlog', 'Ready', 'In progress', 'In review', 'To merge', 'Done']);
  assert.deepEqual(p[0].actors, [{ role: 'pm', assign: 'all', agents: ['camille'], triggers: ['item_new', 'human_comment'] }]);
  assert.deepEqual(p[1].actors, [{ role: 'dev', assign: 'label', agents: [], triggers: ['assigned'] }]);
  assert.deepEqual(p[4].actors[0].triggers, ['human_comment', 'pr_conflict']);
  assert.deepEqual(p[5].actors, [], 'Done: nobody acts');
});

test('pipe: several agents on a role, several roles in a column, a column without a label falls back to its key', () => {
  const d = fromTemplate('dev');
  d.states[3].column = '';
  d.roles[1].on.review = ['new_comment'];
  const p = flowPipe(d, { ...EMPTY_TEAM, agents: [agent('gideon', ['dev']), agent('jordan', ['dev', 'review'])] });
  assert.equal(p[3].column, 'review');
  assert.deepEqual(p[3].actors.map(a => [a.role, a.agents]), [['dev', ['gideon', 'jordan']], ['review', ['jordan']]]);
});

test('pipe: a human role never shows (it has no trigger by definition, even a stray one)', () => {
  const d = fromTemplate('dev');
  d.roles.push({ name: 'merger', assign: 'human', color: '', on: { approved: ['assigned'] }, playbooks: {} });
  assert.deepEqual(flowPipe(d, loom)[4].actors.map(a => a.role), ['dev']);
  assert.deepEqual(pipeNotes(d, loom).map(n => n.role), ['dev', 'review']);
});

test('notes: label role = assigned by hand (whoever holds it); all/auto without holder = to assign by hand; staffed = nothing', () => {
  assert.deepEqual(pipeNotes(fromTemplate('dev'), loom), [{ kind: 'label', role: 'dev' }, { kind: 'unstaffed', role: 'review', columns: ['In review'] }]);
  const staffed = { ...EMPTY_TEAM, agents: [agent('camille', ['pm']), agent('gideon', ['dev', 'review'])] };
  assert.deepEqual(pipeNotes(fromTemplate('dev'), staffed), [{ kind: 'label', role: 'dev' }]);
  assert.deepEqual(pipeNotes(fromTemplate('dev'), EMPTY_TEAM).map(n => [n.kind, n.role]), [['unstaffed', 'pm'], ['label', 'dev'], ['unstaffed', 'review']]);
});

test('notes: a role acting in no column says nothing', () => {
  const d = fromTemplate('dev');
  d.roles[2].on = {};
  assert.deepEqual(pipeNotes(d, loom), [{ kind: 'label', role: 'dev' }]);
});
