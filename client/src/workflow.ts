// Flow editor (docs/design-flow.md slice 2): the form's edits on the flow definition, DOM-free. Every edit returns a
// new def and keeps it coherent where the intent is unambiguous (a renamed column key follows into the roles' triggers,
// a removed playbook leaves its triggers without one); what needs a human choice is left to validateFlow to report.
import { FLOW_TRIGGERS, flowText, type FlowDef, type FlowIssue, type FlowRole, type FlowTrigger, type RoleAssign } from '../../protocol/flowcfg.ts';
import { FLOW_TEMPLATES } from '../../protocol/flow-templates.ts';
import { lineDiff, type DiffLine } from './about.ts';
import { teamText, type FlowAgent, type FlowTeam, type LimitKey, type TrustedAuthor } from '../../protocol/flowteam.ts';

export type FlowTemplate = keyof typeof FLOW_TEMPLATES;
export const fromTemplate = (name: FlowTemplate): FlowDef => structuredClone(FLOW_TEMPLATES[name]);

const move = <T>(xs: T[], i: number, delta: number): T[] => {
  const j = i + delta;
  if (i < 0 || i >= xs.length || j < 0 || j >= xs.length) return xs;
  const out = xs.slice(); [out[i], out[j]] = [out[j], out[i]]; return out;
};
const triggersUsed = (r: FlowRole): Set<FlowTrigger> => new Set(Object.values(r.on).flat());
/** Playbook entries only for the triggers the role still uses. */
const prune = (r: FlowRole): FlowRole => {
  const used = triggersUsed(r);
  return { ...r, playbooks: Object.fromEntries(Object.entries(r.playbooks).filter(([t]) => used.has(t as FlowTrigger))) };
};
const mapRoles = (d: FlowDef, f: (r: FlowRole) => FlowRole): FlowDef => ({ ...d, roles: d.roles.map(f) });

// ---------------------------------------------------------------- columns (states)
export function addState(d: FlowDef): FlowDef {
  let n = d.states.length + 1;
  while (d.states.some(s => s.key === `state${n}`)) n++;
  return { ...d, states: [...d.states, { key: `state${n}`, column: '' }] };
}
/** New key: the roles' triggers in that column follow it (unless it collides, then validateFlow says state_dup). */
export function setStateKey(d: FlowDef, i: number, key: string): FlowDef {
  const old = d.states[i]?.key;
  if (old === undefined || old === key) return d;
  const clash = d.states.some(s => s.key === key);
  const states = d.states.map((s, j) => j === i ? { ...s, key } : s);
  if (clash) return { ...d, states };
  return mapRoles({ ...d, states }, r => old in r.on
    ? { ...r, on: Object.fromEntries(Object.entries(r.on).map(([k, v]) => [k === old ? key : k, v])) } : r);
}
export const setColumn = (d: FlowDef, i: number, column: string): FlowDef => ({ ...d, states: d.states.map((s, j) => j === i ? { ...s, column } : s) });
export const moveState = (d: FlowDef, i: number, delta: number): FlowDef => { const states = move(d.states, i, delta); return states === d.states ? d : { ...d, states }; };
/** Removing a column removes the reactions in it (and the playbook links of triggers no longer used). */
export function removeState(d: FlowDef, i: number): FlowDef {
  const key = d.states[i]?.key;
  if (key === undefined) return d;
  const states = d.states.filter((_, j) => j !== i);
  if (states.some(s => s.key === key)) return { ...d, states }; // a duplicate key: the other column keeps the reactions
  return mapRoles({ ...d, states }, r => prune({ ...r, on: Object.fromEntries(Object.entries(r.on).filter(([k]) => k !== key)) }));
}

// ---------------------------------------------------------------- roles
export function addRole(d: FlowDef): FlowDef {
  let n = d.roles.length + 1;
  while (d.roles.some(r => r.name === `role${n}`)) n++;
  return { ...d, roles: [...d.roles, { name: `role${n}`, assign: 'label', color: '', on: {}, playbooks: {} }] };
}
export const setRoleName = (d: FlowDef, i: number, name: string): FlowDef => ({ ...d, roles: d.roles.map((r, j) => j === i ? { ...r, name } : r) });
export const moveRole = (d: FlowDef, i: number, delta: number): FlowDef => { const roles = move(d.roles, i, delta); return roles === d.roles ? d : { ...d, roles }; };
export const removeRole = (d: FlowDef, i: number): FlowDef => ({ ...d, roles: d.roles.filter((_, j) => j !== i) });
/** A human role reacts to nothing (the engine never wakes a human); only labelled roles have a label colour. */
export function setAssign(d: FlowDef, i: number, assign: RoleAssign): FlowDef {
  return { ...d, roles: d.roles.map((r, j) => j !== i ? r
    : assign === 'human' ? { ...r, assign, color: '', on: {}, playbooks: {} }
    : assign === 'all' ? { ...r, assign, color: '' } : { ...r, assign }) };
}
export const setColor = (d: FlowDef, i: number, color: string): FlowDef =>
  ({ ...d, roles: d.roles.map((r, j) => j === i ? { ...r, color: color.trim().toLowerCase().replace(/^#/, '') } : r) });
/** The label the engine reads for a role (`dev:{agent}`), null for roles without one. */
export const roleLabel = (r: FlowRole): string | null => r.assign === 'label' || r.assign === 'auto' ? `${r.name}:{agent}` : null;

/** Ticks or unticks one trigger of a role in one column; triggers kept in the closed list's order. */
export function toggleTrigger(d: FlowDef, i: number, state: string, trigger: FlowTrigger): FlowDef {
  return mapRoles(d, r => {
    if (r !== d.roles[i] || r.assign === 'human') return r;
    const cur = r.on[state] ?? [];
    const next = cur.includes(trigger) ? cur.filter(t => t !== trigger) : FLOW_TRIGGERS.filter(t => t === trigger || cur.includes(t));
    const on = { ...r.on, [state]: next };
    if (!next.length) delete on[state];
    return prune({ ...r, on }); // a newly used trigger has no playbook yet: validateFlow asks for one
  });
}
export const setPlaybookOf = (d: FlowDef, i: number, trigger: FlowTrigger, file: string): FlowDef =>
  ({ ...d, roles: d.roles.map((r, j) => j !== i ? r : { ...r, playbooks: { ...r.playbooks, [trigger]: file } }) });
/** Triggers the role uses, in the closed list's order: each one needs a playbook. */
export const usedTriggers = (r: FlowRole): FlowTrigger[] => { const u = triggersUsed(r); return FLOW_TRIGGERS.filter(t => u.has(t)); };

// ---------------------------------------------------------------- playbooks, kinds
export function addPlaybook(d: FlowDef): FlowDef {
  let n = d.playbooks.length + 1;
  while (d.playbooks.some(p => p.file === `playbook${n}.md`)) n++;
  return { ...d, playbooks: [...d.playbooks, { file: `playbook${n}.md`, body: '' }] };
}
/** Renaming a file renames it in every trigger that uses it. */
export function setPlaybookFile(d: FlowDef, i: number, file: string): FlowDef {
  const old = d.playbooks[i]?.file;
  if (old === undefined || old === file) return d;
  const playbooks = d.playbooks.map((p, j) => j === i ? { ...p, file } : p);
  if (d.playbooks.some((p, j) => j !== i && p.file === old)) return { ...d, playbooks };
  return mapRoles({ ...d, playbooks }, r => ({ ...r, playbooks: Object.fromEntries(Object.entries(r.playbooks).map(([t, f]) => [t, f === old ? file : f])) }));
}
export const setPlaybookBody = (d: FlowDef, i: number, body: string): FlowDef => ({ ...d, playbooks: d.playbooks.map((p, j) => j === i ? { ...p, body } : p) });
/** Removing a file unlinks it from its triggers (they then need another playbook). */
export function removePlaybook(d: FlowDef, i: number): FlowDef {
  const file = d.playbooks[i]?.file;
  if (file === undefined) return d;
  const playbooks = d.playbooks.filter((_, j) => j !== i);
  if (playbooks.some(p => p.file === file)) return { ...d, playbooks };
  return mapRoles({ ...d, playbooks }, r => ({ ...r, playbooks: Object.fromEntries(Object.entries(r.playbooks).filter(([, f]) => f !== file)) }));
}
/** Kinds typed one per line (or comma separated): trimmed, empty lines dropped; duplicates are left for validateFlow. */
export const parseKinds = (text: string): string[] => text.split(/[\n,]/).map(k => k.trim()).filter(Boolean);

// ---------------------------------------------------------------- issues, diff
/** Issues of a field and of everything under it (`roles.1` covers `roles.1.on.doing`). */
export const issuesAt = (issues: FlowIssue[], path: string): FlowIssue[] =>
  issues.filter(x => x.path === path || x.path.startsWith(path + '.'));
/** Line diff between two versions, over the files they emit (the flow YAML, then each playbook). */
export const flowDiff = (a: FlowDef | null, b: FlowDef): DiffLine[] => lineDiff(a ? flowText(a) : '', flowText(b));
export const sameFlow = (a: FlowDef | null, b: FlowDef | null): boolean => JSON.stringify(a) === JSON.stringify(b);
/** Changed lines with `ctx` lines around them; each run of unchanged lines left out becomes one null (shown as « … »). */
export function diffHunks(lines: DiffLine[], ctx = 2): (DiffLine | null)[] {
  const keep = lines.map(() => false);
  lines.forEach((l, i) => { if (l.op !== '=') for (let j = Math.max(0, i - ctx); j <= Math.min(lines.length - 1, i + ctx); j++) keep[j] = true; });
  const out: (DiffLine | null)[] = [];
  lines.forEach((l, i) => { if (keep[i]) out.push(l); else if (out.at(-1) !== null) out.push(null); });
  return out;
}

// ---------------------------------------------------------------- team (slice 3: protocol/flowteam.ts)
/** One agent's entry, or a blank one when the team does not list it yet. */
export const agentOf = (t: FlowTeam, name: string): FlowAgent => t.agents.find(a => a.name === name) ?? { name, roles: [], identity: '', limits: {}, sheet: '' };
const blank = (a: FlowAgent) => !a.roles.length && !a.identity && !Object.keys(a.limits).length && !a.sheet;
/**
 * Every space agent is shown; the team lists only those with something set (a role, a login, a limit, a sheet), in the
 * space's agent order (`order`), so an untouched agent never lands in config.yml.
 */
export function setAgent(t: FlowTeam, name: string, patch: Partial<Omit<FlowAgent, 'name'>>, order: readonly string[]): FlowTeam {
  const next = { ...agentOf(t, name), ...patch };
  const rest = t.agents.filter(a => a.name !== name);
  const agents = blank(next) ? rest : [...rest, next];
  const rank = (n: string) => { const i = order.indexOf(n); return i < 0 ? order.length : i; };
  return { ...t, agents: agents.sort((a, b) => rank(a.name) - rank(b.name)) };
}
export function toggleAgentRole(t: FlowTeam, name: string, role: string, order: readonly string[]): FlowTeam {
  const roles = agentOf(t, name).roles;
  return setAgent(t, name, { roles: roles.includes(role) ? roles.filter(r => r !== role) : [...roles, role] }, order);
}
/** '' = back to the engine's default; anything else is kept as typed (validateTeam reports what is out of range). */
export function setLimit(t: FlowTeam, name: string, key: LimitKey, text: string, order: readonly string[]): FlowTeam {
  const limits = { ...agentOf(t, name).limits };
  if (text.trim() === '') delete limits[key];
  else limits[key] = Number(text.trim().replace(',', '.'));
  return setAgent(t, name, { limits }, order);
}
export const addAuthor = (t: FlowTeam): FlowTeam => ({ ...t, trusted_authors: [...t.trusted_authors, { login: '', agent: '' }] });
export const setAuthor = (t: FlowTeam, i: number, patch: Partial<TrustedAuthor>): FlowTeam =>
  ({ ...t, trusted_authors: t.trusted_authors.map((a, j) => j === i ? { ...a, ...patch, ...(patch.login !== undefined ? { login: patch.login.trim().toLowerCase() } : {}) } : a) });
export const removeAuthor = (t: FlowTeam, i: number): FlowTeam => ({ ...t, trusted_authors: t.trusted_authors.filter((_, j) => j !== i) });
/** Bot logins typed one per line (or comma separated): lower case, without `[bot]`. */
export const parseBots = (text: string): string[] => text.split(/[\n,]/).map(b => b.trim().toLowerCase().replace(/\[bot\]$/, '')).filter(Boolean);
/** A role renamed in the flow follows into the team; a removed one leaves the agents that held it. */
export function renameTeamRole(t: FlowTeam, from: string, to: string | null): FlowTeam {
  return { ...t, agents: t.agents.map(a => a.roles.includes(from) ? { ...a, roles: to === null ? a.roles.filter(r => r !== from) : a.roles.map(r => r === from ? to : r) } : a) };
}
/** Line diff of a whole version (flow files, then the team). */
export const configDiff = (a: { def: FlowDef; team: FlowTeam } | null, b: { def: FlowDef; team: FlowTeam }): DiffLine[] =>
  lineDiff(a ? flowText(a.def) + teamText(a.team) : '', flowText(b.def) + teamText(b.team));
