// Store contract (docs/project-status.md « Self-hosted »): ONE suite, run on every backend of the `Store` interface
// (hub/src/router.ts): the fake store of the router tests (memstore.ts), SQLite (hub/src/sqlite.ts) and DynamoDB (hub/src/aws.ts,
// only when STORE_CONTRACT_TABLE names a disposable table). DynamoDB in prod is the reference: every expectation here is
// what aws.ts does, read from its conditions. Guards first (versions, revs, locks, resources, atomic counters, pagination).
// Ids carry a per-run prefix: the suite runs on a shared table without cleaning it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Store } from '../src/router.ts';
import { FLOW_TEMPLATES } from '../../protocol/flow-templates.ts';
import { approvedColumn, workColumns } from '../../protocol/flowteam.ts';

export interface Backend {
  store: Store;
  /** The global admin role is written outside the hub (INDEX/ADMINS): each backend seeds it its own way. */
  seedAdmin(user: string): Promise<void>;
  close?(): Promise<void>;
}
/** Known divergences of a backend: test title -> why. The test still runs, as `todo` (reported, never failing the run). */
export type Quirks = Record<string, string>;

/** Methods of `Store`, read from its declaration (the count of the verdict). */
export function storeMethods(): string[] {
  const src = readFileSync(new URL('../src/router.ts', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export interface Store {'), src.indexOf('\n}\n', src.indexOf('export interface Store {')));
  return [...body.matchAll(/^ {2}(\w+)(?:<[^>]*>)?\(/gm)].map(m => m[1]);
}

const R = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`; // per-run prefix
let k = 0;
const uid = (what: string) => `${R}${what}${++k}`;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/** A message id sortable like the hub's (time-based, same length): the store sorts by it. */
const mid = (n: number) => `${R}m${String(n).padStart(6, '0')}`;

const thread = (id: string, space: string, x: Record<string, unknown> = {}): any => ({ id, space, title: `t ${id}`, owner: 'gaston', state: 'idle',
  updatedAt: 1000, version: 1, lastTurnAt: 0, facts: {}, ...x });
const msg = (thread: string, id: string, x: Record<string, unknown> = {}): any => ({ id, thread, author: { kind: 'human', id: 'blair' }, type: 'text',
  text: `text ${id}`, at: 1000, ...x });
/** Every optional field of Message the store writes (aws.ts lists them one by one, mvz7ppijf3e4d4847d41). */
const OPTIONAL: Record<string, unknown> = {
  ask: { id: 'q1', options: ['Yes', 'No'] }, propose: { title: 'Card', status: 'open', by: 'gaston' }, about: { text: 'about', base: '', by: 'gaston' },
  applet: { name: 'A', instruction: 'do', status: 'open' }, reminder: { text: 'r', at: 5, status: 'open' }, stop: { by: 'blair', acted: true },
  voiceAsk: true, secret: { name: 'S', kind: 'text', status: 'sent' }, preview: { label: 'dev', port: 3000 }, notice: true, relayCap: 6,
  plugin: { to: '0.3.1', agents: ['gaston'] }, edited: 1234, origin: { space: 'other', thread: 'x' }, gh: { kind: 'pr', title: 'PR' },
  newIssue: { title: 'Issue', status: 'open' }, plan: { title: 'Plan', steps: [] }, elevation: { account: 'a', status: 'open' },
  ci: { repo: 'o/r', sha: 'abc', verdict: 'pass' }, files: [{ id: 'f1', name: 'a.png', mime: 'image/png', size: 10 }],
};
const pub = (t: any) => ({ id: t.id, updatedAt: t.updatedAt });

export function storeContract(name: string, open: () => Promise<Backend>, quirks: Quirks = {}) {
  let b: Backend;
  const called = new Set<string>();
  let s: Store; // the backend's store, behind a proxy recording the methods the suite calls
  const titles = new Set<string>();
  const it = (title: string, fn: () => Promise<void>) => {
    titles.add(title);
    test(`${name} › ${title}`, quirks[title] ? { todo: quirks[title] } : {}, fn);
  };

  test(`${name} › open`, async () => {
    b = await open();
    s = new Proxy(b.store, { get: (o, p) => { if (typeof p === 'string') called.add(p); return (o as any)[p] } });
  });

  // ---------------------------------------------------------------- guards: thread version
  it('thread: creation only once, then the version guard', async () => {
    const sp = uid('s'), id = uid('t');
    assert.equal(await s.putThread(thread(id, sp), null), true);
    assert.equal(await s.putThread(thread(id, sp), null), false, 'second creation refused');
    assert.equal(await s.putThread(thread(id, sp, { version: 2 }), 7), false, 'wrong expected version');
    assert.equal(await s.putThread(thread(id, sp, { version: 2, title: 'two' }), 1), true);
    assert.equal(await s.putThread(thread(id, sp, { version: 3 }), 1), false, 'stale version');
    const got: any = await s.getThread(id);
    assert.equal(got.version, 2); assert.equal(got.title, 'two');
    assert.equal(await s.getThread(uid('missing')), null);
  });
  it('thread: concurrent writers on one version, exactly one wins', async () => {
    const sp = uid('s'), id = uid('t');
    await s.putThread(thread(id, sp), null);
    const r = await Promise.all(Array.from({ length: 8 }, (_, i) => s.putThread(thread(id, sp, { version: 2, title: `w${i}` }), 1)));
    assert.equal(r.filter(Boolean).length, 1);
    const won = r.indexOf(true);
    assert.equal((await s.getThread(id) as any).title, `w${won}`);
  });
  it('thread: concurrent creations, exactly one wins', async () => {
    const sp = uid('s'), id = uid('t');
    const r = await Promise.all(Array.from({ length: 6 }, (_, i) => s.putThread(thread(id, sp, { title: `c${i}` }), null)));
    assert.equal(r.filter(Boolean).length, 1);
  });
  it('thread: round trip of the stored record', async () => {
    const sp = uid('s'), id = uid('t');
    const t = thread(id, sp, { kind: 'topic', author: 'blair', text: 'first', people: ['blair'], tags: { tags: ['hub'], by: 'gaston', at: 3 },
      turns: { gaston: { at: 5 } }, flow: { agent: 'dev', ref: 'o/r#1', key: 'k', trigger: 'x', since: 1, turn: 0 }, mentionAt: 9, archived: { by: 'blair', at: 7 } });
    await s.putThread(t, null);
    assert.deepEqual(await s.getThread(id), t);
  });

  // ---------------------------------------------------------------- thread lists (index rows, GSI byActivity)
  it('pageThreads: every thread once, newest first, across pages, ties included', async () => {
    const sp = uid('s');
    const at = [5000, 4000, 4000, 4000, 3000, 2000, 2000, 1000]; // ties on updatedAt across page boundaries
    const ids = at.map(() => uid('t'));
    for (let i = 0; i < at.length; i++) await s.putThread(thread(ids[i], sp, { updatedAt: at[i] }), null);
    await s.putThread(thread(uid('t'), uid('other'), { updatedAt: 9999 }), null); // another space: never listed
    for (const limit of [1, 3, 8]) {
      const seen: any[] = [];
      let cur = null, pages = 0;
      do {
        const p = await s.pageThreads(sp, limit, cur);
        assert.ok(p.threads.length <= limit);
        seen.push(...p.threads); cur = p.next;
        assert.ok(++pages <= at.length + 2, 'pagination ends');
      } while (cur);
      assert.deepEqual(seen.map(t => t.id).sort(), [...ids].sort(), `limit ${limit}: each thread once`);
      for (let i = 1; i < seen.length; i++) assert.ok(seen[i - 1].updatedAt >= seen[i].updatedAt, `limit ${limit}: activity order`);
    }
    const first = await s.pageThreads(sp, 3, null);
    assert.deepEqual(first.threads.map(t => t.id)[0], ids[0]);
    assert.ok(first.next && first.next.updatedAt === first.threads[2].updatedAt && first.next.id === first.threads[2].id, 'cursor = last row of the page');
    assert.deepEqual(await s.pageThreads(uid('empty'), 3, null), { threads: [], next: null });
  });
  // The order among equal updatedAt is NOT part of the contract: a DynamoDB GSI gives none (seen: two runs, two orders).
  // What is: page by page with limit 1, every tied thread comes once and the cursor gets past the tie.
  it('pageThreads: a tie on updatedAt, paged one by one, yields each thread once', async () => {
    const sp = uid('s'), ids = [uid('a'), uid('b'), uid('c')];
    for (const id of ids) await s.putThread(thread(id, sp, { updatedAt: 7000 }), null);
    const seen: string[] = []; let cur = null;
    do { const p = await s.pageThreads(sp, 1, cur); seen.push(...p.threads.map(t => t.id)); cur = p.next } while (cur && seen.length < 10);
    assert.deepEqual(seen.sort(), [...ids].sort());
  });
  it('pageThreads: the index row follows the thread (public view, version)', async () => {
    const sp = uid('s'), id = uid('t');
    await s.putThread(thread(id, sp, { updatedAt: 10 }), null);
    await s.putThread(thread(id, sp, { updatedAt: 20, version: 2, title: 'renamed', state: 'you', facts: { unseenReply: 2 } }), 1);
    const [row]: any[] = (await s.pageThreads(sp, 5, null)).threads;
    assert.equal(row.title, 'renamed'); assert.equal(row.version, 2); assert.equal(row.updatedAt, 20); assert.equal(row.state, 'you');
    assert.equal(row.facts, undefined, 'public view: no facts'); assert.equal(row.unseen, 2, 'public view: unseen from the facts');
    assert.equal(row.lastTurnAt, undefined, 'public view: no hub-only field');
  });
  it('thread lists: a memory review conversation is never listed nor searched', async () => {
    const sp = uid('s'), id = uid('t');
    await s.putThread(thread(id, sp, { memoryReview: true, state: 'run', updatedAt: 5000 }), null);
    assert.deepEqual((await s.pageThreads(sp, 5, null)).threads, []);
    assert.deepEqual(await s.activeThreads(sp), []);
    assert.deepEqual(await s.threadsByIds(sp, [id]), []);
    assert.deepEqual(await s.listThreads(sp, 0), []);
    assert.equal((await s.searchCorpus([sp])).threads.length, 0);
    assert.ok(await s.getThread(id), 'still readable by id');
  });
  it('activeThreads: Your turn and In progress, archived excluded', async () => {
    const sp = uid('s');
    const you = uid('t'), run = uid('t'), idle = uid('t'), arch = uid('t');
    await s.putThread(thread(you, sp, { state: 'you' }), null);
    await s.putThread(thread(run, sp, { state: 'run' }), null);
    await s.putThread(thread(idle, sp, { state: 'idle' }), null);
    await s.putThread(thread(arch, sp, { state: 'you', archived: { by: 'blair', at: 1 } }), null);
    assert.deepEqual((await s.activeThreads(sp)).map(t => t.id).sort(), [you, run].sort());
  });
  it('threadsByIds: this space only, missing skipped, duplicates once', async () => {
    const sp = uid('s'), a = uid('t'), other = uid('t');
    await s.putThread(thread(a, sp), null);
    await s.putThread(thread(other, uid('s')), null);
    assert.deepEqual((await s.threadsByIds(sp, [a, a, other, uid('missing')])).map(t => t.id), [a]);
    assert.deepEqual(await s.threadsByIds(sp, []), []);
  });
  it('listThreads: since filter, the metrics fields', async () => {
    const sp = uid('s'), old = uid('t'), recent = uid('t');
    await s.putThread(thread(old, sp, { updatedAt: 100 }), null);
    await s.putThread(thread(recent, sp, { updatedAt: 500, kind: 'topic', from: 'x', author: 'blair', outcome: { kind: 'done', at: 1 },
      usage: { usd: 1 }, tags: { tags: ['hub'] }, heading: { text: 'h', by: { kind: 'agent', id: 'g' }, at: 1 }, archived: { by: 'b', at: 2 } }), null);
    const rows: any[] = await s.listThreads(sp, 500);
    assert.deepEqual(rows.map(t => t.id), [recent]);
    for (const f of ['id', 'space', 'kind', 'from', 'title', 'author', 'owner', 'state', 'archived', 'usage', 'updatedAt', 'version', 'tags', 'heading'])
      assert.ok(rows[0][f] !== undefined, `field ${f}`);
    assert.equal((await s.listThreads(sp, 0)).length, 2);
  });

  // ---------------------------------------------------------------- guards: message rev
  it('message: creation, rewrite keeps its time, older rev refused', async () => {
    const th = uid('t'), id = mid(1);
    const c = await s.upsertMessage(msg(th, id, { text: 'v1', rev: 1, at: 1000 }));
    assert.equal(c?.created, true); assert.equal(c?.message.text, 'v1');
    const u = await s.upsertMessage(msg(th, id, { text: 'v2', rev: 2, at: 2000 }));
    assert.equal(u?.created, false); assert.equal(u?.message.text, 'v2'); assert.equal(u?.message.at, 1000, 'original time kept');
    assert.equal(await s.upsertMessage(msg(th, id, { text: 'old', rev: 1, at: 3000 })), null, 'older rev');
    assert.equal(await s.upsertMessage(msg(th, id, { text: 'same', rev: 2, at: 3000 })), null, 'same rev');
    assert.equal((await s.getMessage(th, id))?.text, 'v2');
  });
  it('message: rev 0 (no rev) always rewrites (streaming)', async () => {
    const th = uid('t'), id = mid(1);
    await s.upsertMessage(msg(th, id, { text: 'a', at: 1000 }));
    assert.equal((await s.upsertMessage(msg(th, id, { text: 'ab', at: 1001 })))?.message.text, 'ab');
    assert.equal((await s.upsertMessage(msg(th, id, { text: 'abc', at: 1002 })))?.message.text, 'abc');
  });
  it('message: concurrent edits out of order, the highest rev stays', async () => {
    const th = uid('t'), id = mid(1);
    await s.upsertMessage(msg(th, id, { text: 'r1', rev: 1 }));
    const revs = [5, 3, 9, 2, 8, 4, 7, 6];
    await Promise.all(revs.map(r => s.upsertMessage(msg(th, id, { text: `r${r}`, rev: r, at: 2000 + r }))));
    const m = await s.getMessage(th, id);
    assert.equal(m?.text, 'r9'); assert.equal(m?.rev, 9);
  });
  it('message: a rewrite at the creation time is not reported as created', async () => {
    const th = uid('t'), id = mid(1);
    await s.upsertMessage(msg(th, id, { text: 'a', rev: 1, at: 1000 }));
    assert.equal((await s.upsertMessage(msg(th, id, { text: 'b', rev: 2, at: 1000 })))?.created, false);
  });
  it('message: every optional field survives a write and a read', async () => {
    const th = uid('t'), id = mid(1);
    const full = msg(th, id, { rev: 1, ...OPTIONAL });
    const w = await s.upsertMessage(full);
    const read = [w!.message, await s.getMessage(th, id), (await s.lastMessages(th, 5))[0]];
    for (const [i, m] of read.entries()) for (const f of Object.keys(OPTIONAL))
      assert.deepEqual((m as any)?.[f], OPTIONAL[f], `field ${f} (${['upsert', 'getMessage', 'lastMessages'][i]})`);
  });
  it('message: a rewrite replaces the fields it carries, keeps the files it omits', async () => {
    const th = uid('t'), id = mid(1);
    await s.upsertMessage(msg(th, id, { rev: 1, files: OPTIONAL.files, ask: OPTIONAL.ask, stop: { acted: false } }));
    await s.upsertMessage(msg(th, id, { rev: 2, text: 'edited', edited: 9, stop: { by: 'x', acted: true } }));
    let m: any = await s.getMessage(th, id);
    assert.deepEqual(m.files, OPTIONAL.files, 'files kept'); assert.equal(m.edited, 9); assert.deepEqual(m.stop, { by: 'x', acted: true });
    assert.ok(!m.ask, 'ask written again (absent = none)');
    const files = [{ id: 'f2', name: 'b.pdf', mime: 'application/pdf', size: 3 }];
    await s.upsertMessage(msg(th, id, { rev: 3, files }));
    m = await s.getMessage(th, id);
    assert.deepEqual(m.files, files, 'new files replace');
  });
  it('lastMessages: the n latest, oldest first; before = the n just older', async () => {
    const th = uid('t');
    for (let i = 1; i <= 7; i++) await s.upsertMessage(msg(th, mid(i), { at: 1000 + i }));
    await s.upsertMessage(msg(uid('t'), mid(99))); // another thread
    assert.deepEqual((await s.lastMessages(th, 3)).map(m => m.id), [mid(5), mid(6), mid(7)]);
    assert.deepEqual((await s.lastMessages(th, 3, mid(5))).map(m => m.id), [mid(2), mid(3), mid(4)]);
    assert.deepEqual((await s.lastMessages(th, 3, mid(2))).map(m => m.id), [mid(1)]);
    assert.deepEqual(await s.lastMessages(th, 3, mid(1)), []);
    assert.deepEqual(await s.lastMessages(uid('empty'), 3), []);
  });
  it('lastMessages: sorted by message id, whatever the write order', async () => {
    const th = uid('t');
    for (const i of [3, 1, 2]) await s.upsertMessage(msg(th, mid(i)));
    assert.deepEqual((await s.lastMessages(th, 5)).map(m => m.id), [mid(1), mid(2), mid(3)]);
  });
  it('lastMessages: before an unknown id = the messages with a smaller id', async () => {
    const th = uid('t');
    for (const i of [1, 2, 4]) await s.upsertMessage(msg(th, mid(i)));
    assert.deepEqual((await s.lastMessages(th, 5, mid(3))).map(m => m.id), [mid(1), mid(2)]);
  });
  it('message: subtopic set once, delete, erase under the rev guard', async () => {
    const th = uid('t');
    await s.upsertMessage(msg(th, mid(1)));
    assert.equal(await s.setSubtopic(th, mid(1), 'top1'), true);
    assert.equal(await s.setSubtopic(th, mid(1), 'top2'), false);
    assert.equal(await s.setSubtopic(th, mid(9), 'top3'), false, 'missing message');
    assert.equal((await s.getMessage(th, mid(1)))?.subtopic, 'top1');
    await s.upsertMessage(msg(th, mid(2), { rev: 3, files: OPTIONAL.files, edited: 4 }));
    assert.equal(await s.eraseMessage(th, mid(2), 3, { at: 9, by: 'blair' }), null, 'rev must be stored + 1');
    const e: any = await s.eraseMessage(th, mid(2), 4, { at: 9, by: 'blair' });
    assert.equal(e.text, ''); assert.equal(e.rev, 4); assert.deepEqual(e.deleted, { at: 9, by: 'blair' });
    assert.equal(e.files, undefined); assert.equal(e.edited, undefined); assert.equal(e.id, mid(2));
    assert.equal(await s.eraseMessage(th, mid(2), 4, { at: 9, by: 'blair' }), null, 'twice');
    await s.upsertMessage(msg(th, mid(3)));
    assert.ok(await s.eraseMessage(th, mid(3), 1, { at: 9, by: 'blair' }), 'no rev yet = rev 0');
    assert.equal(await s.eraseMessage(th, mid(8), 1, { at: 9, by: 'blair' }), null, 'missing');
    await s.deleteMessage(th, mid(1));
    await s.deleteMessage(th, mid(1)); // already gone: no-op
    assert.equal(await s.getMessage(th, mid(1)), null);
  });
  it('reads are copies: mutating a result never changes the store', async () => {
    const th = uid('t');
    await s.upsertMessage(msg(th, mid(1), { text: 'kept' }));
    (await s.getMessage(th, mid(1)) as any).text = 'mutated';
    assert.equal((await s.getMessage(th, mid(1)))?.text, 'kept');
    await s.putSummary({ thread: th, at: 1, status: 'kept', decisions: [], next_steps: [], waiting_on: null });
    (await s.getSummary(th) as any).status = 'mutated';
    assert.equal((await s.getSummary(th))?.status, 'kept');
  });

  // ---------------------------------------------------------------- guards: agent hand, shared resources
  it('lock: creation once, version guard, concurrent takers, listed per space', async () => {
    const sp = uid('s');
    const lock = (v: number, holders: string[]): any => ({ space: sp, agent: 'gaston', holders, queue: [], since: 1, version: v, by: {}, delivered: {} });
    assert.equal(await s.getLock(sp, 'gaston'), null);
    assert.equal(await s.putLock(lock(1, ['a']), null), true);
    assert.equal(await s.putLock(lock(1, ['b']), null), false);
    const r = await Promise.all(['x', 'y', 'z', 'w'].map(h => s.putLock(lock(2, [h]), 1)));
    assert.equal(r.filter(Boolean).length, 1);
    const got: any = await s.getLock(sp, 'gaston');
    assert.equal(got.version, 2); assert.deepEqual(got.holders, [['x', 'y', 'z', 'w'][r.indexOf(true)]]);
    await s.putLock({ ...lock(1, []), agent: 'mary', talk: { t1: { at: 1 } } }, null);
    assert.deepEqual((await s.listLocks(sp)).map(l => l.agent).sort(), ['gaston', 'mary']);
    assert.deepEqual((await s.getLock(sp, 'mary') as any).talk, { t1: { at: 1 } });
    assert.deepEqual(await s.listLocks(uid('s')), []);
  });
  it('resource: creation once, version guard, concurrent acquirers, listed per space', async () => {
    const sp = uid('s');
    const res = (v: number, holder: string | null): any => ({ space: sp, resource: 'stack:dev', holder, agent: holder ? 'gaston' : null, queue: [], since: 1, version: v, by: {} });
    assert.equal(await s.getResource(sp, 'stack:dev'), null);
    assert.equal(await s.putResource(res(1, null), null), true);
    assert.equal(await s.putResource(res(1, 'x'), null), false);
    const r = await Promise.all(['t1', 't2', 't3'].map(h => s.putResource(res(2, h), 1)));
    assert.equal(r.filter(Boolean).length, 1);
    assert.equal((await s.getResource(sp, 'stack:dev'))?.holder, ['t1', 't2', 't3'][r.indexOf(true)]);
    assert.equal(await s.putResource(res(3, null), 1), false, 'stale');
    await s.putResource({ ...res(1, null), resource: 'emulator' }, null);
    assert.deepEqual((await s.listResources(sp)).map(x => x.resource).sort(), ['emulator', 'stack:dev']);
  });

  // ---------------------------------------------------------------- guards: atomic counters and claims
  it('countAgentTopic: at most cap, even concurrently; per agent and day', async () => {
    const sp = uid('s');
    const r = await Promise.all(Array.from({ length: 10 }, () => s.countAgentTopic(sp, 'gaston', '2026-11-16', 3)));
    assert.equal(r.filter(Boolean).length, 3);
    assert.equal(await s.countAgentTopic(sp, 'gaston', '2026-11-17', 3), true, 'another day');
    assert.equal(await s.countAgentTopic(sp, 'mary', '2026-11-16', 3), true, 'another agent');
  });
  it('addMemoryPending: atomic, concurrent adds all counted; set repairs it', async () => {
    const sp = uid('s');
    await s.createSpace({ id: sp, members: [], trusted: [], defaultAgent: 'gaston' });
    await Promise.all(Array.from({ length: 12 }, (_, i) => s.addMemoryPending(sp, 1, i % 3 === 0)));
    const r = await s.addMemoryPending(sp, -2, false);
    assert.deepEqual(r, { pending: 10, arrivals: 4 });
    await s.setMemoryPending(sp, 3);
    const sp2: any = await s.getSpace(sp);
    assert.equal(sp2.memPending, 3); assert.equal(sp2.memArrivals, 4);
    await assert.rejects(s.addMemoryPending(uid('missing'), 1, true), 'missing space');
  });
  it('claimFlowWake: one claim per window, even concurrently', async () => {
    const sp = uid('s');
    const r = await Promise.all(Array.from({ length: 5 }, () => s.claimFlowWake(sp, 10_000, 1000)));
    assert.equal(r.filter(Boolean).length, 1);
    assert.equal(await s.claimFlowWake(sp, 10_500, 1000), false, 'inside the window');
    assert.equal(await s.claimFlowWake(sp, 11_000, 1000), true, 'window over');
  });
  it('claimIssueThread: the first writer wins, the others read its thread', async () => {
    const sp = uid('s');
    const r = await Promise.all(['ta', 'tb', 'tc'].map(t => s.claimIssueThread(sp, 'o/r#1', t)));
    assert.equal(new Set(r).size, 1);
    assert.equal(await s.claimIssueThread(sp, 'o/r#1', 'td'), r[0]);
    await s.claimIssueThread(sp, 'o/r#2', 'te');
    assert.deepEqual(await s.issueThreads(sp), { 'o/r#1': r[0], 'o/r#2': 'te' });
  });
  it('agent invite: claimed once, never expired, concurrent joins', async () => {
    const hash = uid('h');
    const inv: any = { hash, id: uid('i'), space: 'sp', agent: 'gaston', by: 'blair', at: 1, expiresAt: 5000, state: 'pending' };
    await s.putAgentInvite(inv);
    assert.deepEqual(await s.getAgentInvite(hash), inv);
    assert.ok((await s.listAgentInvites()).some(i => i.hash === hash));
    assert.equal(await s.claimAgentInvite(hash, 5000), false, 'expired at expiresAt');
    const r = await Promise.all(Array.from({ length: 5 }, () => s.claimAgentInvite(hash, 4000)));
    assert.equal(r.filter(Boolean).length, 1);
    const used: any = await s.getAgentInvite(hash);
    assert.equal(used.state, 'used'); assert.equal(used.usedAt, 4000);
    assert.equal(await s.setAgentInvite(hash, 'pending', { state: 'revoked' }), false, 'not pending any more');
    assert.equal(await s.setAgentInvite(hash, 'used', { instance: 'inst1' }), true);
    assert.equal((await s.getAgentInvite(hash))?.instance, 'inst1');
    assert.equal(await s.setAgentInvite(hash, 'used', { state: 'pending' }), true, 'undone join');
    const back: any = await s.getAgentInvite(hash);
    assert.equal(back.state, 'pending'); assert.equal(back.usedAt, undefined); assert.equal(back.instance, undefined);
    assert.equal(await s.setAgentInvite(uid('h'), 'pending', { state: 'revoked' }), false, 'missing');
    assert.equal(await s.claimAgentInvite(uid('h'), 1), false, 'missing');
    assert.equal(await s.getAgentInvite(uid('h')), null);
  });
  it('agent invite: a second invite on the same hash is refused', async () => {
    const hash = uid('h');
    const inv: any = { hash, id: 'a', space: 'sp', agent: 'gaston', by: 'blair', at: 1, expiresAt: 5000, state: 'pending' };
    await s.putAgentInvite(inv);
    await assert.rejects(s.putAgentInvite({ ...inv, id: 'b' }));
    assert.equal((await s.getAgentInvite(hash))?.id, 'a');
  });
  it('flow pilot: a pending link, redeemed once, never over a piloted agent', async () => {
    const sp = uid('s');
    const pending: any = { agent: 'dev', state: 'pending', by: 'blair', at: 1, expiresAt: 100, hash: 'h1' };
    assert.equal(await s.putFlowPilot(sp, pending), true);
    assert.equal(await s.putFlowPilot(sp, { ...pending, hash: 'h2' }), true, 'a new link replaces a pending one');
    const piloted: any = { agent: 'dev', state: 'piloted', by: 'blair', at: 2, since: 2, hash: 'h2' };
    assert.equal(await s.claimFlowPilot(sp, 'dev', 'h1', 50, piloted), false, 'old code');
    assert.equal(await s.claimFlowPilot(sp, 'dev', 'h2', 100, piloted), false, 'expired');
    const r = await Promise.all([1, 2, 3].map(() => s.claimFlowPilot(sp, 'dev', 'h2', 50, piloted)));
    assert.equal(r.filter(Boolean).length, 1);
    assert.equal(await s.putFlowPilot(sp, { ...pending, hash: 'h3' }), false, 'piloted');
    assert.deepEqual(await s.listFlowPilots(sp), [piloted]);
    await s.deleteFlowPilot(sp, 'dev');
    assert.deepEqual(await s.listFlowPilots(sp), []);
    assert.equal(await s.claimFlowPilot(sp, 'dev', 'h2', 50, piloted), false, 'missing');
  });

  // ---------------------------------------------------------------- guards: `at` monotonic writes
  it('summary, pin, mute, seen mark, reaction: only a later `at` writes', async () => {
    const sp = uid('s'), th = uid('t'), u = uid('u');
    const sum = (at: number, status: string) => ({ thread: th, at, status, decisions: ['d'], next_steps: [{ who: 'b', what: 'w' }], waiting_on: null });
    assert.equal(await s.getSummary(th), null);
    assert.equal(await s.putSummary(sum(10, 'a')), true);
    assert.equal(await s.putSummary(sum(10, 'b')), false);
    assert.equal(await s.putSummary(sum(5, 'c')), false);
    assert.equal(await s.putSummary(sum(11, 'd')), true);
    assert.deepEqual(await s.getSummary(th), sum(11, 'd'));
    assert.equal(await s.putPin(u, { thread: th, space: sp, on: true, at: 10 }), true);
    assert.equal(await s.putPin(u, { thread: th, space: sp, on: false, at: 10 }), false);
    await s.putPin(u, { thread: uid('t'), space: uid('s'), on: true, at: 1 });
    assert.deepEqual(await s.listPins(u, sp), [{ thread: th, space: sp, on: true, at: 10 }]);
    assert.equal(await s.putMute(u, { space: sp, on: true, at: 10 }), true);
    assert.equal(await s.putMute(u, { space: sp, on: false, at: 9 }), false);
    await s.putMute('other', { space: sp, on: false, at: 1 });
    assert.deepEqual(await s.mutedIn(sp), [u]);
    assert.deepEqual(await s.mutesOf(u, [sp, sp, uid('s')]), [{ space: sp, on: true, at: 10 }]);
    assert.equal(await s.putSeen(u, sp, { thread: th, at: 10 }), true);
    assert.equal(await s.putSeen(u, sp, { thread: th, at: 10 }), false);
    assert.deepEqual(await s.seenMarks(u, sp, [th, th, uid('t')]), [{ thread: th, at: 10 }]);
    const re = (at: number, on: boolean) => ({ thread: th, msg: 'm1', emoji: '👍', user: u, on, at, hubAt: at + 1 });
    assert.equal(await s.putReaction(re(10, true)), true);
    assert.equal(await s.putReaction(re(10, false)), false);
    assert.equal(await s.putReaction(re(11, false)), true);
    assert.deepEqual(await s.listReactions(th), [re(11, false)]);
  });
  it('concurrent `at` writes: the latest stays', async () => {
    const th = uid('t');
    const ats = [4, 9, 2, 7, 5];
    await Promise.all(ats.map(at => s.putSummary({ thread: th, at, status: `s${at}`, decisions: [], next_steps: [], waiting_on: null })));
    assert.equal((await s.getSummary(th))?.status, 's9');
  });
  it('markSeen / lastSeen: only moved forward', async () => {
    const sp = uid('s');
    await s.markSeen(sp, ['a', 'b'], 10);
    await s.markSeen(sp, ['a'], 5);
    await s.markSeen(sp, ['b'], 20);
    assert.deepEqual(await s.lastSeen(sp), { a: 10, b: 20 });
  });

  // ---------------------------------------------------------------- spaces, instances
  it('space: created once, listed, settings under the version guard, github kept', async () => {
    const id = uid('s');
    const sp: any = { id, members: ['blair'], trusted: ['blair'], defaultAgent: 'gaston', agents: ['gaston'], names: { blair: 'Blair' }, name: 'S', version: 0 };
    assert.equal(await s.createSpace(sp), true);
    assert.equal(await s.createSpace(sp), false);
    assert.ok((await s.listSpaces()).some(x => x.id === id));
    assert.equal(await s.getSpace(uid('missing')), null);
    const next = { ...sp, name: 'S2', about: 'about', members: ['blair', 'joachim'], version: 1, archived: { by: 'blair', at: 1 }, ci: true, repos: ['o/r'], admins: ['joachim'] };
    assert.equal(await s.updateSpace(next, 0), true, 'no version yet = 0');
    assert.equal(await s.updateSpace({ ...next, version: 2 }, 0), false, 'stale');
    const got: any = await s.getSpace(id);
    assert.equal(got.name, 'S2'); assert.equal(got.version, 1); assert.deepEqual(got.archived, { by: 'blair', at: 1 }); assert.equal(got.ci, true);
    assert.deepEqual(got.repos, ['o/r']); assert.deepEqual(got.members, ['blair', 'joachim']); assert.deepEqual(got.admins, ['joachim']);
    assert.equal(await s.updateSpace({ ...next, archived: undefined, version: 2 }, 1), true);
    assert.equal((await s.getSpace(id) as any).archived, undefined, 'unarchived');
    assert.equal(await s.updateSpace({ ...sp, id: uid('missing') }, 0), false, 'missing space');
    const r = await Promise.all([1, 2, 3].map(i => s.updateSpace({ ...next, name: `c${i}`, version: 3 }, 2)));
    assert.equal(r.filter(Boolean).length, 1);
  });
  it('space: the github snapshot is per space', async () => {
    const a = uid('s'), bb = uid('s');
    const snap: any = { space: a, at: 1, project: { title: 'P', url: 'u' }, items: [] };
    await s.putGithub(snap);
    assert.deepEqual(await s.getGithub(a), snap);
    assert.equal(await s.getGithub(bb), null);
  });
  it('space: profile of a member only, role and avatar removable', async () => {
    const id = uid('s');
    await s.createSpace({ id, members: ['blair'], trusted: [], defaultAgent: 'gaston' });
    assert.equal(await s.setProfile(id, 'blair', 'B', 'Boss', 'data:a'), true);
    let sp: any = await s.getSpace(id);
    assert.equal(sp.names.blair, 'B'); assert.equal(sp.roles.blair, 'Boss'); assert.equal(sp.avatars.blair, 'data:a');
    assert.equal(await s.setProfile(id, 'blair', 'B2', '', undefined), true);
    sp = await s.getSpace(id);
    assert.equal(sp.names.blair, 'B2'); assert.equal(sp.roles.blair, undefined); assert.equal(sp.avatars.blair, 'data:a', 'avatar unchanged');
    await s.setProfile(id, 'blair', 'B2', '', '');
    assert.equal((await s.getSpace(id) as any).avatars.blair, undefined);
    assert.equal(await s.setProfile(id, 'mallory', 'M', '', undefined), false);
  });
  it('isAdmin: written outside the hub', async () => {
    const u = uid('admin');
    assert.equal(await s.isAdmin(u), false);
    await b.seedAdmin(u);
    assert.equal(await s.isAdmin(u), true);
  });
  it('instance: created once, bound, connected once, plugin by `at`, deleted', async () => {
    const id = uid('i');
    assert.equal(await s.createInstance({ id, spaces: [], agents: ['gaston'] }), true);
    assert.equal(await s.createInstance({ id, spaces: [], agents: ['x'] }), false);
    assert.ok((await s.listInstances()).some(i => i.id === id));
    await Promise.all(['a', 'b', 'c'].map(sp => s.bindInstance(id, sp, true)));
    assert.deepEqual([...(await s.getInstance(id))!.spaces].sort(), ['a', 'b', 'c'], 'concurrent binds all land');
    await s.bindInstance(id, 'a', true); // idempotent
    await s.bindInstance(id, 'b', false);
    assert.deepEqual([...(await s.getInstance(id))!.spaces].sort(), ['a', 'c']);
    await s.markInstanceConnected(id, 10);
    await s.markInstanceConnected(id, 20);
    assert.equal((await s.getInstance(id))?.connectedAt, 10);
    await s.setInstancePlugin(id, { version: '0.3.1', at: 10 });
    await s.setInstancePlugin(id, { version: '0.3.0', at: 10 });
    await s.setInstancePlugin(id, { version: '0.2.0', at: 5 });
    assert.deepEqual((await s.getInstance(id))?.plugin, { version: '0.3.1', at: 10 });
    await s.setInstancePlugin(id, { version: '0.3.2', at: 11, voice: true, cacheTtl: '5m' as any });
    assert.deepEqual((await s.getInstance(id))?.plugin, { version: '0.3.2', at: 11, voice: true, cacheTtl: '5m' });
    // an ACP bridge keeps its kind on reread: without it the hub compares it to the plugin's release (banner « pas à
    // jour », plugin release frame sent to bridges)
    await s.setInstancePlugin(id, { version: '0.3.42', at: 12, kind: 'acp' });
    assert.deepEqual((await s.getInstance(id))?.plugin, { version: '0.3.42', at: 12, kind: 'acp' });
    assert.equal((await s.listInstances()).find(i => i.id === id)?.plugin?.kind, 'acp');
    await s.deleteInstance(id);
    assert.equal(await s.getInstance(id), null);
    assert.ok(!(await s.listInstances()).some(i => i.id === id));
    const ghost = uid('i');
    await s.bindInstance(ghost, 'a', true);
    await s.markInstanceConnected(ghost, 1);
    await s.setInstancePlugin(ghost, { version: '1', at: 1 });
    assert.equal(await s.getInstance(ghost), null, 'never recreated');
  });

  // ---------------------------------------------------------------- connections
  it('subscriptions: one per connection, away and watch only on a live one', async () => {
    const sp = uid('s'), c1 = uid('c'), c2 = uid('c');
    await s.putSub(sp, { connId: c1, kind: 'human', principal: 'blair' });
    await s.putSub(sp, { connId: c2, kind: 'instance', principal: 'mini' });
    await s.putSub(sp, { connId: c1, kind: 'human', principal: 'blair' }); // re-subscribe
    assert.equal((await s.listSubs(sp)).length, 2, 'one row per connection');
    assert.equal(await s.setSubAway(sp, c1, true, 42), true);
    assert.equal(await s.setSubWatch(sp, c1, 'th1'), true);
    let me = (await s.listSubs(sp)).find(x => x.connId === c1);
    assert.deepEqual(me, { connId: c1, kind: 'human', principal: 'blair', away: true, idle: 42, watch: 'th1' });
    assert.equal(await s.setSubAway(sp, c1, false), true);
    assert.equal(await s.setSubWatch(sp, c1, null), true);
    me = (await s.listSubs(sp)).find(x => x.connId === c1);
    assert.deepEqual(me, { connId: c1, kind: 'human', principal: 'blair' });
    await s.deleteSub(sp, c1);
    assert.equal(await s.setSubAway(sp, c1, true), false, 'dropped');
    assert.equal(await s.setSubWatch(sp, c1, 'x'), false, 'dropped');
    assert.deepEqual((await s.listSubs(sp)).map(x => x.connId), [c2], 'never recreated');
  });
  it('subscriptions: a re-subscribe starts active', async () => {
    const sp = uid('s'), c = uid('c');
    await s.putSub(sp, { connId: c, kind: 'human', principal: 'blair' });
    await s.setSubAway(sp, c, true, 1);
    await s.putSub(sp, { connId: c, kind: 'human', principal: 'blair' });
    assert.deepEqual(await s.listSubs(sp), [{ connId: c, kind: 'human', principal: 'blair' }]);
  });
  it('connSpaces and instance connections', async () => {
    const c = uid('c'), a = uid('s'), bb = uid('s'), inst = uid('i');
    await s.putSub(a, { connId: c, kind: 'human', principal: 'blair' });
    await s.putSub(bb, { connId: c, kind: 'human', principal: 'blair' });
    assert.deepEqual((await s.connSpaces(c)).sort(), [a, bb].sort());
    assert.deepEqual(await s.connSpaces(uid('c')), []);
    await s.putInstanceConn(inst, 'k1');
    await s.putInstanceConn(inst, 'k2');
    await s.putInstanceConn(inst, 'k1');
    assert.deepEqual((await s.listInstanceConns(inst)).sort(), ['k1', 'k2']);
  });

  // ---------------------------------------------------------------- search, metrics, details
  it('searchCorpus: threads and messages of the space', async () => {
    const sp = uid('s'), th = uid('t');
    await s.putThread(thread(th, sp, { title: 'needle', kind: 'topic', updatedAt: 77 }), null);
    await s.upsertMessage(msg(th, mid(1), { text: 'hay needle', files: OPTIONAL.files, at: 5 }));
    const r = await s.searchCorpus([sp]);
    assert.deepEqual(r.threads.filter(t => t.id === th), [{ id: th, space: sp, title: 'needle', kind: 'topic', updatedAt: 77 }]);
    const m = r.messages.find(x => x.id === mid(1) && x.thread === th);
    assert.deepEqual(m, { id: mid(1), thread: th, author: { kind: 'human', id: 'blair' }, type: 'text', text: 'hay needle', files: OPTIONAL.files, at: 5 });
    const many = await s.searchCorpus([sp, uid('s')]);
    assert.ok(many.threads.some(t => t.id === th) && many.messages.some(x => x.id === mid(1) && x.thread === th), 'several spaces: at least those');
  });
  it('threadActivity: opener, authors, opened and open cards', async () => {
    const sp = uid('s'), th = uid('t');
    await s.putThread(thread(th, sp, { opener: 'blair' }), null);
    await s.upsertMessage(msg(th, mid(1), { at: 1 }));
    await s.upsertMessage(msg(th, mid(2), { author: { kind: 'agent', id: 'gaston' }, at: 2, propose: { title: 'T', status: 'done', thread: 'new' } }));
    await s.upsertMessage(msg(th, mid(3), { author: { kind: 'agent', id: 'gaston' }, at: 3, propose: { title: 'Open', status: 'open', by: 'gaston' } }));
    await s.putReaction({ thread: th, msg: mid(1), emoji: '👍', user: 'u', on: true, at: 1, hubAt: 1 });
    assert.deepEqual(await s.threadActivity(th), { opener: 'blair', messages: [
      { id: mid(1), kind: 'human', author: 'blair', at: 1 },
      { id: mid(2), kind: 'agent', author: 'gaston', at: 2, card: 'new' },
      { id: mid(3), kind: 'agent', author: 'gaston', at: 3, proposed: { title: 'Open', by: 'gaston' } }] });
  });
  it('threadDetails: first message, files, events by time', async () => {
    const th = uid('t');
    await s.upsertMessage(msg(th, mid(1), { at: 50, files: OPTIONAL.files }));
    await s.upsertMessage(msg(th, mid(2), { at: 40, author: { kind: 'agent', id: 'gaston' } }));
    const ev = (at: number) => ({ kind: 'turn', at, by: 'blair' }) as any;
    await s.putEvent(th, 'e2', ev(30));
    await s.putEvent(th, 'e1', ev(10));
    await s.putEvent(th, 'e3', ev(20));
    const d = await s.threadDetails(th);
    assert.equal(d.first, 40);
    assert.deepEqual(d.files, [{ ...(OPTIONAL.files as any)[0], msg: mid(1), by: 'blair', at: 50 }]);
    assert.deepEqual(d.events.map(e => e.at), [10, 20, 30]);
    assert.deepEqual(await s.threadDetails(uid('t')), { first: null, files: [], events: [] });
  });

  // ---------------------------------------------------------------- attachments, push, preview, visitors, watches
  it('attachments: one message each, duplicates read once', async () => {
    const a = uid('a');
    const att: any = { id: a, name: 'x.png', mime: 'image/png', size: 3, space: 'sp', by: 'blair', at: 1 };
    await s.putAttachment(att);
    assert.deepEqual(await s.getAttachments([a, a, uid('a')]), [att]);
    assert.deepEqual(await s.getAttachments([]), []);
    assert.equal(await s.claimAttachment(a, 'm1'), true);
    assert.equal(await s.claimAttachment(a, 'm1'), true, 'same message again');
    assert.equal(await s.claimAttachment(a, 'm2'), false);
    assert.equal(await s.claimAttachment(uid('a'), 'm1'), false, 'missing');
    assert.equal((await s.getAttachments([a]))[0].msg, 'm1');
  });
  it('push devices: same id overwrites, delete', async () => {
    const u = uid('u');
    const dev = (id: string, at: number): any => ({ id, endpoint: `https://push/${id}`, keys: { p256dh: 'p', auth: 'a' }, lang: 'fr', at });
    await s.putPush(u, dev('d1', 1));
    await s.putPush(u, dev('d1', 2));
    await s.putPush(u, dev('d2', 3));
    assert.deepEqual((await s.listPushes(u)).sort((x, y) => x.at - y.at), [dev('d1', 2), dev('d2', 3)]);
    await s.deletePush(u, 'd1');
    assert.deepEqual(await s.listPushes(u), [dev('d2', 3)]);
  });
  it('previews and visitor links', async () => {
    const sess = uid('p');
    const p: any = { session: sess, space: 'sp', thread: 't', msg: 'm', agent: 'g', port: 3000, by: 'blair', viewer: 'c1', target: 'c2', agentIce: [{ urls: ['turn:x'] }], at: Date.now() };
    await s.putPreview(p);
    assert.deepEqual(await s.getPreview(sess), p);
    await s.deletePreview(sess);
    assert.equal(await s.getPreview(sess), null);
    const m = uid('m');
    const v: any = { msg: m, space: 'sp', thread: 't', agent: 'g', hash: 'h', until: Date.now() + 1000, by: 'blair', at: 1, session: 's' };
    await s.putVisitor(v);
    assert.deepEqual(await s.getVisitor(m), v);
    await s.deleteVisitor(m);
    assert.equal(await s.getVisitor(m), null);
  });
  it('CI watches: one per thread and repo, deleted only on its sha', async () => {
    const th = uid('t'), now = Date.now();
    const w = (sha: string): any => ({ thread: th, space: 'sp', repo: 'o/r', sha, by: 'g', since: 1, deadline: now + 1000 });
    await s.putCiWatch(w('a'));
    await s.putCiWatch(w('b'));
    assert.deepEqual((await s.listCiWatches()).filter(x => x.thread === th), [w('b')]);
    assert.equal(await s.deleteCiWatch(th, 'o/r', 'a'), false, 'superseded');
    assert.equal(await s.deleteCiWatch(th, 'o/r', 'b'), true);
    assert.equal(await s.deleteCiWatch(th, 'o/r', 'b'), false, 'already ended');
    assert.deepEqual((await s.listCiWatches()).filter(x => x.thread === th), []);
  });
  it('background deadlines: renewed, deleted on its deadline or unconditionally', async () => {
    const th = uid('t'), now = Date.now();
    await s.putBgWatch({ thread: th, space: 'sp', deadline: now + 1 });
    await s.putBgWatch({ thread: th, space: 'sp', deadline: now + 2 });
    assert.deepEqual((await s.listBgWatches()).filter(x => x.thread === th), [{ thread: th, space: 'sp', deadline: now + 2 }]);
    assert.equal(await s.deleteBgWatch(th, now + 1), false);
    assert.equal(await s.deleteBgWatch(th, now + 2), true);
    await s.putBgWatch({ thread: th, space: 'sp', deadline: now + 3 });
    assert.equal(await s.deleteBgWatch(th, null), true);
    await s.deleteBgWatch(th, null); // already gone: unconditional, its result is not read (background.ts)
    assert.deepEqual((await s.listBgWatches()).filter(x => x.thread === th), []);
  });

  // ---------------------------------------------------------------- versioned records (JSON or attributes)
  it('memory entries, config and tag vocabulary: version guards', async () => {
    const sp = uid('s'), id = uid('e');
    const e = (v: number, text: string): any => ({ id, space: sp, text, kind: 'fact', sources: ['x'], author: 'g', thread: 't', by: 'b', at: 1, status: 'pending', gate: 'human', tags: ['hub'], version: v });
    assert.equal(await s.putMemory(e(1, 'a'), null), true);
    assert.equal(await s.putMemory(e(1, 'b'), null), false);
    assert.equal(await s.putMemory(e(2, 'c'), 7), false);
    assert.equal(await s.putMemory(e(2, 'd'), 1), true);
    assert.deepEqual(await s.getMemory(sp, id), e(2, 'd'));
    assert.deepEqual(await s.listMemory(sp), [e(2, 'd')]);
    assert.equal(await s.getMemory(sp, uid('e')), null);
    const cfg = (v: number): any => ({ space: sp, batch: { n: 3, minutes: 60 }, thread: 'th', wokeAt: 5, by: 'b', version: v });
    assert.equal(await s.getMemoryConfig(sp), null);
    assert.equal(await s.putMemoryConfig(cfg(1), null), true);
    assert.equal(await s.putMemoryConfig(cfg(2), 0), false);
    assert.equal(await s.putMemoryConfig(cfg(2), 1), true);
    assert.deepEqual(await s.getMemoryConfig(sp), cfg(2));
    const vocab = (v: number): any => ({ space: sp, aliases: { hubs: 'hub' }, merges: [{ from: 'ui', to: 'frontend', agent: 'g', at: 1 }], created: ['infra'], seen: { hubs: 3 }, version: v });
    assert.equal(await s.getMemoryVocab(sp), null);
    assert.equal(await s.putMemoryVocab(vocab(1), null), true);
    assert.equal(await s.putMemoryVocab(vocab(1), null), false);
    assert.equal(await s.putMemoryVocab(vocab(2), 1), true);
    assert.deepEqual(await s.getMemoryVocab(sp), vocab(2));
  });
  it('routines, applets, module records: version guards, listed per space, deleted', async () => {
    const sp = uid('s');
    const x = (id: string, v: number, extra = {}): any => ({ id, name: `n${id}`, version: v, nested: { a: [1, ''] }, ...extra });
    for (const [put, list, del] of [
      [(r: any, e: any) => s.putRoutine(sp, r, e), () => s.listRoutines(sp), (id: string) => s.deleteRoutine(sp, id)],
      [(r: any, e: any) => s.putApplet(sp, r, e), () => s.listApplets(sp), (id: string) => s.deleteApplet(sp, id)],
      [(r: any, e: any) => s.putItem(sp, 'NOTE', r, e), () => s.listItems(sp, 'NOTE'), (id: string) => s.deleteItem(sp, 'NOTE', id)],
    ] as const) {
      assert.equal(await put(x('r1', 1), null), true);
      assert.equal(await put(x('r1', 1), null), false, 'exists');
      assert.equal(await put(x('r1', 2), 5), false, 'stale');
      assert.equal(await put(x('r1', 2), 1), true);
      await put(x('r2', 1), null);
      assert.deepEqual((await list() as any[]).sort((a, c) => a.id.localeCompare(c.id)), [x('r1', 2), x('r2', 1)]);
      await del('r1');
      assert.deepEqual(await list(), [x('r2', 1)]);
    }
    assert.deepEqual(await s.getItem(sp, 'NOTE', 'r2'), x('r2', 1));
    assert.equal(await s.getItem(sp, 'NOTE', 'r1'), null);
    assert.deepEqual(await s.listItems(sp, 'OTHER'), []);
    await s.putItem(sp, 'NOTEBOOK', x('z', 1), null); // a kind that starts like another one
    assert.deepEqual((await s.listItems(sp, 'NOTE')).map(i => i.id), ['r2'], 'kind prefix');
  });
  it('signals: guard, newest seen first, limit', async () => {
    const sp = uid('s');
    const sig = (id: string, lastAt: number, v = 1): any => ({ id, space: sp, title: id, lastAt, version: v });
    await s.putSignal(sig('a', 10), null);
    await s.putSignal(sig('b', 30), null);
    await s.putSignal(sig('c', 20), null);
    assert.equal(await s.putSignal(sig('a', 40, 2), 9), false);
    assert.equal(await s.putSignal(sig('a', 40, 2), 1), true);
    assert.deepEqual((await s.listSignals(sp, 2)).map(x => x.id), ['a', 'b']);
    assert.deepEqual(await s.getSignal(sp, 'a'), sig('a', 40, 2));
    assert.equal(await s.getSignal(sp, 'z'), null);
  });
  it('radar config and hidden usage: guards, days from', async () => {
    const sp = uid('s');
    const rc = (v: number): any => ({ space: sp, agent: 'g', sources: [], version: v });
    assert.equal(await s.getRadarConfig(sp), null);
    assert.equal(await s.putRadarConfig(rc(1), null), true);
    assert.equal(await s.putRadarConfig(rc(2), null), false);
    assert.equal(await s.putRadarConfig(rc(2), 1), true);
    assert.deepEqual(await s.getRadarConfig(sp), rc(2));
    const hu = (day: string, v: number, usd: number): any => ({ space: sp, day, origin: 'memory', agent: 'g', usage: { usd }, version: v });
    assert.equal(await s.putHiddenUsage(hu('2026-11-14', 1, 1), null), true);
    assert.equal(await s.putHiddenUsage(hu('2026-11-14', 2, 2), 1), true);
    assert.equal(await s.putHiddenUsage(hu('2026-11-14', 3, 3), 1), false);
    await s.putHiddenUsage(hu('2026-11-16', 1, 5), null);
    assert.deepEqual(await s.getHiddenUsage(sp, '2026-11-14', 'memory' as any, 'g'), hu('2026-11-14', 2, 2));
    assert.equal(await s.getHiddenUsage(sp, '2026-11-15', 'memory' as any, 'g'), null);
    assert.deepEqual((await s.listHiddenUsage(sp, '2026-11-15')).map(x => x.day), ['2026-11-16']);
    assert.equal((await s.listHiddenUsage(sp, '')).length, 2);
  });
  it('mail exchanges: correspondents, exchanges, mails once, cascade delete', async () => {
    const sp = uid('s');
    const c = (v: number): any => ({ id: 'c1', space: sp, name: 'N', company: 'Co', role: 'client', addrs: ['a@b'], version: v });
    assert.equal(await s.putCorrespondent(c(1), null), true);
    assert.equal(await s.putCorrespondent(c(2), 5), false);
    assert.equal(await s.putCorrespondent(c(2), 1), true);
    assert.deepEqual(await s.listCorrespondents(sp), [c(2)]);
    await s.deleteCorrespondent(sp, 'c1');
    assert.deepEqual(await s.listCorrespondents(sp), []);
    const x = (v: number): any => ({ id: 'x1', space: sp, subject: 'S', version: v });
    assert.equal(await s.putExchange(x(1), null), true);
    assert.equal(await s.putExchange(x(1), null), false);
    assert.deepEqual(await s.listExchanges(sp), [x(1)]);
    assert.deepEqual(await s.getExchange(sp, 'x1'), x(1));
    const mail = (id: string, date: number, exchange = 'x1'): any => ({ id, space: sp, exchange, date, from: 'a@b' });
    assert.equal(await s.putExchangeMail(mail('m2', 20)), true);
    assert.equal(await s.putExchangeMail(mail('m1', 10)), true);
    assert.equal(await s.putExchangeMail(mail('m1', 10, 'x2')), false, 'already known');
    await s.putExchangeMail(mail('m3', 5, 'x10')); // an exchange id that starts like another one
    assert.deepEqual((await s.listExchangeMails(sp, 'x1')).map(m => m.id), ['m1', 'm2'], 'oldest first, this exchange only');
    assert.equal(await s.getMailOwner(sp, 'm1'), 'x1');
    assert.equal(await s.getMailOwner(sp, 'zz'), null);
    await s.deleteExchange(sp, 'x1', [{ id: 'm1', date: 10 }, { id: 'm2', date: 20 }]);
    assert.equal(await s.getExchange(sp, 'x1'), null);
    assert.deepEqual(await s.listExchangeMails(sp, 'x1'), []);
    assert.equal(await s.getMailOwner(sp, 'm1'), null);
    const cfg = (v: number): any => ({ space: sp, agent: 'g', version: v });
    assert.equal(await s.getExchangeConfig(sp), null);
    assert.equal(await s.putExchangeConfig(cfg(1), null), true);
    assert.equal(await s.putExchangeConfig(cfg(2), 0), false);
    assert.deepEqual(await s.getExchangeConfig(sp), cfg(1));
  });

  // ---------------------------------------------------------------- flow (board)
  it('flow versions: written once, newest first (meta only), latest, columns', async () => {
    const sp = uid('s');
    assert.equal(await s.flowColumns(sp), null);
    assert.equal(await s.getFlowVersion(sp, null), null);
    const def: any = structuredClone(FLOW_TEMPLATES.dev);
    const team: any = { agents: [], links: [] };
    const v = (n: number, x = {}): any => ({ version: n, by: 'blair', at: n * 10, sha: `sha${n}`, def, team, ...x });
    assert.equal(await s.putFlowVersion(sp, v(1)), true);
    assert.equal(await s.putFlowVersion(sp, v(1)), false);
    assert.equal(await s.putFlowVersion(sp, v(2, { commit: 'c2', source: { repo: 'o/r', path: 'flow', branch: 'main' } })), true);
    assert.equal(await s.putFlowVersion(sp, v(10)), true, 'sorted as numbers');
    assert.deepEqual(await s.listFlowVersions(sp, 2), [{ version: 10, by: 'blair', at: 100, sha: 'sha10' }, { version: 2, by: 'blair', at: 20, sha: 'sha2', commit: 'c2' }]);
    assert.deepEqual(await s.getFlowVersion(sp, null), v(10));
    assert.deepEqual(await s.getFlowVersion(sp, 2), v(2, { commit: 'c2', source: { repo: 'o/r', path: 'flow', branch: 'main' } }));
    assert.equal(await s.getFlowVersion(sp, 3), null);
    assert.deepEqual(await s.flowColumns(sp), { approved: approvedColumn(def), work: workColumns(def) });
  });
  it('flow status, git source, live states, closed tasks', async () => {
    const sp = uid('s');
    const st = (agent: string, at: number): any => ({ agent, version: 1, sha: 's', ok: false, error: 'bad', commit: 'c', at });
    await s.putFlowStatus(sp, st('dev', 1));
    await s.putFlowStatus(sp, st('dev', 2));
    await s.putFlowStatus(sp, st('pm', 3));
    assert.deepEqual((await s.listFlowStatus(sp)).sort((a, c) => a.at - c.at), [st('dev', 2), st('pm', 3)]);
    assert.equal(await s.getFlowGit(sp), null);
    const g: any = { head: 'h1', files: { 'a.yaml': '' }, at: 1 };
    await s.putFlowGit(sp, g);
    assert.deepEqual(await s.getFlowGit(sp), g);
    const live = (agent: string, at: number): any => ({ agent, at, busy: [], paused: false });
    await s.putFlowState(sp, live('dev', 1));
    await s.putFlowState(sp, live('dev', 2));
    assert.deepEqual(await s.listFlowStates(sp), [live('dev', 2)]);
    const rec = (start: number, agent: string, outcome = 'done'): any => ({ space: sp, agent, thread: null, ref: 'o/r#1', key: 'k', at: start + 5, outcome,
      kind: null, trigger: 't', start, end: start + 5, retries: 0, runs: 1, reviews: 0, cost: null });
    await s.putFlowRecord(rec(100, 'dev'));
    await s.putFlowRecord(rec(100, 'dev', 'failed')); // replay of the same task
    await s.putFlowRecord(rec(300, 'pm'));
    await s.putFlowRecord(rec(200, 'dev'));
    assert.deepEqual(await s.listFlowRecords(sp, 2), [rec(300, 'pm'), rec(200, 'dev')]);
    assert.deepEqual((await s.listFlowRecords(sp, 9)).at(-1), rec(100, 'dev', 'failed'));
  });

  test(`${name} › coverage of the Store interface`, async () => {
    const all = storeMethods();
    const missed = all.filter(m => !called.has(m));
    console.log(`[store-contract] ${name}: ${all.length - missed.length}/${all.length} methods covered, ${titles.size} cases, ${Object.keys(quirks).length} known divergences`
      + (missed.length ? ` — not covered: ${missed.join(', ')}` : ''));
    assert.deepEqual(missed, []);
    await b.close?.();
  });
}
