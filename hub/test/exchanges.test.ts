import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copiesMail, exchangeDue, mailSource, mailSourceOf, needsSummary, openRequests, summaryIn, summaryStale, EXCHANGE_DUE_MS, contactOf, correspondentAddr, correspondentIn, correspondentLabel, correspondentOf, displaySubject, exchangeWho, exchangeOrder, exchangeState, mailIn, normMessageId, normSubject, splitQuote, MAIL_BODY_MAX, type Exchange } from '../../protocol/exchanges.ts';

test('correspondentIn: a company is required, the name is optional', () => {
  const base = { role: 'supplier', addrs: ['@Berlin.com'] };
  assert.deepEqual(correspondentIn({ ...base, company: ' Berlin ' }), { name: '', company: 'Berlin', role: 'supplier', addrs: ['@berlin.com'] });
  assert.equal(correspondentIn({ ...base, company: 'Berlin', name: ' Ilan ' })!.name, 'Ilan');
  assert.equal(correspondentIn({ ...base, name: 'Ilan Cohen' }), null, 'no company');
  assert.equal(correspondentIn({ ...base, company: '  ' }), null);
  assert.equal(correspondentIn({ ...base, company: 'Berlin', name: 3 }), null);
  assert.equal(correspondentIn({ ...base, company: 'x'.repeat(121) }), null);
});

test('who an exchange is with: the person of the newest mail, then the company; old records fall back on the name', () => {
  const berlin = { id: 'b', space: 's', name: '', company: 'Berlin', role: 'supplier' as const, addrs: ['@berlin.com'], version: 1 };
  const other = { ...berlin, id: 'o', company: 'Other', addrs: ['sophie@gmail.com'] };
  const cs = [berlin, other];
  assert.deepEqual(contactOf({ from: { name: 'Ilan Cohen', addr: 'ilan@berlin.com' }, to: [{ addr: 'blair@example.org' }] }, berlin, cs), { name: 'Ilan Cohen', addr: 'ilan@berlin.com' });
  assert.deepEqual(contactOf({ from: { addr: 'blair@example.org' }, to: [{ addr: 'sophie@gmail.com' }], cc: [{ addr: 'dan@berlin.com' }] }, berlin, cs), { addr: 'dan@berlin.com' }, 'our mail: their To/Cc');
  assert.equal(contactOf({ from: { addr: 'blair@example.org' }, to: [{ addr: 'sophie@gmail.com' }] }, berlin, cs), null);
  assert.equal(exchangeWho({ contact: { name: 'Ilan Cohen', addr: 'ilan@berlin.com' } }, berlin), 'Ilan Cohen · Berlin');
  assert.equal(exchangeWho({ contact: { addr: 'support@berlin.com' } }, berlin), 'support@berlin.com · Berlin', 'no display name: the address');
  assert.equal(exchangeWho({}, berlin), 'Berlin', 'imported before the contact was kept, no declared name');
  assert.equal(exchangeWho({}, { ...berlin, name: 'Ilan' }), 'Ilan · Berlin', 'else the declared name');
  assert.equal(exchangeWho({ contact: { name: 'BERLIN', addr: 'info@berlin.com' } }, berlin), 'Berlin', 'never twice');
  const legacy = { name: 'Ilan Cohen', company: '' };
  assert.equal(correspondentLabel(legacy), 'Ilan Cohen', 'saved before the company was required');
  assert.equal(exchangeWho({}, legacy), 'Ilan Cohen');
  assert.equal(exchangeWho({ contact: { name: 'Dan', addr: 'dan@berlin.com' } }, legacy), 'Dan · Ilan Cohen');
});

test('normSubject / displaySubject: reply and forward prefixes, tags, spaces and case', () => {
  assert.equal(normSubject('RE: TR: [ext]  Omega :  Rate limit'), 'omega : rate limit');
  assert.equal(normSubject('Re[2]: Fwd: AW: devis J2'), 'devis j2');
  assert.equal(displaySubject('Re: Re:   Devis J2'), 'Devis J2');
  assert.equal(displaySubject('RE: '), '(no subject)');
});

test('correspondent addresses: address or domain, never a public mail domain; exact address wins over domain', () => {
  assert.equal(correspondentAddr(' @Berlin.com '), '@berlin.com');
  assert.equal(correspondentAddr('@gmail.com'), null);
  assert.equal(correspondentAddr('sophie@gmail.com'), 'sophie@gmail.com');
  assert.equal(correspondentAddr('berlin.com'), null);
  const cs: any[] = [{ id: 'dom', addrs: ['@berlin.com'] }, { id: 'ilan', addrs: ['ilan@berlin.com'] }];
  assert.equal(correspondentOf('ILAN@berlin.com', cs)!.id, 'ilan');
  assert.equal(correspondentOf('support@berlin.com', cs)!.id, 'dom');
  assert.equal(correspondentOf('x@other.com', cs), null);
});

test('mailIn: refuses what a source could get wrong', () => {
  const ok = { message_id: '<a@b.c>', from: { addr: 'a@b.com' }, to: [{ addr: 'c@d.com' }], date: '2026-11-03T11:22:00+01:00', subject: 's', body_text: 'b' };
  const now = Date.parse('2026-11-09T00:00:00Z');
  const r = mailIn(ok, now) as any;
  assert.equal(r.mail.messageId, 'a@b.c'); assert.equal(r.mail.date, Date.parse('2026-11-03T10:22:00Z'));
  const err = (x: any) => (mailIn({ ...ok, ...x }, now) as any).error;
  assert.equal(err({ message_id: 'a b' }), 'bad_message_id');
  assert.equal(err({ to: [] }), 'bad_address');
  assert.equal(err({ from: { addr: 'Ilan <i@b.com>' } }), 'bad_address');
  assert.equal(err({ date: '2026-11-03 11:22' }), 'bad_date');
  assert.equal(err({ date: '2026-11-20T00:00:00Z' }), 'bad_date');
  assert.equal(err({ body_text: 'x'.repeat(MAIL_BODY_MAX + 1) }), 'bad_body');
  assert.equal(err({ references: ['ok@x', 'bad id'] }), 'bad_references');
  assert.equal(normMessageId(' <x@y> '), 'x@y');
});

test('exchangeState and exchangeOrder: who wrote last, closed until a newer mail received; urgent first', () => {
  assert.equal(exchangeState({ lastIn: 5, lastOut: 3 }), 'us');
  assert.equal(exchangeState({ lastIn: 3, lastOut: 5 }), 'wait');
  assert.equal(exchangeState({ lastIn: 3, lastOut: 5, closed: { by: 'b', at: 6 } }), 'closed');
  assert.equal(exchangeState({ lastIn: 7, lastOut: 5, closed: { by: 'b', at: 6 } }), 'us');
  const x = (id: string, state: Exchange['state'], lastAt: number) => ({ id, state, lastAt }) as Exchange;
  assert.deepEqual([x('c1', 'closed', 1), x('w', 'wait', 5), x('u2', 'us', 9), x('u1', 'us', 2), x('c2', 'closed', 8)].sort(exchangeOrder).map(e => e.id), ['u1', 'u2', 'w', 'c2', 'c1']);
});

test('splitQuote: own text, then the quoted tail', () => {
  assert.deepEqual(splitQuote('Merci.\n\nLe 3 nov. 2026, Ilan a écrit :\n> Done'), { own: 'Merci.', quote: 'Le 3 nov. 2026, Ilan a écrit :\n> Done' });
  assert.deepEqual(splitQuote('Thanks\n> a\n> b\n'), { own: 'Thanks', quote: '> a\n> b\n' });
  assert.deepEqual(splitQuote('> only a quote'), { own: '> only a quote', quote: '' });
  assert.deepEqual(splitQuote('a > b inline'), { own: 'a > b inline', quote: '' });
});

test('summaryIn: through is a mail never older than the last summary, new requests cite newer mails, done names open requests', () => {
  const mails = [{ id: 'm1', date: 100 }, { id: 'm2', date: 200 }];
  const ok = { status: ' Quote  asked ', decisions: ['J2 at 300 req/min'], through: 'm2', requests: [{ what: 'Send the quote', side: 'us', mail: 'm2' }] };
  const d = summaryIn(ok, mails, {}) as any;
  assert.deepEqual([d.status, d.throughAt, d.requests.length, d.done], ['Quote asked', 200, 1, []]);
  const err = (f: any, x: any = {}) => (summaryIn({ ...ok, ...f }, mails, x) as any).error;
  assert.equal(err({ status: '' }), 'bad_status');
  assert.equal(err({ status: 'x'.repeat(601) }), 'bad_status');
  assert.equal(err({ decisions: Array(9).fill('d') }), 'bad_decisions');
  assert.equal(err({ through: 'm9' }), 'bad_mail');
  const prev = { summary: { status: 's', decisions: [], through: 'm2', throughAt: 200, agent: 'a', at: 1 }, requests: [{ id: 'r1', what: 'w', side: 'us' as const, mail: 'm1', at: 1 }, { id: 'r2', what: 'w', side: 'them' as const, mail: 'm1', at: 1, done: { by: 'b', at: 2 } }] };
  assert.equal(err({ through: 'm1' }, prev), 'stale', 'never goes backwards');
  assert.equal(err({}, prev), 'old_mail', 'm2 was already read');
  assert.equal(err({ requests: [], done: ['r2'] }, prev), 'bad_done', 'already done');
  assert.deepEqual((summaryIn({ ...ok, requests: [], done: ['r1', 'r1'] }, mails, prev) as any).done, ['r1']);
  assert.equal(err({ requests: [{ what: 'w', side: 'ours', mail: 'm2' }] }), 'bad_requests');
});

test('summary state, open requests, Your turn after 3 days, mail sources, copy check', () => {
  assert.equal(needsSummary({ lastAt: 5 }), true);
  const s = { status: 's', decisions: [], through: 'm', throughAt: 5, agent: 'a', at: 1 };
  assert.equal(summaryStale({ summary: s, lastAt: 5 }), false); assert.equal(summaryStale({ summary: s, lastAt: 6 }), true);
  assert.equal(openRequests({ requests: [{ id: 'a', what: 'w', side: 'us', mail: 'm', at: 1 }, { id: 'b', what: 'w', side: 'us', mail: 'm', at: 1, done: { by: 'x', at: 2 } }] }), 1);
  const now = 10 * 86_400_000;
  assert.equal(exchangeDue({ state: 'us', lastIn: now - EXCHANGE_DUE_MS, lastAt: now }, now), true, 'counted from the mail we owe an answer to');
  assert.equal(exchangeDue({ state: 'us', lastIn: now - EXCHANGE_DUE_MS + 1, lastAt: now }, now), false);
  assert.equal(exchangeDue({ state: 'wait', lastIn: 0, lastAt: 0 }, now), false);
  assert.deepEqual(mailSourceOf(mailSource('x1', 'm_2')), { exchange: 'x1', mail: 'm_2' });
  assert.equal(mailSourceOf('mail:x/y/z'), null); assert.equal(mailSourceOf('issue #12'), null);
  const body = 'Hello Blair,\nthe test key of the Omega API is now limited to 300 requests per minute, the production one stays at 1000.';
  assert.equal(copiesMail('Omega: test key at 300 req/min, production at 1000.', body), false, 'rephrased');
  assert.equal(copiesMail('The   TEST key of the Omega API is now limited to 300 requests per minute.', body), true, 'spaces and case folded');
});
