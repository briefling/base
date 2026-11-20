// Long brief on a « Thread proposed » card: folded to its first lines with a « See the whole brief » link.
// Decided from the text, not measured in the DOM (render builds the tree before layout): each source line counts as
// many display lines as it wraps to at ~COLS characters (the card is ~570 px wide at 13.5 px), blank lines count.

export const BRIEF_COLS = 80;

/**
 * Label of a card (thread, issue, plan) folded to one read-only line: `dismissed` (its own « … dismissed: » key) when a
 * human clicked Not now, « Replaced: » when the agent proposed a newer card in the conversation; null while it is live.
 */
export function offCardLabel<K extends string>(status: string, dismissed: K): K | 'card_superseded' | null {
  return status === 'dismissed' ? dismissed : status === 'superseded' ? 'card_superseded' : null;
}
/**
 * Label of a brief draft card (`about`) folded to one read-only line: « Brief applied: » once an admin saved the brief
 * from it, « Replaced: » when a newer draft of the same conversation was applied; null while it is live.
 */
export function aboutFold(m: { id: string; about?: { applied?: unknown } }, all: readonly { id: string; type: string; about?: { applied?: unknown } }[]): 'about_card_applied' | 'card_superseded' | null {
  if (m.about?.applied) return 'about_card_applied';
  return all.some(x => x.type === 'about' && x.id > m.id && x.about?.applied) ? 'card_superseded' : null;
}
/** Lines shown folded; a brief only folds when it is clearly longer (no link that reveals one more line). */
export const BRIEF_SHOWN = 8;
export const BRIEF_FOLD_AT = 11;

/** Estimated display lines of a Markdown brief. */
export function briefLines(text: string, cols = BRIEF_COLS): number {
  return text.trim().split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / cols)), 0);
}

export function foldsBrief(text: string): boolean {
  return briefLines(text) >= BRIEF_FOLD_AT;
}
