// CI follow-up display (docs/design-ci-feedback.md, slice 1): the dot of a thread (list, header) and the CI line.
// DOM-free so node can test it (client/test/ci.test.ts). Check names are CI-written text: rendered as text, never Markdown.
import { REPO_RE, SHA_RE, type CiPill, type CiReport, type CiVerdict } from '../../protocol/frames.ts';
import { t, tn, type Key } from './i18n.ts';

/** Colour of a dot: red, running (hollow), green, or grey (no CI, cancelled, never finished, unknown, commit missing). */
export type CiTone = 'red' | 'run' | 'green' | 'grey';
export const ciTone = (v: CiVerdict): CiTone => v === 'red' ? 'red' : v === 'running' ? 'run' : v === 'green' ? 'green' : 'grey';
const RANK: Record<CiTone, number> = { red: 0, run: 1, grey: 2, green: 3 };
/** The pill a thread shows: the worst one (red first, then running, grey, green), the most recent on a tie. */
export function ciWorst(pills: readonly CiPill[] | undefined): CiPill | null {
  if (!pills?.length) return null;
  return [...pills].sort((a, b) => RANK[ciTone(a.verdict)] - RANK[ciTone(b.verdict)] || b.at - a.at)[0];
}
export const ciRunning = (pills: readonly CiPill[] | undefined) => !!pills?.some(p => p.verdict === 'running');
export const ciRef = (p: { repo: string; sha: string }) => `${p.repo.split('/')[1] ?? p.repo}@${p.sha.slice(0, 7)}`;
/** Commit page on GitHub, built here from validated values (never a URL received from the CI). */
export const commitUrl = (p: { repo: string; sha: string }) => REPO_RE.test(p.repo) && SHA_RE.test(p.sha) ? `https://github.com/${p.repo}/commit/${p.sha}` : null;

/** One tooltip line per repo: « CI passed · loom@58b07b1 · 14 checks ». */
export function ciTipLine(p: CiPill): string {
  const parts = [t(`ci_${p.verdict}` as Key), ciRef(p)];
  if (p.verdict === 'unknown' && p.reason) parts.push(t(`ci_reason_${p.reason}` as Key));
  else if (p.n) parts.push(p.failed ? t('ci_failed_of', { failed: p.failed, n: p.n }) : tn('ci_checks', p.n));
  return parts.join(' · ');
}
export const ciTip = (pills: readonly CiPill[]) => [...pills].sort((a, b) => RANK[ciTone(a.verdict)] - RANK[ciTone(b.verdict)]).map(ciTipLine).join('\n');

/** Head of the CI line, translated: the commit reference is inserted by the caller (a link). */
export function ciLineParts(r: CiReport): { before: string; after: string } {
  const key: Key = r.verdict === 'red' ? 'ci_line_red' : r.verdict === 'timeout' ? 'ci_line_timeout' : 'ci_line_missing';
  const [before, after = ''] = t(key, { ref: '\u0000' }).split('\u0000');
  return { before, after };
}
/** Under a red line: « 1 passed » and « and 2 more » (the listed checks come first). */
export function ciLineTail(r: CiReport): string[] {
  return r.verdict !== 'red' ? [] : [...(r.more ? [t('ci_more', { n: r.more })] : []), tn('ci_passed', r.passed)];
}
/** A check link kept only on github.com (the hub already drops the others: defence in depth). */
export const checkUrl = (u: string | undefined) => u && /^https:\/\/github\.com\//.test(u) ? u : null;
