// Settings › Agents of a standalone server (hub/src/server.ts `/local/agents`): the ACP agents found on this machine,
// each with its own button: Launch (never launched), Relaunch (stopped), Stop (running). Launch = the server invites the
// agent into the space and starts its bridge; Stop = POST /local/agents/stop, and the agent stays stopped across server
// restarts until launched again. The first start of the server already launched every agent it could into Home. Plain
// HTTP with the admin token, not hub frames: only the standalone server has this, the hub protocol stays the same.
import type { Key } from './i18n.ts';
import type { UiKit } from './modules.ts';

export interface MachineAgent { id: string; label: string; bin: string; command: string[]; missing?: string }
export interface MachineState {
  agents: MachineAgent[]; models: { kind: string; url: string; models: string[] }[]; uv: boolean; cwd: string; bridge: string;
  launched: Record<string, { joined: boolean; served: boolean; state?: 'running' | 'exited'; code?: number | null; last?: string; manual?: true }>;
}

/** One line per launch result (the server's codes). */
export function resultLine(t: UiKit['t'], label: string, code: string): string {
  const known: Record<string, Key> = { joining: 'la_res_joining', already: 'la_res_already', added: 'la_res_added', started: 'la_res_started',
    served_elsewhere: 'la_res_served_elsewhere', running: 'la_res_running', stopped: 'la_res_stopped' };
  return code in known ? t(known[code], { agent: label }) : t('la_res_failed', { agent: label, code });
}

/** The row's button: Stop while it runs, Relaunch once it ran (stopped, by hand or by itself, or joined before), else
 *  Launch; none when it cannot run here (a tool missing, no uv). */
export type RowAction = 'launch' | 'relaunch' | 'stop' | null;
export function rowAction(a: MachineAgent, s: MachineState): RowAction {
  const l = s.launched[a.id];
  if (l?.state === 'running') return 'stop';
  if (a.missing || !s.uv) return null;
  return l?.state === 'exited' || l?.joined ? 'relaunch' : 'launch';
}

export function machineModule(kit: UiKit, token: () => string | null) {
  const { h, t, render, post } = kit;
  let state: MachineState | null = null, loading = false, busy: string | null = null, msg: { err: boolean; lines: string[] } | null = null;
  const call = async (method: 'GET' | 'POST', body?: object, path = '/local/agents'): Promise<any> => {
    const r = await fetch(path, { method, cache: 'no-store',
      headers: { Authorization: `Bearer ${token() ?? ''}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  };
  async function load() {
    loading = true; render();
    try { state = await call('GET') } catch { msg = { err: true, lines: [t('la_err')] } }
    loading = false; render();
  }
  /** One row's button: launch (or relaunch) into `space`, or stop. */
  async function act(space: string, id: string, what: 'start' | 'stop') {
    if (!state || busy) return;
    busy = id; msg = null; render();
    try {
      const r = what === 'stop' ? await call('POST', { agent: id }, '/local/agents/stop') : await call('POST', { space, agents: [id] });
      const label = (x: string) => state!.agents.find(a => a.id === x)?.label ?? x;
      msg = { err: false, lines: Object.entries(r.results as Record<string, string>).map(([x, code]) => resultLine(t, label(x), code)) };
      const { results: _, ...s } = r; state = s as MachineState;
    } catch { msg = { err: true, lines: [t('la_err')] } }
    busy = null; render();
    if (what === 'stop') return;
    // The bridge joins and connects in a few seconds (or stops: its last log line); the join changed the space (agents,
    // agent in charge): the Settings' admin data is asked again so the agents list above follows.
    const again = () => { void load(); post({ type: 'admin.spaces' }) };
    post({ type: 'admin.spaces' }); window.setTimeout(again, 4000); window.setTimeout(again, 12000);
  }
  const BTN: Record<NonNullable<RowAction>, [Key, Key]> = { launch: ['la_launch', 'la_launching'], relaunch: ['la_relaunch', 'la_launching'], stop: ['la_stop', 'la_stopping'] };
  return {
    /** The block under « Invite an agent », for `space`. */
    el(space: string): HTMLElement {
      if (!state && !loading) void load();
      const s = state;
      const row = (a: MachineAgent) => {
        const l = s!.launched[a.id], act0 = rowAction(a, s!);
        const chip = l?.state === 'running' ? t('la_running') : l?.state === 'exited' ? `${t('la_exited')}${l.code != null ? ` (${l.code})` : ''}` : l?.joined ? t('la_joined') : null;
        return h('div', { class: 'sp-row la-row', 'data-agent': a.id },
          h('span', { class: 'sp-name la-name' }, a.label),
          h('code', { class: 'la-cmd' }, a.command.join(' ')),
          a.missing ? h('span', { class: 'sp-tag expired' }, t('la_needs', { what: a.missing })) : chip ? h('span', { class: `sp-tag la-${l!.state ?? 'joined'}` }, chip) : null,
          act0 ? h('button', { class: `btn ${act0 === 'stop' ? 'ghost' : 'pri'} la-act`, type: 'button', 'data-k': `la-${act0}-${a.id}`, disabled: !!busy || loading,
            onclick: () => void act(space, a.id, act0 === 'stop' ? 'stop' : 'start') }, t(BTN[act0][busy === a.id ? 1 : 0])) : null,
          l?.state === 'exited' && l.last ? h('div', { class: 'sp-hint la-last' }, t('la_last', { line: l.last })) : null);
      };
      return h('div', { class: 'sp-invite la-box', 'data-k': 'la-box' },
        h('div', { class: 'label' }, t('la_title')),
        h('div', { class: 'sp-guard la-warn', role: 'note' }, t('la_warn')),
        !s ? h('div', { class: 'sp-hint' }, loading ? t('la_loading') : '') : h('div', {},
          s.agents.length ? h('div', { class: 'la-list' }, ...s.agents.map(row)) : h('div', { class: 'empty' }, t('la_none')),
          !s.uv && s.agents.length ? h('div', { class: 'err sp-err la-nouv' }, t('la_nouv')) : null,
          h('div', { class: 'sp-hint' }, t('la_cwd', { cwd: s.cwd })),
          s.models.length ? h('div', { class: 'sp-hint la-models' }, t('la_models', { list: s.models.map(m => `${m.kind} (${m.models.slice(0, 3).join(', ') || m.url})`).join(' · ') })) : null,
          h('div', { class: 'sp-actions' },
            h('button', { class: 'btn ghost', type: 'button', disabled: loading || !!busy, onclick: () => void load() }, t('la_refresh')))),
        msg ? h('div', { class: msg.err ? 'err sp-err' : 'sp-notice', role: 'status' }, ...msg.lines.map(x => h('div', {}, x))) : null);
    },
  };
}
