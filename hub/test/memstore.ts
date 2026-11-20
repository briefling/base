// Fake Store of the router tests (hub/test/router.test.ts world()), also run by the Store contract (store-contract.ts).
// Moved verbatim out of world(): the maps stay readable (and writable) by the tests through what memStore() returns.
import type { Store, Sub } from '../src/router.ts';
import { publicThread } from '../src/router.ts';
import type { FlowVersion } from '../../protocol/frames.ts';
import type { StoredPush } from '../src/push.ts';
import { approvedColumn, workColumns } from '../../protocol/flowteam.ts';

export function memStore(opts: { failPutOnce?: boolean } = {}) {
  const spaces: Record<string, any> = {};
  const instances: Record<string, any> = {};
  const subs: Record<string, Sub[]> = {};
  const seenAt: Record<string, Record<string, number>> = {};
  const instConns: Record<string, string[]> = {}; // instance -> connections subscribed with `*`
  const threads: Record<string, any> = {};
  const msgs: any[] = [];
  const searchReads: string[][] = []; // spaces of each searchCorpus read
  const summaries: Record<string, any> = {};
  const atts: Record<string, any> = {};
  const exch: Record<string, any> = {};    // `${space}|C#|X#|M#|MID#<id>` -> { space, kind, data }
  const pins: Record<string, any> = {};  // `${user}|${thread}` -> pin
  const mutes: Record<string, any> = {};  // `${user}|${space}` -> mute
  const seenM: Record<string, number> = {};  // `${user}|${space}|${thread}` -> at
  const reacts: Record<string, any> = {}; // `${thread}|${msg}|${emoji}|${user}` -> reaction
  const locks: Record<string, any> = {};  // `${space}|${agent}` -> the agent's hand
  const resources: Record<string, any> = {}; // `${space}|${resource}` -> shared resource
  const issueIdx: Record<string, string> = {}; // `${space}|${repo}#${n}` -> thread (board-driven spaces)
  const flowRecs: Record<string, any> = {};   // `${space}|${start}|${agent}` -> closed board task
  const previews: Record<string, any> = {};
  const visitors: Record<string, any> = {};
  const pushes: Record<string, Record<string, StoredPush>> = {}; // user -> device id -> Web Push subscription
  const ciWatches: Record<string, any> = {}; // `${thread}#${repo}` -> CI watch
  const bgWatches: Record<string, any> = {}; // thread -> background deadline
  const events: Record<string, any[]> = {};   // thread -> timeline events (thread info panel), in write order
  const memory: Record<string, any> = {};    // `${space}|${id}` -> memory entry
  const memcfg: Record<string, any> = {};    // space -> memory agent batches
  const memvocab: Record<string, any> = {};  // space -> tag vocabulary (aliases, waiting merges)
  const flowcfg: Record<string, FlowVersion[]> = {}; // space -> flow versions, oldest first
  const flowPilots: Record<string, any> = {};        // `${space}|${agent}` -> StoredPilot
  const flowLive: Record<string, any> = {};          // `${space}|${agent}` -> last flow.state
  const flowWake: Record<string, number> = {};       // space -> last flow.wake sent
  const agentTopics: Record<string, number> = {};    // `${space}|${agent}|${day}` -> topics opened on its own
  const flowStat: Record<string, any> = {};          // `${space}|${agent}` -> last flow.config.status
  const routines: Record<string, any> = {};          // `${space}|${id}` -> routine
  const applets: Record<string, any> = {};           // `${space}|${id}` -> applet
  const items: Record<string, any> = {};             // `${space}|${kind}#${id}` -> module record (hub/src/modules.ts)
  const signals: Record<string, any> = {};           // `${space}|${id}` -> Radar signal
  const radarcfg: Record<string, any> = {};          // space -> Settings › Radar
  const hiddenCost: Record<string, any> = {};        // `${space}|${day}|${origin}|${agent}` -> hidden turns' spend
  const flowGit: Record<string, any> = {};           // space -> bundle read at the git source's head
  let gh: any = null; // the latest snapshot written (w.gh())
  const ghs: Record<string, any> = {}; // space -> snapshot
  const admins = new Set<string>(); // global admin role (written outside the hub)
  const agentInvites: Record<string, any> = {}; // code hash -> stored invitation
  let failNext = !!opts.failPutOnce;
  // Like DynamoDB: hidden system conversations (memory review, topic titling) have no SPACE#/THREAD# index row.
  const listed = (f: any) => !f.memoryReview;
  const store: Store = {
    getSpace: async (id) => spaces[id] ? structuredClone(spaces[id]) : null,
    getInstance: async (id) => instances[id] ? structuredClone(instances[id]) : null,
    listSpaces: async () => Object.values(spaces).map(s => structuredClone(s)),
    isAdmin: async (u) => admins.has(u),
    createSpace: async (s) => { if (spaces[s.id]) return false; spaces[s.id] = structuredClone(s); return true },
    updateSpace: async (s, expected) => {
      const cur = spaces[s.id]; if (!cur || (cur.version ?? 0) !== expected) return false;
      const { archived, ...rest } = cur; // like DynamoDB: settings only, `github` kept
      spaces[s.id] = { ...rest, name: s.name, about: s.about, members: s.members, trusted: s.trusted, contributors: s.contributors ?? [], nontech: s.nontech ?? [], admins: s.admins ?? [], agents: s.agents, defaultAgent: s.defaultAgent, names: s.names, roles: s.roles ?? {}, agentRoles: s.agentRoles ?? {}, ...(s.avatars ? { avatars: s.avatars } : {}), ...(s.agentAvatars ? { agentAvatars: s.agentAvatars } : {}), version: s.version, ...(s.archived ? { archived: s.archived } : {}), ...(s.parallel ? { parallel: s.parallel } : rest.parallel ? { parallel: rest.parallel } : {}),
        ...(s.driver ? { driver: s.driver } : {}), ...(s.identities ? { identities: s.identities } : {}), ...(s.repos ? { repos: s.repos } : {}), ...(s.repoOrgs ? { repoOrgs: s.repoOrgs } : {}), ...(typeof s.ci === 'boolean' ? { ci: s.ci } : {}),
        ...(s.memory ? { memory: s.memory } : {}), ...(s.memoryAgent ? { memoryAgent: s.memoryAgent } : {}), ...(typeof s.memoryHidden === 'boolean' ? { memoryHidden: s.memoryHidden } : {}),
        ...(s.memoryBatch ? { memoryBatch: s.memoryBatch } : {}), ...(s.memoryCompact ? { memoryCompact: s.memoryCompact } : {}), ...(s.tagMax !== undefined ? { tagMax: s.tagMax } : {}), ...(s.relayMax !== undefined ? { relayMax: s.relayMax } : {}), ...(s.modulesOff ? { modulesOff: s.modulesOff } : rest.modulesOff ? { modulesOff: rest.modulesOff } : {}) };
      return true;
    },
    setProfile: async (s, u, name, role, avatar) => {
      const sp = spaces[s]; if (!sp || !sp.members.includes(u)) return false;
      sp.names = { ...(sp.names ?? {}), [u]: name };
      const { [u]: _, ...roles } = sp.roles ?? {}; sp.roles = role ? { ...roles, [u]: role } : roles;
      if (avatar !== undefined) { const { [u]: _a, ...avatars } = sp.avatars ?? {}; sp.avatars = avatar ? { ...avatars, [u]: avatar } : avatars; }
      return true;
    },
    listInstances: async () => Object.values(instances).map(i => structuredClone(i)),
    createInstance: async (i) => { if (instances[i.id]) return false; instances[i.id] = structuredClone(i); return true },
    deleteInstance: async (id) => { delete instances[id] },
    markInstanceConnected: async (id, at) => { if (instances[id] && !instances[id].connectedAt) instances[id].connectedAt = at },
    putAgentInvite: async (i) => { if (agentInvites[i.hash]) throw new Error('ConditionalCheckFailedException'); agentInvites[i.hash] = structuredClone(i) },
    getAgentInvite: async (h) => agentInvites[h] ? structuredClone(agentInvites[h]) : null,
    listAgentInvites: async () => Object.values(agentInvites).map(i => structuredClone(i)),
    claimAgentInvite: async (h, now) => { const i = agentInvites[h]; if (!i || i.state !== 'pending' || i.expiresAt <= now) return false; i.state = 'used'; i.usedAt = now; return true },
    setAgentInvite: async (h, from, patch) => {
      const i = agentInvites[h]; if (!i || i.state !== from) return false;
      Object.assign(i, patch); if (patch.state === 'pending') { delete i.usedAt; delete i.instance }
      return true;
    },
    bindInstance: async (id, s, on) => { const i = instances[id]; if (!i || i.spaces.includes(s) === on) return; i.spaces = on ? [...i.spaces, s] : i.spaces.filter((x: string) => x !== s) },
    putSub: async (s, sub) => { subs[s] = [...(subs[s] ?? []).filter(x => x.connId !== sub.connId), { connId: sub.connId, kind: sub.kind, principal: sub.principal }] },
    listSubs: async (s) => [...(subs[s] ?? [])],
    deleteSub: async (s, c) => { subs[s] = (subs[s] ?? []).filter(x => x.connId !== c) },
    setSubWatch: async (s, c, w) => { const x = (subs[s] ?? []).find(y => y.connId === c); if (!x) return false; if (w) x.watch = w; else delete x.watch; return true },
    setSubAway: async (s, c, away, idle) => { const x = (subs[s] ?? []).find(y => y.connId === c); if (!x) return false; if (away) { x.away = true; if (idle !== undefined) x.idle = idle; } else { delete x.away; delete x.idle; } return true },
    markSeen: async (s, ids, at) => { for (const id of ids) if (!((seenAt[s] ??= {})[id] >= at)) seenAt[s][id] = at },
    lastSeen: async (s) => ({ ...(seenAt[s] ?? {}) }),
    connSpaces: async (c) => Object.keys(subs).filter(s => subs[s].some(x => x.connId === c)),
    putInstanceConn: async (i, c) => { if (!(instConns[i] ??= []).includes(c)) instConns[i].push(c) },
    setInstancePlugin: async (id, p) => { const i = instances[id]; if (i && !(i.plugin && i.plugin.at >= p.at)) i.plugin = { ...p } },
    listInstanceConns: async (i) => [...(instConns[i] ?? [])],
    getThread: async (id) => threads[id] ? structuredClone(threads[id]) : null,
    putThread: async (thread, expected) => {
      if (failNext) { failNext = false; return false; }
      const cur = threads[thread.id];
      if ((cur ? cur.version : null) !== expected) return false;
      threads[thread.id] = structuredClone(thread); return true;
    },
    upsertMessage: async (m) => {
      const i = msgs.findIndex(x => x.thread === m.thread && x.id === m.id);
      if (i >= 0) {
        if (m.rev && msgs[i].rev && m.rev <= msgs[i].rev) return null;
        // Like aws.ts: the fields it carries are written again (ask and propose absent = none), files only when given, time kept.
        const { deleted: _d, subtopic: _s, files, ask, propose, ...fields } = structuredClone(m);
        const { ask: _a, propose: _p, ...kept } = msgs[i];
        msgs[i] = { ...kept, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)), at: msgs[i].at, ...(ask ? { ask } : {}), ...(propose ? { propose } : {}), ...(files?.length ? { files } : {}) };
        return { created: false, message: structuredClone(msgs[i]) };
      }
      msgs.push(m); return { created: true, message: m };
    },
    lastMessages: async (thread, k, before) => { const all = msgs.filter(m => m.thread === thread); const i = before ? all.findIndex(m => m.id === before) : -1; return (i >= 0 ? all.slice(0, i) : before ? [] : all).slice(-k) },
    // Like the store: one space = only that space (Queries), several = every space (the Scan: the router must filter by membership).
    searchCorpus: async (sp) => { searchReads.push([...sp]); const keep = (s: string) => sp.length !== 1 || s === sp[0];
      return { threads: Object.values(threads).filter(listed).filter((f: any) => keep(f.space)).map((f: any) => ({ id: f.id, space: f.space, title: f.title, kind: f.kind, updatedAt: f.updatedAt })),
      messages: msgs.filter(m => keep(threads[m.thread]?.space)).map(m => ({ id: m.id, thread: m.thread, author: m.author, type: m.type, text: m.text, files: m.files, at: m.at })) } },
    // Like the GSI byActivity: updatedAt descending (id on a tie), strictly after the cursor, `next` when the limit is hit.
    pageThreads: async (s, limit, after) => {
      const all = Object.values(threads).filter((f: any) => f.space === s && listed(f)).map((f: any) => publicThread(f))
        .sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? 1 : -1))
        .filter(f => !after || f.updatedAt < after.updatedAt || (f.updatedAt === after.updatedAt && f.id < after.id));
      const page = all.slice(0, limit), last = page.at(-1);
      return { threads: page, next: page.length === limit && last ? { updatedAt: last.updatedAt, id: last.id } : null };
    },
    activeThreads: async (s) => Object.values(threads).filter((f: any) => f.space === s && listed(f) && (f.state === 'you' || f.state === 'run') && !f.archived).map((f: any) => publicThread(f)),
    threadsByIds: async (s, ids) => [...new Set(ids)].map(i => threads[i]).filter((f: any) => f && f.space === s && listed(f)).map((f: any) => publicThread(f)),
    listThreads: async (s, since) => Object.values(threads).filter((f: any) => f.space === s && listed(f) && f.updatedAt >= since).map((f: any) => publicThread(f)),
    threadActivity: async (id) => ({ ...(threads[id]?.opener ? { opener: threads[id].opener } : {}),
      messages: msgs.filter(m => m.thread === id).map(m => ({ id: m.id, kind: m.author.kind, author: m.author.id, at: m.at, ...(m.propose?.thread ? { card: m.propose.thread } : {}),
      ...(m.propose?.status === 'open' && !m.propose.thread ? { proposed: { title: m.propose.title, ...(m.propose.by ? { by: m.propose.by } : {}) } } : {}) })) }),
    getSummary: async (f) => structuredClone(summaries[f] ?? null),
    putAttachment: async (a) => { atts[a.id] = { ...a } },
    getAttachments: async (ids) => [...new Set(ids)].map(i => atts[i]).filter(Boolean).map(a => ({ ...a })),
    claimAttachment: async (i, m) => { if (!atts[i] || (atts[i].msg && atts[i].msg !== m)) return false; atts[i].msg = m; return true },
    getGithub: async (sp) => structuredClone(ghs[sp] ?? null),
    putGithub: async (x) => { gh = x; ghs[x.space] = structuredClone(x) },
    putSummary: async (x) => { if (summaries[x.thread] && summaries[x.thread].at >= x.at) return false; summaries[x.thread] = x; return true },
    listPins: async (u, s) => Object.entries(pins).filter(([k, p]) => k.startsWith(`${u}|`) && p.space === s).map(([, p]) => ({ ...p })),
    listReactions: async (thread) => Object.values(reacts).filter((x: any) => x.thread === thread).map((x: any) => ({ ...x })),
    putReaction: async (x) => { const k = `${x.thread}|${x.msg}|${x.emoji}|${x.user}`; if (reacts[k] && reacts[k].at >= x.at) return false; reacts[k] = { ...x }; return true },
    getMessage: async (thread, id) => structuredClone(msgs.find(m => m.thread === thread && m.id === id) ?? null),
    setSubtopic: async (thread, id, topic) => { const m = msgs.find(x => x.thread === thread && x.id === id); if (!m || m.subtopic) return false; m.subtopic = topic; return true },
    deleteMessage: async (thread, id) => { const i = msgs.findIndex(m => m.thread === thread && m.id === id); if (i >= 0) msgs.splice(i, 1) },
    eraseMessage: async (thread, id, rev, deleted) => {
      const i = msgs.findIndex(m => m.thread === thread && m.id === id);
      if (i < 0 || (msgs[i].rev ?? 0) !== rev - 1) return null;
      const { files, edited, ...rest } = msgs[i]; msgs[i] = { ...rest, text: '', rev, deleted }; return structuredClone(msgs[i]);
    },
    getLock: async (s, a) => locks[`${s}|${a}`] ? structuredClone(locks[`${s}|${a}`]) : null,
    putLock: async (l, expected) => { const k = `${l.space}|${l.agent}`; if ((locks[k] ? locks[k].version : null) !== expected) return false; locks[k] = structuredClone(l); return true },
    listLocks: async (s) => Object.values(locks).filter((l: any) => l.space === s).map((l: any) => structuredClone(l)),
    getResource: async (s, r) => resources[`${s}|${r}`] ? structuredClone(resources[`${s}|${r}`]) : null,
    putResource: async (x, expected) => { const k = `${x.space}|${x.resource}`; if ((resources[k] ? resources[k].version : null) !== expected) return false; resources[k] = structuredClone(x); return true },
    listResources: async (s) => Object.values(resources).filter((x: any) => x.space === s).map((x: any) => structuredClone(x)),
    seenMarks: async (u, s, ids) => [...new Set(ids)].filter(t => `${u}|${s}|${t}` in seenM).map(t => ({ thread: t, at: seenM[`${u}|${s}|${t}`] })),
    putSeen: async (u, s, m) => { const k = `${u}|${s}|${m.thread}`; if ((seenM[k] ?? 0) >= m.at) return false; seenM[k] = m.at; return true },
    putPin: async (u, p) => { const k = `${u}|${p.thread}`; if (pins[k] && pins[k].at >= p.at) return false; pins[k] = { ...p }; return true },
    mutedIn: async (s) => Object.entries(mutes).filter(([k, m]) => k.endsWith(`|${s}`) && m.on).map(([k]) => k.slice(0, -s.length - 1)),
    mutesOf: async (u, ss) => [...new Set(ss)].filter(s => `${u}|${s}` in mutes).map(s => ({ ...mutes[`${u}|${s}`] })),
    putMute: async (u, m) => { const k = `${u}|${m.space}`; if (mutes[k] && mutes[k].at >= m.at) return false; mutes[k] = { ...m }; return true },
    issueThreads: async (s) => Object.fromEntries(Object.entries(issueIdx).filter(([k]) => k.startsWith(`${s}|`)).map(([k, v]) => [k.slice(s.length + 1), v])),
    // Like the conditional put: the first writer wins, the others get its thread.
    claimIssueThread: async (s, key, thread) => issueIdx[`${s}|${key}`] ??= thread,
    putFlowRecord: async (r) => { flowRecs[`${r.space}|${r.start}|${r.agent}`] = structuredClone(r) },
    listFlowRecords: async (sp, limit) => Object.values(flowRecs).filter((r: any) => r.space === sp).sort((a: any, b: any) => b.start - a.start).slice(0, limit).map(r => structuredClone(r)),
    listFlowStates: async (sp) => Object.entries(flowLive).filter(([k]) => k.startsWith(`${sp}|`)).map(([, v]) => structuredClone(v)),
    putFlowState: async (sp, st) => { flowLive[`${sp}|${st.agent}`] = structuredClone(st) },
    listFlowPilots: async (sp) => Object.entries(flowPilots).filter(([k]) => k.startsWith(`${sp}|`)).map(([, v]) => structuredClone(v)),
    putFlowPilot: async (sp, p) => { const k = `${sp}|${p.agent}`; if (flowPilots[k]?.state === 'piloted') return false; flowPilots[k] = structuredClone(p); return true },
    claimFlowPilot: async (sp, a, hash, now, next) => { const c = flowPilots[`${sp}|${a}`];
      if (c?.state !== 'pending' || c.hash !== hash || !(c.expiresAt > now)) return false; flowPilots[`${sp}|${a}`] = structuredClone(next); return true },
    deleteFlowPilot: async (sp, a) => { delete flowPilots[`${sp}|${a}`] },
    listRoutines: async (sp) => Object.entries(routines).filter(([k]) => k.startsWith(`${sp}|`)).map(([, v]) => structuredClone(v)),
    putRoutine: async (sp, x, expected) => { const k = `${sp}|${x.id}`; if ((routines[k] ? routines[k].version : null) !== expected) return false; routines[k] = structuredClone(x); return true },
    deleteRoutine: async (sp, id) => { delete routines[`${sp}|${id}`] },
    listApplets: async (sp) => Object.entries(applets).filter(([k]) => k.startsWith(`${sp}|`)).map(([, v]) => structuredClone(v)),
    putApplet: async (sp, x, expected) => { const k = `${sp}|${x.id}`; if ((applets[k] ? applets[k].version : null) !== expected) return false; applets[k] = structuredClone(x); return true },
    deleteApplet: async (sp, id) => { delete applets[`${sp}|${id}`] },
    listItems: async (sp, kind) => Object.entries(items).filter(([k]) => k.startsWith(`${sp}|${kind}#`)).map(([, v]) => structuredClone(v)),
    getItem: async (sp, kind, id) => items[`${sp}|${kind}#${id}`] ? structuredClone(items[`${sp}|${kind}#${id}`]) : null,
    putItem: async (sp, kind, x, expected) => { const k = `${sp}|${kind}#${x.id}`; if ((items[k] ? items[k].version : null) !== expected) return false; items[k] = structuredClone(x); return true },
    deleteItem: async (sp, kind, id) => { delete items[`${sp}|${kind}#${id}`] },
    listSignals: async (sp, limit) => Object.values(signals).filter((s: any) => s.space === sp).sort((a: any, b: any) => b.lastAt - a.lastAt).slice(0, limit).map(s => structuredClone(s)),
    getRadarConfig: async (sp) => structuredClone(radarcfg[sp] ?? null),
    putRadarConfig: async (x, expected) => { if ((radarcfg[x.space] ? radarcfg[x.space].version : null) !== expected) return false; radarcfg[x.space] = structuredClone(x); return true },
    getHiddenUsage: async (sp, day, origin, agent) => structuredClone(hiddenCost[`${sp}|${day}|${origin}|${agent}`] ?? null),
    putHiddenUsage: async (x, expected) => { const k = `${x.space}|${x.day}|${x.origin}|${x.agent}`; if ((hiddenCost[k] ? hiddenCost[k].version : null) !== expected) return false; hiddenCost[k] = structuredClone(x); return true },
    listHiddenUsage: async (sp, from) => Object.values(hiddenCost).filter((x: any) => x.space === sp && x.day >= from).map((x: any) => structuredClone(x)),
    getSignal: async (sp, id) => structuredClone(signals[`${sp}|${id}`] ?? null),
    listCorrespondents: async (sp) => Object.values(exch).filter((r: any) => r.space === sp && r.kind === 'C').map((r: any) => structuredClone(r.data)),
    putCorrespondent: async (c, expected) => { const k = `${c.space}|C#${c.id}`; if ((exch[k] ? exch[k].data.version : null) !== expected) return false; exch[k] = { space: c.space, kind: 'C', data: structuredClone(c) }; return true },
    deleteCorrespondent: async (sp, id) => { delete exch[`${sp}|C#${id}`] },
    listExchanges: async (sp) => Object.values(exch).filter((r: any) => r.space === sp && r.kind === 'X').map((r: any) => structuredClone(r.data)),
    getExchange: async (sp, id) => structuredClone(exch[`${sp}|X#${id}`]?.data ?? null),
    putExchange: async (x, expected) => { const k = `${x.space}|X#${x.id}`; if ((exch[k] ? exch[k].data.version : null) !== expected) return false; exch[k] = { space: x.space, kind: 'X', data: structuredClone(x) }; return true },
    listExchangeMails: async (sp, xid) => Object.values(exch).filter((r: any) => r.space === sp && r.kind === 'M' && r.data.exchange === xid).map((r: any) => structuredClone(r.data)).sort((a: any, b: any) => a.date - b.date || a.id.localeCompare(b.id)),
    getMailOwner: async (sp, id) => exch[`${sp}|MID#${id}`]?.data ?? null,
    putExchangeMail: async (m) => { if (exch[`${m.space}|MID#${m.id}`]) return false; exch[`${m.space}|MID#${m.id}`] = { space: m.space, kind: 'MID', data: m.exchange }; exch[`${m.space}|M#${m.id}`] = { space: m.space, kind: 'M', data: structuredClone(m) }; return true },
    getExchangeConfig: async (sp) => structuredClone(exch[`${sp}|CFG`]?.data ?? null),
    putExchangeConfig: async (c, expected) => { const k = `${c.space}|CFG`; if ((exch[k] ? exch[k].data.version : null) !== expected) return false; exch[k] = { space: c.space, kind: 'CFG', data: structuredClone(c) }; return true },
    deleteExchange: async (sp, id, mails) => { delete exch[`${sp}|X#${id}`]; for (const m of mails) { delete exch[`${sp}|M#${m.id}`]; delete exch[`${sp}|MID#${m.id}`] } },
    putSignal: async (x, expected) => { const k = `${x.space}|${x.id}`; if ((signals[k] ? signals[k].version : null) !== expected) return false; signals[k] = structuredClone(x); return true },
    countAgentTopic: async (sp, a, day, cap) => { const k = `${sp}|${a}|${day}`; if ((agentTopics[k] ?? 0) >= cap) return false; agentTopics[k] = (agentTopics[k] ?? 0) + 1; return true },
    claimFlowWake: async (sp, now, windowMs) => { if (flowWake[sp] !== undefined && flowWake[sp] > now - windowMs) return false; flowWake[sp] = now; return true },
    listPushes: async (u) => Object.values(pushes[u] ?? {}).map(x => structuredClone(x)),
    putPush: async (u, x) => { (pushes[u] ??= {})[x.id] = structuredClone(x) },
    deletePush: async (u, id) => { delete pushes[u]?.[id] },
    putPreview: async (x) => { previews[x.session] = structuredClone(x) },
    getPreview: async (k) => previews[k] ? structuredClone(previews[k]) : null,
    deletePreview: async (k) => { delete previews[k] },
    putVisitor: async (x) => { visitors[x.msg] = structuredClone(x) },
    getVisitor: async (k) => visitors[k] ? structuredClone(visitors[k]) : null,
    deleteVisitor: async (k) => { delete visitors[k] },
    putCiWatch: async (x) => { ciWatches[`${x.thread}#${x.repo}`] = structuredClone(x) },
    listCiWatches: async () => Object.values(ciWatches).map(x => structuredClone(x)),
    putEvent: async (th, _id, ev) => { (events[th] ??= []).push(structuredClone(ev)) },
    threadDetails: async (th) => {
      const ms = msgs.filter(m => m.thread === th);
      return { first: ms.length ? Math.min(...ms.map(m => m.at)) : null, events: structuredClone(events[th] ?? []).sort((a: any, b: any) => a.at - b.at),
        files: ms.flatMap(m => (m.files ?? []).map((f: any) => ({ ...f, msg: m.id, by: m.author.id, at: m.at }))) };
    },
    putBgWatch: async (x) => { bgWatches[x.thread] = structuredClone(x) },
    listBgWatches: async () => Object.values(bgWatches).map(x => structuredClone(x)),
    deleteBgWatch: async (th, d) => { if (!bgWatches[th] || (d !== null && bgWatches[th].deadline !== d)) return false; delete bgWatches[th]; return true },
    deleteCiWatch: async (th, r, sha) => { const k = `${th}#${r}`; if (ciWatches[k]?.sha !== sha) return false; delete ciWatches[k]; return true },
    listMemory: async (sp) => Object.values(memory).filter((x: any) => x.space === sp).map((x: any) => structuredClone(x)),
    getMemory: async (sp, id) => memory[`${sp}|${id}`] ? structuredClone(memory[`${sp}|${id}`]) : null,
    listFlowVersions: async (sp, limit) => (flowcfg[sp] ?? []).slice().reverse().slice(0, limit).map(({ version, by, at, sha, commit }) => ({ version, by, at, sha, ...(commit ? { commit } : {}) })),
    getFlowVersion: async (sp, v) => structuredClone((v === null ? (flowcfg[sp] ?? []).at(-1) : (flowcfg[sp] ?? []).find(x => x.version === v)) ?? null),
    putFlowVersion: async (sp, v) => { const l = flowcfg[sp] ??= []; if (l.some(x => x.version === v.version)) return false; l.push(structuredClone(v)); return true },
    flowColumns: async (sp) => { const v = (flowcfg[sp] ?? []).at(-1); return v ? { approved: approvedColumn(v.def), work: workColumns(v.def) } : null },
    listFlowStatus: async (sp) => Object.entries(flowStat).filter(([k]) => k.startsWith(`${sp}|`)).map(([, v]) => structuredClone(v)),
    putFlowStatus: async (sp, st) => { flowStat[`${sp}|${st.agent}`] = structuredClone(st) },
    getFlowGit: async (sp) => structuredClone(flowGit[sp] ?? null),
    putFlowGit: async (sp, g) => { flowGit[sp] = structuredClone(g) },
    getMemoryConfig: async (sp) => memcfg[sp] ? structuredClone(memcfg[sp]) : null,
    putMemoryConfig: async (x, expected) => { if ((memcfg[x.space] ? memcfg[x.space].version : null) !== expected) return false; memcfg[x.space] = structuredClone(x); return true },
    getMemoryVocab: async (sp) => memvocab[sp] ? structuredClone(memvocab[sp]) : null,
    putMemoryVocab: async (x, expected) => { if ((memvocab[x.space] ? memvocab[x.space].version : null) !== expected) return false; memvocab[x.space] = structuredClone(x); return true },
    addMemoryPending: async (sp, d, arrived) => { const s = spaces[sp]; s.memPending = (s.memPending ?? 0) + d; s.memArrivals = (s.memArrivals ?? 0) + (arrived ? 1 : 0); return { pending: s.memPending, arrivals: s.memArrivals } },
    setMemoryPending: async (sp, n) => { spaces[sp].memPending = n },
    putMemory: async (x, expected) => { const k = `${x.space}|${x.id}`; if ((memory[k] ? memory[k].version : null) !== expected) return false; memory[k] = structuredClone(x); return true },
  };
  return { store, spaces, instances, subs, seenAt, instConns, threads, msgs, searchReads, summaries, atts, exch, pins, mutes, seenM, reacts, locks, resources, issueIdx, flowRecs, previews, visitors, pushes, ciWatches, bgWatches, events, memory, memcfg, memvocab, flowcfg, flowPilots, flowLive, flowWake, agentTopics, flowStat, routines, applets, items, signals, radarcfg, hiddenCost, flowGit, admins, agentInvites, gh: () => gh };
}
