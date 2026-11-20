import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { FLOW_TEMPLATES } from '../../protocol/flow-templates.ts';
import { validateFlow } from '../../protocol/flowcfg.ts';
import { EMPTY_TEAM, BUNDLE_PATH_RE, approvedColumn, workColumns, bundleFiles, bundleIssues, configYaml, teamText, validateTeam, type FlowTeam } from '../../protocol/flowteam.ts';
import { addAuthor, agentOf, configDiff, parseBots, removeAuthor, renameTeamRole, setAgent, setAuthor, setLimit, toggleAgentRole } from '../src/workflow.ts';
import { BUNDLE_DIR, BUNDLE_TARGET, BUNDLE_TEAM, bundleFixtures } from '../../scripts/flow-fixtures.ts';

const dev = FLOW_TEMPLATES.dev;
const SPACE = ['gideon', 'gaston', 'kevin'];
const team = (over: Partial<FlowTeam> = {}): FlowTeam => ({ agents: [{ name: 'gideon', roles: ['pm', 'dev'], identity: 'gideon-uplift', limits: { max_cost_per_day: 5 }, sheet: '' }],
  trusted_authors: [{ login: 'blair-gh', agent: 'gideon' }], trusted_bots: ['briefling-omnico-fr'], culture: '', ...over });
const codes = (t: unknown) => validateTeam(t, dev, SPACE).map(x => `${x.code}@${x.path}`);

test('committed bundle fixture (hermes-plugin/tests/flow/data/bundle) is what scripts/flow-fixtures.ts generates now', () => {
  const want = bundleFixtures();
  const onDisk = readdirSync(BUNDLE_DIR, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => relative(BUNDLE_DIR, join(e.parentPath, e.name))).sort();
  assert.deepEqual(onDisk, want.map(f => f.path).sort(), 'run `node scripts/flow-fixtures.ts`');
  for (const f of want) assert.equal(readFileSync(join(BUNDLE_DIR, f.path), 'utf8'), f.text, `${f.path}: run \`node scripts/flow-fixtures.ts\``);
  assert.deepEqual(validateTeam(BUNDLE_TEAM, dev, ['on', 'null', 'kevin']), []);
  assert.deepEqual(bundleIssues(bundleFiles(dev, BUNDLE_TEAM, BUNDLE_TARGET)), []);
});

test('validateTeam: agents of the space, roles of the flow, limits in range, humans only as trusted authors, no secret', () => {
  assert.deepEqual(codes(team()), []);
  assert.deepEqual(codes(EMPTY_TEAM), []);
  assert.deepEqual(codes({ ...team(), more: 1 }), ['shape@team']);
  assert.deepEqual(codes(team({ agents: [{ name: 'gideon', roles: [], identity: '', limits: { poll_min: '3' as any }, sheet: '' }] })), ['shape@team']);
  assert.deepEqual(codes(team({ agents: [{ name: 'mallory', roles: ['dev'], identity: '', limits: {}, sheet: '' }], trusted_authors: [] })), ['agent_space@team.agents.0.name']);
  assert.deepEqual(codes(team({ agents: [...team().agents, { ...team().agents[0], identity: '' }] })), ['agent_dup@team.agents.1.name']);
  assert.deepEqual(codes(team({ agents: [{ ...team().agents[0], roles: ['writer', 'pm', 'pm'] }] })), ['role_unknown@team.agents.0.roles.0', 'role_dup@team.agents.0.roles.2']);
  assert.deepEqual(codes(team({ agents: [{ ...team().agents[0], identity: 'Gideon[bot]' }] })), ['identity@team.agents.0.identity']);
  const lim = (limits: object) => codes(team({ agents: [{ ...team().agents[0], limits }] }));
  assert.deepEqual(lim({ max_cost_per_day: 2.5, max_cost_per_month: 0, max_events_per_day: 1000, max_runs: 1, max_review_rounds: 50, poll_min: 1440 }), []);
  assert.deepEqual(lim({ poll_min: 0.5, max_runs: 0, max_cost_per_day: -1, max_events_per_day: NaN }),
    ['limit@team.agents.0.limits.poll_min', 'limit@team.agents.0.limits.max_runs', 'limit@team.agents.0.limits.max_cost_per_day', 'limit@team.agents.0.limits.max_events_per_day']);
  // trusted authors: humans only (not an agent name, an agent's App login or a trusted bot), routed to a staffed agent
  const auth = (login: string, agent = '') => codes(team({ trusted_authors: [{ login, agent }] }));
  assert.deepEqual([auth('gideon'), auth('gideon-uplift'), auth('briefling-omnico-fr'), auth('Not a login'), auth('jlestel', 'gaston'), auth('jlestel', 'gideon')],
    [['login_machine@team.trusted_authors.0.login'], ['login_machine@team.trusted_authors.0.login'], ['login_machine@team.trusted_authors.0.login'],
      ['login@team.trusted_authors.0.login'], ['route@team.trusted_authors.0.agent'], []]);
  assert.deepEqual(codes(team({ trusted_authors: [{ login: 'a', agent: '' }, { login: 'a', agent: '' }] })), ['login_dup@team.trusted_authors.1.login']);
  assert.deepEqual(codes(team({ trusted_bots: ['x', 'x', 'Bad Bot'] })), ['bot_dup@team.trusted_bots.1', 'bot@team.trusted_bots.2']);
  // credentials and broken text anywhere, sizes
  assert.deepEqual(codes(team({ culture: 'see ghp_' + 'a'.repeat(36) })), ['secret@team.culture']);
  assert.deepEqual(codes(team({ agents: [{ ...team().agents[0], sheet: 'app_key: x' }] })), ['secret@team.agents.0.sheet']);
  assert.deepEqual(codes(team({ culture: 'a\u0000b' })), ['text@team.culture']);
  assert.deepEqual(codes(team({ culture: 'x'.repeat(16_001) })), ['too_big@team.culture']);
});

test('configYaml / bundleFiles: one department per space, sheets and culture only when written; bundleIssues gates paths, size, secrets', () => {
  const target = { space: 'civic', board: null, repos: [] };
  const y = configYaml(dev, EMPTY_TEAM, target);
  assert.equal(y, '# Company config: generated by briefling (edit it in the flow editor, not here).\ndepartments:\n  "civic":\n    flow: "dev"\n    repos: []\n    staff: {}\n\nagents: {}\n');
  assert.deepEqual(bundleFiles(dev, team({ culture: ' \n' }), target).map(f => f.path).slice(0, 2), ['config.yml', 'flows/dev.yml']);
  assert.deepEqual(bundleFiles(dev, team({ culture: 'Be kind', agents: [{ ...team().agents[0], sheet: '# G' }] }), target).map(f => f.path).slice(0, 4),
    ['config.yml', 'culture.md', 'agents/gideon.md', 'flows/dev.yml']);
  for (const p of ['config.yml', 'culture.md', 'agents/gideon.md', 'flows/dev.yml', 'playbooks/dev/take.md', 'playbooks/a/b/c.md']) assert.ok(BUNDLE_PATH_RE.test(p), p);
  for (const p of ['/config.yml', '../x.md', 'playbooks/../x.md', 'agents/a/b.md', 'memory/x.md', 'flows/x.yaml', 'playbooks/x.txt', 'agents/Gideon.md']) assert.ok(!BUNDLE_PATH_RE.test(p), p);
  assert.deepEqual(bundleIssues([{ path: 'x/../y.md', text: '' }, { path: 'culture.md', text: '' }, { path: 'culture.md', text: '-----BEGIN' }]),
    [{ path: 'x/../y.md', code: 'path' }, { path: 'culture.md', code: 'path_dup' }, { path: 'culture.md', code: 'secret' }]);
  assert.deepEqual(bundleIssues([{ path: 'culture.md', text: 'é'.repeat(33_000) }]), [{ path: '', code: 'too_big' }]);
  assert.equal(approvedColumn(dev), 'To merge');
  assert.deepEqual(workColumns(dev), ['In progress', 'In review'], 'doing included, approved excluded');
  const st = (...keys: string[]) => ({ ...dev, states: keys.map(k => ({ key: k, column: k.toUpperCase() })) });
  assert.deepEqual(workColumns(st('backlog', 'doing', 'approved')), ['DOING']);
  assert.deepEqual(workColumns(st('backlog', 'approved', 'doing')), [], 'approved before doing');
  assert.deepEqual(workColumns(st('backlog', 'approved')), [], 'no doing');
  assert.deepEqual(workColumns(st('backlog', 'doing')), [], 'no approved');
  assert.deepEqual(validateFlow(dev), []);
});

test('team form ops: untouched agents stay out, space order kept, limits typed, trusted authors, bots, role renames follow', () => {
  let t = EMPTY_TEAM;
  t = toggleAgentRole(t, 'kevin', 'dev', SPACE);
  t = toggleAgentRole(t, 'gideon', 'pm', SPACE);
  assert.deepEqual(t.agents.map(a => [a.name, a.roles]), [['gideon', ['pm']], ['kevin', ['dev']]]);
  t = setLimit(t, 'gideon', 'max_cost_per_day', '2,5', SPACE);
  t = setLimit(t, 'gideon', 'poll_min', 'abc', SPACE);
  assert.deepEqual(agentOf(t, 'gideon').limits, { max_cost_per_day: 2.5, poll_min: NaN });
  assert.deepEqual(codes(t).filter(c => c.startsWith('limit')), ['limit@team.agents.0.limits.poll_min']);
  t = setLimit(t, 'gideon', 'poll_min', ' ', SPACE);
  assert.deepEqual(agentOf(t, 'gideon').limits, { max_cost_per_day: 2.5 });
  // an agent emptied again leaves the team
  t = toggleAgentRole(t, 'kevin', 'dev', SPACE);
  assert.deepEqual(t.agents.map(a => a.name), ['gideon']);
  t = setAgent(t, 'gaston', { sheet: '# Gaston' }, SPACE);
  assert.deepEqual(t.agents.map(a => a.name), ['gideon', 'gaston']);
  t = setAuthor(addAuthor(t), 0, { login: ' Blair-gh ' });
  t = setAuthor(addAuthor(t), 1, { login: 'x', agent: 'gideon' });
  assert.deepEqual(removeAuthor(t, 0).trusted_authors, [{ login: 'x', agent: 'gideon' }]);
  assert.deepEqual(t.trusted_authors[0], { login: 'blair-gh', agent: '' });
  assert.deepEqual(parseBots('Briefling-omnico-fr[bot]\n\n x , y'), ['briefling-omnico-fr', 'x', 'y']);
  assert.deepEqual(renameTeamRole(t, 'pm', 'lead').agents[0].roles, ['lead']);
  assert.deepEqual(renameTeamRole(t, 'pm', null).agents[0].roles, []);
  // diff of a whole version: flow files then the team
  const d = configDiff({ def: dev, team: EMPTY_TEAM }, { def: dev, team: t });
  assert.ok(d.some(l => l.op === '+' && l.text === 'roles: pm') && d.some(l => l.op === '+' && l.text === 'blair-gh -> first idle'));
  assert.ok(teamText(EMPTY_TEAM).includes('=== culture ==='));
});
