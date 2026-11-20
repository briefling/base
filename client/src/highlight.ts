// Syntax highlighting of fenced code blocks, DOM-free (tested in node): Prism only cuts the code into
// typed tokens, markdown.ts builds the spans with textContent (never innerHTML, unlike Prism.highlight).
// Only blocks that declare one of the languages below are coloured: no guessing, a short block would
// often be guessed wrong. Languages are imported one by one (no autoloader: CVE-2024-53382 and network).
import './prism-manual.ts';
import Prism, { type Token } from 'prismjs'; // core + markup, css, clike, javascript
import 'prismjs/components/prism-typescript.js';
import 'prismjs/components/prism-jsx.js';
import 'prismjs/components/prism-tsx.js';
import 'prismjs/components/prism-bash.js';
import 'prismjs/components/prism-diff.js';
import 'prismjs/components/prism-python.js';
import 'prismjs/components/prism-json.js';
import 'prismjs/components/prism-yaml.js';
import 'prismjs/components/prism-sql.js';
import 'prismjs/components/prism-go.js';
import 'prismjs/components/prism-rust.js';

/** Fence info word (lowercased) -> Prism grammar. Anything else stays plain text. */
const LANGS: Record<string, string> = {
  bash: 'bash', sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash',
  diff: 'diff', patch: 'diff',
  ts: 'typescript', typescript: 'typescript', tsx: 'tsx',
  js: 'javascript', javascript: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  py: 'python', python: 'python',
  json: 'json', yaml: 'yaml', yml: 'yaml', sql: 'sql', go: 'go', golang: 'go', rust: 'rust', rs: 'rust', css: 'css',
};

/** Prism token types -> a small palette (CSS class `hl-<x>`, colours from CSS variables). */
const PALETTE: Record<string, string> = {
  comment: 'c', prolog: 'c', doctype: 'c', cdata: 'c', shebang: 'c', coord: 'c',
  keyword: 'k', atrule: 'k', rule: 'k', important: 'k', 'control-flow': 'k',
  string: 's', char: 's', 'attr-value': 's', regex: 's', url: 's', 'template-string': 's',
  number: 'n', boolean: 'n', constant: 'n', symbol: 'n', entity: 'n',
  function: 'f', 'function-name': 'f',
  'class-name': 't', builtin: 't', namespace: 't', tag: 't', selector: 't', 'maybe-class-name': 't',
  property: 'p', 'attr-name': 'p', key: 'p', variable: 'p', parameter: 'p', 'assign-left': 'p',
  operator: 'o', punctuation: 'o',
  inserted: 'i', deleted: 'd',
};

/** A run of code text with its palette class ('' = plain). Joined, the texts give back the code. */
export type Seg = { text: string; cls: string };

/** Above this, no highlighting: bounds the cost of Prism's regexes on a pasted log. */
export const MAX_CODE = 20_000;

export function langOf(info: string | undefined): string | null {
  const word = (info ?? '').trim().split(/\s+/)[0].toLowerCase();
  return LANGS[word] ?? null;
}

function classOf(t: Token): string {
  // Own type first, then aliases (diff: `inserted-sign` has alias `inserted`; yaml: `key` has alias `atrule`).
  for (const n of [t.type, ...([] as string[]).concat(t.alias ?? [])]) if (PALETTE[n]) return PALETTE[n];
  return '';
}

function walk(stream: string | Token | Array<string | Token>, cls: string, out: Seg[]) {
  if (typeof stream === 'string') {
    if (!stream) return;
    const last = out[out.length - 1];
    if (last && last.cls === cls) last.text += stream; else out.push({ text: stream, cls });
  } else if (Array.isArray(stream)) for (const s of stream) walk(s, cls, out);
  else walk(stream.content, classOf(stream) || cls, out); // a nested token keeps its parent's colour unless it has its own
}

/** Segments for a fenced block, or null when it stays plain (no/unknown language, too long). */
export function highlight(code: string, info: string | undefined): Seg[] | null {
  const lang = langOf(info);
  const grammar = lang && Prism.languages[lang];
  if (!grammar || code.length > MAX_CODE) return null;
  const out: Seg[] = [];
  walk(Prism.tokenize(code, grammar), '', out);
  return out;
}
