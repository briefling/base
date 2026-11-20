// Team side of the flow config (docs/design-flow.md § 4.2, slice 3): who works the board (staff: agent -> roles),
// each agent's limits, GitHub identity and sheet, the humans and bots the engine trusts, the culture. Like the flow
// (protocol/flowcfg.ts), the truth is JSON and the engine's files are EMITTED (config.yml, culture.md, agents/<a>.md),
// never parsed. bundleFiles() is the whole bundle the hub pushes to the plugins (`flow.config`); the plugin loads it
// with the engine's load_company and answers ok / error. DOM-free and dependency-free: hub, client and tests share it.
import { flowFiles, yamlStr, type FlowDef } from './flowcfg.ts';

/** Per-agent limits the editor offers (engine config.py DEFAULT_LIMITS + the cost quotas of poll.py check_quota). */
export const LIMIT_KEYS = ['max_cost_per_day', 'max_cost_per_month', 'max_events_per_day', 'max_runs', 'max_review_rounds', 'poll_min'] as const;
export type LimitKey = typeof LIMIT_KEYS[number];
/** Bounds of each limit: costs in USD (decimals allowed), the others whole numbers; poll_min in minutes (floor 1). */
export const LIMIT_BOUNDS: Record<LimitKey, { min: number; max: number; int: boolean }> = {
  max_cost_per_day: { min: 0, max: 10_000, int: false }, max_cost_per_month: { min: 0, max: 100_000, int: false },
  max_events_per_day: { min: 1, max: 1000, int: true }, max_runs: { min: 1, max: 100, int: true },
  max_review_rounds: { min: 1, max: 50, int: true }, poll_min: { min: 1, max: 1440, int: true },
};
/**
 * One agent of the flow. roles: roles of the flow it holds (staff; empty = declared but given no work). identity: the
 * GitHub login of its App (without `[bot]`, '' = none): the engine treats that login as a machine, never as a human go.
 * limits: missing key = the engine's default. sheet: markdown sent with every task of this agent (agents/<name>.md).
 */
export interface FlowAgent { name: string; roles: string[]; identity: string; limits: Partial<Record<LimitKey, number>>; sheet: string }
/** A human whose items need no assignment label; agent '' = the first idle staff member takes them. */
export interface TrustedAuthor { login: string; agent: string }
export interface FlowTeam { agents: FlowAgent[]; trusted_authors: TrustedAuthor[]; trusted_bots: string[]; culture: string }
export const EMPTY_TEAM: FlowTeam = { agents: [], trusted_authors: [], trusted_bots: [], culture: '' };

export interface TeamIssue { path: string; code: TeamIssueCode }
export type TeamIssueCode = 'shape' | 'agent' | 'agent_dup' | 'agent_space' | 'role_unknown' | 'role_dup' | 'identity' | 'limit'
  | 'login' | 'login_dup' | 'login_machine' | 'route' | 'bot' | 'bot_dup' | 'text' | 'secret' | 'too_big';

export const MAX_TEAM_AGENTS = 20;
export const MAX_TRUSTED = 50;
export const MAX_BOTS = 20;
export const MAX_SHEET = 16_000;
export const MAX_CULTURE = 16_000;
/** The bundle (docs/design-flow.md § 4.2): what one `flow.config` frame carries, far below API Gateway's 128 KB. */
export const MAX_BUNDLE_BYTES = 64 * 1024;
export const MAX_BUNDLE_FILES = 200;
/**
 * The closed list of bundle paths: anything else (absolute, `..`, another folder, another extension) is refused by the
 * editor, the hub and the plugin. Same pattern in hermes-plugin/briefling/flowconfig.py BUNDLE_PATH_RE.
 */
export const BUNDLE_PATH_RE = /^(?:config\.yml|culture\.md|agents\/[a-z][a-z0-9_-]{0,31}\.md|flows\/[a-z0-9][a-z0-9_-]{0,39}\.yml|playbooks(?:\/[a-z0-9][a-z0-9_-]{0,63}){1,3}\.md)$/;
/** Credentials pasted by mistake (same shapes as flowcfg.ts, and the plugin's check): the bundle is refused. */
export const SECRET_RE = /-----BEGIN|app_key|(?:ghp_|gho_|ghu_|ghs_|ghr_|github_pat_)[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}/;

const AGENT = /^[a-z][a-z0-9_-]{0,31}$/;                                  // frames.ts AGENT_RE
const LOGIN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/;               // frames.ts GH_LOGIN_RE (lower case)
const BAD_TEXT = /\0|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function isObj(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}
function exactKeys(v: unknown, keys: string[]): v is Record<string, unknown> {
  return isObj(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
}
const isStr = (v: unknown): v is string => typeof v === 'string';
const strArr = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const LIMITS: readonly string[] = LIMIT_KEYS;

function shapeOk(t: unknown): t is FlowTeam {
  return exactKeys(t, ['agents', 'trusted_authors', 'trusted_bots', 'culture']) && isStr(t.culture) && strArr(t.trusted_bots)
    && Array.isArray(t.trusted_authors) && t.trusted_authors.every(a => exactKeys(a, ['login', 'agent']) && isStr(a.login) && isStr(a.agent))
    && Array.isArray(t.agents) && t.agents.every(a => exactKeys(a, ['name', 'roles', 'identity', 'limits', 'sheet'])
      && isStr(a.name) && strArr(a.roles) && isStr(a.identity) && isStr(a.sheet)
      && isObj(a.limits) && Object.entries(a.limits).every(([k, v]) => LIMITS.includes(k) && typeof v === 'number'));
}

/**
 * [] = valid. `spaceAgents`: only agents of the space can be staffed. `def`: roles must exist in the flow. Trusted
 * authors are humans only (config.py _trusted_authors): an agent name, an agent identity or a trusted bot there would
 * let an agent that read a booby-trapped issue hand work to another agent with no human in between.
 */
export function validateTeam(t: unknown, def: FlowDef, spaceAgents: readonly string[]): TeamIssue[] {
  if (!shapeOk(t)) return [{ path: 'team', code: 'shape' }];
  const out: TeamIssue[] = [];
  const add = (path: string, code: TeamIssueCode) => { out.push({ path, code }); };
  const roles = new Set(def.roles.map(r => r.name));
  if (t.agents.length > MAX_TEAM_AGENTS) add('team.agents', 'too_big');
  const names = new Set<string>();
  t.agents.forEach((a, i) => {
    const p = `team.agents.${i}`;
    if (!AGENT.test(a.name)) add(`${p}.name`, 'agent');
    else if (names.has(a.name)) add(`${p}.name`, 'agent_dup');
    else if (!spaceAgents.includes(a.name)) add(`${p}.name`, 'agent_space');
    names.add(a.name);
    const seen = new Set<string>();
    a.roles.forEach((r, j) => {
      if (!roles.has(r)) add(`${p}.roles.${j}`, 'role_unknown');
      else if (seen.has(r)) add(`${p}.roles.${j}`, 'role_dup');
      seen.add(r);
    });
    if (a.identity !== '' && !LOGIN.test(a.identity)) add(`${p}.identity`, 'identity');
    for (const [k, v] of Object.entries(a.limits)) {
      const b = LIMIT_BOUNDS[k as LimitKey];
      if (!Number.isFinite(v) || v < b.min || v > b.max || (b.int && !Number.isInteger(v))) add(`${p}.limits.${k}`, 'limit');
    }
    if (a.sheet.length > MAX_SHEET) add(`${p}.sheet`, 'too_big');
  });
  const staffed = new Set(t.agents.filter(a => a.roles.length).map(a => a.name));
  const bots = new Set<string>();
  if (t.trusted_bots.length > MAX_BOTS) add('team.trusted_bots', 'too_big');
  t.trusted_bots.forEach((b, i) => {
    if (!LOGIN.test(b)) add(`team.trusted_bots.${i}`, 'bot');
    else if (bots.has(b)) add(`team.trusted_bots.${i}`, 'bot_dup');
    bots.add(b);
  });
  const machines = new Set([...names, ...t.agents.map(a => a.identity).filter(Boolean), ...bots]);
  const logins = new Set<string>();
  if (t.trusted_authors.length > MAX_TRUSTED) add('team.trusted_authors', 'too_big');
  t.trusted_authors.forEach((a, i) => {
    const p = `team.trusted_authors.${i}`;
    if (!LOGIN.test(a.login)) add(`${p}.login`, 'login');
    else if (logins.has(a.login)) add(`${p}.login`, 'login_dup');
    else if (machines.has(a.login)) add(`${p}.login`, 'login_machine');
    logins.add(a.login);
    if (a.agent !== '' && !staffed.has(a.agent)) add(`${p}.agent`, 'route');
  });
  if (t.culture.length > MAX_CULTURE) add('team.culture', 'too_big');
  for (const [path, s] of teamStrings(t)) {
    if (BAD_TEXT.test(s)) add(path, 'text');
    if (SECRET_RE.test(s)) add(path, 'secret');
  }
  return out;
}

function teamStrings(t: FlowTeam): [string, string][] {
  const out: [string, string][] = [['team.culture', t.culture]];
  t.agents.forEach((a, i) => { out.push([`team.agents.${i}.name`, a.name], [`team.agents.${i}.identity`, a.identity], [`team.agents.${i}.sheet`, a.sheet]); });
  t.trusted_authors.forEach((a, i) => { out.push([`team.trusted_authors.${i}.login`, a.login]); });
  t.trusted_bots.forEach((b, i) => { out.push([`team.trusted_bots.${i}`, b]); });
  return out;
}

/** Where the flow runs: the space (= the engine's department), its GitHub Project, its attached repos. */
export interface BundleTarget { space: string; board: { owner: string; number: number } | null; repos: string[] }

/** Text of config.yml: one department (the space), the agents, the trusted bots. Deterministic. */
export function configYaml(def: FlowDef, t: FlowTeam, target: BundleTarget): string {
  const L = ['# Company config: generated by briefling (edit it in the flow editor, not here).', 'departments:', `  ${yamlStr(target.space)}:`, `    flow: ${yamlStr(def.name)}`];
  if (target.board) L.push('    board:', `      type: ${yamlStr('github-projects')}`, `      owner: ${yamlStr(target.board.owner)}`, `      number: ${target.board.number}`);
  L.push(target.repos.length ? '    repos:' : '    repos: []', ...target.repos.map(r => `      - ${yamlStr(r)}`));
  const staff = t.agents.filter(a => a.roles.length);
  L.push(staff.length ? '    staff:' : '    staff: {}');
  for (const a of staff) L.push(`      ${yamlStr(a.name)}:`, ...a.roles.map(r => `        - ${yamlStr(r)}`));
  if (t.trusted_authors.length) L.push('    trusted_authors:', ...t.trusted_authors.map(a => `      ${yamlStr(a.login)}: ${a.agent ? yamlStr(a.agent) : 'null'}`));
  L.push('', t.agents.length ? 'agents:' : 'agents: {}');
  for (const a of t.agents) {
    const limits = LIMIT_KEYS.filter(k => a.limits[k] !== undefined);
    if (!a.identity && !limits.length) { L.push(`  ${yamlStr(a.name)}: {}`); continue; }
    L.push(`  ${yamlStr(a.name)}:`);
    if (a.identity) L.push(`    identity: ${yamlStr(a.identity)}`);
    if (limits.length) L.push('    limits:', ...limits.map(k => `      ${k}: ${String(a.limits[k])}`));
  }
  if (t.trusted_bots.length) L.push('', 'trusted_bots:', ...t.trusted_bots.map(b => `  - ${yamlStr(b)}`));
  return L.join('\n') + '\n';
}

export interface BundleFile { path: string; text: string }
/** The whole bundle: config.yml, culture.md and the agents' sheets when written, the flow and its playbooks. */
export function bundleFiles(def: FlowDef, t: FlowTeam, target: BundleTarget): BundleFile[] {
  return [
    { path: 'config.yml', text: configYaml(def, t, target) },
    ...(t.culture.trim() ? [{ path: 'culture.md', text: t.culture }] : []),
    ...t.agents.filter(a => a.sheet.trim()).map(a => ({ path: `agents/${a.name}.md`, text: a.sheet })),
    ...flowFiles(def),
  ];
}

export type BundleIssue = { path: string; code: 'path' | 'path_dup' | 'secret' | 'too_big' };
/** The bundle's own gate (paths in the closed list, size, count, no credential): run on every bundle sent or read. */
export function bundleIssues(files: BundleFile[]): BundleIssue[] {
  const out: BundleIssue[] = [];
  const seen = new Set<string>();
  let bytes = 0;
  for (const f of files) {
    if (!BUNDLE_PATH_RE.test(f.path)) out.push({ path: f.path, code: 'path' });
    else if (seen.has(f.path)) out.push({ path: f.path, code: 'path_dup' });
    seen.add(f.path);
    if (SECRET_RE.test(f.text)) out.push({ path: f.path, code: 'secret' });
    bytes += new TextEncoder().encode(f.path + f.text).length;
  }
  if (files.length > MAX_BUNDLE_FILES || bytes > MAX_BUNDLE_BYTES) out.push({ path: '', code: 'too_big' });
  return out;
}

/** One text for a line diff of the team between two versions (same rendering as flowText). */
export function teamText(t: FlowTeam): string {
  const L: string[] = [];
  for (const a of t.agents) {
    L.push(`=== agent ${a.name} ===`, `roles: ${a.roles.join(', ') || '-'}`, `identity: ${a.identity || '-'}`,
      ...LIMIT_KEYS.filter(k => a.limits[k] !== undefined).map(k => `${k}: ${a.limits[k]}`));
    if (a.sheet) L.push('--- sheet ---', ...a.sheet.replace(/\n$/, '').split('\n'));
  }
  L.push('=== trusted authors ===', ...t.trusted_authors.map(a => `${a.login} -> ${a.agent || 'first idle'}`));
  L.push('=== trusted bots ===', ...t.trusted_bots);
  L.push('=== culture ===', ...(t.culture ? t.culture.replace(/\n$/, '').split('\n') : []));
  return L.join('\n') + '\n';
}

/** The flow's column where humans merge (state `approved`, required by validateFlow): the Merge button's column. */
export const approvedColumn = (def: FlowDef): string | null => def.states.find(s => s.key === 'approved')?.column ?? null;
/** The flow's columns where work is under way: from `doing`'s (included) to `approved`'s (excluded), in the flow's order
 *  (« In progress », « In review » in the dev flow). A board-driven thread Quiet in one of them is shown In progress.
 *  Empty when either state is missing or `approved` comes first. */
export function workColumns(def: FlowDef): string[] {
  const i = def.states.findIndex(s => s.key === 'doing'), j = def.states.findIndex(s => s.key === 'approved');
  return i < 0 || j <= i ? [] : def.states.slice(i, j).map(s => s.column);
}

// ---------------------------------------------------------------- source (docs/design-flow.md § 4.2)
/**
 * Where the config lives. null = briefling (versions in the hub only). A git source = one of the space's attached repos,
 * a branch and a folder: each save is a normal commit there (only the files the save changes, on the branch's current
 * head), refused only when one of those files changed in the repo since the editor read it; the agents get the
 * bundle files read at the branch head (so a commit made outside briefling reaches them too).
 * readonly: briefling never writes the repo (a save only stores the team and the flow for briefling's own use: who is
 * staffed, the Merge column); the agents get the repo's files as they are. For a repo agents still on unstrikeable
 * read (loom: `uplift/hq`), whose config.yml names its own departments (the engine's event keys start with them).
 */
export interface FlowSource { repo: string; branch: string; dir: string; readonly?: true }
/** Branch names git accepts, narrowed: no `..`, no `//`, no leading `-` or `/`, no trailing `/` or `.lock`. */
export const BRANCH_RE = /^(?![-/])(?!.*\.\.)(?!.*\/\/)(?!.*\/$)(?!.*\.lock$)[A-Za-z0-9._/-]{1,100}$/;
/** '' = the repo's root; else up to 5 folders, no `.`/`..` segment. */
export const DIR_RE = /^(?:[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}){0,4})?$/;
/** A valid source for a space whose attached repos are `repos` (case-insensitive, like GitHub). null is valid. */
export function sourceOk(s: unknown, repos: readonly string[]): s is FlowSource | null {
  if (s === null) return true;
  if (typeof s !== 'object' || Array.isArray(s)) return false;
  const o = s as Record<string, unknown>;
  const keys = Object.keys(o).length;
  return (keys === 3 || (keys === 4 && o.readonly === true)) && typeof o.repo === 'string' && typeof o.branch === 'string' && typeof o.dir === 'string'
    && repos.some(r => r.toLowerCase() === (o.repo as string).toLowerCase()) && BRANCH_RE.test(o.branch) && DIR_RE.test(o.dir);
}
export const sameSource = (a: FlowSource | null | undefined, b: FlowSource | null | undefined) =>
  (!a && !b) || (!!a && !!b && a.repo.toLowerCase() === b.repo.toLowerCase() && a.branch === b.branch && a.dir === b.dir && !a.readonly === !b.readonly);
/** Path of a bundle file in the repo. */
export const repoPath = (src: FlowSource, path: string) => src.dir ? `${src.dir}/${path}` : path;
