// Labels of an issue thread (board-driven space, docs/design-external-board.md § 4.5): who may edit them, what the
// picker offers. Display only: the hub and the GitHub Lambda check everything again.
import { VETTING_LABEL, type PublicThread, type RepoLabel } from '../../protocol/frames.ts';

export const sameLabel = (a: string, b: string) => a.toLowerCase() === b.toLowerCase(); // GitHub names are case-insensitive
/** `needs:vetting` is unstrikeable's: shown, never editable (a member's comment on GitHub is the go). */
export const fixedLabel = (l: string) => sameLabel(l, VETTING_LABEL);

/** A trusted human, in a thread bound to an issue of a board-driven space. */
export function canEditLabels(f: Pick<PublicThread, 'kind' | 'issue' | 'board'>, boardDriven: boolean, trusted: boolean): boolean {
  return boardDriven && trusted && f.kind !== 'topic' && !!f.issue && !!f.board;
}

/** Labels of the repo the picker offers: not already on the issue, never `needs:vetting`, sorted by name. */
export function pickable(repo: readonly RepoLabel[], onIssue: readonly string[]): RepoLabel[] {
  return repo.filter(l => !fixedLabel(l.name) && !onIssue.some(x => sameLabel(x, l.name))).sort((a, b) => a.name.localeCompare(b.name));
}
