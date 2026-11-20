/** Activity of a working agent, read from the status phrases Hermes sends (`thread.status`): « is running grep … »,
 *  « is editing main.ts… », « is using memory_search… » (hermes-agent `build_status_phrase`, English locale). Shown as
 *  the verb of the working line (« Milan is searching… ») instead of the plain « is working… ». A parse of English
 *  phrases is fragile by nature: anything not recognised falls back to `work`, which reads exactly as before. */

export type Activity = 'search' | 'read' | 'code' | 'test' | 'deploy' | 'commit' | 'docs' | 'look' | 'delegate' | 'note' | 'work';

/** Hermes tool verbs (locales/en.yaml `display.verb`), lowercased, longest first so « running code » wins over « running ». */
const VERBS: [string, Activity | 'cmd'][] = [
  ['searching the web', 'docs'], ['searching past sessions', 'search'], ['searching files', 'search'], ['searching', 'search'],
  ['looking at the image', 'look'], ['browsing', 'look'], ['clicking', 'look'], ['typing', 'look'],
  ['running code', 'cmd'], ['running', 'cmd'],
  ['reading skill', 'docs'], ['listing skills', 'docs'], ['reading', 'read'],
  ['writing', 'code'], ['editing', 'code'],
  ['updating skill', 'note'], ['updating memory', 'note'], ['updating tasks', 'note'],
  ['delegating', 'delegate'],
];

/** Shell command → activity, most telling first: a chain « npm test && git commit && npm run deploy » is a deploy. */
const CMDS: [RegExp, Activity][] = [
  [/\bnpm run deploy\b|\bcdk (deploy|synth|diff)\b|\bpublish-(plugin|acp-bridge)\b/, 'deploy'],
  [/\bgit (commit|push|cherry-pick|rebase|am)\b/, 'commit'],
  [/\bnpm (run )?test\b|\bnode --test\b|\bpytest\b|\btsc\b|\bui-render\b|\be2e\b|\bvitest\b|\bjest\b/, 'test'],
  [/\bsed -i\b|\bpatch\b|\bgit apply\b|\bwrite_file\b/, 'code'],
  [/\bgrep\b|\brg\b|\bsed -n\b|\bgit (log|grep|show|diff|blame)\b|\bfind\b|\bsearch_files\b/, 'search'],
  [/\bcat\b|\bhead\b|\btail\b|\bless\b|\bread_file\b/, 'read'],
  [/\bcurl\b|\bweb_(search|extract)\b/, 'docs'],
];

/** Agent tools seen as « is using <tool> » (MCP and plugin tools have no Hermes verb). */
const TOOLS: [RegExp, Activity][] = [
  [/(^|_)(search|read|list|get)(_|$)|^thread_read$|^space_threads$/, 'search'],
  [/(^|_)(propose|tag|note)(_|$)|^memory/, 'note'],
];

export function activityOf(phrase: string | null | undefined): Activity {
  const s = (phrase ?? '').trim().replace(/…$/, '').replace(/^is /i, '').toLowerCase();
  if (!s) return 'work';
  const using = /^using (\S+)/.exec(s);
  if (using) return TOOLS.find(([re]) => re.test(using[1]))?.[1] ?? 'work';
  const hit = VERBS.find(([v]) => s === v || s.startsWith(v + ' '));
  if (!hit) return 'work';
  const rest = s.slice(hit[0].length).trim();
  if (hit[1] === 'read' && /^https?:/.test(rest)) return 'docs'; // web_extract also says « Reading »
  if (hit[1] !== 'cmd') return hit[1];
  return CMDS.find(([re]) => re.test(rest))?.[1] ?? 'work';
}

/** Verb of the working line, steadied over the last 3 phrases so it does not blink at each tool: the most frequent
 *  recognised activity, ties to the latest. `recent` is oldest first (status.recent); `current` is the live phrase. */
export function steadyActivity(recent: readonly string[] | undefined, current?: string | null): Activity {
  const list = [...(recent ?? [])];
  if (current && list[list.length - 1] !== current) list.push(current);
  const last = list.slice(-3).map(activityOf).filter(a => a !== 'work');
  let best: Activity = 'work', n = 0;
  for (let i = last.length - 1; i >= 0; i--) {
    const c = last.filter(a => a === last[i]).length;
    if (c > n) { best = last[i]; n = c; }
  }
  return best;
}
