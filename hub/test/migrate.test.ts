import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateItem, plan, itemType } from '../src/migrate.ts';

const facts = { turnActive: false, pendingAsk: null, unseenReply: null, outcome: null, manual: null };

test('migrate: thread META under FIL# moves to THREAD#, kind fil/sujet -> thread/topic, ids and text untouched', () => {
  const fil = { pk: 'FIL#t1', sk: 'META', id: 't1', space: 'civic', title: 'Déploie', owner: 'gaston', kind: 'fil', state: 'calm', facts, updatedAt: 5, version: 3, lastTurnAt: 2 };
  assert.deepEqual(migrateItem(fil), [{ ...fil, pk: 'THREAD#t1', kind: 'thread' }]);
  const sujet = { pk: 'FIL#s1', sk: 'META', id: 's1', space: 'civic', title: 'Idée', owner: 'gaston', kind: 'sujet', author: 'blair', text: 'Une idée en l\'air', spawned: ['t1'], version: 1 };
  assert.deepEqual(plan(sujet), { type: 'thread', action: 'move', put: { ...sujet, pk: 'THREAD#s1', kind: 'topic' }, del: { pk: 'FIL#s1', sk: 'META' } });
  // thread written before `kind` existed: only the key moves
  const old = { pk: 'FIL#t0', sk: 'META', id: 't0', space: 'civic', title: 'x', owner: 'gaston', from: 's1', version: 1 };
  assert.deepEqual(migrateItem(old), [{ ...old, pk: 'THREAD#t0' }]);
});

test('migrate: SPACE#/FIL# sync index item -> SPACE#/THREAD#, kind translated, archived/outcome kept', () => {
  const idx = { pk: 'SPACE#civic', sk: 'FIL#s1', id: 's1', space: 'civic', title: 'Idée', owner: 'gaston', kind: 'sujet', state: 'calm', updatedAt: 9, version: 4,
    archived: { by: 'blair', at: 7 }, outcome: { kind: 'waiting', action: '/restart', at: 6 } };
  const p = plan(idx);
  assert.equal(p.type, 'thread-index');
  assert.deepEqual(p, { type: 'thread-index', action: 'move', put: { ...idx, sk: 'THREAD#s1', kind: 'topic' }, del: { pk: 'SPACE#civic', sk: 'FIL#s1' } });
});

test('migrate: MSG# moves, attribute fil -> thread, propose.fil -> propose.thread, message text never translated', () => {
  const msg = { pk: 'FIL#t1', sk: 'MSG#m1', id: 'm1', fil: 't1', author: { kind: 'human', id: 'blair' }, type: 'text', text: 'Regarde le fil, stp', ask: null, propose: null, at: 3, rev: 0,
    files: [{ id: 'a1', name: 'capture.png', mime: 'image/png', size: 10 }] };
  const [m] = migrateItem(msg);
  assert.deepEqual(m, { pk: 'THREAD#t1', sk: 'MSG#m1', id: 'm1', thread: 't1', author: msg.author, type: 'text', text: 'Regarde le fil, stp', ask: null, propose: null, at: 3, rev: 0, files: msg.files });
  assert.ok(!('fil' in m));
  const card = { pk: 'FIL#s1', sk: 'MSG#c1', id: 'c1', fil: 's1', author: { kind: 'system', id: 'briefling' }, type: 'propose', text: "J'en fais un fil ?",
    propose: { title: 'Alerte', status: 'done', fil: 't9', by: 'gaston', brief: '- faire X' }, at: 4 };
  const [c] = migrateItem(card);
  assert.deepEqual(c.propose, { title: 'Alerte', status: 'done', thread: 't9', by: 'gaston', brief: '- faire X' });
  assert.equal(c.text, "J'en fais un fil ?", 'stored card text is history: left as written');
  // open card (no thread yet) only gets the attribute rename
  const open = { ...card, sk: 'MSG#c2', id: 'c2', propose: { title: 'Alerte', status: 'open', by: 'gaston' } };
  assert.deepEqual(migrateItem(open)[0].propose, open.propose);
});

test('migrate: SUMMARY with French keys -> English keys under THREAD#', () => {
  const s = { pk: 'FIL#t1', sk: 'SUMMARY', fil: 't1', at: 20, ou_on_en_est: 'PR ouverte.', decide: ['backoff'], prochaine_etape: [{ qui: 'Blair', quoi: 'relire' }], en_attente_de: 'Blair' };
  assert.deepEqual(plan(s), { type: 'summary', action: 'move', del: { pk: 'FIL#t1', sk: 'SUMMARY' },
    put: { pk: 'THREAD#t1', sk: 'SUMMARY', thread: 't1', at: 20, status: 'PR ouverte.', decisions: ['backoff'], next_steps: [{ who: 'Blair', what: 'relire' }], waiting_on: 'Blair' } });
  const none = { pk: 'FIL#t2', sk: 'SUMMARY', fil: 't2', at: 1, ou_on_en_est: 'Fini.', decide: [], prochaine_etape: [], en_attente_de: null };
  assert.deepEqual(migrateItem(none)[0], { pk: 'THREAD#t2', sk: 'SUMMARY', thread: 't2', at: 1, status: 'Fini.', decisions: [], next_steps: [], waiting_on: null });
});

test('migrate: REACT# moves with fil -> thread', () => {
  const r = { pk: 'FIL#t1', sk: 'REACT#m1#✅#blair', fil: 't1', msg: 'm1', emoji: '✅', user: 'blair', on: true, at: 100, hubAt: 101 };
  assert.deepEqual(plan(r), { type: 'reaction', action: 'move', put: { pk: 'THREAD#t1', sk: 'REACT#m1#✅#blair', thread: 't1', msg: 'm1', emoji: '✅', user: 'blair', on: true, at: 100, hubAt: 101 },
    del: { pk: 'FIL#t1', sk: 'REACT#m1#✅#blair' } });
});

test('migrate: USER#/PIN# keeps its key, attribute fil -> thread (rewrite in place)', () => {
  const pin = { pk: 'USER#u1', sk: 'PIN#t1', fil: 't1', space: 'civic', on: true, at: 5 };
  assert.deepEqual(plan(pin), { type: 'pin', action: 'rewrite', put: { pk: 'USER#u1', sk: 'PIN#t1', thread: 't1', space: 'civic', on: true, at: 5 } });
});

test('migrate: SPACE#/LOCK# unchanged (holder and queue are ids)', () => {
  const lock = { pk: 'SPACE#civic', sk: 'LOCK#gaston', space: 'civic', agent: 'gaston', holder: 't1', queue: ['t2'], since: 3, version: 7, by: { t2: 'blair' }, delivered: 2 };
  assert.equal(migrateItem(lock)[0], lock);
  assert.deepEqual(plan(lock), { type: 'lock', action: 'skip' });
});

test('migrate: ATT# unchanged, or fil -> thread if an attachment ever carried one', () => {
  const att = { pk: 'ATT#a1', sk: 'META', id: 'a1', name: 'capture.png', mime: 'image/png', size: 10, space: 'civic', by: 'blair', at: 1, msg: 'm1' };
  assert.deepEqual(plan(att), { type: 'attachment', action: 'skip' });
  assert.deepEqual(plan({ ...att, fil: 't1' }), { type: 'attachment', action: 'rewrite', put: { ...att, thread: 't1' } });
});

test('migrate: items with nothing to rename are skipped (space, GitHub snapshot, indexes, instances, connections)', () => {
  const items = [
    { pk: 'SPACE#civic', sk: 'META', name: 'Civic', members: ['blair'], trusted: ['blair'], defaultAgent: 'gaston', about: 'Le fil rouge du projet', version: 2 },
    { pk: 'SPACE#civic', sk: 'GITHUB', space: 'civic', at: 1, project: { title: 'P', url: 'u' }, items: [{ id: 'i', kind: 'issue', title: 'x', status: null, state: 'OPEN', assignees: [] }] },
    { pk: 'INDEX', sk: 'SPACES', spaces: new Set(['civic']) },
    { pk: 'INSTANCE#mini', sk: 'META', spaces: ['civic'], agents: ['gaston'] },
    { pk: 'CONN#c1', sk: 'META', principalKind: 'human', principalId: 'blair', spaces: new Set(['civic']), ttl: 1 },
    { pk: 'SUB#civic', sk: 'CONN#c1', kind: 'human', principal: 'blair', ttl: 1 },
  ];
  for (const i of items) assert.equal(migrateItem(i)[0], i, `${i.pk}/${i.sk}`);
  assert.deepEqual(items.map(i => itemType(i)), ['space', 'github', 'index', 'instance', 'connection', 'subscription']);
});

test('migrate: idempotent, every migrated item comes back unchanged', () => {
  const olds = [
    { pk: 'FIL#t1', sk: 'META', id: 't1', kind: 'sujet', version: 1 },
    { pk: 'SPACE#civic', sk: 'FIL#t1', id: 't1', kind: 'fil', version: 1 },
    { pk: 'FIL#t1', sk: 'MSG#m1', id: 'm1', fil: 't1', text: 'x', propose: { title: 'a', status: 'done', fil: 't2' } },
    { pk: 'FIL#t1', sk: 'SUMMARY', fil: 't1', at: 1, ou_on_en_est: 'x', decide: [], prochaine_etape: [{ qui: 'a', quoi: 'b' }], en_attente_de: null },
    { pk: 'FIL#t1', sk: 'REACT#m1#✅#u', fil: 't1', msg: 'm1' },
    { pk: 'USER#u', sk: 'PIN#t1', fil: 't1', at: 1 },
  ];
  for (const o of olds) {
    const [n] = migrateItem(o);
    assert.notEqual(n, o);
    assert.equal(migrateItem(n)[0], n, `${o.pk}/${o.sk}`);
    assert.deepEqual(plan(n).action, 'skip');
    assert.ok(!JSON.stringify(n).includes('"fil"') && !String(n.pk).startsWith('FIL#') && !String(n.sk).startsWith('FIL#'));
  }
});
