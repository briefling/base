// Client side of the space modules that live in their own files (hub/src/modules.ts for the hub): one small interface,
// so a module brings its view, its sidebar entry, its frames and its conversation card without growing main.ts. main.ts
// hands each module a UiKit (its DOM helpers and state readers) and calls the hooks below: the reminders
// (client/src/remindersview.ts), the pending leads (client/src/leadsview.ts), then the memory (client/src/memoryview.ts, always on: no `module`). The ids double as
// route segments (`#/<space>/<id>`) and view kinds (route.ts).
// Pure types and ids only: DOM-free, imported by route.ts and the tests.
import type { HubFrame, Message, Person, PublicThread } from '../../protocol/frames.ts';
import type { Module } from '../../protocol/modules.ts';
import type { Key, PluralBase } from './i18n.ts';

export const MODULE_VIEWS = ['reminders', 'memory', 'leads'] as const;
export type ModuleView = typeof MODULE_VIEWS[number];
export const isModuleView = (x: unknown): x is ModuleView => typeof x === 'string' && (MODULE_VIEWS as readonly string[]).includes(x);

type Child = Node | string | null | false | undefined;
/** What main.ts lends a module: its element builder, icons, strings, hub requests and read-only state. */
export interface UiKit {
  h(tag: string, attrs?: Record<string, any>, ...kids: Child[]): HTMLElement;
  icon(name: string, size?: number): SVGSVGElement;
  t(key: Key, params?: Record<string, string | number>): string;
  tn(base: PluralBase, n: number, params?: Record<string, string | number>): string;
  render(): void;
  /** A hub request answered by its `client_id` (null: timeout or offline); `raw` keeps an `error` answer. */
  request(f: { type: string; [k: string]: unknown }, ms?: number, raw?: boolean): Promise<HubFrame | null>;
  /** Text of a hub refusal code (`err_<code>` or the generic one). */
  errText(code: string): string;
  me(): string;
  /** Humans and agents of a space (directory sent at sync). */
  people(space: string): Person[];
  spaceName(space: string): string;
  /** The phone's menu button (opens the sidebar drawer), first child of a view's header. */
  menuBtn(): HTMLElement;
  /** Band at the top of a conversation card (icon, label, sub-label). */
  cardBand(icon: string, label: string, sub: string): HTMLElement;
  /** Primary button label followed by an arrow. */
  go(label: string): Child[];
  /** Opens a view of the app (another module, the threads…). */
  open(space: string, view: ModuleView): void;
  /** A frame to the hub (`v` added); offline: false, with the offline error on screen. */
  send(f: object): boolean;
  /** Same without the offline error (a read asked from a render): false when not sent. */
  post(f: { type: string; [k: string]: unknown }): boolean;
  /** « 5 min ago »-style age of a timestamp (ms). */
  since(ts: number): string;
  /** « 5 min » / « 3 h » / « 2 d »-style age of a timestamp (ms). */
  ago(ts: number): string;
  /** Photo of a person ('' = none: the initial is shown); an agent is looked up in `space` when given. */
  personAvatar(id: string, kind: string, space?: string): string;
  /** Text after an icon. */
  withIcon(name: string, text: string, size?: number): HTMLElement;
  /** Display name of a person of any space (null: unknown). */
  personName(id: string): string | null;
  /** I am trusted (lead) in the space. */
  trusted(space: string): boolean;
  /** Title of a known thread or topic. */
  threadTitle(id: string): string | undefined;
  /** A thread or topic the tab knows (visible to me), undefined otherwise. */
  thread(id: string): PublicThread | undefined;
  /** Opens a conversation, on a message when given (flash, like a search result). */
  goMessage(thread: string, msg: string | null): void;
  /** A module of the space is on (protocol/modules.ts): « threads » off hides what would open a thread. */
  modOn(space: string, m: Module): boolean;
}

export interface ClientModule {
  view: ModuleView;
  /** Module of the space settings that turns it on (protocol/modules.ts); none = always on (memory). */
  module?: Module;
  icon: string;
  label: Key;
  /** Sidebar badge (e.g. what is due today for me), undefined = none. */
  badge(space: string): number | undefined;
  /** Sidebar entry only while this says so; absent = always. */
  shown?(space: string): boolean;
  /** The space synced (each connection): load what the badge and the view need. */
  synced(space: string): void;
  /** The view of a space, built on each render. */
  el(space: string): HTMLElement;
  /** Left the view (another view on screen): drop transient state. */
  leave?(): void;
  /** A hub frame (event or answer) for this module: true = handled (the caller renders). */
  frame(f: HubFrame): boolean;
  /** Its conversation card (a message of this type posted by an agent). */
  card?: { type: Message['type']; el(m: Message, th: PublicThread): HTMLElement };
}
