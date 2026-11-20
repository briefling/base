// « To approve »: a thread whose open card is a command approval (hub fact pendingApproval, push body).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFact, computeState, initialFacts } from '../src/state.ts';
import { approvalCommand, pushPayload } from '../src/push.ts';
import { isApprovalAsk } from '../../protocol/frames.ts';

test('isApprovalAsk: only the plugin approval buttons', () => {
  assert.ok(isApprovalAsk(['Approve', 'For this session', 'Always', 'Deny']));
  assert.ok(isApprovalAsk(['Approve', 'Deny']));
  assert.ok(!isApprovalAsk(['Yes', 'No']));
  assert.ok(!isApprovalAsk(['Approve', 'Later']), 'one foreign button = a question');
  assert.ok(!isApprovalAsk([]), 'free-text clarify');
});

test('pendingApproval: set with its card, cleared with it, still Your turn', () => {
  const a = applyFact(initialFacts(), { type: 'ask', ask_id: 'q1', approval: true });
  assert.equal(a.pendingApproval, true); assert.equal(computeState(a), 'you');
  for (const e of [{ type: 'human.answer', ask_id: 'q1', trusted: true }, { type: 'ask.closed', ask_id: 'q1' }, { type: 'human.post', trusted: true }] as const) {
    const g = applyFact(a, e);
    assert.equal(g.pendingAsk, null, e.type); assert.ok(!('pendingApproval' in g), `${e.type} drops the mark`);
  }
  assert.equal(applyFact(a, { type: 'human.answer', ask_id: 'other' }).pendingApproval, true, 'another card id: still open');
  assert.equal(applyFact(a, { type: 'human.post', trusted: false }).pendingApproval, true, 'an untrusted post answers nothing');
  const q = applyFact(a, { type: 'ask', ask_id: 'q2' });
  assert.equal(q.pendingAsk, 'q2'); assert.ok(!('pendingApproval' in q), 'a question replacing the approval is Your turn again');
  assert.ok(!('pendingApproval' in applyFact(initialFacts(), { type: 'ask', ask_id: 'q3' })));
});

test('approvalCommand: the fenced command, else the text', () => {
  assert.equal(approvalCommand('Command to approve:\n```bash\nrm -rf /tmp/x\n```\nReason: cleanup'), 'rm -rf /tmp/x');
  assert.equal(approvalCommand('Command to approve:\n````bash\necho `date`\n  && ls\n````\nReason: r'), 'echo date && ls', 'longer fence, multi-line');
  assert.equal(approvalCommand('Run **this**?'), 'Run this?');
});

test('push body: « To approve » for an approval, « Your turn » otherwise', () => {
  const t = { id: 't1', space: 'civic', title: 'Sensor fix' };
  assert.equal(pushPayload(t, 'Civic', 'fr', undefined, 2, 'npm run deploy', undefined, true).body, 'À approuver : npm run deploy · Civic');
  assert.equal(pushPayload(t, 'Civic', 'en', undefined, 2, 'npm run deploy', undefined, true).body, 'To approve: npm run deploy · Civic');
  assert.equal(pushPayload(t, 'Civic', 'fr', undefined, 2, '', undefined, true).body, 'À approuver · Civic');
  assert.equal(pushPayload(t, 'Civic', 'fr', undefined, 2, 'Valider le brief').body, 'À toi : Valider le brief · Civic');
});
