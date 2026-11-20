// Update of a standalone server (hub/src/update.ts, served at /local/update): the admins see « briefling X.Y.Z
// available » where the connection banner goes; the dialog updates a service in one click (the server waits for the
// agents' turns, backs up, restarts, rolls back if the new version does not start), or gives the command to run
// (npx, npm, Docker). Plain HTTP with the admin's token, like client/src/machineview.ts. The front that the new server
// serves is then offered by the « New version · Reload » pill (client/src/version.ts).
import type { Key } from './i18n.ts';
import type { UiKit } from './modules.ts';

export interface ServerUpdate {
  current: string; mode: 'service' | 'npx' | 'npm' | 'docker' | 'dev'; check: boolean
  latest?: string; checkedAt?: number
  status: 'idle' | 'downloading' | 'waiting' | 'restarting' | 'failed'
  busy?: number; error?: string; command?: string
  last?: { from: string; to: string; state: 'pending' | 'ok' | 'rolled_back'; at: number }
}

const ACTIVE = new Set(['downloading', 'waiting', 'restarting']);
/** What the pill says, or null (nothing to tell, or dismissed for that version / that failed update). */
export function pillOf(s: ServerUpdate | null, dismissed: string | null): { kind: 'new' | 'busy' | 'rolled_back'; key: string; version: string } | null {
  if (!s) return null;
  if (ACTIVE.has(s.status) && s.latest) return { kind: 'busy', key: `busy:${s.latest}`, version: s.latest };
  if (s.last?.state === 'rolled_back' && !s.latest) { const key = `rb:${s.last.to}:${s.last.at}`; return dismissed === key ? null : { kind: 'rolled_back', key, version: s.last.to } }
  if (s.latest) { const key = `new:${s.latest}`; return dismissed === key ? null : { kind: 'new', key, version: s.latest } }
  return null;
}

/** The server's failure codes (hub/src/update.ts) to text. */
export function errorKey(code: string | undefined): Key {
  if (code === 'integrity') return 'su_err_integrity';
  if (code === 'preflight' || code === 'not_the_release' || code === 'incomplete') return 'su_err_package';
  if (code === 'swap') return 'su_err_swap';
  return 'su_err_download';
}

const DISMISS = 'briefling.serverupdate';
const POLL_MS = 30 * 60_000, FAST_MS = 3_000;

export function serverUpdateModule(kit: UiKit, token: () => string | null, admin: () => boolean) {
  const { h, t, icon, render } = kit;
  let state: ServerUpdate | null = null, open = false, busy = false, err: string | null = null, copied = false, from: string | null = null, timer = 0;
  const call = async (body?: object): Promise<ServerUpdate> => {
    const r = await fetch('/local/update', { method: body ? 'POST' : 'GET', cache: 'no-store',
      headers: { Authorization: `Bearer ${token() ?? ''}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (r.status === 204 || r.status === 404) throw new Error('off'); // a server without updates (204), or an older one (404)
    const j = await r.json();
    if (!r.ok && !j?.current) throw new Error(String(r.status));
    return j as ServerUpdate;
  };
  const schedule = () => { window.clearTimeout(timer); timer = window.setTimeout(() => void load(), state && ACTIVE.has(state.status) || from ? FAST_MS : POLL_MS) };
  async function load() {
    if (!admin()) return schedule();
    try {
      const s = await call();
      if (from && s.current !== from) from = null; // the new server answers: restarted
      state = s;
    } catch (e) {
      if ((e as Error).message === 'off' && !from) return; // this server has no updates: stop asking
      /* restarting or offline: kept as is */
    }
    schedule(); render();
  }
  async function act(body: object) {
    busy = true; err = null; render();
    try {
      const s = await call(body);
      if ((body as { action: string }).action === 'apply' && !ACTIVE.has(s.status)) err = t(errorKey((s as { code?: string }).code ?? s.error));
      else if ((body as { action: string }).action === 'apply') from = s.current;
      state = s;
    } catch { err = t('su_err_download') }
    busy = false; schedule(); render();
  }
  const dismiss = (key: string) => { localStorage.setItem(DISMISS, key); open = false; render() };
  const close = () => { open = false; copied = false; render() };

  function dialog(s: ServerUpdate): HTMLElement {
    const keys = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close() } };
    const p = pillOf(s, null);
    const body: (HTMLElement | null)[] = [];
    if (s.last?.state === 'rolled_back' && s.last.to !== s.latest) body.push(h('div', { class: 'err sp-err', role: 'alert' }, t('su_rolled_back', { to: s.last.to, from: s.last.from })));
    body.push(h('div', {}, t('su_versions', { current: s.current, latest: s.latest ?? s.current })));
    if (s.latest && s.mode === 'service') {
      if (s.status === 'waiting') body.push(h('div', { class: 'sp-notice', role: 'status' }, t(s.busy ? 'su_waiting' : 'su_restarting', { n: s.busy ?? 0 })));
      else if (s.status === 'downloading') body.push(h('div', { class: 'sp-notice', role: 'status' }, t('su_downloading')));
      else if (s.status === 'restarting' || from) body.push(h('div', { class: 'sp-notice', role: 'status' }, t('su_restarting')));
      else body.push(h('div', { class: 'sp-hint' }, t('su_service_hint')));
    } else if (s.latest && s.command) {
      body.push(h('div', { class: 'sp-hint' }, t(s.mode === 'docker' ? 'su_docker_hint' : 'su_cmd_hint')),
        h('code', { class: 'su-cmd', 'data-k': 'su-cmd' }, s.command));
    }
    if (s.status === 'failed' && !err) body.push(h('div', { class: 'err sp-err', role: 'alert' }, t(errorKey(s.error))));
    if (err) body.push(h('div', { class: 'err sp-err', role: 'alert' }, err));
    const copy = async () => { try { await navigator.clipboard.writeText(s.command!); copied = true; render() } catch { /* no clipboard: the command stays selectable */ } };
    const working = ACTIVE.has(s.status) || !!from;
    return h('div', { class: 'pal-wrap', 'data-k': 'serverupdate' },
      h('div', { class: 'scrim', onclick: close }),
      h('div', { class: 'dlg', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'su-t', onkeydown: keys },
        h('h2', { id: 'su-t' }, s.latest ? t('su_title', { v: s.latest }) : t('su_title_now')),
        ...body,
        h('div', { class: 'dlg-btns' },
          p && !working ? h('button', { class: 'btn ghost', type: 'button', 'data-k': 'su-later', onclick: () => dismiss(p.key) }, t('su_later')) : null,
          s.status === 'waiting' ? h('button', { class: 'btn ghost', type: 'button', 'data-k': 'su-cancel', disabled: busy, onclick: () => void act({ action: 'cancel' }) }, t('cancel')) : null,
          !s.latest || working ? h('button', { class: 'btn ghost', type: 'button', onclick: close }, t('su_close')) : null,
          s.latest && s.mode === 'service' && !working ? h('button', { class: 'btn pri', type: 'button', 'data-k': 'su-apply', disabled: busy,
            onclick: () => void act({ action: 'apply', version: s.latest }) }, busy ? t('su_applying') : t('su_apply')) : null,
          s.latest && s.command ? h('button', { class: 'btn pri', type: 'button', onclick: copy }, t(copied ? 'agent_link_copied' : 'agent_link_copy')) : null)));
  }

  return {
    /** The first look (after the hub's sync told whether this person is an admin), then on its own timer. */
    start() { if (!timer) void load() },
    /** The pill, in the banner's place. */
    bar(): HTMLElement | null {
      if (!admin()) return null;
      const p = pillOf(state, localStorage.getItem(DISMISS));
      if (!p) return null;
      const text = p.kind === 'rolled_back' ? t('su_pill_failed', { v: p.version }) : p.kind === 'busy' ? t('su_pill_busy', { v: p.version }) : t('su_pill', { v: p.version });
      return h('button', { class: `netbar update${p.kind === 'rolled_back' ? ' stuck' : ''}`, type: 'button', 'data-k': 'serverupdate-bar', onclick: () => { open = true; render() } },
        icon('refresh', 14) as unknown as Node, h('span', {}, text, ' · ', h('b', {}, t('su_see'))));
    },
    dialog(): HTMLElement | null { return open && state && admin() ? dialog(state) : null },
  };
}
