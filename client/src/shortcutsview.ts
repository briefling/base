// Desktop keyboard shortcuts (rules in client/src/shortcuts.ts): the switcher of recent conversations (Ctrl+Tab or
// ⌥Tab held: a list over the page after a short hold, released = open the selection, in any space), ⌘1…9 (n-th space
// of the sidebar) and the help (⌘/). The list of recents lives in this browser (localStorage, per signed-in person).
// main.ts calls `seen()` on each render and shows `el()` over the shell; the listeners are set once here.
import type { PublicThread } from '../../protocol/frames.ts';
import { isGeneralId } from '../../protocol/frames.ts';
import type { UiKit } from './modules.ts';
import type { RecentsModule } from './recentsview.ts';
import { bumpMru, isHelp, parseMru, spaceIndex, startSwitch, stepSwitch, switchMod, type Switch } from './shortcuts.ts';

export interface ShortcutsDeps {
  /** The conversation on screen (null: a list, Now…). */
  sel(): string | null;
  goRecent(f: PublicThread): void;
  /** Same as a click on the space in the sidebar. */
  goSpace(id: string): void;
  /** Spaces in their sidebar order. */
  spaces(): string[];
  rc(): RecentsModule;
  /** A dialog that owns the keyboard is open (search palette, profile, file viewer). */
  busy(): boolean;
}

const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
/** Hold this long before the list shows: a quick press-release just flips to the previous conversation. */
const SHOW_AFTER_MS = 150;

export function shortcutsModule(k: UiKit, d: ShortcutsDeps) {
  const { h, t, render } = k;
  const storeKey = () => `briefling.recents.${k.me()}`;
  let owner = '', mru: string[] = [];
  const list = () => {
    if (owner !== k.me()) { owner = k.me(); try { mru = parseMru(localStorage.getItem(storeKey())); } catch { mru = []; } }
    return mru;
  };
  let sw: Switch | null = null, shown = false, showTimer: number | undefined, help = false;

  function seen(id: string | null) {
    if (!id || id === 'new' || isGeneralId(id) || !k.thread(id) || list()[0] === id) return;
    mru = bumpMru(list(), id);
    try { localStorage.setItem(storeKey(), JSON.stringify(mru)); } catch { /* storage full or off */ }
  }
  function stop() { const was = shown; sw = null; shown = false; window.clearTimeout(showTimer); if (was) render(); }
  function commit() {
    const id = sw ? sw.ids[sw.i] : undefined;
    stop();
    const f = id ? k.thread(id) : undefined;
    if (f) d.goRecent(f);
  }
  const held = (e: KeyboardEvent | MouseEvent, s: Switch) => s.mod === 'Control' ? e.ctrlKey : e.altKey;

  // Capture: the composer and the lists have their own Tab/Escape handlers, the switcher goes first while it is held.
  window.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (sw && !held(e, sw)) commit(); // the modifier's keyup was missed (released outside the window)
    const mod = switchMod(e);
    if (sw) {
      e.preventDefault(); e.stopPropagation();
      if (mod) { sw = stepSwitch(sw, e.shiftKey); if (shown) render(); }
      else if (e.key === 'Escape') stop();
      else if (e.key === 'Enter') commit();
      return;
    }
    if (!mod || d.busy()) return;
    const s = startSwitch(list(), id => !!k.thread(id), d.sel(), mod, e.shiftKey);
    e.preventDefault(); e.stopPropagation();
    if (!s) return;
    sw = s; help = false;
    showTimer = window.setTimeout(() => { if (sw) { shown = true; render(); } }, SHOW_AFTER_MS);
  }, { capture: true });
  window.addEventListener('keyup', (e) => { if (sw && e.key === sw.mod) commit(); }, { capture: true });
  // Another window or app took the keyboard (⌘Tab away): nothing is opened behind the person's back.
  window.addEventListener('blur', () => { if (sw) stop(); });
  document.addEventListener('visibilitychange', () => { if (sw && document.visibilityState !== 'visible') stop(); });

  // Bubble, after the palette's own ⌘1…9 (its rows) which marks the event handled.
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.isComposing) return;
    if (isHelp(e, MAC)) { e.preventDefault(); help = !help; render(); return; }
    if (help && e.key === 'Escape') { help = false; render(); return; }
    const n = spaceIndex(e, MAC);
    if (n === null || d.busy()) return;
    const id = d.spaces()[n];
    e.preventDefault();
    if (id) { help = false; d.goSpace(id); }
  });

  const cmd = MAC ? '⌘' : 'Ctrl ';
  function switcherEl(s: Switch) {
    const items = s.ids.map(id => ({ f: k.thread(id)! })).filter(x => x.f);
    const pick = (i: number) => { if (sw) { sw = { ...sw, i }; commit(); } };
    const hover = (i: number) => { if (sw && sw.i !== i) { sw = { ...sw, i }; render(); } };
    const modKey = s.mod === 'Control' ? (MAC ? '⌃' : 'Ctrl') : (MAC ? '⌥' : 'Alt');
    return h('div', { class: 'pal-wrap kb-wrap', 'data-k': 'switcher' },
      h('div', { class: 'scrim', onclick: stop }),
      h('div', { class: 'palette kb-switch', role: 'dialog', 'aria-label': t('sc_switch') },
        d.rc().flatEl(items, Math.min(s.i, items.length - 1), pick, hover, true, false),
        h('div', { class: 'pal-foot' }, h('span', {}, ''), h('span', { class: 'pal-keys' }, t('sc_switch_keys', { mod: modKey })))));
  }
  function helpEl() {
    const close = () => { help = false; render(); };
    const row = (keys: string[], label: string) => h('div', { class: 'kb-row' },
      h('span', { class: 'kb-keys' }, ...keys.map(x => h('kbd', {}, x))), h('span', {}, label));
    return h('div', { class: 'pal-wrap', 'data-k': 'sc-help' },
      h('div', { class: 'scrim', onclick: close }),
      h('div', { class: 'dlg kb-help', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'kb-help-t' },
        h('h2', { id: 'kb-help-t' }, t('sc_help')),
        h('div', { class: 'kb-rows' },
          row(MAC ? ['⌃ Tab', '⌥ Tab'] : ['Ctrl Tab'], t('sc_h_switch')),
          row([`${cmd}1…9`], t('sc_h_space')),
          row([`${cmd}K`], t('search')),
          row([`${cmd}/`], t('sc_h_help')),
          row([t('sc_esc')], t('sc_h_esc')))));
  }
  return {
    seen,
    /** The switcher (while held, after the short delay) or the help, else null. */
    el(): HTMLElement | null { return sw && shown ? switcherEl(sw) : help ? helpEl() : null; },
  };
}
