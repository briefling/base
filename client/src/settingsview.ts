// Space settings (admins): the Settings page of a space and the new-space page (general, members, agents, work,
// memory, routines, Radar, correspondents, advanced), their hub answers and their route hook (data asked on every entry).
// Its own file since the modules refactor: main.ts keeps the frame dispatch, `space.updated` and the sidebar; this file
// owns the form, the save in flight and the per-section state. `S` is main.ts' app state it shares (view, admin data,
// error line, directory); the Lounge's « Draft with the agent » panel, the memory import and the workflow summary come
// from main.ts as callbacks.
import type { AgentInvite, AgentPlugin, DirectoryPerson, Driver, FlowPilot, HubFrame, Parallel, PublicThread, SpaceSettings } from '../../protocol/frames.ts';
import { FLOW_SWITCH_TTL_MS, MAX_EMAIL, MAX_PARALLEL, MAX_RESOURCES, MAX_ROLE, RESOURCE_RULE_MAX, RESOURCE_TYPES, normEmail } from '../../protocol/frames.ts';
import { CORRESPONDENTS_MAX, CORRESPONDENT_ROLES, correspondentLabel, type Correspondent, type ExchangeConfig } from '../../protocol/exchanges.ts';
import { MEMORY_BATCH_MINUTES, MEMORY_BATCH_N, MEMORY_COMPACT_N, TAG_MAX_BOUNDS, MEMORY_COMPACT_WORDS, agentReviews, visibleAgents, type MemoryMode } from '../../protocol/memory.ts';
import { MODULES, PRESET_NAMES, presetOf, type Preset } from '../../protocol/modules.ts';
import { RELAY_MAX_BOUNDS } from '../../protocol/relay.ts';
import { latestFor, pluginStatus } from '../../protocol/plugin.ts';
import { dotOf, type Dot, type Presence } from '../../protocol/presence.ts';
import { PROFILE_PRODUCT_LINES, RADAR_TYPES, type RadarConfig, type RadarRhythm } from '../../protocol/radar.ts';
import { ROUTINES_MAX, ROUTINE_INSTRUCTION_MAX, ROUTINE_NAME_MAX, type Routine } from '../../protocol/routines.ts';
import { agentLink, canRevoke, inviteDate, invitesOf, mergeInvites, normAgent } from './agentinvite.ts';
import { usdLabel } from './cost.ts';
import { addrsOf } from './exchanges.ts';
import { EX_ROLE } from './exchangesview.ts';
import { pilotAction, pilotAgents, pilotOf, pilotStatus, switchLink, switchPrompt } from './flowpilot.ts';
import { hasKey, lang, quote, type Key } from './i18n.ts';
import type { MemoryModule } from './memoryview.ts';
import type { UiKit } from './modules.ts';
import { profileDiff, radarForm, radarFormError, radarPayload, radarRunning, rejectPayload, settingsChanged, type RadarForm } from './radarcfg.ts';
import { routeOf, type View } from './route.ts';
import { daysText, editRoutine, newRoutine, routineFormError, routinePayload, toggleDay, type RoutineForm } from './routines.ts';
import { CHANGE_TAB, ROLES, addResource, changed, changes, formError, formOf, newForm, payload, removeResource, resourceOf, roleOf, setAgent, setAgentAvatar, setAgentRole,
  hiddenOf, setDefault, setMax, setMode, setModule, setName, setNontech, repoOutsideOrgs, setSpaceAdmin, setPreset, setResource, setRole, tabsOn, type Role, type SpTab, type SpaceForm } from './spaces.ts';
import type { WorkflowEditor } from './workflowview.ts';

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const newCid = () => b64url(crypto.getRandomValues(new Uint8Array(32))).slice(0, 20); // same ids as main.ts' rand()

/** Admin data of the Settings (`admin.spaces`): read again on every entry in an admin page. */
export interface AdminData { spaces: SpaceSettings[]; people: DirectoryPerson[]; agents: string[]; invites: AgentInvite[]; plugins: Record<string, AgentPlugin> }
/** The part of main.ts' app state the Settings read and write. */
export interface SettingsShared {
  me: string;
  view: View;
  admin: boolean;
  adm: AdminData | null;
  err: string;
  aboutApply: { space: string; text: string; base: string; thread: string; msg: string } | null;
  parallel: Map<string, Parallel>;
  presence: Map<string, Presence[]>;
  repos: Map<string, string[]>;
  threads: Map<string, PublicThread>;
}
/** What main.ts lends the Settings beyond the UiKit. */
export interface SettingsDeps {
  /** Global admin, or admin of this space (its Settings only; creating, archiving and naming admins stay global). */
  spaceAdmin(space: string): boolean;
  /** Shows a thread or topic (after the caller set the view). */
  open(id: string): void;
  mem(): MemoryModule;
  wf(): WorkflowEditor;
  /** The « Draft with the agent » panel under the brief (main.ts, shared with the Lounge card). */
  aboutAskEl(cur: SpaceSettings): HTMLElement;
  avatarField(src: string, name: string, kind: 'human' | 'agent', k: string, pick: (f: File | undefined) => void, remove: () => void, disabled?: boolean): HTMLElement;
  pickAvatar(file: File, ok: (src: string) => void, ko: (err: string) => void): Promise<void>;
  presDot(d: Dot | null): HTMLElement | null;
  whenShort(ms: number): string;
  /** Opens the profile dialog on an invitee who never signed in (client/src/loginview.ts). */
  openMember(p: DirectoryPerson): void;
  /** Standalone server only: the agents of this machine (client/src/machineview.ts), under « Invite an agent ». */
  machine?: (space: string) => HTMLElement;
  /** Standalone server with OIDC: an invitation is an address allowed to sign in, no mail, no temporary password. */
  oidc?: boolean;
}
export interface SettingsModule {
  /** The Settings page of `S.view` (settings or newspace), built on each render. */
  el(): HTMLElement;
  /** A hub answer or refusal for the Settings: true = handled (the caller renders). */
  frame(f: HubFrame): boolean;
  /** `radarcfg.updated` / `flowpilot.updated`: true = handled (the caller renders). */
  event(f: HubFrame): boolean;
  /** An invitee renamed or reinvited by the admin: their row follows. */
  memberSaved(f: Extract<HubFrame, { type: 'member.saved' }>): void;
  /** `correspondents.updated`: the list of Settings › Correspondents when it shows that space. */
  correspondents(space: string, list: Correspondent[]): void;
  /** Route hook (each render): data asked on every entry in a page, transient state dropped when leaving. */
  route(v: View, online: boolean): void;
  /** The form has unsaved changes. */
  dirty(): boolean;
  /** Settings › Radar's config per space (the Radar view's « last pass · next » line). */
  radarCfgBy: Map<string, RadarConfig>;
}

export function settingsModule(kit: UiKit, S: SettingsShared, d: SettingsDeps): SettingsModule {
  const { h, t, tn, render, request, send, post, errText, since, spaceName, menuBtn, personAvatar, withIcon } = kit;
  const { open, mem, wf, aboutAskEl, avatarField, pickAvatar, presDot, whenShort, spaceAdmin } = d;
  /** Settings of this view open to me: the spaces page (new space) is global admins only. */
  const viewAdmin = (v: View) => v.kind === 'newspace' ? S.admin : v.kind === 'settings' && spaceAdmin(v.id);
  // The form being edited ('new' or the space id), the save in flight (client_id), « Saved », the Lounge card applied
  // (sent with the next save of its space), the pilots of the board-driven spaces.
  const P = {
    form: null as SpaceForm | null, formKey: '',
    saving: '', notice: '',
    aboutCard: null as { space: string; thread: string; msg: string } | null,
    pilots: new Map<string, FlowPilot[]>(),
  };
  const ROLE_KEY: Record<Role, Key> = { none: 'role_none', member: 'role_member', contributor: 'role_contributor', lead: 'role_lead' };
  // Settings › Correspondents (global admins): who a mail must involve to be imported in the space's exchanges.
  let corrFor = '', corrList: Correspondent[] | null = null, corrEdit: { id?: string; version?: number; name: string; company: string; role: Correspondent['role']; addrs: string } | null = null;
  let corrMsg: { err: boolean; text: string } | null = null, corrBusy = false, corrDelAsk = '', corrCfg: ExchangeConfig | null = null;
  async function corrSend(space: string, frame: Record<string, unknown>) {
    corrBusy = true; corrMsg = null; render();
    const r = await request({ ...frame, space, type: String(frame.type) }, 8000, true);
    corrBusy = false;
    if (r?.type === 'correspondent.list') { corrList = r.correspondents; corrCfg = r.config ?? null; if (frame.type !== 'correspondent.list') { corrEdit = null; corrDelAsk = ''; corrMsg = { err: false, text: t('ex_saved') }; } }
    else corrMsg = { err: true, text: r?.type === 'error' && r.code === 'duplicate' ? t('ex_err_duplicate') : r?.type === 'error' && r.code === 'bad_frame' ? t('ex_err_addr') : errText(r?.type === 'error' ? r.code : 'timeout') };
    render();
  }
  function contactsSection(cur: SpaceSettings) {
    const row = (c: Correspondent) => h('div', { class: 'sp-row', 'data-corr': c.id },
      h('span', { class: 'sp-name' }, h('b', {}, correspondentLabel(c)), h('span', { class: 'sp-desc' }, [c.company ? c.name : '', t(EX_ROLE[c.role]), c.addrs.join(', ')].filter(Boolean).join(' · '))),
      h('button', { class: 'btn ghost', type: 'button', disabled: corrBusy, 'data-k': `corr-edit-${c.id}`, onclick: () => { corrEdit = { id: c.id, version: c.version, name: c.name, company: c.company, role: c.role, addrs: c.addrs.join(', ') }; corrMsg = null; render(); } }, t('rt_edit')),
      h('button', { class: 'btn ghost', type: 'button', disabled: corrBusy, 'data-k': `corr-del-${c.id}`, onclick: () => {
        if (corrDelAsk !== c.id) { corrDelAsk = c.id; render(); return; }
        corrSend(cur.id, { type: 'correspondent.delete', id: c.id, version: c.version }); } }, corrDelAsk === c.id ? t('rt_delete_confirm') : t('rt_delete')));
    const e = corrEdit;
    const editor = e ? h('div', { class: 'ov-block corr-edit', 'data-k': 'corr-editor' },
      h('label', { class: 'sp-field' }, h('span', {}, t('ex_c_company')), h('input', { 'data-draft': 'corr-company', value: e.company, maxlength: 120, required: true, oninput: (ev: Event) => { e.company = (ev.target as HTMLInputElement).value; } })),
      h('label', { class: 'sp-field' }, h('span', {}, t('ex_c_name')), h('input', { 'data-draft': 'corr-name', value: e.name, maxlength: 120, oninput: (ev: Event) => { e.name = (ev.target as HTMLInputElement).value; } })),
      h('label', { class: 'sp-field' }, h('span', {}, t('ex_c_role')), h('select', { 'data-k': 'corr-role', onchange: (ev: Event) => { e.role = (ev.target as HTMLSelectElement).value as Correspondent['role']; } },
        ...CORRESPONDENT_ROLES.map(r => h('option', { value: r, selected: e.role === r }, t(EX_ROLE[r]))))),
      h('label', { class: 'sp-field' }, h('span', {}, t('ex_c_addrs')), h('input', { 'data-draft': 'corr-addrs', value: e.addrs, placeholder: t('ex_c_addrs_ph'), oninput: (ev: Event) => { e.addrs = (ev.target as HTMLInputElement).value; } })),
      h('div', { class: 'sp-actions' },
        h('button', { class: 'btn pri', type: 'button', 'data-k': 'corr-save', disabled: corrBusy, onclick: () => !e.company.trim() ? (corrMsg = { err: true, text: t('ex_err_company') }, render()) : corrSend(cur.id, { type: 'correspondent.save', ...(e.id ? { id: e.id, version: e.version } : {}),
          name: e.name.trim(), company: e.company.trim(), role: e.role, addrs: addrsOf(e.addrs) }) }, t('save')),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { corrEdit = null; corrMsg = null; render(); } }, t('cancel')))) : null;
    return h('section', { class: 'ov-block' }, h('div', { class: 'group label' }, t('ex_c_title')),
      h('div', { class: 'sp-hint' }, t('ex_c_hint')),
      corrList === null ? h('div', { class: 'empty' }, t('ex_loading')) : corrList.length ? h('div', { class: 'rt-list' }, ...corrList.map(row)) : h('div', { class: 'empty' }, t('ex_c_none')),
      corrMsg ? h('div', { class: corrMsg.err ? 'err sp-err' : 'sp-notice', role: 'status' }, corrMsg.text) : null,
      editor ?? h('div', { class: 'sp-actions' }, h('button', { class: 'btn', type: 'button', 'data-k': 'corr-new', disabled: corrBusy || (corrList?.length ?? 0) >= CORRESPONDENTS_MAX,
        onclick: () => { corrEdit = { name: '', company: '', role: 'client', addrs: '' }; corrMsg = null; render(); } }, t('ex_c_new'))),
      // Summary agent (tranche 2): reads the mails after a lead's sync; '' = no summaries.
      corrCfg ? h('div', { class: 'ex-agent', 'data-k': 'ex-agent-block' }, h('div', { class: 'group label' }, t('ex_agent')),
        h('div', { class: 'sp-hint' }, t('ex_agent_hint')),
        h('select', { 'data-k': 'ex-agent', 'aria-label': t('ex_agent'), disabled: corrBusy,
          onchange: (ev: Event) => corrSend(cur.id, { type: 'exchangecfg.save', agent: (ev.target as HTMLSelectElement).value, lang: lang(), version: corrCfg!.version }) },
          h('option', { value: '', selected: !corrCfg.agent }, t('ex_agent_none')), ...visibleAgents(cur).map(a => h('option', { value: a, selected: a === corrCfg!.agent }, cap(a))))) : null);
  }

  // ---------------------------------------------------------------- spaces (admin)
  // Create a space and set members, trust and agents: admin only (global role, checked again by the hub on every
  // frame). Safeguard shown: trust decides who makes the agent act. Accounts: those already member of a space, plus
  // anyone invited by e-mail from the Settings (space.invite, arrives as a plain member); agents: those an instance serves.
  let admFor = ''; // admin page whose data was requested
  let inviteText = ''; // address typed in the Settings' invite field
  let inviteCid = '';  // client_id of the invitation in flight (also held in P.saving: one admin write at a time)
  let inviteMsg: { text: string; err: boolean } | null = null; // result shown under the invite field, not by Save (may be off screen)
  // Agents block: invitation link (memory only, never stored: shown once, gone when leaving the Settings), result line,
  // and the agent whose « Remove » was clicked once (second click confirms, forgotten after 10 s).
  let agentText = '';
  let agentCid = ''; // client_id of the agent.invite / revoke / remove in flight (also held in P.saving)
  let agentMsg: { text: string; err: boolean } | null = null;
  let agentShown: { agent: string; url: string; copied: boolean } | null = null;
  let removeAsk = ''; let removeTimer = 0;
  // Pilot block (Settings › Driver, board-driven space, docs/design-flow.md § 13): pilots asked on entry; the switch
  // prompt (it holds the one-time link) is shown once, memory only, like the invitation link; « Back to unstrikeable »
  // asks a second click (forgotten after 10 s).
  let pilotFor = ''; let pilotGetCid = ''; let pilotCid = ''; let pilotAgent = '';
  // Settings › Routines: the space's routines (asked on every entry in the tab), the open editor, the result line, and the
  // routine whose « Delete » was clicked once (second click confirms, forgotten after 10 s).
  const routinesBy = new Map<string, Routine[]>();
  let routineFor = ''; let routineGetCid = ''; let routineCid = ''; let routineOp = ''; let routineOn = ''; // in flight: frame type and routine
  let routineEdit: RoutineForm | null = null;
  let routineMsg: { text: string; err: boolean } | null = null;
  let routineDelAsk = ''; let routineDelTimer = 0;
  let pilotMsg: { text: string; err: boolean } | null = null;
  let pilotShown: { agent: string; prompt: string; copied: boolean } | null = null;
  let backAsk = ''; let backTimer = 0;
  const agentReset = () => { agentText = ''; agentMsg = null; agentShown = null; removeAsk = ''; pilotFor = ''; pilotMsg = null; pilotShown = null; backAsk = ''; };
  const adminSide = () => !!P.saving && (P.saving === inviteCid || P.saving === agentCid || P.saving === pilotCid); // a write that is not Save
  /** Hub refusal of a pilot frame: plain words for the known codes (agent named), else the generic text. */
  const pilotErr = (code: string, agent: string) => { const k = `fp_err_${code}`; return hasKey(k) ? t(k, { agent: cap(agent) }) : errText(code); };
  /** Fresh pilots of a space; the shown prompt goes once its agent is piloted (the link was used). */
  function onPilots(space: string, pilots: FlowPilot[]) {
    P.pilots.set(space, pilots);
    if (pilotShown && S.view.kind === 'settings' && S.view.id === space && pilotStatus(pilotOf(pilots, pilotShown.agent), Date.now()) === 'piloted') pilotShown = null;
  }
  function onPilotFrame(f: Extract<HubFrame, { type: 'flowpilot.list' | 'flowpilot.linked' }>) {
    onPilots(f.space, f.pilots);
    if (f.client_id === pilotGetCid) pilotGetCid = '';
    if (f.client_id !== P.saving) return;
    P.saving = ''; S.err = ''; backAsk = '';
    if (f.type === 'flowpilot.linked') {
      pilotShown = { agent: f.agent, prompt: switchPrompt(switchLink(location.origin, f.code, f.space, f.agent), f.space, f.agent), copied: false };
      pilotMsg = null;
    }
  }
  /** Hub refusal of a routine frame: plain words for the known codes, else the generic text. */
  const routineErr = (code: string) => { const k = `rt_err_${code}`; return hasKey(k) ? t(k) : errText(code); };
  function onRoutines(f: Extract<HubFrame, { type: 'routine.list' }>) {
    routinesBy.set(f.space, f.routines);
    if (f.client_id === routineGetCid) routineGetCid = '';
    if (f.client_id !== P.saving) return;
    P.saving = ''; routineDelAsk = ''; routineMsg = null;
    // A run: its result is the routine's last run (shown in the list); a save closes the editor.
    if (routineOp === 'routine.save') routineEdit = null;
  }
  /** Settings › Routines (admins): list (summary, last run, Run now, Edit, Delete) and the editor. */
  function routinesSection(cur: SpaceSettings) {
    const list = routinesBy.get(cur.id), agents = visibleAgents(cur);
    const busy = !!P.saving;
    const rtSend = (frame: Record<string, unknown>) => {
      const cid = newCid();
      if (send({ ...frame, client_id: cid, space: cur.id })) { P.saving = routineCid = cid; routineOp = String(frame.type); routineOn = String(frame.id ?? ''); routineMsg = null; render(); }
    };
    const dayNames = ['', ...[1, 2, 3, 4, 5, 6, 7].map(d => t(`rt_day_${d}` as Key))];
    const lastLine = (r: Routine) => {
      const l = r.lastRun; if (!l) return h('span', { class: 'sp-me rt-last' }, t('rt_never'));
      const when = since(l.at), res = t(`rt_res_${l.result}` as Key);
      const link = l.thread && S.threads.get(l.thread) ? h('a', { href: '#', class: 'rt-open', onclick: (e: Event) => { e.preventDefault(); S.view = { kind: 'lounge', id: cur.id }; open(l.thread!); } }, t('rt_open')) : null;
      return h('span', { class: `sp-me rt-last${l.result === 'started' ? '' : ' rt-skip'}`, 'data-k': `rt-last-${r.id}` }, t('rt_last', { when, result: res }), link ? ' · ' : null, link);
    };
    const row = (r: Routine) => h('div', { class: `sp-row rt-row${r.active ? '' : ' off'}`, 'data-routine': r.id },
      h('span', { class: 'sp-name' }, h('b', {}, r.name),
        h('span', { class: 'sp-desc' }, `${cap(r.agent)} · ${daysText(r.days, dayNames, t('rt_weekdays'), t('rt_every_day'))} · ${r.time}`,
          r.radar ? h('span', { class: 'sp-tag' }, t('radar')) : null, r.active ? null : h('span', { class: 'sp-tag unknown' }, t('rt_paused'))),
        lastLine(r)),
      h('button', { class: 'btn', type: 'button', disabled: busy, 'data-k': `rt-run-${r.id}`, onclick: () => rtSend({ type: 'routine.run', id: r.id }) },
        busy && P.saving === routineCid && routineOp === 'routine.run' && routineOn === r.id ? t('rt_running') : t('rt_run')),
      h('button', { class: 'btn ghost', type: 'button', disabled: busy, 'data-k': `rt-edit-${r.id}`, onclick: () => { routineEdit = editRoutine(r); routineMsg = null; render(); } }, t('rt_edit')),
      h('button', { class: 'btn ghost', type: 'button', disabled: busy, 'data-k': `rt-del-${r.id}`, onclick: () => {
        if (routineDelAsk !== r.id) { routineDelAsk = r.id; clearTimeout(routineDelTimer); routineDelTimer = window.setTimeout(() => { routineDelAsk = ''; render(); }, 10_000); render(); return; }
        rtSend({ type: 'routine.delete', id: r.id, version: r.version }); } }, routineDelAsk === r.id ? t('rt_delete_confirm') : t('rt_delete')));
    return h('section', { class: 'ov-block rt-block' }, h('div', { class: 'group label' }, t('rt_title')),
      h('div', { class: 'sp-hint' }, t('rt_hint')),
      list === undefined ? h('div', { class: 'empty' }, t('rt_loading')) : list.length ? h('div', { class: 'rt-list' }, ...list.map(row)) : h('div', { class: 'empty' }, t('rt_none')),
      routineMsg ? h('div', { class: routineMsg.err ? 'err sp-err' : 'sp-notice', role: 'status' }, routineMsg.text) : null,
      routineEdit ? routineEditor(cur, agents, busy, rtSend)
        : h('div', { class: 'sp-actions' }, h('button', { class: 'btn', type: 'button', 'data-k': 'rt-new', disabled: busy || !agents.length || (list?.length ?? 0) >= ROUTINES_MAX,
          onclick: () => { routineEdit = newRoutine(agents.includes(cur.defaultAgent) ? cur.defaultAgent : agents[0]); routineMsg = null; render(); } }, t('rt_add'))));
  }
  function routineEditor(cur: SpaceSettings, agents: string[], busy: boolean, rtSend: (f: Record<string, unknown>) => void) {
    const f = routineEdit!;
    const set = (g: RoutineForm) => { routineEdit = g; routineMsg = null; render(); };
    const missing = routineFormError(f, agents);
    const name = h('input', { value: f.name, maxlength: ROUTINE_NAME_MAX, 'data-draft': 'rt-name', 'data-k': 'rt-name', placeholder: t('rt_name_ph'), 'aria-label': t('rt_name'), autocomplete: 'off',
      oninput: (e: Event) => set({ ...routineEdit!, name: (e.target as HTMLInputElement).value }) });
    const ins = h('textarea', { rows: 6, maxlength: ROUTINE_INSTRUCTION_MAX, 'data-draft': 'rt-instruction', 'data-k': 'rt-instruction', placeholder: t('rt_instruction_ph'), 'aria-label': t('rt_instruction'),
      oninput: (e: Event) => set({ ...routineEdit!, instruction: (e.target as HTMLTextAreaElement).value }) }) as HTMLTextAreaElement;
    ins.value = f.instruction;
    const agentSel = h('select', { 'data-k': 'rt-agent', 'aria-label': t('rt_agent'), onchange: (e: Event) => set({ ...routineEdit!, agent: (e.target as HTMLSelectElement).value }) },
      ...agents.map(a => h('option', { value: a, selected: a === f.agent }, cap(a)))) as HTMLSelectElement;
    const time = h('input', { type: 'time', value: f.time, 'data-k': 'rt-time', 'aria-label': t('rt_time'), oninput: (e: Event) => set({ ...routineEdit!, time: (e.target as HTMLInputElement).value }) });
    const days = h('div', { class: 'rt-days', role: 'group', 'aria-label': t('rt_days') }, ...[1, 2, 3, 4, 5, 6, 7].map(d =>
      h('label', { class: 'sp-check' }, h('input', { type: 'checkbox', checked: f.days.includes(d), 'data-k': `rt-day-${d}`, onchange: () => set(toggleDay(routineEdit!, d)) }), t(`rt_day_${d}` as Key))));
    const field = (text: string, input: HTMLElement, hint?: string) => h('div', { class: 'sp-field' }, h('label', { class: 'label' }, text), input, hint ? h('div', { class: 'sp-hint' }, hint) : null);
    return h('div', { class: 'rt-editor', 'data-k': 'rt-editor' },
      h('div', { class: 'group label' }, f.id ? t('rt_edit_title', { name: f.name || '…' }) : t('rt_add')),
      field(t('rt_name'), name), field(t('rt_instruction'), ins, t('rt_instruction_hint')),
      h('div', { class: 'sp-grid' }, field(t('rt_agent'), agentSel), field(t('rt_time'), time, t('rt_time_hint'))),
      field(t('rt_days'), days),
      h('label', { class: 'sp-check' }, h('input', { type: 'checkbox', checked: f.active, 'data-k': 'rt-active', onchange: (e: Event) => set({ ...routineEdit!, active: (e.target as HTMLInputElement).checked }) }), t('rt_active')),
      h('label', { class: 'sp-check' }, h('input', { type: 'checkbox', checked: f.radar === true, 'data-k': 'rt-radar', onchange: (e: Event) => { const { radar, ...rest } = routineEdit!; set((e.target as HTMLInputElement).checked ? { ...rest, radar: true } : rest); } }), t('rt_radar')),
      h('div', { class: 'sp-actions' },
        missing ? h('span', { class: 'sp-state' }, t(`rt_missing_${missing}` as Key)) : null,
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { routineEdit = null; routineMsg = null; render(); } }, t('cancel')),
        h('button', { class: 'btn pri', type: 'button', 'data-k': 'rt-save', disabled: busy || !!missing, onclick: () => rtSend(routinePayload(f, cur.id, '')) },
          busy && routineOp === 'routine.save' ? t('saving') : t('rt_save'))));
  }
  // Settings › Radar (admins): the space's Radar config (asked on every entry in the tab, then kept live by
  // `radarcfg.updated`), the form (re-made from the config when it moves and nothing is being typed), the result line.
  const radarCfgBy = new Map<string, RadarConfig>();
  let radarCfgFor = ''; let radarGetCid = ''; let radarCid = ''; let radarOp = '';
  let radarEdit: RadarForm | null = null; let radarDirty = false;
  let radarMsg: { text: string; err: boolean } | null = null;
  const radarErr = (code: string) => { const k = `rc_err_${code}`; return hasKey(k) ? t(k) : errText(code); };
  function onRadarCfg(c: RadarConfig, cid?: string, run?: string) {
    const old = radarCfgBy.get(c.space);
    if (old && old.version > c.version) return;
    radarCfgBy.set(c.space, c);
    if (cid && cid === radarGetCid) radarGetCid = '';
    // The form follows the config unless the admin is changing it; their own save, or a new proposal, re-makes it.
    const mine = !!cid && cid === P.saving;
    if (!radarDirty || mine || old?.proposed?.at !== c.proposed?.at) { radarEdit = null; radarDirty = false; }
    if (mine) {
      P.saving = '';
      radarMsg = run ? { text: t(`rc_res_${run}` as Key), err: run !== 'started' } : { text: t(radarOp === 'validate' ? 'rc_validated' : radarOp === 'reject' ? 'rc_rejected' : 'rc_saved'), err: false };
    }
  }
  /** A correction a Radar pass learnt from the dismissals: why (the team's recurring reason) and what it changes. Plain text. */
  function correctionBlock(c: RadarConfig) {
    const d = profileDiff(c);
    if (!d || !c.proposed?.why) return null;
    const line = (sign: '+' | '−', list: string, s: string) => h('li', { class: sign === '+' ? 'rc-add' : 'rc-del' }, `${sign} ${t('rc_fix_line', { list: t(`rc_${list}` as Key), item: s })}`);
    return h('div', { class: 'rc-fix', 'data-k': 'rc-fix' }, h('div', { class: 'rc-why' }, c.proposed.why),
      h('ul', {}, ...(d.product ? [h('li', {}, t('rc_fix_product'))] : []), ...d.lists.flatMap(x => [...x.added.map(s => line('+', x.list, s)), ...x.removed.map(s => line('−', x.list, s))])));
  }
  /** Settings › Radar (admins): the profile (proposed by the agent, validated or corrected here), detectors, agent, rhythm. */
  function radarSection(cur: SpaceSettings) {
    const c = radarCfgBy.get(cur.id);
    const head = [h('div', { class: 'group label' }, t('rc_title')), h('div', { class: 'sp-hint' }, t('rc_hint'))];
    if (!c) return h('section', { class: 'ov-block rc', 'data-k': 'radar-settings' }, ...head, radarMsg ? h('div', { class: 'err sp-err', role: 'status' }, radarMsg.text) : h('div', { class: 'sp-hint' }, t('rt_loading')));
    const f = radarEdit ??= radarForm(c, cur.defaultAgent, visibleAgents(cur));
    const busy = !!P.saving;
    const set = (g: Partial<RadarForm>) => { radarEdit = { ...radarEdit!, ...g }; radarDirty = true; radarMsg = null; render(); };
    const rcSend = (frame: Record<string, unknown>, op: string) => {
      const cid = newCid();
      if (send({ ...frame, client_id: cid, space: cur.id })) { P.saving = radarCid = cid; radarOp = op; radarMsg = null; render(); }
    };
    const field = (text: string, input: HTMLElement, hint?: string) => h('div', { class: 'sp-field' }, h('label', { class: 'label' }, text), input, hint ? h('div', { class: 'sp-hint' }, hint) : null);
    const area = (k: 'product' | 'competitors' | 'tech' | 'sources' | 'ignore', rows: number) => {
      const el = h('textarea', { rows: String(rows), 'data-k': `rc-${k}`, spellcheck: k === 'sources' ? 'false' : 'true', oninput: (e: Event) => set({ [k]: (e.target as HTMLTextAreaElement).value }) }) as HTMLTextAreaElement;
      el.value = f[k]; return el;
    };
    const running = radarRunning(c, Date.now());
    const status = c.proposed?.from ? t('rc_correction', { agent: cap(c.proposed.agent), when: since(c.proposed.at), n: String(c.proposed.from.length) })
      : c.proposed ? t('rc_proposed', { agent: cap(c.proposed.agent), when: since(c.proposed.at) })
      : c.profile ? t('rc_validated_by', { who: S.adm?.people.find(p => p.id === c.profile!.by)?.name ?? c.profile.by, when: since(c.profile.at) }) : t('rc_no_profile');
    const lastRun = c.run ? h('div', { class: `sp-me rt-last${c.run.result === 'started' ? '' : ' rt-skip'}`, 'data-k': 'rc-last' },
      t('rc_last', { kind: t(c.run.kind === 'profile' ? 'rc_kind_profile' : 'rc_kind_pass'), when: since(c.run.at), result: t(c.run.result === 'started' && c.run.ended ? 'rc_res_done' : `rc_res_${c.run.result}` as Key) })) : null;
    const hasProfile = !!(c.proposed ?? c.profile);
    const validateErr = radarFormError(f, c, true), saveErr = radarFormError(f, c, false);
    const profileBlock = h('div', { class: 'rc-profile', 'data-k': 'rc-profile' },
      h('div', { class: 'label' }, t('rc_profile')), h('div', { class: `sp-hint${c.proposed ? ' rc-proposed' : ''}`, 'data-k': 'rc-status' }, status),
      correctionBlock(c),
      hasProfile ? h('div', {},
        field(t('rc_product'), area('product', PROFILE_PRODUCT_LINES), t('rc_product_hint')),
        field(t('rc_competitors'), area('competitors', 4), t('rc_lines_hint')),
        field(t('rc_tech'), area('tech', 5), t('rc_lines_hint')),
        field(t('rc_sources'), area('sources', 3), t('rc_sources_hint')),
        field(t('rc_ignore'), area('ignore', 2), t('rc_ignore_hint'))) : null,
      h('div', { class: 'sp-actions' },
        hasProfile && validateErr ? h('span', { class: 'sp-state' }, t('rc_missing_profile')) : null,
        h('button', { class: `btn ${hasProfile ? 'ghost' : 'pri'}`, type: 'button', 'data-k': 'rc-deduce', disabled: busy || !!running,
          onclick: () => rcSend({ type: 'radarcfg.run', what: 'profile' }, 'run') }, running && c.run?.kind === 'profile' ? t('rc_deducing') : hasProfile ? t('rc_deduce_again') : t('rc_deduce')),
        c.proposed ? h('button', { class: 'btn ghost', type: 'button', 'data-k': 'rc-reject', disabled: busy,
          onclick: () => rcSend(rejectPayload(c, cur.id, ''), 'reject') }, busy && radarOp === 'reject' ? t('saving') : t('rc_reject')) : null,
        hasProfile ? h('button', { class: 'btn pri', type: 'button', 'data-k': 'rc-validate', disabled: busy || !!validateErr,
          onclick: () => rcSend(radarPayload(f, cur.id, '', true), 'validate') }, busy && radarOp === 'validate' ? t('saving') : c.proposed ? t('rc_validate') : t('rc_save_profile')) : null));
    const det = h('div', { class: 'rc-detectors', role: 'group', 'aria-label': t('rc_detectors') }, ...RADAR_TYPES.map(k =>
      h('label', { class: 'sp-check' }, h('input', { type: 'checkbox', checked: f.detectors[k], 'data-k': `rc-det-${k}`, onchange: (e: Event) => set({ detectors: { ...f.detectors, [k]: (e.target as HTMLInputElement).checked } }) }), t(`rc_det_${k}` as Key))));
    const agentSel = h('select', { 'data-k': 'rc-agent', 'aria-label': t('rt_agent'), onchange: (e: Event) => set({ agent: (e.target as HTMLSelectElement).value }) },
      ...visibleAgents(cur).map(a => h('option', { value: a, selected: a === f.agent }, cap(a))));
    const rhythmSel = h('select', { 'data-k': 'rc-rhythm', 'aria-label': t('rc_rhythm'), onchange: (e: Event) => set({ rhythm: (e.target as HTMLSelectElement).value as RadarRhythm }) },
      ...(['off', 'daily', 'weekly'] as RadarRhythm[]).map(r => h('option', { value: r, selected: r === f.rhythm }, t(`rc_rhythm_${r}` as Key))));
    const changed = settingsChanged(f, c, cur.defaultAgent);
    return h('section', { class: 'ov-block rc', 'data-k': 'radar-settings' }, ...head,
      radarMsg ? h('div', { class: radarMsg.err ? 'err sp-err' : 'sp-notice', role: 'status', 'data-k': 'rc-msg' }, radarMsg.text) : null,
      profileBlock,
      field(t('rc_detectors'), det),
      h('div', { class: 'sp-grid' }, field(t('rt_agent'), agentSel), field(t('rc_rhythm'), rhythmSel, t('rc_rhythm_hint'))),
      lastRun,
      h('div', { class: 'sp-actions' },
        saveErr ? h('span', { class: 'sp-state' }, t('rc_missing_no_profile')) : null,
        h('button', { class: 'btn ghost', type: 'button', 'data-k': 'rc-run', disabled: busy || !!running || !c.profile,
          onclick: () => rcSend({ type: 'radarcfg.run', what: 'pass' }, 'run') }, running && c.run?.kind === 'pass' ? t('rc_passing') : t('rc_run_pass')),
        h('button', { class: 'btn pri', type: 'button', 'data-k': 'rc-save', disabled: busy || !changed || !!saveErr,
          onclick: () => rcSend(radarPayload(f, cur.id, '', false), 'save') }, busy && radarOp === 'save' ? t('saving') : t('rc_save'))));
  }
  /** Settings › Driver › Pilot (saved driver = board): per agent, unstrikeable or briefling, and the switch by link. */
  function pilotBlock(cur: SpaceSettings) {
    const pilots = P.pilots.get(cur.id), now = Date.now();
    const pilotSend = (type: 'flowpilot.link' | 'flowpilot.back', agent: string) => {
      const cid = newCid();
      if (send({ type, client_id: cid, space: cur.id, agent })) {
        P.saving = pilotCid = cid; pilotAgent = agent; pilotMsg = null;
        if (type === 'flowpilot.link' || pilotShown?.agent === agent) pilotShown = null;
        render();
      }
    };
    const copy = () => { const s = pilotShown; if (!s) return;
      const done = () => { if (pilotShown === s) { s.copied = true; render(); } };
      navigator.clipboard?.writeText(s.prompt).then(done, () => { (document.getElementById('fp-prompt') as HTMLTextAreaElement | null)?.select(); }); };
    const busy = (a: string) => !!P.saving && P.saving === pilotCid && pilotAgent === a;
    const row = (a: string) => {
      const p = pilotOf(pilots, a), st = pilotStatus(p, now), act = pilotAction(st);
      const chip = h('span', { class: `sp-tag fp-${st}${st === 'piloted' ? ' ok' : st === 'expired' ? ' expired' : st === 'none' ? ' unknown' : ''}` }, t(`fp_st_${st}` as Key));
      const detail = st === 'piloted' ? [t('fp_since', { when: since(p!.since ?? p!.at) }),
          p!.imported ? tn('fp_imported', p!.imported.seen, { usd: usdLabel(p!.imported.spent, lang()) }) : ''].filter(Boolean).join(' · ')
        : st === 'pending' ? t('fp_expires', { when: whenShort(p!.expiresAt ?? p!.at + FLOW_SWITCH_TTL_MS) }) : '';
      let btn: HTMLElement;
      if (act === 'link') btn = h('button', { class: 'btn', type: 'button', 'data-k': `fp-switch-${a}`, disabled: !!P.saving, onclick: () => pilotSend('flowpilot.link', a) },
        busy(a) ? t('fp_linking') : t('fp_switch'));
      else if (act === 'cancel') btn = h('button', { class: 'btn ghost', type: 'button', 'data-k': `fp-cancel-${a}`, disabled: !!P.saving, onclick: () => pilotSend('flowpilot.back', a) }, t('fp_cancel'));
      else {
        const asked = backAsk === a;
        const click = () => {
          if (!asked) { backAsk = a; window.clearTimeout(backTimer); backTimer = window.setTimeout(() => { if (backAsk === a) { backAsk = ''; render(); } }, 10_000); render(); return; }
          pilotSend('flowpilot.back', a);
        };
        btn = h('button', { class: asked ? 'btn danger sp-rm' : 'btn ghost sp-rm', type: 'button', 'data-k': `fp-back-${a}`, disabled: !!P.saving, onclick: click },
          busy(a) ? t('fp_backing') : t(asked ? 'fp_back_confirm' : 'fp_back'));
      }
      return h('div', { class: 'sp-row fp-row', 'data-pilot': a }, h('span', { class: 'sp-name' }, cap(a), chip), detail ? h('span', { class: 'sp-me fp-when' }, detail) : null, btn);
    };
    let box: HTMLElement | null = null;
    if (pilotShown) {
      const ta = h('textarea', { id: 'fp-prompt', rows: 6, readonly: true, spellcheck: 'false', onfocus: (e: Event) => (e.target as HTMLTextAreaElement).select() }) as HTMLTextAreaElement;
      ta.value = pilotShown.prompt;
      box = h('div', { class: 'sp-link fp-box' },
        h('label', { class: 'label', for: 'fp-prompt' }, t('fp_prompt_label', { agent: cap(pilotShown.agent) })), ta,
        h('button', { class: 'btn pri', type: 'button', onclick: copy }, withIcon(pilotShown.copied ? 'check' : 'copy', t(pilotShown.copied ? 'agent_link_copied' : 'agent_link_copy'), 14)),
        h('div', { class: 'sp-hint' }, t('fp_prompt_hint', { agent: cap(pilotShown.agent) })));
    }
    return h('div', { class: 'sp-field fp' }, h('label', { class: 'label' }, t('fp_title')), h('div', { class: 'sp-hint' }, t('fp_hint')),
      ...(pilots ? pilotAgents(visibleAgents(cur), pilots).map(row) : [h('div', { class: 'sp-hint' }, t('ex_loading'))]),
      pilotMsg ? h('div', { class: pilotMsg.err ? 'err sp-err' : 'sp-notice', role: 'status' }, pilotMsg.text) : null,
      box);
  }
  /** Settings, agent row: plugin release its instance reported at connect vs the published one (an ACP bridge: vs the
   *  bridge's own release, protocol/bridge-release.ts). */
  const pluginTag = (plugin: AgentPlugin | undefined) => {
    const version = plugin?.version, latest = latestFor(plugin?.kind).version;
    const st = pluginStatus(version, latest);
    if (st === 'unknown') return h('span', { class: 'sp-tag unknown tip tip-below', 'data-tip': t('plugin_unknown_tip') }, t('plugin_unknown'));
    return st === 'current' ? h('span', { class: 'sp-tag ok' }, t('plugin_current', { v: version! }))
      : h('span', { class: 'sp-tag tip tip-below', 'data-tip': t('plugin_outdated_tip', { v: latest }) }, t('plugin_outdated', { v: version! }));
  };
  /** Settings, agent row: Hermes' prompt cache left on its 5-minute default (docs/setup.md step 8); nothing otherwise,
   *  nor when the field is missing (ACP bridge, plugin older than 0.3.78). */
  const cacheTag = (ttl: string | undefined) => ttl !== '5m' ? null
    : h('span', { class: 'sp-tag tip tip-below', 'data-k': 'sp-cache-ttl', 'data-tip': t('cache_ttl_tip') }, t('cache_ttl_5m'));
  const dirty = () => { const f = P.form; if (!f) return false; if (f.version === null) return true; const s = S.adm?.spaces.find(x => x.id === f.id); return !!s && changed(f, s); };
  function onSpaceSaved(f: Extract<HubFrame, { type: 'space.saved' }>) {
    if (S.adm) S.adm.spaces = [...S.adm.spaces.filter(s => s.id !== f.space.id), f.space].sort((a, b) => a.name.localeCompare(b.name));
    if (f.space.parallel) S.parallel.set(f.space.id, f.space.parallel);
    if (f.client_id !== P.saving) return;
    const created = P.form?.version === null && S.view.kind === 'newspace' && !f.space.archived && f.space.id === P.form.id;
    P.saving = ''; S.err = '';
    if (P.aboutCard?.space === f.space.id) P.aboutCard = null;
    P.notice = f.space.archived ? t('notice_archived', { name: quote(f.space.name) }) : created ? t('notice_created') : S.view.kind === 'newspace' ? t('notice_unarchived', { name: quote(f.space.name) }) : t('notice_saved');
    if (P.form && P.form.id === f.space.id) P.form = formOf(f.space);
    if (created) { S.view = { kind: 'settings', id: f.space.id }; admFor = routeOf(S.view, null); P.form = formOf(f.space); }
    if (f.space.archived && S.view.kind === 'settings' && S.view.id === f.space.id) { S.view = { kind: 'newspace' }; admFor = routeOf(S.view, null); P.form = null; }
    send({ type: 'subscribe' }); // sidebar list and names, subscription to the new space
  }
  /** Invitation answered: the person is in the list as a plain member; the form (never dirty here) follows the new version. */
  function onInvited(f: Extract<HubFrame, { type: 'space.invited' }>) {
    if (S.adm) {
      S.adm.spaces = S.adm.spaces.map(s => s.id === f.space.id ? f.space : s);
      if (!S.adm.people.some(p => p.id === f.person.id)) S.adm.people = [...S.adm.people, f.person].sort((a, b) => a.name.localeCompare(b.name));
    }
    if (f.client_id !== P.saving) return;
    P.saving = ''; S.err = '';
    if (P.form && P.form.id === f.space.id) P.form = formOf(f.space);
    const email = inviteText.trim().toLowerCase(); inviteText = '';
    inviteMsg = { err: false, text: f.result === 'invited' ? t(d.oidc ? 'oidc_notice_invited' : 'notice_invited', { email }) : f.result === 'added' ? t('notice_added', { name: f.person.name }) : t('notice_already', { name: f.person.name }) };
  }
  /** agent.invited / agent.invites / agent.removed: fresh invitations of the space, the space itself (version bumped). */
  function onAgentFrame(f: Extract<HubFrame, { type: 'agent.invited' | 'agent.invites' | 'agent.removed' }>) {
    const space = typeof f.space === 'string' ? f.space : f.space.id;
    if (S.adm) {
      S.adm.invites = mergeInvites(S.adm.invites, space, f.invites);
      if (f.type !== 'agent.invites') S.adm.spaces = S.adm.spaces.map(s => s.id === space ? f.space as SpaceSettings : s);
      if (f.type === 'agent.removed' && f.access === 'deleted') S.adm.agents = S.adm.agents.filter(a => a !== f.agent);
      if (f.type === 'agent.invited' && f.result !== 'link' && !S.adm.agents.includes(f.agent)) S.adm.agents = [...S.adm.agents, f.agent].sort();
    }
    if (f.client_id !== P.saving) return;
    P.saving = ''; S.err = '';
    if (f.type !== 'agent.invites' && P.form && P.form.id === space) P.form = formOf(f.space as SpaceSettings);
    if (f.type === 'agent.invited') {
      agentText = '';
      if (f.result === 'link' && f.code) { agentShown = { agent: f.agent, url: agentLink(location.origin, f.code), copied: false }; agentMsg = null; }
      else agentMsg = { err: false, text: t(f.result === 'already' ? 'notice_agent_already' : 'notice_agent_added', { agent: cap(f.agent) }) };
    } else if (f.type === 'agent.removed') {
      removeAsk = '';
      agentMsg = { err: false, text: t(f.access === 'deleted' ? 'notice_agent_removed_deleted' : 'notice_agent_removed_kept', { agent: cap(f.agent) }) };
    }
  }

  /** "Parallel work" of the space settings: mode, max threads per agent (cooperative), shared resources (both modes). */
  /** Agents waking each other by a mention (protocol/relay.ts): wakes allowed per agent between two human messages. */
  function relayField(f: SpaceForm, set: (g: SpaceForm) => void) {
    const el = h('input', { type: 'number', class: 'mem-num', min: RELAY_MAX_BOUNDS[0], max: RELAY_MAX_BOUNDS[1], step: 1, 'data-k': 'sp-relay-max', 'aria-label': t('relay_max'),
      oninput: (e: Event) => { const v = (e.target as HTMLInputElement).value; set({ ...P.form!, relayMax: v === '' ? NaN : Number(v) }); } }) as HTMLInputElement;
    el.value = Number.isFinite(f.relayMax) ? String(f.relayMax) : '';
    return h('div', { class: 'sp-field' }, h('label', { class: 'label' }, t('relay_max')),
      h('div', { class: 'mem-batch' }, h('span', {}, t('relay_max_a')), el, h('span', {}, t('relay_max_b'))),
      h('div', { class: 'sp-hint' }, t('relay_max_hint')));
  }
  function parallelSection(f: SpaceForm, set: (g: SpaceForm) => void) {
    const mode = (m: SpaceForm['mode'], name: string, desc: string) => h('label', { class: `sp-row sp-mode ${f.mode === m ? '' : 'off'}` },
      h('input', { type: 'radio', name: 'sp-mode', value: m, checked: f.mode === m, onchange: () => set(setMode(P.form!, m)) }),
      h('span', { class: 'sp-name' }, h('b', {}, name), h('span', { class: 'sp-desc' }, desc)));
    const max = h('input', { type: 'number', min: 2, max: MAX_PARALLEL, step: 1, value: Number.isFinite(f.max) ? f.max : '', 'data-draft': 'sp-max',
      class: 'sp-num', 'aria-label': t('par_max'), oninput: (e: Event) => { const v = (e.target as HTMLInputElement).value; set(setMax(P.form!, v === '' ? NaN : Number(v))); } });
    // One row per resource: fixed type (menu), optional name, usage rule given verbatim to every agent of the space.
    const val = (e: Event) => (e.target as HTMLInputElement | HTMLSelectElement).value;
    const res = h('div', { class: 'sp-res-list' }, ...f.resources.map((r, i) => h('div', { class: 'sp-res', 'data-k': `sp-res-${i}` },
      h('select', { class: 'sp-res-type', 'aria-label': t('res_type'), onchange: (e: Event) => set(setResource(P.form!, i, { type: val(e) })) },
        ...[...new Set<string>([...RESOURCE_TYPES, r.type])].map(x => h('option', { value: x, selected: r.type === x }, x))),
      h('input', { class: 'sp-res-name', value: r.name, 'data-draft': `sp-res-name-${i}`, placeholder: t('res_name_ph'), 'aria-label': t('res_name'),
        maxlength: 48, spellcheck: 'false', autocomplete: 'off', oninput: (e: Event) => set(setResource(P.form!, i, { name: val(e) })) }),
      h('input', { class: 'sp-res-rule', value: r.rule, 'data-draft': `sp-res-rule-${i}`, placeholder: t('res_rule_ph'), 'aria-label': t('res_rule'),
        maxlength: RESOURCE_RULE_MAX, autocomplete: 'off', oninput: (e: Event) => set(setResource(P.form!, i, { rule: val(e) })) }),
      h('button', { class: 'btn ghost sp-rm', type: 'button', 'data-k': `sp-res-rm-${i}`, 'aria-label': t('res_remove', { name: resourceOf(r) }),
        onclick: () => set(removeResource(P.form!, i)) }, t('remove')))),
      h('button', { class: 'btn ghost sp-res-add', type: 'button', 'data-k': 'sp-res-add', disabled: f.resources.length >= MAX_RESOURCES,
        onclick: () => set(addResource(P.form!)) }, t('res_add')));
    return h('section', { class: 'ov-block' }, h('div', { class: 'group label' }, t('parallel')),
      mode('strict', t('par_strict'), t('par_strict_desc')),
      mode('cooperative', t('par_coop'), t('par_coop_desc')),
      f.mode === 'cooperative' ? h('div', { class: 'sp-field' }, h('label', { class: 'label' }, t('par_max')), max, h('div', { class: 'sp-hint' }, t('par_max_hint', { max: MAX_PARALLEL }))) : null,
      h('div', { class: 'sp-field' }, h('label', { class: 'label' }, t('par_resources')), res, h('div', { class: 'sp-hint' }, t('par_resources_hint', { max: MAX_RESOURCES, types: RESOURCE_TYPES.join(', ') }))));
  }
  /** "GitHub" of the space settings: the attached repos (a plain list, no Project needed) and the CI follow-up switch. */
  /**
   * « Modules » of the space settings (protocol/modules.ts): a preset turns a set on, each module stays adjustable.
   * Off = its section hidden for every member and its instructions no longer given to the agents; its data is kept.
   */
  function modulesSection(f: SpaceForm, set: (g: SpaceForm) => void) {
    const preset = presetOf(f.modules);
    return h('section', { class: 'ov-block sp-modules', 'data-k': 'sp-modules' }, h('div', { class: 'group label' }, t('modules')),
      h('div', { class: 'sp-field' }, h('label', { class: 'label' }, t('preset')),
        h('select', { 'data-k': 'sp-preset', 'aria-label': t('preset'), onchange: (e: Event) => { const p = (e.target as HTMLSelectElement).value; if (p !== 'custom') set(setPreset(P.form!, p as Preset)); } },
          ...PRESET_NAMES.map(p => h('option', { value: p, selected: preset === p }, t(`preset_${p}` as Key))),
          preset === 'custom' ? h('option', { value: 'custom', selected: true }, t('preset_custom')) : null)),
      ...MODULES.map(m => h('label', { class: `sp-row sp-mode ${f.modules.includes(m) ? '' : 'off'}` },
        h('input', { type: 'checkbox', 'data-k': `sp-mod-${m}`, checked: f.modules.includes(m), onchange: (e: Event) => set(setModule(P.form!, m, (e.target as HTMLInputElement).checked)) }),
        h('span', { class: 'sp-name' }, h('b', {}, t(`mod_${m}` as Key)), h('span', { class: 'sp-desc' }, t(`mod_${m}_desc` as Key))))),
      h('div', { class: 'sp-hint' }, t('modules_hint')));
  }
  function githubSection(f: SpaceForm, set: (g: SpaceForm) => void, cur: SpaceSettings | null) {
    const repos = h('textarea', { 'data-draft': 'sp-repos', rows: 4, spellcheck: 'false', 'aria-label': t('repos'), placeholder: 'acme/api\nacme/web-app',
      // a space admin attaches repos of the orgs a global admin validated only (the GitHub App's access): none = read-only
      readonly: !S.admin && !cur?.repoOrgs?.length,
      oninput: (e: Event) => set({ ...P.form!, repos: (e.target as HTMLTextAreaElement).value }) }) as HTMLTextAreaElement;
    repos.value = f.repos;
    const orgs = h('textarea', { 'data-draft': 'sp-repo-orgs', rows: 2, spellcheck: 'false', 'aria-label': t('repo_orgs'), placeholder: 'acme', readonly: !S.admin,
      oninput: (e: Event) => set({ ...P.form!, repoOrgs: (e.target as HTMLTextAreaElement).value }) }) as HTMLTextAreaElement;
    orgs.value = f.repoOrgs;
    const orgList = cur?.repoOrgs ?? [];
    return h('section', { class: 'ov-block sp-gh' }, h('div', { class: 'group label' }, t('gh_section')),
      h('div', { class: 'sp-field' }, h('label', { class: 'label' }, t('repos')), repos,
        h('div', { class: 'sp-hint', 'data-k': 'sp-repos-hint' }, S.admin ? t('repos_hint') : orgList.length ? t('repos_orgs_only', { orgs: orgList.join(', ') }) : t('repos_global'))),
      // shown to a space admin only once there is something to show (the global admin always edits it)
      S.admin || orgList.length ? h('div', { class: 'sp-field' }, h('label', { class: 'label' }, t('repo_orgs')), orgs, h('div', { class: 'sp-hint' }, t('repo_orgs_hint'))) : null,
      h('label', { class: `sp-row sp-mode ${f.ci ? '' : 'off'}` },
        h('input', { type: 'checkbox', 'data-k': 'sp-ci', checked: f.ci, onchange: (e: Event) => set({ ...P.form!, ci: (e.target as HTMLInputElement).checked }) }),
        h('span', { class: 'sp-name' }, h('b', {}, t('ci_follow')), h('span', { class: 'sp-desc' }, t('ci_follow_desc')))));
  }
  /**
   * "Project memory" of the space settings: the gate of agents' proposals (protocol/memory.ts MemoryMode), the memory
   * agent, when it reviews (agent mode) and when it compacts, saved with the page; « Import from repo » (admin, at once).
   */
  function memorySection(f: SpaceForm, set: (g: SpaceForm) => void, space: string | null) {
    const mode = (x: MemoryMode, name: Key, desc: Key) => h('label', { class: `sp-row sp-mode ${f.memory === x ? '' : 'off'}` },
      h('input', { type: 'radio', name: 'sp-memory', value: x, 'data-k': `sp-mem-${x}`, checked: f.memory === x, onchange: () => set({ ...P.form!, memory: x }) }),
      h('span', { class: 'sp-name' }, h('b', {}, t(name)), h('span', { class: 'sp-desc' }, t(desc))));
    const agent = cap(f.memoryAgent && f.agents.includes(f.memoryAgent) ? f.memoryAgent : f.defaultAgent || '—');
    const num = (k: string, value: number, min: number, max: number, on: (v: number) => SpaceForm) => {
      const el = h('input', { type: 'number', class: 'mem-num', min, max, 'data-k': `sp-mem-${k}`, 'aria-label': t(`mem_num_${k.replace('-', '_')}` as Key),
        oninput: (e: Event) => set(on(Number((e.target as HTMLInputElement).value))) }) as HTMLInputElement;
      el.value = String(value);
      return el;
    };
    const b = f.memoryBatch, c = f.memoryCompact;
    // « Import from repo » (global admin, the page's audience): the memory files of an attached repo, published at once.
    const imp = space ? mem().importEl(space, S.repos.get(space) ?? []) : null;
    return h('section', { class: 'ov-block' }, h('div', { class: 'group label' }, t('mem_section')),
      // auto (Bedrock check) is dormant: only shown to a space still on it
      mode('agent', 'mem_set_agent', 'mem_set_agent_desc'), mode('agentAuto', 'mem_set_agentAuto', 'mem_set_agentAuto_desc'),
      // the hub cannot check that the memory agent has no tools: the admin accepts the risk before saving this mode
      f.memory === 'agentAuto' ? h('label', { class: `sp-row sp-mode mem-ack ${f.memoryAck ? '' : 'off'}` },
        h('input', { type: 'checkbox', 'data-k': 'sp-mem-ack', checked: f.memoryAck, onchange: (e: Event) => set({ ...P.form!, memoryAck: (e.target as HTMLInputElement).checked }) }),
        h('span', { class: 'sp-name' }, h('b', {}, t('mem_ack')), h('span', { class: 'sp-desc' }, t('mem_ack_desc', { agent })))) : null,
      f.memory === 'auto' ? mode('auto', 'mem_set_auto', 'mem_set_auto_desc') : null,
      mode('human', 'mem_set_human', 'mem_set_human_desc'), mode('trusted', 'mem_set_trusted', 'mem_set_trusted_desc'),
      f.agents.length ? h('div', { class: 'sp-field' }, h('label', { class: 'label' }, t('mem_agent')),
        h('select', { 'data-k': 'sp-mem-agent', 'aria-label': t('mem_agent'), onchange: (e: Event) => set({ ...P.form!, memoryAgent: (e.target as HTMLSelectElement).value }) },
          h('option', { value: '', selected: !f.memoryAgent }, t('mem_agent_default', { agent: f.defaultAgent ? cap(f.defaultAgent) : '—' })),
          ...f.agents.map(a => h('option', { value: a, selected: f.memoryAgent === a }, cap(a)))),
        h('div', { class: 'sp-hint' }, t('mem_agent_hint'))) : null,
      // Backstage memory agent (protocol/memory.ts backstageAgent): only an agent other than the one in charge.
      f.agents.length > 1 ? (() => {
        const can = hiddenOf({ ...f, memoryHidden: true });
        return h('label', { class: `sp-row sp-mode ${f.memoryHidden && can ? '' : 'off'}` },
          h('input', { type: 'checkbox', 'data-k': 'sp-mem-hidden', checked: f.memoryHidden && can, disabled: !can,
            onchange: (e: Event) => set({ ...P.form!, memoryHidden: (e.target as HTMLInputElement).checked }) }),
          h('span', { class: 'sp-name' }, h('b', {}, t('mem_hidden')), h('span', { class: 'sp-desc' }, t(can ? 'mem_hidden_desc' : 'mem_hidden_off'))));
      })() : null,
      agentReviews(f.memory) ? h('div', { class: 'sp-field' }, h('label', { class: 'label' }, t('mem_review_when')),
        h('div', { class: 'mem-batch' }, h('span', {}, t('mem_batch_a', { agent })),
          num('batch-n', b.n, MEMORY_BATCH_N[0], MEMORY_BATCH_N[1], v => ({ ...P.form!, memoryBatch: { ...P.form!.memoryBatch, n: v } })), h('span', {}, t('mem_batch_b')),
          num('batch-minutes', b.minutes, MEMORY_BATCH_MINUTES[0], MEMORY_BATCH_MINUTES[1], v => ({ ...P.form!, memoryBatch: { ...P.form!.memoryBatch, minutes: v } })), h('span', {}, t('mem_batch_c')))) : null,
      h('div', { class: 'sp-field' }, h('label', { class: 'label' }, t('mem_compact_when')),
        h('div', { class: 'mem-batch' }, h('span', {}, t('mem_compact_a', { agent })),
          num('compact-n', c.n, MEMORY_COMPACT_N[0], MEMORY_COMPACT_N[1], v => ({ ...P.form!, memoryCompact: { ...P.form!.memoryCompact, n: v } })), h('span', {}, t('mem_compact_b')),
          num('compact-words', c.words, MEMORY_COMPACT_WORDS[0], MEMORY_COMPACT_WORDS[1], v => ({ ...P.form!, memoryCompact: { ...P.form!.memoryCompact, words: v } })), h('span', {}, t('mem_compact_c'))),
        h('div', { class: 'sp-hint' }, t('mem_compact_set_hint'))),
      h('div', { class: 'sp-field' }, h('label', { class: 'label' }, t('mem_tag_max')),
        h('div', { class: 'mem-batch' }, h('span', {}, t('mem_tag_max_a')),
          num('tag-max', f.tagMax, TAG_MAX_BOUNDS[0], TAG_MAX_BOUNDS[1], v => ({ ...P.form!, tagMax: v })), h('span', {}, t('mem_tag_max_b'))),
        h('div', { class: 'sp-hint' }, t('mem_tag_max_hint'))),
      imp);
  }
  /** "Driver" of the space settings: briefling or an external board (needs an attached GitHub Project), and the board's agent identities. */
  function driverSection(f: SpaceForm, set: (g: SpaceForm) => void, cur: SpaceSettings) {
    const mode = (d: Driver, name: string, desc: string, disabled = false) => h('label', { class: `sp-row sp-mode ${f.driver === d ? '' : 'off'}` },
      h('input', { type: 'radio', name: 'sp-driver', value: d, checked: f.driver === d, disabled, onchange: () => set({ ...P.form!, driver: d }) }),
      h('span', { class: 'sp-name' }, h('b', {}, name), h('span', { class: 'sp-desc' }, desc)));
    const ids = h('textarea', { 'data-draft': 'sp-identities', rows: 6, spellcheck: 'false', 'aria-label': t('identities'), placeholder: 'dev-bot\nreview-bot',
      oninput: (e: Event) => set({ ...P.form!, identities: (e.target as HTMLTextAreaElement).value }) }) as HTMLTextAreaElement;
    ids.value = f.identities;
    return h('section', { class: 'ov-block' }, h('div', { class: 'group label' }, t('driver')),
      mode('briefling', t('driver_briefling'), t('driver_briefling_desc')),
      mode('board', t('driver_board'), f.board ? t('driver_board_desc') : t('driver_no_board'), !f.board && f.driver !== 'board'),
      f.driver === 'board' ? h('div', { class: 'sp-field' }, h('label', { class: 'label' }, t('identities')), ids, h('div', { class: 'sp-hint' }, t('identities_hint'))) : null,
      cur.driver === 'board' ? pilotBlock(cur) : null);
  }
  function settingsView() {
    const v = S.view as { kind: 'settings'; id: string; tab?: SpTab } | { kind: 'newspace' };
    const creating = v.kind === 'newspace';
    const cur = v.kind === 'settings' ? S.adm?.spaces.find(s => s.id === v.id) ?? null : null;
    const head = (title: string, sub: string) => h('header', {}, menuBtn(), h('div', {}, h('h2', {}, withIcon(creating ? 'plus' : 'settings', title, 18)), h('p', {}, sub)));
    const shell = (...kids: (Node | null)[]) => h('section', { class: 'overview settings' }, ...kids);
    if (!viewAdmin(v)) return shell(head(t('settings'), t('admin_only')));
    if (!S.adm) return shell(head(creating ? t('new_space') : t('settings_title', { space: spaceName(v.kind === 'settings' ? v.id : '') }), ''), h('div', { class: 'blank' }, t('ex_loading')));
    if (!creating && !cur) return shell(head(t('settings'), ''), h('div', { class: 'blank' }, t('space_not_found')));
    const key = creating ? 'new' : cur!.id;
    if (!P.form || P.formKey !== key) { P.form = creating ? newForm(S.me, S.adm.agents) : formOf(cur!); P.formKey = key; }
    // Draft applied from a Lounge card: into the brief field only; the admin reviews and saves (the usual space.save).
    if (!creating && S.aboutApply?.space === cur!.id) {
      const d = S.aboutApply; S.aboutApply = null;
      P.aboutCard = { space: d.space, thread: d.thread, msg: d.msg };
      P.form = { ...P.form, about: d.text };
      P.notice = d.base.trim() !== cur!.about.trim() ? t('about_applied_changed') : t('about_applied');
    }
    const f = P.form;
    const set = (g: SpaceForm) => { P.form = g; P.notice = ''; render(); };
    const people = [...S.adm.people, ...f.members.filter(m => !S.adm!.people.some(p => p.id === m)).map(id => ({ id, name: id.slice(0, 6) }))];
    const agents = [...new Set([...S.adm.agents, ...f.agents])].sort();
    const out = !S.admin && cur ? repoOutsideOrgs(f, cur) : null; // a space admin: repos of the validated orgs only
    const err = formError(f) ?? (out ? t('form_repo_outside', { name: out }) : null);
    const check = (on: boolean, text: string, onchange: (on: boolean) => void, extra: Record<string, any> = {}) =>
      h('label', { class: 'sp-check' }, h('input', { type: 'checkbox', checked: on, onchange: (e: Event) => onchange((e.target as HTMLInputElement).checked), ...extra }), text);
    const field = (text: string, hint: string | null, input: HTMLElement) => h('div', { class: 'sp-field' }, h('label', { class: 'label' }, text), input, hint ? h('div', { class: 'sp-hint' }, hint) : null);
    const name = h('input', { value: f.name, maxlength: 60, 'data-draft': 'sp-name', placeholder: 'Acme', 'aria-label': t('space_name_aria'), oninput: (e: Event) => set(setName(P.form!, (e.target as HTMLInputElement).value)) });
    const idIn = creating ? h('input', { value: f.id, maxlength: 32, 'data-draft': 'sp-id', 'aria-label': t('id'), oninput: (e: Event) => set({ ...P.form!, id: (e.target as HTMLInputElement).value.trim().toLowerCase(), idTouched: true }) }) : null;
    const about = h('textarea', { 'data-draft': 'sp-about', rows: 5, maxlength: 4000, 'aria-label': t('about'), placeholder: t('about_ph'), oninput: (e: Event) => set({ ...P.form!, about: (e.target as HTMLTextAreaElement).value }) }) as HTMLTextAreaElement;
    about.value = f.about;
    const save = () => {
      if (err) { S.err = err; render(); return; }
      const cid = newCid();
      const card = P.aboutCard?.space === P.form!.id ? { thread: P.aboutCard.thread, msg: P.aboutCard.msg } : null;
      if (send({ ...payload(P.form!, cid), ...(card ? { aboutCard: card } : {}) })) { P.saving = cid; S.err = ''; render(); }
    };
    const archive = (s: SpaceSettings, on: boolean) => {
      if (on && !confirm(t('archive_confirm', { name: quote(s.name) }))) return;
      const cid = newCid();
      if (send({ type: 'space.archive', client_id: cid, space: s.id, version: s.version, on })) { P.saving = cid; S.err = ''; render(); }
    };
    // Invitation: separate from Save (written at once by the hub, which bumps the version), so only on a clean form.
    // Immediate actions (invite, remove) need a clean form: with unsaved changes, a click points to the save bar instead.
    const toBar = () => { (document.querySelector('[data-k="sp-save"]') as HTMLElement | null)?.focus(); return true; };
    const invite = () => {
      if (dirty() && toBar()) return;
      const email = normEmail(inviteText);
      if (!email) { inviteMsg = { text: t('err_bad_email'), err: true }; render(); return; }
      const cid = newCid();
      if (send({ type: 'space.invite', client_id: cid, space: cur!.id, email })) { P.saving = inviteCid = cid; inviteMsg = null; render(); }
    };
    const inviteBox = !creating ? h('div', { class: 'sp-invite' },
      h('label', { class: 'label', for: 'sp-invite' }, t('invite_label')),
      h('div', { class: 'sp-invite-row' },
        h('input', { id: 'sp-invite', type: 'email', value: inviteText, maxlength: MAX_EMAIL, 'data-draft': 'sp-invite', autocomplete: 'off', spellcheck: 'false',
          placeholder: t('invite_ph'), oninput: (e: Event) => { inviteText = (e.target as HTMLInputElement).value; inviteMsg = null; render(); },
          onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' && !e.isComposing && !P.saving && inviteText.trim()) { e.preventDefault(); invite(); } } }),
        h('button', { class: 'btn', type: 'button', 'data-k': 'sp-invite-btn', disabled: !!P.saving || !inviteText.trim(), onclick: invite }, P.saving && P.saving === inviteCid ? t('inviting') : t('invite_btn'))),
      inviteMsg ? h('div', { class: inviteMsg.err ? 'err sp-err' : 'sp-notice', role: 'status' }, inviteMsg.text) : null,
      h('div', { class: 'sp-hint' }, dirty() ? t('invite_dirty') : t(d.oidc ? 'oidc_invite_hint' : 'invite_hint'))) : null;
    // Agents (admin): invite by link, revoke a pending invitation, remove an agent from the space. Invite and remove
    // change the space (version bumped by the hub), so only on a clean form, like the e-mail invitation.
    const agentSend = (frame: { type: 'agent.invite' | 'agent.remove'; agent: string; renew?: true } | { type: 'agent.revoke'; invite: string }) => {
      const cid = newCid();
      if (send({ ...frame, client_id: cid, space: cur!.id })) { P.saving = agentCid = cid; agentMsg = null; render(); } };
    const agentInvite = () => {
      if (dirty() && toBar()) return;
      const agent = normAgent(agentText);
      if (!agent) { agentMsg = { text: t('err_bad_agent'), err: true }; render(); return; }
      agentShown = null; agentSend({ type: 'agent.invite', agent });
    };
    function removeBtn(a: string) {
      if (!cur!.agents.includes(a)) return null;
      const asked = removeAsk === a;
      const click = () => {
        if (dirty() && toBar()) return;
        if (!asked) { removeAsk = a; window.clearTimeout(removeTimer); removeTimer = window.setTimeout(() => { if (removeAsk === a) { removeAsk = ''; render(); } }, 10_000); render(); return; }
        agentSend({ type: 'agent.remove', agent: a });
      };
      return h('button', { class: asked ? 'btn danger sp-rm' : 'btn ghost sp-rm', type: 'button', disabled: !!P.saving,
        'aria-label': t(asked ? 'agent_remove_confirm' : 'agent_remove_aria', { agent: cap(a) }), onclick: click },
        P.saving && P.saving === agentCid && asked ? t('removing') : t(asked ? 'agent_remove_confirm' : 'agent_remove'));
    }
    // New link for an agent already here (lost secret, new host): its join replaces the current access.
    function renewBtn(a: string) {
      if (!cur!.agents.includes(a)) return null;
      return h('button', { class: 'btn ghost sp-renew', type: 'button', disabled: !!P.saving, 'data-k': `sp-renew-${a}`,
        title: t('agent_renew_hint'), 'aria-label': t('agent_renew_aria', { agent: cap(a) }),
        onclick: () => { if (dirty() && toBar()) return; agentShown = null; agentSend({ type: 'agent.invite', agent: a, renew: true }); } }, t('agent_renew'));
    }
    function agentBox() {
      const invites = invitesOf(S.adm!.invites, cur!.id);
      const copy = () => { const s = agentShown; if (!s) return;
        const done = () => { if (agentShown === s) { s.copied = true; render(); } };
        navigator.clipboard?.writeText(s.url).then(done, () => { const el = document.getElementById('sp-agent-link') as HTMLInputElement | null; el?.select(); }); };
      const chip = (i: AgentInvite) => h('span', { class: `sp-tag ai-${i.state}${i.state === 'expired' ? ' expired' : ''}` }, t(`ai_${i.state}` as Key));
      const when = (i: AgentInvite) => { const d = inviteDate(i); return t(`ai_at_${d.kind}` as Key, { when: since(d.at) }); };
      return h('div', { class: 'sp-invite sp-agents' },
        h('label', { class: 'label', for: 'sp-agent' }, t('agent_invite_label')),
        h('div', { class: 'sp-invite-row' },
          h('input', { id: 'sp-agent', value: agentText, maxlength: 32, 'data-draft': 'sp-agent', autocomplete: 'off', spellcheck: 'false',
            placeholder: t('agent_invite_ph'), oninput: (e: Event) => { agentText = (e.target as HTMLInputElement).value; agentMsg = null; render(); },
            onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' && !e.isComposing && !P.saving && agentText.trim()) { e.preventDefault(); agentInvite(); } } }),
          h('button', { class: 'btn', type: 'button', disabled: !!P.saving || !agentText.trim(), onclick: agentInvite },
            P.saving && P.saving === agentCid && !removeAsk ? t('inviting') : t('invite_btn'))),
        agentMsg ? h('div', { class: agentMsg.err ? 'err sp-err' : 'sp-notice', role: 'status' }, agentMsg.text) : null,
        h('div', { class: 'sp-hint' }, dirty() ? t('invite_dirty') : t('agent_invite_hint')),
        agentShown ? h('div', { class: 'sp-link' },
          h('label', { class: 'label', for: 'sp-agent-link' }, t('agent_link_label', { agent: cap(agentShown.agent) })),
          h('div', { class: 'sp-invite-row' },
            h('input', { id: 'sp-agent-link', value: agentShown.url, readonly: true, spellcheck: 'false', onfocus: (e: Event) => (e.target as HTMLInputElement).select() }),
            h('button', { class: 'btn pri', type: 'button', onclick: copy }, withIcon(agentShown.copied ? 'check' : 'copy', t(agentShown.copied ? 'agent_link_copied' : 'agent_link_copy'), 14))),
          h('div', { class: 'sp-hint' }, t('agent_link_hint'))) : null,
        invites.length ? h('div', { class: 'ai-list' }, h('div', { class: 'label' }, t('agent_invites', { n: invites.length })),
          ...invites.map(i => h('div', { class: `sp-row ai-row${i.state === 'revoked' ? ' revoked' : ''}`, 'data-invite': i.id },
            h('span', { class: 'sp-name' }, cap(i.agent), chip(i)),
            h('span', { class: 'sp-me ai-when' }, when(i)),
            canRevoke(i) ? h('button', { class: 'btn ghost ai-revoke', type: 'button', disabled: !!P.saving,
              onclick: () => agentSend({ type: 'agent.revoke', invite: i.id }) }, t('ai_revoke')) : null))) : null);
    }
    const archived = creating ? S.adm.spaces.filter(s => s.archived) : [];
    // One page per question (Blair, Oct 2026); the new-space page stays one scroll (no tabs, nothing to archive yet).
    // Tabs of the modules the form turns on (live: a module turned off hides its tab before the save).
    const tabsShown = tabsOn(f.modules).filter(x => x !== 'advanced' || S.admin); // Advanced = archive: global admins only
    const tab: SpTab = v.kind === 'settings' && tabsShown.includes(v.tab ?? 'general') ? v.tab ?? 'general' : 'general';
    const shows = (x: SpTab) => creating || tab === x;
    const ch = creating ? [] : changes(f, cur!);
    const tabs = creating ? null : h('nav', { class: 'sp-tabs', role: 'tablist', 'aria-label': t('tabs_aria') },
      ...tabsShown.map(x => h('button', { class: `sp-tab ${x === tab ? 'on' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(x === tab), 'data-k': `sp-tab-${x}`,
        onclick: () => { S.view = { kind: 'settings', id: cur!.id, ...(x !== 'general' ? { tab: x } : {}) }; render(); } },
        t(`tab_${x}` as Key), ch.some(c => CHANGE_TAB[c] === x) ? h('span', { class: 'sp-tab-dot', title: t('tab_unsaved'), 'aria-label': t('tab_unsaved') }) : null)));
    const state = S.err ? h('span', { class: 'err sp-err' }, S.err) : P.notice ? h('span', { class: 'sp-notice' }, P.notice)
      : ch.length ? tn('sp_dirty', ch.length, { list: ch.map(c => t(`chg_${c}` as Key)).join(', ') }) : creating ? '' : t('sp_clean');
    // Routines save on their own: the space's bar only shows there when another tab has unsaved changes.
    const bar = (tab === 'routines' || tab === 'radar' || tab === 'contacts') && !ch.length ? null : h('div', { class: 'sp-actions sp-savebar', 'data-k': 'sp-savebar' },
      h('span', { class: 'sp-state', role: 'status', 'data-k': 'sp-state' }, state),
      !creating && dirty() ? h('button', { class: 'btn ghost', onclick: () => { P.form = formOf(cur!); S.err = ''; render(); } }, t('cancel')) : null,
      h('button', { class: 'btn pri', 'data-k': 'sp-save', disabled: !!P.saving || (!creating && !dirty()), onclick: save }, P.saving && !adminSide() ? t('saving') : creating ? t('create_space') : t('save')));
    return shell(
      head(creating ? t('new_space') : t('settings_title', { space: cur!.name }), creating ? t('new_space_sub') : t('settings_sub', { id: cur!.id })),
      tabs,
      h('div', { class: 'scroll', role: creating ? null : 'tabpanel' },
        ...(shows('general') ? [
          h('div', { class: 'sp-guard' }, h('b', {}, t('guard_b')), t('guard')),
          h('div', { class: 'sp-grid' },
            field(t('name'), null, name),
            creating ? field(t('id'), t('id_hint'), idIn!) : null),
          field(t('about'), t('about_hint'), about),
          !creating ? aboutAskEl(cur!) : null, modulesSection(f, set)] : []),
        shows('members') ? h('section', { class: 'ov-block' }, h('div', { class: 'group label' }, t('members_count', { n: f.members.length })),
          ...people.map(p => h('div', { class: `sp-row ${f.members.includes(p.id) ? '' : 'off'}` },
            // an invitee who never signed in: the admin fixes the name taken from the address, or mails a new password
            h('span', { class: 'sp-name' }, 'invite' in p && p.invite ? h('button', { class: 'sp-pname', 'data-k': `sp-pname-${p.id}`, title: t('member_edit'), onclick: () => d.openMember(p as DirectoryPerson) }, p.name) : p.name, p.id === S.me ? h('span', { class: 'sp-me' }, t('me_suffix')) : null,
              cur && f.members.includes(p.id) ? presDot(dotOf({ id: p.id, kind: 'human' }, S.presence.get(cur.id))) : null,
              'invite' in p && p.invite ? h('span', { class: `sp-tag ${p.invite}`, title: t(p.invite === 'expired' ? d.oidc ? 'oidc_invite_expired_title' : 'invite_expired_title' : 'invite_pending_title') }, t(p.invite === 'expired' ? 'invite_expired' : 'invite_pending')) : null),
            // Another admin of the space: only a global admin changes their role (the hub refuses it to a space admin).
            !S.admin && cur?.admins.includes(p.id) ? h('span', { class: 'sp-tag', 'data-k': `sp-admin-tag-${p.id}`, title: t('space_admin_hint') }, t('space_admin')) : null,
            h('select', { class: 'sp-rolesel', 'data-k': `sp-role-of-${p.id}`, 'aria-label': t('role_of_member', { name: p.name }), disabled: !S.admin && !!cur?.admins.includes(p.id),
              onchange: (e: Event) => set(setRole(P.form!, p.id, (e.target as HTMLSelectElement).value as Role)) },
              ...ROLES.map(r => h('option', { value: r, selected: roleOf(f, p.id) === r }, t(ROLE_KEY[r])))),
            h('label', { class: 'sp-nontech', title: t('nontech_hint') },
              h('input', { type: 'checkbox', 'data-k': `sp-nontech-of-${p.id}`, 'aria-label': t('nontech_of', { name: p.name }), checked: f.nontech.includes(p.id),
                disabled: !f.members.includes(p.id), onchange: (e: Event) => set(setNontech(P.form!, p.id, (e.target as HTMLInputElement).checked)) }),
              t('nontech')),
            S.admin && !creating ? h('label', { class: 'sp-nontech', title: t('space_admin_hint') },
              h('input', { type: 'checkbox', 'data-k': `sp-admin-of-${p.id}`, 'aria-label': t('space_admin_of', { name: p.name }), checked: f.admins.includes(p.id),
                disabled: !f.members.includes(p.id), onchange: (e: Event) => set(setSpaceAdmin(P.form!, p.id, (e.target as HTMLInputElement).checked)) }),
              t('space_admin')) : null)),
          h('div', { class: 'sp-hint' }, t('members_hint')), h('div', { class: 'sp-hint', 'data-k': 'sp-roles-hint' }, t('roles_hint')),
          h('div', { class: 'sp-hint', 'data-k': 'sp-nontech-hint' }, t('nontech_hint')), inviteBox) : null,
        shows('agents') ? h('section', { class: 'ov-block' }, h('div', { class: 'group label' }, t('agents')),
          ...(agents.length ? agents.map(a => h('div', { class: `sp-row ${f.agents.includes(a) ? '' : 'off'}` },
            h('span', { class: 'sp-name' }, avatarField(a in f.agentAvatars ? f.agentAvatars[a] : cur ? personAvatar(a, 'agent', cur.id) : '', a, 'agent', `sp-av-${a}`,
              file => { if (file) void pickAvatar(file, src => { P.form = setAgentAvatar(P.form!, a, src); S.err = ''; }, err => { S.err = err; }); },
              () => set(setAgentAvatar(P.form!, a, '')), !f.agents.includes(a)), cap(a), pluginTag(S.adm!.plugins[a]), cacheTag(S.adm!.plugins[a]?.cacheTtl)),
            h('input', { class: 'sp-role', value: f.agentRoles[a] ?? '', maxlength: MAX_ROLE, 'data-draft': `sp-role-${a}`, placeholder: t('role_ph_agent'),
              'aria-label': t('role_of', { name: cap(a) }), disabled: !f.agents.includes(a), autocomplete: 'off',
              oninput: (e: Event) => set(setAgentRole(P.form!, a, (e.target as HTMLInputElement).value)) }),
            check(f.agents.includes(a), t('in_space'), on => set(setAgent(P.form!, a, on))),
            h('label', { class: 'sp-check' }, h('input', { type: 'radio', name: 'sp-default', checked: f.defaultAgent === a, onchange: () => set(setDefault(P.form!, a)) }), t('in_charge')),
            !creating ? renewBtn(a) : null, !creating ? removeBtn(a) : null))
            : [h('div', { class: 'empty' }, t('no_agents'))]),
          h('div', { class: 'sp-hint' }, t('agents_hint')),
          f.agents.length > 1 ? relayField(f, set) : null,
          !creating ? agentBox() : null, !creating && d.machine ? d.machine(cur!.id) : null) : null,
        shows('agents') && f.driver !== 'board' ? parallelSection(f, set) : null,
        !creating && tab === 'work' && f.modules.includes('board') ? driverSection(f, set, cur!) : null,
        !creating && tab === 'work' && f.driver === 'board' ? wf().summaryEl(cur!.id) : null,
        shows('work') && f.modules.includes('ci') ? githubSection(f, set, cur) : null,
        shows('memory') ? memorySection(f, set, creating ? null : cur!.id) : null,
        !creating && tab === 'routines' ? routinesSection(cur!) : null,
        !creating && tab === 'radar' ? radarSection(cur!) : null,
        !creating && tab === 'contacts' ? contactsSection(cur!) : null,
        !creating && tab === 'advanced' && S.admin ? h('section', { class: 'ov-block sp-danger' }, h('div', { class: 'group label' }, t('archive')),
          h('div', { class: 'sp-row' }, h('span', { class: 'sp-name' }, t('archive_space_desc')),
            h('button', { class: 'btn', disabled: !!P.saving, onclick: () => archive(cur!, true) }, t('archive_space')))) : null,
        archived.length ? h('section', { class: 'ov-block' }, h('div', { class: 'group label' }, t('archived_spaces', { n: archived.length })),
          ...archived.map(s => h('div', { class: 'sp-row' }, h('span', { class: 'sp-name' }, s.name, h('span', { class: 'sp-me' }, t('archived_space_meta', { id: s.id, when: since(s.archived!.at) }))),
            h('button', { class: 'btn', disabled: !!P.saving, onclick: () => archive(s, false) }, t('unarchive'))))) : null),
      bar);
  }

  function frame(f: HubFrame): boolean {
    // Clean form follows the fresh data (dirty judged against the OLD settings: against the new ones it always differs).
    if (f.type === 'admin.spaces') { const keep = dirty(); S.adm = { spaces: f.spaces, people: f.people, agents: f.agents, invites: f.invites ?? [], plugins: f.plugins ?? {} }; if (P.form && P.formKey !== 'new' && !keep) P.form = null; }
    else if (f.type === 'space.saved') { onSpaceSaved(f); }
    else if (f.type === 'space.invited') { onInvited(f); }
    else if (f.type === 'agent.invited' || f.type === 'agent.invites' || f.type === 'agent.removed') { onAgentFrame(f); }
    else if (f.type === 'flowpilot.list' || f.type === 'flowpilot.linked') { onPilotFrame(f); }
    else if (f.type === 'routine.list') { onRoutines(f); }
    else if (f.type === 'radarcfg') { onRadarCfg(f.config, f.client_id, f.run); }
    else if (f.type === 'error' && f.ref && f.ref === radarGetCid) { radarGetCid = ''; radarMsg = { text: radarErr(f.code), err: true }; }
    else if (f.type === 'error' && f.ref && f.ref === radarCid && P.saving === radarCid) { P.saving = ''; radarMsg = { text: radarErr(f.code), err: true }; }
    else if (f.type === 'error' && f.ref && f.ref === routineGetCid) { routineGetCid = ''; routineMsg = { text: routineErr(f.code), err: true }; }
    else if (f.type === 'error' && f.ref && f.ref === pilotGetCid) { pilotGetCid = ''; pilotMsg = { text: pilotErr(f.code, ''), err: true }; }
    else if (f.type === 'error' && f.ref && f.ref === P.saving) { P.saving = ''; if (f.ref === inviteCid) inviteMsg = { text: errText(f.code), err: true }; else if (f.ref === agentCid) { agentMsg = { text: errText(f.code), err: true }; removeAsk = ''; } else if (f.ref === pilotCid) { pilotMsg = { text: pilotErr(f.code, pilotAgent), err: true }; backAsk = ''; } else if (f.ref === routineCid) { routineMsg = { text: routineErr(f.code), err: true }; routineDelAsk = ''; } else S.err = errText(f.code); }
    else return false;
    return true;
  }

  function route(v: View, online: boolean) {
    // Admin pages: data read again on every entry (another tab may have changed a space); form forgotten when leaving.
    if (v.kind === 'settings' || v.kind === 'newspace') {
      const k = routeOf(v.kind === 'settings' ? { kind: 'settings', id: v.id } : v, null); // tabs share one form
      if (viewAdmin(v) && admFor !== k && online) { admFor = k; S.adm = null; P.form = null; P.notice = ''; inviteText = ''; inviteMsg = null; agentReset(); post({ type: 'admin.spaces' }); }
    } else { admFor = ''; P.form = null; P.aboutCard = null; P.notice = ''; inviteText = ''; inviteMsg = null; agentReset(); }
    // Pilot block: asked on every entry in the Settings of a space whose saved driver is the board (fresh after a save).
    if (v.kind === 'settings' && spaceAdmin(v.id) && S.adm?.spaces.find(s => s.id === v.id)?.driver === 'board') {
      if (pilotFor !== v.id && online) { pilotFor = v.id; pilotGetCid = newCid(); post({ type: 'flowpilot.get', client_id: pilotGetCid, space: v.id }); }
    } else pilotFor = '';
    if (v.kind === 'settings' && v.tab === 'routines' && spaceAdmin(v.id)) {
      if (routineFor !== v.id && online) { routineFor = v.id; routineGetCid = newCid(); post({ type: 'routine.list', client_id: routineGetCid, space: v.id }); }
    } else { routineFor = ''; routineEdit = null; routineMsg = null; routineDelAsk = ''; }
    if (v.kind === 'settings' && v.tab === 'radar' && spaceAdmin(v.id)) {
      if (radarCfgFor !== v.id && online) { radarCfgFor = v.id; radarGetCid = newCid(); radarEdit = null; radarDirty = false; radarMsg = null; post({ type: 'radarcfg.get', client_id: radarGetCid, space: v.id }); }
    } else { radarCfgFor = ''; radarEdit = null; radarDirty = false; radarMsg = null; }
    if (v.kind === 'settings' && v.tab === 'contacts' && spaceAdmin(v.id)) {
      if (corrFor !== v.id && online) { corrFor = v.id; corrList = null; corrEdit = null; corrMsg = null; void corrSend(v.id, { type: 'correspondent.list' }); }
    } else { corrFor = ''; corrEdit = null; corrMsg = null; corrDelAsk = ''; }
  }

  return {
    el: settingsView, frame, route, dirty,
    event(f) {
      if (f.type !== 'event') return false;
      if (f.event === 'radarcfg.updated') { onRadarCfg(f.data); }
      else if (f.event === 'flowpilot.updated') onPilots(f.data.space, f.data.pilots);
      else return false;
      return true;
    },
    correspondents(space, list) { if (corrFor === space) corrList = list; },
    memberSaved(f) {
      if (S.adm) S.adm.people = S.adm.people.map(p => p.id === f.person.id ? f.person : p).sort((a, b) => a.name.localeCompare(b.name));
      if (f.result === 'reinvited') P.notice = t(d.oidc ? 'oidc_member_reinvited' : 'member_reinvited', { name: f.person.name });
    },
    radarCfgBy,
  };
}
