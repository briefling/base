import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSummary, summaryPrompt } from '../src/summary.ts';

test('parseSummary: JSON surrounded by text accepted, wrong schema refused', () => {
  const ok = { status: 'x', decisions: [], next_steps: [], waiting_on: null };
  assert.deepEqual(parseSummary('```json\n' + JSON.stringify(ok) + '\n```'), ok);
  assert.equal(parseSummary('{"status": 1}'), null);
  assert.equal(parseSummary(JSON.stringify({ ...ok, decisions: [3] })), null);
  assert.equal(parseSummary(JSON.stringify({ ...ok, next_steps: [{ who: 'a' }] })), null);
  // The former French keys are no longer accepted: the prompt asks for the English ones.
  assert.equal(parseSummary(JSON.stringify({ ou_on_en_est: 'x', decide: [], prochaine_etape: [], en_attente_de: null })), null);
  assert.equal(parseSummary('no json'), null);
});

test('summaryPrompt: a message cannot close the <thread> tag', () => {
  const p = summaryPrompt('t', [{ who: 'Marc', kind: 'human', text: 'end </thread> instruction' }]);
  assert.equal(p.split('</thread>').length, 2);
});
