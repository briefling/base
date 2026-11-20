import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateFlow } from '../../protocol/flowcfg.ts';
import { addPlaybook, addRole, addState, diffHunks, flowDiff, fromTemplate, issuesAt, moveRole, moveState, parseKinds, removePlaybook, removeRole, removeState,
  roleLabel, sameFlow, setAssign, setColor, setColumn, setPlaybookBody, setPlaybookFile, setPlaybookOf, setRoleName, setStateKey, toggleTrigger, usedTriggers } from '../src/workflow.ts';

const role = (d: ReturnType<typeof fromTemplate>, name: string) => d.roles.find(r => r.name === name)!;

test('templates: a copy (editing it never touches the template), valid as shipped', () => {
  const a = fromTemplate('dev');
  a.states[0].column = 'X';
  assert.equal(fromTemplate('dev').states[0].column, 'Backlog');
  assert.deepEqual(validateFlow(fromTemplate('dev')), []);
  assert.deepEqual(validateFlow(fromTemplate('content')), []);
});

test('columns: a renamed key follows into the roles\' triggers; a colliding key does not (the form reports it)', () => {
  const d = fromTemplate('dev');
  const i = d.states.findIndex(s => s.key === 'ready');
  const r = setStateKey(d, i, 'todo');
  assert.deepEqual(role(r, 'dev').on.todo, ['assigned']);
  assert.equal(role(r, 'dev').on.ready, undefined);
  assert.deepEqual(validateFlow(r), []);
  const clash = setStateKey(d, i, 'doing');
  assert.deepEqual(role(clash, 'dev').on.ready, ['assigned']);
  // two columns `doing` and the dev's `ready` triggers point at no column: both reported, nothing guessed
  assert.deepEqual(validateFlow(clash).map(x => x.code).sort(), ['state_dup', 'state_unknown']);
});

test('columns: order, name, add, remove (its reactions and orphan playbook links go with it)', () => {
  const d = fromTemplate('dev');
  assert.deepEqual(moveState(d, 0, 1).states.slice(0, 2).map(s => s.key), ['ready', 'backlog']);
  assert.equal(moveState(d, 0, -1), d); // out of bounds: unchanged
  assert.equal(setColumn(d, 1, 'To do').states[1].column, 'To do');
  const added = addState(d);
  assert.deepEqual(added.states.at(-1), { key: 'state7', column: '' });
  assert.deepEqual(validateFlow(added).map(x => [x.path, x.code]), [['states.6.column', 'column']]);
  // dev reacts in `review` with pr_updated only: removing the column removes the reaction and its playbook link
  const r = removeState(d, d.states.findIndex(s => s.key === 'review'));
  assert.deepEqual(role(r, 'review').on, {});
  assert.deepEqual(role(r, 'review').playbooks, {});
  // review.md is now used by nobody: the form says so instead of dropping a prompt silently
  assert.deepEqual(validateFlow(r).map(x => x.code), ['file_unused']);
  // a column the engine reads by name cannot go
  assert.deepEqual(validateFlow(removeState(d, 0)).map(x => x.code).includes('state_required'), true);
});

test('roles: assignment mode; human drops triggers, playbooks and colour; all drops the colour', () => {
  const d = fromTemplate('dev');
  const i = d.roles.findIndex(r => r.name === 'dev');
  assert.equal(roleLabel(d.roles[i]), 'dev:{agent}');
  assert.equal(roleLabel(role(d, 'pm')), null);
  const h = setAssign(d, i, 'human');
  assert.deepEqual({ ...h.roles[i] }, { name: 'dev', assign: 'human', color: '', on: {}, playbooks: {} });
  const all = setAssign(d, i, 'all');
  assert.equal(all.roles[i].color, '');
  assert.deepEqual(all.roles[i].on, d.roles[i].on);
  assert.equal(setAssign(d, i, 'auto').roles[i].color, '1d76db');
  assert.equal(setColor(d, i, ' #ABCDEF ').roles[i].color, 'abcdef');
  assert.deepEqual(validateFlow(setColor(d, i, 'red')).map(x => [x.path, x.code]), [[`roles.${i}.color`, 'color']]);
});

test('roles: add, rename, move, remove', () => {
  const d = fromTemplate('content');
  const a = addRole(d);
  assert.deepEqual(a.roles.at(-1), { name: 'role4', assign: 'label', color: '', on: {}, playbooks: {} });
  assert.equal(setRoleName(a, 3, 'editor').roles[3].name, 'editor');
  assert.deepEqual(moveRole(d, 2, -1).roles.map(r => r.name), ['planner', 'reviewer', 'writer']);
  assert.deepEqual(removeRole(d, 0).roles.map(r => r.name), ['writer', 'reviewer']);
  assert.deepEqual(validateFlow(setRoleName(d, 1, 'planner')).map(x => x.code), ['role_dup']);
});

test('triggers: ticked in the closed list\'s order; a new trigger asks for its playbook, an unticked one drops it', () => {
  const d = fromTemplate('dev');
  const i = d.roles.findIndex(r => r.name === 'dev');
  const on = toggleTrigger(d, i, 'doing', 'ci_failed');
  assert.deepEqual(on.roles[i].on.doing, ['new_comment', 'ci_failed']);
  const before = toggleTrigger(d, i, 'doing', 'item_new');
  assert.deepEqual(before.roles[i].on.doing, ['item_new', 'new_comment']);
  assert.deepEqual(usedTriggers(on.roles[i]), ['human_comment', 'new_comment', 'assigned', 'pr_conflict', 'ci_failed']);
  assert.deepEqual(validateFlow(on).map(x => [x.path, x.code]), [[`roles.${i}.playbooks.ci_failed`, 'playbook_missing']]);
  assert.deepEqual(validateFlow(setPlaybookOf(on, i, 'ci_failed', 'conflict.md')), []);
  // unticking the last use of a trigger removes its playbook link; the column entry disappears when empty
  const off = toggleTrigger(d, i, 'ready', 'assigned');
  assert.equal(off.roles[i].on.ready, undefined);
  assert.equal(off.roles[i].playbooks.assigned, undefined);
  // a trigger still used in another column keeps its link: human_comment stays in `approved`
  const twice = toggleTrigger(toggleTrigger(d, i, 'doing', 'human_comment'), i, 'doing', 'human_comment');
  assert.equal(twice.roles[i].playbooks.human_comment, 'rework.md');
  assert.equal(toggleTrigger(d, i, 'doing', 'new_comment').roles[i].playbooks.new_comment, undefined);
  // a human role never reacts
  const hi = d.roles.length;
  const withHuman = setAssign(addRole(d), hi, 'human');
  assert.deepEqual(toggleTrigger(withHuman, hi, 'review', 'pr_updated').roles[hi].on, {});
});

test('playbooks: a renamed file follows into the triggers; a removed one leaves them asking for another', () => {
  const d = fromTemplate('dev');
  const i = d.playbooks.findIndex(p => p.file === 'rework.md');
  const r = setPlaybookFile(d, i, 'redo.md');
  assert.deepEqual([role(r, 'dev').playbooks.new_comment, role(r, 'dev').playbooks.human_comment], ['redo.md', 'redo.md']);
  assert.deepEqual(validateFlow(r), []);
  assert.equal(setPlaybookBody(d, i, 'Hi').playbooks[i].body, 'Hi');
  const gone = removePlaybook(d, i);
  assert.deepEqual(validateFlow(gone).map(x => x.code), ['playbook_missing', 'playbook_missing']);
  const a = addPlaybook(d);
  assert.deepEqual(a.playbooks.at(-1), { file: `playbook${d.playbooks.length + 1}.md`, body: '' });
  assert.deepEqual(validateFlow(a).map(x => x.code), ['file_unused']);
});

test('kinds typed as text, issues by field, diff between versions, dirty check', () => {
  assert.deepEqual(parseKinds(' feature\nbug, docs\n\n'), ['feature', 'bug', 'docs']);
  const issues = [{ path: 'roles.1.on.doing', code: 'trigger' as const }, { path: 'roles.10.name', code: 'role_name' as const }, { path: 'roles.1', code: 'color' as const }];
  assert.deepEqual(issuesAt(issues, 'roles.1').map(x => x.code), ['trigger', 'color']);
  const d = fromTemplate('dev');
  const e = setColumn(d, 1, 'To do');
  const diff = flowDiff(d, e).filter(l => l.op !== '=');
  assert.deepEqual(diff.map(l => l.op + l.text), ['-    column: "Ready"', '+    column: "To do"']);
  assert.ok(flowDiff(null, d).every(l => l.op === '+'));
  assert.equal(sameFlow(d, fromTemplate('dev')), true);
  assert.equal(sameFlow(d, e), false);
});

test('diff hunks: changes with 2 lines of context, each skipped run once', () => {
  const L = (s: string) => s.split('').map(c => ({ op: (c === '+' || c === '-' ? c : '=') as '=' | '+' | '-', text: c }));
  assert.deepEqual(diffHunks(L('aaaaa+aaaaaa-aaaaa')).map(x => x ? x.text : '…'), ['…', 'a', 'a', '+', 'a', 'a', '…', 'a', 'a', '-', 'a', 'a', '…']);
  assert.deepEqual(diffHunks(L('aaa')), [null]);
  assert.deepEqual(diffHunks(L('+a')).map(x => x!.text), ['+', 'a']);
});
