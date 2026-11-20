import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentLink, normAgent, invitesOf, mergeInvites, canRevoke, inviteDate } from '../src/agentinvite.ts';
import type { AgentInvite } from '../../protocol/frames.ts';

const inv = (id: string, space: string, at: number, state: AgentInvite['state'], extra: Partial<AgentInvite> = {}): AgentInvite =>
  ({ id, space, agent: 'jordan', by: 'blair', at, expiresAt: at + 86_400_000, state, ...extra });

test('link: origin + /agent.md?code=, trailing slash of the origin dropped', () => {
  const code = 'aB3_-'.repeat(6) + 'xy';
  assert.equal(agentLink('https://app.example.com', code), `https://app.example.com/agent.md?code=${code}`);
  assert.equal(agentLink('https://app.example.com/', code), `https://app.example.com/agent.md?code=${code}`);
  assert.equal(agentLink('http://127.0.0.1:8099', 'a b'), 'http://127.0.0.1:8099/agent.md?code=a%20b');
});

test('agent name: trimmed and lowercased, refused outside AGENT_RE', () => {
  assert.equal(normAgent('  Jordan '), 'jordan');
  assert.equal(normAgent('dev-bot_2'), 'dev-bot_2');
  assert.equal(normAgent(''), null);
  assert.equal(normAgent('2bot'), null);
  assert.equal(normAgent('jean mi'), null);
  assert.equal(normAgent('a'.repeat(33)), null);
  assert.equal(normAgent('a'.repeat(32)), 'a'.repeat(32));
});

test('invites of a space, newest first (id breaks ties)', () => {
  const all = [inv('a1', 'hestia', 100, 'used'), inv('b1', 'other', 500, 'pending'), inv('a3', 'hestia', 300, 'revoked'), inv('a2', 'hestia', 300, 'pending')];
  assert.deepEqual(invitesOf(all, 'hestia').map(i => i.id), ['a3', 'a2', 'a1']);
  assert.equal(invitesOf(all, 'none').length, 0);
});

test('a fresh list replaces only that space', () => {
  const all = [inv('a1', 'hestia', 100, 'pending'), inv('b1', 'other', 500, 'pending')];
  const fresh = [inv('a1', 'hestia', 100, 'revoked'), inv('a2', 'hestia', 200, 'pending'), inv('x', 'other', 1, 'pending')];
  const out = mergeInvites(all, 'hestia', fresh);
  assert.deepEqual(out.map(i => `${i.id}:${i.state}`).sort(), ['a1:revoked', 'a2:pending', 'b1:pending']);
  assert.equal(mergeInvites(all, 'hestia', []).length, 1);
});

test('only pending can be revoked; date shown per state', () => {
  assert.deepEqual((['pending', 'expired', 'used', 'connected', 'revoked'] as const).filter(s => canRevoke(inv('i', 's', 1, s))), ['pending']);
  assert.deepEqual(inviteDate(inv('i', 's', 1000, 'pending')), { kind: 'created', at: 1000 });
  assert.deepEqual(inviteDate(inv('i', 's', 1000, 'connected', { usedAt: 2000 })), { kind: 'used', at: 2000 });
  assert.deepEqual(inviteDate(inv('i', 's', 1000, 'used', { usedAt: 3000 })), { kind: 'used', at: 3000 });
  assert.deepEqual(inviteDate(inv('i', 's', 1000, 'expired')), { kind: 'expired', at: 1000 + 86_400_000 });
  assert.deepEqual(inviteDate(inv('i', 's', 1000, 'revoked')), { kind: 'created', at: 1000 });
});
