import type { SQSEvent } from 'aws-lambda';
import { createAppAuth } from '@octokit/auth-app';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { store, newId, githubSpaces, makeSenderFromEndpoint, queuePush } from '../aws.ts';
import { makeGitHub, makeInstallations, NOT_INSTALLED } from '../github.ts';
import { makeCiReader, pollCi } from '../ci.ts';
import { detailsPrs, makePrReader } from '../details.ts';
import { memoryPass } from '../router.ts';
import { pollBackground } from '../background.ts';
import { pollSpace, createIssue, reportIssueFailure, labelIssue, repoLabels, createProposedIssue, createPlanIssues, mergeInfo, mergePr } from '../githubJobs.ts';
import { flowCommit, flowGitRead, refreshFlowGit } from '../flowgit.ts';
import { memoryImport } from '../memimport.ts';
import { radarPassSources } from '../radar.ts';

const sender = makeSenderFromEndpoint(process.env.WS_ENDPOINT!);
const ssm = new SSMClient({});
let auth: ReturnType<typeof createAppAuth> | null = null;
let installations: ReturnType<typeof makeInstallations> | null = null;

/** GitHub App private key in an SSM SecureString. Missing = GitHub integration disabled (no error). */
async function appAuth() {
  if (auth) return auth; // only a key that was found is cached: a key added later is seen without redeploying
  try {
    const p = await ssm.send(new GetParameterCommand({ Name: process.env.GITHUB_KEY_PARAM!, WithDecryption: true }));
    const a = createAppAuth({ appId: process.env.GITHUB_APP_ID!, privateKey: p.Parameter!.Value! });
    installations = makeInstallations(async () => (await a({ type: 'app' })).token);
    auth = a;
  } catch (e) {
    if ((e as Error)?.name !== 'ParameterNotFound') throw e;
  }
  return auth;
}

const deps = async () => {
  const a = await appAuth();
  if (!a || !installations || !process.env.GITHUB_APP_ID) return null;
  const inst = installations;
  // One installation per organization, found from the Project's owner; installation tokens cached by the lib (1 h).
  const gh = makeGitHub(async org => {
    const installationId = await inst.id(org);
    try { return (await a({ type: 'installation', installationId })).token; }
    catch (e) { inst.forget(org); throw e; } // App uninstalled/reinstalled: look the id up again next time
  });
  // CI pass: a token restricted to reading checks and statuses on the followed repos only (design § 3.1), so a bug or an
  // injected repo name reaches nothing else, and that token can neither write nor read code. Cached by the lib per
  // installation + permissions + repos.
  const ci = makeCiReader(async (org, repositoryNames) => {
    const installationId = await inst.id(org);
    try { return (await a({ type: 'installation', installationId, permissions: { checks: 'read', statuses: 'read' }, repositoryNames })).token; }
    catch (e: any) {
      if (e?.status === 404) { inst.forget(org); throw new Error(NOT_INSTALLED); }
      if (e?.status === 422 || e?.status === 403) { console.log('ci_token_refused', e.status, String(e?.message ?? '').slice(0, 160)); throw new Error('no_permission'); } // permission not granted, or a repo outside the installation
      throw e;
    }
  });
  // Thread info panel: same restriction, `pull_requests: read` only (finds a pushed branch's PR and its state).
  const prs = makePrReader(async (org, repositoryNames) => {
    const installationId = await inst.id(org);
    try { return (await a({ type: 'installation', installationId, permissions: { pull_requests: 'read' }, repositoryNames })).token; }
    catch (e: any) {
      if (e?.status === 404) { inst.forget(org); throw new Error(NOT_INSTALLED); }
      if (e?.status === 422 || e?.status === 403) { console.log('prs_token_refused', e.status, String(e?.message ?? '').slice(0, 160)); throw new Error('no_permission'); }
      throw e;
    }
  });
  // Radar pass (bug and security detectors): `contents: read` + `issues: read` on the space's repos only, so an
  // injected repo name or a bug reaches nothing else and the token writes nothing.
  const sources = (repos: string[]) => makeGitHub(async org => {
    const installationId = await inst.id(org);
    const repositoryNames = repos.filter(r => r.split('/')[0].toLowerCase() === org.toLowerCase()).map(r => r.split('/')[1]);
    try { return (await a({ type: 'installation', installationId, permissions: { contents: 'read', issues: 'read' }, repositoryNames })).token; }
    catch (e: any) {
      if (e?.status === 404) { inst.forget(org); throw new Error(NOT_INSTALLED); }
      if (e?.status === 422 || e?.status === 403) { console.log('radar_token_refused', e.status, String(e?.message ?? '').slice(0, 160)); throw new Error('no_permission'); }
      throw e;
    }
  });
  // queuePush: a label sync can make a thread Your turn (needs:human), notified like a turn end.
  return { store, sender, now: () => Date.now(), newId, gh, ci, prs, sources, queuePush };
};

/** Every 5 min (EventBridge). */
export const poll = async () => {
  // Project memory: wakes the memory agent of the spaces whose queue reached a batch threshold (no GitHub involved).
  try { console.log('memory_pass', JSON.stringify(await memoryPass({ store, sender, now: () => Date.now(), newId }))); }
  catch (e) { console.error('memory_pass_failed', (e as Error)?.message?.slice(0, 200)); }
  // Background work whose plugin went silent (container restarted, gateway down): Your turn « background work lost ».
  try { console.log('background_poll', JSON.stringify(await pollBackground({ store, sender, now: () => Date.now(), newId, queuePush }))); }
  catch (e) { console.error('background_poll_failed', (e as Error)?.message?.slice(0, 200)); }
  const d = await deps();
  if (!d) { console.log('github_not_configured'); return; }
  for (const s of await githubSpaces()) {
    try { console.log('github_poll', s, await pollSpace(d, s)); }
    catch (e) { console.error('github_poll_failed', s, (e as Error)?.message?.slice(0, 200)); }
    // Flow config on a git source: one read of the branch head; moved = bundle read again and pushed to the agents.
    // Only while someone (human or agent) is connected: an agent connecting later gets the cached bundle.
    try { if ((await store.listSubs(s)).length) console.log('flow_git', s, JSON.stringify(await refreshFlowGit(d, s))); }
    catch (e) { console.error('flow_git_failed', s, (e as Error)?.message?.slice(0, 200)); }
  }
  // CI follow-up: runs whoever is connected, but only reads GitHub while a declared commit is still followed.
  try { console.log('ci_poll', await pollCi(d)); }
  catch (e) { console.error('ci_poll_failed', (e as Error)?.message?.slice(0, 200)); }
};

/** Jobs from the hub (SQS): issue creation, poll now, labels. No automatic retry: a duplicate write is worse than a visible failure. */
export const jobs = async (event: SQSEvent) => {
  const d = await deps();
  for (const rec of event.Records) {
    const job = JSON.parse(rec.body);
    if (!d) { console.log('github_not_configured'); continue; }
    // Switch to the board driver: poll (= import) now. Same function as the schedule; a failure waits for the next run.
    if (job.kind === 'poll') {
      try { console.log('github_poll', job.space, await pollSpace(d, String(job.space))); }
      catch (e) { console.error('github_poll_failed', job.space, (e as Error)?.message?.slice(0, 200)); }
      continue;
    }
    // Labels: failures are reported inside (system line / error frame); never thrown, so SQS never redelivers them.
    if (job.kind === 'label' || job.kind === 'labels') {
      try { console.log(`github_${job.kind}`, job.thread, job.kind === 'label' ? await labelIssue(d, job) : await repoLabels(d, job)); }
      catch (e) { console.error(`github_${job.kind}_failed`, job.thread, (e as Error)?.message?.slice(0, 200)); }
      continue;
    }
    // Thread info panel: the PRs of the pushed heads, answered to the connection inside (errors per repo); never retried.
    if (job.kind === 'prs') {
      try { console.log('github_prs', job.thread, await detailsPrs(d, job)); }
      catch (e) { console.error('github_prs_failed', job.thread, (e as Error)?.message?.slice(0, 200)); }
      continue;
    }
    // Merge button: refusals and failures are reported inside (system line / error frame); never retried.
    if (job.kind === 'mergeinfo' || job.kind === 'merge') {
      try { console.log(`github_${job.kind}`, job.thread, job.kind === 'merge' ? await mergePr(d, job) : await mergeInfo(d, job)); }
      catch (e) { console.error(`github_${job.kind}_failed`, job.thread, (e as Error)?.message?.slice(0, 200)); }
      continue;
    }
    // Flow config, git source: refusals and failures are answered to the editor inside; never retried (a commit twice
    // would be a second commit).
    if (job.kind === 'flowcommit' || job.kind === 'flowgit') {
      try { console.log(`github_${job.kind}`, job.space, job.kind === 'flowcommit' ? await flowCommit(d, job) : await flowGitRead(d, job)); }
      catch (e) { console.error(`github_${job.kind}_failed`, job.space, (e as Error)?.message?.slice(0, 200)); }
      continue;
    }
    // Memory import: answered to the admin inside (refusals and failures included); never retried. A redelivery would
    // be harmless anyway: entries are written only if absent.
    if (job.kind === 'memimport') {
      try { console.log('github_memimport', job.space, JSON.stringify(await memoryImport(d, job))); }
      catch (e) { console.error('github_memimport_failed', job.space, (e as Error)?.message?.slice(0, 200)); }
      continue;
    }
    // Radar pass: sources read, then the pass delivered (once: the hidden topic records it); never retried.
    if (job.kind === 'radarpass') {
      try { console.log('github_radarpass', job.space, await radarPassSources(d, job)); }
      catch (e) { console.error('github_radarpass_failed', job.space, (e as Error)?.message?.slice(0, 200)); }
      continue;
    }
    // Approved "Create this issue?" card: failures are shown on the card inside, never retried.
    // Approved board plan: failures are shown on the card inside, retried only by hand.
    if (job.kind === 'newplan') {
      try { console.log('github_newplan', job.thread, await createPlanIssues(d, job)); }
      catch (e) { console.error('github_newplan_failed', job.thread, (e as Error)?.message?.slice(0, 200)); }
      continue;
    }
    if (job.kind === 'newissue') {
      try { console.log('github_newissue', job.thread, await createProposedIssue(d, job)); }
      catch (e) { console.error('github_newissue_failed', job.thread, (e as Error)?.message?.slice(0, 200)); }
      continue;
    }
    try { console.log('github_issue', job.thread, await createIssue(d, job)); }
    catch (e) { console.error('github_issue_failed', job.thread, (e as Error)?.message?.slice(0, 200)); await reportIssueFailure(d, job.thread, (e as Error)?.message).catch(() => {}); }
  }
};
