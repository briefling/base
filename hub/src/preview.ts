// Agent preview, hub side (protocol/preview.ts): the share line, the WebRTC signaling relay between one viewer and one
// agent connection, the visitor link and its sessions. Moved out of router.ts as is: the router keeps the dispatch
// (a visitor connection reaches only previewVisitor, before any other frame; preview.visitor/unvisitor before subscribe).
import { visibleAgents } from '../../protocol/memory.ts';
import { PREVIEW_SESSION_RE, PREVIEW_SESSION_S, visitorMinutes, visitorOk, isPreviewError, previewCandidateOk, previewDeviceOk, previewLabel, previewPortOk,
  previewSdpOk, type PreviewLine } from '../../protocol/preview.ts';
import { type HubFrame, type Message, type Principal } from '../../protocol/frames.ts';
import { createHash, randomBytes } from 'node:crypto';
import { broadcast, id, memberSpace, need, speakingAgent, str, type Deps, type StoredPreview, type StoredVisitor } from './router.ts';

/**
 * Agent web preview (protocol/preview.ts): the hub posts the agent's share line and relays the WebRTC signaling
 * between ONE viewer connection and ONE agent connection; it never sees the previewed bytes. Gates: only a trusted
 * human of the space opens a preview (it makes the agent's machine serve them); the offer and the close only from the
 * connection that opened the session; the agent's frames only from the connection the offer went to.
 */
export const PREVIEW_HUMAN = new Set(['preview.open', 'preview.offer', 'preview.close']);
export const PREVIEW_AGENT = new Set(['preview.share', 'preview.stop', 'preview.answer', 'preview.candidate', 'preview.failed']);

/** Live connection of an instance serving `agent` in `space`, most recently started plugin first (as for secrets). */
async function previewTarget(deps: Deps, space: string, agent: string): Promise<string | null> {
  let best: { connId: string; at: number } | null = null;
  for (const sub of await deps.store.listSubs(space)) {
    if (sub.kind !== 'instance') continue;
    const inst = await deps.store.getInstance(sub.principal);
    if (!inst?.agents.includes(agent)) continue;
    const at = inst.plugin?.at ?? 0;
    if (!best || at > best.at) best = { connId: sub.connId, at };
  }
  return best?.connId ?? null;
}

async function livePreview(deps: Deps, session: unknown): Promise<StoredPreview> {
  need(typeof session === 'string' && PREVIEW_SESSION_RE.test(session));
  const p = await deps.store.getPreview(session as string);
  need(!!p && p.at > deps.now() - PREVIEW_SESSION_S * 1000, 'not_found');
  return p!;
}

/** What a session targets, copied from its line: exactly one of a voice channel, a device (screen) or a port. */
const previewWhat = (p: { port?: number; device?: string; voice?: true }) =>
  p.voice ? { voice: true as const } : p.device !== undefined ? { device: p.device } : { port: p.port };

export async function previewHuman(deps: Deps, connId: string, who: Principal, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  if (f.type === 'preview.open') {
    need(str(f.client_id, 64) && id(f.thread) && str(f.msg, 64));
    const cur = await deps.store.getThread(f.thread); need(!!cur, 'forbidden');
    const space = await memberSpace(deps, who, cur!.space);
    need(space.trusted.includes(who.id), 'forbidden'); // the agent's machine serves what the viewer asks
    const line = await deps.store.getMessage(cur!.id, f.msg);
    need(!!line?.preview && line.preview.status === 'on' && line.author.kind === 'agent' && line.author.id === line.preview.agent, 'not_shared');
    const pv = line!.preview!;
    need(visibleAgents(space).includes(pv.agent), 'not_shared');
    const s = await newSession(deps, space.id, cur!.id, line!, who.id, connId);
    return void await reply({ v: 2, type: 'preview.ready', client_id: f.client_id, session: s.session, thread: cur!.id, msg: line!.id, ...s.what, label: pv.label, ice: s.ice });
  }
  const p = await livePreview(deps, f.session);
  need(p.by === who.id && p.viewer === connId, 'forbidden');
  await previewSignal(deps, p, f, reply);
}

/** A new session of `line` for the viewer connection `viewer` (`by`: a human's id, or `visitor:<msg>`). */
async function newSession(deps: Deps, space: string, thread: string, line: Message, by: string, viewer: string, until?: number) {
  const pv = line.preview!;
  need(!!deps.previewIce, 'preview_off');
  const target = await previewTarget(deps, space, pv.agent); need(!!target, 'not_connected');
  const session = randomBytes(18).toString('base64url');
  // Both credentials at once: the agent's ride with the offer, so the offer path makes no AWS call.
  const [ice, agentIce] = await Promise.all([deps.previewIce!(`${session}-v`), deps.previewIce!(`${session}-a`)]);
  const what = previewWhat(pv);
  await deps.store.putPreview({ session, space, thread, msg: line.id, agent: pv.agent, ...what, by, viewer, target: target!, agentIce, at: deps.now(),
    ...(until ? { until } : {}) });
  return { session, what, ice };
}

/** The viewer's offer (relayed to the agent, with the seconds left of a visitor's link) or close. */
async function previewSignal(deps: Deps, p: StoredPreview, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  if (f.type === 'preview.close') {
    await deps.store.deletePreview(p.session);
    await deps.sender.send(p.target, { v: 2, type: 'preview.close', session: p.session });
    return;
  }
  need(f.type === 'preview.offer' && previewSdpOk(f.sdp));
  const sent = await deps.sender.send(p.target, { v: 2, type: 'preview.offer', session: p.session, space: p.space, thread: p.thread, msg: p.msg,
    ...previewWhat(p), sdp: f.sdp, ice: p.agentIce, ...(p.until ? { max_s: Math.max(1, Math.ceil((p.until - deps.now()) / 1000)) } : {}) });
  if (!sent) await reply({ v: 2, type: 'preview.failed', session: p.session, code: 'not_connected' });
}

/** Ends a session from the hub side (a visitor link replaced or revoked, its line off): the agent's peer stops, and a
 *  visitor's connection is closed (its page then finds its link dead). */
async function closeSession(deps: Deps, session: string) {
  const p = await deps.store.getPreview(session);
  if (!p) return;
  await deps.store.deletePreview(session);
  await deps.sender.send(p.target, { v: 2, type: 'preview.close', session });
  if (p.by.startsWith('visitor:')) await deps.sender.close?.(p.viewer);
}

// ---------------------------------------------------------------- visitor link (protocol/preview.ts « Visitor link »)
export const PREVIEW_VISITOR_ADMIN = new Set(['preview.visitor', 'preview.unvisitor']);
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** A lead makes (or replaces) the visitor link of a web or screen line, or revokes it. Same gates as preview.open. */
export async function visitorLink(deps: Deps, who: Principal, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  need(str(f.client_id, 64) && id(f.thread) && str(f.msg, 64));
  const cur = await deps.store.getThread(f.thread); need(!!cur, 'forbidden');
  const space = await memberSpace(deps, who, cur!.space);
  need(space.trusted.includes(who.id), 'forbidden');
  const line = await deps.store.getMessage(cur!.id, f.msg);
  need(!!line?.preview && line.author.kind === 'agent' && line.author.id === line.preview.agent, 'not_shared');
  const old = await deps.store.getVisitor(line!.id);
  const log = (ev: string, x: object = {}) => console.log(ev, JSON.stringify({ space: space.id, thread: cur!.id, msg: line!.id, by: who.id, ...x }));
  if (f.type === 'preview.unvisitor') {
    await dropVisitor(deps, space.id, line!, old);
    log('visitor_revoke');
    return void await reply({ v: 2, type: 'ack', client_id: f.client_id, thread: cur!.id, msg_id: line!.id });
  }
  need(visitorOk(line!.preview) && visibleAgents(space).includes(line!.preview!.agent), 'not_shared');
  const minutes = visitorMinutes(f.minutes); need(minutes !== null);
  const secret = randomBytes(32).toString('base64url'), now = deps.now(), until = now + minutes! * 60_000;
  // The record first: the token works as soon as the lead gets it. Only the hash is kept.
  await deps.store.putVisitor({ msg: line!.id, space: space.id, thread: cur!.id, agent: line!.preview!.agent, hash: sha256(secret), until, by: who.id, at: now });
  if (old?.session) await closeSession(deps, old.session); // the old link's visitor is cut
  const r = await deps.store.upsertMessage({ ...line!, preview: { ...line!.preview!, visitor: { until, by: who.id } }, rev: (line!.rev ?? 0) + 1 });
  if (r) await broadcast(deps, space.id, { v: 2, type: 'event', event: 'message.updated', data: r.message });
  log('visitor_link', { until, replaced: !!old });
  await reply({ v: 2, type: 'preview.visitor', client_id: f.client_id, thread: cur!.id, msg: line!.id, token: `${line!.id}.${secret}`, until });
}

/** The line's link goes: record deleted, live session cut, the card updated. */
async function dropVisitor(deps: Deps, space: string, m: Message, rec: StoredVisitor | null) {
  if (rec) await deps.store.deleteVisitor(m.id);
  if (rec?.session) await closeSession(deps, rec.session);
  if (!m.preview?.visitor) return;
  const { visitor: _, ...preview } = m.preview;
  const r = await deps.store.upsertMessage({ ...m, preview, rev: (m.rev ?? 0) + 1 });
  if (r) await broadcast(deps, space, { v: 2, type: 'event', event: 'message.updated', data: r.message });
}

/** Frames of a visitor connection: the preview of its link only, while the link lives and its line is on. */
export async function previewVisitor(deps: Deps, connId: string, who: Principal, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  // principalId = <msg>:<sha256 of the secret> (authorizer): the socket of a replaced link no longer matches.
  const [msg, hash] = who.id.split(':');
  const v = msg && hash ? await deps.store.getVisitor(msg) : null;
  need(!!v && v.hash === hash && v.until > deps.now(), 'expired');
  if (f.type !== 'preview.open') {
    const p = await livePreview(deps, f.session);
    need(p.by === `visitor:${v!.msg}` && p.viewer === connId && p.session === v!.session, 'forbidden');
    return await previewSignal(deps, p, f, reply);
  }
  need(str(f.client_id, 64));
  const space = await deps.store.getSpace(v!.space);
  // The lead who made the link must still be a lead of a live space.
  need(!!space && !space.archived && space.trusted.includes(v!.by), 'expired');
  const line = await deps.store.getMessage(v!.thread, v!.msg);
  need(!!line && visitorOk(line.preview) && line.author.kind === 'agent' && line.author.id === line.preview!.agent
    && visibleAgents(space!).includes(line.preview!.agent) && line.preview!.visitor?.until === v!.until, 'not_shared');
  // One viewer: a new open (the same visitor back after a network change, or the link passed on) ends the previous one.
  if (v!.session) {
    const prev = await deps.store.getPreview(v!.session);
    if (prev) { await deps.store.deletePreview(prev.session); await deps.sender.send(prev.target, { v: 2, type: 'preview.close', session: prev.session }); }
    if (prev && prev.viewer !== connId) {
      // Told why before its socket goes, so its page does not take the preview back by itself (visitlogic.ts).
      await deps.sender.send(prev.viewer, { v: 2, type: 'error', code: 'replaced' });
      await deps.sender.close?.(prev.viewer);
    }
  }
  const s = await newSession(deps, space!.id, v!.thread, line!, `visitor:${v!.msg}`, connId, v!.until);
  await deps.store.putVisitor({ ...v!, session: s.session });
  console.log('visitor_open', JSON.stringify({ space: space!.id, thread: v!.thread, msg: v!.msg, by: v!.by, replaced: !!v!.session }));
  await reply({ v: 2, type: 'preview.ready', client_id: f.client_id, session: s.session, thread: v!.thread, msg: v!.msg, ...s.what,
    label: line!.preview!.label, ice: s.ice, until: v!.until });
}

export async function previewAgent(deps: Deps, connId: string, who: Principal, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  const inst = await deps.store.getInstance(who.id); need(!!inst, 'forbidden');
  if (f.type === 'preview.share' || f.type === 'preview.stop') {
    need(str(f.client_id, 64) && id(f.thread));
    const cur = await deps.store.getThread(f.thread); need(!!cur, 'forbidden');
    need(inst!.spaces.includes(cur!.space) && !cur!.general, 'forbidden');
    const as = await speakingAgent(deps, inst!, cur!); need(!!as, 'forbidden');
    if (f.type === 'preview.share') {
      // Exactly one of a port (web page), an adb device (screen) or `voice: true` (local voice daemon; the hub never
      // sees its url-file, URL or token).
      const voice = f.voice !== undefined, screen = f.device !== undefined;
      need(f.agent === as && (voice ? f.voice === true && f.port === undefined && f.device === undefined
        : screen ? previewDeviceOk(f.device) && f.port === undefined : previewPortOk(f.port))
        && (f.label === undefined || typeof f.label === 'string'));
      const label = previewLabel(f.label, voice ? 'voice' : screen ? f.device : f.port);
      const preview: PreviewLine = voice ? { agent: as!, voice: true, label, status: 'on' }
        : screen ? { agent: as!, device: f.device, label, status: 'on' } : { agent: as!, port: f.port, label, status: 'on' };
      const line: Message = { id: deps.newId(), thread: cur!.id, author: { kind: 'agent', id: as! }, type: 'text', at: deps.now(),
        text: voice ? `${as} opens a voice channel: ${label}.` : screen ? `${as} shares a screen: ${label} (${f.device}).`
          : `${as} shares a preview: ${label} (port ${f.port}).`, preview };
      await deps.store.upsertMessage(line);
      await broadcast(deps, cur!.space, { v: 2, type: 'event', event: 'message.created', data: line });
      return void await reply({ v: 2, type: 'preview.shared', client_id: f.client_id, thread: cur!.id, msg: line.id });
    }
    need(str(f.msg, 64));
    const m = await deps.store.getMessage(cur!.id, f.msg);
    need(!!m?.preview && m.preview.agent === as, 'forbidden');
    await previewLineOff(deps, cur!.space, m!);
    return void await reply({ v: 2, type: 'preview.shared', client_id: f.client_id, thread: cur!.id, msg: m!.id });
  }
  const p = await livePreview(deps, f.session);
  need(p.target === connId && inst!.agents.includes(p.agent), 'forbidden');
  let out: HubFrame;
  if (f.type === 'preview.answer') { need(previewSdpOk(f.sdp)); out = { v: 2, type: 'preview.answer', session: p.session, sdp: f.sdp } }
  else if (f.type === 'preview.candidate') {
    need(previewCandidateOk(f.candidate, f.mid ?? null));
    out = { v: 2, type: 'preview.candidate', session: p.session, candidate: f.candidate, mid: f.mid ?? null };
  } else { need(isPreviewError(f.code)); out = { v: 2, type: 'preview.failed', session: p.session, code: f.code } }
  await deps.sender.send(p.viewer, out);
  // `gone`: the plugin no longer has that share (gateway restarted, sandbox stopped). It never comes back by itself, so
  // the line goes off for everyone at the first failed open, as a preview.stop would have done.
  if (out.type === 'preview.failed' && out.code === 'gone') {
    const m = await deps.store.getMessage(p.thread, p.msg);
    if (m?.preview && m.preview.agent === p.agent) await previewLineOff(deps, p.space, m);
  }
}

/** Turn a preview line off (persisted, then `message.updated`); nothing if it is already off. */
async function previewLineOff(deps: Deps, space: string, m: Message) {
  if (m.preview?.status !== 'on') return;
  // Its visitor link dies with it (the agent's peers stop with the share).
  const rec = await deps.store.getVisitor(m.id);
  if (rec) { await deps.store.deleteVisitor(m.id); if (rec.session) await closeSession(deps, rec.session); }
  const { visitor: _, ...preview } = m.preview;
  const r = await deps.store.upsertMessage({ ...m, text: `${m.preview.agent} stopped the preview ${m.preview.label}.`, preview: { ...preview, status: 'off' }, rev: (m.rev ?? 0) + 1 });
  if (r) await broadcast(deps, space, { v: 2, type: 'event', event: 'message.updated', data: r.message });
}
