// "Space settings" / "New space" form (admin): DOM-free logic, tested in client/test/spaces.test.ts.
// The hub checks everything again (admin, roles ⊆ members, existing accounts and agents, version): here, only input help.
import { SPACE_ID_RE, RESERVED_SPACES, MAX_ABOUT, DEFAULT_PARALLEL, MAX_PARALLEL, MAX_RESOURCES, RESOURCE_RE, RESOURCE_TYPES, RESOURCE_RULE_MAX, validResourceRule, MAX_ROLE, GH_LOGIN_RE, MAX_IDENTITIES, REPO_RE, MAX_REPOS, MAX_REPO_ORGS, validRole, type SpaceSettings, type Parallel, type Driver } from '../../protocol/frames.ts';
import { t } from './i18n.ts';
import { MODULES, PRESETS, moduleOn, modulesOn, type Module, type Preset } from '../../protocol/modules.ts';
import { DEFAULT_MEMORY_MODE, DEFAULT_MEMORY_BATCH, DEFAULT_MEMORY_COMPACT, MEMORY_BATCH_N, MEMORY_BATCH_MINUTES, MEMORY_COMPACT_N, MEMORY_COMPACT_WORDS,
  validBatch, validCompact, validTagMax, TAG_MAX_DEFAULT, TAG_MAX_BOUNDS, type MemoryBatch, type MemoryCompact, type MemoryMode } from '../../protocol/memory.ts';
import { RELAY_MAX_BOUNDS, RELAY_MAX_DEFAULT, validRelayMax } from '../../protocol/relay.ts';

export interface SpaceForm {
  id: string; name: string; about: string; members: string[]; trusted: string[]; contributors: string[]; agents: string[]; defaultAgent: string;
  nontech: string[];      // members flagged « not technical »: the agents talk to them without jargon
  admins: string[];       // space admins (members): only a global admin changes this list, the hub checks
  modules: Module[];      // optional sections turned on (protocol/modules.ts)
  version: number | null; // null = creation
  idTouched: boolean;     // id typed by hand: no longer derived from the name
  // Parallel work: strict = one thread at a time (max 1); cooperative = up to `max` threads per agent.
  mode: Parallel['mode']; max: number;
  resources: ResourceRow[]; // shared resources as edited: fixed type, optional name, usage rule (mandatory)
  agentRoles: Record<string, string>; // function of each agent, as typed (« Dev », « Admin agents »)
  agentAvatars: Record<string, string>; // agents' photos changed in this form only ('' = removed); the saved ones come with the people
  driver: Driver;         // who drives the work (external board: needs an attached GitHub Project, `board`)
  identities: string;     // GitHub logins of the board's agents as typed, one per line (parsed by identityList)
  board: boolean;         // the space has a GitHub Project (read-only here: attached by script)
  repos: string;          // attached repos as typed, one per line (parsed by repoList)
  repoOrgs: string;       // GitHub owners validated for the space's admins (global admin), one per line (identityList)
  ci: boolean;            // CI follow-up
  memory: MemoryMode;     // gate of the project memory
  memoryAck: boolean;     // the admin ticked the agentAuto risk warning (true once the space is saved in that mode)
  memoryAgent: string;    // memory agent ('' = the agent in charge)
  memoryHidden: boolean;  // the memory agent is backstage (protocol/memory.ts backstageAgent): needs another agent than the one in charge
  memoryBatch: MemoryBatch;     // when the memory agent reviews (agent mode)
  memoryCompact: MemoryCompact; // when the memory agent compacts (0 = that threshold off)
  tagMax: number;               // cap of the space's tag vocabulary
  relayMax: number;             // wakes of an agent by another agent's mention between two human messages (0 = off)
}

/** Id derived from the name: "Hestia (compteurs)" -> "hestia-compteurs". */
export const slug = (name: string) => name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 32).replace(/-+$/, '');

/** One shared resource in the settings form: `type` among RESOURCE_TYPES (an older stored one is kept as is), `name` may be empty. */
export interface ResourceRow { type: string; name: string; rule: string }
const rowOf = (r: string, rules?: Record<string, string>): ResourceRow => {
  const i = r.indexOf(':');
  return { type: i < 0 ? r : r.slice(0, i), name: i < 0 ? '' : r.slice(i + 1), rule: rules?.[r] ?? '' };
};
/** The resource name the hub stores: `type` or `type:name`. */
export const resourceOf = (r: ResourceRow) => r.name.trim() ? `${r.type}:${r.name.trim()}` : r.type;
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
export const addResource = (f: SpaceForm): SpaceForm => ({ ...f, resources: [...f.resources, { type: RESOURCE_TYPES[0], name: '', rule: '' }] });
export const setResource = (f: SpaceForm, i: number, p: Partial<ResourceRow>): SpaceForm => ({ ...f, resources: f.resources.map((r, j) => j === i ? { ...r, ...p } : r) });
export const removeResource = (f: SpaceForm, i: number): SpaceForm => ({ ...f, resources: f.resources.filter((_, j) => j !== i) });
const parallelForm = (p: Parallel = DEFAULT_PARALLEL) => ({ mode: p.mode, max: p.mode === 'strict' ? 1 : p.max, resources: p.resources.map(r => rowOf(r, p.rules)) });

export const formOf = (s: SpaceSettings): SpaceForm => ({ id: s.id, name: s.name, about: s.about, members: [...s.members], trusted: [...s.trusted], contributors: [...(s.contributors ?? [])], nontech: [...(s.nontech ?? [])], admins: [...(s.admins ?? [])], modules: [...(s.modules ?? modulesOn())],
  agents: [...s.agents], defaultAgent: s.defaultAgent, version: s.version, idTouched: true, ...parallelForm(s.parallel ?? DEFAULT_PARALLEL),
  agentRoles: { ...(s.agentRoles ?? {}) }, agentAvatars: {}, driver: s.driver ?? 'briefling', identities: (s.identities ?? []).join('\n'), board: !!s.board,
  repos: (s.repos ?? []).join('\n'), repoOrgs: (s.repoOrgs ?? []).join('\n'), ci: s.ci === true, memory: s.memory ?? DEFAULT_MEMORY_MODE, memoryAck: s.memory === 'agentAuto',
  memoryAgent: s.memoryAgent && s.memoryAgent !== s.defaultAgent ? s.memoryAgent : '', memoryHidden: s.memoryHidden === true,
  memoryBatch: { ...(s.memoryBatch ?? DEFAULT_MEMORY_BATCH) }, memoryCompact: { ...(s.memoryCompact ?? DEFAULT_MEMORY_COMPACT) }, tagMax: s.tagMax ?? TAG_MAX_DEFAULT, relayMax: s.relayMax ?? RELAY_MAX_DEFAULT });

/** New space: the admin is a trusted member; agent in charge preselected when there is only one. */
export const newForm = (me: string, agents: string[]): SpaceForm => ({ id: '', name: '', about: '', members: [me], trusted: [me], contributors: [], nontech: [], admins: [], modules: [...PRESETS.software],
  agents: agents.length === 1 ? [...agents] : [], defaultAgent: agents.length === 1 ? agents[0] : '', version: null, idTouched: false, ...parallelForm(), agentRoles: {}, agentAvatars: {},
  driver: 'briefling', identities: '', board: false, repos: '', repoOrgs: '', ci: false, memory: DEFAULT_MEMORY_MODE, memoryAck: false, memoryAgent: '', memoryHidden: false,
  memoryBatch: { ...DEFAULT_MEMORY_BATCH }, memoryCompact: { ...DEFAULT_MEMORY_COMPACT }, tagMax: TAG_MAX_DEFAULT, relayMax: RELAY_MAX_DEFAULT });

export function setName(f: SpaceForm, name: string): SpaceForm { return { ...f, name, id: f.version === null && !f.idTouched ? slug(name) : f.id } }

/** Role of a person in a space, each one includes the previous: member (reads, writes), contributor (the agents answer
 *  them in the Lounge), lead (`trusted`: makes the agents work). `none`: not in the space. */
export type Role = 'none' | 'member' | 'contributor' | 'lead';
export const ROLES: readonly Role[] = ['none', 'member', 'contributor', 'lead'];
export const roleOf = (f: Pick<SpaceForm, 'members' | 'trusted' | 'contributors'>, id: string): Role =>
  f.trusted.includes(id) ? 'lead' : f.contributors.includes(id) ? 'contributor' : f.members.includes(id) ? 'member' : 'none';
/** Turns one optional module on or off (kept in MODULES order). */
export const setModule = (f: SpaceForm, m: Module, on: boolean): SpaceForm =>
  ({ ...f, modules: MODULES.filter(x => x === m ? on : f.modules.includes(x)) });
/** A preset turns its set of modules on and the others off; each one stays adjustable after. */
export const setPreset = (f: SpaceForm, p: Preset): SpaceForm => ({ ...f, modules: [...PRESETS[p]] });
/** The module a view belongs to (none: always there). */
export const VIEW_MODULE: Partial<Record<string, Module>> = { overview: 'board', lineage: 'lineage', metrics: 'metrics', radar: 'radar', exchanges: 'exchanges', reminders: 'reminders' };
/** A view of this kind is shown with these modules (`modules` missing = all on). */
export const viewOn = (kind: string, modules: readonly Module[] | undefined): boolean => { const m = VIEW_MODULE[kind]; return !m || moduleOn(modules, m) };
/** One role per person: any role makes them a member, `none` takes every role away. List order kept. */
export function setRole(f: SpaceForm, id: string, role: Role): SpaceForm {
  const put = (l: string[], on: boolean) => on ? (l.includes(id) ? l : [...l, id]) : l.filter(x => x !== id);
  return { ...f, members: put(f.members, role !== 'none'), contributors: put(f.contributors, role === 'contributor'), trusted: put(f.trusted, role === 'lead'),
    nontech: role === 'none' ? f.nontech.filter(x => x !== id) : f.nontech, admins: role === 'none' ? f.admins.filter(x => x !== id) : f.admins };
}
/** « Not technical » flag of a member (any role; set by the admin only): the agents answer them in plain words. */
export const setNontech = (f: SpaceForm, id: string, on: boolean): SpaceForm =>
  ({ ...f, nontech: on ? (f.nontech.includes(id) || !f.members.includes(id) ? f.nontech : [...f.nontech, id]) : f.nontech.filter(x => x !== id) });
/** Admin of this space (set by a global admin only): its Settings, members, agents, routines and workflow. Members only. */
export const setSpaceAdmin = (f: SpaceForm, id: string, on: boolean): SpaceForm =>
  ({ ...f, admins: on ? (f.admins.includes(id) || !f.members.includes(id) ? f.admins : [...f.admins, id]) : f.admins.filter(x => x !== id) });
/** Removing the agent in charge hands over to the first remaining agent; the first agent added becomes the one in charge. */
export function setAgent(f: SpaceForm, a: string, on: boolean): SpaceForm {
  const agents = on ? (f.agents.includes(a) ? f.agents : [...f.agents, a]) : f.agents.filter(x => x !== a);
  const defaultAgent = agents.includes(f.defaultAgent) ? f.defaultAgent : agents[0] ?? '';
  return { ...f, agents, defaultAgent };
}
export const setDefault = (f: SpaceForm, a: string): SpaceForm => setAgent({ ...f, defaultAgent: a }, a, true);

export const setAgentRole = (f: SpaceForm, a: string, role: string): SpaceForm => ({ ...f, agentRoles: { ...f.agentRoles, [a]: role } });
export const setAgentAvatar = (f: SpaceForm, a: string, avatar: string): SpaceForm => ({ ...f, agentAvatars: { ...f.agentAvatars, [a]: avatar } });
/** Photos sent to the hub: the changed ones, of agents of the space only. */
export const agentAvatarsOf = (f: SpaceForm): Record<string, string> => Object.fromEntries(Object.entries(f.agentAvatars).filter(([a]) => f.agents.includes(a)));
/** Functions sent to the hub: agents of the space only, cleaned like the hub does, empty ones dropped. */
export const agentRolesOf = (f: SpaceForm): Record<string, string> =>
  Object.fromEntries(f.agents.map(a => [a, validRole(f.agentRoles[a] ?? '') ?? '']).filter(([, r]) => r));

/** Strict always means one thread at a time; switching to cooperative starts at 2 threads. */
export const setMode = (f: SpaceForm, mode: Parallel['mode']): SpaceForm =>
  ({ ...f, mode, max: mode === 'strict' ? 1 : f.max >= 2 && f.max <= MAX_PARALLEL ? f.max : 2 });
/** Max threads per agent: ignored in strict mode (stays 1). NaN (empty field) is kept so formError can say so. */
export const setMax = (f: SpaceForm, max: number): SpaceForm => f.mode === 'strict' ? { ...f, max: 1 } : { ...f, max };
/** Resource names typed in the textarea: one per line, blank lines and surrounding spaces ignored. */
/** GitHub logins typed in the textarea: one per line (commas too), lower case like the hub, blanks ignored. */
export const identityList = (text: string) => text.split(/[\n,]/).map(x => x.trim().toLowerCase()).filter(Boolean);
/** Repos typed in the textarea: one per line (commas too), `owner/name` or a github.com URL (-> owner/name), blanks ignored. */
export const repoList = (text: string) => text.split(/[\n,]/).map(x => x.trim()).filter(Boolean)
  .map(x => x.replace(/^https:\/\/(?:www\.)?github\.com\/([^/?#]+\/[^/?#]+?)(?:\.git)?\/?$/i, '$1'));
/**
 * Space admin's save: the first repo added or removed whose owner is not among the orgs a global admin validated
 * (`repoOrgs`), null when every change is allowed. The hub checks the same rule (forbidden).
 */
export function repoOutsideOrgs(f: SpaceForm, s: SpaceSettings): string | null {
  const orgs = s.repoOrgs ?? [], was = (s.repos ?? []).map(r => r.toLowerCase()), now = repoList(f.repos).map(r => r.toLowerCase());
  return [...now.filter(r => !was.includes(r)), ...was.filter(r => !now.includes(r))].find(r => !orgs.includes(r.split('/')[0])) ?? null;
}
export const parallelOf = (f: SpaceForm): Parallel => ({ mode: f.mode, max: f.mode === 'strict' ? 1 : f.max, resources: f.resources.map(resourceOf),
  rules: Object.fromEntries(f.resources.map(r => [resourceOf(r), oneLine(r.rule)])) });

/** Backstage memory agent as saved: the box counts only with an agent other than the one in charge (else off). */
export const hiddenOf = (f: SpaceForm): boolean => f.memoryHidden && !!f.memoryAgent && f.memoryAgent !== f.defaultAgent && f.agents.includes(f.memoryAgent);
/** What prevents saving, in plain words (current UI language); null when it is fine. */
export function formError(f: SpaceForm): string | null {
  if (!f.name.trim()) return t('form_name');
  if (f.name.trim().length > 60) return t('form_name_long');
  if (f.version === null && (!SPACE_ID_RE.test(f.id) || RESERVED_SPACES.includes(f.id))) return t('form_id');
  if (f.about.length > MAX_ABOUT) return t('form_about_long', { max: MAX_ABOUT });
  if (!f.members.length) return t('form_members');
  if (!f.agents.length || !f.agents.includes(f.defaultAgent)) return t('form_owner');
  const badRole = f.agents.find(a => validRole(f.agentRoles[a] ?? '') === null);
  if (badRole) return t('form_role', { name: badRole[0].toUpperCase() + badRole.slice(1), max: MAX_ROLE });
  if (f.mode === 'cooperative' && !(Number.isInteger(f.max) && f.max >= 2 && f.max <= MAX_PARALLEL)) return t('form_max', { max: MAX_PARALLEL });
  const rs = f.resources.map(resourceOf);
  const badType = f.resources.find(r => !(RESOURCE_TYPES as readonly string[]).includes(r.type));
  if (badType) return t('form_resource_type', { name: resourceOf(badType), types: RESOURCE_TYPES.join(', ') });
  const bad = rs.find(r => !RESOURCE_RE.test(r));
  if (bad) return t('form_resource', { name: bad });
  const noRule = f.resources.find(r => validResourceRule(r.rule) === null);
  if (noRule) return t('form_resource_rule', { name: resourceOf(noRule), max: RESOURCE_RULE_MAX });
  const dup = rs.find((r, i) => rs.indexOf(r) !== i);
  if (dup) return t('form_resource_dup', { name: dup });
  if (rs.length > MAX_RESOURCES) return t('form_resources_max', { max: MAX_RESOURCES });
  if (f.driver === 'board' && !f.board) return t('driver_no_board');
  const idl = identityList(f.identities);
  const badId = idl.find(x => !GH_LOGIN_RE.test(x));
  if (badId) return t('form_identity', { name: badId });
  const dupId = idl.find((x, i) => idl.indexOf(x) !== i);
  if (dupId) return t('form_identity_dup', { name: dupId });
  if (idl.length > MAX_IDENTITIES) return t('form_identities_max', { max: MAX_IDENTITIES });
  const rl = repoList(f.repos);
  const badRepo = rl.find(x => !REPO_RE.test(x));
  if (badRepo) return t('form_repo', { name: badRepo });
  const dupRepo = rl.find((x, i) => rl.findIndex(y => y.toLowerCase() === x.toLowerCase()) !== i);
  if (dupRepo) return t('form_repo_dup', { name: dupRepo });
  if (rl.length > MAX_REPOS) return t('form_repos_max', { max: MAX_REPOS });
  const ol = identityList(f.repoOrgs), badOrg = ol.find(x => !GH_LOGIN_RE.test(x));
  if (badOrg) return t('form_repo_org', { name: badOrg });
  if (ol.length > MAX_REPO_ORGS) return t('form_repo_orgs_max', { max: MAX_REPO_ORGS });
  if (f.memory === 'agentAuto' && !f.memoryAck) return t('form_mem_ack');
  if (!validBatch(f.memoryBatch)) return t('form_mem_batch', { n: MEMORY_BATCH_N[1], min: MEMORY_BATCH_MINUTES[0], max: MEMORY_BATCH_MINUTES[1] });
  if (!validCompact(f.memoryCompact)) return t('form_mem_compact', { n: MEMORY_COMPACT_N[1], words: MEMORY_COMPACT_WORDS[1] });
  if (!validTagMax(f.tagMax)) return t('form_tag_max', { min: TAG_MAX_BOUNDS[0], max: TAG_MAX_BOUNDS[1] });
  if (!validRelayMax(f.relayMax)) return t('form_relay_max', { min: RELAY_MAX_BOUNDS[0], max: RELAY_MAX_BOUNDS[1] });
  return null;
}

export const payload = (f: SpaceForm, client_id: string) => ({ type: 'space.save', client_id, space: f.id, version: f.version, name: f.name.trim(), about: f.about.trim(),
  members: f.members, trusted: f.trusted.filter(t => f.members.includes(t)),
  contributors: f.contributors.filter(c => f.members.includes(c) && !f.trusted.includes(c)), nontech: f.nontech.filter(m => f.members.includes(m)), admins: f.admins.filter(m => f.members.includes(m)), modules: f.modules, agents: f.agents, defaultAgent: f.defaultAgent, parallel: parallelOf(f), agentRoles: agentRolesOf(f),
  ...(Object.keys(agentAvatarsOf(f)).length ? { agentAvatars: agentAvatarsOf(f) } : {}), driver: f.driver, identities: identityList(f.identities), repos: repoList(f.repos), repoOrgs: identityList(f.repoOrgs), ci: f.ci, memory: f.memory,
  ...(f.memoryAgent && f.agents.includes(f.memoryAgent) ? { memoryAgent: f.memoryAgent } : { memoryAgent: f.defaultAgent }), memoryHidden: hiddenOf(f),
  memoryBatch: f.memoryBatch, memoryCompact: f.memoryCompact, tagMax: f.tagMax, relayMax: f.relayMax, ...(f.memory === 'agentAuto' && f.memoryAck ? { memoryAck: true } : {}) });

/** Changed compared to what is saved (list order ignored). */
/** Tabs of a space's Settings, one per question (Blair, Oct 2026); the new-space page has none. */
export type SpTab = 'general' | 'members' | 'agents' | 'work' | 'memory' | 'routines' | 'radar' | 'contacts' | 'advanced';
export const SP_TABS: readonly SpTab[] = ['general', 'members', 'agents', 'work', 'memory', 'routines', 'radar', 'contacts', 'advanced'];
/** Settings tabs of the modules turned on: Radar (radar), Contacts (exchanges), Work (board or CI/repos). */
export const tabsOn = (modules: readonly Module[]): SpTab[] => SP_TABS.filter(x =>
  x === 'radar' ? modules.includes('radar') : x === 'contacts' ? modules.includes('exchanges') : x === 'work' ? modules.includes('board') || modules.includes('ci') : true);
export const isSpTab = (x: unknown): x is SpTab => typeof x === 'string' && (SP_TABS as readonly string[]).includes(x);
/** What an unsaved form changes, named in the save bar and dotted on its tab. */
export type Change = 'name' | 'about' | 'modules' | 'members' | 'trusted' | 'nontech' | 'admins' | 'agents' | 'agentRoles' | 'agentAvatars' | 'defaultAgent' | 'parallel' | 'driver' | 'identities' | 'repos' | 'ci' | 'memory' | 'relay';
export const CHANGE_TAB: Record<Change, SpTab> = { name: 'general', about: 'general', modules: 'general', members: 'members', trusted: 'members', nontech: 'members', admins: 'members', agents: 'agents', agentRoles: 'agents', agentAvatars: 'agents',
  defaultAgent: 'agents', parallel: 'agents', driver: 'work', identities: 'work', repos: 'work', ci: 'work', memory: 'memory', relay: 'agents' };

/** The form's changes against the saved settings, in page order (empty = nothing to save). */
export function changes(f: SpaceForm, s: SpaceSettings): Change[] {
  const same = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x));
  const on: Record<Change, boolean> = {
    name: f.name.trim() !== s.name, about: f.about.trim() !== s.about, modules: !same(f.modules, s.modules ?? modulesOn()),
    members: !same(f.members, s.members), trusted: !same(f.trusted, s.trusted) || !same(f.contributors, s.contributors ?? []),
    nontech: !same(f.nontech.filter(m => f.members.includes(m)), s.nontech ?? []),
    admins: !same(f.admins.filter(m => f.members.includes(m)), s.admins ?? []),
    agents: !same(f.agents, s.agents), agentRoles: JSON.stringify(agentRolesOf(f)) !== JSON.stringify(agentRolesOf({ ...f, agents: s.agents, agentRoles: s.agentRoles ?? {} })),
    agentAvatars: Object.keys(agentAvatarsOf(f)).length > 0,
    defaultAgent: f.defaultAgent !== s.defaultAgent, parallel: parallelChanged(parallelOf(f), s.parallel ?? DEFAULT_PARALLEL),
    driver: f.driver !== (s.driver ?? 'briefling'), identities: identityList(f.identities).join('\n') !== (s.identities ?? []).join('\n'),
    repos: repoList(f.repos).join('\n') !== (s.repos ?? []).join('\n') || identityList(f.repoOrgs).join('\n') !== (s.repoOrgs ?? []).join('\n'), ci: f.ci !== (s.ci === true),
    memory: f.memory !== (s.memory ?? DEFAULT_MEMORY_MODE)
      || (f.memoryAgent && f.agents.includes(f.memoryAgent) ? f.memoryAgent : f.defaultAgent) !== (s.memoryAgent ?? s.defaultAgent)
      || hiddenOf(f) !== (s.memoryHidden === true)
      || JSON.stringify(f.memoryBatch) !== JSON.stringify(s.memoryBatch ?? DEFAULT_MEMORY_BATCH)
      || JSON.stringify(f.memoryCompact) !== JSON.stringify(s.memoryCompact ?? DEFAULT_MEMORY_COMPACT) || f.tagMax !== (s.tagMax ?? TAG_MAX_DEFAULT),
    relay: f.relayMax !== (s.relayMax ?? RELAY_MAX_DEFAULT),
  };
  return (Object.keys(CHANGE_TAB) as Change[]).filter(k => on[k]);
}
export const changed = (f: SpaceForm, s: SpaceSettings): boolean => changes(f, s).length > 0;
/** Resource order counts (the admin may reorder them on purpose); max only matters in cooperative mode. */
function parallelChanged(a: Parallel, b: Parallel): boolean {
  const rules = (p: Parallel) => p.resources.map(r => oneLine(p.rules?.[r] ?? '')).join('\n');
  return a.mode !== b.mode || (a.mode === 'cooperative' && a.max !== b.max) || a.resources.join('\n') !== b.resources.join('\n') || rules(a) !== rules(b);
}
