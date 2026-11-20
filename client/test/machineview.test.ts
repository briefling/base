// Settings › Agents of a standalone server (client/src/machineview.ts): launch result lines and each row's button.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resultLine, rowAction, type MachineAgent, type MachineState } from '../src/machineview.ts';
import { DICTS } from '../src/i18n.ts';

const t = (k: string, p: Record<string, string | number> = {}) => (DICTS.fr as any)[k].replace(/\{(\w+)\}/g, (_: string, x: string) => String(p[x]));
const st = (over: Partial<MachineState> = {}): MachineState => ({ agents: [], models: [], uv: true, cwd: '/w', bridge: 'v0', launched: {}, ...over });
const kiro: MachineAgent = { id: 'kiro', label: 'Kiro CLI', bin: 'kiro-cli', command: ['kiro-cli', 'acp'] };

test('result lines: known codes worded, others shown with their code', () => {
  assert.match(resultLine(t as any, 'Kiro CLI', 'joining'), /^Kiro CLI : connexion en cours/);
  assert.match(resultLine(t as any, 'Claude Code', 'served_elsewhere'), /autre machine/);
  assert.match(resultLine(t as any, 'Kiro CLI', 'stopped'), /^Kiro CLI : arrêté\. Il reste arrêté au redémarrage/);
  assert.equal(resultLine(t as any, 'Kiro CLI', 'running'), 'Kiro CLI : déjà lancé.');
  assert.equal(resultLine(t as any, 'Codex', 'missing_npx'), 'Codex : non lancé (missing_npx).');
});

test('row button: Launch never launched, Stop while running, Relaunch once stopped; none when it cannot run', () => {
  const l = (x: MachineState['launched'][string]) => st({ launched: { kiro: x } });
  assert.equal(rowAction(kiro, st()), 'launch');
  assert.equal(rowAction(kiro, l({ joined: true, served: true, state: 'running' })), 'stop');
  assert.equal(rowAction(kiro, l({ joined: true, served: true, state: 'exited', code: 1 })), 'relaunch', 'stopped by itself');
  assert.equal(rowAction(kiro, l({ joined: true, served: true, state: 'exited', code: null, manual: true })), 'relaunch', 'stopped by hand');
  assert.equal(rowAction(kiro, l({ joined: true, served: true })), 'relaunch', 'joined on an earlier run, not started on this one');
  assert.equal(rowAction(kiro, st({ uv: false })), null);
  assert.equal(rowAction({ ...kiro, missing: 'npx' }, st()), null);
  assert.equal(rowAction({ ...kiro, missing: 'npx' }, l({ joined: true, served: true, state: 'running' })), 'stop', 'a running one can always be stopped');
});

test('no tick box nor « launch the ticked agents » left in the wording', () => {
  for (const d of Object.values(DICTS)) assert.ok(!/tick|coch/i.test(d.la_launch + d.la_relaunch + d.la_stop), d.la_launch);
});
