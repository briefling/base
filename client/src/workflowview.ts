// Workflow editor (admin, docs/design-flow.md slice 2): the `#/<space>/workflow` route and the « Board workflow »
// summary of Settings › Work. The form edits a FlowDef (client/src/workflow.ts); the YAML shown is emitted from it
// (protocol/flowcfg.ts), never typed. Admin only, like the Settings: the playbooks are prompts the agents follow.
// Not a sidebar module (no entry, no badge, admin route): main.ts calls it from the frames, the route and Settings.
import type { FlowAgentStatus, FlowVersion, FlowVersionMeta, HubFrame } from '../../protocol/frames.ts';
import type { UiKit } from './modules.ts';
import { flowPipe, pipeNotes, type PipeActor } from './flowpipe.ts';
import { routeOf } from './route.ts';
import { lang, type Key } from './i18n.ts';
import { FLOW_TRIGGERS, flowYaml, validateFlow, type FlowDef, type FlowIssueCode, type FlowRole, type FlowTrigger, type RoleAssign } from '../../protocol/flowcfg.ts';
import { addPlaybook, addRole, addState, diffHunks, fromTemplate, issuesAt, moveRole, moveState, parseKinds, removePlaybook, removeRole, removeState, roleLabel,
  sameFlow, setAssign, setColor, setColumn, setPlaybookBody, setPlaybookFile, setPlaybookOf, setRoleName, setStateKey, toggleTrigger, usedTriggers, type FlowTemplate,
  agentOf, setAgent as setTeamAgent, toggleAgentRole, setLimit, addAuthor, setAuthor, removeAuthor, parseBots, renameTeamRole, configDiff } from './workflow.ts';
import { EMPTY_TEAM, LIMIT_KEYS, LIMIT_BOUNDS, bundleFiles, bundleIssues, configYaml, sameSource, sourceOk, validateTeam, type BundleTarget, type FlowSource, type FlowTeam, type LimitKey, type TeamIssueCode } from '../../protocol/flowteam.ts';

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const newCid = () => b64url(crypto.getRandomValues(new Uint8Array(32))).slice(0, 20); // same ids as main.ts' rand()
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export interface WorkflowEditor {
  /** The editor view of a space. */
  el(space: string): HTMLElement;
  /** Settings › Work › « Board workflow » (board driver only). */
  summaryEl(space: string): HTMLElement;
  /** A hub frame for the editor: true = handled (the caller renders). */
  frame(f: HubFrame): boolean;
  /** The editor or a board space's Settings is on screen: read it on every entry (`ready`: connected and admin). */
  entered(space: string, ready: boolean): void;
  /** Another view: the next entry reads again. */
  left(): void;
}

/** `admin`: I am a global admin; `openEditor`: opens the editor of a space. */
export function workflowEditor(k: UiKit, admin: (space: string) => boolean, openEditor: (space: string) => void): WorkflowEditor {
  const { h, t, render, send, since, withIcon, personName, menuBtn, spaceName, errText } = k;
  type WfState = { space: string; ready: boolean; history: FlowVersionMeta[]; loaded: FlowVersion | null; draft: FlowDef | null;
    versions: Map<number, FlowVersion>; cid: string; err: string; notice: string; show: number; load: number; open: Set<string>; kindsText: string | null;
    team: FlowTeam; botsText: string | null; status: FlowAgentStatus[]; target: BundleTarget | null; agents: string[];
    source: FlowSource | null; head: string | null; gitErr: string; headCid: string };
  let WF: WfState | null = null;
  let wfFor = '';
  const wfAsk = (space: string, version?: number) => send({ type: 'flowcfg.get', client_id: newCid(), space, ...(version ? { version } : {}) });
  const WF_ISSUE: Record<FlowIssueCode, Key> = { shape: 'fc_shape', name: 'fc_name', state_key: 'fc_state_key', state_dup: 'fc_state_dup', column: 'fc_column',
    column_dup: 'fc_column_dup', state_required: 'fc_state_required', no_role: 'fc_no_role', role_name: 'fc_role_name', role_dup: 'fc_role_dup', trigger: 'fc_trigger',
    trigger_dup: 'fc_trigger_dup', state_unknown: 'fc_state_unknown', human_triggers: 'fc_human_triggers', color: 'fc_color', playbook_missing: 'fc_playbook_missing',
    playbook_unknown: 'fc_playbook_unknown', playbook_unused: 'fc_playbook_unused', kind: 'fc_kind', kind_dup: 'fc_kind_dup', file: 'fc_file', file_dup: 'fc_file_dup',
    file_unused: 'fc_file_unused', artifact: 'fc_artifact', text: 'fc_text', too_big: 'fc_too_big', secret: 'fc_secret' };
  const WF_ASSIGN: Record<RoleAssign, [Key, Key]> = { all: ['wf_assign_all', 'wf_assign_all_desc'], label: ['wf_assign_label', 'wf_assign_label_desc'],
    auto: ['wf_assign_auto', 'wf_assign_auto_desc'], human: ['wf_assign_human', 'wf_assign_human_desc'] };
  const wfTrigger = (tr: FlowTrigger) => t(`wf_tr_${tr}` as Key);
  const WF_TEAM_ISSUE: Record<TeamIssueCode, Key> = { shape: 'tc_shape', agent: 'tc_agent', agent_dup: 'tc_agent_dup', agent_space: 'tc_agent_space', role_unknown: 'tc_role_unknown',
    role_dup: 'tc_role_dup', identity: 'tc_identity', limit: 'tc_limit', login: 'tc_login', login_dup: 'tc_login_dup', login_machine: 'tc_login_machine', route: 'tc_route',
    bot: 'tc_bot', bot_dup: 'tc_bot_dup', text: 'fc_text', secret: 'fc_secret', too_big: 'tc_too_big' };
  /** Load a version (or a template) in the editor: flow and team together. */
  function wfPut(W: WfState, v: { def: FlowDef; team: FlowTeam; source?: FlowSource | null } | null) {
    W.draft = v ? structuredClone(v.def) : null; W.team = structuredClone(v?.team ?? EMPTY_TEAM); W.kindsText = null; W.botsText = null;
    const src = v?.source ?? null;
    if (!sameSource(src, W.source)) { W.source = src ? { ...src } : null; W.head = null; W.gitErr = ''; if (src) wfHead(W); }
  }
  /** Git source picked or changed: read its branch head (the base of the save). The latest version's source is read by flowcfg.get. */
  function wfHead(W: WfState) {
    if (!W.source || !sourceOk(W.source, W.target?.repos ?? [])) return;
    W.headCid = newCid(); W.head = null; W.gitErr = '';
    send({ type: 'flowcfg.head', client_id: W.headCid, space: W.space, source: W.source });
  }
  function onFlowcfgGit(f: Extract<HubFrame, { type: 'flowcfg.git' }>) {
    if (!WF || WF.space !== f.space || !WF.source) return;
    if (f.client_id !== WF.headCid && WF.headCid) return;
    WF.head = f.head; WF.gitErr = f.error ?? '';
  }
  function onFlowcfg(f: Extract<HubFrame, { type: 'flowcfg' }>) {
    if (!WF || WF.space !== f.space) return;
    WF.history = f.history; WF.status = f.status ?? []; WF.target = f.target ?? null; WF.agents = f.agents ?? [];
    if (f.version) WF.versions.set(f.version.version, f.version);
    if (!WF.ready) { WF.ready = true; WF.loaded = f.version; WF.source = f.version?.source ?? null; WF.headCid = WF.source ? f.client_id : ''; wfPut(WF, f.version); }
    if (WF.load && WF.versions.has(WF.load)) { wfPut(WF, WF.versions.get(WF.load)!); WF.notice = t('wf_loaded', { n: WF.load }); WF.load = 0; }
  }
  function onFlowcfgSaved(f: Extract<HubFrame, { type: 'flowcfg.saved' }>) {
    if (!WF || WF.cid !== f.client_id || !WF.draft) return;
    WF.loaded = { ...f.version, def: structuredClone(WF.draft), team: structuredClone(WF.team), source: WF.source ? { ...WF.source } : null };
    if (f.version.commit) { WF.head = f.version.commit; WF.headCid = ''; }
    WF.versions.set(f.version.version, WF.loaded);
    WF.history = [f.version, ...WF.history.filter(x => x.version !== f.version.version)];
    WF.cid = ''; WF.err = ''; WF.notice = t('wf_saved', { n: f.version.version });
    // The agents' plugins answer within seconds: read their status again once.
    const space = WF.space;
    setTimeout(() => { if (WF?.space === space) wfAsk(space); }, 5000);
  }
  /** Where an issue is, in the form's words (`roles.1.on.doing` -> role « dev »). */
  function wfWhere(d: FlowDef, path: string): string {
    const [area, i] = path.split('.'), n = Number(i);
    if (area === 'states' && d.states[n]) return t('wf_at_column', { name: d.states[n].column || d.states[n].key });
    if (area === 'roles' && d.roles[n]) return t('wf_at_role', { name: d.roles[n].name });
    if (area === 'playbooks' && d.playbooks[n]) return t('wf_at_file', { name: d.playbooks[n].file });
    if (area === 'kinds' && d.kinds[n] !== undefined) return t('wf_at_kind', { name: d.kinds[n] });
    return '';
  }
  function wfDiffEl(a: { def: FlowDef; team: FlowTeam } | null, b: { def: FlowDef; team: FlowTeam }, k: string) {
    const rows = diffHunks(configDiff(a, b));
    if (rows.every(x => x === null)) return h('div', { class: 'sp-hint' }, t('wf_same'));
    return h('div', { class: 'about-draft wf-diff', 'data-k': k }, h('div', { class: 'ab-diff' }, ...rows.map(x => x === null ? h('div', { class: 'ab-eq wf-skip' }, '…')
      : h('div', { class: `ab-${x.op === '+' ? 'ins' : x.op === '-' ? 'del' : 'eq'}` }, h('span', { class: 'ab-op', 'aria-hidden': 'true' }, x.op === '+' ? '+' : x.op === '-' ? '−' : ' '), x.text || ' '))));
  }
  const wfNew = (space: string): WfState => ({ space, ready: false, history: [], loaded: null, draft: null, versions: new Map(), cid: '', err: '', notice: '', show: 0, load: 0,
    open: new Set(), kindsText: null, team: structuredClone(EMPTY_TEAM), botsText: null, status: [], target: null, agents: [], source: null, head: null, gitErr: '', headCid: '' });
  /** Status line of one flow agent: what its plugin made of the versions pushed to it (editor and Settings summary). */
  function wfStatusText(ag: string, st: FlowAgentStatus | undefined, latest: number) {
    return (!st ? t('wf_st_none', { agent: cap(ag) }) : (!st.ok ? t('wf_st_err', { agent: cap(ag), n: st.version, error: st.error ?? '' })
      : st.version === latest ? t('wf_st_ok', { agent: cap(ag), n: st.version }) : t('wf_st_old', { agent: cap(ag), n: st.version }))) + (st?.commit ? ` (${st.commit.slice(0, 7)})` : '');
  }
  /**
   * Settings › Work › « Board workflow » (board driver only): the saved version, the pipe of the board's columns with
   * role · agent · triggers under each (client/src/flowpipe.ts), quiet notes on roles a human assigns, the agents' status.
   */
  function wfSummaryEl(space: string) {
    const W = WF?.space === space ? WF : null;
    const edit = h('div', { class: 'sp-actions' }, h('button', { class: 'btn pri', type: 'button', 'data-k': 'sp-workflow', onclick: () => openEditor(space) }, withIcon('pencil', t('wf_open'), 14)));
    const v = W?.loaded ?? null;
    const sub = !W?.ready ? t('ex_loading') : v ? t('wf_version', { n: v.version, who: v.by === k.me() ? t('you') : personName(v.by) ?? v.by.slice(0, 6), when: since(v.at) }) : t('wf_none');
    const block = (...kids: (Node | null)[]) => h('section', { class: 'ov-block wf-sum', 'data-k': 'wf-sum' }, h('div', { class: 'group label' }, t('wf_section')), h('div', { class: 'sp-hint', 'data-k': 'wf-sum-version' }, sub), ...kids, edit);
    if (!W || !v) return block();
    const actor = (a: PipeActor) => h('div', { class: 'wf-p-actor' },
      h('span', { class: 'wf-p-chip' }, h('b', {}, a.role), ' · ', a.agents.length ? a.agents.map(cap).join(', ') : h('span', { class: 'wf-p-none', title: t('wf_p_none'), 'aria-label': t('wf_p_none') }, '—')),
      h('div', { class: 'wf-p-tr' }, a.triggers.map(wfTrigger).join(' / ')));
    const pipe = h('div', { class: 'wf-pipe', 'data-k': 'wf-pipe' }, ...flowPipe(v.def, v.team).map(c => h('div', { class: 'wf-p-col', 'data-k': `wf-p-${c.key}` },
      h('div', { class: 'wf-p-head', title: c.column }, c.column), ...(c.actors.length ? c.actors.map(actor) : [h('div', { class: 'wf-p-idle' }, '—')]))));
    const notes = pipeNotes(v.def, v.team).map(n => h('div', { class: 'sp-hint wf-p-note', 'data-k': `wf-p-note-${n.role}` },
      n.kind === 'label' ? t('wf_p_label', { role: n.role, label: `${n.role}:<agent>` }) : t('wf_p_unstaffed', { role: n.role, columns: n.columns.join(', ') })));
    const latest = W.history[0]?.version ?? 0;
    const agents = [...new Set([...v.team.agents.filter(a => a.roles.length).map(a => a.name), ...W.status.map(x => x.agent)])];
    const status = agents.map(ag => { const st = W.status.find(x => x.agent === ag);
      return h('div', { class: `wf-st ${st && !st.ok ? 'err' : ''}`, 'data-k': `wf-sum-st-${ag}`, title: st ? new Date(st.at).toLocaleString(lang()) : '' }, wfStatusText(ag, st, latest)); });
    return block(pipe, ...notes, ...status);
  }
  function workflowView(space: string) {
    if (!WF || WF.space !== space) WF = wfNew(space);
    const W = WF;
    const who = (id: string) => id === k.me() ? t('you') : personName(id) ?? id.slice(0, 6);
    const sub = !W.ready ? t('ex_loading') : W.loaded ? t('wf_version', { n: W.loaded.version, who: who(W.loaded.by), when: since(W.loaded.at) }) : t('wf_none');
    const head = h('header', { class: 'mx-head' }, menuBtn(), h('div', {}, h('h2', {}, withIcon('settings', t('wf_title', { space: spaceName(space) }), 18)), h('p', {}, sub)));
    const shell = (...kids: (Node | null)[]) => h('section', { class: 'overview settings workflow' }, head, h('div', { class: 'scroll' }, ...kids));
    if (!admin(space)) return shell(h('div', { class: 'blank' }, t('admin_only')));
    if (!W.ready) return shell();
    const back = h('div', { class: 'sp-hint' }, h('a', { href: routeOf({ kind: 'settings', id: space, tab: 'work' }, null) }, t('wf_back')));
    if (!W.draft) {
      const pick = (name: FlowTemplate, title: Key, desc: Key) => h('button', { class: 'sp-row sp-mode wf-tpl', 'data-k': `wf-tpl-${name}`, onclick: () => { W.draft = fromTemplate(name); render(); } },
        h('span', { class: 'sp-name' }, h('b', {}, t(title)), h('span', { class: 'sp-desc' }, t(desc))));
      return shell(back, h('section', { class: 'ov-block' }, h('div', { class: 'group label' }, t('wf_start')), pick('dev', 'wf_tpl_dev', 'wf_tpl_dev_desc'), pick('content', 'wf_tpl_content', 'wf_tpl_content_desc')));
    }
    const d = W.draft, team = W.team;
    const issues = validateFlow(d);
    const teamIssues = validateTeam(team, d, W.agents);
    const bundle = W.target && !issues.length && !teamIssues.length ? bundleIssues(bundleFiles(d, team, W.target)) : [];
    const set = (x: FlowDef) => { W.draft = x; W.notice = ''; W.err = ''; render(); };
    const setTeam = (x: FlowTeam) => { W.team = x; W.notice = ''; W.err = ''; render(); };
    const badT = (path: string) => teamIssues.some(x => x.path === path || x.path.startsWith(path + '.')) ? 'bad' : '';
    const bad = (path: string) => issues.some(x => x.path === path) ? 'bad' : '';
    const val = (e: Event) => (e.target as HTMLInputElement).value;
    const btn = (label: string, aria: string, k: string, on: () => void, disabled = false) => h('button', { class: 'btn ic wf-btn', type: 'button', title: aria, 'aria-label': aria, 'data-k': k, disabled, onclick: on }, label);
    const tools = (k: string, i: number, n: number, up: () => void, down: () => void, del: () => void) => h('span', { class: 'wf-tools' },
      btn('↑', t('wf_up'), `${k}-up`, up, i === 0), btn('↓', t('wf_down'), `${k}-down`, down, i === n - 1), btn('×', t('wf_remove'), `${k}-del`, del));
    // Name
    const nameEl = h('section', { class: 'ov-block' }, h('div', { class: 'sp-field' }, h('label', { class: 'label' }, t('wf_name')),
      h('input', { class: `wf-mono ${bad('name')}`, value: d.name, maxlength: 40, 'data-k': 'wf-name', 'aria-label': t('wf_name'), spellcheck: 'false', oninput: (e: Event) => set({ ...d, name: val(e) }) }),
      h('div', { class: 'sp-hint' }, t('wf_name_hint', { file: `flows/${d.name}.yml` }))));
    // Columns
    const columns = h('section', { class: 'ov-block' }, h('div', { class: 'group label' }, t('wf_columns')), h('div', { class: 'sp-hint' }, t('wf_columns_hint')),
      ...d.states.map((s, i) => h('div', { class: 'wf-row', 'data-k': `wf-st-${i}` },
        h('input', { class: `wf-mono wf-key ${bad(`states.${i}.key`)}`, value: s.key, maxlength: 40, spellcheck: 'false', 'aria-label': t('wf_key'), placeholder: t('wf_key'), oninput: (e: Event) => set(setStateKey(d, i, val(e))) }),
        h('input', { class: `wf-col ${bad(`states.${i}.column`)}`, value: s.column, maxlength: 60, 'aria-label': t('wf_column'), placeholder: t('wf_column'), oninput: (e: Event) => set(setColumn(d, i, val(e))) }),
        tools(`wf-st-${i}`, i, d.states.length, () => set(moveState(d, i, -1)), () => set(moveState(d, i, 1)), () => set(removeState(d, i))))),
      h('div', { class: 'sp-actions' }, h('button', { class: 'btn', type: 'button', 'data-k': 'wf-add-state', onclick: () => set(addState(d)) }, t('wf_add_column'))));
    // Roles: assignment, label colour, triggers per column (closed list), playbook per trigger
    const roleEl = (r: FlowRole, i: number) => {
      const label = roleLabel(r);
      const used = usedTriggers(r);
      const grid = r.assign === 'human' ? null : h('table', { class: 'wf-grid', 'aria-label': t('wf_triggers') },
        h('thead', {}, h('tr', {}, h('th', {}, t('wf_column')), ...FLOW_TRIGGERS.map(tr => h('th', { title: t(`wf_tr_${tr}_desc` as Key) }, wfTrigger(tr))))),
        h('tbody', {}, ...d.states.map(s => h('tr', { class: bad(`roles.${i}.on.${s.key}`) }, h('th', {}, s.column || s.key),
          ...FLOW_TRIGGERS.map(tr => h('td', {}, h('input', { type: 'checkbox', 'data-k': `wf-tr-${i}-${s.key}-${tr}`, 'aria-label': `${s.column || s.key} · ${wfTrigger(tr)}`,
            checked: (r.on[s.key] ?? []).includes(tr), onchange: () => set(toggleTrigger(d, i, s.key, tr)) })))))));
      const books = used.map(tr => h('div', { class: 'wf-row', 'data-k': `wf-pb-${i}-${tr}` }, h('span', { class: 'wf-pb-for' }, t('wf_playbook_for', { trigger: wfTrigger(tr) })),
        h('select', { class: bad(`roles.${i}.playbooks.${tr}`), 'aria-label': t('wf_playbook_for', { trigger: wfTrigger(tr) }), onchange: (e: Event) => set(setPlaybookOf(d, i, tr, val(e))) },
          h('option', { value: '', selected: !r.playbooks[tr], disabled: true }, t('wf_pick')),
          ...d.playbooks.map(p => h('option', { value: p.file, selected: r.playbooks[tr] === p.file }, p.file)))));
      return h('div', { class: `wf-role ${issuesAt(issues, `roles.${i}`).length ? 'has-bad' : ''}`, 'data-k': `wf-role-${i}` },
        h('div', { class: 'wf-row' },
          h('input', { class: `wf-mono wf-key ${bad(`roles.${i}.name`)}`, value: r.name, maxlength: 40, spellcheck: 'false', 'aria-label': t('wf_role_name'), placeholder: t('wf_role_name'),
            oninput: (e: Event) => { W.team = renameTeamRole(W.team, r.name, val(e)); set(setRoleName(d, i, val(e))); } }),
          h('select', { 'data-k': `wf-assign-${i}`, 'aria-label': t('wf_assign'), onchange: (e: Event) => set(setAssign(d, i, val(e) as RoleAssign)) },
            ...(['all', 'label', 'auto', 'human'] as RoleAssign[]).map(a => h('option', { value: a, selected: r.assign === a }, t(WF_ASSIGN[a][0])))),
          label ? h('input', { type: 'color', class: `wf-color ${bad(`roles.${i}.color`)}`, value: `#${r.color || '6e7781'}`, title: t('wf_color'), 'aria-label': t('wf_color'), onchange: (e: Event) => set(setColor(d, i, val(e))) }) : null,
          label ? h('span', { class: 'chip wf-label' }, label) : null,
          tools(`wf-role-${i}`, i, d.roles.length, () => set(moveRole(d, i, -1)), () => set(moveRole(d, i, 1)), () => { W.team = renameTeamRole(W.team, r.name, null); set(removeRole(d, i)); })),
        h('div', { class: 'sp-hint' }, t(WF_ASSIGN[r.assign][1], { label: label ?? '' })),
        grid, ...books);
    };
    const roles = h('section', { class: 'ov-block' }, h('div', { class: 'group label' }, t('wf_roles')), ...d.roles.map(roleEl),
      h('div', { class: 'sp-actions' }, h('button', { class: 'btn', type: 'button', 'data-k': 'wf-add-role', onclick: () => set(addRole(d)) }, t('wf_add_role'))));
    // Playbooks (markdown), folded: open ones are remembered across renders
    const usedBy = (file: string) => d.roles.flatMap(r => Object.entries(r.playbooks).filter(([, f]) => f === file).map(([tr]) => `${r.name} · ${wfTrigger(tr as FlowTrigger)}`));
    const playbooks = h('section', { class: 'ov-block' }, h('div', { class: 'group label' }, t('wf_playbooks')), h('div', { class: 'sp-hint' }, t('wf_playbooks_hint')),
      ...d.playbooks.map((p, i) => {
        const k = `pb:${i}`, users = usedBy(p.file);
        const body = h('textarea', { class: `wf-mono ${bad(`playbooks.${i}.body`)}`, rows: 10, spellcheck: 'false', 'aria-label': p.file, oninput: (e: Event) => set(setPlaybookBody(d, i, val(e))) }) as HTMLTextAreaElement;
        body.value = p.body;
        return h('details', { class: `wf-book ${issuesAt(issues, `playbooks.${i}`).length ? 'has-bad' : ''}`, 'data-k': `wf-book-${i}`, open: W.open.has(k),
          ontoggle: (e: Event) => { if ((e.target as HTMLDetailsElement).open) W.open.add(k); else W.open.delete(k); } },
          h('summary', {}, h('b', { class: 'wf-mono' }, p.file), ' ', h('span', { class: 'sp-desc' }, users.length ? t('wf_used_by', { list: users.join(', ') }) : t('wf_unused'))),
          h('div', { class: 'wf-row' }, h('input', { class: `wf-mono wf-key ${bad(`playbooks.${i}.file`)}`, value: p.file, maxlength: 60, spellcheck: 'false', 'aria-label': t('wf_file'), oninput: (e: Event) => set(setPlaybookFile(d, i, val(e))) }),
            btn('×', t('wf_remove'), `wf-book-${i}-del`, () => set(removePlaybook(d, i)))),
          body);
      }),
      h('div', { class: 'sp-actions' }, h('button', { class: 'btn', type: 'button', 'data-k': 'wf-add-book', onclick: () => { W.open.add(`pb:${d.playbooks.length}`); set(addPlaybook(d)); } }, t('wf_add_playbook'))));
    // Kinds (one per line, raw text kept while typing) and artifact
    const kinds = h('textarea', { class: `wf-mono ${issuesAt(issues, 'kinds').length ? 'bad' : ''}`, rows: 8, spellcheck: 'false', 'data-k': 'wf-kinds', 'aria-label': t('wf_kinds'),
      oninput: (e: Event) => { W.kindsText = val(e); set({ ...d, kinds: parseKinds(W.kindsText) }); } }) as HTMLTextAreaElement;
    kinds.value = W.kindsText ?? d.kinds.join('\n');
    const more = h('section', { class: 'ov-block' },
      h('div', { class: 'sp-field' }, h('label', { class: 'label' }, t('wf_kinds')), kinds, h('div', { class: 'sp-hint' }, t('wf_kinds_hint'))),
      h('div', { class: 'sp-field' }, h('label', { class: 'label' }, t('wf_artifact')),
        h('input', { class: `wf-mono ${bad('artifact')}`, value: d.artifact, maxlength: 200, spellcheck: 'false', 'aria-label': t('wf_artifact'), oninput: (e: Event) => set({ ...d, artifact: val(e) }) }),
        h('div', { class: 'sp-hint' }, t('wf_artifact_hint'))));
    // Team (slice 3): the space's agents, their roles, App login, limits and sheet; trusted authors and bots; culture
    const order = W.agents;
    const staffRoles = d.roles.filter(r => r.assign !== 'human').map(r => r.name);
    const agentEl = (name: string) => {
      const a = agentOf(team, name), i = team.agents.findIndex(x => x.name === name), p = `team.agents.${i}`;
      const k = `sheet:${name}`;
      const sheet = h('textarea', { class: `wf-mono ${i >= 0 ? badT(`${p}.sheet`) : ''}`, rows: 6, spellcheck: 'false', 'data-k': `wf-sheet-${name}`, 'aria-label': t('wf_sheet'),
        oninput: (e: Event) => setTeam(setTeamAgent(team, name, { sheet: val(e) }, order)) }) as HTMLTextAreaElement;
      sheet.value = a.sheet;
      return h('div', { class: `wf-agent ${i >= 0 && badT(p) ? 'has-bad' : ''}`, 'data-k': `wf-agent-${name}` },
        h('div', { class: 'wf-row' }, h('b', {}, cap(name)),
          ...staffRoles.map(r => h('label', { class: 'wf-check' }, h('input', { type: 'checkbox', 'data-k': `wf-ar-${name}-${r}`, checked: a.roles.includes(r), onchange: () => setTeam(toggleAgentRole(team, name, r, order)) }), ' ', r)),
          a.roles.length ? null : h('span', { class: 'sp-desc' }, t('wf_agent_idle'))),
        h('div', { class: 'wf-row' }, h('span', { class: 'wf-pb-for' }, t('wf_identity')),
          h('input', { class: `wf-mono ${i >= 0 ? badT(`${p}.identity`) : ''}`, value: a.identity, maxlength: 39, spellcheck: 'false', placeholder: `${name}-app`, 'data-k': `wf-id-${name}`, 'aria-label': t('wf_identity'),
            oninput: (e: Event) => setTeam(setTeamAgent(team, name, { identity: val(e).trim().toLowerCase().replace(/\[bot\]$/, '') }, order)) })),
        h('div', { class: 'wf-limits' }, ...LIMIT_KEYS.map((lk: LimitKey) => h('label', { class: 'wf-limit' }, h('span', {}, t(`wf_lim_${lk}` as Key)),
          h('input', { type: 'number', min: LIMIT_BOUNDS[lk].min, max: LIMIT_BOUNDS[lk].max, step: LIMIT_BOUNDS[lk].int ? 1 : 0.5, class: i >= 0 ? badT(`${p}.limits.${lk}`) : '',
            value: a.limits[lk] === undefined || Number.isNaN(a.limits[lk]) ? '' : String(a.limits[lk]), placeholder: t('wf_default'), 'data-k': `wf-lim-${name}-${lk}`,
            onchange: (e: Event) => setTeam(setLimit(team, name, lk, val(e), order)) })))),
        h('details', { class: 'wf-book', open: W.open.has(k) || !!a.sheet, ontoggle: (e: Event) => { if ((e.target as HTMLDetailsElement).open) W.open.add(k); else W.open.delete(k); } },
          h('summary', {}, t('wf_sheet')), sheet));
    };
    const authors = team.trusted_authors.map((a, i) => h('div', { class: 'wf-row', 'data-k': `wf-ta-${i}` },
      h('input', { class: `wf-mono wf-key ${badT(`team.trusted_authors.${i}.login`)}`, value: a.login, maxlength: 39, spellcheck: 'false', placeholder: t('wf_login'), 'aria-label': t('wf_login'),
        oninput: (e: Event) => setTeam(setAuthor(team, i, { login: val(e) })) }),
      h('select', { class: badT(`team.trusted_authors.${i}.agent`), 'aria-label': t('wf_taken_by'), onchange: (e: Event) => setTeam(setAuthor(team, i, { agent: val(e) })) },
        h('option', { value: '', selected: !a.agent }, t('wf_first_idle')),
        ...team.agents.filter(x => x.roles.length || x.name === a.agent).map(x => h('option', { value: x.name, selected: a.agent === x.name }, cap(x.name)))),
      btn('×', t('wf_remove'), `wf-ta-${i}-del`, () => setTeam(removeAuthor(team, i)))));
    const bots = h('textarea', { class: `wf-mono ${badT('team.trusted_bots')}`, rows: 3, spellcheck: 'false', 'data-k': 'wf-bots', 'aria-label': t('wf_bots'),
      oninput: (e: Event) => { W.botsText = val(e); setTeam({ ...team, trusted_bots: parseBots(W.botsText) }); } }) as HTMLTextAreaElement;
    bots.value = W.botsText ?? team.trusted_bots.join('\n');
    const culture = h('textarea', { class: `wf-mono ${badT('team.culture')}`, rows: 6, spellcheck: 'false', 'data-k': 'wf-culture', 'aria-label': t('wf_culture'),
      oninput: (e: Event) => setTeam({ ...team, culture: val(e) }) }) as HTMLTextAreaElement;
    culture.value = team.culture;
    const teamEl = h('section', { class: 'ov-block' }, h('div', { class: 'group label' }, t('wf_team')), h('div', { class: 'sp-hint' }, t('wf_team_hint')),
      ...(order.length ? order.map(agentEl) : [h('div', { class: 'sp-hint' }, t('wf_no_agents'))]),
      h('div', { class: 'group label' }, t('wf_trusted')), h('div', { class: 'sp-hint' }, t('wf_trusted_hint')), ...authors,
      h('div', { class: 'sp-actions' }, h('button', { class: 'btn', type: 'button', 'data-k': 'wf-add-ta', onclick: () => setTeam(addAuthor(team)) }, t('wf_add_trusted'))),
      h('div', { class: 'sp-field' }, h('label', { class: 'label' }, t('wf_bots')), bots, h('div', { class: 'sp-hint' }, t('wf_bots_hint'))),
      h('div', { class: 'sp-field' }, h('label', { class: 'label' }, t('wf_culture')), culture, h('div', { class: 'sp-hint' }, t('wf_culture_hint'))));
    // Where the config lives: briefling, or a git repo (one of the attached repos) the hub reads and commits to
    const repos = W.target?.repos ?? [];
    const setSrc = (x: FlowSource | null, read: boolean) => { W.source = x; W.notice = ''; W.err = ''; if (read) wfHead(W); render(); };
    const gitState = !W.source ? null : W.gitErr ? h('div', { class: 'err sp-err', 'data-k': 'wf-git-state' }, t('wf_git_err', { error: W.gitErr }))
      : h('div', { class: 'sp-hint', 'data-k': 'wf-git-state' }, W.head ? t('wf_git_head', { sha: W.head.slice(0, 7) }) : t('wf_git_reading'));
    const sourceEl = h('section', { class: 'ov-block', 'data-k': 'wf-source' }, h('div', { class: 'group label' }, t('wf_source')),
      h('label', { class: 'wf-check' }, h('input', { type: 'radio', name: 'wf-src', 'data-k': 'wf-src-briefling', checked: !W.source, onchange: () => setSrc(null, false) }), ' ', t('wf_src_briefling')),
      h('label', { class: 'wf-check' }, h('input', { type: 'radio', name: 'wf-src', 'data-k': 'wf-src-git', checked: !!W.source, disabled: !repos.length,
        onchange: () => setSrc({ repo: repos[0], branch: 'main', dir: '' }, true) }), ' ', repos.length ? t('wf_src_git') : t('wf_src_git_none')),
      W.source ? h('div', { class: 'wf-row' },
        h('select', { 'data-k': 'wf-src-repo', 'aria-label': t('wf_src_repo'), onchange: (e: Event) => setSrc({ ...W.source!, repo: val(e) }, true) },
          ...repos.map(r => h('option', { value: r, selected: r.toLowerCase() === W.source!.repo.toLowerCase() }, r))),
        h('input', { class: 'wf-mono wf-key', value: W.source.branch, maxlength: 100, spellcheck: 'false', 'data-k': 'wf-src-branch', 'aria-label': t('wf_src_branch'), placeholder: 'main',
          oninput: (e: Event) => { W.source = { ...W.source!, branch: val(e).trim() }; W.head = null; }, onchange: () => setSrc(W.source, true) }),
        h('input', { class: 'wf-mono wf-key', value: W.source.dir, maxlength: 200, spellcheck: 'false', 'data-k': 'wf-src-dir', 'aria-label': t('wf_src_dir'), placeholder: t('wf_src_dir'),
          oninput: (e: Event) => { W.source = { ...W.source!, dir: val(e).trim().replace(/^\/+|\/+$/g, '') }; W.head = null; }, onchange: () => setSrc(W.source, true) })) : null,
      W.source ? h('label', { class: 'wf-check' }, h('input', { type: 'checkbox', 'data-k': 'wf-src-readonly', checked: !!W.source.readonly,
        onchange: (e: Event) => { const { readonly: _, ...rest } = W.source!; setSrc((e.target as HTMLInputElement).checked ? { ...rest, readonly: true } : rest, false); } }), ' ', t('wf_src_readonly')) : null,
      W.source ? h('div', { class: 'sp-hint' }, t(W.source.readonly ? 'wf_src_readonly_hint' : 'wf_src_git_hint')) : null, gitState);
    // What each flow agent's plugin made of the versions pushed to it
    const latestV = W.history[0]?.version ?? 0;
    const staffed = team.agents.filter(a => a.roles.length).map(a => a.name);
    const statusEl = W.loaded && (staffed.length || W.status.length) ? h('section', { class: 'ov-block', 'data-k': 'wf-status' }, h('div', { class: 'group label' }, t('wf_status')),
      ...[...new Set([...staffed, ...W.status.map(x => x.agent)])].map(ag => {
        const st = W.status.find(x => x.agent === ag);
        const text = wfStatusText(ag, st, latestV);
        return h('div', { class: `wf-st ${st && !st.ok ? 'err' : ''}`, 'data-k': `wf-st-${ag}`, title: st ? new Date(st.at).toLocaleString(lang()) : '' }, text);
      }),
      h('div', { class: 'sp-actions' }, h('button', { class: 'btn', type: 'button', 'data-k': 'wf-st-refresh', onclick: () => wfAsk(space) }, t('wf_st_refresh')))) : null;
    // Generated YAML (read only)
    let yaml = '';
    try { yaml = flowYaml(d); } catch { yaml = ''; }
    const preview = h('section', { class: 'ov-block' }, h('div', { class: 'group label' }, t('wf_yaml')),
      h('div', { class: 'sp-hint' }, t('wf_yaml_hint', { file: `flows/${d.name}.yml`, n: d.playbooks.length })),
      h('pre', { class: 'wf-yaml', 'data-k': 'wf-yaml' }, yaml),
      W.target ? h('div', { class: 'group label' }, t('wf_config_yaml')) : null,
      W.target ? h('div', { class: 'sp-hint' }, W.target.board ? t('wf_config_hint', { space: W.target.space, board: `${W.target.board.owner} #${W.target.board.number}` }) : t('wf_config_no_board')) : null,
      W.target ? h('pre', { class: 'wf-yaml', 'data-k': 'wf-config-yaml' }, configYaml(d, team, W.target)) : null);
    // Save: issues first, then the changes against the loaded version
    const srcMoved = !sameSource(W.source, W.loaded?.source ?? null);
    const dirty = !sameFlow(d, W.loaded?.def ?? null) || JSON.stringify(team) !== JSON.stringify(W.loaded?.team ?? EMPTY_TEAM) || srcMoved;
    const srcBad = !!W.source && !sourceOk(W.source, W.target?.repos ?? []);
    const noHead = !!W.source && !W.head;
    const next = (W.history[0]?.version ?? 0) + 1;
    const save = () => { const cid = newCid(); if (send({ type: 'flowcfg.save', client_id: cid, space, base: W.history[0]?.version ?? 0, def: d, team, source: W.source, ...(W.source && W.head ? { head: W.head } : {}) })) { W.cid = cid; W.err = ''; W.notice = ''; render(); } };
    const allIssues = issues.length + teamIssues.length + bundle.length + (srcBad ? 1 : 0);
    const teamWhere = (path: string) => { const [, area, i] = path.split('.'), n = Number(i);
      if (area === 'agents' && team.agents[n]) return t('wf_at_agent', { name: cap(team.agents[n].name) });
      if (area === 'trusted_authors' && team.trusted_authors[n]) return t('wf_at_login', { name: team.trusted_authors[n].login || '…' });
      return ''; };
    const saveEl = h('section', { class: 'ov-block wf-save' },
      allIssues ? h('div', { class: 'err sp-err', role: 'status', 'data-k': 'wf-issues' }, h('div', {}, t('wf_fix')),
        h('ul', {}, ...issues.slice(0, 12).map(x => { const at = wfWhere(d, x.path); return h('li', {}, t(WF_ISSUE[x.code]), at ? ` (${at})` : ''); }),
          ...teamIssues.slice(0, 12).map(x => { const at = teamWhere(x.path); return h('li', {}, t(WF_TEAM_ISSUE[x.code]), at ? ` (${at})` : ''); }),
          ...bundle.slice(0, 4).map(x => h('li', {}, x.code === 'too_big' ? t('bc_too_big') : x.code === 'secret' ? t('fc_secret') : t('bc_path'), x.path ? ` (${x.path})` : '')),
          srcBad ? h('li', {}, t('wf_src_bad')) : null)) : null,
      srcMoved ? h('div', { class: 'sp-hint', 'data-k': 'wf-src-moved' }, W.source ? t('wf_src_to_git', { where: `${W.source.repo} · ${W.source.branch}${W.source.dir ? ` · ${W.source.dir}/` : ''}` }) : t('wf_src_to_briefling')) : null,
      dirty ? h('div', { class: 'group label' }, W.loaded ? t('wf_changes', { n: W.loaded.version }) : t('wf_changes_new')) : null,
      dirty && W.loaded ? wfDiffEl(W.loaded, { def: d, team }, 'wf-changes') : null,
      W.err ? h('div', { class: 'err sp-err', role: 'alert' }, W.err) : null,
      W.notice ? h('div', { class: 'sp-notice', role: 'status' }, W.notice) : null,
      h('div', { class: 'sp-actions' },
        h('button', { class: 'btn pri', type: 'button', 'data-k': 'wf-save', disabled: !!W.cid || !dirty || allIssues > 0 || noHead, onclick: save }, W.cid ? t('wf_saving') : W.source ? t('wf_save_git', { n: next }) : t('wf_save', { n: next })),
        W.err && W.source ? h('button', { class: 'btn', type: 'button', 'data-k': 'wf-reload-head', onclick: () => { W.err = ''; wfHead(W); render(); } }, t('wf_reload_head')) : null,
        dirty ? h('button', { class: 'btn', type: 'button', 'data-k': 'wf-discard', onclick: () => { wfPut(W, W.loaded); W.notice = ''; W.err = ''; render(); } }, t('wf_discard')) : null));
    // History: who and when, the changes of each version against the previous one, load an old one (rollback = save it again)
    const need = (v: number) => { if (v > 0 && !W.versions.has(v)) wfAsk(space, v); };
    const history = W.history.length ? h('section', { class: 'ov-block' }, h('div', { class: 'group label' }, t('wf_history')), h('div', { class: 'sp-hint' }, t('wf_load_hint')),
      ...W.history.map(m => {
        const prev = W.history.find(x => x.version < m.version)?.version ?? 0;
        const a = prev ? W.versions.get(prev) : null, b = W.versions.get(m.version);
        const open = W.show === m.version;
        return h('div', { class: 'wf-ver', 'data-k': `wf-v${m.version}` },
          h('div', { class: 'wf-row' }, h('b', {}, `v${m.version}`), h('span', {}, who(m.by)), h('span', { class: 'sp-desc', title: new Date(m.at).toLocaleString(lang()) }, since(m.at)),
            h('span', { class: 'wf-tools' },
              h('button', { class: 'btn', type: 'button', 'data-k': `wf-v${m.version}-diff`, onclick: () => { W.show = open ? 0 : m.version; if (!open) { need(m.version); need(prev); } render(); } }, open ? t('wf_hide') : t('wf_diff')),
              m.version !== W.loaded?.version || dirty ? h('button', { class: 'btn', type: 'button', 'data-k': `wf-v${m.version}-load`,
                onclick: () => { if (W.versions.has(m.version)) { wfPut(W, W.versions.get(m.version)!); W.notice = t('wf_loaded', { n: m.version }); render(); } else { W.load = m.version; need(m.version); } } }, t('wf_load')) : null)),
          open ? (b && (a || !prev) ? (prev ? wfDiffEl(a!, b, `wf-v${m.version}-d`) : h('div', { class: 'sp-hint' }, t('wf_first'))) : h('div', { class: 'sp-hint' }, t('ex_loading'))) : null);
      })) : null;
    return shell(back, statusEl, sourceEl, nameEl, columns, roles, teamEl, playbooks, more, saveEl, preview, history);
  }
  /** `flowcfg*` answers and the errors of a save or a head read: true = handled. */
  function frame(f: HubFrame): boolean {
    if (f.type === 'flowcfg') { onFlowcfg(f); }
    else if (f.type === 'flowcfg.saved') { onFlowcfgSaved(f); }
    else if (f.type === 'flowcfg.git') { onFlowcfgGit(f); }
    else if (f.type === 'error' && f.ref && WF && f.ref === WF.cid) { WF.cid = ''; WF.err = f.code === 'changed_meanwhile' ? t('err_changed_meanwhile', { detail: f.detail ?? '' }) : errText(f.code); }
    else if (f.type === 'error' && f.ref && WF && f.ref === WF.headCid) { WF.gitErr = errText(f.code); }
    else return false;
    return true;
  }
  return {
    el: workflowView, summaryEl: wfSummaryEl, frame,
    entered(space, ready) { if (wfFor !== space && ready) { wfFor = space; WF = wfNew(space); wfAsk(space); } },
    left() { wfFor = ''; },
  };
}
