// Rules of the "Board" view (formerly "Suivi"), DOM-free so node can test them.
// Board = items of the GitHub Project linked to the space that have no thread, grouped by status. Threads stay
// in the space view (with their #N tag): no duplicate between the two views.
import type { GhSnapshot, PublicThread } from '../../protocol/frames.ts';

type GhItem = GhSnapshot['items'][number];

/** A board-driven thread Quiet whose OPEN issue sits in one of the flow's work columns (`synced.workColumns`): shown In
 *  progress, its column as chip. Display only (the hub state, notifications and metrics stay Quiet). Case-insensitive
 *  like GitHub's names. */
export const boardWorking = (f: Pick<PublicThread, 'state' | 'board'>, cols: readonly string[] | undefined): boolean => {
  const c = f.board?.state === 'OPEN' ? f.board.column?.toLowerCase() : undefined;
  return f.state === 'calm' && !!c && !!cols?.some(x => x.toLowerCase() === c);
};

/** Display mode of the Board, remembered per space and per device (localStorage). */
export type BoardMode = 'list' | 'columns';
export const boardModeKey = (space: string) => `briefling.board.${space}`;
/** Stored value -> mode; anything unknown (absent, old, tampered) = list. */
export const parseBoardMode = (v: string | null | undefined): BoardMode => v === 'columns' ? 'columns' : 'list';

/** Labels of an item with their colour (null = none or not 6 hex digits: the colour becomes a CSS rule, checked again here). */
export function itemLabels(i: Pick<GhItem, 'labels' | 'labelColors'>): { name: string; color: string | null }[] {
  return (i.labels ?? []).map((name, k) => {
    const c = i.labelColors?.[k] ?? '';
    return { name, color: /^[0-9a-f]{6}$/.test(c) ? c : null };
  });
}

/** WCAG relative luminance of a 6-digit hex colour. */
function luminance(hex: string): number {
  const ch = [0, 2, 4].map(k => parseInt(hex.slice(k, k + 2), 16) / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
export const LABEL_DARK = '1f2328', LABEL_LIGHT = 'ffffff';
/** Text colour for a label filled with `hex`: dark or white, whichever contrasts more (WCAG ratio). */
export function labelInk(hex: string): string {
  const l = luminance(hex), ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  return ratio(l, luminance(LABEL_DARK)) >= ratio(l, 1) ? LABEL_DARK : LABEL_LIGHT;
}

/** A board is linked: snapshot received, or linked repos (the hub only sends them if the space has a `github`). */
export function hasBoard(gh: GhSnapshot | null | undefined, repos: readonly string[] | undefined): boolean {
  return !!gh || !!repos?.length;
}

/** Open items without a thread (a thread of the space, archived included, linked to the same issue URL covers them), grouped
 *  by status in the Project's order of appearance; the no-status group (key '', labelled by the view) comes last. */
export function boardGroups(gh: GhSnapshot | null | undefined, threads: readonly PublicThread[], all = false): [string, GhItem[]][] {
  // all (board-driven space): every open item, each linked to its thread (`item.thread`); otherwise only those without one.
  const linked = new Set(all ? [] : threads.map(f => f.issue?.url).filter(Boolean));
  const groups = new Map<string, GhItem[]>();
  for (const i of gh?.items ?? []) {
    if ((i.url && linked.has(i.url)) || i.state === 'CLOSED' || i.state === 'MERGED') continue;
    const st = i.status ?? '';
    groups.set(st, [...(groups.get(st) ?? []), i]);
  }
  const none = groups.get('');
  groups.delete('');
  const out = [...groups];
  if (none) out.push(['', none]);
  return out;
}

/** List mode reads top-down from the most advanced status: the Project's order reversed (To merge first, Backlog last),
 *  the no-status group still last, next to Backlog. Columns keep the Project's order (a kanban reads left to right). */
export function listGroups<T>(groups: readonly [string, T][]): [string, T][] {
  const statuses = groups.filter(([st]) => st !== '').reverse();
  return [...statuses, ...groups.filter(([st]) => st === '')];
}
