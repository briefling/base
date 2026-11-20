// Applets (docs/design-applets.md): the Applets view of a space (list, launch form) and the applet card an agent posts
// in a conversation. Their own file since the modules refactor: main.ts keeps the sidebar entry, the route hook and the
// composer's uploads (the launch form's files go through them). `S` is main.ts' app state they read and write.
import { INLINE_IMAGE_MIME, type Message, type PublicThread } from '../../protocol/frames.ts';
import { APPLET_ACCEPTS, APPLET_ITEM_MAX, APPLET_LIST_MAX, APPLET_RUNS_SHOWN, APPLET_TEXT_MAX, APPLET_TEXTAREA_MAX, optLabel, valueText, type Applet, type AppletAccept, type AppletField,
  type AppletResult, type AppletRunFile, type AppletRunInfo, type AppletValue } from '../../protocol/applets.ts';
import { appletForm, appletHue, fileKey, placeholderShown, formState, formVisible, prefill, stepNext, stepPrev, stepsShown, stepStop, type AppletForm } from './applets.ts';
import { hasKey, type Key } from './i18n.ts';
import type { HubFrame } from '../../protocol/frames.ts';
import type { UiKit } from './modules.ts';
import type { View } from './route.ts';
import { installUrl, phoneOs, pinApp, pinHead, pinIcon, pinIconBlob } from './pinapp.ts';
import { installPage, type InstallOs } from './installview.ts';

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** The part of main.ts' app state the applets read and write. */
export interface AppletsShared { view: View; sel: string | null; err: string; trusted: Set<string> }
/** A file of the launch form, uploaded by the composer's machinery (main.ts). */
export interface AppletUpload { file: File; status: 'up' | 'ok' | 'err'; err?: string }
/** What main.ts lends the applets beyond the UiKit. */
export interface AppletsDeps {
  /** Shows a thread (after the caller set the view). */
  open(id: string): void;
  /** The composer's uploads per draft key. */
  pendings: Map<string, AppletUpload[]>;
  addFiles(key: string, space: string, list: File[]): void;
  fmtSize(n: number): string;
  /** The agent's text rendered as in a conversation (Markdown, never HTML). */
  md(text: string, space: string): Node;
  /** Read URL of an attachment (null: asked from the hub, a render follows its answer). */
  urlFor(fid: string): string | null;
}
export interface Applets {
  appletsView(space: string): HTMLElement;
  appletCardEl(m: Message, th: PublicThread): HTMLElement;
  /** The space has saved applets (sidebar entry). */
  hasApplets(space: string): boolean;
  /** Saved applets per space (`synced.applets`). */
  appletN: Map<string, number>;
  /** Route hook: listed on every entry (leads), then by the answer of each save, delete or run; a pinned applet
   *  (`#/<space>/applets/<id>`, client/src/pinapp.ts): its runs asked on entry. */
  entered(space: string, online: boolean, pin?: string): void;
  /** A conversation opened from a pinned applet, inside it: « ← <applet> » above it goes back (`back`). */
  pinConv(space: string, pin: string, body: HTMLElement, back: () => void): HTMLElement;
  left(): void;
  /** The sidebar entry was clicked: back to the list. */
  reset(): void;
}

export function appletsModule(kit: UiKit, S: AppletsShared, d: AppletsDeps): Applets {
  const { h, icon, t, tn, render, request, errText, menuBtn, withIcon, spaceName, personName, cardBand, go } = kit;
  const { open, pendings, addFiles, fmtSize, md, urlFor } = d;
  const appletsBy = new Map<string, Applet[]>();
  /** Saved applets per space (`synced.applets`, then the list of each answer): the menu entry shows only if there is one. */
  const appletN = new Map<string, number>();
  const hasApplets = (space: string) => (appletsBy.get(space)?.length ?? appletN.get(space) ?? 0) > 0;
  // ---------------------------------------------------------------- Applets (docs/design-applets.md)
  // Leads only. The list (Launch, Delete), the launch form rendered from the applet's schema (never HTML from the agent;
  // files through the composer's upload, keyed per field), and the applet card an agent posts in a conversation.
  let appletsFor = '', appletRun: AppletForm | null = null, appletDelAsk = '', appletBusy = '', appletDelTimer = 0;
  let appletMsg: { text: string; err: boolean } | null = null;
  // Results (docs/design-applets.md « Results »): the applet whose page shows (its runs), the run opened (its result).
  let appletOpen = '', runOpen = '';
  /** « Relaunch »: the line above the prefilled form (which run, the files to attach again), until it closes. */
  let refill = '';
  const runsBy = new Map<string, AppletRunInfo[]>(), results = new Map<string, AppletResult>();
  /** Applet cards a lead switched to « leads only » before saving (default: contributors launch it too). */
  const appletLeadsOnly = new Set<string>();
  const appletErr = (code: string) => hasKey(`ap_err_${code}`) ? t(`ap_err_${code}` as Key) : errText(code);
  /** One applet frame; its answer updates the list, a refusal is shown in the menu (elsewhere: the banner). */
  async function appletReq(frame: { type: string; [k: string]: unknown }, ms = 8000): Promise<HubFrame | null> {
    appletBusy = frame.type; appletMsg = null; render();
    const r = await request(frame, ms, true);
    appletBusy = '';
    if (r?.type === 'applet.list') { appletsBy.set(r.space, r.applets); appletN.set(r.space, r.applets.length); }
    if (r?.type === 'applet.runs') runsBy.set(r.applet, r.runs);
    if (r?.type === 'applet.result') results.set(r.result.run.id, r.result);
    const err = r?.type === 'error' ? appletErr(r.code) : !r ? t('ap_err_timeout') : '';
    if (err) { if (S.view.kind === 'applets') appletMsg = { text: err, err: true }; else S.err = err; }
    render();
    return r;
  }
  const fileOf = (applet: string, field: string) => pendings.get(fileKey(applet, field))?.[0];
  function dropFiles(a: Applet) { for (const f of a.fields) pendings.delete(fileKey(a.id, f.id)); }
  /** An applet's illustration: its emoji (or the applet icon) on a tint of its own (hue from its name, stable). */
  function appletArt(a: Pick<Applet, 'name' | 'emoji'>, big = false) {
    return h('span', { class: `apl-ic${big ? ' big' : ''}`, 'data-hue': String(appletHue(a.name)), 'aria-hidden': 'true' }, a.emoji ? h('span', { class: 'apl-emo' }, a.emoji) : icon('applet', big ? 22 : 18));
  }
  /** On/off switch (same look as the Lounge's « Topics only »). */
  const apSwitch = (on: boolean, k: string, label: string, go: () => void, disabled = false) => h('button', { type: 'button', class: `switch${on ? ' on' : ''}`, role: 'switch',
    'aria-checked': String(on), 'data-k': k, disabled, onclick: go }, h('span', { class: 'sw-track' }, h('span', { class: 'sw-knob' })), label);
  // ---------------------------------------------------------------- Pinned applet (client/src/pinapp.ts)
  // `#/<space>/applets/<id>`: the applet alone, full screen (no sidebar, no space navigation), its conversations inside
  // it. In a browser it is the applet's install page (client/src/installview.ts): how to put it on the home screen,
  // nothing to launch; installed (its own app, or briefling's), the applet itself.
  const pinOf = () => S.view.kind === 'applets' ? S.view.pin : undefined;
  const installed = () => matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  let installOs: InstallOs = phoneOs(navigator.userAgent, navigator.maxTouchPoints) === 'android' ? 'android' : 'ios';
  function pin(space: string, a: Applet) {
    // inside the installed app: straight to the phone's browser (Safari, Chrome), where the install page shows
    const out = installed() ? installUrl(phoneOs(navigator.userAgent, navigator.maxTouchPoints), location.origin, space, a.id) : null;
    if (out) location.href = out;
    S.view = { kind: 'applets', id: space, pin: a.id }; S.sel = null;
    appletRun = null; refill = '';
    openApplet(space, a.id);
  }
  /** Its own installable app (client/src/pinapp.ts): asked once per applet and page; a move reloads the page there. */
  const pinAsked = new Set<string>();
  function pinOwnApp(space: string, a: Applet) {
    const k = `${space}/${a.id}/${a.name}/${a.emoji ?? ''}`;
    if (pinAsked.has(k)) return;
    pinAsked.add(k);
    void pinApp({
      request: (f, ms) => request(f, ms),
      icon: size => pinIconBlob(a.name, a.emoji, appletHue(a.name), size),
      upload: async (post, file) => {
        const body = new FormData();
        for (const [k2, v] of Object.entries(post.fields)) body.append(k2, v);
        body.append('file', file); // the file must be the last field of the S3 form
        try { return (await fetch(post.url, { method: 'POST', body })).ok; } catch { return false; }
      },
      path: () => location.pathname,
      go: url => location.replace(url),
    }, space, a.id, location.hash);
  }
  function pinView(space: string, id: string) {
    const list = appletsBy.get(space), a = list?.find(x => x.id === id);
    if (a) { pinHead({ id: a.id, name: a.name, emoji: a.emoji, hue: appletHue(a.name) }); pinOwnApp(space, a); }
    const msg = appletMsg ? h('div', { class: appletMsg.err ? 'err sp-err' : 'sp-notice', role: 'status', 'data-k': 'ap-msg' }, appletMsg.text) : null;
    const body = !list ? h('div', { class: 'empty' }, t('ex_loading'))
      : !a ? h('div', { class: 'empty', 'data-k': 'ap-pin-gone' }, t('ap_pin_gone'))
      : !installed() ? installPage(kit, { name: a.name, iconUrl: pinIcon(a.name, a.emoji, appletHue(a.name)) }, installOs, os => { installOs = os; render(); })
      : appletRun?.id === a.id ? appletFormEl(space, a)
      : runOpen ? runEl(space, a, results.get(runOpen))
      : appletPageEl(space, a);
    // keyed by main.ts (its route): no data-k of its own
    return h('section', { class: 'overview applets pinned' }, h('div', { class: 'apl-body scroll' }, installed() ? msg : null, body));
  }
  function pinConv(space: string, id: string, body: HTMLElement, back: () => void) {
    const a = appletsBy.get(space)?.find(x => x.id === id);
    return h('section', { class: 'pin-conv' }, // keyed by main.ts (its route): no data-k of its own
      h('button', { class: 'apl-back pin-back', type: 'button', 'data-k': 'ap-pin-back', onclick: back }, `← ${a?.name ?? t('applets')}`), body);
  }
  function appletsView(space: string) {
    const pinned = pinOf();
    if (pinned) return pinView(space, pinned);
    const list = appletsBy.get(space), lead = S.trusted.has(space);
    const head = h('header', { class: 'mx-head' }, menuBtn(), h('div', {}, h('h2', {}, withIcon('applet', t('ap_title', { space: spaceName(space) }), 18)), h('p', {}, t('ap_intro'))));
    const cur = appletRun && list?.find(a => a.id === appletRun!.id);
    const msg = appletMsg ? h('div', { class: appletMsg.err ? 'err sp-err' : 'sp-notice', role: 'status', 'data-k': 'ap-msg' }, appletMsg.text) : null;
    const del = (a: Applet) => {
      if (appletDelAsk !== a.id) { appletDelAsk = a.id; clearTimeout(appletDelTimer); appletDelTimer = window.setTimeout(() => { appletDelAsk = ''; render(); }, 10_000); render(); return; }
      appletDelAsk = ''; void appletReq({ type: 'applet.delete', space, id: a.id, version: a.version });
    };
    // the tile's top opens the applet on its runs; Launch goes straight to the form
    const tile = (a: Applet) => h('article', { class: 'apl-tile', 'data-applet': a.id },
      h('button', { type: 'button', class: 'apl-top apl-open-h', 'data-k': `ap-open-${a.id}`, 'aria-label': t('ap_open_runs', { name: a.name }), onclick: () => openApplet(space, a.id) },
        appletArt(a), h('div', { class: 'apl-tt' }, h('h3', {}, a.name),
        h('div', { class: 'apl-meta' }, t('ap_by_agent', { agent: cap(a.agent) })))),
      a.description ? h('p', { class: 'apl-desc' }, a.description) : null,
      lead ? apSwitch(!a.leadsOnly, `ap-who-${a.id}`, t('ap_who_contrib'), () => void appletReq({ type: 'applet.set', space, id: a.id, version: a.version, leadsOnly: !a.leadsOnly }), !!appletBusy) : null,
      h('div', { class: 'apl-foot' },
        h('button', { class: 'btn pri apl-go', type: 'button', 'data-k': `ap-run-${a.id}`, disabled: !!appletBusy, onclick: () => { appletRun = appletForm(a); refill = ''; appletMsg = null; render(); } },
          icon('play', 13), t('ap_launch')),
        h('button', { class: 'btn ghost apl-pin', type: 'button', 'data-k': `ap-pin-${a.id}`, title: t('ap_pin_title'), onclick: () => pin(space, a) }, icon('smartphone', 13), t('ap_pin')),
        lead ? h('button', { class: `apl-del${appletDelAsk === a.id ? ' ask' : ''}`, type: 'button', 'data-k': `ap-del-${a.id}`, disabled: !!appletBusy, title: t('ap_delete'),
          'aria-label': appletDelAsk === a.id ? t('ap_delete_confirm') : t('ap_delete'), onclick: () => del(a) }, icon('trash', 15), appletDelAsk === a.id ? t('ap_delete_confirm') : null) : null));
    const page = !cur && appletOpen ? list?.find(a => a.id === appletOpen) : undefined;
    const res = page && runOpen ? results.get(runOpen) : undefined;
    const body = !list ? h('div', { class: 'empty' }, t('ex_loading'))
      : cur ? appletFormEl(space, cur)
      : page && runOpen ? runEl(space, page, res)
      : page ? appletPageEl(space, page)
      : list.length ? h('div', { class: 'apl-grid' }, ...list.map(tile)) : h('div', { class: 'empty', 'data-k': 'ap-none' }, t('ap_none'));
    return h('section', { class: 'overview applets' }, head, h('div', { class: 'apl-body scroll' }, msg, body));
  }
  /** Local previews of the form's files (object URLs of the person's own picked files), revoked when the form closes. */
  const previews = new Map<File, string>();
  const previewOf = (file: File, type: string) => { let u = previews.get(file); if (!u) { u = URL.createObjectURL(new Blob([file], { type })); previews.set(file, u); } return u; };
  const dropPreviews = () => { for (const u of previews.values()) URL.revokeObjectURL(u); previews.clear(); };
  const acceptAttr = (acc?: AppletAccept[]) => acc ? acc.flatMap(x => APPLET_ACCEPTS[x].map(e => `.${e}`)).join(',') : undefined;
  const acceptNames = (acc: AppletAccept[]) => acc.map(x => t(`ap_acc_${x}` as Key)).join(', ');
  function appletFormEl(space: string, a: Applet) {
    const f = appletRun!;
    const set = (id: string, v: AppletValue) => { appletRun = { ...appletRun!, values: { ...appletRun!.values, [id]: v } }; appletMsg = null; render(); };
    const upload = (id: string) => { const p = fileOf(a.id, id); return p && { ...p, name: p.file.name }; };
    const state = formState(a, f, upload);
    const vis = formVisible(a, f, upload);
    const withUnit = (el: HTMLElement, unit?: string) => unit ? h('div', { class: 'apl-unit' }, el, h('span', { class: 'apl-u' }, unit)) : el;
    const input = (x: AppletField) => {
      const k = `ap-f-${x.id}`, v = f.values[x.id];
      const str = typeof v === 'string' ? v : '';
      if (x.kind === 'textarea') { const el = h('textarea', { rows: 6, maxlength: APPLET_TEXTAREA_MAX, 'data-k': k, 'aria-label': x.label, placeholder: placeholderShown(x.placeholder, t('ap_eg')), oninput: (e: Event) => set(x.id, (e.target as HTMLTextAreaElement).value) }) as HTMLTextAreaElement; el.value = str; return el; }
      if (x.kind === 'select') {
        const opts = vis.options.get(x.id) ?? [], cur = opts.includes(str) ? str : '';
        return h('select', { 'data-k': k, 'aria-label': x.label, onchange: (e: Event) => set(x.id, (e.target as HTMLSelectElement).value) },
          h('option', { value: '', selected: !cur }, t('ap_pick')), ...opts.map(o => h('option', { value: o, selected: o === cur }, o)));
      }
      if (x.kind === 'multiselect') {
        const opts = vis.options.get(x.id) ?? [], on = Array.isArray(v) ? v : [];
        return h('div', { class: 'apl-multi', role: 'group', 'aria-label': x.label, 'data-k': k }, ...opts.map(o => h('label', { class: 'apl-check' },
          h('input', { type: 'checkbox', checked: on.includes(o), onchange: (e: Event) => set(x.id, (e.target as HTMLInputElement).checked ? [...on.filter(y => y !== o), o] : on.filter(y => y !== o)) }), o)));
      }
      if (x.kind === 'checkbox') return h('label', { class: 'apl-check' }, h('input', { type: 'checkbox', 'data-k': k, checked: v === true, onchange: (e: Event) => set(x.id, (e.target as HTMLInputElement).checked) }), x.label);
      if (x.kind === 'date') return h('input', { type: 'date', value: str, 'data-k': k, 'aria-label': x.label, oninput: (e: Event) => set(x.id, (e.target as HTMLInputElement).value) });
      if (x.kind === 'list') {
        // one input per item, « Add » for the next one: a length per span, the last one kept even when emptied
        const items = Array.isArray(v) && v.length ? v : [''];
        const num = x.of === 'number';
        return h('div', { class: 'apl-list', 'data-k': k },
          ...items.map((it, i) => h('div', { class: 'apl-item' }, h('span', { class: 'apl-n' }, String(i + 1)),
            withUnit(h('input', { value: it, maxlength: APPLET_ITEM_MAX, inputmode: num ? 'decimal' : undefined, autocomplete: 'off', placeholder: placeholderShown(x.placeholder, t('ap_eg')),
              'data-k': `${k}-${i}`, 'aria-label': `${x.label} ${i + 1}`, oninput: (e: Event) => set(x.id, items.map((y, j) => j === i ? (e.target as HTMLInputElement).value : y)) }), x.unit),
            items.length > 1 ? h('button', { type: 'button', class: 'apl-rm', 'data-k': `${k}-rm-${i}`, title: t('ap_item_remove'), 'aria-label': t('ap_item_remove'), onclick: () => set(x.id, items.filter((_, j) => j !== i)) }, icon('x', 13)) : null)),
          items.length < APPLET_LIST_MAX ? h('button', { type: 'button', class: 'btn ghost apl-add', 'data-k': `${k}-add`, onclick: () => set(x.id, [...items, '']) }, `+ ${t('ap_item_add')}`) : null);
      }
      if (x.kind === 'file') {
        const p = fileOf(a.id, x.id);
        const pick = h('input', { type: 'file', 'data-k': k, 'aria-label': x.label, accept: acceptAttr(x.accept), onchange: (e: Event) => {
          const file = (e.target as HTMLInputElement).files?.[0]; pendings.delete(fileKey(a.id, x.id)); if (file) addFiles(fileKey(a.id, x.id), space, [file]); else render(); } });
        // a preview of the picked file, made in the browser from the person's own file (never fetched): an image as a
        // thumbnail; a PDF opens in a new tab (the app's CSP frames no blob, on purpose)
        const ext = p ? /\.([a-z0-9]+)$/i.exec(p.file.name)?.[1].toLowerCase() ?? '' : '';
        const img = p && (APPLET_ACCEPTS.image as readonly string[]).includes(ext) && p.file.type.startsWith('image/');
        const pdf = p && ext === 'pdf';
        // the native input stays hidden (its « No file chosen » survives no render): a button, then the file's chip
        return h('div', { class: 'apl-file' }, h('label', { class: 'btn ghost apl-pick' }, icon('paperclip', 14), p ? t('ap_file_again') : t('ap_file_pick'), pick),
          p ? h('span', { class: `apl-up apl-up-${p.status}`, 'data-k': `apl-up-${x.id}` }, icon('file', 14),
            `${p.file.name} · ${p.status === 'up' ? t('ap_uploading') : p.status === 'ok' ? fmtSize(p.file.size) : p.err ?? t('att_failed')}`) : null,
          pdf ? h('a', { class: 'apl-pdf', href: previewOf(p.file, 'application/pdf'), target: '_blank', rel: 'noopener', 'data-k': `apl-pdf-${x.id}` }, t('ap_pdf_open')) : null,
          img ? h('img', { class: 'apl-thumb', src: previewOf(p.file, p.file.type), alt: p.file.name, 'data-k': `apl-thumb-${x.id}` }) : null);
      }
      const num = x.kind === 'number';
      return withUnit(h('input', { value: str, maxlength: APPLET_TEXT_MAX, 'data-k': k, 'aria-label': x.label, autocomplete: 'off', placeholder: placeholderShown(x.placeholder, t('ap_eg')),
        inputmode: num ? 'decimal' : undefined, oninput: (e: Event) => set(x.id, (e.target as HTMLInputElement).value) }), x.unit);
    };
    const field = (x: AppletField) => h('div', { class: `sp-field${cur && cur.field === x.id ? ' apl-bad' : ''}`, 'data-f': x.id },
      // a checkbox carries its label; any other optional field says so (the agent never writes « optional » by hand)
      x.kind === 'checkbox' ? null : h('label', { class: 'label' }, x.label, x.required ? null : h('span', { class: 'apl-opt', 'data-k': `ap-opt-${x.id}` }, t('ap_optional'))),
      input(x), x.hint ? h('div', { class: 'sp-hint' }, x.hint) : null);
    const label = (id?: string) => a.fields.find(x => x.id === id)?.label ?? '';
    // a form in steps shows the fields of its current step, then a summary (f.step === steps.length) before Launch
    const steps = a.steps, summary = !!steps && f.step >= steps.length;
    const inStep = steps && !summary ? new Set(steps[f.step].fields) : null;
    const shown = summary ? [] : a.fields.filter(x => vis.shown.has(x.id) && (!inStep || inStep.has(x.id)));
    const main = shown.filter(x => !x.advanced), adv = shown.filter(x => x.advanced);
    const accOf = (id?: string) => a.fields.find(x => x.id === id)?.accept ?? [];
    const stopText = (s: { stop: string; field?: string }) => s.stop === 'uploading' ? t('ap_uploading') : s.stop === 'file' ? t('ap_bad_file', { field: label(s.field) })
      : s.stop === 'type' ? t('ap_bad_type', { field: label(s.field), types: acceptNames(accOf(s.field)) }) : t('ap_missing', { field: label(s.field) });
    // a step validates its own fields (and the ones before) before Next; the summary and a one-page form, the whole form
    const cur = steps && !summary ? stepStop(a, f, upload) : 'stop' in state ? state : null;
    const stop = cur ? stopText(cur) : '';
    const launch = async () => {
      if ('stop' in state) return;
      const r = await appletReq({ type: 'applet.run', space, id: a.id, version: a.version, values: state.values, files: state.files }, 10_000);
      if (r?.type !== 'ack') return;
      dropFiles(a); dropPreviews(); appletRun = null; refill = '';
      // « threads » off: the run is a Lounge topic (hub/src/applets.ts), opened in the Lounge.
      // pinned: the conversation opens inside the mini-app
      if (!pinOf()) S.view = { kind: kit.modOn(space, 'threads') ? 'space' : 'lounge', id: space };
      open(r.thread);
    };
    const back = () => { dropFiles(a); dropPreviews(); appletRun = null; refill = ''; appletMsg = null; if (appletOpen && !runOpen) void appletReq({ type: 'applet.runs', space, id: appletOpen }); render(); };
    const move = (to: AppletForm | null) => { if (to && !('stop' in to)) { appletRun = to; appletMsg = null; render(); } };
    // the steps that show now (all hidden = skipped), numbered as shown; the summary is the last mark
    const seen = steps ? stepsShown(a, f, upload) : [];
    const marks = steps ? h('ol', { class: 'apl-steps', 'data-k': 'ap-steps', 'aria-label': summary ? t('ap_summary') : t('ap_step_of', { n: seen.indexOf(f.step) + 1, total: seen.length }) },
      ...seen.map((i, n) => h('li', { class: i === f.step ? 'on' : i < f.step ? 'done' : '', 'data-step': String(i), 'aria-current': i === f.step ? 'step' : undefined },
        h('span', { class: 'apl-sn' }, String(n + 1)), steps[i].title)),
      h('li', { class: summary ? 'on' : '', 'data-step': 'sum', 'aria-current': summary ? 'step' : undefined }, h('span', { class: 'apl-sn' }, '✓'), t('ap_summary'))) : null;
    // the summary: each shown step, its filled fields as they will be sent, « Edit » goes back to that step
    const sumEl = () => {
      const vals = 'values' in state ? state.values : {}, names = Object.fromEntries(a.fields.flatMap(x => { const p = x.kind === 'file' && vis.shown.has(x.id) ? fileOf(a.id, x.id) : undefined; return p ? [[x.id, p.file.name]] : []; }));
      return h('div', { class: 'apl-sum', 'data-k': 'ap-sum' }, ...seen.map(i => {
        const rows = steps![i].fields.flatMap(id => { const x = a.fields.find(y => y.id === id)!; const v = vis.shown.has(id) ? valueText(x, x.kind === 'file' ? names[id] : vals[id]) : null;
          return v === null ? [] : [h('div', { class: 'apl-sr', 'data-f': id }, h('span', { class: 'apl-sl' }, x.label), h('span', { class: `apl-sv${x.kind === 'textarea' ? ' long' : ''}` }, v))]; });
        return h('section', { class: 'apl-ss', 'data-step': String(i) }, h('div', { class: 'apl-sh' }, h('h4', {}, steps![i].title),
          h('button', { type: 'button', class: 'btn ghost apl-edit', 'data-k': `ap-edit-${i}`, onclick: () => move({ ...f, step: i }) }, t('ap_edit'))),
          ...(rows.length ? rows : [h('div', { class: 'apl-sr apl-none' }, t('ap_sum_empty'))]));
      }));
    };
    const prev = steps ? stepPrev(a, f, upload) : null;
    const last = steps && !summary && seen.at(-1) === f.step;
    return h('div', { class: 'apl-form', 'data-k': 'apl-form' },
      h('button', { class: 'apl-back', type: 'button', 'data-k': 'ap-back', onclick: back }, `← ${appletOpen ? a.name : t('applets')}`),
      h('div', { class: 'apl-ftop' }, appletArt(a), h('div', { class: 'apl-tt' }, h('h3', {}, a.name), h('div', { class: 'apl-meta' }, a.description || t('ap_by_agent', { agent: cap(a.agent) })))),
      refill ? h('div', { class: 'sp-notice', 'data-k': 'ap-refill' }, refill) : null,
      marks,
      summary ? sumEl() : null,
      ...main.map(field),
      adv.length ? h('details', { class: 'apl-adv', 'data-k': 'ap-adv' }, // folded at first; then the reader's choice (patch keeps a details' state)
        h('summary', {}, t('ap_advanced'), h('span', { class: 'apl-opt' }, tn('ap_fields', adv.length))), ...adv.map(field)) : null,
      h('div', { class: 'sp-actions' }, stop ? h('span', { class: 'sp-state', 'data-k': 'ap-stop' }, stop) : null,
        prev ? h('button', { class: 'btn ghost', type: 'button', 'data-k': 'ap-prev', onclick: () => move(prev) }, `← ${t('ap_prev')}`)
          : h('button', { class: 'btn ghost', type: 'button', onclick: back }, t('cancel')),
        steps && !summary
          ? h('button', { class: 'btn pri', type: 'button', 'data-k': 'ap-next', disabled: !!stop, onclick: () => { const n = stepNext(a, f, upload); if (!('stop' in n)) move(n); } },
            last ? t('ap_to_summary') : `${t('ap_next')} →`)
          : h('button', { class: 'btn pri', type: 'button', 'data-k': 'ap-go', disabled: !!appletBusy || !!stop, onclick: () => void launch() },
            appletBusy === 'applet.run' ? t('ap_launching') : t('ap_go'))));
  }
  // ---------------------------------------------------------------- Results: the applet's runs, a run's result
  /** Opens an applet on its runs (asked again at each opening: their state moves with their conversations). */
  function openApplet(space: string, id: string) { appletOpen = id; runOpen = ''; appletMsg = null; void appletReq({ type: 'applet.runs', space, id }); }
  function openRun(space: string, id: string) { runOpen = id; appletMsg = null; void appletReq({ type: 'applet.result', space, run: id }); }
  const stateChip = (s: AppletRunInfo['state']) => h('span', { class: `apl-st apl-st-${s}`, 'data-k': 'ap-st' }, t(`ap_st_${s}` as Key));
  const who = (id: string) => personName(id) ?? t('a_member');
  const when = (at: number) => new Date(at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  /** The applet's page: Launch, then its runs, newest first (who, when, state, files delivered or why it failed). */
  function appletPageEl(space: string, a: Applet) {
    const runs = runsBy.get(a.id);
    const row = (x: AppletRunInfo) => h('button', { type: 'button', class: 'apl-run', 'data-k': `ap-runrow-${x.id}`, 'data-state': x.state, onclick: () => openRun(space, x.id) },
      h('span', { class: 'apl-rh' }, h('b', {}, who(x.by)), h('span', { class: 'apl-rt', title: when(x.at) }, kit.since(x.at)), stateChip(x.state)),
      x.files.length ? h('span', { class: 'apl-rf' }, ...x.files.map(f => h('span', { class: 'apl-rfn' }, icon('file', 12), f.name)))
        : x.action ? h('span', { class: 'apl-rf apl-ra' }, x.action) : null);
    return h('div', { class: 'apl-page', 'data-k': 'ap-page' },
      pinOf() ? null : h('button', { class: 'apl-back', type: 'button', 'data-k': 'ap-back-list', onclick: () => { appletOpen = ''; runOpen = ''; appletMsg = null; render(); } }, `← ${t('applets')}`),
      h('div', { class: 'apl-ftop' }, appletArt(a, true), h('div', { class: 'apl-tt' }, h('h3', {}, a.name), h('div', { class: 'apl-meta' }, a.description || t('ap_by_agent', { agent: cap(a.agent) }))),
        h('button', { class: 'btn pri apl-go', type: 'button', 'data-k': `ap-launch-${a.id}`, disabled: !!appletBusy, onclick: () => { appletRun = appletForm(a); refill = ''; appletMsg = null; render(); } }, icon('play', 13), t('ap_launch'))),
      h('h4', { class: 'apl-hh' }, t('ap_history')),
      !runs ? h('div', { class: 'empty' }, t('ap_runs_loading'))
        : runs.length ? h('div', { class: 'apl-runs', 'data-k': 'ap-runs' }, ...runs.map(row)) : h('div', { class: 'empty', 'data-k': 'ap-runs-none' }, t('ap_runs_none')),
      runs && runs.length >= APPLET_RUNS_SHOWN ? h('div', { class: 'sp-hint' }, t('ap_runs_more', { n: APPLET_RUNS_SHOWN })) : null);
  }
  /** A delivered PDF: fetched, then shown by the browser's viewer in a new tab, typed PDF (never a page of the app's).
   *  The tab is opened on the click (a pop-up blocker lets it through), filled once the file is there. */
  function openPdf(u: string) {
    const w = window.open('', '_blank');
    void fetch(u).then(r => r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))).then(b => {
      const url = URL.createObjectURL(new Blob([b], { type: 'application/pdf' }));
      if (w) { w.opener = null; w.location.href = url; }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }).catch(() => { w?.close(); appletMsg = { text: t('att_failed'), err: true }; render(); });
  }
  const ext = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase() ?? '';
  /** A file the agent delivered: an image shown, a PDF opened in the browser's viewer, anything else (Word, Excel…) downloaded. */
  function resultFile(f: AppletRunFile) {
    const u = urlFor(f.id);
    if (INLINE_IMAGE_MIME.includes(f.mime))
      return u ? h('a', { class: 'apl-rimg', href: u, target: '_blank', rel: 'noopener noreferrer', title: f.name }, h('img', { src: u, alt: f.name, loading: 'lazy', 'data-k': `ap-img-${f.id}` }))
        : h('div', { class: 'img-ph' }, f.name);
    const doc = h(u ? 'a' : 'span', { class: 'doc', 'data-k': `ap-file-${f.id}`, ...(u ? { href: u, rel: 'noopener noreferrer', title: t('ap_download') } : {}) },
      h('span', { class: 'att-ico' }, icon('file') as unknown as Node), h('span', { class: 'att-name' }, f.name), h('span', { class: 'att-meta' }, fmtSize(f.size)));
    return ext(f.name) === 'pdf' || f.mime === 'application/pdf'
      ? h('div', { class: 'apl-rdoc' }, doc, h('button', { type: 'button', class: 'btn ghost', 'data-k': `ap-pdf-${f.id}`, disabled: !u, onclick: () => { if (u) openPdf(u); } }, t('ap_pdf_open')))
      : doc;
  }
  /** A run: state, who and when, the agent's final text (Markdown), its files; Relaunch, Discuss the result, the conversation. */
  function runEl(space: string, a: Applet, res: AppletResult | undefined) {
    const back = h('button', { class: 'apl-back', type: 'button', 'data-k': 'ap-back-runs', onclick: () => { runOpen = ''; appletMsg = null; void appletReq({ type: 'applet.runs', space, id: a.id }); } }, `← ${a.name}`);
    if (!res) return h('div', { class: 'apl-page', 'data-k': 'ap-result' }, back, h('div', { class: 'empty' }, t('ex_loading')));
    const x = res.run;
    const names = Object.values(res.fileNames ?? {});
    const relaunch = () => { appletRun = prefill(a, res.values); refill = names.length ? t('ap_refile', { when: when(x.at), names: names.join(', ') }) : t('ap_refill', { when: when(x.at) }); appletMsg = null; render(); };
    const talk = async () => {
      const r = await appletReq({ type: 'applet.talk', space, run: x.id });
      if (r?.type !== 'ack') return;
      if (!pinOf()) S.view = { kind: 'lounge', id: space };
      open(r.thread);
    };
    const conv = () => { if (!pinOf()) S.view = { kind: x.topic ? 'lounge' : 'space', id: space }; open(x.id); };
    return h('div', { class: 'apl-page', 'data-k': 'ap-result', 'data-run': x.id },
      back,
      h('div', { class: 'apl-rh apl-rhead' }, stateChip(x.state), h('span', {}, `${who(x.by)} · ${when(x.at)}`)),
      x.action ? h('div', { class: 'sp-notice', 'data-k': 'ap-action' }, x.action) : null,
      h('h4', { class: 'apl-hh' }, t('ap_result')),
      res.text ? h('div', { class: 'md apl-text', 'data-k': 'ap-text' }, md(res.text, space)) : h('div', { class: 'empty' }, t('ap_result_none')),
      x.files.length ? h('div', { class: 'apl-rfiles', 'data-k': 'ap-files', 'aria-label': t('ap_result_files') }, ...x.files.map(resultFile)) : null,
      h('div', { class: 'sp-actions apl-racts' },
        h('button', { class: 'btn ghost', type: 'button', 'data-k': 'ap-thread', onclick: conv }, x.topic ? t('ap_open_topic') : t('ap_open_thread')),
        h('button', { class: 'btn ghost apl-talk', type: 'button', 'data-k': 'ap-talk', disabled: !!appletBusy, onclick: () => void talk() }, icon('messageCircle', 14), t('ap_talk')),
        h('button', { class: 'btn pri', type: 'button', 'data-k': 'ap-relaunch', disabled: !!appletBusy, onclick: relaunch }, t('ap_relaunch'))));
  }
  /** Applet card: what the agent proposes (agent, fields, instruction folded); a lead saves it, then it says so. */
  function appletCardEl(m: Message, th: PublicThread) {
    const c = m.applet!, d = c.draft;
    const kind = (x: AppletField) => [t(`ap_kind_${x.kind}` as Key), x.unit ?? '', x.required ? t('ap_required') : '', x.showIf ? t('ap_conditional') : '', x.advanced ? t('ap_advanced_short') : '',
      x.accept ? acceptNames(x.accept) : '', x.options ? x.options.map(optLabel).join(' / ') : ''].filter(Boolean).join(' · ');
    const go2menu = h('a', { href: '#', class: 'apl-open', onclick: (e: Event) => { e.preventDefault(); S.view = { kind: 'applets', id: th.space }; S.sel = null; appletRun = null; render(); } }, t('ap_card_menu'));
    const foot = c.saved ? h('div', { class: 'pc apl-saved', 'data-k': 'apl-saved' }, t('ap_card_saved', { name: personName(c.saved.by) ?? t('a_member') }), ' · ', go2menu)
      : S.trusted.has(th.space) ? h('div', { class: 'opts apl-opts' },
        c.id ? null : apSwitch(!appletLeadsOnly.has(m.id), 'ap-card-who', t('ap_who_contrib'), () => { if (!appletLeadsOnly.delete(m.id)) appletLeadsOnly.add(m.id); render(); }),
        h('button', { class: 'btn pri', 'data-k': 'ap-accept', disabled: appletBusy === 'applet.accept',
          onclick: () => void appletReq({ type: 'applet.accept', thread: m.thread, msg: m.id, ...(c.id ? {} : { contributors: !appletLeadsOnly.has(m.id) }) }) }, ...go(c.id ? t('ap_card_update_btn') : t('ap_card_save'))))
      : h('div', { class: 'pc' }, t('ap_card_lead'));
    return h('div', { class: 'propose k-applet', 'data-k': `ap-card-${m.id}` }, cardBand('applet', t(c.id ? 'ap_card_update' : 'ap_card_q', { name: d.name }), t('card_by', { agent: cap(c.by) })),
      h('div', { class: 'k-body' }, c.why ? h('div', { class: 'pw' }, c.why) : null,
        h('div', { class: 'apl-top apl-in-card' }, appletArt(d), h('div', { class: 'apl-tt' }, h('h3', {}, d.name), d.description ? h('div', { class: 'apl-meta' }, d.description) : null)),
        h('div', { class: 'pc' }, t('ap_card_agent', { agent: cap(d.agent) })),
        d.steps ? h('div', { class: 'pc', 'data-k': 'ap-card-steps' }, t('ap_card_steps', { steps: d.steps.map(s => s.title).join(' → ') })) : null,
        h('ul', { class: 'apl-fields' }, ...d.fields.map(x => h('li', {}, h('b', {}, x.label), h('span', { class: 'sp-desc' }, ` · ${kind(x)}`), x.hint ? h('div', { class: 'sp-hint' }, x.hint) : null))),
        h('details', { class: 'apl-ins' }, h('summary', {}, t('ap_instruction')), h('div', { class: 'pb ab-text' }, d.instruction)),
        h('div', { class: 'pc' }, t('ap_card_note')),
        foot));
  }
  return { appletsView, appletCardEl, hasApplets, appletN, pinConv,
    entered(space, online, pinned) {
      if (appletsFor !== space && online) { appletsFor = space; void appletReq({ type: 'applet.list', space }); }
      if (pinned && appletOpen !== pinned && online) openApplet(space, pinned);
    },
    left() { appletsFor = ''; appletRun = null; appletDelAsk = ''; appletOpen = ''; runOpen = ''; refill = ''; dropPreviews(); },
    reset() { appletRun = null; appletMsg = null; appletOpen = ''; runOpen = ''; refill = ''; } };
}
