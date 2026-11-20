import type { AskItem } from '../../protocol/frames.ts';

// Answered question card: which option the answer picked, or the free text when it matches none.

export type AskChoice = { index: number } | { free: string };

// Exact match first (the option buttons send the option verbatim), then trimmed and case-insensitive
// (an answer typed by hand that repeats an option). An empty answer matches nothing and stays free.
export function askChoice(options: readonly string[], answer: string): AskChoice {
  const exact = options.indexOf(answer);
  if (exact >= 0) return { index: exact };
  const norm = (s: string) => s.trim().toLocaleLowerCase();
  const loose = answer.trim() ? options.findIndex(o => norm(o) === norm(answer)) : -1;
  return loose >= 0 ? { index: loose } : { free: answer.trim() };
}

/** Past-tense status of the exec approval options (the plugin's four buttons), as i18n keys. */
export const ASK_PAST = { Approve: 'ask_past_approve', 'For this session': 'ask_past_session', Always: 'ask_past_always', Deny: 'ask_past_deny' } as const;
export type AskPastKey = typeof ASK_PAST[keyof typeof ASK_PAST];
/** What an answered card shows: the approval option in the past tense, else the choice (or free text) as is;
 *  `ok` false only for a denial (red cross instead of the green tick). */
export type AskDone = { past: AskPastKey; ok: boolean } | { text: string; ok: true };
export function askDone(options: readonly string[], answer: string): AskDone {
  const c = askChoice(options, answer);
  const text = 'index' in c ? options[c.index] : c.free;
  const past = Object.hasOwn(ASK_PAST, text) ? ASK_PAST[text as keyof typeof ASK_PAST] : null;
  return past ? { past, ok: past !== 'ask_past_deny' } : { text, ok: true };
}

// « To decide » card (protocol AskItem): one pick per point, the composed answer, and its reading back.

export const ASK_ARROW = ' → ';
/** A pick: a choice's index, or the « Other » text (kept even empty while typed). */
export type AskPick = { choice: number } | { other: string };

/** Starting picks: each point's recommended choice (the first), so agreeing with the agent is one click. */
export const askStart = (items: readonly AskItem[]): AskPick[] => items.map(() => ({ choice: 0 }));

/** The answer sent to the agent, one « label → choice » line per point; null while an « Other » is empty. */
export function askAnswerText(items: readonly AskItem[], picks: readonly AskPick[]): string | null {
  const lines: string[] = [];
  for (const [i, it] of items.entries()) {
    const p = picks[i] ?? { choice: 0 };
    const v = 'other' in p ? p.other.replace(/\s+/g, ' ').trim() : it.options[p.choice];
    if (!v) return null;
    lines.push(it.label + ASK_ARROW + v);
  }
  return lines.join('\n');
}

/** Per point, the answer's value (its line « label → value »), or null when the answer has no line for it. */
export function askAnswered(items: readonly AskItem[], answer: string): (string | null)[] {
  const lines = answer.split('\n');
  return items.map(it => {
    const l = lines.find(x => x.startsWith(it.label + ASK_ARROW));
    return l ? l.slice(it.label.length + ASK_ARROW.length).trim() || null : null;
  });
}
