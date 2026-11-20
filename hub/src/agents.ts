// Agents of a space: invitation link (one-time code), join of the agent's plugin, renewal and removal. The router keeps
// the gates and the dispatch: the admin gate of `admin()` for agent.invite/revoke/remove, the join connection kind for
// agent.join.
import { createHash, randomBytes } from 'node:crypto';
import { AGENT_CODE_BYTES, AGENT_INVITE_TTL_MS, AGENT_RE, type AgentInvite, type HubFrame, type Principal } from '../../protocol/frames.ts';
import { Refused, afterSpaceChange, allowedOf, id, need, settingsOf, str, type Deps, type Instance, type Space, type StoredAgentInvite } from './router.ts';

// ---------------------------------------------------------------- agents (invitation, join, removal)
// An admin invites an agent by name from the Settings: a one-time code (hashed at rest, 24 h, bound to agent + space)
// that the agent's plugin redeems over a join connection (`join.<code>` subprotocol, checked by the authorizer). The
// hub then creates the agent's Cognito client (client credentials, instance scope) and its INSTANCE#, and adds the
// agent to the space. Removing it from its last space deletes both and closes its connections.

export const codeHash = (code: string) => createHash('sha256').update(code).digest('hex');
const agentOf = (x: unknown) => typeof x === 'string' ? x.trim().toLowerCase() : '';

/** Public view of an invitation: expiry and connection computed now (the stored state is pending / used / revoked). */
function inviteView(i: StoredAgentInvite, instances: Instance[], now: number): AgentInvite {
  const state = i.state === 'pending' ? (now >= i.expiresAt ? 'expired' : 'pending')
    : i.state === 'used' ? (instances.find(x => x.id === i.instance)?.connectedAt ? 'connected' : 'used') : 'revoked';
  return { id: i.id, space: i.space, agent: i.agent, by: i.by, at: i.at, expiresAt: i.expiresAt, state, ...(i.usedAt ? { usedAt: i.usedAt } : {}), ...(i.renew ? { renew: true as const } : {}) };
}
export async function invitesOf(deps: Deps, instances: Instance[], space?: string): Promise<AgentInvite[]> {
  const now = deps.now();
  return (await deps.store.listAgentInvites()).filter(i => !space || i.space === space).map(i => inviteView(i, instances, now))
    .sort((a, b) => b.at - a.at);
}

/** Adds the agent to the space (additive write on the current record, a few attempts). */
async function addAgent(deps: Deps, spaceId: string, agent: string): Promise<Space> {
  for (let i = 0; i < 3; i++) {
    const cur = await deps.store.getSpace(spaceId);
    need(!!cur && !cur.archived, 'forbidden');
    const agents = cur!.agents ?? [cur!.defaultAgent];
    if (agents.includes(agent)) return cur!;
    need(agents.length < 10, 'too_many_agents'); // same bound as space.save
    const next: Space = { ...cur!, agents: [...agents, agent], version: (cur!.version ?? 0) + 1 };
    if (await deps.store.updateSpace(next, cur!.version ?? 0)) return next;
  }
  throw new Refused('stale');
}
/** Removes the agent from the space; the default agent moves to the first one left. Never the last agent. */
async function dropAgent(deps: Deps, spaceId: string, agent: string): Promise<Space> {
  for (let i = 0; i < 3; i++) {
    const cur = await deps.store.getSpace(spaceId);
    need(!!cur, 'forbidden');
    const agents = cur!.agents ?? [cur!.defaultAgent];
    if (!agents.includes(agent)) return cur!;
    need(agents.length > 1, 'last_agent');
    const left = agents.filter(a => a !== agent);
    const { [agent]: _, ...agentRoles } = cur!.agentRoles ?? {};
    const { [agent]: _a, ...agentAvatars } = cur!.agentAvatars ?? {};
    const next: Space = { ...cur!, agents: left, defaultAgent: cur!.defaultAgent === agent ? left[0] : cur!.defaultAgent, agentRoles, agentAvatars, version: (cur!.version ?? 0) + 1 };
    if (await deps.store.updateSpace(next, cur!.version ?? 0)) return next;
  }
  throw new Refused('stale');
}

export async function agentInvite(deps: Deps, who: Principal, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  const agent = agentOf(f.agent);
  need(AGENT_RE.test(agent), 'bad_agent');
  const space = await deps.store.getSpace(f.space);
  need(!!space && !space.archived, 'forbidden');
  const instances = await deps.store.listInstances();
  const done = async (s: Space, result: 'link' | 'added' | 'already', code?: string) => reply({ v: 2, type: 'agent.invited', client_id: f.client_id,
    space: settingsOf(s), agent, result, ...(code ? { code } : {}), invites: await invitesOf(deps, instances, s.id) });
  const serving = instances.filter(i => i.agents.includes(agent));
  const inSpace = (space!.agents ?? [space!.defaultAgent]).includes(agent);
  if (f.renew === true) {
    // New link for an agent of this space: its join replaces the current access (lost secret, reinstalled host).
    // Listed in the space but served by no instance here (still plugged into another stack): a plain link.
    need(inSpace, 'not_served');
    need(serving.every(i => i.managed), 'static_agent'); // infra instances are re-plugged by hand, not by a link
  } else if (inSpace) return void await done(space!, 'already');
  else if (serving.length) {
    // Already served by an instance (here or elsewhere): it gets the space now, no code.
    const next = await addAgent(deps, space!.id, agent);
    await afterSpaceChange(deps, next, instances);
    return void await done(next, 'added');
  }
  // A new link replaces the previous pending one for this agent and space (lost link = invite again).
  for (const i of await deps.store.listAgentInvites())
    if (i.space === space!.id && i.agent === agent && i.state === 'pending') await deps.store.setAgentInvite(i.hash, 'pending', { state: 'revoked' });
  const code = randomBytes(AGENT_CODE_BYTES).toString('base64url');
  const now = deps.now();
  await deps.store.putAgentInvite({ hash: codeHash(code), id: deps.newId(), space: space!.id, agent, by: who.id, at: now, expiresAt: now + AGENT_INVITE_TTL_MS, state: 'pending',
    ...(f.renew === true && serving.length ? { renew: true as const } : {}) });
  await done(space!, 'link', code);
}

export async function agentRevoke(deps: Deps, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  need(id(f.invite));
  const inv = (await deps.store.listAgentInvites()).find(i => i.id === f.invite && i.space === f.space);
  need(!!inv, 'forbidden');
  need(inv!.state === 'pending' && await deps.store.setAgentInvite(inv!.hash, 'pending', { state: 'revoked' }), 'not_pending');
  await reply({ v: 2, type: 'agent.invites', client_id: f.client_id, space: f.space, invites: await invitesOf(deps, await deps.store.listInstances(), f.space) });
}

/** Connections of an instance: those subscribed with `*` plus those subscribed to its spaces. */
export async function instanceConns(deps: Pick<Deps, 'store'>, inst: Instance): Promise<Set<string>> {
  const out = new Set(await deps.store.listInstanceConns(inst.id));
  for (const s of inst.spaces) for (const sub of await deps.store.listSubs(s)) if (sub.kind === 'instance' && sub.principal === inst.id) out.add(sub.connId);
  return out;
}
/** Deletes an invited instance's access: record first (authorizer and router check it), then its client, then its connections. */
async function cutInstance(deps: Deps, inst: Instance, conns: Set<string>) {
  await deps.store.deleteInstance(inst.id);
  await deps.agentClients?.remove(inst.id);
  for (const c of conns) await deps.sender.close?.(c);
}

export async function agentRemove(deps: Deps, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  const agent = agentOf(f.agent);
  need(AGENT_RE.test(agent), 'bad_agent');
  const instances = await deps.store.listInstances();
  const serving = instances.filter(i => i.agents.includes(agent));
  // collected before the unbind drops the subscriptions of this space
  const conns = new Map<string, Set<string>>();
  for (const i of serving) conns.set(i.id, await instanceConns(deps, i));
  const next = await dropAgent(deps, f.space, agent);
  await afterSpaceChange(deps, next, instances);
  for (const i of await deps.store.listAgentInvites())
    if (i.space === f.space && i.agent === agent && i.state !== 'revoked') await deps.store.setAgentInvite(i.hash, i.state, { state: 'revoked' });
  let access: 'deleted' | 'kept' = 'kept';
  for (const i of serving) {
    const cur = await deps.store.getInstance(i.id);
    if (!cur?.managed || cur.spaces.length) continue; // static instance (infra) or still serving other spaces
    await cutInstance(deps, cur, conns.get(i.id)!);
    access = 'deleted';
  }
  await reply({ v: 2, type: 'agent.removed', client_id: f.client_id, space: settingsOf(next), agent, access,
    invites: await invitesOf(deps, await deps.store.listInstances(), f.space) });
}

/**
 * Redeems an invitation code (join connection; the authorizer only checked that the code exists). The claim is a
 * conditional write, so two joins with one code create one instance. Any failure after it undoes what was created and
 * makes the code usable again; the credentials are sent once, on this connection, and never stored by the hub.
 */
export async function join(deps: Deps, who: Principal, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  need(str(f.client_id, 64));
  const inv = await deps.store.getAgentInvite(who.id);
  need(!!inv, 'forbidden');
  const now = deps.now();
  need(inv!.state !== 'used', 'invite_used');
  need(inv!.state !== 'revoked', 'invite_revoked');
  need(now < inv!.expiresAt, 'invite_expired');
  const space = await deps.store.getSpace(inv!.space);
  need(!!space && !space.archived, 'forbidden');
  // Renewal: the instances serving the agent are replaced, and only once the new credentials reached the agent.
  const old = (await deps.store.listInstances()).filter(i => i.agents.includes(inv!.agent));
  if (inv!.renew) need(old.length > 0 && old.every(i => i.managed), 'static_agent');
  else need(!old.length, 'agent_exists');
  need(!!deps.agentClients, 'invites_off');
  need(await deps.store.claimAgentInvite(inv!.hash, now), 'invite_used');
  let client: { id: string; secret: string; tokenUrl: string } | null = null;
  let added = false;
  const undo = async () => {
    if (added) await dropAgent(deps, inv!.space, inv!.agent).then(async s => afterSpaceChange(deps, s, await deps.store.listInstances())).catch(() => {});
    if (client) { await deps.store.deleteInstance(client.id).catch(() => {}); await deps.agentClients!.remove(client.id).catch(() => {}); }
    await deps.store.setAgentInvite(inv!.hash, 'used', { state: 'pending' }).catch(() => {});
  };
  try {
    client = await deps.agentClients!.create(inv!.agent);
    const spaces = inv!.renew ? [...new Set(old.flatMap(i => i.spaces))] : [];
    need(await deps.store.createInstance({ id: client.id, spaces, agents: [inv!.agent], managed: true }), 'agent_exists');
    const next = await addAgent(deps, inv!.space, inv!.agent);
    added = true;
    await afterSpaceChange(deps, next, await deps.store.listInstances());
    await deps.store.setAgentInvite(inv!.hash, 'used', { instance: client.id });
    const sent = await reply({ v: 2, type: 'agent.joined', client_id: f.client_id, agent: inv!.agent, spaces: inv!.renew ? [...new Set([...spaces, next.id])] : [next.id], allowed: allowedOf(next),
      credentials: { client_id: client.id, client_secret: client.secret, token_url: client.tokenUrl } });
    if (!sent) throw new Refused('gone'); // nobody got the secret: nothing must stay
  } catch (e) {
    await undo();
    throw e;
  }
  if (!inv!.renew) return;
  // The new access works: the old one goes (record, Cognito client, connections), then each space drops its subscriptions.
  for (const i of old) await cutInstance(deps, i, await instanceConns(deps, i));
  const instances = await deps.store.listInstances();
  for (const s of new Set(old.flatMap(i => i.spaces))) { const cur = await deps.store.getSpace(s); if (cur) await afterSpaceChange(deps, cur, instances); }
}
