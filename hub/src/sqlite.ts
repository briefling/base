// SQLite adapter of the router (self-hosted, docs/project-status.md « Self-hosted »): the same `Store` as hub/src/aws.ts, on
// node:sqlite (Node built-in, no dependency). Not wired anywhere yet: proven by the Store contract (hub/test/store-contract.ts).
//
// One table mirrors the DynamoDB single-table design: (pk, sk) keys of aws.ts, the record as JSON `doc`, plus the two
// attributes DynamoDB indexes or expires on (`updatedAt` for the byActivity GSI, `ttl` in seconds). Every conditional write
// (version, rev, `at` guards, claims, counters) is a read-check-write inside one IMMEDIATE transaction: node:sqlite is
// synchronous, so nothing else of this process runs in between, and IMMEDIATE takes the write lock up front against another
// process on the same file. Records are written whole (JSON): no attribute list to keep in sync with the types, unlike
// aws.ts (a field missing there is silently dropped).
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { publicThread, type Store, type Sub, type Space, type Instance, type StoredAgentInvite, type ThreadCursor } from './router.ts';
import type { Message, PublicThread } from '../../protocol/frames.ts';
import { approvedColumn, workColumns, EMPTY_TEAM } from '../../protocol/flowteam.ts';
import { vocabIn } from '../../protocol/memory.ts';
import { PREVIEW_SESSION_S } from '../../protocol/preview.ts';

const CONN_TTL_S = 3 * 3600; // like aws.ts: API Gateway drops connections at 2 h
const PUSH_TTL_S = 60 * 86_400;
const nowS = () => Math.floor(Date.now() / 1000);
const flowSk = (version: number) => `FLOWCFG#${String(version).padStart(8, '0')}`;
const mailSk = (exchange: string, date: number, id: string) => `M#${exchange}#${String(date).padStart(13, '0')}#${id}`;
/** Upper bound of a key prefix: every string starting with `p` is >= p and < end(p) (UTF-8 bytes keep code point order). */
const end = (p: string) => p.slice(0, -1) + String.fromCodePoint(p.codePointAt(p.length - 1)! + 1);
const clone = <T>(x: T): T => structuredClone(x);

export interface SqliteStore { store: Store; db: DatabaseSync; seedAdmin(user: string): void; purgeExpired(now?: number): number; close(): void }

export function openSqliteStore(path = ':memory:'): SqliteStore {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS items (pk TEXT NOT NULL, sk TEXT NOT NULL, doc TEXT NOT NULL, updatedAt INTEGER, ttl INTEGER,
      PRIMARY KEY (pk, sk)) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS byActivity ON items (pk, updatedAt, sk) WHERE updatedAt IS NOT NULL;
    CREATE INDEX IF NOT EXISTS byTtl ON items (ttl) WHERE ttl IS NOT NULL;`);
  const stmts = new Map<string, StatementSync>();
  const q = (sql: string) => { let s = stmts.get(sql); if (!s) stmts.set(sql, s = db.prepare(sql)); return s; };
  const row = (pk: string, sk: string): any => { const r = q('SELECT doc FROM items WHERE pk = ? AND sk = ?').get(pk, sk) as any; return r ? JSON.parse(r.doc) : null };
  const put = (pk: string, sk: string, doc: unknown, o: { updatedAt?: number; ttl?: number } = {}) =>
    void q('INSERT OR REPLACE INTO items (pk, sk, doc, updatedAt, ttl) VALUES (?, ?, ?, ?, ?)').run(pk, sk, JSON.stringify(doc), o.updatedAt ?? null, o.ttl ?? null);
  const del = (pk: string, sk: string) => q('DELETE FROM items WHERE pk = ? AND sk = ?').run(pk, sk).changes > 0;
  const ttlOf = (pk: string, sk: string): number | null => (q('SELECT ttl FROM items WHERE pk = ? AND sk = ?').get(pk, sk) as any)?.ttl ?? null;
  /** Rows of a partition whose sort key starts with `prefix` ('' = all), in key order. */
  const prefixed = (pk: string, prefix: string, o: { desc?: boolean; limit?: number } = {}): { sk: string; doc: any; ttl: number | null }[] =>
    (prefix
      ? q(`SELECT sk, doc, ttl FROM items WHERE pk = ? AND sk >= ? AND sk < ? ORDER BY sk ${o.desc ? 'DESC' : 'ASC'} LIMIT ?`).all(pk, prefix, end(prefix), o.limit ?? -1)
      : q(`SELECT sk, doc, ttl FROM items WHERE pk = ? ORDER BY sk ${o.desc ? 'DESC' : 'ASC'} LIMIT ?`).all(pk, o.limit ?? -1))
      .map((r: any) => ({ sk: r.sk, doc: JSON.parse(r.doc), ttl: r.ttl }));
  const docs = (pk: string, prefix: string, o: { desc?: boolean; limit?: number } = {}) => prefixed(pk, prefix, o).map(r => r.doc);
  let depth = 0;
  /** One IMMEDIATE transaction (re-entrant: an inner call joins the outer one). */
  const tx = <T>(fn: () => T): T => {
    if (depth) { depth++; try { return fn() } finally { depth-- } }
    db.exec('BEGIN IMMEDIATE'); depth = 1;
    try { const r = fn(); db.exec('COMMIT'); return r }
    catch (e) { db.exec('ROLLBACK'); throw e }
    finally { depth = 0 }
  };
  /** Version guard of aws.ts (`attribute_not_exists(pk)` for null, `version = expected` otherwise). */
  const putVersioned = (pk: string, sk: string, x: { version: number }, expected: number | null, o: { updatedAt?: number } = {}) => tx(() => {
    const cur = row(pk, sk);
    if (expected === null ? cur : !cur || cur.version !== expected) return false;
    put(pk, sk, x, o); return true;
  });
  /** `at` guard of aws.ts (`attribute_not_exists(at) OR at < :at`). */
  const putLater = <T extends { at: number }>(pk: string, sk: string, x: T) => tx(() => {
    const cur = row(pk, sk);
    if (cur && typeof cur.at === 'number' && !(cur.at < x.at)) return false;
    put(pk, sk, x); return true;
  });
  const indexAdd = (sk: string, attr: string, id: string, on: boolean) => {
    const cur: string[] = row('INDEX', sk)?.[attr] ?? [];
    const next = on ? (cur.includes(id) ? cur : [...cur, id]) : cur.filter(x => x !== id);
    put('INDEX', sk, { [attr]: next });
  };
  const indexed = (sk: string, attr: string): string[] => row('INDEX', sk)?.[attr] ?? [];
  const toSpace = (s: any): Space => ({ ...s, members: s.members ?? [], trusted: s.trusted ?? [], contributors: s.contributors ?? [], nontech: s.nontech ?? [], admins: s.admins ?? [] });
  const msgOut = (m: any): Message => { if (m.ask === null) delete m.ask; if (m.propose === null) delete m.propose; return m };

  const store: Store = {
    // ------------------------------------------------------------ spaces and instances (INDEX rows like aws.ts)
    async getSpace(id) { const s = row(`SPACE#${id}`, 'META'); return s ? toSpace(s) : null },
    async listSpaces() { return indexed('SPACES', 'spaces').map(id => row(`SPACE#${id}`, 'META')).filter(Boolean).map(toSpace) },
    async isAdmin(user) { return indexed('ADMINS', 'users').includes(user) },
    async createSpace(s) {
      return tx(() => { if (row(`SPACE#${s.id}`, 'META')) return false; put(`SPACE#${s.id}`, 'META', s); indexAdd('SPACES', 'spaces', s.id, true); return true });
    },
    async updateSpace(s, expected) {
      return tx(() => {
        const cur = row(`SPACE#${s.id}`, 'META');
        if (!cur || (cur.version ?? 0) !== expected) return false;
        // Same attributes as aws.ts updateSpace: the settings; `github`, the memory counters and the rest kept.
        const next: any = { ...cur, name: s.name ?? s.id, about: s.about ?? '', members: s.members, trusted: s.trusted, contributors: s.contributors ?? [],
          agents: s.agents ?? [s.defaultAgent], defaultAgent: s.defaultAgent, names: s.names ?? {}, roles: s.roles ?? {}, agentRoles: s.agentRoles ?? {},
          avatars: s.avatars ?? {}, agentAvatars: s.agentAvatars ?? {}, nontech: s.nontech ?? [], admins: s.admins ?? [], version: s.version };
        for (const f of ['parallel', 'driver', 'identities', 'repos', 'repoOrgs', 'memory', 'memoryAgent', 'memoryBatch', 'memoryCompact', 'modulesOff', 'modulesIn'] as const)
          if (s[f]) next[f] = s[f];
        if (typeof s.ci === 'boolean') next.ci = s.ci;
        if (typeof s.memoryHidden === 'boolean') next.memoryHidden = s.memoryHidden;
        if (s.tagMax !== undefined) next.tagMax = s.tagMax;
        if (s.relayMax !== undefined) next.relayMax = s.relayMax;
        if (s.archived) next.archived = s.archived; else delete next.archived;
        put(`SPACE#${s.id}`, 'META', next); return true;
      });
    },
    async setProfile(space, user, name, role, avatar) {
      return tx(() => {
        const s = row(`SPACE#${space}`, 'META');
        if (!s || !(s.members ?? []).includes(user)) return false;
        s.names = { ...(s.names ?? {}), [user]: name };
        s.roles = { ...(s.roles ?? {}) }; if (role) s.roles[user] = role; else delete s.roles[user];
        s.avatars = { ...(s.avatars ?? {}) }; if (avatar) s.avatars[user] = avatar; else if (avatar === '') delete s.avatars[user];
        put(`SPACE#${space}`, 'META', s); return true;
      });
    },
    async addMemoryPending(space, delta, arrived) {
      return tx(() => {
        const s = row(`SPACE#${space}`, 'META');
        if (!s) throw new Error('space_missing'); // aws.ts: the condition fails and throws
        s.memPending = (s.memPending ?? 0) + delta; s.memArrivals = (s.memArrivals ?? 0) + (arrived ? 1 : 0);
        put(`SPACE#${space}`, 'META', s); return { pending: s.memPending, arrivals: s.memArrivals };
      });
    },
    async setMemoryPending(space, n) {
      tx(() => { const s = row(`SPACE#${space}`, 'META'); if (!s) throw new Error('space_missing'); s.memPending = n; put(`SPACE#${space}`, 'META', s) });
    },
    async getInstance(id) { const i = row(`INSTANCE#${id}`, 'META'); return i ? i as Instance : null },
    async listInstances() { return indexed('INSTANCES', 'ids').map(id => row(`INSTANCE#${id}`, 'META')).filter(Boolean) },
    async createInstance(i) {
      return tx(() => { if (row(`INSTANCE#${i.id}`, 'META')) return false; put(`INSTANCE#${i.id}`, 'META', i); indexAdd('INSTANCES', 'ids', i.id, true); return true });
    },
    async deleteInstance(id) { tx(() => { del(`INSTANCE#${id}`, 'META'); indexAdd('INSTANCES', 'ids', id, false) }) },
    async markInstanceConnected(id, at) {
      tx(() => { const i = row(`INSTANCE#${id}`, 'META'); if (i && !i.connectedAt) { i.connectedAt = at; put(`INSTANCE#${id}`, 'META', i) } });
    },
    async setInstancePlugin(id, plugin) {
      tx(() => { const i = row(`INSTANCE#${id}`, 'META'); if (i && !(i.plugin && i.plugin.at >= plugin.at)) { i.plugin = plugin; put(`INSTANCE#${id}`, 'META', i) } });
    },
    async bindInstance(id, space, on) {
      tx(() => {
        const i = row(`INSTANCE#${id}`, 'META');
        if (!i || (i.spaces ?? []).includes(space) === on) return;
        i.spaces = on ? [...(i.spaces ?? []), space] : i.spaces.filter((s: string) => s !== space);
        i.version = (i.version ?? 0) + 1; put(`INSTANCE#${id}`, 'META', i);
      });
    },
    async putAgentInvite(inv) {
      tx(() => {
        if (row('AGENTINVITE', inv.hash)) throw new Error('invite_exists'); // aws.ts: conditional put, not caught
        put('AGENTINVITE', inv.hash, inv, { ttl: Math.floor(inv.expiresAt / 1000) + 30 * 86400 });
      });
    },
    async getAgentInvite(hash) { return row('AGENTINVITE', hash) },
    async listAgentInvites() { return docs('AGENTINVITE', '') },
    async claimAgentInvite(hash, now) {
      return tx(() => {
        const i = row('AGENTINVITE', hash);
        if (!i || i.state !== 'pending' || !(i.expiresAt > now)) return false;
        put('AGENTINVITE', hash, { ...i, state: 'used', usedAt: now }, { ttl: ttlOf('AGENTINVITE', hash) ?? undefined }); return true;
      });
    },
    async setAgentInvite(hash, from, patch) {
      return tx(() => {
        const i: StoredAgentInvite | null = row('AGENTINVITE', hash);
        if (!i || i.state !== from) return false;
        const next: StoredAgentInvite = { ...i, ...(patch.state ? { state: patch.state } : {}), ...(patch.instance ? { instance: patch.instance } : {}) };
        if (patch.state === 'pending') { delete next.usedAt; delete next.instance; }
        put('AGENTINVITE', hash, next, { ttl: ttlOf('AGENTINVITE', hash) ?? undefined }); return true;
      });
    },

    // ------------------------------------------------------------ connections (TTL rows, filtered on read like aws.ts)
    async putSub(space, sub) {
      tx(() => {
        put(`SUB#${space}`, `CONN#${sub.connId}`, { kind: sub.kind, principal: sub.principal }, { ttl: nowS() + CONN_TTL_S });
        const c = row(`CONN#${sub.connId}`, 'META') ?? { spaces: [] };
        if (!c.spaces.includes(space)) c.spaces.push(space);
        put(`CONN#${sub.connId}`, 'META', c);
      });
    },
    async listSubs(space) {
      const now = nowS();
      return prefixed(`SUB#${space}`, 'CONN#').filter(r => (r.ttl ?? 0) > now).map(({ sk, doc: i }) => ({ connId: sk.slice(5), kind: i.kind, principal: i.principal,
        ...(i.away === true ? { away: true, ...(typeof i.idle === 'number' ? { idle: i.idle } : {}) } : {}), ...(typeof i.watch === 'string' ? { watch: i.watch } : {}) }) as Sub);
    },
    async deleteSub(space, connId) { del(`SUB#${space}`, `CONN#${connId}`) },
    async setSubAway(space, connId, away, idle) {
      return tx(() => {
        const pk = `SUB#${space}`, sk = `CONN#${connId}`, s = row(pk, sk);
        if (!s) return false;
        s.away = away; if (away && idle !== undefined) s.idle = idle; else delete s.idle;
        put(pk, sk, s, { ttl: ttlOf(pk, sk) ?? undefined }); return true;
      });
    },
    async setSubWatch(space, connId, thread) {
      return tx(() => {
        const pk = `SUB#${space}`, sk = `CONN#${connId}`, s = row(pk, sk);
        if (!s) return false;
        if (thread) s.watch = thread; else delete s.watch;
        put(pk, sk, s, { ttl: ttlOf(pk, sk) ?? undefined }); return true;
      });
    },
    async markSeen(space, ids, at) {
      tx(() => { for (const id of ids) { const cur = row(`SPACE#${space}`, `SEEN#${id}`); if (!cur || cur.at < at) put(`SPACE#${space}`, `SEEN#${id}`, { at }) } });
    },
    async lastSeen(space) { return Object.fromEntries(prefixed(`SPACE#${space}`, 'SEEN#').filter(r => typeof r.doc.at === 'number').map(r => [r.sk.slice(5), r.doc.at])) },
    async connSpaces(connId) { return [...(row(`CONN#${connId}`, 'META')?.spaces ?? [])] },
    async putInstanceConn(instance, connId) { put(`INSTANCE#${instance}`, `CONN#${connId}`, {}, { ttl: nowS() + CONN_TTL_S }) },
    async listInstanceConns(instance) { const now = nowS(); return prefixed(`INSTANCE#${instance}`, 'CONN#').filter(r => (r.ttl ?? 0) > now).map(r => r.sk.slice(5)) },

    // ------------------------------------------------------------ threads: META row + public index row SPACE#/THREAD#
    async getThread(id) { return row(`THREAD#${id}`, 'META') },
    async putThread(thread, expected) {
      return tx(() => {
        const cur = row(`THREAD#${thread.id}`, 'META');
        if (expected === null ? cur : !cur || cur.version !== expected) return false;
        put(`THREAD#${thread.id}`, 'META', thread);
        // The memory agent's review conversation has no index row: never listed, searched nor counted (like aws.ts).
        if (!thread.memoryReview) {
          const idx = row(`SPACE#${thread.space}`, `THREAD#${thread.id}`);
          if (!idx || idx.version < thread.version) put(`SPACE#${thread.space}`, `THREAD#${thread.id}`, publicThread(thread), { updatedAt: thread.updatedAt });
        }
        return true;
      });
    },
    // byActivity: updatedAt descending, then id descending on a tie (aws.ts: the GSI), strictly after the cursor.
    async pageThreads(space, limit, after) {
      const rows = (after
        ? q(`SELECT doc FROM items WHERE pk = ? AND sk >= 'THREAD#' AND sk < 'THREAD$' AND updatedAt IS NOT NULL AND (updatedAt < ? OR (updatedAt = ? AND sk < ?))
            ORDER BY updatedAt DESC, sk DESC LIMIT ?`).all(`SPACE#${space}`, after.updatedAt, after.updatedAt, `THREAD#${after.id}`, limit)
        : q(`SELECT doc FROM items WHERE pk = ? AND sk >= 'THREAD#' AND sk < 'THREAD$' AND updatedAt IS NOT NULL ORDER BY updatedAt DESC, sk DESC LIMIT ?`)
          .all(`SPACE#${space}`, limit)).map((r: any) => JSON.parse(r.doc) as PublicThread);
      const last = rows.at(-1);
      return { threads: rows, next: rows.length === limit && last ? { updatedAt: last.updatedAt, id: last.id } as ThreadCursor : null };
    },
    async activeThreads(space) { return docs(`SPACE#${space}`, 'THREAD#').filter(t => (t.state === 'you' || t.state === 'run') && !t.archived) },
    async threadsByIds(space, ids) { return [...new Set(ids)].map(id => row(`SPACE#${space}`, `THREAD#${id}`)).filter(Boolean) },
    async listThreads(space, since) { return docs(`SPACE#${space}`, 'THREAD#').filter(t => t.updatedAt >= since) },
    async threadActivity(thread) {
      const out: Awaited<ReturnType<Store['threadActivity']>> = { messages: [] };
      const meta = row(`THREAD#${thread}`, 'META');
      if (typeof meta?.opener === 'string') out.opener = meta.opener;
      for (const i of docs(`THREAD#${thread}`, 'MSG#')) if (i.author) out.messages.push({ id: i.id, kind: i.author.kind, author: i.author.id, at: i.at,
        ...(i.propose?.thread ? { card: i.propose.thread } : {}),
        ...(i.propose?.status === 'open' && !i.propose.thread && typeof i.propose.title === 'string' ? { proposed: { title: i.propose.title, ...(i.propose.by ? { by: i.propose.by } : {}) } } : {}) });
      return out;
    },
    async searchCorpus(spaces) {
      const threads = [], messages = [];
      for (const space of new Set(spaces)) for (const t of docs(`SPACE#${space}`, 'THREAD#')) {
        threads.push({ id: t.id, space: t.space, title: t.title, ...(t.kind ? { kind: t.kind } : {}), updatedAt: t.updatedAt });
        for (const m of docs(`THREAD#${t.id}`, 'MSG#')) messages.push({ id: m.id, thread: m.thread, author: m.author, type: m.type, text: m.text, ...(m.files ? { files: m.files } : {}), at: m.at });
      }
      return { threads, messages };
    },
    async getSummary(thread) { return row(`THREAD#${thread}`, 'SUMMARY') },
    async putSummary(s) { return putLater(`THREAD#${s.thread}`, 'SUMMARY', s) },

    // ------------------------------------------------------------ messages (THREAD#<t> / MSG#<id>, `rev` guard)
    async upsertMessage(m) {
      return tx(() => {
        const pk = `THREAD#${m.thread}`, sk = `MSG#${m.id}`, cur = row(pk, sk), rev = m.rev ?? 0;
        // An older edit (lower or equal rev) never overwrites the latest one; rev 0 = streaming rewrite, always written.
        if (cur && !(cur.rev === undefined || cur.rev < rev || rev === 0)) return null;
        // The whole message is written (no field list), except what its own methods own; files only when provided.
        const { deleted: _d, subtopic: _s, files, ...fields } = m;
        const next: any = { ...(cur ?? {}), ...fields, at: cur?.at ?? m.at, rev, ...(files?.length ? { files } : {}) };
        if (m.ask === undefined) delete next.ask;
        if (m.propose === undefined) delete next.propose;
        for (const f of Object.keys(next)) if (next[f] === undefined) delete next[f];
        put(pk, sk, next);
        return { created: !cur, message: msgOut(next) };
      });
    },
    async lastMessages(thread, n, before) {
      const rows = before
        ? q(`SELECT doc FROM items WHERE pk = ? AND sk >= 'MSG#' AND sk < ? ORDER BY sk DESC LIMIT ?`).all(`THREAD#${thread}`, `MSG#${before}`, n)
        : q(`SELECT doc FROM items WHERE pk = ? AND sk >= 'MSG#' AND sk < 'MSG$' ORDER BY sk DESC LIMIT ?`).all(`THREAD#${thread}`, n);
      return rows.map((r: any) => msgOut(JSON.parse(r.doc))).reverse();
    },
    async getMessage(thread, id) { const m = row(`THREAD#${thread}`, `MSG#${id}`); return m ? msgOut(m) : null },
    async setSubtopic(thread, id, topic) {
      return tx(() => { const m = row(`THREAD#${thread}`, `MSG#${id}`); if (!m || m.subtopic) return false; m.subtopic = topic; put(`THREAD#${thread}`, `MSG#${id}`, m); return true });
    },
    async deleteMessage(thread, id) { del(`THREAD#${thread}`, `MSG#${id}`) },
    async eraseMessage(thread, id, rev, deleted) {
      return tx(() => {
        const m = row(`THREAD#${thread}`, `MSG#${id}`);
        if (!m || (m.rev ?? 0) !== rev - 1) return null;
        const { files: _f, edited: _e, ...rest } = m;
        const next = { ...rest, text: '', rev, deleted };
        put(`THREAD#${thread}`, `MSG#${id}`, next); return msgOut(next);
      });
    },
    async listReactions(thread) { return docs(`THREAD#${thread}`, 'REACT#') },
    async putReaction(r) { return putLater(`THREAD#${r.thread}`, `REACT#${r.msg}#${r.emoji}#${r.user}`, r) },
    async putEvent(thread, id, ev) { put(`THREAD#${thread}`, `EV#${String(ev.at).padStart(15, '0')}#${id}`, ev) },
    async threadDetails(thread) {
      const out: Awaited<ReturnType<Store['threadDetails']>> = { first: null, files: [], events: [] };
      for (const { sk, doc: i } of prefixed(`THREAD#${thread}`, '')) {
        if (sk.startsWith('MSG#') && typeof i.at === 'number') {
          if (out.first === null || i.at < out.first) out.first = i.at;
          for (const f of Array.isArray(i.files) ? i.files : []) out.files.push({ ...f, msg: i.id, by: i.author?.id ?? '', at: i.at });
        } else if (sk.startsWith('EV#')) out.events.push(i);
      }
      return out;
    },

    // ------------------------------------------------------------ attachments, GitHub, personal marks
    async putAttachment(a) { put(`ATT#${a.id}`, 'META', a) },
    async getAttachments(ids) { return [...new Set(ids)].map(id => row(`ATT#${id}`, 'META')).filter(Boolean) },
    async claimAttachment(id, msg) {
      return tx(() => { const a = row(`ATT#${id}`, 'META'); if (!a || (a.msg && a.msg !== msg)) return false; a.msg = msg; put(`ATT#${id}`, 'META', a); return true });
    },
    async getGithub(space) { return row(`SPACE#${space}`, 'GITHUB') },
    async putGithub(s) { put(`SPACE#${s.space}`, 'GITHUB', s) },
    async listPins(user, space) { return docs(`USER#${user}`, 'PIN#').filter(p => p.space === space) },
    async putPin(user, p) { return putLater(`USER#${user}`, `PIN#${p.thread}`, p) },
    async mutedIn(space) { return docs(`SPACE#${space}`, 'MUTE#').filter(m => m.on === true).map(m => m.user) },
    async mutesOf(user, spaces) {
      return [...new Set(spaces)].map(s => row(`SPACE#${s}`, `MUTE#${user}`)).filter(Boolean).map(m => ({ space: m.space, on: m.on === true, at: m.at }));
    },
    async putMute(user, m) { return putLater(`SPACE#${m.space}`, `MUTE#${user}`, { user, ...m }) },
    async seenMarks(user, space, threads) {
      return [...new Set(threads)].map(t => row(`USER#${user}`, `SEEN#${space}#${t}`)).filter(Boolean).map(m => ({ thread: m.thread, at: m.at }));
    },
    async putSeen(user, space, m) { return putLater(`USER#${user}`, `SEEN#${space}#${m.thread}`, { space, thread: m.thread, at: m.at }) },

    // ------------------------------------------------------------ agent hand, shared resources (`version` guards)
    async getLock(space, agent) { return row(`SPACE#${space}`, `LOCK#${agent}`) },
    async putLock(lock, expected) { return putVersioned(`SPACE#${lock.space}`, `LOCK#${lock.agent}`, lock, expected) },
    async listLocks(space) { return docs(`SPACE#${space}`, 'LOCK#') },
    async getResource(space, resource) { return row(`SPACE#${space}`, `RES#${resource}`) },
    async putResource(r, expected) { return putVersioned(`SPACE#${r.space}`, `RES#${r.resource}`, r, expected) },
    async listResources(space) { return docs(`SPACE#${space}`, 'RES#') },

    // ------------------------------------------------------------ push, previews, visitors, watches (TTL rows)
    async listPushes(user) { return docs(`USER#${user}`, 'PUSH#') },
    async putPush(user, p) { put(`USER#${user}`, `PUSH#${p.id}`, p, { ttl: Math.floor(p.at / 1000) + PUSH_TTL_S }) },
    async deletePush(user, id) { del(`USER#${user}`, `PUSH#${id}`) },
    async putPreview(p) { put(`PREVIEW#${p.session}`, 'META', p, { ttl: Math.floor(p.at / 1000) + PREVIEW_SESSION_S }) },
    async getPreview(session) { return row(`PREVIEW#${session}`, 'META') },
    async deletePreview(session) { del(`PREVIEW#${session}`, 'META') },
    async putVisitor(v) { put(`VISITOR#${v.msg}`, 'META', v, { ttl: Math.floor(v.until / 1000) + 3600 }) },
    async getVisitor(msg) { return row(`VISITOR#${msg}`, 'META') },
    async deleteVisitor(msg) { del(`VISITOR#${msg}`, 'META') },
    async putCiWatch(w) { put('CIWATCH', `${w.thread}#${w.repo}`, w, { ttl: Math.floor(w.deadline / 1000) + 86_400 }) },
    async listCiWatches() { return docs('CIWATCH', '') },
    async deleteCiWatch(thread, repo, sha) {
      return tx(() => { const w = row('CIWATCH', `${thread}#${repo}`); if (!w || w.sha !== sha) return false; return del('CIWATCH', `${thread}#${repo}`) });
    },
    async putBgWatch(w) { put('BGWATCH', w.thread, w, { ttl: Math.floor(w.deadline / 1000) + 86_400 }) },
    async listBgWatches() { return docs('BGWATCH', '') },
    async deleteBgWatch(thread, deadline) {
      return tx(() => { const w = row('BGWATCH', thread); if (!w || (deadline !== null && w.deadline !== deadline)) return false; return del('BGWATCH', thread) });
    },

    // ------------------------------------------------------------ project memory
    async listMemory(space) { return docs(`MEM#${space}`, '') },
    async getMemory(space, id) { return row(`MEM#${space}`, id) },
    async putMemory(e, expected) { return putVersioned(`MEM#${e.space}`, e.id, e, expected) },
    async getMemoryConfig(space) { return row(`SPACE#${space}`, 'MEMCFG') },
    async putMemoryConfig(c, expected) { return putVersioned(`SPACE#${c.space}`, 'MEMCFG', c, expected) },
    async getMemoryVocab(space) { const v = row(`SPACE#${space}`, 'MEMTAGS'); return v ? vocabIn(space, v) : null },
    async putMemoryVocab(v, expected) { return putVersioned(`SPACE#${v.space}`, 'MEMTAGS', v, expected) },

    // ------------------------------------------------------------ flow (board)
    async listFlowVersions(space, limit) {
      return docs(`SPACE#${space}`, 'FLOWCFG#', { desc: true, limit }).map(v => ({ version: v.version, by: v.by, at: v.at, sha: v.sha, ...(v.commit ? { commit: v.commit } : {}) }));
    },
    async getFlowVersion(space, version) {
      const v = version === null ? docs(`SPACE#${space}`, 'FLOWCFG#', { desc: true, limit: 1 })[0] ?? null : row(`SPACE#${space}`, flowSk(version));
      return v ? { ...v, team: v.team ?? clone(EMPTY_TEAM) } : null;
    },
    async putFlowVersion(space, v) {
      return tx(() => { if (row(`SPACE#${space}`, flowSk(v.version))) return false; put(`SPACE#${space}`, flowSk(v.version), v); return true });
    },
    async flowColumns(space) {
      const v = docs(`SPACE#${space}`, 'FLOWCFG#', { desc: true, limit: 1 })[0];
      return v ? { approved: approvedColumn(v.def), work: workColumns(v.def) } : null;
    },
    async listFlowStatus(space) { return docs(`SPACE#${space}`, 'FLOWSTAT#') },
    async putFlowStatus(space, st) { put(`SPACE#${space}`, `FLOWSTAT#${st.agent}`, st) },
    async getFlowGit(space) { return row(`SPACE#${space}`, 'FLOWGIT') },
    async putFlowGit(space, g) { put(`SPACE#${space}`, 'FLOWGIT', g) },
    async issueThreads(space) { return Object.fromEntries(prefixed(`SPACE#${space}`, 'ISSUE#').map(r => [r.sk.slice(6), r.doc.thread])) },
    async claimIssueThread(space, key, thread) {
      return tx(() => { const cur = row(`SPACE#${space}`, `ISSUE#${key}`); if (cur) return cur.thread; put(`SPACE#${space}`, `ISSUE#${key}`, { thread }); return thread });
    },
    async putFlowRecord(r) { put(`SPACE#${r.space}`, `FLOWREC#${String(r.start).padStart(10, '0')}#${r.agent}`, r) },
    async listFlowRecords(space, limit) { return docs(`SPACE#${space}`, 'FLOWREC#', { desc: true, limit }) },
    async listFlowStates(space) { return docs(`SPACE#${space}`, 'FLOWLIVE#') },
    async putFlowState(space, st) { put(`SPACE#${space}`, `FLOWLIVE#${st.agent}`, st) },
    async claimFlowWake(space, now, windowMs) {
      return tx(() => { const w = row(`SPACE#${space}`, 'FLOWWAKE'); if (w && w.at > now - windowMs) return false; put(`SPACE#${space}`, 'FLOWWAKE', { at: now }); return true });
    },
    async countAgentTopic(space, agent, day, cap) {
      return tx(() => {
        const sk = `AGENTTOPICS#${agent}#${day}`, c = row(`SPACE#${space}`, sk);
        if (c && c.n >= cap) return false;
        put(`SPACE#${space}`, sk, { n: (c?.n ?? 0) + 1 }, { ttl: nowS() + 2 * 86400 }); return true;
      });
    },
    async listFlowPilots(space) { return docs(`SPACE#${space}`, 'FLOWPILOT#') },
    async putFlowPilot(space, p) {
      return tx(() => { const cur = row(`SPACE#${space}`, `FLOWPILOT#${p.agent}`); if (cur?.state === 'piloted') return false; put(`SPACE#${space}`, `FLOWPILOT#${p.agent}`, p); return true });
    },
    async claimFlowPilot(space, agent, hash, now, next) {
      return tx(() => {
        const cur = row(`SPACE#${space}`, `FLOWPILOT#${agent}`);
        if (cur?.state !== 'pending' || cur.hash !== hash || !((cur.expiresAt ?? 0) > now)) return false;
        put(`SPACE#${space}`, `FLOWPILOT#${agent}`, next); return true;
      });
    },
    async deleteFlowPilot(space, agent) { del(`SPACE#${space}`, `FLOWPILOT#${agent}`) },

    // ------------------------------------------------------------ routines, module records, applets (JSON + `version`)
    async listRoutines(space) { return docs(`SPACE#${space}`, 'ROUTINE#') },
    async putRoutine(space, r, expected) { return putVersioned(`SPACE#${space}`, `ROUTINE#${r.id}`, r, expected) },
    async deleteRoutine(space, id) { del(`SPACE#${space}`, `ROUTINE#${id}`) },
    async listItems(space, kind) { return docs(`SPACE#${space}`, `${kind}#`) },
    async getItem(space, kind, id) { return row(`SPACE#${space}`, `${kind}#${id}`) },
    async putItem(space, kind, x, expected) { return putVersioned(`SPACE#${space}`, `${kind}#${x.id}`, x, expected) },
    async deleteItem(space, kind, id) { del(`SPACE#${space}`, `${kind}#${id}`) },
    async listApplets(space) { return docs(`SPACE#${space}`, 'APPLET#') },
    async putApplet(space, a, expected) { return putVersioned(`SPACE#${space}`, `APPLET#${a.id}`, a, expected) },
    async deleteApplet(space, id) { del(`SPACE#${space}`, `APPLET#${id}`) },

    // ------------------------------------------------------------ mail exchanges (EXCH#<space>)
    async listCorrespondents(space) { return docs(`EXCH#${space}`, 'C#') },
    async putCorrespondent(c, expected) { return putVersioned(`EXCH#${c.space}`, `C#${c.id}`, c, expected) },
    async deleteCorrespondent(space, id) { del(`EXCH#${space}`, `C#${id}`) },
    async listExchanges(space) { return docs(`EXCH#${space}`, 'X#') },
    async getExchange(space, id) { return row(`EXCH#${space}`, `X#${id}`) },
    async putExchange(x, expected) { return putVersioned(`EXCH#${x.space}`, `X#${x.id}`, x, expected) },
    async listExchangeMails(space, exchange) { return docs(`EXCH#${space}`, `M#${exchange}#`) },
    async getMailOwner(space, mail) { return row(`EXCH#${space}`, `MID#${mail}`)?.exchange ?? null },
    async putExchangeMail(m) {
      return tx(() => {
        if (row(`EXCH#${m.space}`, `MID#${m.id}`)) return false;
        put(`EXCH#${m.space}`, `MID#${m.id}`, { exchange: m.exchange }); put(`EXCH#${m.space}`, mailSk(m.exchange, m.date, m.id), m); return true;
      });
    },
    async deleteExchange(space, id, mails) {
      tx(() => { del(`EXCH#${space}`, `X#${id}`); for (const m of mails) { del(`EXCH#${space}`, mailSk(id, m.date, m.id)); del(`EXCH#${space}`, `MID#${m.id}`) } });
    },
    async getExchangeConfig(space) { return row(`EXCH#${space}`, 'CFG') },
    async putExchangeConfig(c, expected) { return putVersioned(`EXCH#${c.space}`, 'CFG', c, expected) },

    // ------------------------------------------------------------ Radar, hidden spend
    async listSignals(space, limit) { return docs(`SPACE#${space}`, 'SIGNAL#').sort((a, b) => b.lastAt - a.lastAt || a.id.localeCompare(b.id)).slice(0, limit) },
    async getSignal(space, id) { return row(`SPACE#${space}`, `SIGNAL#${id}`) },
    async putSignal(x, expected) { return putVersioned(`SPACE#${x.space}`, `SIGNAL#${x.id}`, x, expected) },
    async getRadarConfig(space) { return row(`SPACE#${space}`, 'RADARCFG') },
    async putRadarConfig(c, expected) { return putVersioned(`SPACE#${c.space}`, 'RADARCFG', c, expected) },
    async getHiddenUsage(space, day, origin, agent) { return row(`SPACE#${space}`, `HIDDENCOST#${day}#${origin}#${agent}`) },
    async putHiddenUsage(x, expected) { return putVersioned(`SPACE#${x.space}`, `HIDDENCOST#${x.day}#${x.origin}#${x.agent}`, x, expected) },
    async listHiddenUsage(space, fromDay) {
      return q(`SELECT doc FROM items WHERE pk = ? AND sk >= ? AND sk < 'HIDDENCOST$' ORDER BY sk`).all(`SPACE#${space}`, `HIDDENCOST#${fromDay}`).map((r: any) => JSON.parse(r.doc));
    },
  };
  return {
    store, db,
    seedAdmin(user) { tx(() => indexAdd('ADMINS', 'users', user, true)) },
    /** DynamoDB's TTL sweep: deletes the rows past their `ttl` (seconds); the standalone server calls it on a timer. */
    purgeExpired(now = nowS()) { return Number(q('DELETE FROM items WHERE ttl IS NOT NULL AND ttl < ?').run(now).changes) },
    close() { db.close() },
  };
}
