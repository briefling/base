import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openedFrom, stepKind } from '../src/nextsteps.ts';
import type { Person } from '../../protocol/frames.ts';

const PEOPLE: Person[] = [
  { id: 'blair', name: 'Blair Dalton', kind: 'human' },
  { id: 'paulo', name: 'Paulo', kind: 'human' },
  { id: 'lulu', name: 'lulu', kind: 'agent' },
  { id: 'gone', name: 'Ancien', kind: 'human', gone: true },
  { id: 'sam', name: 'Sam', kind: 'human' }, { id: 'sam-bot', name: 'Sam', kind: 'agent' },
];

test('stepKind: an agent by its name or « Agent », a human by name or first name; accents and case ignored', () => {
  for (const w of ['Agent', "l'agent", 'L’agent', 'the agent', 'Lulu', ' LULU ']) assert.equal(stepKind(w, PEOPLE), 'agent', w);
  for (const w of ['Paulo', 'paulo', 'Blair', 'Blair Dalton', 'blair', 'Päulo']) assert.equal(stepKind(w, PEOPLE), 'human', w);
});

test('stepKind: nobody, several people, a homonym or someone gone -> no button (null)', () => {
  for (const w of ['', '  ', 'Félix', 'Blair et l\'agent', 'Toi, le 14/11', 'Sam', 'Ancien']) assert.equal(stepKind(w, PEOPLE), null, w);
});

test('openedFrom: the thread opened from the exact line, none for another text or an old thread', () => {
  const f = { nextOpened: [{ what: 'Prepare the QGIS file', thread: 't1' }] };
  assert.equal(openedFrom(f, 'Prepare the QGIS file'), 't1');
  assert.equal(openedFrom(f, 'Prepare the QGIS file.'), undefined);
  assert.equal(openedFrom({}, 'x'), undefined);
});
