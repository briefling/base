// Desktop keyboard shortcuts: the switcher of recent conversations (Ctrl+Tab or ⌥Tab held, every
// space, like Slack or Arc), ⌘1…9 for the n-th space of the sidebar, ⌘/ for the help. Pure rules here (the list of
// recents, which key does what, the switcher's moves), the view and listeners in client/src/shortcutsview.ts.
// Both Ctrl+Tab and ⌥Tab are taken: Chrome may keep Ctrl+Tab for itself even in an installed app window, and on
// Windows/Linux the OS keeps Alt+Tab, so each platform gets the one that reaches the page.

/** Conversations kept in the browser, most recent first; the switcher shows the first SWITCH_SHOWN still known. */
export const MRU_KEEP = 20;
export const SWITCH_SHOWN = 8;

/** The conversation just opened goes first, once. */
export function bumpMru(list: readonly string[], id: string, keep = MRU_KEEP): string[] {
  return [id, ...list.filter(x => x !== id)].slice(0, keep);
}

/** Stored list (localStorage), anything unexpected read as empty. */
export function parseMru(raw: string | null): string[] {
  try {
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length < 200).slice(0, MRU_KEEP) : [];
  } catch { return []; }
}

/** The fields of a KeyboardEvent the rules read. */
export interface Keys { key: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean; shiftKey: boolean }
export type SwitchMod = 'Control' | 'Alt';

/** Tab with Ctrl or ⌥ (alone, Shift allowed to go back): the modifier that holds the switcher open. */
export function switchMod(e: Keys): SwitchMod | null {
  if (e.key !== 'Tab' || e.metaKey || e.ctrlKey === e.altKey) return null;
  return e.ctrlKey ? 'Control' : 'Alt';
}

/** The platform's command key alone (⌘ on a Mac, Ctrl elsewhere), Shift allowed when `shift`. */
const cmdOnly = (e: Keys, mac: boolean, shift = false) =>
  (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.altKey && (shift || !e.shiftKey);

/** ⌘1…⌘9: index (0-8) of the space of the sidebar, null for any other key. */
export function spaceIndex(e: Keys, mac: boolean): number | null {
  return cmdOnly(e, mac) && /^[1-9]$/.test(e.key) ? Number(e.key) - 1 : null;
}

/** ⌘/ (Shift allowed: on an AZERTY Mac « / » is Shift+:). */
export const isHelp = (e: Keys, mac: boolean) => cmdOnly(e, mac, true) && e.key === '/';

/** The switcher while its modifier is held: the conversations offered and the one selected. */
export interface Switch { ids: string[]; i: number; mod: SwitchMod }

/** First Tab: the known conversations of the list (`open` = the one on screen). From a conversation the selection
 *  starts on the previous one, so a quick press-release goes back and forth between the last two; from elsewhere
 *  (Now, a list) on the last one. Shift starts from the end. Null when there is nothing to switch to. */
export function startSwitch(mru: readonly string[], known: (id: string) => boolean, open: string | null, mod: SwitchMod, back: boolean): Switch | null {
  const ids = mru.filter(known).slice(0, SWITCH_SHOWN);
  const first = ids[0] === open ? 1 : 0;
  if (ids.length <= first) return null;
  return { ids, mod, i: back ? ids.length - 1 : first };
}

/** Another Tab while held: next one, or previous with Shift, wrapping around. */
export function stepSwitch(s: Switch, back: boolean): Switch {
  const n = s.ids.length;
  return { ...s, i: (s.i + (back ? n - 1 : 1)) % n };
}
