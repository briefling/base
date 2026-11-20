// Board-driven space (docs/design-external-board.md): one thread per open issue of the GitHub Project, GitHub content
// copied as read-only cards. Read-only on GitHub. Run by the poller (GitHub Lambda, every 5 min if a human is connected).
// Trust and vetting follow unstrikeable (backends/github.py `_trusted`, events.py `needs_vetting`) on purpose: one
// definition of an outsider for both tools.
import { GH_CARD_MAX, VETTING_LABEL, type IssueBoard, type Message, type GhCard } from '../../protocol/frames.ts';
import { broadcast, mutateThread, publicThread, reposOf, type Deps, type Space } from './router.ts';
import { visibleAgents, type BackstageOf } from '../../protocol/memory.ts';
import { computeState } from './state.ts';
import type { BoardIssue, GhPost, GitHub, IssueDetail } from './github.ts';

type JobDeps = Deps & { gh: GitHub };
type StoredThread = NonNullable<Awaited<ReturnType<Deps['store']['getThread']>>>;

export { VETTING_LABEL };
/** The briefling App: an issue it created comes from a trusted human of briefling (`→ Issue`). */
// Its login comes from `GITHUB_APP_LOGIN` (set at deploy); unset = no App, nothing is trusted by that name.
export const appLogin = (): string => process.env.GITHUB_APP_LOGIN ?? '';
const TRUSTED_ASSOC = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const PLATFORM_BOTS = new Set(['github-actions']); // the repo's own workflows: not outside content, not a human
const AGENT_MARK = /<!-- (?:uns|gha):agent=([A-Za-z0-9_-]{1,32}) -->/;
const STATUS_MARK = /<!-- (?:uns|gha):status /;
/** Issues whose detail (body, comments, PRs) is read per poll at most; the rest waits for the next poll. */
export const DETAIL_MAX = 60;

/**
 * Version of the card format: bumping it rewrites every card at the next poll (it is in the fingerprint, so every
 * issue is re-read, and in `rev`, so the conditional write accepts the new text). 1: HTML comments stripped.
 */
export const CARD_FORMAT = 1;
/** Fingerprint of what the detail depends on: the issue moved (comment, edit, label, state) or a linked PR changed. */
export const sigOf = (i: BoardIssue) => `${CARD_FORMAT}|${i.updatedAt}|${i.prs.join(',')}`;
export const issueKey = (repo: string, number: number) => `${repo}#${number}`;

/** Agent in charge: the agent named by an assignment label (`dev:gideon`) if it is an agent of the space (never its
 *  backstage memory agent), else the space's. */
export function ownerOf(labels: string[], space: BackstageOf): string {
  const agents = visibleAgents(space);
  for (const l of labels) {
    const m = /^[^:\s]+:([a-z][a-z0-9_-]{0,31})$/.exec(l);
    if (m && agents.includes(m[1])) return m[1];
  }
  return space.defaultAgent;
}

/** Trusted author: org member or collaborator, an agent identity, the briefling App, a platform bot, or a repo writer. */
export function makeTrust(gh: GitHub, identities: string[]) {
  const ids = new Set(identities.map(x => x.toLowerCase()));
  const writers = new Map<string, Promise<boolean>>(); // per poll: one permission call per (repo, login)
  return {
    ids,
    async trusted(repo: string, login: string, assoc: string): Promise<boolean> {
      if (TRUSTED_ASSOC.has(assoc) || ids.has(login) || (!!appLogin() && login === appLogin()) || PLATFORM_BOTS.has(login)) return true;
      if (!login) return false; // deleted account
      const k = `${repo}|${login}`;
      if (!writers.has(k)) writers.set(k, gh.canWrite(repo, login));
      return writers.get(k)!;
    },
  };
}
type Trust = ReturnType<typeof makeTrust>;

const ms = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : 0; };
/** Card id: the GitHub date first (message ids are time-sortable, they order the thread), then a stable suffix (idempotent). */
export const cardId = (iso: string, tag: string) => `${ms(iso).toString(36).padStart(8, '0')}gh${tag}`;

/**
 * Vetting as unstrikeable computes it, stricter on edits: content written by an outsider (issue body, comment, linked
 * PR; an edit counts as new content) more recent than the last member's go (a trusted human's comment, not an agent's
 * nor a status line). `needs:vetting` on the issue also counts (set by unstrikeable). `held(post)`: an outsider's
 * content that must not reach the agents now.
 */
export async function vet(issue: BoardIssue, d: IssueDetail, trust: Trust) {
  const t = (login: string, assoc: string) => trust.trusted(issue.repo, login, assoc);
  const author = await t(issue.author, issue.assoc);
  const posts = [...d.comments.map(c => ({ c, kind: 'comment' as const })), ...d.prs.map(c => ({ c, kind: 'pr' as const }))];
  const ok = new Map<GhPost, boolean>();
  for (const { c } of posts) ok.set(c, await t(c.login, c.assoc));
  const isGo = (c: GhPost) => ok.get(c) && !trust.ids.has(c.login) && c.login !== appLogin() && !PLATFORM_BOTS.has(c.login) && !AGENT_MARK.test(c.body) && !STATUS_MARK.test(c.body);
  const go = posts.filter(p => p.kind === 'comment' && isGo(p.c)).reduce((a, p) => p.c.createdAt > a ? p.c.createdAt : a, '');
  const outside = [...(author ? [] : [d.editedAt > d.createdAt ? d.editedAt : d.createdAt]), ...posts.filter(p => !ok.get(p.c)).map(p => p.c.updatedAt)];
  const outsiderAt = outside.reduce((a, x) => x > a ? x : a, '');
  const label = issue.labels.includes(VETTING_LABEL);
  return {
    author, vetting: label || outsiderAt > go,
    heldBody: !author && (label || (d.editedAt > d.createdAt ? d.editedAt : d.createdAt) > go),
    held: (c: GhPost) => !ok.get(c) && (label || c.updatedAt > go),
    trusted: (c: GhPost) => !!ok.get(c),
  };
}

/** GitHub hides HTML comments (agent and status markers, issue templates): so does the card, then the length bound. */
const cut = (raw: string) => {
  const text = raw.replace(/<!--[\s\S]*?(?:-->|$)/g, '').trim();
  return text.length > GH_CARD_MAX ? { text: text.slice(0, GH_CARD_MAX), cut: true } : { text, cut: false };
};

/** The cards of an issue (body, comments, linked PRs) as thread messages. `rev` grows with the GitHub edit and when a held card is released. */
function ghCard(thread: string, id: string, at: string, upd: string, text: string, gh: GhCard): Message {
  const c = cut(text);
  return { id, thread, author: { kind: 'system', id: 'github' }, type: 'github', text: c.text, at: ms(at),
    // rev grows with the GitHub edit, the card format, and when a held card is released (never the other way without an edit).
    rev: ms(upd) * 8 + CARD_FORMAT * 2 + (gh.held ? 0 : 1), gh: { ...gh, ...(c.cut ? { cut: true } : {}) } };
}

/** Body card of an issue the briefling App just created: same id and rev as the poller's, so its next pass rewrites nothing. */
export const createdBodyCard = (thread: string, number: number, url: string, createdAt: string, body: string): Message =>
  ghCard(thread, cardId(createdAt, `i${number}`), createdAt, createdAt, body, { kind: 'issue', login: appLogin(), url });

export function cardsOf(thread: string, issue: BoardIssue, d: IssueDetail, v: Awaited<ReturnType<typeof vet>>): Message[] {
  const card = (id: string, at: string, upd: string, text: string, gh: GhCard) => ghCard(thread, id, at, upd, text, gh);
  const strip = (g: GhCard): GhCard => Object.fromEntries(Object.entries(g).filter(([, x]) => x !== undefined && x !== false)) as GhCard;
  const out = [card(cardId(d.createdAt, `i${issue.number}`), d.createdAt, d.editedAt, d.body,
    strip({ kind: 'issue', login: issue.author, url: issue.url, held: v.heldBody }))];
  for (const c of d.comments) {
    const agent = v.trusted(c) ? AGENT_MARK.exec(c.body)?.[1] : undefined; // an outsider cannot pass for an agent
    out.push(card(cardId(c.createdAt, `c${c.id}`), c.createdAt, c.updatedAt, c.body,
      strip({ kind: 'comment', login: c.login, url: c.url || issue.url, held: v.held(c), agent: agent?.toLowerCase() })));
  }
  for (const p of d.prs) out.push(card(cardId(p.createdAt, `p${p.id}`), p.createdAt, p.updatedAt, '',
    strip({ kind: 'pr', login: p.login, url: p.url, held: v.held(p), state: p.state, title: p.title })));
  return out;
}

/** Writes the cards that are new or changed (idempotent: same rev = nothing), broadcasts them. Returns how many changed. */
async function putCards(deps: JobDeps, space: string, cards: Message[]): Promise<number> {
  let n = 0;
  for (const m of cards) {
    const old = await deps.store.getMessage(m.thread, m.id);
    if (old && (old.rev ?? 0) >= (m.rev ?? 0)) continue;
    const r = await deps.store.upsertMessage(m);
    if (!r) continue; // a concurrent poll wrote it first
    n++;
    await broadcast(deps, space, { v: 2, type: 'event', event: old ? 'message.updated' : 'message.created', data: r.message });
  }
  return n;
}

/** Key order free: DynamoDB gives the map back with its keys sorted, not in the order the poller builds it,
 *  so a plain JSON.stringify compare saw every issue thread as changed and rewrote it on every poll. */
function sameBoard(a: IssueBoard | undefined, b: IssueBoard): boolean {
  const canon = (x: IssueBoard) => JSON.stringify(Object.entries(x).filter(([, v]) => v !== undefined).sort(([k], [l]) => k < l ? -1 : 1));
  return !!a && canon(a) === canon(b);
}

/**
 * Syncs the issues of a board-driven space with their threads. New open issue: thread if its author is trusted, or once
 * the vetting is lifted (import = the same rule on the first poll). Existing thread: title, agent in charge (assignment
 * label; never changed mid-turn), column, labels, closed / reopened, and the cards when the issue moved.
 * Returns issue key -> thread id (the Board links each item to its thread).
 */
export async function syncIssues(deps: JobDeps, space: Space, issues: BoardIssue[]): Promise<Map<string, string>> {
  const owner = space.github!.owner;
  const index = await deps.store.issueThreads(space.id);
  const links = new Map(Object.entries(index));
  const todo: { issue: BoardIssue; thread: StoredThread | null; detail: boolean }[] = [];
  for (const issue of issues) {
    if (!reposOf(space).includes(issue.repo)) continue; // only the attached repos
    const id = index[issueKey(issue.repo, issue.number)];
    const thread = id ? await deps.store.getThread(id) : null;
    if (thread && thread.space !== space.id) continue;
    if (!thread && issue.state !== 'OPEN') continue; // closed issues never get a thread
    todo.push({ issue, thread, detail: !thread || thread.board?.sig !== sigOf(issue) });
  }
  const want = todo.filter(x => x.detail).slice(0, DETAIL_MAX).map(x => x.issue.node);
  const details = new Map((want.length ? await deps.gh.issueDetails(owner, want) : []).map(d => [d.node, d]));
  const trust = makeTrust(deps.gh, space.identities ?? []);
  for (const { issue, thread: found, detail } of todo) {
    const d = detail ? details.get(issue.node) : undefined;
    if (detail && !d) continue; // over this poll's budget, or not readable: next poll
    const v = d ? await vet(issue, d, trust) : null;
    let thread = found;
    if (!thread) {
      if (!v!.author && v!.vetting) continue; // outsider's issue: waits for a member's go on GitHub
      const key = issueKey(issue.repo, issue.number);
      const id = await deps.store.claimIssueThread(space.id, key, deps.newId());
      thread = await deps.store.getThread(id) ?? await mutateThread(deps, null, { type: 'noop' },
        { id, space: space.id, title: issue.title, owner: ownerOf(issue.labels, space), kind: 'thread' }, undefined,
        f => ({ ...f, issue: { repo: issue.repo, number: issue.number, url: issue.url } }));
      links.set(key, id);
    }
    const cards = d ? cardsOf(thread.id, issue, d, v!) : [];
    const moved = await putCards(deps, space.id, cards);
    const board: IssueBoard = { node: issue.node, column: issue.column, labels: issue.labels,
      ...(issue.labelColors ? { labelColors: issue.labelColors } : {}), state: issue.state,
      vetting: v ? v.vetting : thread.board?.vetting ?? false, sig: d ? sigOf(issue) : thread.board?.sig ?? '',
      ...(cards[0] ? { body: cards[0].id } : thread.board?.body ? { body: thread.board.body } : {}) };
    // The agent in charge stays during a turn and while a flow task holds the thread (its turns must keep speaking there).
    const owner = thread.facts.turnActive || thread.flow ? thread.owner : ownerOf(issue.labels, space);
    const closing = issue.state === 'CLOSED' && thread.board?.state !== 'CLOSED' && thread.facts.manual !== 'done';
    const reopening = issue.state === 'OPEN' && thread.board?.state === 'CLOSED' && thread.facts.manual === 'done';
    // State too: a thread written before a rule of computeState that reads the board (human labels) is set right here.
    const same = !moved && !closing && !reopening && thread.title === issue.title && thread.owner === owner && sameBoard(thread.board, board)
      && thread.state === computeState(thread.facts, board.labels);
    if (same) continue;
    const next = await mutateThread(deps, thread.id, closing ? { type: 'action', kind: 'done' } : reopening ? { type: 'action', kind: 'reopen' } : { type: 'noop' },
      undefined, undefined, f => ({ ...f, title: issue.title, owner: f.facts.turnActive || f.flow ? f.owner : owner, board }));
    await broadcast(deps, space.id, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(next) });
  }
  return links;
}
