/**
 * Modules of a space (Blair, Nov 2026): the admin turns sections on or off per space, so a space about anything else
 * than software (family, a company's admin) is not cluttered with code tools. Topics, memory, routines and voice are
 * always there; the modules below are optional. « threads » off: no new thread (no card, plan, signal, request or
 * applet run opens one), the existing ones stay listed and open; a topic keeps its Lounge rules (no commit, deploy
 * nor shared resource) all the same. « general » off: the space's entry shows its topics (Recents) instead of the
 * Lounge's General feed, and nobody posts there. A module turned off hides its section in the client and its
 * instructions to the agents (the hub stops sending that context and refuses the matching agent frames).
 *
 * Stored as the list of modules turned OFF (`Space.modulesOff`): a space saved before modules existed, or a module
 * added later, is on by default, so nothing changes for the existing spaces. Exception: the OPT_IN modules (made for
 * personal spaces, e.g. reminders) are off unless turned on, stored as `Space.modulesIn`, so they never appear in an
 * existing software space by themselves. On the wire (`SpaceSettings.modules`, `SpaceInfo.modules`,
 * `space.save.modules`) the list of modules turned ON.
 */
export const MODULES = ['threads', 'general', 'board', 'ci', 'code', 'radar', 'lineage', 'metrics', 'exchanges', 'reminders'] as const;
export type Module = typeof MODULES[number];
export const isModule = (x: unknown): x is Module => typeof x === 'string' && (MODULES as readonly string[]).includes(x);
/** Modules off unless turned on (missing from the stored lists = off). */
export const OPT_IN: readonly Module[] = ['reminders'];
const optIn = (m: Module) => OPT_IN.includes(m);

/** A list of modules as a frame may carry it: known names, no duplicate. */
export const validModules = (x: unknown): x is Module[] =>
  Array.isArray(x) && x.length <= MODULES.length && x.every(isModule) && new Set(x).size === x.length;

/** Modules turned on, in MODULES order, from the stored lists (missing = every module on except the opt-in ones). */
export const modulesOn = (off?: readonly string[], on?: readonly string[]): Module[] =>
  MODULES.filter(m => optIn(m) ? (on ?? []).includes(m) : !(off ?? []).includes(m));
/** The stored « off » list (regular modules) from the modules turned on. */
export const modulesOffOf = (on: readonly Module[]): Module[] => MODULES.filter(m => !optIn(m) && !on.includes(m));
/** The stored « in » list (opt-in modules turned on) from the modules turned on. */
export const modulesInOf = (on: readonly Module[]): Module[] => MODULES.filter(m => optIn(m) && on.includes(m));
/** Is this module on? `modules` missing (an older hub or a space never set) = every regular module on, opt-in ones off. */
export const moduleOn = (modules: readonly Module[] | undefined, m: Module): boolean => modules ? modules.includes(m) : !optIn(m);
/** The stored lists differ from the default (every regular module on, no opt-in one): the hub then sends `modules`. */
export const modulesSet = (off?: readonly string[], on?: readonly string[]): boolean => !!(off?.length || on?.length);

/**
 * Presets: one click turns a set of modules on, each module stays adjustable after. « Software » = every regular
 * module; « Personal » = topics, memory, routines and voice, plus the reminders (no thread, no General feed).
 */
export const PRESETS = { software: MODULES.filter(m => !optIn(m)), personal: ['reminders'] } as const satisfies Record<string, readonly Module[]>;
export type Preset = keyof typeof PRESETS;
export const PRESET_NAMES = Object.keys(PRESETS) as Preset[];
/** The preset the modules match exactly, `custom` otherwise. */
export const presetOf = (on: readonly Module[]): Preset | 'custom' =>
  PRESET_NAMES.find(p => PRESETS[p].length === on.length && PRESETS[p].every(m => on.includes(m))) ?? 'custom';
