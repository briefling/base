import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { highlight, langOf, MAX_CODE, type Seg } from '../src/highlight.ts';

const join = (s: Seg[] | null) => (s ?? []).map(x => x.text).join('');
const cls = (s: Seg[] | null, text: string) => s?.find(x => x.text === text)?.cls;

test('only declared, supported languages are highlighted: no guessing', () => {
  assert.equal(highlight('const x = 1', undefined), null);
  assert.equal(highlight('const x = 1', ''), null);
  assert.equal(highlight('const x = 1', 'brainfuck'), null);
  assert.equal(highlight('<p>x</p>', 'html'), null); // markup is loaded (jsx needs it) but not offered
});

test('fence info: first word, case-insensitive, aliases', () => {
  assert.equal(langOf('TS title="x.ts"'), 'typescript');
  for (const [w, l] of [['sh', 'bash'], ['shell', 'bash'], ['js', 'javascript'], ['tsx', 'tsx'], ['py', 'python'], ['yml', 'yaml'], ['rs', 'rust'], ['golang', 'go'], ['patch', 'diff']])
    assert.equal(langOf(w), l, w);
});

test('every supported language tokenizes and gives the code back unchanged', () => {
  const samples: Record<string, string> = {
    bash: 'ls -la "$HOME" | grep x # list', diff: '@@ -1 +1 @@\n-a\n+b\n c', ts: 'const x: number = 1; // n',
    tsx: 'const A = () => <B c="d">{x}</B>;', js: 'function f(a) { return `t${a}`; }', python: 'def f(x):\n    return "y"  # c',
    json: '{"a": [1, true, null]}', yaml: 'a: 1\nb: "two"  # c', sql: 'SELECT a FROM t WHERE b = \'x\';', go: 'func main() { fmt.Println("x") }',
    rust: 'fn main() { let x: u8 = 1; }', css: '.a > b { color: red; }',
  };
  for (const [lang, code] of Object.entries(samples)) {
    const s = highlight(code, lang);
    assert.ok(s && s.some(x => x.cls), `${lang} has coloured tokens`);
    assert.equal(join(s), code, `${lang} round trip`);
  }
});

test('palette: keywords, strings, comments, types; adjacent runs merged', () => {
  const s = highlight('const x: string = "a"; // c', 'ts');
  assert.equal(cls(s, 'const'), 'k');
  assert.equal(cls(s, 'string'), 't');
  assert.equal(cls(s, '"a"'), 's');
  assert.equal(cls(s, '// c'), 'c');
  for (let i = 1; i < s!.length; i++) assert.notEqual(s![i].cls, s![i - 1].cls);
});

test('tsx: JSX tags and attributes are coloured', () => {
  const s = highlight('<Card title="x" />', 'tsx');
  assert.equal(cls(s, 'title'), 'p');
  assert.equal(cls(s, 'x'), 's');
  assert.ok(s!.some(x => x.cls === 't' && x.text.includes('Card')));
});

test('diff: added and removed lines, hunk header', () => {
  const s = highlight('@@ -1,2 +1,2 @@\n-old\n+new\n same', 'diff');
  assert.equal(cls(s, '-old\n'), 'd');
  assert.equal(cls(s, '+new\n'), 'i');
  assert.equal(cls(s, '@@ -1,2 +1,2 @@'), 'c');
});

test('a very long block stays plain (bounds the regex cost)', () => {
  assert.equal(highlight('x'.repeat(MAX_CODE + 1), 'ts'), null);
  assert.ok(highlight('x'.repeat(MAX_CODE), 'ts'));
});

test('markup-looking code is text, never markup', () => {
  const code = '<img src=x onerror=alert(1)> &amp; </code>';
  assert.equal(join(highlight(code, 'ts')), code);
});


test('approval question of the plugin (shared fixture): its fence says bash, so the command is highlighted', () => {
  const a = JSON.parse(readFileSync(new URL('../../hermes-plugin/tests/approval-ask.json', import.meta.url), 'utf8'));
  const info = /^(`{3,})(\S*)$/m.exec(a.q);
  assert.ok(info, 'a fence');
  const lang = langOf(info[2]);
  assert.equal(lang, 'bash');
  assert.ok(highlight(a.command, lang ?? undefined)?.some(x => x.cls === 'k'), 'a keyword span');
});
