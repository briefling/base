import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repoOutsideOrgs, repoList, identityList, slug, formOf, newForm, setName, setRole, setNontech, roleOf, setAgent, setDefault, setMode, setMax, addResource, setResource, removeResource, resourceOf, formError, payload, changed, changes, CHANGE_TAB, isSpTab, SP_TABS, setAgentRole, setAgentAvatar, setModule, setPreset, viewOn, tabsOn } from '../src/spaces.ts';
import { MODULES, OPT_IN, PRESETS, validModules, modulesOn, modulesOffOf, modulesInOf, modulesSet, moduleOn, presetOf } from '../../protocol/modules.ts';
import { squareOf, pickable } from '../src/avatar.ts';
import { MAX_PARALLEL, MAX_RESOURCES, normEmail } from '../../protocol/frames.ts';
import type { SpaceSettings } from '../../protocol/frames.ts';

const saved: SpaceSettings = { id: 'hestia', name: 'Hestia', about: 'Meters', members: ['blair', 'joachim'], trusted: ['blair'], contributors: [], nontech: [], admins: [], agents: ['milan'], defaultAgent: 'milan',
  parallel: { mode: 'strict', max: 1, resources: [] }, version: 2, agentRoles: {}, driver: 'briefling', identities: [], board: false, repos: [], repoOrgs: [], ci: false, memory: 'auto', memoryAgent: 'milan', memoryHidden: false,
  memoryBatch: { n: 10, minutes: 60 }, memoryCompact: { n: 100, words: 3000 }, tagMax: 15, relayMax: 6, modules: [...MODULES] };

test('id derived from the name: accents, spaces and punctuation, 32 characters', () => {
  assert.equal(slug('Hestia (compteurs)'), 'hestia-compteurs');
  assert.equal(slug('  --Manta  HydroControl!! '), 'manta-hydrocontrol');
  assert.equal(slug('a'.repeat(31) + ' b c'), 'a'.repeat(31));
  assert.equal(slug('???'), '');
});

test('new space: the admin is a trusted member, id follows the name until typed by hand', () => {
  let f = newForm('blair', ['milan']);
  assert.deepEqual([f.members, f.trusted, f.agents, f.defaultAgent], [['blair'], ['blair'], ['milan'], 'milan']);
  assert.deepEqual(newForm('blair', ['milan', 'testbot']).agents, []);
  f = setName(f, 'Hestia');
  assert.equal(f.id, 'hestia');
  f = setName({ ...f, id: 'my-id', idTouched: true }, 'Other');
  assert.equal(f.id, 'my-id');
  // edit: the id never moves
  assert.equal(setName(formOf(saved), 'New name').id, 'hestia');
});

test('roles: one per person, any role makes a member, none removes every role, list order kept', () => {
  let f = formOf(saved);
  assert.deepEqual(['blair', 'joachim', 'mallory'].map(x => roleOf(f, x)), ['lead', 'member', 'none']);
  f = setRole(f, 'mallory', 'lead');
  assert.deepEqual([f.members, f.trusted, f.contributors], [['blair', 'joachim', 'mallory'], ['blair', 'mallory'], []]);
  f = setRole(f, 'joachim', 'contributor');
  assert.deepEqual([f.members, f.trusted, f.contributors, roleOf(f, 'joachim')], [['blair', 'joachim', 'mallory'], ['blair', 'mallory'], ['joachim'], 'contributor']);
  f = setRole(f, 'joachim', 'lead'); // contributor -> lead: never both
  assert.deepEqual([f.trusted, f.contributors], [['blair', 'mallory', 'joachim'], []]);
  f = setRole(f, 'mallory', 'member');
  assert.deepEqual([f.members, f.trusted, roleOf(f, 'mallory')], [['blair', 'joachim', 'mallory'], ['blair', 'joachim'], 'member']);
  f = setRole(setRole(f, 'blair', 'contributor'), 'blair', 'none');
  assert.deepEqual([f.members, f.trusted, f.contributors], [['joachim', 'mallory'], ['joachim'], []]);
});

test('agents: the agent in charge is always an agent of the space', () => {
  let f = formOf(saved);
  f = setAgent(f, 'testbot', true);
  assert.equal(f.defaultAgent, 'milan');
  f = setAgent(f, 'milan', false);
  assert.deepEqual([f.agents, f.defaultAgent], [['testbot'], 'testbot']);
  f = setAgent(f, 'testbot', false);
  assert.deepEqual([f.agents, f.defaultAgent], [[], '']);
  f = setDefault(f, 'milan');
  assert.deepEqual([f.agents, f.defaultAgent], [['milan'], 'milan']);
});

test('input errors before sending (default language: English)', () => {
  const f = setName(newForm('blair', ['milan']), 'Hestia');
  assert.equal(formError(f), null);
  assert.match(formError({ ...f, name: ' ' })!, /name/);
  assert.match(formError({ ...f, id: 'now' })!, /Invalid id/);
  assert.match(formError({ ...f, id: 'Bad id' })!, /Invalid id/);
  assert.equal(formError({ ...formOf(saved), id: 'old_id' }), null); // id of an existing space: never checked again
  assert.match(formError({ ...f, members: [], trusted: [] })!, /member/);
  assert.match(formError(setAgent(f, 'milan', false))!, /agent in charge/);
});

test('frame sent and change detection', () => {
  const f = setRole(formOf(saved), 'joachim', 'none');
  assert.deepEqual(payload({ ...f, name: ' Hestia ', trusted: ['blair', 'ghost'], contributors: ['ghost', 'blair'] }, 'c1'), { type: 'space.save', client_id: 'c1', space: 'hestia', version: 2,
    name: 'Hestia', about: 'Meters', members: ['blair'], trusted: ['blair'], contributors: [], nontech: [], admins: [], modules: [...MODULES], agents: ['milan'], defaultAgent: 'milan',
    parallel: { mode: 'strict', max: 1, resources: [], rules: {} }, agentRoles: {}, driver: 'briefling', identities: [], repos: [], repoOrgs: [], ci: false, memory: 'auto', memoryAgent: 'milan', memoryHidden: false,
    memoryBatch: { n: 10, minutes: 60 }, memoryCompact: { n: 100, words: 3000 }, tagMax: 15, relayMax: 6 });
  assert.equal(changed(formOf(saved), saved), false);
  assert.equal(changed({ ...formOf(saved), members: ['joachim', 'blair'] }, saved), false);
  assert.equal(changed(f, saved), true);
  assert.deepEqual(changes(setRole(formOf(saved), 'joachim', 'contributor'), saved), ['trusted'], 'a contributor is a role change');
});

test('parallel work: new space and old space without the setting read as strict, no resource', () => {
  const f = newForm('blair', ['milan']);
  assert.deepEqual([f.mode, f.max, f.resources], ['strict', 1, []]);
  const { parallel: _, ...old } = saved;
  assert.deepEqual([formOf(old as typeof saved).mode, formOf(old as typeof saved).max], ['strict', 1]);
  // resources saved before typed rules: read as is, the rule left empty for the admin to fill
  const coop = formOf({ ...saved, parallel: { mode: 'cooperative', max: 3, resources: ['stack:briefling-dev', 'emulator'], rules: { 'stack:briefling-dev': 'Before deploy.' } } });
  assert.deepEqual([coop.mode, coop.max, coop.resources], ['cooperative', 3,
    [{ type: 'stack', name: 'briefling-dev', rule: 'Before deploy.' }, { type: 'emulator', name: '', rule: '' }]]);
});

test('parallel work: strict forces one thread, cooperative starts at 2 and keeps a valid max', () => {
  let f = setMode(formOf(saved), 'cooperative');
  assert.equal(f.max, 2);
  f = setMax(f, 4);
  assert.equal(setMode(f, 'cooperative').max, 4);
  f = setMode(f, 'strict');
  assert.equal(f.max, 1);
  assert.equal(setMax(f, 4).max, 1); // strict: the field is ignored
  assert.equal(setMode(setMax({ ...f, mode: 'cooperative' }, 99), 'cooperative').max, 2); // out of range: back to 2
});

test('parallel work: form errors on max and resources', () => {
  const f = setMode(formOf(saved), 'cooperative');
  const row = (type: string, name: string, rule = 'Take before use, release after.') => ({ type, name, rule });
  assert.equal(formError(f), null);
  for (const bad of [1, MAX_PARALLEL + 1, 2.5, NaN]) assert.match(formError(setMax(f, bad))!, /Max threads per agent: a whole number from 2 to 5/, String(bad));
  assert.equal(formError(setMax(f, MAX_PARALLEL)), null);
  assert.equal(formError({ ...f, resources: [row('stack', ' briefling-dev '), row('emulator', ''), row('gateway', '')] }), null);
  assert.match(formError({ ...f, resources: [row('emulator', ''), row('stack', 'Dev')] })!, /Invalid resource stack:Dev/);
  assert.match(formError({ ...f, resources: [row('stack', 'my resource')] })!, /Invalid resource stack:my resource/);
  assert.match(formError({ ...f, resources: [row('db', 'main')] })!, /Resource db:main: pick a type among stack, release, emulator, gateway/, 'old free-form type');
  assert.match(formError({ ...f, resources: [row('stack', 'prod', '  ')] })!, /Resource stack:prod: write when to take it and when to release it/);
  assert.match(formError({ ...f, resources: [row('stack', 'prod', 'x'.repeat(201))] })!, /200 characters at most/);
  assert.match(formError({ ...f, resources: [row('emulator', ''), row('emulator', ' ')] })!, /Resource emulator is listed twice/);
  const many = Array.from({ length: MAX_RESOURCES + 1 }, (_, i) => row('stack', `r${i}`));
  assert.match(formError({ ...f, resources: many })!, /10 resources maximum/);
  // strict: max never blocks, resources are still checked (they apply in both modes)
  assert.equal(formError({ ...formOf(saved), max: NaN }), null);
  assert.match(formError({ ...formOf(saved), resources: [row('stack', 'a:')] })!, /Invalid resource stack:a:/);
});

test('parallel work: rows added, edited, removed; frame sent with one rule per resource; change detection', () => {
  let f = addResource(addResource(setMax(setMode(formOf(saved), 'cooperative'), 3)));
  assert.deepEqual(f.resources, [{ type: 'stack', name: '', rule: '' }, { type: 'stack', name: '', rule: '' }]);
  f = setResource(setResource(f, 0, { type: 'emulator', rule: ' Take before\nadb connect ' }), 1, { name: ' briefling-dev ', rule: 'Before deploy.' });
  f = removeResource(addResource(f), 2);
  assert.equal(resourceOf(f.resources[1]), 'stack:briefling-dev');
  assert.deepEqual(payload(f, 'c2').parallel, { mode: 'cooperative', max: 3, resources: ['emulator', 'stack:briefling-dev'],
    rules: { emulator: 'Take before adb connect', 'stack:briefling-dev': 'Before deploy.' } });
  assert.deepEqual(payload({ ...f, mode: 'strict' }, 'c3').parallel.max, 1);
  assert.equal(changed(f, saved), true);
  const coop = { ...saved, parallel: { mode: 'cooperative' as const, max: 3, resources: ['emulator', 'stack:briefling-dev'],
    rules: { emulator: 'Take before adb connect', 'stack:briefling-dev': 'Before deploy.' } } };
  assert.equal(changed(f, coop), false);
  assert.equal(changed(setMax(f, 4), coop), true);
  assert.equal(changed(setResource(f, 1, { rule: 'After tests.' }), coop), true, 'a rule edit is a change');
  assert.equal(changed(removeResource(f, 0), coop), true);
  // resources saved before rules: the form read back is not a change
  const legacy = { ...saved, parallel: { mode: 'strict' as const, max: 1, resources: ['gateway'] } };
  assert.equal(changed(formOf(legacy), legacy), false);
  assert.deepEqual(payload(formOf(saved), 'c4').parallel, { mode: 'strict', max: 1, resources: [], rules: {} });
  // old space without the setting: the default form is not a change
  const { parallel: _, ...old } = saved;
  assert.equal(changed(formOf(old as typeof saved), old as typeof saved), false);
});

test('invite address: canonical lower case, narrow on purpose (nothing that could leave a Cognito filter string)', () => {
  assert.equal(normEmail('  Jean.Dupont+loom@Uplift.DEV '), 'jean.dupont+loom@uplift.dev');
  assert.equal(normEmail("o'neil@x.co.uk"), "o'neil@x.co.uk");
  for (const bad of ['', 'x', 'a@b', '@x.fr', 'a@x.', 'a b@x.fr', 'a"b@x.fr', 'a\\b@x.fr', 'a@-x.fr', 'a@x..fr', '<a@x.fr>', `${'a'.repeat(65)}@x.fr`, 3, null])
    assert.equal(normEmail(bad), null, String(bad));
});

test('agents\' functions: cleaned and limited to the space\'s agents in the frame, change detection, error past 60', () => {
  const s: SpaceSettings = { ...saved, agents: ['milan', 'gaston'], agentRoles: { milan: 'Dev' } };
  let f = formOf(s);
  assert.equal(changed(f, s), false);
  f = setAgentRole(f, 'milan', '  Dev   senior ');
  assert.equal(changed(f, s), true);
  assert.equal(changed(setAgentRole(formOf(s), 'milan', ' Dev '), s), false); // spaces only: nothing to save
  f = setAgentRole(setAgentRole(f, 'gaston', ''), 'testbot', 'Not in the space');
  assert.deepEqual(payload(f, 'c').agentRoles, { milan: 'Dev senior' });
  assert.deepEqual(payload(setAgent(f, 'milan', false), 'c').agentRoles, {}); // agent removed: its function is not sent
  assert.equal(formError(f), null);
  assert.match(formError(setAgentRole(f, 'gaston', 'x'.repeat(61))) ?? '', /Gaston/);
  assert.match(formError(setAgentRole(f, 'gaston', 'a\u202eb')) ?? '', /Gaston/);
});

test('agents\' photos: only the changed ones sent, of the space\'s agents, named in the save bar; none = no field', () => {
  const s: SpaceSettings = { ...saved, agents: ['milan', 'gaston'] };
  let f = formOf(s);
  assert.equal('agentAvatars' in payload(f, 'c'), false); // nothing changed: the stored photos stay
  f = setAgentAvatar(setAgentAvatar(f, 'milan', 'data:image/webp;base64,UklGR'), 'testbot', 'data:image/webp;base64,UklGR');
  assert.deepEqual(payload(f, 'c').agentAvatars, { milan: 'data:image/webp;base64,UklGR' });
  assert.ok(changes(f, s).includes('agentAvatars'));
  assert.equal(CHANGE_TAB.agentAvatars, 'agents');
  assert.deepEqual(payload(setAgentAvatar(f, 'milan', ''), 'c').agentAvatars, { milan: '' }); // '' = removed
  assert.equal('agentAvatars' in payload(setAgent(f, 'milan', false), 'c'), false);
});

test('avatar: centred square crop, SVG never picked', () => {
  assert.deepEqual(squareOf(320, 200), { sx: 60, sy: 0, s: 200 });
  assert.deepEqual(squareOf(200, 300), { sx: 0, sy: 50, s: 200 });
  assert.deepEqual([pickable('image/png'), pickable('image/heic'), pickable('image/svg+xml'), pickable('text/html'), pickable('')], [true, true, false, false, false]);
});

test('Driver: the external board needs a Project; identities typed one per line, lower case, checked like the hub; changes detected', () => {
  const f = formOf(saved);
  assert.deepEqual([f.driver, f.identities, f.board], ['briefling', '', false]);
  assert.match(formError({ ...f, driver: 'board' }) ?? '', /GitHub Project/);
  const g = formOf({ ...saved, board: true, driver: 'board', identities: ['camille-uplift'] });
  assert.equal(g.identities, 'camille-uplift');
  assert.equal(changed(g, { ...saved, board: true, driver: 'board', identities: ['camille-uplift'] }), false);
  const typed = { ...g, identities: ' Camille-Uplift \n\ngideon-uplift, kiki-uplift\n' };
  assert.deepEqual(identityList(typed.identities), ['camille-uplift', 'gideon-uplift', 'kiki-uplift']);
  assert.equal(formError(typed), null);
  assert.deepEqual([payload(typed, 'c').driver, payload(typed, 'c').identities], ['board', ['camille-uplift', 'gideon-uplift', 'kiki-uplift']]);
  assert.equal(changed(typed, { ...saved, board: true, driver: 'board', identities: ['camille-uplift'] }), true);
  assert.match(formError({ ...g, identities: 'not a login' }) ?? '', /not a login/);
  assert.match(formError({ ...g, identities: 'a-\nb' }) ?? '', /a-/);
  assert.match(formError({ ...g, identities: 'x\nX' }) ?? '', /twice/);
  assert.match(formError({ ...g, identities: Array.from({ length: 21 }, (_, i) => `a${i}`).join('\n') }) ?? '', /20/);
  assert.equal(changed({ ...g, driver: 'briefling' }, { ...saved, board: true, driver: 'board', identities: ['camille-uplift'] }), true);
});

test('attached repos and CI follow-up: owner/name or a GitHub URL per line, checked before sending, part of the save and of « changed »', () => {
  assert.deepEqual(repoList(' uplift/loom \nhttps://github.com/omnico-fr/manta.git\n\nhttps://www.github.com/a/b/ , c/d'), ['uplift/loom', 'omnico-fr/manta', 'a/b', 'c/d']);
  const f = { ...formOf(saved), repos: 'uplift/loom', ci: true };
  assert.equal(formError(f), null);
  assert.match(formError({ ...f, repos: 'loom' })!, /Not a GitHub repo: loom/);
  assert.match(formError({ ...f, repos: 'https://gitlab.com/a/b' })!, /Not a GitHub repo/);
  assert.match(formError({ ...f, repos: 'uplift/loom\nUplift/LOOM' })!, /listed twice/);
  assert.match(formError({ ...f, repos: Array.from({ length: 21 }, (_, i) => `o/r${i}`).join('\n') })!, /20 repos maximum/);
  const p = payload(f, 'c1') as any;
  assert.deepEqual([p.repos, p.ci], [['uplift/loom'], true]);
  assert.equal(changed(formOf(saved), saved), false);
  assert.equal(changed(f, saved), true);
  assert.equal(changed({ ...formOf(saved), ci: true }, saved), true);
  assert.equal(changed(formOf({ ...saved, repos: ['uplift/loom'], ci: true }), { ...saved, repos: ['uplift/loom'], ci: true }), false);
  assert.deepEqual([newForm('blair', []).repos, newForm('blair', []).ci], ['', false]);
});

test('memory thresholds: from the settings (defaults for an old space), checked, sent, detected as a change', () => {
  const { memoryBatch, memoryCompact, ...old } = saved;
  const f = formOf(old as SpaceSettings);
  assert.deepEqual([f.memoryBatch, f.memoryCompact], [{ n: 10, minutes: 60 }, { n: 100, words: 3000 }]);
  assert.equal(changed(f, old as SpaceSettings), false);
  const g = { ...formOf(saved), memoryCompact: { n: 0, words: 1500 } };
  assert.equal(changed(g, saved), true);
  assert.deepEqual(payload(g, 'c').memoryCompact, { n: 0, words: 1500 });
  assert.equal(formError(g), null);
  assert.match(formError({ ...g, memoryCompact: { n: -1, words: 0 } }) ?? '', /0 to 300 entries/);
  assert.match(formError({ ...g, memoryCompact: { n: 0, words: NaN } }) ?? '', /0 to 100000 words/);
  assert.match(formError({ ...g, memoryBatch: { n: 5, minutes: 4 } }) ?? '', /5 to 10080 minutes/);
});

test('agents calling each other: 6 by default (old space), 0 = off allowed, checked, sent, one change on Agents', () => {
  const { relayMax, ...old } = saved;
  const f = formOf(old as SpaceSettings);
  assert.equal(f.relayMax, 6);
  assert.equal(changed(f, old as SpaceSettings), false);
  const g = { ...formOf(saved), relayMax: 0 };
  assert.deepEqual(changes(g, saved), ['relay']);
  assert.equal(CHANGE_TAB.relay, 'agents');
  assert.equal(payload(g, 'c').relayMax, 0);
  assert.equal(formError(g), null);
  for (const n of [-1, 21, 2.5, NaN]) assert.match(formError({ ...g, relayMax: n }) ?? '', /0 to 20/, String(n));
  assert.equal(newForm('blair', []).relayMax, 6);
});

test('changes: named in page order for the save bar, each on its tab; none = nothing to save', () => {
  assert.deepEqual(changes(formOf(saved), saved), []);
  const f = { ...formOf(saved), name: 'Hèstia', driver: 'board' as const, memoryBatch: { n: 5, minutes: 60 }, trusted: ['blair', 'joachim'] };
  assert.deepEqual(changes(f, saved), ['name', 'trusted', 'driver', 'memory']);
  assert.deepEqual(changes(f, saved).map(c => CHANGE_TAB[c]), ['general', 'members', 'work', 'memory']);
  assert.deepEqual(changes({ ...formOf(saved), repos: 'uplift/loom', ci: true, resources: [{ type: 'emulator', name: '', rule: 'r' }] }, saved), ['parallel', 'repos', 'ci']);
  assert.equal(changed({ ...formOf(saved), name: ' Hestia ' }, saved), false);
});

test('tabs: known ids only (a route segment is user input)', () => {
  assert.deepEqual(SP_TABS.filter(isSpTab), SP_TABS);
  for (const x of ['', 'Work', 'toString', '__proto__', null, 3]) assert.equal(isSpTab(x), false);
});

test('not technical: a flag per member (any role), dropped with the membership, sent in the payload, one change on Members', () => {
  let f = formOf(saved);
  f = setNontech(f, 'joachim', true);
  assert.deepEqual(f.nontech, ['joachim']);
  assert.deepEqual(setNontech(f, 'mallory', true).nontech, ['joachim'], 'only a member');
  assert.deepEqual(setNontech(f, 'joachim', true).nontech, ['joachim'], 'no duplicate');
  assert.deepEqual(payload(f, 'c').nontech, ['joachim']);
  assert.deepEqual(changes(f, saved), ['nontech']);
  assert.equal(CHANGE_TAB.nontech, 'members');
  assert.deepEqual(setRole(f, 'joachim', 'lead').nontech, ['joachim'], 'kept whatever the role');
  assert.deepEqual(setRole(f, 'joachim', 'none').nontech, [], 'leaving the space drops it');
  assert.deepEqual(setNontech(f, 'joachim', false).nontech, []);
  assert.deepEqual(changes(formOf({ ...saved, nontech: ['joachim'] }), { ...saved, nontech: ['joachim'] }), []);
});

test('modules: missing = every module on (existing spaces unchanged), stored off-list round trip, frame validation', () => {
  const regular = MODULES.filter(m => !OPT_IN.includes(m));
  assert.deepEqual(modulesOn(undefined), regular, 'opt-in modules (reminders) stay off in the existing spaces');
  assert.deepEqual(modulesOn(['radar', 'gone']), regular.filter(m => m !== 'radar'), 'an unknown stored name is ignored');
  assert.deepEqual(modulesOffOf(['lineage']), regular.filter(m => m !== 'lineage'));
  assert.deepEqual([modulesInOf(['reminders', 'radar']), modulesOn([], ['reminders']), modulesOn(modulesOffOf(['reminders']), modulesInOf(['reminders']))], [['reminders'], [...regular, 'reminders'], ['reminders']], 'opt-in: stored as « in »');
  assert.deepEqual([moduleOn(undefined, 'reminders'), modulesSet(undefined, undefined), modulesSet([], ['reminders'])], [false, false, true]);
  assert.deepEqual(modulesOn(modulesOffOf(['code', 'ci'])), ['ci', 'code'], 'MODULES order');
  assert.equal(moduleOn(undefined, 'radar'), true, 'an older hub sends no list');
  assert.equal(moduleOn([], 'radar'), false);
  assert.deepEqual([validModules([]), validModules(['radar']), validModules(['radar', 'radar']), validModules(['shell']), validModules('radar')], [true, true, false, false, false]);
});

test('modules in the form: presets turn a set on, each module stays adjustable, saved with the page; views and tabs follow', () => {
  let f = formOf(saved);
  assert.deepEqual(f.modules, [...MODULES]);
  assert.equal(presetOf(f.modules), 'custom', 'everything, reminders included, is no preset');
  assert.equal(presetOf(PRESETS.software), 'software');
  assert.deepEqual(formOf({ ...saved, modules: undefined as any }).modules, MODULES.filter(m => m !== 'reminders'), 'settings of an older hub');
  assert.deepEqual(newForm('blair', ['milan']).modules, MODULES.filter(m => m !== 'reminders'), 'a new space starts like today');
  f = setPreset(f, 'personal');
  assert.deepEqual([f.modules, presetOf(f.modules)], [['reminders'], 'personal'], 'Personal = the reminders on');
  assert.deepEqual([moduleOn(f.modules, 'threads'), moduleOn(f.modules, 'general')], [false, false], 'Personal: topics only, no thread, no General feed');
  assert.deepEqual([moduleOn(PRESETS.software, 'threads'), moduleOn(PRESETS.software, 'general'), moduleOn(undefined, 'threads')], [true, true, true], 'on by default');
  f = setModule(f, 'reminders', false);
  f = setModule(setModule(f, 'metrics', true), 'board', true);
  assert.deepEqual([f.modules, presetOf(f.modules)], [['board', 'metrics'], 'custom'], 'kept in MODULES order');
  assert.deepEqual(setModule(f, 'board', false).modules, ['metrics']);
  assert.deepEqual(changes(f, saved), ['modules']);
  assert.equal(CHANGE_TAB.modules, 'general');
  assert.deepEqual(payload(f, 'c').modules, ['board', 'metrics']);
  assert.deepEqual(changes(setModule(setPreset(f, 'software'), 'reminders', true), saved), [], 'back to everything: nothing to save');
  // views: a module's view is hidden when it is off, the others always shown
  assert.deepEqual(['overview', 'lineage', 'metrics', 'radar', 'exchanges', 'reminders', 'space', 'memory', 'lounge'].map(k => viewOn(k, [])), [false, false, false, false, false, false, true, true, true]);
  assert.deepEqual([viewOn('radar', undefined), viewOn('reminders', undefined), viewOn('reminders', ['reminders'])], [true, false, true]);
  // settings tabs: Radar, Contacts and Work go with their modules (Work: board or CI/repos)
  assert.deepEqual(tabsOn([]), SP_TABS.filter(x => !['radar', 'contacts', 'work'].includes(x)));
  assert.deepEqual(tabsOn(['ci']).includes('work'), true);
  assert.deepEqual(tabsOn([...MODULES]), [...SP_TABS]);
});

test('memory agentAuto: saving needs the risk box ticked, the frame then carries memoryAck; a space already in that mode keeps it ticked', () => {
  const f = { ...formOf({ id: 'civic', name: 'civic', about: '', members: ['blair'], trusted: ['blair'], agents: ['gaston'], defaultAgent: 'gaston', version: 3 } as any), memory: 'agentAuto' as const };
  assert.match(formError(f)!, /risk/);
  assert.equal((payload(f, 'c') as any).memoryAck, undefined);
  const ok = { ...f, memoryAck: true };
  assert.equal(formError(ok), null);
  assert.equal((payload(ok, 'c') as any).memoryAck, true);
  assert.equal((payload({ ...ok, memory: 'agent' }, 'c') as any).memoryAck, undefined, 'only sent with that mode');
  assert.equal(formOf({ id: 'civic', name: 'civic', about: '', members: ['blair'], trusted: ['blair'], agents: ['gaston'], defaultAgent: 'gaston', version: 3, memory: 'agentAuto' } as any).memoryAck, true);
});

test('backstage memory agent: saved only with an agent other than the one in charge; counted as a change; others see it out of the agents', async () => {
  const { hiddenOf } = await import('../src/spaces.ts');
  const { visibleAgents, backstageAgent } = await import('../../protocol/memory.ts');
  const two = { ...formOf({ ...saved, agents: ['milan', 'gaston'] }), memoryHidden: true };
  assert.equal(hiddenOf({ ...two, memoryAgent: '' }), false, 'default = the agent in charge: cannot be backstage');
  assert.equal((payload({ ...two, memoryAgent: '' }, 'c') as any).memoryHidden, false);
  assert.equal((payload({ ...two, memoryAgent: 'gaston' }, 'c') as any).memoryHidden, true);
  assert.ok(changes({ ...two, memoryAgent: 'gaston' }, { ...saved, agents: ['milan', 'gaston'], memoryAgent: 'gaston' }).includes('memory'));
  const sp = { agents: ['milan', 'gaston'], defaultAgent: 'milan', memoryAgent: 'gaston', memoryHidden: true };
  assert.equal(backstageAgent(sp), 'gaston');
  assert.deepEqual(visibleAgents(sp), ['milan']);
  assert.deepEqual(visibleAgents({ ...sp, memoryAgent: 'milan' }), ['milan', 'gaston'], 'the agent in charge is never hidden');
  assert.deepEqual(visibleAgents({ ...sp, memoryHidden: false }), ['milan', 'gaston']);
});

test('repoOutsideOrgs: a space admin adds or removes repos of the validated orgs only (case ignored, URLs read)', () => {
  const s = { ...saved, repos: ['omnico-fr/legacy', 'civic/api'], repoOrgs: ['civic'] };
  const f = (repos: string) => ({ ...formOf(s), repos });
  assert.equal(repoOutsideOrgs(f('omnico-fr/legacy\ncivic/api'), s), null, 'unchanged');
  assert.equal(repoOutsideOrgs(f('omnico-fr/legacy\nCivic/API\nhttps://github.com/civic/app'), s), null);
  assert.equal(repoOutsideOrgs(f('omnico-fr/legacy'), s), null, 'a civic repo removed');
  assert.equal(repoOutsideOrgs(f('civic/api'), s), 'omnico-fr/legacy', 'another org\'s repo removed');
  assert.equal(repoOutsideOrgs(f('omnico-fr/legacy\ncivic/api\nbriefling/briefling'), s), 'briefling/briefling');
  assert.equal(repoOutsideOrgs(f('omnico-fr/legacy\ncivic/api\ncivic/x'), { ...s, repoOrgs: [] }), 'civic/x', 'no org validated');
  assert.equal(formError({ ...formOf(s), repoOrgs: 'civic\nnot an org' }), 'Invalid GitHub org: not an org');
});
