import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasBoard, boardGroups, listGroups, boardModeKey, parseBoardMode, itemLabels, labelInk, boardWorking, LABEL_DARK, LABEL_LIGHT } from '../src/board.ts';
import type { GhSnapshot, PublicThread } from '../../protocol/frames.ts';

const item = (id: string, status: string | null, extra: Partial<GhSnapshot['items'][number]> = {}) =>
  ({ id, kind: 'issue' as const, title: id, status, state: 'OPEN', assignees: [], url: `https://github.com/o/r/issues/${id}`, ...extra });
const gh = (items: GhSnapshot['items']): GhSnapshot => ({ space: 's', at: 1, project: { title: 'P', url: 'https://github.com/orgs/o/projects/1' }, items });
const thread = (issueUrl?: string) => ({ id: 'f', space: 's', issue: issueUrl ? { repo: 'o/r', number: 1, url: issueUrl } : undefined }) as unknown as PublicThread;

test('Board entry: only if a GitHub Project is linked (snapshot received or linked repos)', () => {
  assert.equal(hasBoard(null, []), false);
  assert.equal(hasBoard(undefined, undefined), false);
  assert.equal(hasBoard(null, ['o/r']), true); // first snapshot pending
  assert.equal(hasBoard(gh([]), []), true);
});

test('Board: items without a thread only, closed and merged excluded, grouped by status, no status ("") last', () => {
  const g = gh([
    item('1', null), item('2', 'Todo'), item('3', 'In progress'), item('4', 'Todo'),
    item('5', 'Todo', { state: 'CLOSED' }), item('6', 'Done', { kind: 'pr', state: 'MERGED' }),
    item('7', 'In progress', { kind: 'draft', url: undefined }),
  ]);
  const groups = boardGroups(g, [thread('https://github.com/o/r/issues/4'), thread()]);
  assert.deepEqual(groups.map(([s, is]) => [s, is.map(i => i.id)]),
    [['Todo', ['2']], ['In progress', ['3', '7']], ['', ['1']]]);
});

test('Board list mode: Project order reversed (To merge first, Backlog last), no status still last; columns untouched', () => {
  const g = gh([item('1', null), item('2', 'Backlog'), item('3', 'In progress'), item('4', 'To merge'), item('5', 'Backlog')]);
  const groups = boardGroups(g, []);
  assert.deepEqual(listGroups(groups).map(([s, is]) => [s, is.map(i => i.id)]),
    [['To merge', ['4']], ['In progress', ['3']], ['Backlog', ['2', '5']], ['', ['1']]]);
  assert.deepEqual(groups.map(([s]) => s), ['Backlog', 'In progress', 'To merge', '']); // not mutated: columns keep this order
  assert.deepEqual(listGroups([]), []);
});

test('Board without snapshot: no group', () => {
  assert.deepEqual(boardGroups(null, [thread()]), []);
});

test('Board of a board-driven space: every open item, linked or not, closed and merged still excluded', () => {
  const g = gh([item('1', 'Todo', { thread: 'f1' }), item('2', 'Todo'), item('3', 'Done', { state: 'CLOSED', thread: 'f3' })]);
  const groups = boardGroups(g, [thread('https://github.com/o/r/issues/1')], true);
  assert.deepEqual(groups.map(([s, is]) => [s, is.map(i => [i.id, i.thread ?? null])]), [['Todo', [['1', 'f1'], ['2', null]]]]);
});

test('Board mode: remembered per space, anything unknown reads as list', () => {
  assert.notEqual(boardModeKey('loom'), boardModeKey('manta'));
  assert.equal(parseBoardMode('columns'), 'columns');
  for (const v of ['list', null, undefined, '', 'Columns', 'kanban']) assert.equal(parseBoardMode(v), 'list');
});

test('Board labels: colour kept only as 6 lowercase hex digits, matched by position', () => {
  assert.deepEqual(itemLabels({}), []);
  assert.deepEqual(itemLabels({ labels: ['a', 'b'] }), [{ name: 'a', color: null }, { name: 'b', color: null }]);
  assert.deepEqual(itemLabels({ labels: ['a', 'b', 'c', 'd'], labelColors: ['1d76db', '', 'red;}x{', 'FBCA04'] }),
    [{ name: 'a', color: '1d76db' }, { name: 'b', color: null }, { name: 'c', color: null }, { name: 'd', color: null }]);
  assert.deepEqual(itemLabels({ labels: ['a', 'b'], labelColors: ['fbca04'] }), [{ name: 'a', color: 'fbca04' }, { name: 'b', color: null }]);
});

test('Board labels: readable text on the GitHub colour (the loom labels)', () => {
  // GitHub's own picks on these: dark text on light fills, white on saturated ones.
  for (const c of ['fbca04', 'd4c5f9', 'ffffff', 'e4e669']) assert.equal(labelInk(c), LABEL_DARK, c);
  for (const c of ['1d76db', 'b60205', '8250df', '5c5c5c', '000000']) assert.equal(labelInk(c), LABEL_LIGHT, c);
});

test('Board work columns: a Quiet thread whose open issue is in one of them shows In progress', () => {
  const cols = ['In progress', 'In review'];
  const th = (state: PublicThread['state'], column: string | null, open = true) =>
    ({ state, board: { node: 'n', column, labels: [], state: open ? 'OPEN' : 'CLOSED', vetting: false, sig: 's' } }) as Pick<PublicThread, 'state' | 'board'>;
  assert.equal(boardWorking(th('calm', 'In review'), cols), true);
  assert.equal(boardWorking(th('calm', 'in PROGRESS'), cols), true, 'GitHub names are case-insensitive');
  assert.equal(boardWorking(th('calm', 'Backlog'), cols), false);
  assert.equal(boardWorking(th('calm', 'To merge'), cols), false, 'approved column excluded');
  assert.equal(boardWorking(th('calm', null), cols), false, 'no column');
  assert.equal(boardWorking(th('calm', 'In review', false), cols), false, 'closed issue');
  assert.equal(boardWorking({ state: 'calm' }, cols), false, 'not a board thread');
  assert.equal(boardWorking(th('calm', 'In review'), undefined), false, 'no flow config');
  assert.equal(boardWorking(th('calm', 'In review'), []), false);
  for (const st of ['you', 'wait', 'run', 'idea', 'done'] as const) assert.equal(boardWorking(th(st, 'In review'), cols), false, st);
});
