import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { validateFlow, flowYaml, flowFiles, flowText, yamlStr, FLOW_TRIGGERS, MAX_FLOW_BYTES, type FlowDef, type FlowIssue } from '../../protocol/flowcfg.ts';
import { FLOW_TEMPLATES } from '../../protocol/flow-templates.ts';
import { fixtures, FIXTURES_DIR } from '../../scripts/flow-fixtures.ts';

const TINY: FlowDef = {
  name: 'tiny',
  states: [{ key: 'backlog', column: 'Backlog' }, { key: 'doing', column: 'Doing' }, { key: 'approved', column: 'To merge' }],
  roles: [{ name: 'pm', assign: 'all', color: '', on: { backlog: ['item_new'] }, playbooks: { item_new: 'a.md' } }],
  kinds: [], playbooks: [{ file: 'a.md', body: 'x\n' }], artifact: '',
};
/** Issues of TINY after `f` mutated a copy of it. */
function issues(f: (d: FlowDef) => void, base: FlowDef = TINY): FlowIssue[] {
  const d = structuredClone(base);
  f(d);
  return validateFlow(d);
}
const one = (path: string, code: FlowIssue['code']) => [{ path, code }];

test('templates and the tiny def are valid', () => {
  assert.deepEqual(validateFlow(FLOW_TEMPLATES.dev), []);
  assert.deepEqual(validateFlow(FLOW_TEMPLATES.content), []);
  assert.deepEqual(validateFlow(TINY), []);
});

test('shape: anything but an exact FlowDef is refused whole', () => {
  const bad: unknown[] = [null, undefined, 'flow', 3, [], [TINY], new Date(),
    { ...TINY, extra: 1 }, { ...TINY, artifact: undefined }, (({ kinds, ...r }) => r)(TINY),
    { ...TINY, name: 1 }, { ...TINY, kinds: ['a', 2] }, { ...TINY, states: {} }, { ...TINY, states: [{ key: 'a' }] },
    { ...TINY, states: [{ key: 'a', column: 'A', x: 1 }] }, { ...TINY, playbooks: [{ file: 'a.md', body: null }] },
    { ...TINY, roles: [{ ...TINY.roles[0], assign: 'boss' }] }, { ...TINY, roles: [{ ...TINY.roles[0], color: null }] },
    { ...TINY, roles: [{ ...TINY.roles[0], on: [] }] }, { ...TINY, roles: [{ ...TINY.roles[0], on: { backlog: 'item_new' } }] },
    { ...TINY, roles: [{ ...TINY.roles[0], on: { backlog: [1] } }] }, { ...TINY, roles: [{ ...TINY.roles[0], playbooks: { item_new: 1 } }] },
    { ...TINY, roles: [{ name: 'pm', assign: 'all', color: '', on: {} }] }, { ...TINY, roles: [null] }];
  for (const d of bad) assert.deepEqual(validateFlow(d), one('', 'shape'), JSON.stringify(d));
  // JSON from the wire: a `__proto__` key is an own property, it gets no special treatment
  assert.deepEqual(validateFlow(JSON.parse(JSON.stringify(TINY).replace('"on":{', '"on":{"__proto__":[],'))),
    one('roles.0.on.__proto__', 'state_unknown'));
});

test('name', () => {
  for (const n of ['', 'Dev', '-dev', 'a'.repeat(41), 'a b', 'é']) assert.deepEqual(issues(d => { d.name = n; }), one('name', 'name'), n);
  assert.deepEqual(issues(d => { d.name = 'a'.repeat(40); }), []);
});

test('states: key, dup, column, column_dup, state_required, too many', () => {
  const extra = (s: { key: string; column: string }) => (d: FlowDef) => { d.states.push(s); };
  assert.deepEqual(issues(extra({ key: 'Done', column: 'Done' })), one('states.3.key', 'state_key'));
  assert.deepEqual(issues(extra({ key: 'doing', column: 'Done' })), one('states.3.key', 'state_dup'));
  assert.deepEqual(issues(extra({ key: 'done', column: ' \t' })), one('states.3.column', 'column'));
  assert.deepEqual(issues(extra({ key: 'done', column: 'x'.repeat(61) })), one('states.3.column', 'column'));
  assert.deepEqual(issues(extra({ key: 'done', column: ' to MERGE ' })), one('states.3.column', 'column_dup'));
  assert.deepEqual(issues(d => { d.states[2].key = 'done'; }), one('states', 'state_required'));
  assert.deepEqual(issues(d => { for (let i = 0; i < 18; i++) d.states.push({ key: `s${i}`, column: `S${i}` }); }), one('states', 'too_big'));
  assert.deepEqual(issues(d => { for (let i = 0; i < 17; i++) d.states.push({ key: `s${i}`, column: `S${i}` }); }), []);
});

test('roles: no_role, role_name, role_dup, too many', () => {
  assert.deepEqual(issues(d => { d.roles = []; d.playbooks = []; }), one('roles', 'no_role'));
  assert.deepEqual(issues(d => { d.roles[0].name = 'PM'; }), one('roles.0.name', 'role_name'));
  assert.deepEqual(issues(d => { d.roles.push(structuredClone(d.roles[0])); }), one('roles.1.name', 'role_dup'));
  const many = (n: number) => (d: FlowDef) => { for (let i = 0; i < n; i++) d.roles.push({ name: `r${i}`, assign: 'all', color: '', on: {}, playbooks: {} }); };
  assert.deepEqual(issues(many(20)), one('roles', 'too_big'));
  assert.deepEqual(issues(many(19)), []);
});

test('on: trigger, trigger_dup, state_unknown', () => {
  assert.deepEqual(issues(d => { (d.roles[0].on.backlog as string[]).push('merged'); }), one('roles.0.on.backlog.1', 'trigger'));
  assert.deepEqual(issues(d => { d.roles[0].on.backlog.push('item_new'); }), one('roles.0.on.backlog.1', 'trigger_dup'));
  assert.deepEqual(issues(d => { d.roles[0].on.done = []; }), one('roles.0.on.done', 'state_unknown'));
  assert.deepEqual(issues(d => { d.roles[0].on.doing = []; }), [], 'an empty state is fine');
});

test('human_triggers: a human role has no trigger and no playbook', () => {
  const human = (on: FlowDef['roles'][0]['on'], playbooks: FlowDef['roles'][0]['playbooks']) =>
    (d: FlowDef) => { d.roles.push({ name: 'boss', assign: 'human', color: '', on, playbooks }); };
  assert.deepEqual(issues(human({}, {})), []);
  assert.deepEqual(issues(human({ doing: [] }, {})), [], 'an empty state is no trigger');
  assert.deepEqual(issues(human({ doing: ['assigned'] }, {})), one('roles.1', 'human_triggers'));
  assert.deepEqual(issues(human({}, { assigned: 'a.md' })), one('roles.1', 'human_triggers'));
});

test('color: 6 lowercase hex, labelled roles only', () => {
  const label = (color: string, assign: 'label' | 'auto' | 'human' | 'all' = 'label') => (d: FlowDef) => {
    d.roles.push({ name: 'dev', assign, color, on: { doing: ['assigned'] }, playbooks: { assigned: 'a.md' } });
  };
  assert.deepEqual(issues(label('1d76db')), []);
  assert.deepEqual(issues(label('1d76db', 'auto')), []);
  assert.deepEqual(issues(label('')), []);
  for (const c of ['1D76DB', '#1d76db', '1d76d', 'zzzzzz']) assert.deepEqual(issues(label(c)), one('roles.1.color', 'color'), c);
  assert.deepEqual(issues(d => { d.roles[0].color = '1d76db'; }), one('roles.0.color', 'color'));
});

test('playbooks of a role: missing, unused, unknown file, unknown trigger', () => {
  assert.deepEqual(issues(d => { d.roles[0].on.doing = ['assigned']; }), one('roles.0.playbooks.assigned', 'playbook_missing'));
  assert.deepEqual(issues(d => { d.roles[0].playbooks.ci_failed = 'a.md'; }), one('roles.0.playbooks.ci_failed', 'playbook_unused'));
  assert.deepEqual(issues(d => {
    d.roles.push({ name: 'dev', assign: 'label', color: '', on: { doing: ['assigned'] }, playbooks: { assigned: 'b.md' } });
  }), one('roles.1.playbooks.assigned', 'playbook_unknown'));
  assert.deepEqual(issues(d => { (d.roles[0].playbooks as Record<string, string>).merged = 'a.md'; }), one('roles.0.playbooks.merged', 'trigger'));
});

test('kinds: slug, max 40, unique, max 30', () => {
  assert.deepEqual(issues(d => { d.kinds = ['bug', 'no', '1']; }), []);
  for (const k of ['Bug', '-bug', '', 'a b', 'k'.repeat(41)]) assert.deepEqual(issues(d => { d.kinds = ['bug', k]; }), one('kinds.1', 'kind'), k);
  assert.deepEqual(issues(d => { d.kinds = ['bug', 'bug']; }), one('kinds.1', 'kind_dup'));
  assert.deepEqual(issues(d => { d.kinds = Array.from({ length: 31 }, (_, i) => `k${i}`); }), one('kinds', 'too_big'));
});

test('playbook files: name, dup, unused, body size, count', () => {
  assert.deepEqual(issues(d => { d.playbooks.push({ file: 'b.txt', body: '' }); }), one('playbooks.1.file', 'file'));
  assert.deepEqual(issues(d => { d.playbooks.push({ file: '../b.md', body: '' }); }), one('playbooks.1.file', 'file'));
  assert.deepEqual(issues(d => { d.playbooks.push({ file: 'a.md', body: '' }); }), one('playbooks.1.file', 'file_dup'));
  assert.deepEqual(issues(d => { d.playbooks.push({ file: 'b.md', body: '' }); }), one('playbooks.1.file', 'file_unused'));
  assert.deepEqual(issues(d => { d.playbooks[0].body = 'x'.repeat(16_000); }), []);
  assert.deepEqual(issues(d => { d.playbooks[0].body = 'x'.repeat(16_001); }), one('playbooks.0.body', 'too_big'));
  const many = issues(d => { for (let i = 0; i < 40; i++) d.playbooks.push({ file: `f${i}.md`, body: '' }); });
  assert.deepEqual(many[0], { path: 'playbooks', code: 'too_big' });
});

test('artifact: relative, no .., max 200', () => {
  assert.deepEqual(issues(d => { d.artifact = '{yyyy}/{mm}/{slug}.md'; }), []);
  for (const a of ['/etc/x', '../x', 'a/../b', 'a'.repeat(201)]) assert.deepEqual(issues(d => { d.artifact = a; }), one('artifact', 'artifact'), a);
});

test('text: NUL and lone surrogates anywhere; emoji are fine', () => {
  assert.deepEqual(issues(d => { d.states[0].column = 'Back\0log'; }), one('states.0.column', 'text'));
  assert.deepEqual(issues(d => { d.playbooks[0].body = 'a\uD83D b'; }), one('playbooks.0.body', 'text'));
  assert.deepEqual(issues(d => { d.playbooks[0].body = 'a\uDE80'; }), one('playbooks.0.body', 'text'));
  assert.deepEqual(issues(d => { d.artifact = 'x\uDE80\uD83D.md'; }), one('artifact', 'text'));
  assert.deepEqual(issues(d => { d.states[0].column = 'Back 🚀\u2028\t\x7f'; d.playbooks[0].body = '🚀🚀'; }), []);
});

test('too_big: the whole def, counted in UTF-8 bytes', () => {
  const big = (n: number) => (d: FlowDef) => {
    const trs = ['human_comment', 'new_comment', 'assigned'] as const;
    d.playbooks[0].body = 'é'.repeat(n);
    trs.forEach((t, i) => { d.roles[0].on.backlog.push(t); d.roles[0].playbooks[t] = `b${i}.md`; d.playbooks.push({ file: `b${i}.md`, body: 'é'.repeat(n) }); });
  };
  assert.deepEqual(issues(big(8000)), []);                        // 64 kB of bytes, 32 k chars: under
  assert.deepEqual(issues(big(8300)), one('', 'too_big'));         // 4 x 8300 x 2 bytes > 64 KiB, chars far under
  assert.ok(MAX_FLOW_BYTES === 65_536);
});

test('secret: keys and tokens pasted anywhere are refused, at their path', () => {
  const tok = (p: string) => p + 'A1b2_'.repeat(4);
  for (const s of ['-----BEGIN RSA PRIVATE KEY-----', 'the app_key is x', tok('ghp_'), tok('gho_'), tok('ghu_'), tok('ghs_'), tok('ghr_'),
    tok('github_pat_'), 'id AKIAIOSFODNN7EXAMPLE']) {
    assert.deepEqual(issues(d => { d.playbooks[0].body = `see ${s} here`; }), one('playbooks.0.body', 'secret'), s);
  }
  assert.deepEqual(issues(d => { d.states[1].column = tok('ghp_'); }), one('states.1.column', 'secret'));
  for (const s of ['ghp_short', 'ghx_' + 'a'.repeat(30), 'AKIAshort', '----BEGIN', 'app-key']) {
    assert.deepEqual(issues(d => { d.playbooks[0].body = s; }), [], s);
  }
});

test('every issue is returned, in a stable order', () => {
  const r = issues(d => {
    d.name = 'X';
    d.states.push({ key: 'doing', column: 'doing' });
    d.roles[0].on.doing = ['assigned', 'assigned'];
    d.kinds = ['A'];
    d.playbooks.push({ file: 'z.md', body: 'AKIAIOSFODNN7EXAMPLE' });
    d.artifact = '/x';
  });
  assert.deepEqual(r, [
    { path: 'name', code: 'name' }, { path: 'states.3.key', code: 'state_dup' }, { path: 'states.3.column', code: 'column_dup' },
    { path: 'roles.0.on.doing.1', code: 'trigger_dup' }, { path: 'roles.0.playbooks.assigned', code: 'playbook_missing' },
    { path: 'kinds.0', code: 'kind' }, { path: 'playbooks.1.file', code: 'file_unused' }, { path: 'artifact', code: 'artifact' },
    { path: 'playbooks.1.body', code: 'secret' },
  ]);
  assert.deepEqual(issues(d => { d.name = 'X'; d.artifact = '/x'; }), [{ path: 'name', code: 'name' }, { path: 'artifact', code: 'artifact' }]);
});

test('YAML golden: layout, quoting, FLOW_TRIGGERS order, omitted sections', () => {
  const d: FlowDef = {
    name: 'tiny',
    states: [{ key: 'backlog', column: 'Backlog' }, { key: 'doing', column: 'In progress' }, { key: 'approved', column: 'To merge' }],
    roles: [
      { name: 'pm', assign: 'all', color: '', on: { backlog: ['human_comment', 'item_new'] }, playbooks: { item_new: 'spec.md', human_comment: 'spec.md' } },
      { name: 'dev', assign: 'label', color: '1d76db', on: { approved: ['pr_conflict'], doing: ['assigned'], backlog: [] }, playbooks: { pr_conflict: 'fix.md', assigned: 'take.md' } },
      { name: 'review', assign: 'auto', color: '', on: {}, playbooks: {} },
      { name: 'boss', assign: 'human', color: '', on: {}, playbooks: {} },
      { name: 'idle', assign: 'all', color: '', on: { doing: [] }, playbooks: {} },
    ],
    kinds: ['bug', 'no'],
    playbooks: [{ file: 'spec.md', body: 's' }, { file: 'take.md', body: 't\n' }, { file: 'fix.md', body: '' }],
    artifact: '{yyyy}/{slug}.md',
  };
  assert.deepEqual(validateFlow(d), []);
  assert.equal(flowYaml(d), `# Flow tiny: generated by briefling (edit it in the flow editor, not here).
states:
  - key: "backlog"
    column: "Backlog"
  - key: "doing"
    column: "In progress"
  - key: "approved"
    column: "To merge"

roles:
  "pm":
    "on":
      "backlog":
        - "item_new"
        - "human_comment"
  "dev":
    label: "dev:{agent}"
    "on":
      "doing":
        - "assigned"
      "approved":
        - "pr_conflict"
  "review":
    label: "review:{agent}"
    auto: true
  "boss":
    human: true
  "idle": {}

kinds:
  - "bug"
  - "no"

label_colors:
  "dev": "1d76db"

playbooks:
  "pm.item_new": "playbooks/tiny/spec.md"
  "pm.human_comment": "playbooks/tiny/spec.md"
  "dev.assigned": "playbooks/tiny/take.md"
  "dev.pr_conflict": "playbooks/tiny/fix.md"

artifact:
  path: "{yyyy}/{slug}.md"
`);
  const bare: FlowDef = { ...d, roles: [d.roles[3]], kinds: [], playbooks: [], artifact: '' };
  assert.equal(flowYaml(bare), flowYaml(d).split('\nroles:')[0] + '\nroles:\n  "boss":\n    human: true\n');
  assert.equal(flowYaml(structuredClone(d)), flowYaml(d), 'deterministic');
});

test('yamlStr: JSON quoting plus the characters YAML 1.1 rejects or folds', () => {
  const cases: [string, string][] = [
    ['plain', '"plain"'], ['yes', '"yes"'], ['on', '"on"'], ['null', '"null"'], ['', '""'],
    ['say "hi"', '"say \\"hi\\""'], ['a\\b', '"a\\\\b"'], ['a\nb\r', '"a\\nb\\r"'], ['tab\there', '"tab\\there"'],
    ['x #y', '"x #y"'], ['k: v', '"k: v"'], ['- [a]{b}&*!|>%@`', '"- [a]{b}&*!|>%@`"'],
    ['été ✓', '"été ✓"'], ['🚀', '"🚀"'], ['\u2028\u2029', '"\\u2028\\u2029"'], ['\u0085', '"\\u0085"'],
    ['\x7f\x80\x9f', '"\\u007f\\u0080\\u009f"'], ['\uFEFF\uFFFE\uFFFF', '"\\ufeff\\ufffe\\uffff"'], ['\x00\x1b', '"\\u0000\\u001b"'],
    ['\xa0\uFFFD', '"\xa0\uFFFD"'],
  ];
  for (const [s, y] of cases) assert.equal(yamlStr(s), y, JSON.stringify(s));
  // what is left raw is only YAML 1.1 printable, never a break other than the escaped ones
  const all = Array.from({ length: 0x10000 }, (_, i) => String.fromCharCode(i)).filter(c => !/[\uD800-\uDFFF]/.test(c)).join('') + '🚀';
  assert.match(yamlStr(all), /^[\x20-\x7E\xA0-\u2027\u202A-\uD7FF\uE000-\uFEFE\uFF00-\uFFFD\uD800-\uDFFF]*$/);
  assert.equal(JSON.parse(yamlStr(all)), all, 'still valid JSON, same string');
});

test('flowFiles and flowText', () => {
  const d: FlowDef = { ...TINY, playbooks: [{ file: 'a.md', body: 'x' }] };
  const files = flowFiles(d);
  assert.deepEqual(files.map(f => f.path), ['flows/tiny.yml', 'playbooks/tiny/a.md']);
  assert.equal(files[0].text, flowYaml(d));
  assert.equal(files[1].text, 'x');
  assert.equal(flowText(d), `=== flows/tiny.yml ===\n${flowYaml(d)}=== playbooks/tiny/a.md ===\nx\n`);
  assert.deepEqual(flowFiles(FLOW_TEMPLATES.dev).map(f => f.path), ['flows/dev.yml',
    ...['spec', 'take', 'rework', 'conflict', 'review'].map(f => `playbooks/dev/${f}.md`)]);
  assert.equal(FLOW_TRIGGERS.length, 7);
});

test('committed fixtures (hermes-plugin/tests/flow/data/editor) are what scripts/flow-fixtures.ts generates now', () => {
  const want = fixtures();
  const onDisk = (readdirSync(FIXTURES_DIR, { recursive: true, withFileTypes: true }))
    .filter(e => e.isFile()).map(e => relative(FIXTURES_DIR, join(e.parentPath, e.name))).sort();
  assert.deepEqual(onDisk, want.map(f => f.path).sort(), 'run `node scripts/flow-fixtures.ts`');
  for (const f of want) assert.equal(readFileSync(join(FIXTURES_DIR, f.path), 'utf8'), f.text, `${f.path}: run \`node scripts/flow-fixtures.ts\``);
  for (const f of want.filter(x => x.path.endsWith('expected.json'))) assert.deepEqual(validateFlow(JSON.parse(f.text)), [], f.path);
});
