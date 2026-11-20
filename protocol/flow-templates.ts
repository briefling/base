// Flow templates of the flow editor: exact FlowDef equivalents of the plugin's shipped flows
// (hermes-plugin/briefling/flow/flows/{dev,content}.yml) with their playbooks verbatim
// (hermes-plugin/briefling/flow/playbooks/<name>/*.md). Triggers are listed in FLOW_TRIGGERS order (the order
// flowYaml emits); hermes-plugin/tests/flow/test_editor_yaml.py checks the emitted YAML loads like the shipped one.
import type { FlowDef } from './flowcfg.ts';

export const FLOW_TEMPLATES: Record<'dev' | 'content', FlowDef> = {
  // flows/dev.yml: a PM writes specs, devs open PRs, reviewers check them, humans merge.
  dev: {
    name: 'dev',
    states: [
      { key: 'backlog', column: 'Backlog' },
      { key: 'ready', column: 'Ready' },
      { key: 'doing', column: 'In progress' },
      { key: 'review', column: 'In review' },
      { key: 'approved', column: 'To merge' },
      { key: 'done', column: 'Done' },
    ],
    roles: [
      { name: 'pm', assign: 'all', color: '',
        on: {'backlog': ['item_new', 'human_comment']},
        playbooks: {'item_new': 'spec.md', 'human_comment': 'spec.md'} },
      { name: 'dev', assign: 'label', color: '1d76db',
        on: {'ready': ['assigned'], 'doing': ['new_comment'], 'approved': ['human_comment', 'pr_conflict']},
        playbooks: {'assigned': 'take.md', 'new_comment': 'rework.md', 'human_comment': 'rework.md', 'pr_conflict': 'conflict.md'} },
      { name: 'review', assign: 'auto', color: '8250df',
        on: {'review': ['pr_updated']},
        playbooks: {'pr_updated': 'review.md'} },
    ],
    kinds: ['feature', 'bug', 'refactor', 'docs', 'test', 'ops', 'research', 'other'],
    playbooks: [
      { file: 'spec.md', body: `You are the PM. A new item landed in **Backlog**, or a human answered you.

1. Read the item, its comments and the code it touches. Complete the spec in a comment (\`board_comment\`):
   context, expected behaviour, **acceptance criteria** as a checklist, out of scope.
2. Set the size: \`board_set(ref="<ref>", field="Size", value="<XS|S|M|L|XL>")\`.
   Too big for one PR? Split it into sub-issues and declare dependencies (GitHub "blocked by").
3. Something essential is unclear? Ask one grouped question, add \`spec:question\` (\`board_label\`), stay in \`backlog\`, stop.
4. Otherwise \`board_move(ref="<ref>", state="ready")\`. You may suggest a dev (see the agents' capabilities); you never assign.
` },
      { file: 'take.md', body: `You are the dev. A ready item is assigned to you.

1. Remove a leftover \`spec:question\` / \`needs:human\` if any (\`board_label\`), then \`board_move(ref="<ref>", state="doing")\`.
2. Post your plan and estimate as a comment. The spec does not hold (much bigger, contradictory)?
   Explain, add \`spec:question\` (\`board_label\`), \`board_move(ref="<ref>", state="backlog")\`, stop.
3. Work in a dedicated worktree on branch \`uns/<number>-<slug>\`. Tests first; never push to the default branch.
4. Push, open a PR with \`Closes #<number>\` in its body, then \`board_move(ref="<ref>", state="review")\`.
5. \`board_status(ref="<ref>", state="done", …)\`: what changed, what is verified (test output), what is left.
` },
      { file: 'rework.md', body: `The reviewer or a human sent your work back with a comment.

1. \`board_move(ref="<ref>", state="doing")\` if needed. Address every numbered point on the same branch, tests green, push.
2. Answer point by point (\`board_comment\`), then \`board_move(ref="<ref>", state="review")\`.
3. A point you disagree with: argue it in one line, with a fact (test, log, measure), and leave it to the human.
` },
      { file: 'conflict.md', body: `The PR of this item no longer merges cleanly.

1. \`board_move(ref="<ref>", state="doing")\`, rebase on the default branch, resolve, run the tests, \`git push --force-with-lease\`.
2. Comment "rebase only" or "rebase + changes" (list them), then \`board_move(ref="<ref>", state="review")\`.
` },
      { file: 'review.md', body: `You are the reviewer. A PR is waiting for you (new item, or new commits since your last review).

1. CI first: \`gh pr checks <pr>\`. Red → comment "CI red" with the failing job (\`board_comment\`), \`board_move(ref="<ref>", state="doing")\`, stop.
2. After a rebase only, review the range diff (\`git range-diff\`), not the whole PR again.
3. Check against the acceptance criteria of the item: behaviour, tests that prove it, scope, security.
4. OK → a PR review \`--comment\` summarising what you verified, then \`board_move(ref="<ref>", state="approved")\`.
5. Not OK → one comment **on the item** with numbered, actionable points (\`board_comment\`), then \`board_move(ref="<ref>", state="doing")\`.

You never approve or merge: humans do. You never review your own work.
` },
    ],
    artifact: '',
  },
  // flows/content.yml: a planner briefs ideas, a writer drafts them in a PR, a human reviews, publishes, then merges.
  content: {
    name: 'content',
    states: [
      { key: 'backlog', column: 'Ideas' },
      { key: 'ready', column: 'Ready to write' },
      { key: 'doing', column: 'Drafting' },
      { key: 'review', column: 'In review' },
      { key: 'approved', column: 'Ready to publish' },
      { key: 'done', column: 'Published' },
    ],
    roles: [
      { name: 'planner', assign: 'all', color: '',
        on: {'backlog': ['item_new', 'human_comment']},
        playbooks: {'item_new': 'brief.md', 'human_comment': 'brief.md'} },
      { name: 'writer', assign: 'label', color: '006b75',
        on: {'ready': ['assigned'], 'doing': ['human_comment'], 'approved': ['human_comment', 'pr_conflict']},
        playbooks: {'assigned': 'write.md', 'human_comment': 'rework.md', 'pr_conflict': 'conflict.md'} },
      { name: 'reviewer', assign: 'human', color: '',
        on: {},
        playbooks: {} },
    ],
    kinds: ['post', 'article', 'newsletter', 'research', 'other'],
    playbooks: [
      { file: 'brief.md', body: `You are the planner. A new idea landed in **Ideas**, or a human answered you.

1. Read the item and its comments. Turn the idea into a short brief, as a comment (\`board_comment\`):
   - **Goal**: what the post must achieve (inform, announce, recruit…) and for whom.
   - **Channel(s)**: one or more \`channel:*\` labels (\`board_label(ref="<ref>", add=["channel:x"])\`).
   - **Key message**: one sentence. **Facts to cite**: links, numbers, with their source.
   - **Acceptance**: what makes the draft good enough (length, tone, call to action).
2. Something essential is unclear (goal, audience, a fact you cannot verify)? Ask one grouped question,
   add \`spec:question\` (\`board_label\`), leave the item in \`backlog\`, stop.
3. Otherwise \`board_move(ref="<ref>", state="ready")\`. You may suggest a writer in the comment; you never assign.

Never invent a fact, a number or a quote. A claim without a source does not go in the brief.
` },
      { file: 'write.md', body: `You are the writer. A brief is assigned to you.

1. \`board_move(ref="<ref>", state="doing")\`.
2. In the item's repo, on a new branch \`post/<number>-<slug>\`, write the post as Markdown at the path given by
   the flow (\`{yyyy}/{mm}/{channel}-{dd}-{slug}.md\`, \`dd\` = planned publication day). Front matter:
   \`\`\`yaml
   ---
   channel: linkedin        # one file per channel
   kind: post               # post | comment
   target:                  # URL answered to, when kind is comment
   item: <owner/repo#number>
   url:                     # filled in by the human at publication
   ---
   \`\`\`
   Then the text, exactly as it will be published (respect the channel's limits: X = 280 characters per post).
3. Open a PR with \`Closes #<number>\` in its body, then \`board_move(ref="<ref>", state="review")\`.
4. \`board_status(ref="<ref>", state="done", …)\` with what you wrote and anything the reviewer should check (facts, links).

Never publish anything yourself: the human publishes, fills in \`url:\`, then merges.
Never invent a fact, a number or a quote: only what the brief and its sources say.
` },
      { file: 'rework.md', body: `A human commented on your draft.

1. Apply every point of the comment on the same branch, push.
2. Answer point by point in a comment (\`board_comment\`), then \`board_move(ref="<ref>", state="review")\`.
3. A point you disagree with: say why in one line and keep it open for the human; do not silently ignore it.
` },
      { file: 'conflict.md', body: `The PR of this post no longer merges cleanly.

1. \`board_move(ref="<ref>", state="doing")\`, rebase the branch on the default branch, resolve, \`git push --force-with-lease\`.
2. Comment (\`board_comment\`) "rebase only" (or what changed), then \`board_move(ref="<ref>", state="approved")\` if the text did not change,
   \`board_move(ref="<ref>", state="review")\` if it did.
` },
    ],
    artifact: '{yyyy}/{mm}/{channel}-{dd}-{slug}.md',
  },
};
