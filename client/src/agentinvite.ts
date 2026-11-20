// Agent invitations in the space Settings (admin): pure helpers, DOM-free so node can test them.
import { AGENT_RE, type AgentInvite } from '../../protocol/frames.ts';

/** Link the admin pastes to the agent (or its operator): the static setup page, with the one-time code. */
export const agentLink = (origin: string, code: string) => `${origin.replace(/\/+$/, '')}/agent.md?code=${encodeURIComponent(code)}`;

/** Agent name typed by the admin: trimmed, lowercased; null when the hub would refuse it (AGENT_RE). */
export const normAgent = (text: string): string | null => { const a = text.trim().toLowerCase(); return AGENT_RE.test(a) ? a : null; };

/** Newest first (creation time, then id: ids are time-sortable). */
export const byNewest = (a: AgentInvite, b: AgentInvite) => b.at - a.at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/** The space's invitations, newest first. */
export const invitesOf = (all: readonly AgentInvite[], space: string) => all.filter(i => i.space === space).sort(byNewest);

/** A fresh list for one space (agent.invited / agent.invites / agent.removed) replaces that space's invitations only. */
export const mergeInvites = (all: readonly AgentInvite[], space: string, fresh: readonly AgentInvite[]) =>
  [...all.filter(i => i.space !== space), ...fresh.filter(i => i.space === space)];

/** Only a pending invitation can be revoked (the hub computes the states). */
export const canRevoke = (i: AgentInvite) => i.state === 'pending';

/** Date shown next to an invitation: when it was used (used, connected), when it expired, else when it was created. */
export const inviteDate = (i: AgentInvite): { kind: 'used' | 'expired' | 'created'; at: number } =>
  (i.state === 'used' || i.state === 'connected') && i.usedAt ? { kind: 'used', at: i.usedAt }
    : i.state === 'expired' ? { kind: 'expired', at: i.expiresAt }
    : { kind: 'created', at: i.at };
