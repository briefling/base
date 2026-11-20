import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INBOX, byDay, cardIn, dateOk, dayOf, dueAt, dueToday, inSmart, listIn, myTodayCount, overdue, reminderAt, reminderIn, reminderSchedule, tzOk, zonedAt, type Reminder } from '../../protocol/reminders.ts';
import { applyUpdate, counts, dueLabel, fromList, listSel, parseQuick, shown, timeWord } from '../src/reminders.ts';

const PARIS = 'Europe/Paris';
const at = (iso: string) => Date.parse(iso);
const R = (id: string, x: Partial<Reminder> = {}): Reminder => ({ id, title: id, list: INBOX, for: 'blair', by: 'blair', at: 1, version: 1, ...x });
const due = (date: string, time?: string, tz = PARIS) => ({ date, ...(time ? { time } : {}), tz, at: dueAt({ date, ...(time ? { time } : {}), tz }) });

test('reminders: validation of a reminder, a list and an agent card (dates are real days, zones known)', () => {
  assert.deepEqual(reminderIn({ title: '  Payer la cantine ', list: INBOX, for: 'blair', date: '2026-11-13', time: '09:30', tz: PARIS }),
    { title: 'Payer la cantine', list: INBOX, for: 'blair', due: { date: '2026-11-13', time: '09:30', tz: PARIS } });
  assert.deepEqual(reminderIn({ title: 'x', list: INBOX, for: 'blair', date: '', time: '' }), { title: 'x', list: INBOX, for: 'blair' }, 'no date');
  for (const bad of [{ title: '' }, { title: 'a\nb' }, { title: 'x'.repeat(201) }, { date: '2026-02-30', tz: PARIS }, { date: '2026-11-13' }, { date: '2026-11-13', tz: 'Mars/Olympus' },
    { time: '09:00' }, { date: '2026-11-13', tz: PARIS, time: '9:00' }, { list: '../x' }, { for: '' }, { notes: 'a\u0000' }, { flag: 'yes' }])
    assert.equal(reminderIn({ title: 'x', list: INBOX, for: 'blair', ...bad }), null, JSON.stringify(bad));
  assert.deepEqual([dateOk('2028-02-29'), dateOk('2027-02-29'), tzOk('UTC'), tzOk('Europe/Paris'), tzOk('Europe/Nowhere')], [true, false, true, true, false]);
  assert.deepEqual(listIn({ name: ' Courses ', color: 'green' }), { name: 'Courses', color: 'green' });
  assert.deepEqual([listIn({ name: 'x', color: 'chartreuse' }), listIn({ name: '', color: 'red' })], [null, null]);
  assert.deepEqual(cardIn({ title: 'Rappeler le garage', date: '2026-11-12', tz: PARIS, why: 'tu l’as demandé' }), { title: 'Rappeler le garage', date: '2026-11-12', tz: PARIS, why: 'tu l’as demandé' });
  assert.equal(cardIn({ title: 'x', time: '10:00' }), null, 'a time needs a date');
});

test('reminders: due instant in the creator\'s zone (DST both sides), one-shot schedule expression and name', () => {
  assert.equal(zonedAt('2026-11-12', '09:00', PARIS), at('2026-11-12T08:00:00Z'), 'winter: UTC+1');
  assert.equal(zonedAt('2026-07-12', '09:00', PARIS), at('2026-07-12T07:00:00Z'), 'summer: UTC+2');
  assert.equal(zonedAt('2026-11-12', '09:00', 'America/New_York'), at('2026-11-12T14:00:00Z'));
  assert.equal(zonedAt('2026-03-29', '02:30', PARIS), at('2026-03-29T01:30:00Z'), 'a skipped time lands just after the change');
  assert.equal(dueAt({ date: '2026-11-12', tz: PARIS }), at('2026-11-12T08:00:00Z'), 'date only: 09:00');
  assert.equal(reminderAt({ date: '2026-11-12', time: '18:05', tz: PARIS }), 'at(2026-11-12T18:05:00)');
  assert.equal(reminderAt({ date: '2026-11-12', tz: PARIS }), 'at(2026-11-12T09:00:00)');
  assert.equal(reminderSchedule('perso', 'id42'), 'perso.rm.id42');
});

test('reminders: overdue, today, smart lists and the sidebar badge (mine, due today or late)', () => {
  const now = at('2026-11-12T15:00:00Z'); // 16:00 in Paris
  const late = R('late', { due: due('2026-11-12', '10:00') }), tonight = R('tonight', { due: due('2026-11-12', '20:00') }), yday = R('yday', { due: due('2026-11-11') });
  const todayAllDay = R('allday', { due: due('2026-11-12') }), tomorrow = R('tmw', { due: due('2026-11-13'), for: 'joachim' }), none = R('none'), done = R('done', { due: due('2026-11-12', '09:00'), done: { by: 'blair', at: 2 } });
  assert.deepEqual([late, tonight, yday, todayAllDay, tomorrow, none, done].map(r => overdue(r, now, PARIS)), [true, false, true, false, false, false, false], 'a date alone is late the day after');
  assert.deepEqual([late, tonight, yday, todayAllDay, tomorrow, none, done].map(r => dueToday(r, now, PARIS)), [true, true, true, true, false, false, false]);
  const all = [late, tonight, yday, todayAllDay, tomorrow, none, done];
  assert.deepEqual(['today', 'scheduled', 'all', 'mine', 'done'].map(s => all.filter(r => inSmart(r, s as any, 'blair', now, PARIS)).length), [4, 5, 6, 5, 1]);
  assert.equal(myTodayCount(all, 'blair', now, PARIS), 4);
  assert.equal(myTodayCount(all, 'joachim', now, PARIS), 0, 'tomorrow is not today');
  assert.equal(dayOf(at('2026-11-12T23:30:00Z'), PARIS), '2026-11-13');
  assert.deepEqual(byDay(all).map(g => [g.day, g.items.map(r => r.id)]), [['2026-11-11', ['yday']], ['2026-11-12', ['allday', 'late', 'tonight'].sort((a, b) => all.find(r => r.id === a)!.due!.at - all.find(r => r.id === b)!.due!.at || a.localeCompare(b))], ['2026-11-13', ['tmw']]]);
});

test('reminders view: a list hides its completed ones (Show to see them), a checked one stays a moment; counts per tile and list', () => {
  const now = at('2026-11-12T15:00:00Z');
  const sp = fromList([{ id: 'c', name: 'Courses', color: 'green', by: 'blair', at: 1, version: 1 }],
    [R('a', { list: 'c' }), R('b', { list: 'c', done: { by: 'joachim', at: 5 } }), R('d', { due: due('2026-11-12', '18:00'), for: 'joachim' })]);
  assert.deepEqual(shown(sp, listSel('c'), 'blair', now, PARIS, false).map(r => r.id), ['a']);
  assert.deepEqual(shown(sp, listSel('c'), 'blair', now, PARIS, true).map(r => r.id), ['a', 'b'], 'completed ones last');
  assert.deepEqual(shown(sp, listSel('c'), 'blair', now, PARIS, false, new Set(['b'])).map(r => r.id), ['a', 'b'], 'just checked: kept');
  assert.deepEqual(shown(sp, 'today', 'blair', now, PARIS, false).map(r => r.id), ['d']);
  assert.deepEqual(shown(sp, 'mine', 'blair', now, PARIS, false).map(r => r.id), ['a']);
  assert.deepEqual(counts(sp, 'blair', now, PARIS), { smart: { today: 1, scheduled: 1, all: 2, mine: 1, done: 1 }, lists: { [INBOX]: 1, c: 1 } });
  // live update: newer version wins, a removed list takes its reminders
  const up = applyUpdate(sp, { reminders: [R('a', { list: 'c', title: 'old', version: 0 }), R('e', { version: 1 })], removed: ['d'] });
  assert.deepEqual([up.items.get('a')!.title, up.items.has('e'), up.items.has('d')], ['a', true, false], 'an older version never replaces a newer one');
  const gone = applyUpdate(up, { removedLists: ['c'] });
  assert.deepEqual([gone.lists.length, [...gone.items.keys()]], [0, ['e']]);
});

test('reminders quick add: date and time words at the end of the line (FR and EN), the rest is the title', () => {
  const today = '2026-11-12'; // a Thursday
  assert.deepEqual(parseQuick('Appeler Paul demain à 18h', today), { title: 'Appeler Paul', date: '2026-11-13', time: '18:00' });
  assert.deepEqual(parseQuick('Call Paul tomorrow at 6pm', today), { title: 'Call Paul', date: '2026-11-13', time: '18:00' });
  assert.deepEqual(parseQuick('Payer la cantine vendredi 9h30', today), { title: 'Payer la cantine', date: '2026-11-13', time: '09:30' });
  assert.deepEqual(parseQuick('Sortir les poubelles jeudi', today), { title: 'Sortir les poubelles', date: '2026-11-19' }, 'today\'s name = in a week');
  assert.deepEqual(parseQuick('Médicaments 20:00', today, '16:00'), { title: 'Médicaments', date: today, time: '20:00' }, 'a time alone: today');
  assert.deepEqual(parseQuick('Médicaments 8h', today, '16:00'), { title: 'Médicaments', date: '2026-11-13', time: '08:00' }, '… or tomorrow once passed');
  assert.deepEqual(parseQuick("Rendre le livre aujourd'hui", today), { title: 'Rendre le livre', date: today });
  assert.deepEqual(parseQuick('Acheter 3 baguettes', today), { title: 'Acheter 3 baguettes' }, 'a plain number is no time');
  assert.deepEqual(parseQuick('demain', today), { title: 'demain' }, 'never an empty title');
  assert.deepEqual(parseQuick('Voir le match à', today), { title: 'Voir le match à' }, 'a connector alone stays');
  assert.deepEqual(['18h', '9h05', '18:30', '6pm', '12am', 'midi', '25h', '18', 'h'].map(timeWord), ['18:00', '09:05', '18:30', '18:00', '00:00', '12:00', null, null, null]);
});

test('reminders due label: today, tomorrow, yesterday, a short date (year when not this year), overdue flagged', () => {
  const now = at('2026-11-12T15:00:00Z'), w = { today: 'Today', tomorrow: 'Tomorrow', yesterday: 'Yesterday' };
  assert.deepEqual(dueLabel(R('a', { due: due('2026-11-12', '18:00') }), now, PARIS, 'en', w), { text: 'Today, 18:00', overdue: false });
  assert.deepEqual(dueLabel(R('a', { due: due('2026-11-12', '09:00') }), now, PARIS, 'en', w), { text: 'Today, 09:00', overdue: true });
  assert.deepEqual(dueLabel(R('a', { due: due('2026-11-13') }), now, PARIS, 'en', w), { text: 'Tomorrow', overdue: false });
  assert.deepEqual(dueLabel(R('a', { due: due('2026-11-11') }), now, PARIS, 'en', w), { text: 'Yesterday', overdue: true });
  assert.equal(dueLabel(R('a', { due: due('2026-11-20') }), now, PARIS, 'fr', w)!.text, 'ven. 20 nov.');
  assert.equal(dueLabel(R('a', { due: due('2027-01-04') }), now, PARIS, 'en', w)!.text, 'Mon, Jan 4, 2027');
  assert.equal(dueLabel(R('a'), now, PARIS, 'en', w), null);
});
