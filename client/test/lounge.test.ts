import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loungeCard, topicName, isGeneral, loungeTopics, generalOf, generalStub, subtopicLink, fromGeneral, topicOrigin, topicActivity, topicCardWhen, subtopicOpens } from '../src/lounge.ts';
import type { PublicThread } from '../../protocol/frames.ts';

// Topic text is user content (French here on purpose): never translated.
const topic = (extra: Partial<PublicThread> = {}) =>
  ({ id: 's', space: 'e', title: 'Sur la gestion des espaces quand on crée à minima (ou update) sur le truc descrip', owner: 'milan', kind: 'topic', state: 'calm', updatedAt: 1, version: 1, ...extra }) as PublicThread;
const names: Record<string, string> = { b: 'Blair', j: 'Joachim' };
const nameOf = (id: string) => names[id] ?? null;

test('Lounge card: whole message and author of the topic', () => {
  const full = 'Sur la gestion des espaces quand on crée à minima (ou update) sur le truc description, il faudrait…\nDeuxième ligne.';
  assert.deepEqual(loungeCard(topic({ author: 'j', text: full }), 'b', nameOf), { heading: null, text: full, author: { id: 'j', name: 'Joachim' } });
});

test('Lounge card: a topic an agent opened on its own is signed by that agent, never as a member', () => {
  assert.deepEqual(loungeCard(topic({ author: 'milan', authorAgent: true, text: 'Rapport' }), 'b', nameOf),
    { heading: null, text: 'Rapport', author: { id: 'milan', name: 'Milan', agent: true } });
});

test('Lounge card: topic older than the field → title, no avatar', () => {
  assert.deepEqual(loungeCard(topic(), 'b', nameOf), { heading: null, text: topic().title, author: null });
});

test('Lounge card: unknown author → "A member", oneself with no known name → "You" (default language: English)', () => {
  assert.equal(loungeCard(topic({ author: 'x', text: 't' }), 'b', nameOf).author?.name, 'A member');
  assert.equal(loungeCard(topic({ author: 'me', text: 't' }), 'me', nameOf).author?.name, 'You');
  assert.equal(loungeCard(topic({ author: 'b', text: 't' }), 'b', nameOf).author?.name, 'Blair');
});

test('Lounge card: the title (agent or lead) in bold above the first message; topicName prefers it everywhere', () => {
  const heading = { text: 'Spaces inactifs sous un séparateur', by: { kind: 'agent' as const, id: 'milan' }, at: 2 };
  const c = loungeCard(topic({ author: 'b', text: 'quand on a bcp d espace', heading }), 'b', nameOf);
  assert.deepEqual([c.heading, c.text], ['Spaces inactifs sous un séparateur', 'quand on a bcp d espace']);
  assert.equal(topicName(topic({ heading })), 'Spaces inactifs sous un séparateur');
  assert.equal(topicName(topic()), topic().title);
});

test('General: excluded from the Lounge topics, by id or flag; archived and other spaces out; newest first', () => {
  const g = topic({ id: 'general-e', general: true, updatedAt: 9 });
  const all = [topic({ id: 'a', updatedAt: 2 }), g, topic({ id: 'b', updatedAt: 5 }), topic({ id: 'c', archived: { by: 'b', at: 1 } }),
    topic({ id: 'd', space: 'x' }), topic({ id: 'w', kind: 'thread' }), topic({ id: 'general-e2', space: 'e2' })];
  assert.deepEqual(loungeTopics(all, 'e').map(f => f.id), ['b', 'a']);
  assert.deepEqual(loungeTopics(all, 'e2').map(f => f.id), []); // General known by its id even without the flag
  assert.equal(isGeneral(g), true);
  assert.equal(isGeneral({ id: 'zz', general: true }), true);
  assert.equal(isGeneral(topic()), false);
});

test('General: found by its fixed id, null before its first post; the stand-in has the same shape', () => {
  const g = topic({ id: 'general-e', general: true });
  assert.equal(generalOf(new Map([['general-e', g]]), 'e'), g);
  assert.equal(generalOf(new Map(), 'e'), null);
  const st = generalStub('e');
  assert.deepEqual([st.id, st.space, st.kind, st.general, isGeneral(st)], ['general-e', 'e', 'topic', true, true]);
});

test('General: link to the topic opened from a message (its name once loaded), and the way back', () => {
  const sub = topic({ id: 'm1-t', heading: { text: 'Le titre', by: { kind: 'agent', id: 'milan' }, at: 1 } });
  const get = (id: string) => id === 'm1-t' ? sub : undefined;
  assert.equal(subtopicLink({}, get), null);
  assert.deepEqual(subtopicLink({ subtopic: 'm1-t' }, get), { id: 'm1-t', name: 'Le titre', unread: false, working: false, threads: 0, at: 1 });
  assert.deepEqual(subtopicLink({ subtopic: 'm2-t' }, get), { id: 'm2-t', name: null, unread: false, working: false, threads: 0, at: null });
  assert.equal(fromGeneral({ from: 'general-e' }), true);
  assert.equal(fromGeneral({ from: 'abc' }), false);
  assert.equal(fromGeneral({}), false);
});

test('topic origin: a Bar message links from the crumb, a topic or thread keeps its « from X », « + Topic » has none', () => {
  const parent = topic({ id: 'p1' });
  const get = (id: string) => id === 'p1' ? parent : undefined;
  assert.deepEqual(topicOrigin({ from: 'general-e' }, get), { at: 'crumb' });
  assert.deepEqual(topicOrigin({ from: 'general-e' }, () => undefined), { at: 'crumb' }, 'the Bar need not be synced');
  assert.deepEqual(topicOrigin({ from: 'p1' }, get), { at: 'from', parent });
  assert.equal(topicOrigin({ from: 'gone' }, get), null, 'parent not synced: no link');
  assert.equal(topicOrigin({}, get), null, '« + Topic »: no origin');
});

test('link under a General message: the signals of the topic row in the list, same sources', () => {
  const busy = topic({ id: 'm1-t', state: 'run', spawned: ['a', 'b'], updatedAt: 42 });
  const get = (id: string) => (id === 'm1-t' ? busy : undefined);
  const l = subtopicLink({ subtopic: 'm1-t' }, get, f => f.updatedAt > 10);
  assert.deepEqual([l?.unread, l?.working, l?.threads, l?.at], [true, true, 2, 42]);
  // read, idle, no thread: nothing but the name and the time
  const calm = subtopicLink({ subtopic: 'm1-t' }, () => topic({ id: 'm1-t', state: 'you', updatedAt: 5 }), f => f.updatedAt > 10);
  assert.deepEqual([calm?.unread, calm?.working, calm?.threads, calm?.at], [false, false, 0, 5]);
  // unread rule never asked about a topic not loaded yet
  let asked = 0;
  assert.equal(subtopicLink({ subtopic: 'zz' }, () => undefined, () => (asked++, true))?.unread, false);
  assert.equal(asked, 0);
});

test('topic card: last activity on the title line, unread only with a known time', () => {
  const yes = () => true, no = () => false;
  assert.deepEqual(topicActivity({ updatedAt: 5 }, yes), { at: 5, unread: true });
  assert.deepEqual(topicActivity({ updatedAt: 5 }, no), { at: 5, unread: false });
  assert.deepEqual(topicActivity({ updatedAt: 0 }, yes), { at: null, unread: false }); // not synced: nothing to show
  // the « → topic » link under a Bar message follows the same rule
  const f = topic({ id: 'm1-t', updatedAt: 9 });
  assert.deepEqual([subtopicLink({ subtopic: 'm1-t' }, () => f, yes)?.unread, subtopicLink({ subtopic: 'm1-t' }, () => f, yes)?.at], [true, 9]);
  // the card: a working topic keeps its dot, drops the time (its chip says « now », the title keeps the room)
  assert.deepEqual(topicCardWhen({ updatedAt: 5, state: 'run' }, yes), { at: null, unread: true });
  assert.deepEqual(topicCardWhen({ updatedAt: 5, state: 'run' }, no), { at: null, unread: false });
  assert.deepEqual(topicCardWhen({ updatedAt: 5, state: 'wait' }, yes), { at: 5, unread: true });
});

test('« Reply as topic »: the ack opens the topic while the user stays where he sent it from', () => {
  const lounge = { kind: 'lounge', id: 'e' };
  // Wide screen, a topic open in the right pane while replying from the feed (Blair, 10 nov.: it stayed put).
  assert.equal(subtopicOpens({ space: 'e', sel: 't1' }, lounge, 't1'), true);
  assert.equal(subtopicOpens({ space: 'e', sel: null }, lounge, null), true); // « All » feed, phone long press
  assert.equal(subtopicOpens({ space: 'e', sel: 'general-e' }, lounge, 'general-e'), true); // General's room
  // Meanwhile the user opened another conversation, another space's Lounge, or left the Lounge: stay there.
  assert.equal(subtopicOpens({ space: 'e', sel: null }, lounge, 't2'), false);
  assert.equal(subtopicOpens({ space: 'e', sel: 't1' }, lounge, null), false);
  assert.equal(subtopicOpens({ space: 'e', sel: null }, { kind: 'lounge', id: 'f' }, null), false);
  assert.equal(subtopicOpens({ space: 'e', sel: null }, { kind: 'now' }, null), false);
  // Sent from outside a Lounge: never jumps.
  assert.equal(subtopicOpens({ space: null, sel: null }, lounge, null), false);
});
