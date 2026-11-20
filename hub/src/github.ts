// GitHub: reads the linked Project (GraphQL), creates issues, sets their labels, merges the PR of an issue in « To
// merge » and commits the flow config of a space whose config source is a git repo (REST). No write of any other kind.
import type { GhItem, ThreadSummary, Message, RepoLabel, MergeBlock } from '../../protocol/frames.ts';

export const MAX_ITEMS = 200;
/** Repository roles that count as a member for vetting (same set as unstrikeable `WRITE_PERMS`). */
const WRITE_PERMS = new Set(['admin', 'maintain', 'write', 'triage']);

export interface GitHub {
  /** Organization project `owner`, number `number`. `issues`: the issues of `items` with what a board-driven space needs. */
  project(owner: string, number: number): Promise<{ id: string; title: string; url: string; items: GhItem[]; issues?: BoardIssue[] }>;
  /** Body, latest comments and linked PRs of these issues (node ids), read with the installation of `owner`. */
  issueDetails(owner: string, nodes: string[]): Promise<IssueDetail[]>;
  /** `login` has write access (triage or more) to `repo`: App tokens see private org members as NONE. */
  canWrite(repo: string, login: string): Promise<boolean>;
  /** Body made publishable first (`publishable`). createdAt: ISO date from GitHub (the body card's id derives from it). */
  createIssue(repo: string, title: string, body: string): Promise<{ number: number; url: string; nodeId: string; createdAt?: string }>;
  /** `owner`: organization of the Project (picks the App installation). */
  addToProject(owner: string, projectId: string, contentNodeId: string): Promise<void>;
  /** Issue `issueNode` is blocked by `blockingNode` (GitHub issue dependencies), organization `owner`. Already there = ok. */
  addBlockedBy(owner: string, issueNode: string, blockingNode: string): Promise<void>;
  /** Labels defined in `repo` (first REPO_LABELS_MAX). */
  repoLabels(repo: string): Promise<RepoLabel[]>;
  /** Adds (on) or removes `label` on the issue; returns the issue's labels after the change. Adding a label the repo
   *  does not define throws LABEL_UNKNOWN (GitHub would create it). Removing one the issue no longer has is not an error. */
  /** The issue's labels after the change, with their colours (`labelColors` as on `GhItem`). */
  setLabel(repo: string, number: number, label: string, on: boolean): Promise<Pick<GhItem, 'labelColors'> & { labels: string[] }>;
  /** Open PRs that close the issue (node id `issueNode`, organization `owner`): `owner/name` + number. */
  openPrs(owner: string, issueNode: string): Promise<{ repo: string; number: number }[]>;
  /** The PR as a merge needs it (REST: `mergeable_state` is computed by GitHub, no checks permission needed). */
  pull(repo: string, number: number): Promise<PullInfo>;
  /** Squash merge at exactly `sha` (GitHub refuses if the head moved: MERGE_MOVED; not mergeable: MERGE_REFUSED). */
  merge(repo: string, number: number, sha: string, title: string): Promise<{ sha: string }>;
  /** Deletes the branch `ref` of `repo` (already gone is not an error). */
  deleteBranch(repo: string, ref: string): Promise<void>;
  // Flow config, git source (docs/design-flow.md § 4.2)
  /** Head commit of `branch`. */
  branchHead(repo: string, branch: string): Promise<string>;
  /** The repo's default branch (memory import). */
  defaultBranch(repo: string): Promise<string>;
  /** Commit `sha`'s tree id and every blob in it: path -> blob id (a truncated tree throws). */
  commitTree(repo: string, sha: string): Promise<{ tree: string; blobs: Map<string, string> }>;
  /** A blob's text (UTF-8). */
  blobText(repo: string, sha: string): Promise<string>;
  /** One commit over `parent` (its tree `baseTree` with `changes`: text = new content, null = deleted), then `branch`
   *  moved to it without force: a push in between throws REF_MOVED. Returns the new commit. */
  commitFiles(repo: string, branch: string, parent: string, baseTree: string, changes: { path: string; text: string | null }[], message: string): Promise<string>;
  /** Last commit touching `path` on `branch` (sha, author name), null if none. */
  lastCommit(repo: string, branch: string, path: string): Promise<{ sha: string; author: string } | null>;
}
export const REF_MOVED = 'ref_moved';
export interface PullInfo { number: number; title: string; url: string; state: 'open' | 'closed'; merged: boolean; draft: boolean;
  mergeable: boolean | null; mergeableState: string; sha: string; headRef: string; headRepo: string; baseRef: string; defaultBranch: string }
export const MERGE_MOVED = 'merge_moved';
export const MERGE_REFUSED = 'merge_refused';
/**
 * Why a PR can't be merged now, from GitHub's own `mergeable_state` (null = mergeable). `unstable` = a check or status
 * is not green (failed or still running); `clean` and `has_hooks` merge. `unknown` (or `mergeable` null) = GitHub is
 * still computing: the caller reads again once before answering it.
 */
export function mergeBlock(p: PullInfo): MergeBlock | null {
  if (p.merged) return 'merged';
  if (p.state !== 'open') return 'closed';
  if (p.draft) return 'draft';
  if (p.baseRef !== p.defaultBranch) return 'base';
  if (p.mergeable === false || p.mergeableState === 'dirty') return 'conflict';
  const s: Record<string, MergeBlock | null> = { clean: null, has_hooks: null, unstable: 'checks', blocked: 'blocked', behind: 'behind', draft: 'draft' };
  return p.mergeable === null || !(p.mergeableState in s) ? 'unknown' : s[p.mergeableState];
}
export const REPO_LABELS_MAX = 100;
export const LABEL_UNKNOWN = 'label_unknown';

/** Error message when the GitHub App is not installed on the organization (the Board shows it instead of staying empty). */
export const NOT_INSTALLED = 'not_installed';

/** Organization -> App installation id (`GET /orgs/{org}/installation`, authenticated by the App JWT). Only successes are
 *  cached: an organization that installs the App later is seen without redeploying. `forget` drops an entry whose id
 *  stopped working (App uninstalled then reinstalled = new id). */
export function makeInstallations(jwt: () => Promise<string>, fetchFn: typeof fetch = fetch) {
  const ids = new Map<string, number>();
  return {
    async id(org: string): Promise<number> {
      const known = ids.get(org);
      if (known) return known;
      const r = await fetchFn(`https://api.github.com/orgs/${encodeURIComponent(org)}/installation`, {
        headers: { authorization: `Bearer ${await jwt()}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'briefling' },
        signal: AbortSignal.timeout(10_000),
      });
      if (r.status === 404) throw new Error(NOT_INSTALLED);
      const j: any = await r.json();
      if (!r.ok || typeof j?.id !== 'number') throw new Error(`github_${r.status}: ${String(j?.message ?? '').slice(0, 120)}`);
      ids.set(org, j.id);
      return j.id;
    },
    forget(org: string) { ids.delete(org); },
  };
}

export const PROJECT_QUERY = `query($owner: String!, $number: Int!, $after: String) {
  organization(login: $owner) {
    projectV2(number: $number) {
      id title url
      items(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
          content {
            __typename
            ... on DraftIssue { title }
            ... on Issue { id number title url state updatedAt author { login } authorAssociation repository { nameWithOwner } assignees(first: 5) { nodes { login } }
              labels(first: 20) { nodes { name color } } closedByPullRequestsReferences(first: 5, includeClosedPrs: true) { nodes { number state } } }
            ... on PullRequest { number title url state isDraft repository { nameWithOwner } assignees(first: 5) { nodes { login } } }
          }
        }
      }
    }
  }
}`;

/** An issue of the Project, as the board-driven sync needs it (light: read on every poll). */
export interface BoardIssue { node: string; repo: string; number: number; url: string; title: string; state: 'OPEN' | 'CLOSED'; column: string | null;
  author: string; assoc: string; labels: string[]; labelColors?: string[]; updatedAt: string; prs: string[] }
/** Comment or linked PR of an issue (detail read only when the issue moved). */
export interface GhPost { id: number; login: string; assoc: string; body: string; url: string; createdAt: string; updatedAt: string; title?: string; state?: string }
export interface IssueDetail { node: string; body: string; url: string; createdAt: string; editedAt: string; comments: GhPost[]; prs: GhPost[] }

export const DETAIL_QUERY = `query($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Issue {
      id body url createdAt lastEditedAt
      comments(last: 30) { nodes { databaseId url body createdAt updatedAt author { login } authorAssociation } }
      closedByPullRequestsReferences(first: 5, includeClosedPrs: true) { nodes { number title url state createdAt updatedAt author { login } authorAssociation repository { nameWithOwner } } }
    }
  }
}`;
const DETAIL_BATCH = 10;
export const OPEN_PRS_QUERY = `query($id: ID!) {
  node(id: $id) { ... on Issue { closedByPullRequestsReferences(first: 10, includeClosedPrs: false) { nodes { number repository { nameWithOwner } } } } }
}`;

/** GitHub login as unstrikeable compares them: lower case, without the `[bot]` suffix of Apps ('' = deleted account). */
export const login = (a: any) => String(a?.login ?? '').replace(/\[bot\]$/, '').toLowerCase();
const okUrl = (u: unknown) => typeof u === 'string' && u.startsWith('https://github.com/') ? u : '';

/** Raw Project nodes -> issues of the board (other kinds and unreachable items skipped). */
export function mapIssues(nodes: any[]): BoardIssue[] {
  const out: BoardIssue[] = [];
  for (const n of nodes ?? []) {
    const c = n?.content;
    if (c?.__typename !== 'Issue' || typeof c.id !== 'string' || typeof c.number !== 'number' || !c.repository?.nameWithOwner || !okUrl(c.url)) continue;
    out.push({ node: c.id, repo: String(c.repository.nameWithOwner), number: c.number, url: c.url, title: String(c.title ?? '').slice(0, 300),
      state: c.state === 'CLOSED' ? 'CLOSED' : 'OPEN', column: typeof n.status?.name === 'string' ? n.status.name : null,
      author: login(c.author), assoc: String(c.authorAssociation ?? 'NONE'), labels: [], ...labelFields(c.labels?.nodes),
      updatedAt: String(c.updatedAt ?? ''), prs: (c.closedByPullRequestsReferences?.nodes ?? []).map((p: any) => `${p?.number}:${p?.state}`) });
  }
  return out.slice(0, MAX_ITEMS);
}

/** Raw `nodes(ids)` -> issue details (non-issues skipped). */
export function mapDetails(nodes: any[]): IssueDetail[] {
  const post = (x: any, id: number, extra = {}): GhPost => ({ id, login: login(x.author), assoc: String(x.authorAssociation ?? 'NONE'), body: String(x.body ?? ''),
    url: okUrl(x.url), createdAt: String(x.createdAt ?? ''), updatedAt: String(x.updatedAt ?? x.createdAt ?? ''), ...extra });
  return (nodes ?? []).filter((n: any) => typeof n?.id === 'string' && typeof n.body === 'string').map((n: any) => ({
    node: n.id, body: n.body, url: okUrl(n.url), createdAt: String(n.createdAt ?? ''), editedAt: String(n.lastEditedAt ?? n.createdAt ?? ''),
    comments: (n.comments?.nodes ?? []).filter((c: any) => Number.isSafeInteger(c?.databaseId)).map((c: any) => post(c, c.databaseId)),
    prs: (n.closedByPullRequestsReferences?.nodes ?? []).filter((p: any) => Number.isSafeInteger(p?.number) && okUrl(p.url))
      .map((p: any) => post({ ...p, body: '' }, p.number, { title: String(p.title ?? '').slice(0, 300), state: String(p.state ?? '') })),
  }));
}

/** GitHub label colour as the client may use it: 6 lowercase hex digits, anything else dropped (it becomes a CSS rule). */
const LABEL_COLOR = /^[0-9a-f]{6}$/;
/** `labels` + `labelColors` (same order, '' = no usable colour; left out when no label has one). */
function labelFields(nodes: any): Pick<GhItem, 'labels' | 'labelColors'> {
  const ls = (Array.isArray(nodes) ? nodes : []).map((l: any) => ({ name: String(l?.name ?? ''), color: String(l?.color ?? '').toLowerCase() }))
    .filter(l => l.name).slice(0, 20);
  if (!ls.length) return {};
  const colors = ls.map(l => LABEL_COLOR.test(l.color) ? l.color : '');
  return { labels: ls.map(l => l.name), ...(colors.some(Boolean) ? { labelColors: colors } : {}) };
}

/** Raw GraphQL response -> normalized items (unknown fields ignored, bounded texts). */
export function mapItems(nodes: any[]): GhItem[] {
  const out: GhItem[] = [];
  for (const n of nodes ?? []) {
    const c = n?.content;
    if (!c || typeof c.title !== 'string') continue; // item deleted or not reachable by the app
    const kind = c.__typename === 'PullRequest' ? 'pr' : c.__typename === 'Issue' ? 'issue' : 'draft';
    out.push({
      id: String(n.id), kind, title: c.title.slice(0, 300), status: typeof n.status?.name === 'string' ? n.status.name : null,
      state: kind === 'draft' ? 'DRAFT' : kind === 'pr' && c.isDraft && c.state === 'OPEN' ? 'DRAFT' : String(c.state ?? ''),
      ...(typeof c.number === 'number' ? { number: c.number } : {}),
      ...(typeof c.url === 'string' && c.url.startsWith('https://github.com/') ? { url: c.url } : {}),
      ...(c.repository?.nameWithOwner ? { repo: String(c.repository.nameWithOwner) } : {}),
      assignees: (c.assignees?.nodes ?? []).map((a: any) => String(a.login)).slice(0, 5),
      ...(kind === 'issue' ? labelFields(c.labels?.nodes) : {}),
    });
  }
  return out.slice(0, MAX_ITEMS);
}

/** Issue body: the thread's summary if any, otherwise the initial request. No link to the app (private). */
/**
 * Text the briefling App publishes on GitHub: HTML comments opened as text (`&lt;!--`), so a quoted or agent-written
 * `<!-- uns:agent=x -->` marker can't pass for an unstrikeable agent's comment (GitHub hides comments, the App is trusted).
 */
export const publishable = (text: string) => text.replace(/<!--/g, '&lt;!--');

export function issueBody(title: string, summary: ThreadSummary | null, msgs: Message[], names: (id: string) => string): string {
  const parts: string[] = [];
  if (summary) {
    parts.push(summary.status);
    if (summary.decisions.length) parts.push('**Decided**\n' + summary.decisions.map(d => `- ${d}`).join('\n'));
    if (summary.next_steps.length) parts.push('**Next**\n' + summary.next_steps.map(e => `- ${e.who}: ${e.what}`).join('\n'));
  } else {
    const first = msgs.find(m => m.author.kind === 'human' && m.type === 'text');
    if (first) parts.push(`${names(first.author.id)}:\n\n` + first.text.split('\n').map(l => `> ${l}`).join('\n'));
  }
  parts.push(`---\n_Issue opened from briefling, thread "${title}"._`);
  return parts.join('\n\n').slice(0, 60_000);
}

/** Real client: `token(org)` provides the App installation token of that organization (or `gh auth token` for a local probe). */
/** + `openIssues` (Radar sources, radarsources.ts SourceReader): open issues of `repo`, most recently updated first, one
 *  page of 100 (REST: pull requests included, flagged). */
export function makeGitHub(token: (org: string) => Promise<string>, fetchFn: typeof fetch = fetch): GitHub & { openIssues(repo: string): Promise<any[]> } {
  const call = async (org: string, path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => {
    const r = await fetchFn(`https://api.github.com${path}`, {
      method, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: { authorization: `Bearer ${await token(org)}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'briefling' },
      signal: AbortSignal.timeout(10_000),
    });
    const j: any = r.status === 204 ? null : await r.json(); // 204: DELETE of a ref, no body
    if (!r.ok) throw new Error(`github_${r.status}: ${String(j?.message ?? '').slice(0, 120)}`);
    if (j?.errors?.length) throw new Error(`github_graphql: ${String(j.errors[0]?.message ?? '').slice(0, 120)}`);
    return j;
  };
  return {
    async project(owner, number) {
      const nodes: any[] = [];
      let after: string | null = null, meta: any = null;
      do {
        const j = await call(owner, '/graphql', { query: PROJECT_QUERY, variables: { owner, number, after } });
        meta = j.data?.organization?.projectV2;
        if (!meta) throw new Error('github_project_not_found');
        nodes.push(...meta.items.nodes);
        after = meta.items.pageInfo.hasNextPage && nodes.length < MAX_ITEMS ? meta.items.pageInfo.endCursor : null;
      } while (after);
      return { id: meta.id, title: meta.title, url: meta.url, items: mapItems(nodes), issues: mapIssues(nodes) };
    },
    async issueDetails(owner, ids) {
      const out: IssueDetail[] = [];
      for (let i = 0; i < ids.length; i += DETAIL_BATCH) {
        const j = await call(owner, '/graphql', { query: DETAIL_QUERY, variables: { ids: ids.slice(i, i + DETAIL_BATCH) } });
        out.push(...mapDetails(j.data?.nodes ?? []));
      }
      return out;
    },
    async canWrite(repo, who) {
      // Path parts encoded: `repo` comes from the space settings and `who` from GitHub, never a path.
      const [o, n] = repo.split('/');
      try {
        const j = await call(o, `/repos/${encodeURIComponent(o)}/${encodeURIComponent(n)}/collaborators/${encodeURIComponent(who)}/permission`);
        return WRITE_PERMS.has(String(j?.role_name ?? j?.permission ?? ''));
      } catch (e) {
        if (/^github_(403|404)/.test((e as Error).message)) return false; // not a collaborator, or the App may not read it
        throw e;
      }
    },
    async createIssue(repo, title, body) {
      const j = await call(repo.split('/')[0], `/repos/${repo}/issues`, { title, body: publishable(body) });
      return { number: j.number, url: j.html_url, nodeId: j.node_id, ...(typeof j.created_at === 'string' ? { createdAt: j.created_at } : {}) };
    },
    async repoLabels(repo) {
      const [o, n] = repo.split('/').map(encodeURIComponent);
      const j = await call(repo.split('/')[0], `/repos/${o}/${n}/labels?per_page=${REPO_LABELS_MAX}`);
      return (Array.isArray(j) ? j : []).filter((l: any) => typeof l?.name === 'string').map((l: any) => ({
        name: l.name, color: /^[0-9a-f]{6}$/i.test(String(l.color)) ? String(l.color).toLowerCase() : '', description: String(l.description ?? '').slice(0, 200) }));
    },
    async setLabel(repo, number, label, on) {
      // Path parts encoded: `repo` comes from the space settings, `label` from a person (any character GitHub allows).
      const org = repo.split('/')[0];
      const [o, n] = repo.split('/').map(encodeURIComponent);
      const names = (j: any) => ({ labels: [], ...labelFields(j) });
      const issue = `/repos/${o}/${n}/issues/${number}/labels`;
      if (on) {
        // POST creates a label the repo lacks: only an existing one (its exact name, GitHub matches case-insensitively).
        let def: any;
        try { def = await call(org, `/repos/${o}/${n}/labels/${encodeURIComponent(label)}`); }
        catch (e) { if (/^github_404/.test((e as Error).message)) throw new Error(LABEL_UNKNOWN); throw e; }
        return names(await call(org, issue, { labels: [String(def.name)] }));
      }
      try { return names(await call(org, `${issue}/${encodeURIComponent(label)}`, undefined, 'DELETE')); }
      catch (e) { if (/^github_404/.test((e as Error).message)) return names(await call(org, issue)); throw e; } // already gone
    },
    async openPrs(owner, issueNode) {
      const j = await call(owner, '/graphql', { query: OPEN_PRS_QUERY, variables: { id: issueNode } });
      return (j.data?.node?.closedByPullRequestsReferences?.nodes ?? []).filter((p: any) => Number.isSafeInteger(p?.number) && p?.repository?.nameWithOwner)
        .map((p: any) => ({ repo: String(p.repository.nameWithOwner), number: p.number }));
    },
    async pull(repo, number) {
      const [o, n] = repo.split('/').map(encodeURIComponent);
      const j = await call(repo.split('/')[0], `/repos/${o}/${n}/pulls/${number}`);
      return { number: j.number, title: String(j.title ?? '').slice(0, 300), url: okUrl(j.html_url), state: j.state === 'open' ? 'open' : 'closed', merged: j.merged === true,
        draft: j.draft === true, mergeable: typeof j.mergeable === 'boolean' ? j.mergeable : null, mergeableState: String(j.mergeable_state ?? 'unknown'),
        sha: String(j.head?.sha ?? ''), headRef: String(j.head?.ref ?? ''), headRepo: String(j.head?.repo?.full_name ?? ''),
        baseRef: String(j.base?.ref ?? ''), defaultBranch: String(j.base?.repo?.default_branch ?? '') };
    },
    async merge(repo, number, sha, title) {
      const [o, n] = repo.split('/').map(encodeURIComponent);
      try {
        const j = await call(repo.split('/')[0], `/repos/${o}/${n}/pulls/${number}/merge`, { merge_method: 'squash', sha, commit_title: title }, 'PUT');
        return { sha: String(j?.sha ?? '') };
      } catch (e) {
        const m = (e as Error).message;
        if (/^github_409/.test(m)) throw new Error(MERGE_MOVED); // head branch modified since `sha`
        if (/^github_405/.test(m)) throw new Error(MERGE_REFUSED); // not mergeable (conflict, protection)
        throw e;
      }
    },
    async deleteBranch(repo, ref) {
      const [o, n] = repo.split('/').map(encodeURIComponent);
      // `ref` comes from GitHub (head branch): each path segment encoded, the slashes kept (`uns/67-x`).
      try { await call(repo.split('/')[0], `/repos/${o}/${n}/git/refs/heads/${ref.split('/').map(encodeURIComponent).join('/')}`, undefined, 'DELETE'); }
      catch (e) { if (!/^github_422/.test((e as Error).message)) throw e; } // « Reference does not exist »: already deleted
    },
    async addToProject(owner, projectId, contentId) {
      await call(owner, '/graphql', { query: 'mutation($p: ID!, $c: ID!) { addProjectV2ItemById(input: { projectId: $p, contentId: $c }) { item { id } } }', variables: { p: projectId, c: contentId } });
    },
    async addBlockedBy(owner, issue, blocking) {
      try {
        await call(owner, '/graphql', { query: 'mutation($i: ID!, $b: ID!) { addBlockedBy(input: { issueId: $i, blockingIssueId: $b }) { issue { id } } }', variables: { i: issue, b: blocking } });
      } catch (e) {
        // A second add answers a validation error (« already been taken »): check the link instead of parsing the text.
        const j = await call(owner, '/graphql', { query: 'query($i: ID!) { node(id: $i) { ... on Issue { blockedBy(first: 50) { nodes { id } } } } }', variables: { i: issue } });
        if (!(j?.data?.node?.blockedBy?.nodes ?? []).some((n: any) => n?.id === blocking)) throw e;
      }
    },
    // Branch and paths come from the admin's source setting (BRANCH_RE / DIR_RE, checked before): each segment encoded.
    async branchHead(repo, branch) {
      const j = await call(repo.split('/')[0], `/repos/${repoUrl(repo)}/git/ref/heads/${segs(branch)}`);
      return String(j.object.sha);
    },
    async openIssues(repo) {
      return await call(repo.split('/')[0], `/repos/${repoUrl(repo)}/issues?state=open&sort=updated&direction=desc&per_page=100`) as any[];
    },
    async defaultBranch(repo) {
      const j = await call(repo.split('/')[0], `/repos/${repoUrl(repo)}`);
      return String(j.default_branch);
    },
    async commitTree(repo, sha) {
      const c = await call(repo.split('/')[0], `/repos/${repoUrl(repo)}/git/commits/${sha}`);
      const t = await call(repo.split('/')[0], `/repos/${repoUrl(repo)}/git/trees/${c.tree.sha}?recursive=1`);
      if (t.truncated) throw new Error('github_tree_truncated');
      return { tree: String(c.tree.sha), blobs: new Map((t.tree as any[]).filter(x => x.type === 'blob').map(x => [String(x.path), String(x.sha)])) };
    },
    async blobText(repo, sha) {
      const j = await call(repo.split('/')[0], `/repos/${repoUrl(repo)}/git/blobs/${sha}`);
      return Buffer.from(String(j.content), 'base64').toString('utf8');
    },
    async commitFiles(repo, branch, parent, baseTree, changes, message) {
      const org = repo.split('/')[0], r = repoUrl(repo);
      const tree = await call(org, `/repos/${r}/git/trees`, { base_tree: baseTree,
        tree: changes.map(c => c.text === null ? { path: c.path, mode: '100644', type: 'blob', sha: null } : { path: c.path, mode: '100644', type: 'blob', content: c.text }) });
      const commit = await call(org, `/repos/${r}/git/commits`, { message, tree: tree.sha, parents: [parent] });
      try { await call(org, `/repos/${r}/git/refs/heads/${segs(branch)}`, { sha: commit.sha, force: false }, 'PATCH'); }
      catch (e) { if (/^github_422/.test((e as Error).message)) throw new Error(REF_MOVED); throw e; } // « not a fast forward »
      return String(commit.sha);
    },
    async lastCommit(repo, branch, path) {
      const j = await call(repo.split('/')[0], `/repos/${repoUrl(repo)}/commits?sha=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}&per_page=1`);
      return j?.[0] ? { sha: String(j[0].sha), author: String(j[0].commit?.author?.name ?? j[0].author?.login ?? '?') } : null;
    },
  };
}
const repoUrl = (repo: string) => repo.split('/').map(encodeURIComponent).join('/');
const segs = (path: string) => path.split('/').map(encodeURIComponent).join('/');
