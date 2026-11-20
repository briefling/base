// Board flow definition edited in the flow editor (docs/design-flow.md): the truth is this JSON structure (FlowDef);
// the YAML read by the plugin's engine (hermes-plugin/briefling/flow/config.py `load_flow`) is only EMITTED from it,
// never parsed here. Every user string and user key is emitted as a JSON-quoted string, which is a valid YAML
// double-quoted scalar, so `on`/`yes`/`null`/`#`/`: ` stay plain strings under YAML 1.1. DOM-free and
// dependency-free: hub, client and tests share it.

export const FLOW_TRIGGERS = ['item_new', 'human_comment', 'new_comment', 'assigned', 'pr_updated', 'pr_conflict', 'ci_failed'] as const;
export type FlowTrigger = typeof FLOW_TRIGGERS[number];
/** State keys the engine reads by name (events.py: an item without state is `backlog`, URGENT_STATES doing/approved). */
export const REQUIRED_STATES = ['backlog', 'doing', 'approved'] as const;
/**
 * all = no label, acts on every item (pm, planner); label = label `<name>:{agent}`; auto = same label + `auto: true`
 * (unlabelled item: first staff member with the role); human = `human: true`, no triggers.
 */
export type RoleAssign = 'all' | 'label' | 'auto' | 'human';
export interface FlowState { key: string; column: string }
/**
 * color: 6 lowercase hex without '#', or '' = none; only for label/auto (emitted in label_colors keyed by role name).
 * on: state key -> triggers (emitted in FLOW_TRIGGERS order: the engine lets item_new silence human_comment only when
 * it comes first). playbooks: trigger -> playbook file name (FlowPlaybook.file).
 */
export interface FlowRole { name: string; assign: RoleAssign; color: string; on: Record<string, FlowTrigger[]>; playbooks: Partial<Record<FlowTrigger, string>> }
export interface FlowPlaybook { file: string; body: string }
export interface FlowDef { name: string; states: FlowState[]; roles: FlowRole[]; kinds: string[]; playbooks: FlowPlaybook[]; artifact: string }
export interface FlowIssue { path: string; code: FlowIssueCode }
export type FlowIssueCode = 'shape' | 'name' | 'state_key' | 'state_dup' | 'column' | 'column_dup' | 'state_required' | 'no_role' | 'role_name' | 'role_dup' | 'trigger' | 'trigger_dup' | 'state_unknown' | 'human_triggers' | 'color' | 'playbook_missing' | 'playbook_unknown' | 'playbook_unused' | 'kind' | 'kind_dup' | 'file' | 'file_dup' | 'file_unused' | 'artifact' | 'text' | 'too_big' | 'secret';

export const MAX_FLOW_BYTES = 64 * 1024;   // JSON.stringify(def), UTF-8 bytes
export const MAX_STATES = 20;
export const MAX_ROLES = 20;
export const MAX_KINDS = 30;
export const MAX_PLAYBOOKS = 40;
export const MAX_COLUMN = 60;
export const MAX_KIND = 40;
export const MAX_BODY = 16_000;
export const MAX_ARTIFACT = 200;

const SLUG = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const KIND_RE = /^[a-z0-9][a-z0-9_-]*$/;          // config.py KIND_RE
const FILE_RE = /^[a-z0-9][a-z0-9_-]*\.md$/;
const COLOR_RE = /^[0-9a-f]{6}$/;
const ASSIGNS: readonly string[] = ['all', 'label', 'auto', 'human'];
const SECRET = /-----BEGIN|app_key|(?:ghp_|gho_|ghu_|ghs_|ghr_|github_pat_)[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}/;
const BAD_TEXT = /\0|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

// ---------------------------------------------------------------- shape (untrusted input)
function isObj(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}
function exactKeys(v: unknown, keys: string[]): v is Record<string, unknown> {
  if (!isObj(v)) return false;
  const k = Object.keys(v);
  return k.length === keys.length && keys.every(x => Object.hasOwn(v, x));
}
const isStr = (v: unknown): v is string => typeof v === 'string';
const strArr = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);

function shapeOk(d: unknown): d is FlowDef {
  if (!exactKeys(d, ['name', 'states', 'roles', 'kinds', 'playbooks', 'artifact'])) return false;
  if (!isStr(d.name) || !isStr(d.artifact) || !strArr(d.kinds)) return false;
  if (!Array.isArray(d.states) || !d.states.every(s => exactKeys(s, ['key', 'column']) && isStr(s.key) && isStr(s.column))) return false;
  if (!Array.isArray(d.playbooks) || !d.playbooks.every(p => exactKeys(p, ['file', 'body']) && isStr(p.file) && isStr(p.body))) return false;
  return Array.isArray(d.roles) && d.roles.every(r => exactKeys(r, ['name', 'assign', 'color', 'on', 'playbooks'])
    && isStr(r.name) && isStr(r.assign) && ASSIGNS.includes(r.assign) && isStr(r.color)
    && isObj(r.on) && Object.values(r.on).every(strArr)
    && isObj(r.playbooks) && Object.values(r.playbooks).every(isStr));
}

// ---------------------------------------------------------------- validation
/** [] = valid. Every issue found, in a stable order (field order of the def, then text/secret scan, then size). */
export function validateFlow(d: unknown): FlowIssue[] {
  if (!shapeOk(d)) return [{ path: '', code: 'shape' }];
  const out: FlowIssue[] = [];
  const add = (path: string, code: FlowIssueCode) => { out.push({ path, code }); };
  const triggers: readonly string[] = FLOW_TRIGGERS;

  if (!SLUG.test(d.name)) add('name', 'name');

  // states
  const keys = new Set<string>(), cols = new Set<string>();
  d.states.forEach((s, i) => {
    if (!SLUG.test(s.key)) add(`states.${i}.key`, 'state_key');
    else if (keys.has(s.key)) add(`states.${i}.key`, 'state_dup');
    keys.add(s.key);
    const c = s.column.trim().toLowerCase();
    if (!c || s.column.length > MAX_COLUMN) add(`states.${i}.column`, 'column');
    else if (cols.has(c)) add(`states.${i}.column`, 'column_dup');
    cols.add(c);
  });
  if (!REQUIRED_STATES.every(k => keys.has(k))) add('states', 'state_required');
  if (d.states.length > MAX_STATES) add('states', 'too_big');

  // roles
  const files = new Set(d.playbooks.map(p => p.file)), usedFiles = new Set<string>();
  if (!d.roles.length) add('roles', 'no_role');
  if (d.roles.length > MAX_ROLES) add('roles', 'too_big');
  const names = new Set<string>();
  d.roles.forEach((r, i) => {
    const p = `roles.${i}`;
    if (!SLUG.test(r.name)) add(`${p}.name`, 'role_name');
    else if (names.has(r.name)) add(`${p}.name`, 'role_dup');
    names.add(r.name);
    const labelled = r.assign === 'label' || r.assign === 'auto';
    if (r.color !== '' && (!labelled || !COLOR_RE.test(r.color))) add(`${p}.color`, 'color');
    const used = new Set<string>();
    for (const [st, trs] of Object.entries(r.on)) {
      if (!keys.has(st)) add(`${p}.on.${st}`, 'state_unknown');
      const seen = new Set<string>();
      trs.forEach((t, j) => {
        if (!triggers.includes(t)) add(`${p}.on.${st}.${j}`, 'trigger');
        else if (seen.has(t)) add(`${p}.on.${st}.${j}`, 'trigger_dup');
        seen.add(t); used.add(t);
      });
    }
    const pbs = Object.entries(r.playbooks) as [string, string][];
    if (r.assign === 'human') {
      if (used.size || pbs.length) add(p, 'human_triggers');
      return;
    }
    for (const t of FLOW_TRIGGERS) if (used.has(t) && !Object.hasOwn(r.playbooks, t)) add(`${p}.playbooks.${t}`, 'playbook_missing');
    for (const [t, f] of pbs) {
      if (!triggers.includes(t)) add(`${p}.playbooks.${t}`, 'trigger');
      else if (!used.has(t)) add(`${p}.playbooks.${t}`, 'playbook_unused');
      if (!files.has(f)) add(`${p}.playbooks.${t}`, 'playbook_unknown');
      usedFiles.add(f);
    }
  });

  // kinds
  if (d.kinds.length > MAX_KINDS) add('kinds', 'too_big');
  const kinds = new Set<string>();
  d.kinds.forEach((k, i) => {
    if (!KIND_RE.test(k) || k.length > MAX_KIND) add(`kinds.${i}`, 'kind');
    else if (kinds.has(k)) add(`kinds.${i}`, 'kind_dup');
    kinds.add(k);
  });

  // playbook files
  if (d.playbooks.length > MAX_PLAYBOOKS) add('playbooks', 'too_big');
  const seenFiles = new Set<string>();
  d.playbooks.forEach((pb, i) => {
    if (!FILE_RE.test(pb.file)) add(`playbooks.${i}.file`, 'file');
    else if (seenFiles.has(pb.file)) add(`playbooks.${i}.file`, 'file_dup');
    else if (!usedFiles.has(pb.file)) add(`playbooks.${i}.file`, 'file_unused');
    seenFiles.add(pb.file);
    if (pb.body.length > MAX_BODY) add(`playbooks.${i}.body`, 'too_big');
  });

  const a = d.artifact;
  if (a && (a.length > MAX_ARTIFACT || a.includes('..') || a.startsWith('/'))) add('artifact', 'artifact');

  // every string: NUL / lone surrogate, then credentials pasted by mistake
  for (const [path, s] of strings(d)) {
    if (BAD_TEXT.test(s)) add(path, 'text');
    if (SECRET.test(s)) add(path, 'secret');
  }
  if (new TextEncoder().encode(JSON.stringify(d)).length > MAX_FLOW_BYTES) add('', 'too_big');
  return out;
}

function strings(d: FlowDef): [string, string][] {
  const out: [string, string][] = [['name', d.name]];
  d.states.forEach((s, i) => { out.push([`states.${i}.key`, s.key], [`states.${i}.column`, s.column]); });
  d.roles.forEach((r, i) => {
    out.push([`roles.${i}.name`, r.name], [`roles.${i}.color`, r.color]);
    for (const [st, trs] of Object.entries(r.on)) trs.forEach((t, j) => { out.push([`roles.${i}.on.${st}.${j}`, t]); });
    for (const [t, f] of Object.entries(r.playbooks)) out.push([`roles.${i}.playbooks.${t}`, f as string]);
  });
  d.kinds.forEach((k, i) => { out.push([`kinds.${i}`, k]); });
  d.playbooks.forEach((p, i) => { out.push([`playbooks.${i}.file`, p.file], [`playbooks.${i}.body`, p.body]); });
  out.push(['artifact', d.artifact]);
  return out;
}

// ---------------------------------------------------------------- YAML emission
/**
 * A YAML double-quoted scalar the engine's YAML 1.1 readers (ruamel via hermes_yaml, PyYAML) read back verbatim:
 * JSON.stringify, then \uXXXX for what it leaves raw but YAML 1.1 rejects (DEL, C1, U+FFFE/FFFF, BOM) or folds as a
 * line break (U+0085, U+2028, U+2029). Valid surrogate pairs (emoji) stay raw.
 */
export function yamlStr(s: string): string {
  return JSON.stringify(s).replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\u2027\u202A-\uD7FF\uE000-\uFEFE\uFF00-\uFFFD\uD800-\uDFFF]/g,
    c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

const playbookPath = (d: FlowDef, file: string) => `playbooks/${d.name}/${file}`;

/** Text of flows/<name>.yml, deterministic, layout of the shipped flows/dev.yml. */
export function flowYaml(d: FlowDef): string {
  const L: string[] = [`# Flow ${d.name}: generated by briefling (edit it in the flow editor, not here).`, 'states:'];
  for (const s of d.states) L.push(`  - key: ${yamlStr(s.key)}`, `    column: ${yamlStr(s.column)}`);
  L.push('', 'roles:');
  for (const r of d.roles) {
    const body: string[] = [];
    if (r.assign === 'label' || r.assign === 'auto') body.push(`    label: ${yamlStr(`${r.name}:{agent}`)}`);
    if (r.assign === 'auto') body.push('    auto: true');
    if (r.assign === 'human') body.push('    human: true');
    const on: string[] = [];
    for (const s of d.states) {
      const trs = FLOW_TRIGGERS.filter(t => (Object.hasOwn(r.on, s.key) ? r.on[s.key] : []).includes(t));
      if (trs.length) on.push(`      ${yamlStr(s.key)}:`, ...trs.map(t => `        - ${yamlStr(t)}`));
    }
    if (on.length) body.push('    "on":', ...on);
    L.push(body.length ? `  ${yamlStr(r.name)}:` : `  ${yamlStr(r.name)}: {}`, ...body);
  }
  if (d.kinds.length) L.push('', 'kinds:', ...d.kinds.map(k => `  - ${yamlStr(k)}`));
  const colors = d.roles.filter(r => r.color);
  if (colors.length) L.push('', 'label_colors:', ...colors.map(r => `  ${yamlStr(r.name)}: ${yamlStr(r.color)}`));
  const pbs: string[] = [];
  for (const r of d.roles) for (const t of FLOW_TRIGGERS) {
    const f = r.playbooks[t];
    if (f !== undefined) pbs.push(`  ${yamlStr(`${r.name}.${t}`)}: ${yamlStr(playbookPath(d, f))}`);
  }
  if (pbs.length) L.push('', 'playbooks:', ...pbs);
  if (d.artifact) L.push('', 'artifact:', `  path: ${yamlStr(d.artifact)}`);
  return L.join('\n') + '\n';
}

/** Files of the flow, relative to the config repo: the YAML, then the playbooks in file order. */
export function flowFiles(d: FlowDef): { path: string; text: string }[] {
  return [{ path: `flows/${d.name}.yml`, text: flowYaml(d) }, ...d.playbooks.map(p => ({ path: playbookPath(d, p.file), text: p.body }))];
}

/** One text for a line diff between two versions of a flow. */
export function flowText(d: FlowDef): string {
  return flowFiles(d).map(f => `=== ${f.path} ===\n${f.text}${f.text === '' || f.text.endsWith('\n') ? '' : '\n'}`).join('');
}
