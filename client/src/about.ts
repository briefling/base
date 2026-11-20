// "Draft with the agent" for the space description (`about`), DOM-free so node can test it (client/test/about.test.ts).
// The agent only proposes (a card in a Lounge topic); the admin applies the draft to the Settings form and saves.
import { t } from './i18n.ts';

export const MAX_DRAFT_REPOS = 10;
const PART_RE = /^[A-Za-z0-9_.-]{1,100}$/;

/**
 * GitHub repo URLs typed one per line -> canonical `https://github.com/<owner>/<repo>` (deduplicated), and the lines
 * that are not one. Parsed with the browser's URL parser, https and github.com only: the agent clones what it gets.
 */
export function parseRepos(text: string): { repos: string[]; bad: string[] } {
  const repos: string[] = [], bad: string[] = [];
  for (const line of text.split('\n').map(x => x.trim()).filter(Boolean)) {
    let u: URL | null = null;
    try { u = new URL(line); } catch { /* not a URL */ }
    const parts = u ? u.pathname.replace(/\/+$/, '').replace(/\.git$/, '').split('/').filter(Boolean) : [];
    const ok = !!u && u.protocol === 'https:' && (u.hostname === 'github.com' || u.hostname === 'www.github.com') && !u.username && !u.password
      && parts.length >= 2 && PART_RE.test(parts[0]) && PART_RE.test(parts[1]) && !parts[0].startsWith('.') && !parts[1].startsWith('.');
    if (!ok) { bad.push(line); continue; }
    const canon = `https://github.com/${parts[0]}/${parts[1]}`;
    if (!repos.some(r => r.toLowerCase() === canon.toLowerCase())) repos.push(canon);
  }
  return { repos, bad };
}

/** Topic message that asks the agent in charge for a draft (UI language: the team reads it in the Lounge). */
export function draftRequest(agent: string, repos: string[], notes: string, update: boolean): string {
  const lines = [t('about_req', { agent: `@${agent}` })];
  if (update) lines.push(t('about_req_update'));
  if (repos.length) lines.push('', t('about_req_repos'), ...repos.map(r => `- ${r}`));
  if (notes.trim()) lines.push('', t('about_req_notes'), notes.trim());
  return lines.join('\n');
}

export type DiffLine = { op: '=' | '+' | '-'; text: string };

/**
 * Line diff (longest common subsequence) between the description the draft was written against and the draft.
 * Over LCS_MAX cells (very long texts), everything old is removed and everything new added: still correct, less precise.
 */
const LCS_MAX = 250_000;
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before ? before.split('\n') : [], b = after ? after.split('\n') : [];
  if (a.length * b.length > LCS_MAX) return [...a.map(text => ({ op: '-' as const, text })), ...b.map(text => ({ op: '+' as const, text }))];
  // len[i][j] = LCS length of a[i..] and b[j..]
  const len = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    len[i][j] = a[i] === b[j] ? len[i + 1][j + 1] + 1 : Math.max(len[i + 1][j], len[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ op: '=', text: a[i] }); i++; j++; }
    else if (len[i + 1][j] >= len[i][j + 1]) out.push({ op: '-', text: a[i++] });
    else out.push({ op: '+', text: b[j++] });
  }
  while (i < a.length) out.push({ op: '-', text: a[i++] });
  while (j < b.length) out.push({ op: '+', text: b[j++] });
  return out;
}
