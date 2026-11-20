# Contributing

Thank you for wanting to improve briefling. Issues (bugs, ideas, questions) are welcome as they are.

## Why a contributor licence agreement

briefling is offered under two licences:

- the [GNU AGPL v3](LICENSE): anyone may run, study, change and share it; whoever runs a modified version as a network
  service must offer its users the source of that version;
- a commercial licence, sold by the copyright holder (opcode) to those who cannot take the AGPL obligations. It funds
  the work on the free version.

For both licences to keep covering the whole code, opcode needs the right to distribute your contribution under each
of them. The [contributor licence agreement](CLA.md) (adapted from the Apache Software Foundation's Individual CLA
v2.2) grants that right. You keep the copyright on your work, and you may use it however you like elsewhere.

You sign it once, from the pull request itself: a bot asks you to post a comment with a given sentence. A pull request
is not merged before that.

## How changes land

This repository is a mirror generated from the main repository at each release. A pull request is reviewed here, then
applied to the main repository by a maintainer; it comes back in the next release commit, with you credited as the
author (`Co-authored-by`). Your pull request is closed at that point, not merged.

## Before sending a change

- `npm run typecheck && npm test` pass;
- code, comments, commits and identifiers in English; texts shown to people go through `t()` (`client/src/i18n.ts`),
  English and French;
- one subject per pull request, the smallest change that does it, with a test showing the bug or the behaviour;
- no new dependency without discussing it in an issue first.
