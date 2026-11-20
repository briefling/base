// Cross-language fixtures of the flow editor: for each template and one tricky def, the files flowFiles emits plus
// the def itself (expected.json). hermes-plugin/tests/flow/test_editor_yaml.py loads them with the engine's
// load_flow; client/test/flowcfg.test.ts checks the committed files equal fixtures(), so they never go stale.
// Run `node scripts/flow-fixtures.ts` after changing protocol/flowcfg.ts, protocol/flowteam.ts or the templates.
// Second set (slice 3): data/bundle/ = a whole bundle (bundleFiles: config.yml, culture, sheets, flow) with
// expected.json {def, team, target}; hermes-plugin/tests/flow/test_bundle.py loads it with load_company.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { flowFiles, type FlowDef } from '../protocol/flowcfg.ts';
import { FLOW_TEMPLATES } from '../protocol/flow-templates.ts';
import { bundleFiles, type BundleTarget, type FlowTeam } from '../protocol/flowteam.ts';

export const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'hermes-plugin', 'tests', 'flow', 'data', 'editor');
export const BUNDLE_DIR = join(FIXTURES_DIR, '..', 'bundle');

/** YAML traps in the team too: a space `yes`, agents `on` / `null`, a trusted human `yes`, decimals, an idle agent. */
export const BUNDLE_TARGET: BundleTarget = { space: 'yes', board: { owner: 'acme', number: 4 }, repos: ['acme/on', 'acme/x.y'] };
export const BUNDLE_TEAM: FlowTeam = {
  agents: [
    { name: 'on', roles: ['pm', 'dev'], identity: 'on-bot', limits: { max_cost_per_day: 2.5, max_cost_per_month: 30, max_events_per_day: 10, poll_min: 1 }, sheet: '# On\n\nSheet: "x" #1 été\n' },
    { name: 'null', roles: ['review'], identity: '', limits: { max_review_rounds: 2 }, sheet: '' },
    { name: 'kevin', roles: [], identity: '', limits: {}, sheet: 'idle' },
  ],
  trusted_authors: [{ login: 'yes', agent: '' }, { login: 'blair-gh', agent: 'on' }],
  trusted_bots: ['briefling-app'],
  culture: 'Culture: "x" #1 — no secrets.\n',
};
export function bundleFixtures(): { path: string; text: string }[] {
  const def = FLOW_TEMPLATES.dev;
  return [...bundleFiles(def, BUNDLE_TEAM, BUNDLE_TARGET),
    { path: 'expected.json', text: JSON.stringify({ def, team: BUNDLE_TEAM, target: BUNDLE_TARGET }, null, 2) + '\n' }];
}

/** YAML 1.1 traps: keys `on`/`yes`/`no`/`null`, quotes, `: `, ` #`, accents, emoji, line/next-line separators, tab. */
export const TRICKY: FlowDef = {
  name: 'tricky',
  states: [
    { key: 'backlog', column: 'Back "log" \\ \'q\'' },
    { key: 'ready', column: 'Ready: set # go' },
    { key: 'doing', column: 'Été — à faire 🚀' },
    { key: 'approved', column: 'To merge \u2028 now\t\u0085 \u007f' },
    { key: 'no', column: 'null' },
    { key: 'y', column: 'yes' },
  ],
  roles: [
    { name: 'on', assign: 'label', color: '1d76db', on: { ready: ['assigned'], approved: ['pr_conflict', 'human_comment'] },
      playbooks: { assigned: 'take.md', pr_conflict: 'fix.md', human_comment: 'fix.md' } },
    { name: 'yes', assign: 'all', color: '', on: { backlog: ['human_comment', 'item_new'], no: ['new_comment'] },
      playbooks: { item_new: 'take.md', human_comment: 'take.md', new_comment: 'take.md' } },
    { name: 'off', assign: 'auto', color: '', on: { y: ['ci_failed', 'pr_updated'] }, playbooks: { ci_failed: 'fix.md', pr_updated: 'fix.md' } },
    { name: 'null', assign: 'human', color: '', on: {}, playbooks: {} },
    { name: 'true', assign: 'all', color: '', on: {}, playbooks: {} },
  ],
  kinds: ['no', 'null', 'on', '1'],
  playbooks: [
    { file: 'take.md', body: '# Take: "it" #now\n\nKey: value, `code`, été 🚀\u2028and\ttab.\n' },
    { file: 'fix.md', body: 'no trailing newline: {agent} ${x}' },
  ],
  artifact: '{yyyy}/{mm}/x: y #z — é.md',
};

export function fixtures(): { path: string; text: string }[] {
  const cases: [string, FlowDef][] = [['dev', FLOW_TEMPLATES.dev], ['content', FLOW_TEMPLATES.content], ['tricky', TRICKY]];
  return cases.flatMap(([c, d]) => [
    ...flowFiles(d).map(f => ({ path: `${c}/${f.path}`, text: f.text })),
    { path: `${c}/expected.json`, text: JSON.stringify(d, null, 2) + '\n' },
  ]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const [dir, files] of [[FIXTURES_DIR, fixtures()], [BUNDLE_DIR, bundleFixtures()]] as const) {
    for (const f of files) {
      const p = join(dir, f.path);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, f.text);
    }
    console.log(`wrote ${files.length} files in ${dir}`);
  }
}
