import { test } from 'node:test';
import assert from 'node:assert/strict';
import { switchLink, switchPrompt, pilotOf, pilotStatus, pilotAction, pilotAgents } from '../src/flowpilot.ts';
import { FLOW_SWITCH_TTL_MS, type FlowPilot } from '../../protocol/frames.ts';

const pending = (agent: string, at: number, extra: Partial<FlowPilot> = {}): FlowPilot => ({ agent, state: 'pending', by: 'blair', at, expiresAt: at + FLOW_SWITCH_TTL_MS, ...extra });
const piloted = (agent: string): FlowPilot => ({ agent, state: 'piloted', by: 'blair', at: 100, since: 200, imported: { seen: 312, refs: 40, spent: 4.2 } });

test('link: origin + /agent.md?switch=&space=&agent=, trailing slash dropped, each part encoded', () => {
  const code = 'aB3_-'.repeat(6) + 'xy';
  assert.equal(switchLink('https://app.example.com', code, 'uplift', 'camille'), `https://app.example.com/agent.md?switch=${code}&space=uplift&agent=camille`);
  assert.equal(switchLink('https://app.example.com//', code, 'uplift', 'camille'), `https://app.example.com/agent.md?switch=${code}&space=uplift&agent=camille`);
  assert.equal(switchLink('http://127.0.0.1:8099', 'a b&c', 'x/y', 'é?'), 'http://127.0.0.1:8099/agent.md?switch=a%20b%26c&space=x%2Fy&agent=%C3%A9%3F');
});

test('prompt: names the space and the agent, carries the link, asks for the cron removal and flow_switch', () => {
  const link = switchLink('https://app.example.com', 'CODE123', 'uplift', 'camille');
  const p = switchPrompt(link, 'uplift', 'camille');
  assert.ok(p.includes(link));
  assert.ok(p.startsWith('Switch your board work in the briefling space "uplift" from unstrikeable to briefling:'));
  assert.ok(p.includes('`uns_poll` cron job for camille'));
  assert.ok(p.includes('Call the `flow_switch` tool with this link: ' + link));
  assert.equal(p.split('\n').length, 4);
});

test('pilot of an agent; status none / pending / expired / piloted', () => {
  const now = 1_000_000_000;
  const all = [pending('gideon', now - 1000), piloted('camille'), pending('jordan', now - FLOW_SWITCH_TTL_MS - 1)];
  assert.equal(pilotOf(all, 'camille')?.state, 'piloted');
  assert.equal(pilotOf(all, 'didier'), null);
  assert.equal(pilotOf(undefined, 'didier'), null);
  assert.equal(pilotStatus(pilotOf(all, 'didier'), now), 'none');
  assert.equal(pilotStatus(pilotOf(all, 'gideon'), now), 'pending');
  assert.equal(pilotStatus(pilotOf(all, 'jordan'), now), 'expired');
  assert.equal(pilotStatus(pilotOf(all, 'camille'), now), 'piloted');
  // Exactly at expiry: expired; without expiresAt, 24 h after `at`.
  assert.equal(pilotStatus(pending('a', 0, { expiresAt: now }), now), 'expired');
  assert.equal(pilotStatus(pending('a', now - 10, { expiresAt: undefined }), now), 'pending');
  assert.equal(pilotStatus(pending('a', now - FLOW_SWITCH_TTL_MS, { expiresAt: undefined }), now), 'expired');
});

test('button per status, agents listed', () => {
  assert.equal(pilotAction('none'), 'link');
  assert.equal(pilotAction('expired'), 'link');
  assert.equal(pilotAction('pending'), 'cancel');
  assert.equal(pilotAction('piloted'), 'back');
  assert.deepEqual(pilotAgents(['jordan', 'camille'], [piloted('camille'), pending('zed', 1)]), ['camille', 'jordan', 'zed']);
  assert.deepEqual(pilotAgents(['b', 'a'], undefined), ['a', 'b']);
});
