import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appletIn, valuesIn, runText, appletPrompt, canLaunch, emojiOk, APPLET_FILE_FIELDS_MAX } from '../../protocol/applets.ts';
import { appletForm, formState, fileKey } from '../src/applets.ts';
import type { Applet } from '../../protocol/applets.ts';

const A = { id: 'a1', by: 'blair', at: 1, version: 1, name: 'Devis', agent: 'gaston', instruction: 'Write it.', fields: [
  { id: 'client', label: 'Client', kind: 'text' as const, required: true as const },
  { id: 'lang', label: 'Language', kind: 'select' as const, options: ['FR', 'EN'] },
  { id: 'spec', label: 'Spec', kind: 'file' as const, required: true as const }] };

test('appletIn: trims, refuses unknown kinds, duplicates, a one-option list, too many file fields, control chars', () => {
  assert.deepEqual(appletIn({ name: ' Devis ', agent: 'gaston', instruction: ' Do it ', fields: [{ id: 'x', label: ' X ', kind: 'text', hint: '' }] }),
    { name: 'Devis', agent: 'gaston', instruction: 'Do it', fields: [{ id: 'x', label: 'X', kind: 'text' }] });
  const base = { name: 'D', agent: 'gaston', instruction: 'I' };
  for (const fields of [[], [{ id: 'x', label: 'X', kind: 'html' }], [{ id: 'x', label: 'X', kind: 'text' }, { id: 'x', label: 'Y', kind: 'text' }],
    [{ id: 'x', label: 'X', kind: 'select', options: ['a'] }], [{ id: 'x', label: 'X', kind: 'select', options: ['a', 'a'] }], [{ id: 'X', label: 'X', kind: 'text' }],
    [{ id: 'x', label: 'X', kind: 'text', options: ['a', 'b'] }], Array.from({ length: APPLET_FILE_FIELDS_MAX + 1 }, (_, i) => ({ id: `f${i}`, label: 'F', kind: 'file' }))])
    assert.equal(appletIn({ ...base, fields }), null, JSON.stringify(fields));
  assert.equal(appletIn({ ...base, name: 'a\u0007', fields: [{ id: 'x', label: 'X', kind: 'text' }] }), null);
  assert.equal(appletIn({ ...base, agent: 'Bad Agent', fields: [{ id: 'x', label: 'X', kind: 'text' }] }), null);
});

test('valuesIn / formState: required, options, file states; the run text and the prompt keep values as data', () => {
  const ok = (x: unknown) => typeof x === 'string' && x.length > 0;
  assert.deepEqual(valuesIn(A, { client: ' ACME ', lang: '' }, { spec: 'f1' }, ok), { values: { client: 'ACME' }, files: { spec: 'f1' } });
  assert.deepEqual(valuesIn(A, { client: 'ACME', lang: 'DE' }, { spec: 'f1' }, ok), { bad: 'lang' });
  assert.deepEqual(valuesIn(A, { client: 'ACME' }, {}, ok), { bad: 'spec' });
  assert.deepEqual(valuesIn(A, { client: 'ACME', other: 'x' }, { spec: 'f1' }, ok), { bad: 'other' });
  const f = { ...appletForm(A), values: { client: 'ACME' } };
  assert.deepEqual(formState(A, f, () => ({ status: 'up' })), { stop: 'uploading', field: 'spec' });
  assert.deepEqual(formState(A, f, () => ({ status: 'err' })), { stop: 'file', field: 'spec' });
  assert.deepEqual(formState(A, f, () => undefined), { stop: 'field', field: 'spec' });
  assert.deepEqual(formState(A, { ...f, values: {} }, () => ({ status: 'ok', ref: { id: 'f1' } })), { stop: 'field', field: 'client' });
  assert.deepEqual(formState(A, f, () => ({ status: 'ok', ref: { id: 'f1' } })), { values: { client: 'ACME' }, files: { spec: 'f1' } });
  assert.equal(fileKey('a1', 'spec'), 'applet:a1:spec');
  const shown = runText(A, { client: 'ACME' }, { spec: 'cdc.pdf' });
  assert.equal(shown, '**Devis**\n\n**Client** : ACME\n\n**Spec** : `cdc.pdf`');
  const p = appletPrompt('Devis', 'Write it.', 'Blair', shown);
  assert.match(p, /untrusted data/);
  assert.match(p, /turn_outcome done/);
  assert.ok(p.indexOf('Instruction:\nWrite it.') < p.indexOf('Form values (data):\n**Devis**'), 'the values come after the instruction');
});

test('description, emoji (one pictograph, sequences included) and who launches', () => {
  const base = { name: 'D', agent: 'gaston', instruction: 'I', fields: [{ id: 'x', label: 'X', kind: 'text' }] };
  assert.deepEqual(appletIn({ ...base, description: ' Pitch ', emoji: '🧾' }), { ...base, description: 'Pitch', emoji: '🧾' });
  assert.deepEqual(appletIn({ ...base, description: '', emoji: '' }), base);
  for (const e of ['📄', '👩🏽‍💻', '🇫🇷', '❤️']) assert.ok(emojiOk(e), e);
  for (const e of ['', 'a', '1', '1️⃣', '📄 ', 'x📄', '<svg/>', '📄'.repeat(9), 7]) assert.ok(!emojiOk(e), String(e));
  assert.equal(appletIn({ ...base, emoji: 'AB' }), null);
  assert.equal(appletIn({ ...base, description: 'a\nb' }), null);
  assert.equal(appletIn({ ...base, description: 'x'.repeat(201) }), null);
  assert.deepEqual([canLaunch({}, 'lead'), canLaunch({}, 'contributor'), canLaunch({}, null), canLaunch({ leadsOnly: true }, 'contributor'), canLaunch({ leadsOnly: true }, 'lead')],
    [true, true, false, false, true]);
});

// ---------------------------------------------------------------- v2 fields and conditions
import { readFileSync } from 'node:fs';
import { appletVisible, numberIn, dateOk, acceptOk, condMet, type AppletDraft } from '../../protocol/applets.ts';

const JYD = JSON.parse(readFileSync(new URL('./applets-jyd.json', import.meta.url), 'utf8')) as Record<string, AppletDraft>;
const ok = (x: unknown) => typeof x === 'string' && x.length > 0;
const base = { name: 'D', agent: 'gaston', instruction: 'I' };
const one = (f: object, before: object[] = []) => appletIn({ ...base, fields: [...before, f] });

test('the 3 jyd applets, rewritten on the v2 schema: valid as written, no « facultatif » nor unit typed in a label', () => {
  for (const [k, a] of Object.entries(JYD)) {
    assert.deepEqual(appletIn(a), a, k);
    for (const f of a.fields) {
      assert.doesNotMatch(f.label, /facultatif|optional|\((m|A|bar|mm²|m³\/h|PDF)\)/i, `${k}.${f.id}: ${f.label}`);
      assert.doesNotMatch(f.hint ?? '', /séparées par des ;|psi et plus|psi au plus/, `${k}.${f.id}: the hint no longer works around the schema`);
    }
  }
});

test('numberIn: comma or point, spaces as thousands; junk refused', () => {
  assert.deepEqual(['52,8', '52.8', ' 1 000 ', '-3', '+0,5', '7'].map(numberIn), [52.8, 52.8, 1000, -3, 0.5, 7]);
  for (const s of ['', '1,2,3', '1e3', '0x10', 'abc', '52,8 m', ',5', '5,']) assert.equal(numberIn(s), null, s);
  assert.ok(dateOk('2026-02-28') && dateOk('2028-02-29'));
  for (const s of ['2026-02-30', '2026-13-01', '26-01-01', '2026-1-1', '']) assert.ok(!dateOk(s), s);
  assert.ok(acceptOk(['pdf'], 'Devis.PDF') && acceptOk(['image', 'pdf'], 'a.b.jpeg') && acceptOk(undefined, 'x'));
  assert.ok(!acceptOk(['pdf'], 'devis.pdf.exe') && !acceptOk(['word'], 'modele') && !acceptOk(['image'], 'x.svg'));
});

test('appletIn v2: each key only on its kinds; conditions only on an earlier field, with existing options', () => {
  const sel = { id: 's', label: 'S', kind: 'select', options: ['a', 'b'] };
  for (const [f, before] of [
    [{ id: 'x', label: 'X', kind: 'text', min: 1 }, []],                         // min on a text
    [{ id: 'x', label: 'X', kind: 'number', min: 5, max: 1 }, []],               // min > max
    [{ id: 'x', label: 'X', kind: 'number', min: 'a' }, []],
    [{ id: 'x', label: 'X', kind: 'select', options: ['a', 'b'], unit: 'm' }, []],
    [{ id: 'x', label: 'X', kind: 'text', of: 'number' }, []],
    [{ id: 'x', label: 'X', kind: 'list', of: 'date' }, []],
    [{ id: 'x', label: 'X', kind: 'file', accept: ['exe'] }, []],
    [{ id: 'x', label: 'X', kind: 'text', accept: ['pdf'] }, []],
    [{ id: 'x', label: 'X', kind: 'text', showIf: { field: 'later', filled: true } }, []], // unknown / later field
    [{ id: 'x', label: 'X', kind: 'text', showIf: { field: 'x', filled: true } }, []],     // itself
    [{ id: 'x', label: 'X', kind: 'text', showIf: { field: 's', equals: 'c' } }, [sel]],   // not an option
    [{ id: 'x', label: 'X', kind: 'text', showIf: { field: 's', equals: 'a', filled: true } }, [sel]], // two tests
    [{ id: 'x', label: 'X', kind: 'text', showIf: { field: 'n', equals: '2' } }, [{ id: 'n', label: 'N', kind: 'number' }]], // equals on a number
    [{ id: 'x', label: 'X', kind: 'text', showIf: { field: 's', in: [] } }, [sel]],
    [{ id: 'x', label: 'X', kind: 'select', options: ['a', { label: 'a', showIf: { field: 's', equals: 'a' } }] }, [sel]], // duplicate label
    [{ id: 'x', label: 'X', kind: 'select', options: ['a', { label: 'b' }] }, [sel]],      // option object without condition
    [{ id: 'x', label: 'X', kind: 'checkbox', required: 'yes' }, []],
  ] as [object, object[]][]) assert.equal(one(f, before), null, JSON.stringify(f));
  assert.deepEqual(one({ id: 'x', label: 'X', kind: 'number', unit: ' m ', min: 0, max: 10, integer: true, placeholder: '' }),
    { ...base, fields: [{ id: 'x', label: 'X', kind: 'number', unit: 'm', min: 0, max: 10, integer: true }] });
  assert.deepEqual(one({ id: 'x', label: 'X', kind: 'text', showIf: { field: 's', in: [' a ', 'b'] } }, [sel])!.fields[1].showIf, { field: 's', in: ['a', 'b'] });
  assert.equal(appletIn({ ...base, fields: Array.from({ length: 25 }, (_, i) => ({ id: `f${i}`, label: 'F', kind: 'text' })) }), null);
});

test('appletVisible: fields and options by condition, in chain (a hidden field counts as empty after it)', () => {
  const B = JYD.busage;
  let v = appletVisible(B.fields, {});
  assert.ok(v.shown.has('longueur') && !v.shown.has('longueurs') && !v.shown.has('moteur'));
  assert.deepEqual(v.options.get('regulateur'), []); // no sprinkler yet: no pressure offered
  v = appletVisible(B.fields, { inegales: true, arroseur: 'Nelson R3030 Rotator', roues: '14.9 x 24' });
  assert.ok(!v.shown.has('longueur') && v.shown.has('longueurs') && v.shown.has('moteur') && v.shown.has('reducteur'));
  assert.deepEqual(v.options.get('regulateur'), ['1,4 bar (20 psi)', '1,7 bar (25 psi)', '2,1 bar (30 psi)', '2,8 bar (40 psi)']);
  assert.deepEqual(appletVisible(B.fields, { arroseur: 'Nelson A3030 Accelerator' }).options.get('regulateur'), ['0,4 bar (6 psi)', '0,7 bar (10 psi)', '1,0 bar (15 psi)']);
  assert.equal(appletVisible(B.fields, { arroseur: 'Komet KPT' }).options.get('regulateur')!.length, 7);
  // a file counts as filled; a chain: c shows if b shows and is filled, b shows if a = yes
  assert.ok(appletVisible(JYD.memoire.fields, {}, { carte: 'f1' }).shown.has('parcelles'));
  assert.ok(!appletVisible(JYD.memoire.fields, {}).shown.has('parcelles'));
  const chain = [{ id: 'a', label: 'A', kind: 'select' as const, options: ['yes', 'no'] }, { id: 'b', label: 'B', kind: 'text' as const, showIf: { field: 'a', equals: 'yes' } },
    { id: 'c', label: 'C', kind: 'text' as const, showIf: { field: 'b', filled: true } }];
  assert.ok(appletVisible(chain, { a: 'yes', b: 'x' }).shown.has('c'));
  assert.ok(!appletVisible(chain, { a: 'no', b: 'x' }).shown.has('c'), 'b hidden: its leftover value does not show c');
  assert.ok(condMet({ field: 'm', in: ['x'] }, ['y', 'x']) && !condMet({ field: 'm', equals: 'x' }, []) && condMet({ field: 'm', filled: false }, ['', ' ']));
});

test('valuesIn v2: hidden fields ignored, required only if shown, numbers / dates / lists / multiselect / checkbox checked', () => {
  const B = JYD.busage;
  const full = { travees: '3', longueur: '52,8', sorties: '1,5', ecart: ['4,5'], arroseur: 'Nelson R3030 Rotator', regulateur: '1,4 bar (20 psi)', debit: '120', pression: '2,1' };
  assert.deepEqual(valuesIn(B, full, {}, ok), { values: full, files: {} });
  // unequal spans: longueur is hidden, so its required no longer counts and its stale value is dropped
  assert.deepEqual(valuesIn(B, { ...full, inegales: true }, {}, ok), { bad: 'longueurs' });
  const r = valuesIn(B, { ...full, inegales: true, longueurs: ['52,8', ' ', '40'] }, {}, ok);
  assert.ok(!('bad' in r) && !('longueur' in r.values) && r.values.inegales === true);
  assert.deepEqual(!('bad' in r) && r.values.longueurs, ['52,8', '40']);
  assert.equal(runText(B, (r as any).values, {}).includes('**Longueur de chaque travée** : 52,8 ; 40 m'), true);
  // a pressure the chosen sprinkler does not take: counts as empty, so the required select stops the launch
  assert.deepEqual(valuesIn(B, { ...full, regulateur: '0,7 bar (10 psi)' }, {}, ok), { bad: 'regulateur' });
  assert.deepEqual(valuesIn(B, { ...full, regulateur: '9 bar' }, {}, ok), { bad: 'regulateur' });
  for (const [k, x] of [['travees', '2,5'], ['travees', '0'], ['travees', '31'], ['debit', 'beaucoup'], ['ecart', ['4,5', 'x']], ['ecart', '4,5'],
    ['inegales', 'true'], ['longueur', ['52']], ['ecart', Array(31).fill('1')]] as [string, unknown][])
    assert.deepEqual(valuesIn(B, { ...full, [k]: x }, {}, ok), { bad: k }, `${k}=${JSON.stringify(x)}`);
  assert.deepEqual(valuesIn(B, { ...full, inegales: false }, {}, ok), { values: full, files: {} }, 'an unticked box is left out');
  // dates, multiselect, a file field hidden by its condition (its file id is ignored, not refused)
  const D = { fields: [{ id: 'd', label: 'D', kind: 'date' as const, required: true as const }, { id: 'm', label: 'M', kind: 'multiselect' as const, options: ['x', 'y', 'z'] },
    { id: 'f', label: 'F', kind: 'file' as const, showIf: { field: 'm', in: ['z'] } }] };
  assert.deepEqual(valuesIn(D, { d: '2026-11-16', m: ['y', 'x'] }, { f: 'up1' }, ok), { values: { d: '2026-11-16', m: ['y', 'x'] }, files: {} });
  assert.deepEqual(valuesIn(D, { d: '2026-11-16', m: ['z'] }, { f: 'up1' }, ok), { values: { d: '2026-11-16', m: ['z'] }, files: { f: 'up1' } });
  assert.deepEqual(valuesIn(D, { d: '16/11/2026' }, {}, ok), { bad: 'd' });
  assert.deepEqual(valuesIn(D, { d: '2026-11-16', m: ['w'] }, {}, ok), { bad: 'm' });
  assert.deepEqual(valuesIn(D, { d: '2026-11-16', m: ['x', 'x'] }, {}, ok), { bad: 'm' });
  assert.deepEqual(valuesIn(D, { d: '2026-11-16', f: 'up1' }, {}, ok), { bad: 'f' }, 'a file id never in values');
  // old applets (v1 schema) keep working as they are
  assert.deepEqual(valuesIn(A, { client: 'ACME', lang: 'FR' }, { spec: 'f1' }, ok), { values: { client: 'ACME', lang: 'FR' }, files: { spec: 'f1' } });
});

test('formState v2: only shown fields go out, a file of the wrong type stops the launch', () => {
  const M = { ...JYD.memoire, id: 'm1', by: 'b', at: 1, version: 1 } as Applet;
  const files: Record<string, any> = { devis: { status: 'ok', ref: { id: 'u1' }, name: 'devis.pdf' } };
  const f = { id: 'm1', values: { parcelles: 'nord' } as Record<string, any>, step: 0 };
  assert.deepEqual(formState(M, f, id => files[id]), { values: {}, files: { devis: 'u1' } }, 'parcelles hidden without a map: kept in the form, not sent');
  files.carte = { status: 'ok', ref: { id: 'u2' }, name: 'carte.jpg' };
  assert.deepEqual(formState(M, f, id => files[id]), { values: { parcelles: 'nord' }, files: { devis: 'u1', carte: 'u2' } });
  files.devis = { status: 'ok', ref: { id: 'u1' }, name: 'devis.docx' };
  assert.deepEqual(formState(M, f, id => files[id]), { stop: 'type', field: 'devis' });
});

// ---------------------------------------------------------------- v2 form in steps
import { stepsShown, stepStop, stepNext, stepPrev } from '../src/applets.ts';

const PIVOT = ['travees', 'inegales', 'longueur', 'longueurs', 'sorties', 'ecart', 'porte_a_faux'];
const ARROSAGE = ['arroseur', 'regulateur', 'debit', 'canon', 'pression', 'nom', 'roues'];
/** The busage applet in 4 steps: « Motorisation » only has fields shown once a wheel type is picked. */
const STEPS = [{ title: ' Pivot ', fields: PIVOT }, { title: 'Arrosage', fields: ARROSAGE }, { title: 'Motorisation', fields: ['moteur', 'reducteur'] }, { title: 'Notes', fields: ['autres'] }];
const BS = { ...JYD.busage, steps: STEPS.map(s => ({ ...s, title: s.title.trim() })), id: 'b1', by: 'b', at: 1, version: 1 } as Applet;
const PIVOT_OK = { travees: '3', longueur: '52,8', sorties: '1,5', ecart: ['4,5'] };
const ARROSAGE_OK = { arroseur: 'Nelson R3030 Rotator', regulateur: '1,4 bar (20 psi)', debit: '120', pression: '2,1' };
const none = () => undefined;

test('appletIn steps: 2 to 8 titled steps covering every field once, in the order of the fields; else refused', () => {
  const B = JYD.busage;
  assert.deepEqual(appletIn({ ...B, steps: STEPS })!.steps, BS.steps, 'titles trimmed');
  assert.equal(appletIn(B)!.steps, undefined, 'no steps: one page, as before');
  const all = B.fields.map(f => f.id);
  for (const steps of [
    [{ title: 'A', fields: all.slice(0, 5) }, { title: 'B', fields: [...all.slice(5), 'inconnu'] }],   // an unknown field
    [{ title: 'A', fields: all.slice(0, 5) }, { title: 'B', fields: all.slice(6) }],                   // a field left out
    [{ title: 'A', fields: all.slice(0, 6) }, { title: 'B', fields: all.slice(5) }],                   // a field cited twice
    [{ title: 'A', fields: all.slice(5) }, { title: 'B', fields: all.slice(0, 5) }],                   // another order
    [{ title: 'A', fields: all }],                                                                     // one step
    Array.from({ length: 9 }, (_, i) => ({ title: `S${i}`, fields: i < 8 ? [all[i]] : all.slice(8) })), // 9 steps
    [{ title: 'A', fields: [] }, { title: 'B', fields: all }],
    [{ title: '', fields: all.slice(0, 5) }, { title: 'B', fields: all.slice(5) }],
    [{ title: 'A\nB', fields: all.slice(0, 5) }, { title: 'B', fields: all.slice(5) }],
    [{ title: 'A', fields: all.slice(0, 5), hint: 'x' }, { title: 'B', fields: all.slice(5) }],         // a stray key
    [{ title: 'A', fields: all.slice(0, 5) }, 'B'],
    'Pivot, Arrosage',
  ] as unknown[]) assert.equal(appletIn({ ...B, steps }), null, JSON.stringify(steps).slice(0, 120));
});

test('steps: Next checks the step (and those before), not the steps after; Back and Next walk the shown steps', () => {
  let f = { ...appletForm(BS) };
  assert.equal(f.step, 0);
  assert.deepEqual(stepNext(BS, f, none), { stop: 'field', field: 'travees' }, 'a required field of the step is empty');
  assert.equal(stepPrev(BS, f, none), null, 'nothing before the first step');
  f = { ...f, values: { ...PIVOT_OK, inegales: true } };
  assert.deepEqual(stepStop(BS, f, none), { stop: 'field', field: 'longueurs' }, 'the ticked box swapped the length for a list');
  f = { ...f, values: { ...f.values, longueurs: ['52,8', '40'], debit: 'beaucoup' } };
  assert.equal(stepStop(BS, f, none), null, 'a bad value of a later step does not stop this one');
  const s1 = stepNext(BS, f, none) as typeof f;
  assert.equal(s1.step, 1);
  assert.deepEqual(stepNext(BS, s1, none), { stop: 'field', field: 'arroseur' });
  assert.equal(stepPrev(BS, s1, none)!.step, 0);
  // the faulty step back: Next refuses again (a value of an earlier step changed while back there)
  assert.deepEqual(stepStop(BS, { ...s1, values: { ...s1.values, travees: '0' } }, none), { stop: 'field', field: 'travees' });
  const s1ok = { ...s1, values: { ...s1.values, ...ARROSAGE_OK } };
  // no wheel type: « Motorisation » has no shown field, Next skips it, Back skips it too
  assert.deepEqual(stepsShown(BS, s1ok, none), [0, 1, 3]);
  const s3 = stepNext(BS, s1ok, none) as typeof f;
  assert.equal(s3.step, 3);
  assert.equal(stepPrev(BS, s3, none)!.step, 1);
  const sum = stepNext(BS, s3, none) as typeof f;
  assert.equal(sum.step, 4, 'after the last step: the summary');
  assert.equal(stepPrev(BS, sum, none)!.step, 3, 'Back from the summary: the last shown step');
  // a wheel type picked: the step shows, and its fields are checked like any other
  const w = { ...s1ok, values: { ...s1ok.values, roues: '14.9 x 24' } };
  assert.deepEqual(stepsShown(BS, w, none), [0, 1, 2, 3]);
  assert.equal((stepNext(BS, w, none) as typeof f).step, 2);
  assert.equal(stepPrev(BS, { ...w, step: 3 }, none)!.step, 2);
  // the summary launches the whole form: what goes out is what formState gives, hidden fields left out
  const out = formState(BS, sum, none);
  assert.ok('values' in out && !('longueur' in out.values) && out.values.debit === '120', JSON.stringify(out));
});

test('steps: a file still uploading or of the wrong type stops its step', () => {
  const M = { ...JYD.memoire, steps: [{ title: 'Devis', fields: ['devis', 'devis_aquadoc'] }, { title: 'Terrain', fields: ['carte', 'parcelles', 'remarques', 'modele'] }], id: 'm1', by: 'b', at: 1, version: 1 } as Applet;
  const files: Record<string, any> = { devis: { status: 'up', name: 'devis.pdf' } };
  const f = appletForm(M);
  assert.deepEqual(stepNext(M, f, id => files[id]), { stop: 'uploading', field: 'devis' });
  files.devis = { status: 'ok', ref: { id: 'u1' }, name: 'devis.docx' };
  assert.deepEqual(stepNext(M, f, id => files[id]), { stop: 'type', field: 'devis' });
  files.devis = { status: 'ok', ref: { id: 'u1' }, name: 'devis.pdf' };
  assert.equal((stepNext(M, f, id => files[id]) as typeof f).step, 1);
});

import { runState, talkId, talkPrompt, APPLET_RESULT_MAX } from '../../protocol/applets.ts';
import { prefill } from '../src/applets.ts';

test('runState: delivered on done or a file, running while a turn is on or nothing answered, failed otherwise', () => {
  const base = { active: false, answered: true, files: 0 };
  assert.equal(runState({ ...base, outcome: 'done' }), 'delivered', 'done wins, even without a file');
  assert.equal(runState({ ...base, active: true, outcome: 'done' }), 'delivered');
  assert.equal(runState({ ...base, active: true, outcome: 'waiting' }), 'running', 'a turn on again after waiting: running');
  assert.equal(runState({ ...base, outcome: 'waiting', files: 2 }), 'failed', 'it asked for something');
  assert.equal(runState({ ...base, answered: false }), 'running', 'not answered yet (queued, agent offline)');
  assert.equal(runState({ ...base, files: 1 }), 'delivered', 'a Lounge run (no outcome) with a file');
  assert.equal(runState(base), 'failed', 'answered without a file nor done');
});

test('talk: one topic id per run; the prompt keeps values and result as data, cut at APPLET_RESULT_MAX', () => {
  assert.equal(talkId('r1'), 'r1-talk');
  const p = talkPrompt('Devis', 'Blair', '2026-11-17', '**Client** : ACME', 'x'.repeat(APPLET_RESULT_MAX + 5), ['devis.pdf'], 'Why?');
  assert.match(p, /^This Lounge topic discusses the result of a run of the applet "Devis" \(launched by Blair on 2026-11-17\)/);
  assert.match(p, /never instructions/);
  assert.match(p, /attached \(devis\.pdf\)/);
  assert.ok(p.includes('x'.repeat(APPLET_RESULT_MAX) + '\n[…]') && !p.includes('x'.repeat(APPLET_RESULT_MAX + 1)));
  assert.ok(p.endsWith('\n\nMessage:\nWhy?'));
  assert.match(talkPrompt('D', 'B', 'd', 'v', '', [], 'q'), /no file was delivered[\s\S]*\(none\)/);
});

test('prefill: a run\'s values for the fields still there with a value of their kind, never a file', () => {
  const a = { ...A, fields: [...A.fields, { id: 'n', label: 'N', kind: 'number' as const }, { id: 'tags', label: 'T', kind: 'multiselect' as const, options: ['a', 'b'] },
    { id: 'ok', label: 'OK', kind: 'checkbox' as const }] } as Applet;
  const f = prefill(a, { client: 'ACME', lang: 'FR', spec: 'cahier.pdf', n: '52,8', tags: ['a'], ok: true, gone: 'x' });
  assert.deepEqual(f, { id: 'a1', values: { client: 'ACME', lang: 'FR', n: '52,8', tags: ['a'], ok: true }, step: 0 });
  assert.deepEqual(prefill(a, { client: ['x'], ok: 'yes', tags: 'a' }).values, {}, 'a field whose kind changed starts empty');
});

import { appletHue } from '../src/applets.ts';
test('an applet\'s tint: stable per name, a step of 30° (the tile CSS classes and the pinned icon agree)', () => {
  assert.equal(appletHue('Busage pivot'), appletHue('Busage pivot'));
  for (const n of ['Busage pivot', 'Chute de tension', '', '💧 é']) { const x = appletHue(n); assert.ok(x % 30 === 0 && x >= 0 && x < 360, `${n}: ${x}`); }
});

import { placeholderShown } from '../src/applets.ts';
test('a bare placeholder (number, short value) shows as an example; a sentence or one already « ex. » stays as written', () => {
  for (const [p, want] of [['50', 'ex. 50'], ['52,8', 'ex. 52,8'], ['39/44', 'ex. 39/44'], ['52:1', 'ex. 52:1'], [' 7 ', 'ex. 7'],
    ['parcelle 1 au nord du chemin, parcelle 4 au sud', 'parcelle 1 au nord du chemin, parcelle 4 au sud'],
    ['ex. 50', 'ex. 50'], ['Ex : 50', 'Ex : 50'], ['ex.50', 'ex.50'], ['e.g. 50', 'e.g. 50'], ['', ''], [undefined, undefined]] as const)
    assert.equal(placeholderShown(p, 'ex.'), want, String(p));
  // the 3 jyd applets: every bare placeholder gets it, the stored schema is not touched
  const before = JSON.stringify(JYD);
  for (const a of Object.values(JYD)) for (const f of a.fields) if (f.placeholder && !/\s/.test(f.placeholder)) assert.match(placeholderShown(f.placeholder, 'ex.')!, /^ex\. /);
  assert.equal(JSON.stringify(JYD), before);
});
