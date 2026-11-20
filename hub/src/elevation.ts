// AWS elevation cards: the agent's request (`request_elevation`) and the trusted human's actions on the card. Moved
// verbatim out of router.ts, which keeps the dispatch (`elevation.request`, `action` kind `elevation`).
import { type Elevation, type ElevationError, ELEVATION_MINUTES_MIN, ELEVATION_MINUTES_MAX, ELEVATION_REASON_MAX, ELEVATION_ACCOUNT_RE, ELEVATION_ROLE, type HubFrame, type Message, type Principal } from '../../protocol/frames.ts';
import { type Deps, type StoredThread, ID_RE, Refused, afterHumanMessage, broadcast, id, inTurn, memberSpace, mutateThread, need, str, turnAuthor } from './router.ts';

// ---------------------------------------------------------------- AWS elevation (elevation/CONTRACT.md)
// briefling only creates the request, reads its state and revokes: the approval (passkey) happens on the approval page
// of the management account, which briefling neither serves nor knows. Nothing here can grant anything.

/** One call to the elevation Lambda; a throw (unreachable, refused role) reads as `unavailable`. */
async function elevationCall(deps: Deps, payload: Record<string, unknown>): Promise<any> {
  try { return await deps.elevation!(payload) ?? { ok: false, error: 'unavailable' } }
  catch (e) { console.error('elevation_invoke_failed', (e as Error)?.name); return { ok: false, error: 'unavailable' } }
}
const requestOk = (r: any) => r?.ok === true && typeof r.nonce === 'string' && ID_RE.test(r.nonce) && Number.isFinite(r.expiresAt);

/**
 * The agent asks for temporary admin on an AWS account (`request_elevation` tool). Same turn gate as the other cards (a
 * turn triggered by a trusted human, never a guest: `elevation.request` is not in GUEST_FRAMES). The Lambda checks the
 * agent and the account against its own allowlists and records the request the approval page lists.
 */
export async function requestElevation(deps: Deps, src: StoredThread, as: string, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  need(str(f.client_id, 64) && typeof f.account === 'string' && ELEVATION_ACCOUNT_RE.test(f.account) && Number.isInteger(f.minutes)
    && f.minutes >= ELEVATION_MINUTES_MIN && f.minutes <= ELEVATION_MINUTES_MAX && typeof f.reason === 'string' && f.reason.trim().length > 0
    && f.reason.trim().length <= ELEVATION_REASON_MAX && !/[\u0000-\u001f\u007f]/.test(f.reason));
  need(inTurn(src, as), 'no_turn');
  const space = await deps.store.getSpace(src.space); need(!!space, 'forbidden');
  need(!!(await turnAuthor(deps, space!, src)), 'no_turn');
  need(!!deps.elevation, 'elevation_off');
  const reason = f.reason.trim();
  const r = await elevationCall(deps, { op: 'challenge', agent: as, account: f.account, minutes: f.minutes, reason });
  if (!r?.ok) throw new Refused(r?.error === 'agent_not_allowed' || r?.error === 'account_not_allowed' ? r.error : 'elevation_failed');
  need(requestOk(r), 'elevation_failed');
  const card: Message = { id: deps.newId(), thread: src.id, author: { kind: 'system', id: 'briefling' }, type: 'elevation', text: 'AWS elevation request',
    elevation: { agent: as, account: f.account, minutes: f.minutes, reason, by: as, status: 'open', nonce: r.nonce, requestExpires: r.expiresAt },
    at: deps.now(), rev: 0 };
  await deps.store.upsertMessage(card);
  await broadcast(deps, space!.id, { v: 2, type: 'event', event: 'message.created', data: card });
  await reply({ v: 2, type: 'ack', client_id: f.client_id, thread: src.id, msg_id: card.id });
}

/**
 * A trusted human acts on an elevation card. Every change is a conditional write on `rev` (two devices: one wins, the
 * other gets `stale`). Check finding a grant: the card shows it and an answer from that human tells the agent (it is
 * woken there). The grant must match the card's request (agent, account): the Lambda's answer is checked, not trusted.
 */
export async function elevationAction(deps: Deps, who: Principal, f: any) {
  need(id(f.thread) && id(f.msg) && ['check', 'poll', 'renew', 'revoke', 'dismiss'].includes(f.op));
  const cur = await deps.store.getThread(f.thread); need(!!cur, 'forbidden');
  const space = await memberSpace(deps, who, cur!.space);
  need(space.trusted.includes(who.id), 'forbidden');
  const card = await deps.store.getMessage(cur!.id, f.msg);
  const e = card?.type === 'elevation' ? card.elevation : undefined;
  need(!!e, 'stale');
  const save = async (next: Elevation) => {
    const r = await deps.store.upsertMessage({ ...card!, elevation: next, rev: (card!.rev ?? 0) + 1 });
    need(!!r, 'stale');
    await broadcast(deps, space.id, { v: 2, type: 'event', event: 'message.updated', data: r!.message });
  };
  const { error: _, ...rest } = e!;
  if (f.op === 'dismiss') { need(e!.status === 'open', 'stale'); await save({ ...rest, status: 'dismissed', dismissed: { by: who.id, at: deps.now() } }); return; }
  need(!!deps.elevation, 'elevation_off');
  if (f.op === 'renew') {
    need(e!.status === 'open', 'stale');
    const r = await elevationCall(deps, { op: 'challenge', agent: e!.agent, account: e!.account, minutes: e!.minutes, reason: e!.reason });
    if (!requestOk(r)) { await save({ ...e!, error: 'unavailable' }); return; }
    await save({ ...rest, nonce: r.nonce, requestExpires: r.expiresAt });
    return;
  }
  if (f.op === 'revoke') {
    need(e!.status === 'granted' && !!e!.grant && (e!.expiresAt ?? 0) > deps.now(), 'stale');
    const r = await elevationCall(deps, { op: 'revoke', grant: e!.grant });
    need(r?.ok === true || r?.error === 'unknown_grant', 'elevation_failed');
    await save({ ...e!, status: 'revoked', revoked: { by: who.id, at: deps.now() } });
    return;
  }
  if (f.op === 'poll' && e!.status !== 'open') return; // settled meanwhile (another device): silent
  need(e!.status === 'open', 'stale');
  const r = await elevationCall(deps, { op: 'status', nonce: e!.nonce });
  const granted = r?.ok === true && r.state === 'granted' && typeof r.grant === 'string' && ID_RE.test(r.grant) && Number.isFinite(r.expiresAt)
    && r.agent === e!.agent && r.account === e!.account;
  if (!granted) {
    if (f.op === 'poll' && (r?.ok !== true || r.state === 'open')) return; // nothing settled: no write, no broadcast
    const error: ElevationError = r?.ok !== true ? 'unavailable' : r.state === 'open' ? 'not_approved' : r.state === 'failed' ? 'failed' : r.state === 'expired' ? 'expired' : 'unavailable';
    await save({ ...rest, error, checker: who.id });
    return;
  }
  await save({ ...rest, status: 'granted', checker: who.id, grant: r.grant, expiresAt: r.expiresAt });
  const until = new Date(r.expiresAt).toISOString().slice(11, 16);
  const msg: Message = { id: deps.newId(), thread: cur!.id, author: { kind: 'human', id: who.id }, type: 'answer', ask: { id: card!.id, options: [] }, at: deps.now(),
    text: `@${e!.agent} Elevation granted: role ${ELEVATION_ROLE} on account ${e!.account} until ${until} UTC (grant ${r.grant}).` };
  await deps.store.upsertMessage(msg);
  const thread = await mutateThread(deps, cur!.id, { type: 'human.answer', ask_id: card!.id, trusted: true });
  await afterHumanMessage(deps, space, who, thread, msg);
}
