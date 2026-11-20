import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formProfile, profileDiff, radarForm, radarFormError, radarPayload, radarRunning, rejectPayload, settingsChanged } from '../src/radarcfg.ts';
import { emptyRadarConfig, type RadarConfig } from '../../protocol/radar.ts';

const P = { product: 'Hub.\nFor teams.', competitors: ['Linear: tickets'], tech: ['Claude: model'], sources: ['https://github.com/a/b/issues'] };
const cfg = (x: Partial<RadarConfig> = {}): RadarConfig => ({ ...emptyRadarConfig('s'), version: 3, ...x });

test('radar form: the proposal waiting for validation is shown first, else the validated profile, one item per line', () => {
  const f = radarForm(cfg({ profile: { ...P, by: 'blair', at: 1 }, proposed: { ...P, competitors: ['A: x', 'B: y'], agent: 'milan', at: 2 } }), 'gaston', ['gaston']);
  assert.equal(f.competitors, 'A: x\nB: y');
  assert.equal(radarForm(cfg({ profile: { ...P, by: 'blair', at: 1 } }), 'gaston', ['gaston']).competitors, 'Linear: tickets');
  assert.equal(radarForm(cfg({ agent: 'gone' }), 'gaston', ['gaston']).agent, 'gaston', 'an agent no longer in the space: the default one');
});

test('radar form: validating sends the edited profile (blank lines dropped), saving only the settings', () => {
  const f = { ...radarForm(cfg({ proposed: { ...P, agent: 'milan', at: 2 } }), 'gaston', ['gaston']), tech: 'Claude: model\n\n  Lambda: hub  \n' };
  assert.deepEqual(formProfile(f)?.tech, ['Claude: model', 'Lambda: hub']);
  assert.deepEqual(radarPayload(f, 's', 'c', true).profile?.tech, ['Claude: model', 'Lambda: hub']);
  assert.equal('profile' in radarPayload(f, 's', 'c', false), false);
  assert.equal(radarFormError({ ...f, product: 'a\nb\nc\nd' }, cfg(), true), 'profile', 'more than 3 lines of product');
  assert.equal(radarFormError({ ...f, sources: 'http://x' }, cfg(), true), 'profile');
  assert.equal(radarFormError({ ...f, rhythm: 'daily' }, cfg(), false), 'no_profile', 'a rhythm needs a validated profile');
  assert.equal(radarFormError({ ...f, rhythm: 'daily' }, cfg({ profile: { ...P, by: 'b', at: 1 } }), false), null);
});

test('radar form: changed settings and a run under way', () => {
  const c = cfg();
  const f = radarForm(c, 'gaston', ['gaston']);
  assert.equal(settingsChanged(f, c, 'gaston'), false);
  assert.equal(settingsChanged({ ...f, detectors: { ...f.detectors, tech: false } }, c, 'gaston'), true);
  assert.equal(settingsChanged({ ...f, product: 'x' }, c, 'gaston'), false, 'the profile is saved by Validate only');
  const run = { kind: 'pass' as const, at: 1000, by: 'b', result: 'started' as const, thread: 't' };
  assert.equal(radarRunning(cfg({ run }), 2000), true);
  assert.equal(radarRunning(cfg({ run: { ...run, ended: 1500 } }), 2000), false, 'its turn ended');
  assert.equal(radarRunning(cfg({ run }), 1000 + 30 * 60_000), false, 'too old');
  assert.equal(radarRunning(cfg({ run: { ...run, result: 'unreached' } }), 2000), false);
});

test('radar form: the ignore list is edited and sent with the profile; a pass correction shows what it changes, and can be rejected', () => {
  const c = cfg({ profile: { ...P, by: 'blair', at: 1 }, proposed: { ...P, competitors: [], ignore: ['Enterprise SSO'], agent: 'milan', at: 2, why: 'Twice: not our market.', from: ['a'.repeat(22), 'b'.repeat(22)] } });
  const f = radarForm(c, 'gaston', ['gaston']);
  assert.equal(f.ignore, 'Enterprise SSO');
  assert.deepEqual(radarPayload({ ...f, ignore: 'Enterprise SSO\n\n Big banks ' }, 's', 'c', true).profile?.ignore, ['Enterprise SSO', 'Big banks']);
  assert.deepEqual(formProfile({ ...radarForm(cfg({ profile: { ...P, by: 'b', at: 1 } }), 'g', ['g']) })?.ignore, [], 'a profile validated before the list: empty');
  assert.deepEqual(profileDiff(c), { product: false, lists: [{ list: 'competitors', added: [], removed: ['Linear: tickets'] }, { list: 'ignore', added: ['Enterprise SSO'], removed: [] }] });
  assert.equal(profileDiff(cfg({ profile: { ...P, by: 'b', at: 1 }, proposed: { ...P, agent: 'm', at: 2 } })), null, 'a profile pass proposal is not a correction');
  assert.deepEqual(rejectPayload(c, 's', 'c'), { type: 'radarcfg.reject', client_id: 'c', space: 's', version: 3 });
});
