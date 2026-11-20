// Hub router: pure logic, injected I/O (Store, Sender) for the tests.
// Security: everything is refused by default; space membership is checked here, server-side,
// from the principal established by the authorizer, never from what the client claims.
import { frameKind } from './throttle.ts';
import { type HiddenOrigin, type LeadRecalled, type HiddenUsage, type Usage, DELETED_TITLE, FAMILY_DEPTH, SPAWNED_CONTEXT_MAX, type SpawnedThread, MAX_TEXT, THREADS_PAGE, topicText, generalId, subtopicFirstId, AMBIENT_MAX, cleanHeading, MAX_STATUS, MAX_ACTIVITY, MAX_ACTION, ASK_TEXT_MAX, MAX_FILES, MAX_ABOUT, MAX_SPACES, SPACE_ID_RE, RESERVED_SPACES, AGENT_RE, REACTIONS, RESOURCE_RE, MAX_PARALLEL, MAX_RESOURCES, DEFAULT_PARALLEL, GH_LOGIN_RE, MAX_IDENTITIES, typedResource, validResourceRule, VETTING_LABEL, validLabel, MERGE_COLUMN, type Driver, type IssueContext, validRole, validAvatar, type DirectoryPerson, type Parallel, type ResourceLock, type SpaceSettings, type FileRef, type Thread, type HubFrame, type Message, type Person, type Principal, type PublicThread, type SpaceInfo, type ThreadSummary, cleanTurnSummary, type GhSnapshot, type Outcome, type Pin, type Mute, type SeenMark, SEEN_MAX, type Reaction, type AgentLock, type QueuedTalk, type AgentPlugin, type SearchHit, INLINE_IMAGE_MIME, INLINE_AUDIO_MIME, INLINE_VIDEO_MIME, maxFileBytes, MAX_PUSH_DEVICES, type PushSub, REPO_RE, MAX_REPOS, MAX_REPO_ORGS, SHA_RE, BRANCH_RE, type ThreadEvent, CI_MAX_COMMITS, CI_MAX_WATCHES, CI_DEADLINE_MS, type FlowRecord, type FlowVersion, type FlowVersionMeta, type FlowAgentStatus, type FlowAgentState, type FlowPilot, isApprovalAsk } from '../../protocol/frames.ts';
import { type FlowDef } from '../../protocol/flowcfg.ts';
import { type FlowSource, type FlowTeam } from '../../protocol/flowteam.ts';
import { stopCi, withPill, type StoredCiWatch } from './ci.ts';
import { background, type StoredBgWatch } from './background.ts';
import { logEvent, pushedHeads, threadDetails, type DetailsRows } from './details.ts';
import { becameYours, pushEndpointOk, pushId, validPushSub, type PushJob, type StoredPush } from './push.ts';
import { PLUGIN_VERSION_RE, compareVersions, isUpdateBlock, isCacheTtl, type CacheTtl, stuckOf, latestFor } from '../../protocol/plugin.ts';
import { SECRET_CT_MAX, SECRET_CT_RE, SECRET_IV_RE, SECRET_KEY_RE, SECRET_NAME_RE, isSecretKind, type SecretStatus } from '../../protocol/secret.ts';
import { deletable, editBlock, erasedByEdit } from '../../protocol/edit.ts';
import { VOICE_ASK_TEXT, type IceServer } from '../../protocol/preview.ts';
import { messageTo, withPerson } from '../../protocol/notify.ts';
import { idleOf, mergePresence, type LastSeen, type Presence } from '../../protocol/presence.ts';
import { mentionedIds } from '../../client/src/recent.ts';
import { agentMentions, withoutMuted } from './mute.ts';
import { SEARCH_MAX_Q, SEARCH_MAX_HITS, searchTerms, searchable, matchesAll, fold, snippet } from '../../protocol/search.ts';
import { type ThreadActivity } from './metrics.ts';
import { applyFact, computeState, initialFacts, type FactEvent } from './state.ts';
import { addUsage, parseUsage } from './usage.ts';
import { tagMaxOf } from '../../protocol/tags.ts';
import { relayMaxOf, validRelayMax, type RelayState } from '../../protocol/relay.ts';
import { relayMentions } from './relay.ts';
import { backstageAgent, visibleAgents, MEMORY_MODES, validBatch, validCompact, validTagMax, type MemoryVocab, type MemoryBatch, type MemoryCompact, type MemoryConfig, type MemoryEntry,
  type MemoryMode, type MemoryVerdict } from '../../protocol/memory.ts';
import type { Routine } from '../../protocol/routines.ts';
import { routineFrame } from './routines.ts';
import { PREVIEW_AGENT, PREVIEW_HUMAN, PREVIEW_VISITOR_ADMIN, previewAgent, previewHuman, previewVisitor, visitorLink } from './preview.ts';
import { appletHuman, appletList, appletPropose, appletRole, talkFor, talksTo } from './applets.ts';
import { appletPrompt, canLaunch, type Applet } from '../../protocol/applets.ts';
import { exchangeTurnEnded } from './exchanges.ts';
import type { Correspondent, Exchange, ExchangeConfig, ExchangeMail } from '../../protocol/exchanges.ts';
import { radarConfigFrame, radarGo, radarRunEnded } from './radar.ts';
import { nextKickoff } from './nextsteps.ts';
import { modulesOn, modulesOffOf, modulesInOf, modulesSet, validModules, type Module } from '../../protocol/modules.ts';
import { agentModule, humanModule } from './modules.ts';
import { captureLeads, recallFor } from './leads.ts';
import { agentTags, tagVocabFor, withAgentTags } from './tags.ts';
import { flowConfig, flowConfigStatus, flowDone, flowPilotFrame, flowState, flowStateFrame, flowStatesOf, flowSwitch, flowTask, pushFlowConfig, pushPilots, wakeFlow } from './flowhub.ts';
export { bundleSha, flowTarget, pushFlowConfig, wakeFlow } from './flowhub.ts';
import { acquire, dropResources, freeResources, mutateResource, pump } from './resources.ts';
import { RELAUNCH_TEXT, queuedNow, relaunchOf, talkWhileQueued, type Talk } from './queuetalk.ts';
import { elevationAction, requestElevation } from './elevation.ts';
import { batchOf, compactOf, memoryAgentOf, memoryMode, memoryTurnEnded, memPendingFor, turnMemory } from './memory.ts';
export { memoryPass, wakeMemoryAgent } from './memory.ts';
import { type RadarConfig, type Signal } from '../../protocol/radar.ts';
import { agentTopic, approveIssue, askItems, openSubtopic, proposal, propose, proposeAbout, proposeIssue, titlesInTurn, topicTitle, wakeTitler, wantsHeading } from './cards.ts';
export { TITLE_SOURCE_MAX, titlePrompt } from './cards.ts';
import { advancePlan, planAction, proposePlan } from './plans.ts';
import { introspect } from './introspect.ts';
import { agentInvite, agentRemove, agentRevoke, invitesOf, join } from './agents.ts';
import { invite, member, profile } from './members.ts';
export { codeHash } from './agents.ts';

export interface Space { id: string; members: string[]; trusted: string[]; defaultAgent: string; agents?: string[]; names?: Record<string, string>;
  contributors?: string[];             // members the agents answer in the Lounge only (role between member and lead = `trusted`)
  nontech?: string[];                  // members flagged « not technical » by the admin: agents talk to them without jargon
  admins?: string[];                   // space admins (members), named by a global admin only: this space's settings, never the global ones
  repoOrgs?: string[];                 // GitHub owners a global admin validated for this space: its space admins attach their repos only
  modulesOff?: string[];               // optional sections the admin turned off (protocol/modules.ts); missing = all on
  modulesIn?: string[];                // opt-in modules the admin turned on (protocol/modules.ts OPT_IN); missing = none
  roles?: Record<string, string>;      // members' function, written by each person (profile), like `names`
  agentRoles?: Record<string, string>; // agents' function (admin, Settings); display only, never sent to agents
  avatars?: Record<string, string>;      // members' photo (validAvatar), written by each person (profile), like `roles`
  agentAvatars?: Record<string, string>; // agents' photo (admin, Settings), per space like `agentRoles`
  github?: { owner: string; project: number; repos: string[] };
  about?: string; // space description for the agent (project, repos): written by an admin, never by a member
  name?: string;   // display name (the id otherwise)
  archived?: { by: string; at: number }; // hidden from everyone, threads kept, agents unplugged
  parallel?: Parallel; // parallel work and shared resources (admin); missing = DEFAULT_PARALLEL
  driver?: Driver;       // who drives the work (admin); missing = briefling
  identities?: string[]; // GitHub logins of the board's agents (admin), trusted authors for the board sync
  repos?: string[];      // attached repos (admin, Settings); missing = the legacy `github.repos` (reposOf)
  ci?: boolean;          // CI follow-up (admin); missing = off
  memory?: MemoryMode;   // gate of the project memory (admin); missing = agent
  memoryAgent?: string;  // agent reviewing proposals (admin); missing or not in the space = the agent in charge
  memoryHidden?: boolean; // the memory agent is backstage (admin; protocol/memory.ts backstageAgent); missing = off
  memoryBatch?: MemoryBatch;     // when the memory agent reviews (admin); missing = DEFAULT_MEMORY_BATCH
  memoryCompact?: MemoryCompact; // when the memory agent compacts (admin); missing = DEFAULT_MEMORY_COMPACT
  tagMax?: number;               // cap of the tag vocabulary (admin); missing = TAG_MAX_DEFAULT
  relayMax?: number;             // agents waking each other (admin, protocol/relay.ts); missing = RELAY_MAX_DEFAULT
  memPending?: number;  // memory entries waiting for a human (badge), kept by countPending, outside the settings version
  memArrivals?: number; // running count of entries that started waiting for a human (reminder every MEMORY_NUDGE_EVERY)
  version?: number } // guard of the admin's writes (missing = 0)
// managed: created by an agent invitation (the hub owns its Cognito client and deletes it with its last space).
// connectedAt: first subscribe of the instance (shown as « connected » on its invitation).
export interface Instance { id: string; spaces: string[]; agents: string[]; managed?: boolean; connectedAt?: number;
  plugin?: AgentPlugin } // the release its last connection reported (subscribe), missing if never reported
/** Agent invitation as stored: keyed by the SHA-256 of the code, never the code itself. */
export interface StoredAgentInvite { hash: string; id: string; space: string; agent: string; by: string; at: number; expiresAt: number;
  state: 'pending' | 'used' | 'revoked'; usedAt?: number; instance?: string;
  renew?: true } // new link for an agent already served by an invited instance: the join replaces that instance
/** Cognito app clients of invited agents (client credentials, instance scope), this pool only. */
export interface AgentClients {
  create(agent: string): Promise<{ id: string; secret: string; tokenUrl: string }>;
  remove(id: string): Promise<void>;
}
/** away: the human connection's last `presence.set` was 'away' (protocol/presence.ts), idle = its last input then (ms);
 *  a new subscription starts active. */
// watch: the conversation this human connection has on screen (`browser.watch`, protocol/browser.ts), lost at a re-subscribe.
export interface Sub { connId: string; kind: Principal['kind']; principal: string; away?: boolean; idle?: number; watch?: string }

export interface Store {
  getSpace(id: string): Promise<Space | null>;
  /** Every space (archived included), through the index kept at creation. */
  listSpaces(): Promise<Space[]>;
  /** Global admin role (create and configure spaces): written outside the hub, never by a frame. */
  isAdmin(user: string): Promise<boolean>;
  /** Creates the space and adds it to the index; false if it already exists. */
  createSpace(s: Space): Promise<boolean>;
  /** Writes the settings (name, about, members, trust, agents, archiving), not `github`; false if the version moved. */
  updateSpace(s: Space, expectedVersion: number): Promise<boolean>;
  /** Display name and function of one member in one space (`names[user]`, `roles[user]`, '' = removed; version
   * untouched); false if not a member anymore. */
  setProfile(space: string, user: string, name: string, role: string, avatar?: string): Promise<boolean>; // avatar missing = unchanged, '' = removed
  listInstances(): Promise<Instance[]>;
  /** Opens (on) or closes the space to an agent instance. */
  bindInstance(id: string, space: string, on: boolean): Promise<void>;
  getInstance(id: string): Promise<Instance | null>;
  /** Creates the instance and adds it to the index; false if it already exists. */
  createInstance(i: Instance): Promise<boolean>;
  /** Deletes the instance and removes it from the index (its access is checked against this record). */
  deleteInstance(id: string): Promise<void>;
  /** Records the first subscribe of the instance (no-op once set). */
  markInstanceConnected(id: string, at: number): Promise<void>;
  putAgentInvite(i: StoredAgentInvite): Promise<void>;
  getAgentInvite(hash: string): Promise<StoredAgentInvite | null>;
  listAgentInvites(): Promise<StoredAgentInvite[]>;
  /** Pending -> used, only if still pending and not expired at `now`; false otherwise (a concurrent join lost). */
  claimAgentInvite(hash: string, now: number): Promise<boolean>;
  /** Conditional update: applied only if the state is still `from`. */
  setAgentInvite(hash: string, from: StoredAgentInvite['state'], patch: Partial<Pick<StoredAgentInvite, 'state' | 'instance'>>): Promise<boolean>;
  /** Records the plugin release reported at connect; ignored if an equal or later `at` is already there. */
  setInstancePlugin(id: string, plugin: AgentPlugin): Promise<void>;
  putSub(space: string, sub: Sub): Promise<void>;
  listSubs(space: string): Promise<Sub[]>;
  deleteSub(space: string, connId: string): Promise<void>;
  /** Sets `away` (and `idle` when away) on that subscription only if it still exists; false otherwise (never recreates a
   *  dropped one). */
  setSubAway(space: string, connId: string, away: boolean, idle?: number): Promise<boolean>;
  /** Sets (or removes, null) the conversation that subscription has on screen, only if it still exists. */
  setSubWatch(space: string, connId: string, thread: string | null): Promise<boolean>;
  /** Last seen of those principals in the space (`SPACE#<s>/SEEN#<id>`), only moved forward (an older `at` is ignored). */
  markSeen(space: string, ids: string[], at: number): Promise<void>;
  /** Every last seen recorded in the space, by principal. */
  lastSeen(space: string): Promise<LastSeen>;
  /** Spaces this connection subscribed to (some may have been dropped since: `setSubAway` says so). */
  connSpaces(connId: string): Promise<string[]>;
  /** Connections of an instance that subscribed without a list (`*`): they also get the spaces opened to it later. */
  putInstanceConn(instance: string, connId: string): Promise<void>;
  listInstanceConns(instance: string): Promise<string[]>;
  getThread(id: string): Promise<StoredThread | null>;
  /** Optimistic write: fails (false) if the version moved. */
  putThread(thread: StoredThread, expectedVersion: number | null): Promise<boolean>;
  /** Creates or replaces the text of a message (original timestamp kept). `null` if `m.rev` is outdated. */
  upsertMessage(m: Message): Promise<{ created: boolean; message: Message } | null>;
  /** The `n` latest messages, oldest first; with `before`, the `n` messages just older than that message id. */
  lastMessages(thread: string, n: number, before?: string): Promise<Message[]>;
  /** Search: thread index rows and messages of at least `spaces` (the store may return more: the router filters by membership). */
  searchCorpus(spaces: string[]): Promise<{ threads: SearchThread[]; messages: SearchMessage[] }>;
  /** Threads of the space by activity (`updatedAt` descending, GSI), `limit` at most, strictly after `after`; `next` = null at the end. */
  pageThreads(space: string, limit: number, after: ThreadCursor | null): Promise<{ threads: PublicThread[]; next: ThreadCursor | null }>;
  /** Threads that must always be listed whatever their age: Your turn and In progress (archived excluded). */
  activeThreads(space: string): Promise<PublicThread[]>;
  /** Public view of these threads of the space (missing ones skipped). */
  threadsByIds(space: string, ids: string[]): Promise<PublicThread[]>;
  /** Metrics: every thread of the space with `updatedAt >= since` (whole partition, public view). */
  listThreads(space: string, since: number): Promise<PublicThread[]>;
  /** Metrics: opener and messages (author, date, card opened) of a thread, oldest first. */
  threadActivity(thread: string): Promise<ThreadActivity>;
  getSummary(thread: string): Promise<ThreadSummary | null>;
  /** Writes the summary if `s.at` is more recent than the stored one; false otherwise. */
  putSummary(s: ThreadSummary): Promise<boolean>;
  putAttachment(a: Attachment): Promise<void>;
  getAttachments(ids: string[]): Promise<Attachment[]>;
  /** Binds the attachment to a message; false if it already is (one attachment = one message). */
  claimAttachment(id: string, msg: string): Promise<boolean>;
  getGithub(space: string): Promise<GhSnapshot | null>;
  putGithub(s: GhSnapshot): Promise<void>;
  /** Personal pins of `user` in `space`. */
  listPins(user: string, space: string): Promise<Pin[]>;
  /** Writes the pin if `p.at` is more recent than the stored one; false otherwise. */
  putPin(user: string, p: Pin): Promise<boolean>;
  /** Members who muted `space` (hub/src/mute.ts). */
  mutedIn(space: string): Promise<string[]>;
  /** Mutes of `user` among these spaces (absent = never set). */
  mutesOf(user: string, spaces: string[]): Promise<Mute[]>;
  /** Writes the mute if `m.at` is more recent than the stored one; false otherwise. */
  putMute(user: string, m: Mute): Promise<boolean>;
  /** Read marks of `user` for these threads of `space` (absent = never marked). */
  seenMarks(user: string, space: string, threads: string[]): Promise<SeenMark[]>;
  /** Writes the mark if `m.at` is more recent than the stored one; false otherwise. */
  putSeen(user: string, space: string, m: SeenMark): Promise<boolean>;
  listReactions(thread: string): Promise<Reaction[]>;
  /** Writes the reaction if `r.at` is more recent than the stored one (same thread, message, emoji, person); false otherwise. */
  putReaction(r: Reaction): Promise<boolean>;
  getMessage(thread: string, id: string): Promise<Message | null>;
  /** General message `id` gets `subtopic` = the topic opened from it; false if the message is gone or already has one. */
  setSubtopic(thread: string, id: string, topic: string): Promise<boolean>;
  /** Removes a message (partial answer erased by an edit); no-op when it is already gone. */
  deleteMessage(thread: string, id: string): Promise<void>;
  /** Deleted by its author: text emptied, files and edit mark removed, `deleted` set, `rev` written, only if the stored
   *  rev is still `rev - 1` (else null). The item and its sort key stay. */
  eraseMessage(thread: string, id: string, rev: number, deleted: { at: number; by: string }): Promise<Message | null>;
  /** The agent's hand in the space (one thread at a time), null if never set. */
  getLock(space: string, agent: string): Promise<StoredLock | null>;
  /** Optimistic write: fails (false) if the version moved (null = creation). */
  putLock(lock: StoredLock, expectedVersion: number | null): Promise<boolean>;
  listLocks(space: string): Promise<StoredLock[]>;
  /** A shared resource of the space, null if never used. */
  getResource(space: string, resource: string): Promise<StoredResource | null>;
  /** Optimistic write: fails (false) if the version moved (null = creation). */
  putResource(r: StoredResource, expectedVersion: number | null): Promise<boolean>;
  listResources(space: string): Promise<StoredResource[]>;
  /** Web Push devices of a person (`USER#<sub>/PUSH#<id>`), any order. */
  listPushes(user: string): Promise<StoredPush[]>;
  /** Creates or refreshes a device (same id = same endpoint: overwritten). */
  putPush(user: string, p: StoredPush): Promise<void>;
  deletePush(user: string, id: string): Promise<void>;
  /** Agent preview sessions (`PREVIEW#<session>`, protocol/preview.ts), expired by the table's TTL. */
  putPreview(p: StoredPreview): Promise<void>;
  getPreview(session: string): Promise<StoredPreview | null>;
  deletePreview(session: string): Promise<void>;
  /** Visitor link of a preview line (`VISITOR#<msg>`, protocol/preview.ts « Visitor link »), expired by the TTL. */
  putVisitor(v: StoredVisitor): Promise<void>;
  getVisitor(msg: string): Promise<StoredVisitor | null>;
  deleteVisitor(msg: string): Promise<void>;
  /** CI follow-up: creates or replaces the watch of `w.thread` + `w.repo` (a new sha supersedes the old one). */
  putCiWatch(w: StoredCiWatch): Promise<void>;
  /** Every open watch (one Query: the poller's CI pass). */
  listCiWatches(): Promise<StoredCiWatch[]>;
  /** Deletes the watch only if it still follows `sha`; false otherwise (superseded, or already ended). */
  deleteCiWatch(thread: string, repo: string, sha: string): Promise<boolean>;
  /** Background work: creates or renews the deadline of `w.thread` (hub/src/background.ts). */
  putBgWatch(w: StoredBgWatch): Promise<void>;
  /** Every background deadline (one Query: the poller's pass). */
  listBgWatches(): Promise<StoredBgWatch[]>;
  /** Deletes the deadline of `thread`, only if it is still `deadline` (null = whatever it is); false otherwise. */
  deleteBgWatch(thread: string, deadline: number | null): Promise<boolean>;
  /** Thread info panel: records a timeline event (`THREAD#<thread>/EV#<at>#<id>`). */
  putEvent(thread: string, id: string, ev: ThreadEvent): Promise<void>;
  /** Thread info panel: one read of the thread's partition (first message date, attached files, timeline events). */
  threadDetails(thread: string): Promise<DetailsRows>;
  /** Project memory: every entry of the space (any status), one partition. */
  listMemory(space: string): Promise<MemoryEntry[]>;
  getMemory(space: string, id: string): Promise<MemoryEntry | null>;
  /** Optimistic write: fails (false) if the version moved (null = creation, false if the id exists). */
  putMemory(e: MemoryEntry, expectedVersion: number | null): Promise<boolean>;
  /** Atomic ADD on the space's META: `memPending` += delta, `memArrivals` += 1 when `arrived`; the new values. */
  addMemoryPending(space: string, delta: number, arrived: boolean): Promise<{ pending: number; arrivals: number }>;
  /** Repair of `memPending` (recounted from the entries). */
  setMemoryPending(space: string, n: number): Promise<void>;
  /** Memory agent batches of the space (`SPACE#<s>` / `MEMCFG`), null if never set. */
  getMemoryConfig(space: string): Promise<MemoryConfig | null>;
  /** Optimistic write: fails (false) if the version moved (null = creation). */
  putMemoryConfig(c: MemoryConfig, expectedVersion: number | null): Promise<boolean>;
  /** Tag vocabulary of the space's memory (`SPACE#<s>` / `MEMTAGS`), null if never set. */
  getMemoryVocab(space: string): Promise<MemoryVocab | null>;
  /** Optimistic write: fails (false) if the version moved (null = creation). */
  putMemoryVocab(v: MemoryVocab, expectedVersion: number | null): Promise<boolean>;
  /** Flow editor: versions of the space's flow, newest first, at most `limit` (meta only). */
  listFlowVersions(space: string, limit: number): Promise<FlowVersionMeta[]>;
  /** One version (null = the latest); null if none. */
  getFlowVersion(space: string, version: number | null): Promise<FlowVersion | null>;
  /** Writes a new version; false if that version number already exists (another save got there first). */
  putFlowVersion(space: string, v: FlowVersion): Promise<boolean>;
  /** The latest version's `approved` column (the Merge button's) and work columns (workColumns), null if the space has no flow config. */
  flowColumns(space: string): Promise<{ approved: string | null; work: string[] } | null>;
  /** Each flow agent's last answer to a pushed config (`SPACE#<s>` / `FLOWSTAT#<agent>`). */
  listFlowStatus(space: string): Promise<FlowAgentStatus[]>;
  putFlowStatus(space: string, s: FlowAgentStatus): Promise<void>;
  /** Git source: the bundle last read at the branch head (`SPACE#<s>` / `FLOWGIT`), what the agents get. */
  getFlowGit(space: string): Promise<FlowGit | null>;
  putFlowGit(space: string, g: FlowGit): Promise<void>;
  /** Board-driven space: issue (`<repo>#<number>`) -> its thread. */
  issueThreads(space: string): Promise<Record<string, string>>;
  /** Binds the issue to `thread` unless another thread already has it; returns the thread that has it. */
  claimIssueThread(space: string, key: string, thread: string): Promise<string>;
  /** Flow: one closed board task (`SPACE#<s>` / `FLOWREC#<start>#<agent>`): a replay of the same task overwrites it. */
  putFlowRecord(r: StoredFlowRecord): Promise<void>;
  /** The latest closed tasks of the space, newest (by start) first. */
  listFlowRecords(space: string, limit: number): Promise<StoredFlowRecord[]>;
  /** Flow agents' live states (`SPACE#<s>` / `FLOWLIVE#<agent>`): the last `flow.state` of each. */
  listFlowStates(space: string): Promise<FlowAgentState[]>;
  putFlowState(space: string, st: FlowAgentState): Promise<void>;
  /** Takes the space's wake slot (`SPACE#<s>` / `FLOWWAKE`) unless one was taken less than `windowMs` before `now`. */
  claimFlowWake(space: string, now: number, windowMs: number): Promise<boolean>;
  /** Counts one topic opened by `agent` on its own in `space` on UTC `day` (`SPACE#<s>` / `AGENTTOPICS#<agent>#<day>`,
   *  expires after 2 days); false, nothing counted, once `cap` are counted. */
  countAgentTopic(space: string, agent: string, day: string, cap: number): Promise<boolean>;
  /** Routines of the space (`SPACE#<s>` / `ROUTINE#<id>`). */
  listRoutines(space: string): Promise<Routine[]>;
  /** Optimistic write: fails (false) if the version moved (null = creation, false if the id exists). */
  putRoutine(space: string, r: Routine, expectedVersion: number | null): Promise<boolean>;
  deleteRoutine(space: string, id: string): Promise<void>;
  /** Records of a module (hub/src/modules.ts): `SPACE#<s>` / `<kind>#<id>`, JSON `data` + `version`, conditional
   *  writes (`expectedVersion` null = must not exist). Every page read (a module may keep up to a few thousand). */
  listItems<T extends { id: string; version: number }>(space: string, kind: string): Promise<T[]>;
  getItem<T extends { id: string; version: number }>(space: string, kind: string, id: string): Promise<T | null>;
  putItem(space: string, kind: string, x: { id: string; version: number }, expectedVersion: number | null): Promise<boolean>;
  deleteItem(space: string, kind: string, id: string): Promise<void>;
  /** Applets of the space (`SPACE#<s>` / `APPLET#<id>`, hub/src/applets.ts); same optimistic write as routines. */
  listApplets(space: string): Promise<Applet[]>;
  putApplet(space: string, a: Applet, expectedVersion: number | null): Promise<boolean>;
  deleteApplet(space: string, id: string): Promise<void>;
  /** Mail exchanges (`EXCH#<s>`, protocol/exchanges.ts, hub/src/exchanges.ts). Correspondents: `C#<id>`. */
  listCorrespondents(space: string): Promise<Correspondent[]>;
  /** Optimistic write: false if the version moved (null = creation). */
  putCorrespondent(c: Correspondent, expectedVersion: number | null): Promise<boolean>;
  deleteCorrespondent(space: string, id: string): Promise<void>;
  /** Exchanges (`X#<id>`), every one of the space (unsorted). */
  listExchanges(space: string): Promise<Exchange[]>;
  getExchange(space: string, id: string): Promise<Exchange | null>;
  putExchange(x: Exchange, expectedVersion: number | null): Promise<boolean>;
  /** Mails of an exchange (`M#<exchange>#<date>#<id>`), oldest first. */
  listExchangeMails(space: string, exchange: string): Promise<ExchangeMail[]>;
  /** Exchange holding a mail (`MID#<id>`), null if unknown. */
  getMailOwner(space: string, mail: string): Promise<string | null>;
  /** Writes the mail and its `MID#` pointer together; false (nothing written) if the mail is already known. */
  putExchangeMail(m: ExchangeMail): Promise<boolean>;
  /** Deletes the exchange, its mails and their `MID#` pointers. */
  deleteExchange(space: string, id: string, mails: { id: string; date: number }[]): Promise<void>;
  /** Settings › Correspondents › summary agent and its latest run (`CFG`), null if never saved. */
  getExchangeConfig(space: string): Promise<ExchangeConfig | null>;
  putExchangeConfig(c: ExchangeConfig, expectedVersion: number | null): Promise<boolean>;
  /** Radar signals (`SPACE#<s>` / `SIGNAL#<id>`, protocol/radar.ts): newest seen first, at most `limit`. */
  listSignals(space: string, limit: number): Promise<Signal[]>;
  getSignal(space: string, id: string): Promise<Signal | null>;
  /** Optimistic write: false if the version moved (null = creation, false if the id exists). */
  putSignal(s: Signal, expectedVersion: number | null): Promise<boolean>;
  /** Settings › Radar of the space (`SPACE#<s>` / `RADARCFG`); optimistic write (null = creation). */
  getRadarConfig(space: string): Promise<RadarConfig | null>;
  putRadarConfig(c: RadarConfig, expectedVersion: number | null): Promise<boolean>;
  /** Spend of hidden turns (`SPACE#<s>` / `HIDDENCOST#<day>#<origin>#<agent>`): one row per UTC day, origin and agent. */
  getHiddenUsage(space: string, day: string, origin: HiddenOrigin, agent: string): Promise<HiddenUsage | null>;
  putHiddenUsage(x: HiddenUsage, expectedVersion: number | null): Promise<boolean>;
  /** Rows of the UTC days >= `fromDay` ('' = all). */
  listHiddenUsage(space: string, fromDay: string): Promise<HiddenUsage[]>;
  /** Who pilots each flow agent (`SPACE#<s>` / `FLOWPILOT#<agent>`, docs/design-flow.md § 13). */
  listFlowPilots(space: string): Promise<StoredPilot[]>;
  /** A switch link: written unless the agent is already piloted (false then). */
  putFlowPilot(space: string, p: StoredPilot): Promise<boolean>;
  /** Redeems a link: `next` replaces the record only if it is pending, with this code hash, not expired at `now`. */
  claimFlowPilot(space: string, agent: string, hash: string, now: number, next: StoredPilot): Promise<boolean>;
  deleteFlowPilot(space: string, agent: string): Promise<void>;
}
/** hash: SHA-256 of the switch code (kept once piloted, so a replay of the same code is answered again). */
export type StoredPilot = FlowPilot & { hash?: string };
export type StoredFlowRecord = FlowRecord & { space: string; agent: string; thread: string | null; ref: string; key: string; at: number };
/** `by`: trusted human who queued each thread (author of the turn started when its turn comes);
 *  `delivered`: per holder, `at` of the last message delivered to it (one delivery, never two). */
export type SearchThread = Pick<PublicThread, 'id' | 'space' | 'title' | 'kind' | 'updatedAt'>;
export type SearchMessage = Pick<Message, 'id' | 'thread' | 'author' | 'type' | 'text' | 'files' | 'at'>;
/** `talk`: queued threads that had talk turns while waiting (hub/src/queuetalk.ts), hub only. */
export interface StoredLock extends AgentLock { by: Record<string, string>; delivered: Record<string, number>; talk?: Record<string, Talk> }
/** `by`: per parked thread, the trusted human who triggered the parked turn (author of the resume message). */
export interface StoredResource extends ResourceLock { by: Record<string, string> }
export interface Sender { send(connId: string, frame: HubFrame): Promise<boolean>; close?(connId: string): Promise<void> }
/** One EventBridge schedule per routine: `put` creates or replaces it (enabled or not), `remove` ignores a missing one. */
export interface Schedules { put(name: string, cron: string, enabled: boolean, input: string, opts?: ScheduleOpts): Promise<void>; remove(name: string): Promise<void> }
/** `tz`: zone the expression is read in (default Europe/Paris); `once`: a one-shot `at()` deleted by the scheduler after it fired. */
export interface ScheduleOpts { tz?: string; once?: true }
/** Position in the thread list (GSI key of the last thread of a page). */
export interface ThreadCursor { updatedAt: number; id: string }
/** Attachments: database record (Store) + S3 objects (Files). */
export interface Attachment extends FileRef { space: string; by: string; at: number; msg?: string }
export interface Files {
  presignPost(key: string, mime: string, size: number): Promise<{ url: string; fields: Record<string, string> }>;
  presignGet(key: string, f: FileRef): Promise<string>;
  /** Real size of the object, null if it was not uploaded (yet). */
  size(key: string): Promise<number | null>;
  /** Deletes the object (a deleted message's attachment); no-op when it is already gone. */
  remove(key: string): Promise<void>;
  /** Writes a private text object (a mail body), SSE-S3 like the bucket. */
  putText?(key: string, text: string): Promise<void>;
  /** Reads a private text object back (a mail body for the summary agent), null when missing. */
  getText?(key: string): Promise<string | null>;
  /** Reads an object's bytes (a pinned applet's icon upload, hub/src/pinapp.ts), null when missing. */
  getBytes?(key: string): Promise<Uint8Array | null>;
}
/** Public files of the site (the pinned applets' manifests and icons, hub/src/pinapp.ts): only keys `pinFileOk` accepts. */
export interface Site { put(key: string, body: Uint8Array | string, type: string): Promise<void>; remove(key: string): Promise<void> }
/** Human accounts (Cognito). Only reached by the admin's `space.invite`. */
export interface Users {
  /** Ids (`sub`) of the accounts whose e-mail is `email` (compared case-insensitively). */
  findByEmail(email: string): Promise<string[]>;
  /** Creates the account (user name = `email`), Cognito mails the invitation; created false = the user name already existed (no mail). */
  invite(email: string): Promise<{ id: string; created: boolean }>;
  /** Accounts that never signed in (temporary password not changed yet): id -> creation time (ms). */
  pending(): Promise<Map<string, number>>;
  /** Mails a new temporary password to an account that never signed in (its validity restarts); false = no such pending account. */
  resend(id: string): Promise<boolean>;
}
/** Cognito temporary password validity (pool setting, default): past it, the invitation can't be used anymore. */
export const INVITE_VALID_MS = 7 * 86_400_000;
export interface Deps { store: Store; sender: Sender; now(): number; newId(): string; files?: Files; site?: Site; queueSummary?(thread: string, at: number): Promise<void>;
  /** EventBridge Scheduler, one schedule per routine (Message Lambda only); absent = routines are never scheduled. */
  schedules?: Schedules;
  queueGithub?(job: GithubJob): Promise<void>; users?: Users; agentClients?: AgentClients;
  // Web Push: queue a push (thread became Your turn); the VAPID public key, null when none is configured.
  queuePush?(job: PushJob): Promise<void>; pushKey?(): Promise<string | null>;
  // Project memory, auto mode: tool-less model call judging a proposal (protocol/memory.ts). Throws = unavailable.
  classifyMemory?(text: string, sources: string[]): Promise<MemoryVerdict>;
  // Agent preview: TURN credentials for one peer of a session (KVS GetIceServerConfig, `peer` = KVS ClientId).
  // Missing = the stack has no TURN channel (`preview_off`).
  previewIce?(peer: string): Promise<IceServer[]>;
  // Temporary AWS elevation: synchronous call to the elevation Lambda of the management account (elevation/CONTRACT.md),
  // answer parsed. Missing = no elevation configured for this stack (`elevation_off`). Throws = unreachable.
  elevation?(payload: Record<string, unknown>): Promise<any> }
/** One preview session: who opened it from which connection, the agent connection the offer goes to, the agent's
 *  TURN credentials (5 min, handed over with the offer). */
export interface StoredPreview { session: string; space: string; thread: string; msg: string; agent: string; port?: number; device?: string; voice?: true;
  by: string; viewer: string; target: string; agentIce: IceServer[]; at: number; until?: number }
/** Visitor link of a line: sha256 (hex) of its secret, its deadline (ms), the lead who made it, the visitor's current
 *  session (closed when replaced). The authorizer reads `hash` and `until` (hub/src/handlers/authorizer.ts). */
export interface StoredVisitor { msg: string; space: string; thread: string; agent: string; hash: string; until: number; by: string; at: number; session?: string }
/**
 * GitHub Lambda jobs: create a thread's issue; create the issue of an approved "Create this issue?" card (`newissue`:
 * conversation, card, approver); poll a space now (switch to the board driver: the import starts at once);
 * add / remove a label of an issue thread (`id`: id of the system line that reports it, so a redelivery does nothing);
 * read the labels of its repo for one connection (picker).
 */
export type GithubJob = { kind: 'issue'; thread: string; repo: string; by: string } | { kind: 'poll'; space: string }
  | { kind: 'newissue'; thread: string; msg: string; by: string }
  // Approved board plan (\"Launch this plan?\" with a repo): creates its issues and their dependencies.
  | { kind: 'newplan'; thread: string; msg: string; by: string }
  | { kind: 'label'; id: string; thread: string; label: string; on: boolean; by: string }
  | { kind: 'labels'; thread: string; by: string; conn: string; client_id: string }
  | { kind: 'mergeinfo'; thread: string; by: string; conn: string; client_id: string }
  // Thread info panel: the PRs of the thread's pushed heads (details.ts), sent to that connection.
  | { kind: 'prs'; thread: string; by: string; conn: string; client_id: string }
  | { kind: 'merge'; id: string; thread: string; by: string; conn: string; client_id: string; repo: string; number: number; sha: string }
  // Flow config with a git source (hub/src/flowgit.ts): a save = a commit; a read = the branch head again.
  | { kind: 'flowcommit'; space: string; by: string; conn: string; client_id: string; base: number; head: string; def: FlowDef; team: FlowTeam; source: FlowSource }
  | { kind: 'flowgit'; space: string; by: string; conn: string; client_id: string; source?: FlowSource }
  // « Import from repo » of the Memory view (hub/src/memimport.ts).
  | { kind: 'memimport'; space: string; by: string; conn: string; client_id: string; repo: string }
  // Managed Radar pass with the bug or security detector (hub/src/radar.ts radarPassSources): read the sources, deliver.
  | { kind: 'radarpass'; space: string; thread: string };
/** Bundle read at a git source's branch head: blob ids kept so the next read fetches only what changed. error: the
 *  bundle is refused (path, size, credential, no config.yml): the agents keep what they had. */
export interface FlowGit { head: string; source: FlowSource; files: { path: string; text: string; blob: string }[]; at: number; error?: string }
/** The space's work is driven by an external board (no hand, no shared resources, no propose_thread). */
/** Is this optional section of the space on (protocol/modules.ts)? Off: hidden in the client, no agent context for it. */
export const modOn = (s: Pick<Space, 'modulesOff' | 'modulesIn'>, m: Module): boolean => modulesOn(s.modulesOff, s.modulesIn).includes(m);
/** The board drives the work: board driver chosen, a GitHub Project attached and the « board » module on. */
export const boardDriven = (s: Space) => s.driver === 'board' && !!s.github && modOn(s, 'board');
/** Attached repos: the admin's list (Settings), else the one written with the Project by `scripts/attach-github.ts`. */
export const reposOf = (s: Space): string[] => s.repos ?? s.github?.repos ?? [];
/**
 * Gate of the issue labels (router and GitHub Lambda: the queue is no proof): a trusted human of a board-driven space,
 * on a thread bound to an issue of one of its attached repos. Returns the refusal code, or the thread and its space.
 */
export async function labelTarget(deps: Pick<Deps, 'store'>, threadId: string, by: string): Promise<string | { thread: StoredThread; space: Space }> {
  const thread = await deps.store.getThread(threadId);
  const space = thread && await deps.store.getSpace(thread.space);
  if (!thread || !space || thread.kind === 'topic' || !canSee(space, by) || !space.trusted.includes(by)) return 'forbidden';
  if (!boardDriven(space)) return 'not_board';
  if (!thread.issue || !thread.board || !reposOf(space).includes(thread.issue.repo)) return 'no_issue';
  return { thread, space };
}
export const sameLabel = (a: string, b: string) => a.toLowerCase() === b.toLowerCase(); // GitHub names are case-insensitive
/** The column where humans merge: the flow config's `approved` column, MERGE_COLUMN when the space has none. */
export const mergeColumnOf = async (deps: Pick<Deps, 'store'>, space: string) => (await deps.store.flowColumns(space))?.approved ?? MERGE_COLUMN;
/** synced's columns of a board-driven space: the Merge column (mergeColumnOf) and the work columns (none without a flow
 *  config). Display only: the thread's hub state, its notifications and the metrics never read them. */
async function boardColumnsOf(deps: Pick<Deps, 'store'>, space: string): Promise<{ mergeColumn: string; workColumns?: string[] }> {
  const c = await deps.store.flowColumns(space);
  return { mergeColumn: c?.approved ?? MERGE_COLUMN, ...(c?.work.length ? { workColumns: c.work } : {}) };
}
/** Gate of the Merge button: `labelTarget`'s, and the issue OPEN in the flow's `approved` column (mergeColumnOf). */
export async function mergeTarget(deps: Pick<Deps, 'store'>, threadId: string, by: string): Promise<string | { thread: StoredThread; space: Space }> {
  const t = await labelTarget(deps, threadId, by);
  if (typeof t === 'string') return t;
  const b = t.thread.board!;
  return b.state === 'OPEN' && sameLabel(b.column ?? '', await mergeColumnOf(deps, t.space.id)) ? t : 'not_to_merge';
}

/** An agent's last turn event in a conversation (its own clock: two instances never share a time base). */
type AgentTurn = { at: number; active: boolean };
// `turns` (hub only): every agent of the space handed a turn in the conversation, with its last turn event. In a Lounge
// topic, any agent called there; in a work thread, the guests called by a mention, plus the owner once a guest came.
// Missing (no other agent came): the owner alone, from the thread's own turn fields.
// mentionAt: start of the agent turn whose @mention last rang (hub/src/mute.ts `agentMentions`, one per turn), hub only.
// relay: agents waking each other in this conversation (protocol/relay.ts), hub only.
export type StoredThread = Thread & { version: number; lastTurnAt: number; turns?: Record<string, AgentTurn>; flow?: FlowTask; mentionAt?: number; relay?: RelayState };
/**
 * Flow (hub only): the board task this issue thread holds (granted by `flow.task`, cleared by `flow.done`). `turn` = when
 * the hub granted it while its turn has not ended yet (0 after): that turn is `origin: flow`, not a trusted human's.
 */
export interface FlowTask { agent: string; ref: string; key: string; trigger: string; since: number; turn: number }
/** A granted task turn the plugin never started stops counting as one after this delay (crash between grant and start). */
export const FLOW_START_MS = 120_000;
/** The running (or about to run) turn of the thread is a board task's: trusted-human tools are refused in it. */
export const flowTurn = (t: StoredThread, now: number): boolean => !!t.flow?.turn && (t.facts.turnActive || now - t.flow.turn < FLOW_START_MS);
export const turnsOf = (t: StoredThread): Record<string, AgentTurn> => t.turns ?? { [t.owner]: { at: t.lastTurnAt, active: t.facts.turnActive } };
/** Agents in a turn in the conversation (the owner and the agents called there by a mention). */
export const workingIn = (t: StoredThread): string[] => Object.entries(turnsOf(t)).filter(([, x]) => x.active).map(([a]) => a);
/**
 * Guest of a work thread: an agent of the space called there by a mention, not in charge. It only answers: the hand,
 * the queue, the resources, the cards and the turn outcome (Your turn, summary) stay the owner's.
 */
const isGuest = (t: StoredThread, agent: string) => t.kind !== 'topic' && agent !== t.owner;
const GUEST_FRAMES = new Set(['turn.started', 'turn.ended', 'message.delta', 'message.final', 'status', 'ask', 'ask.choices', 'memory.search', 'memory.read', 'memory.propose',
  'space.threads', 'thread.read', 'space.metrics']);
/** `agent` is in a turn in the conversation (a tool frame such as `thread.propose` needs its own running turn). */
export const inTurn = (t: StoredThread, agent: string) => workingIn(t).includes(agent);
/**
 * A « To decide » card posted outside a turn: a Hermes cron job of the thread's agent in charge, delivering there (the
 * plugin takes the target from the job's `deliver`). Work threads only, and only while no turn runs there, so it never
 * cuts into a live exchange; the answer rules stay the card's (trusted human, once, wakes the asking agent).
 */
export const cronCard = (t: StoredThread, agent: string) => t.kind !== 'topic' && agent === t.owner && workingIn(t).length === 0;
export const agentsOf = (s: Space) => s.agents ?? [s.defaultAgent];
export class Refused extends Error { code: string; constructor(code: string) { super(code); this.code = code } }

export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const HISTORY_MAX_BYTES = 100_000;
const HISTORY_PAGE = 100;
const SYNC_THREADS_MAX_BYTES = 80_000;
const ALWAYS_MAX = 100; // pinned + Your turn + In progress sent at sync whatever their age (bounds the frame)
// Opaque to the client, validated here: it only moves the start of a Query whose partition the hub fixes (the member's space).
const CURSOR_RE = /^(\d{1,15})\.([A-Za-z0-9_-]{1,64})$/;
const encodeCursor = (c: ThreadCursor | null) => c ? `${c.updatedAt}.${c.id}` : null;
function decodeCursor(x: unknown): ThreadCursor {
  const m = typeof x === 'string' ? CURSOR_RE.exec(x) : null;
  need(!!m);
  return { updatedAt: Number(m![1]), id: m![2] };
}
export const METRICS_READS = 16; // concurrent thread reads for metrics.get (one Query each)
/** Maps `xs` with at most `n` calls in flight, results in input order. */
export async function pool<T, R>(xs: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => { while (next < xs.length) { const i = next++; out[i] = await fn(xs[i]); } }));
  return out;
}
export const byActivity = (a: PublicThread, b: PublicThread) => b.updatedAt - a.updatedAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
const SPAWNED_MAX = 100; // threads joined to a page for its topics' badges (bounds the frame like ALWAYS_MAX)
/** The page plus the threads its topics opened (`spawned`) that it lacks, by activity: the Lounge card lists them with
 *  their state, and an old Closed thread is never on the first page. Whole family: a thread opened from a thread is in
 *  the parent thread's `spawned`, so each joined level is followed, FAMILY_DEPTH levels and SPAWNED_MAX threads at most
 *  (one BatchGet per level, keyed in the member's space). */
async function withSpawned(deps: Deps, space: string, threads: PublicThread[]): Promise<PublicThread[]> {
  const have = new Set(threads.map(x => x.id)), out = [...threads];
  let level = threads, budget = SPAWNED_MAX;
  for (let d = 0; d < FAMILY_DEPTH && budget > 0; d++) {
    const missing = [...new Set(level.flatMap(x => x.spawned ?? []))].filter(i => !have.has(i)).slice(0, budget);
    if (!missing.length) break;
    missing.forEach(i => have.add(i)); budget -= missing.length;
    level = await deps.store.threadsByIds(space, missing);
    out.push(...level);
  }
  return out.sort(byActivity);
}
/** A topic's turn: the threads opened from it (the SPAWNED_CONTEXT_MAX most recently opened, by activity) and where
 *  each stands. Each runs in its own agent session, so the topic's agent otherwise answers as if none had moved. */
async function spawnedContext(deps: Deps, space: string, ids: string[]): Promise<SpawnedThread[]> {
  const list = (await deps.store.threadsByIds(space, ids.slice(-SPAWNED_CONTEXT_MAX))).sort(byActivity);
  return Promise.all(list.map(async x => {
    const status = (await deps.store.getSummary(x.id))?.status;
    return { id: x.id, title: x.title, state: x.state, ...(x.archived ? { archived: true as const } : {}),
      ...(x.outcome ? { outcome: { kind: x.outcome.kind, ...(x.outcome.action ? { action: x.outcome.action } : {}) } } : {}),
      ...(x.plan ? { plan: { step: x.plan.step, of: x.plan.of } } : {}), ...(status ? { status } : {}) };
  }));
}
/** Bounded frame (API Gateway refuses > 128 KB): if needed, the text of the oldest topics is dropped (the client shows the title). */
function fitText(threads: PublicThread[], max = SYNC_THREADS_MAX_BYTES) {
  let size = Buffer.byteLength(JSON.stringify(threads));
  for (let i = threads.length - 1; i >= 0 && size > max; i--) if (threads[i].text) { size -= Buffer.byteLength(JSON.stringify(threads[i].text)); delete threads[i].text; }
  return threads;
}
/** Photos within a frame budget (same 128 KB limit): past it, the next people show their initial. bytes: what was kept. */
const AVATARS_MAX_BYTES = 48_000;
export function fitAvatars<T extends { avatar?: string }>(people: T[], max = AVATARS_MAX_BYTES): { people: T[]; bytes: number } {
  let bytes = 0;
  return { people: people.map(p => {
    if (!p.avatar) return p;
    if (bytes + p.avatar.length > max) { const { avatar: _, ...rest } = p; return rest as T; }
    bytes += p.avatar.length; return p;
  }), bytes };
}
export const str = (x: unknown, max: number): x is string => typeof x === 'string' && x.length > 0 && x.length <= max;
export const id = (x: unknown): x is string => typeof x === 'string' && ID_RE.test(x);
export const need = (ok: boolean, code = 'bad_frame') => { if (!ok) throw new Refused(code) };

export async function handle(deps: Deps, connId: string, who: Principal, raw: string): Promise<void> {
  const reply = (f: HubFrame) => deps.sender.send(connId, f);
  let frame: any;
  try { frame = JSON.parse(raw) } catch { await reply({ v: 2, type: 'error', code: 'bad_json' }); return; }
  try {
    // Protocol v2 only: an old (v1) plugin or client gets an error instead of half-working with the old vocabulary.
    need(frame && frame.v === 2 && typeof frame.type === 'string');
    if (frame.type === 'ping') { await reply({ v: 2, type: 'pong' }); return; } // API Gateway drops after 10 min without traffic
    // A join connection (invitation code, no account) can only redeem its code.
    if (who.kind === 'join') { need(frame.type === 'agent.join', 'forbidden'); return await join(deps, who, frame, reply); }
    // A visitor connection (visitor link, no account) can only signal the one preview of its link.
    if (who.kind === 'visitor') { need(PREVIEW_HUMAN.has(frame.type), 'forbidden'); return await previewVisitor(deps, connId, who, frame, reply); }
    if (who.kind === 'human' && PREVIEW_VISITOR_ADMIN.has(frame.type)) return await visitorLink(deps, who, frame, reply);
    if (frame.type === 'subscribe') return await subscribe(deps, connId, who, frame, reply);
    if (frame.type === 'upload') return await upload(deps, who, frame, reply);
    if (frame.type === 'files' && who.kind === 'human') return await fileUrls(deps, who, frame, reply);
    if (who.kind === 'human' && ['admin.spaces', 'space.save', 'space.archive', 'space.invite', 'member.profile', 'member.reinvite', 'agent.invite', 'agent.revoke', 'agent.remove', 'flowcfg.get', 'flowcfg.save', 'flowcfg.head', 'flowpilot.get', 'flowpilot.link', 'flowpilot.back', 'routine.list', 'routine.save', 'routine.delete', 'routine.run', 'radarcfg.get', 'radarcfg.save', 'radarcfg.run', 'radarcfg.reject'].includes(frame.type)) return await admin(deps, who, frame, reply, connId);
    if (who.kind === 'human' && /^applet\.(list|delete|accept|run|set|runs|result|talk)$/.test(frame.type)) return await appletHuman(deps, who, frame, reply);
    // Modules in their own files (hub/src/modules.ts): memory, reminders, exchanges, radar, metrics, lineage…
    if (who.kind === 'human' && humanModule(frame.type)) return await humanModule(frame.type)!.human(deps, who, frame, reply, connId);
    if (who.kind === 'human' && frame.type === 'profile.save') return await profile(deps, who, frame, reply);
    if (who.kind === 'human' && (frame.type === 'push.key' || frame.type === 'push.subscribe' || frame.type === 'push.unsubscribe')) return await pushFrame(deps, who, frame, reply);
    if (who.kind === 'human' && frame.type === 'labels.get') return await labelsGet(deps, connId, who, frame);
    if (who.kind === 'human' && frame.type === 'merge.get') return await mergeGet(deps, connId, who, frame);
    if (who.kind === 'human' && frame.type === 'details.get') return await detailsGet(deps, connId, who, frame, reply);
    if (who.kind === 'human' && frame.type === 'action' && frame.kind === 'merge') return await mergeAction(deps, connId, who, frame);
    if (who.kind === 'human' && (frame.type === 'flowstate.get' || frame.type === 'flowstate.pause')) return await flowStateFrame(deps, who, frame, reply);
    if (who.kind === 'human' && (frame.type === 'secret.key' || frame.type === 'secret.send')) return await secretHuman(deps, who, frame, reply);
    if (who.kind === 'human' && PREVIEW_HUMAN.has(frame.type)) return await previewHuman(deps, connId, who, frame, reply);
    if (frame.type === 'presence.set') return await presenceSet(deps, connId, who, frame);
    if (who.kind === 'human') return await fromHuman(deps, who, frame, reply);
    if (frame.type === 'secret.received') return await secretReceived(deps, who, frame);
    if (PREVIEW_AGENT.has(frame.type)) return await previewAgent(deps, connId, who, frame, reply);
    if (frame.type === 'flow.state') return await flowState(deps, who, frame);
    if (frame.type === 'flow.task') return await flowTask(deps, who, frame, reply);
    if (frame.type === 'flow.done') return await flowDone(deps, who, frame, reply);
    if (frame.type === 'flow.config.status') return await flowConfigStatus(deps, who, frame);
    if (frame.type === 'flow.switch') return await flowSwitch(deps, who, frame, reply);
    if (frame.type === 'topic.open') return await agentTopic(deps, who, frame, reply);
    return await fromInstance(deps, who, frame, reply);
  } catch (e) {
    if (e instanceof Refused) { await reply({ v: 2, type: 'error', code: e.code, ref: str(frame?.client_id, 64) ? frame.client_id : undefined }); return; }
    throw e;
  }
}

/**
 * Web Push devices, for oneself only (the key is the connection's principal, never a frame field). The endpoint must be
 * a known push service (`pushEndpointOk`); past MAX_PUSH_DEVICES the oldest other device is dropped.
 */
async function pushFrame(deps: Deps, who: Principal, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  need(str(f.client_id, 64));
  if (f.type === 'push.key') {
    const key = deps.pushKey ? await deps.pushKey() : null;
    need(!!key, 'push_off');
    await reply({ v: 2, type: 'push.key', client_id: f.client_id, key: key! });
    return;
  }
  if (f.type === 'push.unsubscribe') {
    need(typeof f.endpoint === 'string' && f.endpoint.length > 0 && f.endpoint.length <= 1024);
    await deps.store.deletePush(who.id, pushId(f.endpoint));
    await reply({ v: 2, type: 'push.saved', client_id: f.client_id, on: false });
    return;
  }
  need(pushEndpointOk(f.sub?.endpoint), 'push_endpoint');
  need(validPushSub(f.sub) && (f.lang === 'en' || f.lang === 'fr'));
  const sub = f.sub as PushSub, id = pushId(sub.endpoint);
  const others = (await deps.store.listPushes(who.id)).filter(p => p.id !== id).sort((a, b) => a.at - b.at);
  for (const old of others.slice(0, Math.max(0, others.length - (MAX_PUSH_DEVICES - 1)))) await deps.store.deletePush(who.id, old.id);
  await deps.store.putPush(who.id, { id, endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, lang: f.lang, at: deps.now() });
  await reply({ v: 2, type: 'push.saved', client_id: f.client_id, on: true });
}

/** Grey line in the General room of each space (when it exists): the instance's agents there now run `version`. */
async function pluginUpdatedNotice(deps: Deps, inst: Instance, spaces: string[], from: string, version: string, acp = false) {
  for (const s of spaces) {
    const [space, general] = await Promise.all([deps.store.getSpace(s), deps.store.getThread(generalId(s))]);
    const agents = space ? inst.agents.filter(a => agentsOf(space).includes(a)) : [];
    if (!space || !general?.general || !agents.length) continue;
    const names = agents.map(cap).join(', ');
    const line: Message = { id: deps.newId(), thread: general.id, author: { kind: 'system', id: 'briefling' }, type: 'text', at: deps.now(), notice: true,
      plugin: { from, to: version, agents }, text: `${names} · briefling ${acp ? 'ACP bridge' : 'plugin'} updated automatically, ${from} → ${version}` };
    const r = await deps.store.upsertMessage(line);
    if (r) await broadcast(deps, s, { v: 2, type: 'event', event: 'message.created', data: r.message });
  }
}

/**
 * Subscription. Without `spaces`, the hub chooses: a human gets every space they are a member of (not archived),
 * with their names (no more hard-coded list in the client); an instance, every space of its agents.
 */
async function subscribe(deps: Deps, connId: string, who: Principal, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  need(f.spaces === undefined || (Array.isArray(f.spaces) && f.spaces.length <= 20 && f.spaces.every(id)));
  const inst = who.kind === 'instance' ? await deps.store.getInstance(who.id) : null;
  const known = new Map<string, Space>();
  let wanted: string[];
  if (f.spaces !== undefined) wanted = f.spaces;
  else if (who.kind === 'instance') wanted = (inst?.spaces ?? []).slice(0, MAX_SPACES);
  else {
    for (const s of await deps.store.listSpaces()) known.set(s.id, s);
    wanted = [...known.values()].filter(s => canSee(s, who.id)).map(s => s.id).sort().slice(0, MAX_SPACES);
  }
  const ok: string[] = [], denied: string[] = [], list: { id: string; name: string }[] = [];
  for (const s of wanted) {
    const space = who.kind === 'human' ? known.get(s) ?? await deps.store.getSpace(s) : null;
    const allowed = who.kind === 'human' ? !!space && canSee(space, who.id) : !!inst?.spaces.includes(s);
    if (!allowed) { denied.push(s); continue; }
    await deps.store.putSub(s, { connId, kind: who.kind, principal: who.id }); ok.push(s);
    if (space) { const n = memPendingFor(space, who.id); list.push({ id: s, name: space.name ?? s, ...(n ? { memPending: n } : {}), ...(modulesSet(space.modulesOff, space.modulesIn) ? { modules: modulesOn(space.modulesOff, space.modulesIn) } : {}), ...nontechFor(space, who.id), ...adminFor(space, who.id) }); }
  }
  // This person's mutes (hub/src/mute.ts): theirs only, one batch read.
  if (who.kind === 'human' && list.length) {
    const on = new Set((await deps.store.mutesOf(who.id, list.map(x => x.id))).filter(m => m.on).map(m => m.space));
    for (const x of list as SpaceInfo[]) if (on.has(x.id)) x.muted = true;
  }
  // Without a list, the instance wants every space of its agents, including those opened after this connection.
  if (who.kind === 'instance' && f.spaces === undefined) await deps.store.putInstanceConn(who.id, connId);
  if (inst && !inst.connectedAt) await deps.store.markInstanceConnected(inst.id, deps.now());
  // Plugin release (Settings, admins): a malformed value is ignored, never a reason to refuse the connection.
  // An ACP bridge (0.3.42+) reports `bridge` instead of `plugin`: same fields, its own releases (protocol/bridge-release.ts).
  const acp = who.kind === 'instance' && f.plugin === undefined && typeof f.bridge === 'object' && f.bridge !== null;
  const rep = acp ? f.bridge : f.plugin;
  const version = who.kind === 'instance' && inst ? rep?.version : undefined;
  // Its secret key (protocol/secret.ts) rides along: new at every gateway start, missing = the plugin takes no secrets.
  const secretKey = typeof f.plugin?.secret_key === 'string' && SECRET_KEY_RE.test(f.plugin.secret_key) ? f.plugin.secret_key as string : undefined;
  // voice: its agents can open a voice channel on request (protocol/preview.ts « Voice on request »): their presence says so.
  const voice = f.plugin?.voice === true;
  // update: why this plugin will not install new releases by itself (banner for the leads, through presence).
  const update = isUpdateBlock(rep?.update) ? rep.update as AgentPlugin['update'] : undefined;
  // cache_ttl: Hermes' prompt cache setting (Settings, admins: « advised: auto »); only a known tier is kept.
  const cacheTtl = isCacheTtl(f.plugin?.cache_ttl) ? f.plugin.cache_ttl as CacheTtl : undefined;
  const before = inst?.plugin?.version;
  if (typeof version === 'string' && PLUGIN_VERSION_RE.test(version)) await deps.store.setInstancePlugin(who.id, { version, at: deps.now(), ...(acp ? { kind: 'acp' as const } : {}), ...(secretKey ? { secretKey } : {}), ...(voice ? { voice: true as const } : {}), ...(update ? { update } : {}), ...(cacheTtl ? { cacheTtl } : {}) });
  const allowed: Record<string, string[]> = {};
  if (who.kind === 'instance') for (const s of ok) { const space = await deps.store.getSpace(s); if (space) allowed[s] = allowedOf(space); }
  // release: what this hub was deployed with; the plugin installs it by itself once the public repo's main is that commit
  // (a bridge: once the public tag v<version> is that commit).
  const latest = latestFor(acp ? 'acp' : undefined);
  const release = latest.commit ? { release: { version: latest.version, commit: latest.commit } } : {};
  await reply(who.kind === 'human' ? { v: 2, type: 'subscribed', spaces: ok, denied, list, admin: await deps.store.isAdmin(who.id), me: who.id } : { v: 2, type: 'subscribed', spaces: ok, denied, allowed, ...release });
  // The first connection after a self-update (`updated_from` = the version this hub last recorded): one notice in General.
  const from = who.kind === 'instance' ? rep?.updated_from : undefined;
  if (inst && typeof version === 'string' && typeof from === 'string' && from === before && compareVersions(version, from) === 1)
    await pluginUpdatedNotice(deps, inst, ok, from, version, acp).catch(e => console.error('plugin_notice_failed', (e as Error)?.message?.slice(0, 200)));
  // The flow config of each space reaches the instance at its connection (its agents' plugin may have missed versions).
  if (who.kind === 'instance') for (const s of ok) {
    const space = await deps.store.getSpace(s);
    if (space) await pushFlowConfig(deps, space, connId).catch(e => console.error('flow_push_failed', s, (e as Error)?.message?.slice(0, 200)));
    if (space && inst && boardDriven(space)) await pushPilots(deps, space, inst.agents, connId);
  }
  await Promise.all(ok.map(s => presenceChanged(deps, s)));
}

/**
 * Who is connected in the space (protocol/presence.ts), from its live subscriptions: the members' connections with
 * their state, and the space's agents served by a subscribed instance. Never anyone outside the space.
 */
async function presenceOf(deps: Pick<Deps, 'store'>, space: Space): Promise<Presence[]> {
  const subs = await deps.store.listSubs(space.id);
  const conns: { id: string; away?: boolean; idle?: number; voice?: boolean }[] = subs.filter(s => s.kind === 'human' && canSee(space, s.principal)).map(s => ({ id: s.principal, away: s.away, idle: s.idle }));
  const agents = new Set(visibleAgents(space)); // the backstage memory agent is never shown connected
  for (const i of new Set(subs.filter(s => s.kind === 'instance').map(s => s.principal))) {
    const inst = await deps.store.getInstance(i);
    const latest = latestFor(inst?.plugin?.kind);
    const stuck = latest.commit ? stuckOf(inst?.plugin, latest.version, latest.since) : undefined;
    for (const a of inst?.agents ?? []) if (agents.has(a)) conns.push({ id: a, voice: inst?.plugin?.voice === true, ...(stuck ? { stuck } : {}) });
  }
  return mergePresence(conns);
}
/** Last seen of the space's members and agents only (a removed member's entry stays stored, never sent). */
async function lastSeenOf(deps: Pick<Deps, 'store'>, space: Space): Promise<LastSeen> {
  const agents = new Set(visibleAgents(space));
  return Object.fromEntries(Object.entries(await deps.store.lastSeen(space.id)).filter(([id]) => agents.has(id) || canSee(space, id)));
}
/** presence.set: this human connection's state, on its own subscriptions only (gated by membership at `subscribe`).
 *  Away records the last input as seen: a tab closed while away then still says when its human was last active. */
async function presenceSet(deps: Deps, connId: string, who: Principal, f: any) {
  need(who.kind === 'human', 'forbidden');
  need(f.state === 'active' || f.state === 'away');
  const away = f.state === 'away', idle = idleOf(f.idle, deps.now());
  for (const s of await deps.store.connSpaces(connId))
    if (await deps.store.setSubAway(s, connId, away, away ? idle : undefined)) {
      if (away) await deps.store.markSeen(s, [who.id], idle).catch(e => console.error('seen_failed', s, (e as Error)?.message?.slice(0, 200)));
      await presenceChanged(deps, s);
    }
}
/** $disconnect: records who left each space it was subscribed to (a human: the last input if that tab was away, else
 *  now; an instance: its agents of the space, now), then sends the new lists. Best effort, never throws. */
export async function presenceLeft(deps: Pick<Deps, 'store' | 'sender'>, who: Principal | null, left: { space: string; idle?: number }[], now: number) {
  for (const l of left) {
    try {
      const space = await deps.store.getSpace(l.space);
      const ids = !space || !who ? [] : who.kind === 'human' ? (canSee(space, who.id) ? [who.id] : [])
        : who.kind === 'instance' ? ((await deps.store.getInstance(who.id))?.agents ?? []).filter(a => agentsOf(space).includes(a)) : [];
      if (ids.length) await deps.store.markSeen(l.space, ids, who?.kind === 'human' && l.idle ? l.idle : now);
    } catch (e) { console.error('seen_failed', l.space, (e as Error)?.message?.slice(0, 200)); }
    await presenceChanged(deps, l.space);
  }
}
/** Sends the space's presence list to its subscribed members; a failure is logged, never thrown (best effort). */
export async function presenceChanged(deps: Pick<Deps, 'store' | 'sender'>, spaceId: string) {
  try {
    const space = await deps.store.getSpace(spaceId);
    if (!space || space.archived) return;
    await broadcast(deps, spaceId, { v: 2, type: 'event', event: 'presence.changed', data: { space: spaceId, presence: await presenceOf(deps, space), lastSeen: await lastSeenOf(deps, space) } });
  } catch (e) { console.error('presence_failed', spaceId, (e as Error)?.message?.slice(0, 200)); }
}

/**
 * Search (⌘K). Membership is checked here on every frame: the store may hand back other spaces' data (one Scan of
 * the table when several spaces are searched), only threads of the person's visible spaces (`canSee`: member, space not archived) are kept, and a
 * message only through its thread. Archived threads are included (the client marks them). A title is often its first
 * message cut at 80 characters (topics, threads posted without a title): it only counts when none of the thread's
 * messages matched, so a thread never shows twice for the same words.
 * Optional `space` (one the person sees, else forbidden) narrows the read too when the space is small: the store then
 * only reads that space (Queries instead of the Scan, up to 100 threads). `since` narrows the result, not the read.
 */
async function search(deps: Deps, who: Principal, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  need(typeof f.q === 'string' && f.q.length <= SEARCH_MAX_Q);
  need(f.space === undefined || id(f.space));
  need(f.since === undefined || (Number.isSafeInteger(f.since) && f.since >= 0));
  const terms = searchTerms(f.q);
  need(searchable(terms));
  let spaces = new Set((await deps.store.listSpaces()).filter(s => canSee(s, who.id)).map(s => s.id));
  if (f.space !== undefined) { need(spaces.has(f.space), 'forbidden'); spaces = new Set([f.space]); }
  const since: number = f.since ?? 0;
  const corpus = spaces.size ? await deps.store.searchCorpus([...spaces]) : { threads: [], messages: [] };
  const threads = new Map(corpus.threads.filter(t => spaces.has(t.space)).map(t => [t.id, t]));
  const msgHits: SearchHit[] = [];
  for (const m of corpus.messages) {
    if (!threads.has(m.thread) || m.at < since) continue;
    const text = typeof m.text === 'string' ? m.text : '', names = (m.files ?? []).map(x => x.name).join(' · ');
    if (!matchesAll(fold(`${text}\n${names}`), terms)) continue;
    // Snippet from the text if every term is there, else from the file names (a term may only be in a name).
    const inText = matchesAll(fold(text), terms) || !names;
    msgHits.push({ thread: m.thread, msg: m.id, field: inText ? 'text' : 'file', author: m.author, at: m.at, snippet: snippet(inText ? text : names, terms) });
  }
  const withMsg = new Set(msgHits.map(x => x.thread));
  const titleHits: SearchHit[] = [...threads.values()]
    .filter(t => !withMsg.has(t.id) && t.updatedAt >= since && matchesAll(fold(t.title ?? ''), terms))
    .map(t => ({ thread: t.id, field: 'title' as const, at: t.updatedAt, snippet: snippet(t.title, terms) }));
  const key = (x: SearchHit) => `${x.thread}|${x.msg ?? ''}`;
  const byDate = (a: SearchHit, b: SearchHit) => b.at - a.at || (key(a) < key(b) ? 1 : -1);
  const all = [...titleHits.sort(byDate), ...msgHits.sort(byDate)];
  const hits = all.slice(0, SEARCH_MAX_HITS);
  // Public view of the threads found (opened from the palette even when their list page is not loaded).
  const ids = new Map<string, string[]>();
  for (const x of hits) { const sp = threads.get(x.thread)!.space; const l = ids.get(sp) ?? []; if (!l.includes(x.thread)) l.push(x.thread); ids.set(sp, l); }
  const pub = (await Promise.all([...ids].map(([sp, l]) => deps.store.threadsByIds(sp, l)))).flat().filter(t => spaces.has(t.space));
  await reply({ v: 2, type: 'search', q: f.q, ...(f.space !== undefined ? { space: f.space } : {}), ...(f.since !== undefined ? { since: f.since } : {}),
    hits, threads: fitText(pub), more: all.length > hits.length });
}

/** An archived space is no longer reachable by anyone (threads kept, reversible by the admin). */
export const canSee = (s: Space, user: string) => !s.archived && s.members.includes(user);

export async function memberSpace(deps: Deps, who: Principal, spaceId: string): Promise<Space> {
  const space = await deps.store.getSpace(spaceId);
  need(!!space && canSee(space, who.id), 'forbidden');
  return space!;
}

/** Can the issue's PR be merged: read by the GitHub Lambda (the only one holding the App key), sent to this connection. */
async function mergeGet(deps: Deps, connId: string, who: Principal, f: any) {
  need(str(f.client_id, 64) && id(f.thread));
  const t = await mergeTarget(deps, f.thread, who.id);
  need(typeof t !== 'string', t as string);
  need(!!deps.queueGithub, 'github_off');
  await deps.queueGithub!({ kind: 'mergeinfo', thread: f.thread, by: who.id, conn: connId, client_id: f.client_id });
}

/**
 * Thread info panel: what the hub holds (one Query of the thread's partition), then the PRs of its pushed heads, read
 * on GitHub by the GitHub Lambda (only when there are some, only in attached repos) and sent to this connection.
 */
async function detailsGet(deps: Deps, connId: string, who: Principal, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  need(str(f.client_id, 64) && id(f.thread));
  const thread = await deps.store.getThread(f.thread); need(!!thread && thread.kind !== 'topic', 'forbidden');
  const space = await memberSpace(deps, who, thread!.space);
  const rows = await deps.store.threadDetails(thread!.id);
  const parent = thread!.from ? await deps.store.getThread(thread!.from) : null;
  const from = parent && parent.space === space.id ? { id: parent.id, title: parent.title } : null;
  const heads = pushedHeads(rows.events, space);
  const followed = deps.queueGithub ? heads.map(x => x.repo) : [];
  await reply({ v: 2, type: 'details', client_id: f.client_id, details: { ...threadDetails(thread!.id, rows, from), followed } });
  if (followed.length) await deps.queueGithub!({ kind: 'prs', thread: thread!.id, by: who.id, conn: connId, client_id: f.client_id });
}

/** Merge of the PR shown (repo, number, head sha): queued for the GitHub Lambda, which reads everything again. */
async function mergeAction(deps: Deps, connId: string, who: Principal, f: any) {
  need(str(f.client_id, 64) && id(f.thread) && str(f.repo, 140) && Number.isSafeInteger(f.number) && f.number > 0 && typeof f.sha === 'string' && /^[0-9a-f]{40}$/.test(f.sha));
  const t = await mergeTarget(deps, f.thread, who.id);
  need(typeof t !== 'string', t as string);
  need(reposOf((t as Exclude<typeof t, string>).space).includes(f.repo), 'repo_not_attached');
  need(!!deps.queueGithub, 'github_off');
  await deps.queueGithub!({ kind: 'merge', id: deps.newId(), thread: f.thread, by: who.id, conn: connId, client_id: f.client_id, repo: f.repo, number: f.number, sha: f.sha });
}

/** Labels of the issue's repo, read by the GitHub Lambda (the only one holding the App key), sent to this connection. */
async function labelsGet(deps: Deps, connId: string, who: Principal, f: any) {
  need(str(f.client_id, 64) && id(f.thread));
  const t = await labelTarget(deps, f.thread, who.id);
  need(typeof t !== 'string', t as string);
  need(!!deps.queueGithub, 'github_off');
  await deps.queueGithub!({ kind: 'labels', thread: f.thread, by: who.id, conn: connId, client_id: f.client_id });
}

async function fromHuman(deps: Deps, who: Principal, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  if (f.type === 'post') {
    need(str(f.client_id, 64) && id(f.space) && str(f.text, MAX_TEXT) && (f.thread === undefined || id(f.thread)) && (f.title === undefined || str(f.title, 120))
      && (f.kind === undefined || f.kind === 'thread' || f.kind === 'topic') && fileIds(f.files)
      && (f.general === undefined || (f.general === true && f.thread === undefined && f.kind === undefined && f.title === undefined))
      && (f.voice === undefined || (f.voice === true && f.thread !== undefined && f.files === undefined && f.general === undefined && f.kind === undefined && f.title === undefined)));
    const space = await memberSpace(deps, who, f.space);
    let thread: StoredThread | null = null;
    if (f.thread) { thread = await deps.store.getThread(f.thread); need(!!thread && thread.space === space.id, 'forbidden'); }
    // Modules (protocol/modules.ts): « general » off, nobody posts in the General feed; « threads » off, no new thread.
    if (f.general) need(modOn(space, 'general'), 'module_off');
    else if (!thread && f.kind !== 'topic') need(modOn(space, 'threads'), 'module_off');
    // « Voice » with no voice line on: a lead asks the agent of a thread or topic (voiceAgent) to open its voice channel.
    if (f.voice) {
      need(space.trusted.includes(who.id), 'not_trusted');
      need(!thread!.general, 'forbidden');
      const agent = voiceAgent(thread!, thread!.kind === 'topic' ? await deps.store.lastMessages(thread!.id, 30) : []);
      need((await presenceOf(deps, space)).some(p => p.id === agent && p.voice), 'no_voice');
    }
    if (f.general) thread = await deps.store.getThread(generalId(space.id)); // created by its first post
    const general = f.general === true || !!thread?.general;
    const msg: Message = { id: deps.newId(), thread: thread?.id ?? (general ? generalId(space.id) : deps.newId()), author: { kind: 'human', id: who.id }, type: 'text', text: f.voice ? VOICE_ASK_TEXT : f.text, at: deps.now(),
      ...(f.voice ? { voiceAsk: true as const } : {}) };
    const files = await attach(deps, who.id, space.id, msg.id, f.files);
    if (files.length) msg.files = files;
    const trusted = space.trusted.includes(who.id);
    const seed = thread ? await peopleOf(deps, thread) : [];
    let before: string[] = [];
    thread = await mutateThread(deps, thread ? thread.id : null, { type: 'human.post', trusted },
      thread ? undefined : general ? { id: msg.thread, space: space.id, title: 'General', owner: space.defaultAgent, kind: 'topic' }
      : { id: msg.thread, space: space.id, title: (f.title ?? f.text).slice(0, 80), owner: space.defaultAgent,
        // topic: its author and its whole first message (Lounge list); the short title stays for spawned threads and notifications
        ...(f.kind === 'topic' ? { kind: 'topic' as const, author: who.id, text: topicText(f.text) } : {}) },
      // General keeps no `people`: a room everyone writes in would notify everyone of every message (mentions only).
      undefined, x => { if (general) return { ...unarchive(x), general: true, last: { author: who.id, text: topicText(f.text), at: msg.at } }; before = x.people ?? seed; return { ...(trusted ? unarchive(x) : x), people: withPerson(before, who.id) } });
    await deps.store.upsertMessage(msg);
    await reply({ v: 2, type: 'ack', client_id: f.client_id, thread: thread.id, msg_id: msg.id });
    await afterHumanMessage(deps, space, who, thread, msg, 'message.created', messageTo(general ? [] : before, mentionedIds(msg.text, humansOf(space)), who.id, space.members));
    return;
  }
  if (f.type === 'answer') {
    need(str(f.client_id, 64) && id(f.thread) && id(f.ask_id) && str(f.option, ASK_TEXT_MAX));
    const cur = await deps.store.getThread(f.thread); need(!!cur, 'forbidden');
    const space = await memberSpace(deps, who, cur!.space);
    // « To decide » card: only a trusted human answers it, once, while it is open (a message or a new card closes it).
    // A clarify `ask` keeps its old rule (a member's answer is stored, only a trusted one's reaches the agent).
    const card = await deps.store.getMessage(cur!.id, f.ask_id);
    if (card?.ask?.items) {
      need(space.trusted.includes(who.id), 'not_trusted');
      need(cur!.facts.pendingAsk === f.ask_id, 'closed');
    } else need(f.option.length <= 500);
    const msg: Message = { id: deps.newId(), thread: cur!.id, author: { kind: 'human', id: who.id }, type: 'answer', text: f.option, ask: { id: f.ask_id, options: [] }, at: deps.now() };
    const trusted = space.trusted.includes(who.id);
    const seed = await peopleOf(deps, cur!);
    let before: string[] = [];
    const thread = await mutateThread(deps, cur!.id, { type: 'human.answer', ask_id: f.ask_id, trusted }, undefined, undefined,
      x => { before = x.people ?? seed; return { ...(trusted ? unarchive(x) : x), people: withPerson(before, who.id) } });
    await deps.store.upsertMessage(msg);
    await reply({ v: 2, type: 'ack', client_id: f.client_id, thread: thread.id, msg_id: msg.id });
    await afterHumanMessage(deps, space, who, thread, msg, 'message.created', messageTo(before, [], who.id, space.members));
    return;
  }
  if (f.type === 'sync') {
    need(id(f.space));
    await memberSpace(deps, who, f.space);
    const space = await deps.store.getSpace(f.space);
    // First page by activity + what must never wait for a scroll: this person's pins, Your turn, In progress.
    const pins = await deps.store.listPins(who.id, f.space);
    const lead = space!.trusted.includes(who.id), role = appletRole(space!, who.id);
    const [page, active, pinned, nApplets] = await Promise.all([deps.store.pageThreads(f.space, THREADS_PAGE, null), deps.store.activeThreads(f.space),
      deps.store.threadsByIds(f.space, pins.filter(p => p.on).map(p => p.thread)),
      role ? deps.store.listApplets(f.space).then(x => x.filter(a => canLaunch(a, role)).length) : 0]);
    const general = await deps.store.threadsByIds(f.space, [generalId(f.space)]); // pinned at the top of the Lounge, whatever its age
    const always = new Map([...active, ...pinned].map(x => [x.id, x]));
    const kept = [...general, ...[...always.values()].filter(x => !x.general).sort(byActivity).slice(0, ALWAYS_MAX)];
    const ids = new Set(kept.map(x => x.id));
    const threads = await withSpawned(deps, f.space, [...kept, ...page.threads.filter(x => !ids.has(x.id))]);
    const all: Person[] = [
      ...humansOf(space!),
      // agents of the space + former thread owners: their mentions stay recognized; a backstage memory agent is left
      // out (no @, no member row, no picker)
      ...[...new Set([...(space!.agents ?? [space!.defaultAgent]), ...threads.map(x => x.owner)])].filter(a => a !== backstageAgent(space!)).map(a => ({ id: a, name: a[0].toUpperCase() + a.slice(1), kind: 'agent' as const,
        ...((space!.agents ?? [space!.defaultAgent]).includes(a) ? {} : { gone: true }), ...(space!.agentRoles?.[a] ? { role: space!.agentRoles[a] } : {}),
        ...(space!.agentAvatars?.[a] && (space!.agents ?? [space!.defaultAgent]).includes(a) ? { avatar: space!.agentAvatars[a] } : {}) })),
    ];
    // Photos and topic texts share the frame: what the photos take, the oldest topics' texts give back.
    const { people, bytes } = fitAvatars(all);
    fitText(threads, SYNC_THREADS_MAX_BYTES - bytes);
    await reply({ v: 2, type: 'synced', space: f.space, threads, people, github: space!.github ? await deps.store.getGithub(f.space) : null, repos: space!.github ? reposOf(space!) : [],
      pins, seen: await deps.store.seenMarks(who.id, f.space, threads.map(x => x.id)), locks: (await deps.store.listLocks(f.space)).map(l => publicLock(normLock(l)!)),
      resources: (await deps.store.listResources(f.space)).map(publicResource), parallel: parallelOf(space!), cursor: encodeCursor(page.next),
      ...(boardDriven(space!) ? { driver: 'board' as const, ...await boardColumnsOf(deps, f.space), ...await flowStatesOf(deps, space!) } : {}), ...(lead ? { trusted: true, ...(space!.contributors?.length ? { contributors: space!.contributors } : {}), } : {}), ...(loungeAgent(space!) && wakes(space!, who.id, { kind: 'topic' }) ? { wakeAgent: loungeAgent(space!)! } : {}), ...(nApplets ? { applets: nApplets } : {}), presence: await presenceOf(deps, space!), lastSeen: await lastSeenOf(deps, space!) });
    return;
  }
  if (f.type === 'threads.page') {
    need(id(f.space));
    const after = decodeCursor(f.cursor);
    await memberSpace(deps, who, f.space);
    const page = await deps.store.pageThreads(f.space, THREADS_PAGE, after);
    const threads = fitText(await withSpawned(deps, f.space, page.threads));
    await reply({ v: 2, type: 'threads.page', space: f.space, threads, seen: await deps.store.seenMarks(who.id, f.space, threads.map(x => x.id)), cursor: encodeCursor(page.next) });
    return;
  }
  if (f.type === 'search') return await search(deps, who, f, reply);
  if (f.type === 'history') {
    need(id(f.thread) && (f.before === undefined || id(f.before)));
    const cur = await deps.store.getThread(f.thread); need(!!cur, 'forbidden');
    await memberSpace(deps, who, cur!.space);
    const messages = await deps.store.lastMessages(cur!.id, HISTORY_PAGE, f.before);
    const full = messages.length === HISTORY_PAGE;
    // API Gateway refuses messages over 128 KB: drop the oldest ones.
    let truncated = false;
    while (messages.length > 1 && Buffer.byteLength(JSON.stringify(messages)) > HISTORY_MAX_BYTES) { messages.shift(); truncated = true; }
    const shown = new Set(messages.map(m => m.id));
    const reactions = (await deps.store.listReactions(cur!.id)).filter(x => shown.has(x.msg));
    await reply({ v: 2, type: 'history', thread: cur!.id, messages, truncated, summary: await deps.store.getSummary(cur!.id), reactions,
      ...(f.before ? { before: f.before } : {}), more: truncated || full, threadInfo: publicThread(cur!) });
    return;
  }
  if (f.type === 'thread.seen') {
    need(id(f.thread) && Number.isSafeInteger(f.at) && f.at > 0);
    const cur = await deps.store.getThread(f.thread); need(!!cur, 'forbidden');
    const space = await memberSpace(deps, who, cur!.space);
    // Safeguard: only a trusted human can clear the "the agent replied" signal. Another member
    // opening the thread is simply ignored (no error: it is a normal gesture of their client).
    if (!space.trusted.includes(who.id) || cur!.facts.unseenReply !== f.at) return;
    const thread = await mutateThread(deps, cur!.id, { type: 'seen', at: f.at });
    await broadcast(deps, thread.space, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(thread) });
    return;
  }
  if (f.type === 'action' && (f.kind === 'promote' || f.kind === 'dismiss')) return await proposal(deps, who, f, reply);
  if (f.type === 'action' && f.kind === 'create_issue') return await approveIssue(deps, who, f);
  if (f.type === 'action' && (f.kind === 'plan_start' || f.kind === 'plan_stop')) return await planAction(deps, who, f);
  if (f.type === 'action' && f.kind === 'elevation') return await elevationAction(deps, who, f);
  if (f.type === 'action' && f.kind === 'handled') {
    need(id(f.thread) && Number.isSafeInteger(f.at) && f.at > 0);
    const cur = await deps.store.getThread(f.thread); need(!!cur, 'forbidden');
    const space = await memberSpace(deps, who, cur!.space);
    // Safeguard: only a trusted human clears a wait (never the agent, nor another member).
    need(space.trusted.includes(who.id), 'forbidden');
    // Wait already cleared or replaced by a more recent one: nothing to do (double click, two tabs).
    if (cur!.facts.outcome?.kind !== 'waiting' || cur!.facts.outcome.at !== f.at) return;
    need(f.lang === undefined || f.lang === 'en' || f.lang === 'fr');
    if (cur!.facts.outcome.resume) return await doneReply(deps, space, who, cur!, f.at, f.lang === 'fr' ? 'Fait' : 'Done');
    const thread = await mutateThread(deps, cur!.id, { type: 'handled', at: f.at });
    await broadcast(deps, thread.space, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(thread) });
    await leave(deps, space, thread, false); // "Done": the task is finished, the next thread goes
    await stopCi(deps, thread);
    await advancePlan(deps, space, thread); // a plan step finished by the human: the next step opens
    return;
  }
  if (f.type === 'turn.stop') {
    need(id(f.thread));
    const cur = await deps.store.getThread(f.thread); need(!!cur, 'forbidden');
    const space = await memberSpace(deps, who, cur!.space);
    need(space.trusted.includes(who.id), 'forbidden'); // interrupts the agent's work for the whole space
    need(cur!.facts.turnActive, 'no_turn');
    if (cur!.stopping) return; // already asked (double click, two tabs): the instance has it
    const at = deps.now();
    const thread = await mutateThread(deps, cur!.id, { type: 'noop' }, undefined, undefined, x => {
      need(x.facts.turnActive, 'no_turn'); // the turn ended meanwhile
      return x.stopping ? x : { ...x, stopping: { by: who.id, at } };
    });
    if (thread.stopping?.at !== at || thread.stopping.by !== who.id) return; // another request won the race
    await broadcast(deps, thread.space, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(thread) });
    let stopped = 0;
    for (const a of workingIn(cur!)) stopped += await toInstances(deps, space.id, a, { v: 2, type: 'turn.stop', thread: thread.id, by: who.id });
    if (stopped) return;
    // Nobody to stop it: no « stop requested » left hanging.
    const back = await mutateThread(deps, thread.id, { type: 'noop' }, undefined, undefined, x => x.stopping?.at === at ? withoutStopping(x) : x);
    await broadcast(deps, back.space, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(back) });
    need(false, 'not_connected');
  }
  if (f.type === 'message.edit') return await editMessage(deps, who, f, reply);
  if (f.type === 'message.delete') return await deleteOwnMessage(deps, who, f, reply);
  if (f.type === 'action' && f.kind === 'ci_stop') {
    need(id(f.thread));
    const cur = await deps.store.getThread(f.thread); need(!!cur && cur.kind !== 'topic', 'forbidden');
    const space = await memberSpace(deps, who, cur!.space);
    need(space.trusted.includes(who.id), 'forbidden'); // cuts a follow-up for the whole space
    await stopCi(deps, cur!);
    return;
  }
  if (f.type === 'action' && f.kind === 'release') {
    need(id(f.thread));
    const cur = await deps.store.getThread(f.thread); need(!!cur && cur.kind !== 'topic', 'forbidden');
    const space = await memberSpace(deps, who, cur!.space);
    need(space.trusted.includes(who.id), 'forbidden'); // makes the agent work on another thread
    await leave(deps, space, cur!, true); // no effect if this thread no longer holds the hand (double click, two tabs)
    await wakeFlow(deps, space); // the agent may take its next task now
    return;
  }
  if (f.type === 'action' && (f.kind === 'archive' || f.kind === 'unarchive')) {
    need(id(f.thread) && Number.isSafeInteger(f.version) && f.version > 0);
    const cur = await deps.store.getThread(f.thread); need(!!cur && !cur.general, 'forbidden'); // General is never put away
    const space = await memberSpace(deps, who, cur!.space);
    need(space.trusted.includes(who.id), 'forbidden'); // tidies the space for everyone
    const archive = f.kind === 'archive';
    // Guards checked inside the conditional write (re-read on every attempt): a turn that starts or a message
    // arriving between display and click makes the action refused, we never archive a thread we have not seen.
    const thread = await mutateThread(deps, cur!.id, { type: 'noop' }, undefined, undefined, x => {
      if (archive) need(!x.facts.turnActive, 'turn_active'); // otherwise the plugin would write into a hidden thread
      need(x.version === f.version, 'stale');
      if (!archive) return unarchive(x);
      return { ...x, archived: { by: who.id, at: deps.now() } };
    });
    await broadcast(deps, thread.space, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(thread) });
    if (archive && thread.kind !== 'topic') await leave(deps, space, thread, false); // thread put away: it keeps neither the hand nor its place
    if (archive && thread.kind !== 'topic') await stopCi(deps, thread);
    return;
  }
  if (f.type === 'action' && f.kind === 'subtopic') {
    need(str(f.client_id, 64) && id(f.thread) && id(f.msg) && (f.wake === undefined || typeof f.wake === 'boolean'));
    const cur = await deps.store.getThread(f.thread); need(!!cur && !!cur.general, 'forbidden');
    const space = await memberSpace(deps, who, cur!.space);
    const msg = await deps.store.getMessage(cur!.id, f.msg);
    need(!!msg && msg.author.kind === 'human' && msg.type === 'text', 'forbidden');
    // « Send to <agent> » (`wake`): like an @mention of the agent in charge, so the same gate as a mention, for the
    // one who sends it AND the message's author (the agent acts on that text). Checked before anything is written.
    const agent = f.wake ? loungeAgent(space) : null;
    if (f.wake) { need(wakes(space, who.id, cur!, msg!) && wakes(space, msg!.author.id, cur!, msg!), 'forbidden'); need(!!agent, 'no_agent'); }
    const r = await openSubtopic(deps, space, cur!, msg!, who.id);
    await reply({ v: 2, type: 'ack', client_id: f.client_id, thread: r.topic.id, msg_id: r.first.id });
    if (r.created) {
      await broadcast(deps, space.id, { v: 2, type: 'event', event: 'message.created', data: r.first });
      await broadcast(deps, space.id, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(r.topic) });
    }
    if (agent) return await wakeInSubtopic(deps, space, r.topic, r.first, agent, r.created);
    // A plain « Reply as topic » wakes no agent: the next message in the topic does, by the topic's usual rules.
    if (r.created && wantsHeading(space, r.topic, r.first, [r.first])) await wakeTitler(deps, space, r.topic, r.first).catch(e => console.error('title_wake_failed', (e as Error)?.message?.slice(0, 200)));
    return;
  }
  if (f.type === 'action' && f.kind === 'rename') {
    need(id(f.thread) && typeof f.title === 'string' && f.title.length <= 500);
    const cur = await deps.store.getThread(f.thread); need(!!cur && cur.kind === 'topic' && !cur.memoryReview && !cur.general, 'forbidden');
    const space = await memberSpace(deps, who, cur!.space);
    need(space.trusted.includes(who.id), 'forbidden'); // names it for everyone
    const text = cleanHeading(f.title);
    const thread = await mutateThread(deps, cur!.id, { type: 'noop' }, undefined, undefined, x => {
      const { heading, ...rest } = x;
      return text ? { ...rest, heading: { text, by: { kind: 'human', id: who.id }, at: deps.now() } } : rest;
    }, false);
    await broadcast(deps, thread.space, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(thread) });
    return;
  }
  if (f.type === 'action' && f.kind === 'invite') {
    need(id(f.thread) && typeof f.user === 'string' && f.user.length > 0 && f.user.length <= 64 && typeof f.on === 'boolean');
    const cur = await deps.store.getThread(f.thread); need(!!cur && cur.kind !== 'topic' && !cur.memoryReview && !cur.general, 'forbidden');
    const space = await memberSpace(deps, who, cur!.space);
    need(space.trusted.includes(who.id), 'forbidden'); // lets someone make the agent work here: a lead's call
    const was = cur!.invited ?? [];
    if (f.on) need((space.contributors ?? []).includes(f.user), 'not_contributor'); // never a member, nor a lead (already in)
    if (was.includes(f.user) === f.on) return; // already so: nothing to write
    const thread = await mutateThread(deps, cur!.id, { type: 'noop' }, undefined, undefined, x => {
      const next = f.on ? [...(x.invited ?? []).filter(u => u !== f.user), f.user] : (x.invited ?? []).filter(u => u !== f.user);
      const { invited, ...rest } = x;
      return next.length ? { ...rest, invited: next } : rest;
    }, false);
    await broadcast(deps, thread.space, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(thread) });
    return;
  }
  if (f.type === 'pin') {
    need(id(f.thread) && typeof f.on === 'boolean' && Number.isSafeInteger(f.at) && f.at > 0);
    const cur = await deps.store.getThread(f.thread); need(!!cur, 'forbidden');
    await memberSpace(deps, who, cur!.space); // a pin for oneself: any member, never for someone else
    const pin: Pin = { thread: cur!.id, space: cur!.space, on: f.on, at: f.at };
    if (!(await deps.store.putPin(who.id, pin))) return; // frame older than the last applied one
    // Only to this person's connections: how they organize themselves is their own business.
    for (const sub of await deps.store.listSubs(cur!.space)) {
      if (sub.kind !== 'human' || sub.principal !== who.id) continue;
      if ((await sendOne(deps, sub.connId, { v: 2, type: 'event', event: 'pin.updated', data: pin })) === false) await deps.store.deleteSub(cur!.space, sub.connId);
    }
    return;
  }
  if (f.type === 'seen') {
    const marks = f.marks as unknown;
    need(id(f.space) && Array.isArray(marks) && marks.length > 0 && marks.length <= SEEN_MAX
      && marks.every((m: any) => m && typeof m === 'object' && id(m.thread) && Number.isSafeInteger(m.at) && m.at > 0)
      && new Set(marks.map((m: any) => m.thread)).size === marks.length);
    await memberSpace(deps, who, f.space); // marks for oneself: any member
    // Only threads of that space (the key carries the space), never a mark from the future: it would hide what comes next.
    const known = new Set((await deps.store.threadsByIds(f.space, (f.marks as SeenMark[]).map(m => m.thread))).map(x => x.id));
    const max = deps.now() + 60_000;
    const valid = (f.marks as SeenMark[]).filter(m => known.has(m.thread) && m.at <= max).map(m => ({ thread: m.thread, at: m.at }));
    const applied = (await Promise.all(valid.map(async (m: SeenMark) => (await deps.store.putSeen(who.id, f.space, m)) ? m : null))).filter((m): m is SeenMark => m !== null);
    if (!applied.length) return; // all older than the stored marks
    for (const sub of await deps.store.listSubs(f.space)) {
      if (sub.kind !== 'human' || sub.principal !== who.id) continue;
      if ((await sendOne(deps, sub.connId, { v: 2, type: 'event', event: 'seen.updated', data: { space: f.space, marks: applied } })) === false) await deps.store.deleteSub(f.space, sub.connId);
    }
    return;
  }
  if (f.type === 'react') {
    need(id(f.thread) && id(f.msg) && (REACTIONS as readonly string[]).includes(f.emoji) && typeof f.on === 'boolean' && Number.isSafeInteger(f.at) && f.at > 0);
    const cur = await deps.store.getThread(f.thread); need(!!cur, 'forbidden');
    await memberSpace(deps, who, cur!.space);
    const m = await deps.store.getMessage(cur!.id, f.msg);
    need(!!m && (m.type === 'text' || m.type === 'ask'), 'forbidden'); // a real message of the thread (not a hub card)
    const r: Reaction = { thread: cur!.id, msg: f.msg, emoji: f.emoji, user: who.id, on: f.on, at: f.at, hubAt: deps.now() };
    if (!(await deps.store.putReaction(r))) return; // older than the last applied one
    // Broadcast to humans only; never delivered to the agent: a reaction never triggers a turn.
    await broadcast(deps, cur!.space, { v: 2, type: 'event', event: 'reaction.updated', data: r });
    return;
  }
  if (f.type === 'action' && f.kind === 'issue') {
    need(id(f.thread) && typeof f.repo === 'string');
    const cur = await deps.store.getThread(f.thread); need(!!cur && cur.kind !== 'topic', 'forbidden');
    const space = await memberSpace(deps, who, cur!.space);
    need(space.trusted.includes(who.id), 'forbidden');                  // writes to GitHub on behalf of the space
    need(!!space.github && reposOf(space).includes(f.repo), 'repo_not_attached'); // only the linked repos (and a Project)
    need(!cur!.issue && !cur!.issuePending, 'already_done');
    need(!!deps.queueGithub, 'github_off');
    await deps.queueGithub!({ kind: 'issue', thread: cur!.id, repo: f.repo, by: who.id });
    return;
  }
  if (f.type === 'action' && f.kind === 'label') {
    need(id(f.thread) && validLabel(f.label) && typeof f.on === 'boolean');
    need(!sameLabel(f.label, VETTING_LABEL), 'vetting_label'); // unstrikeable sets and lifts it: a member's comment is the go
    const t = await labelTarget(deps, f.thread, who.id);
    need(typeof t !== 'string', t as string);
    const { thread } = t as Exclude<typeof t, string>;
    need(thread.board!.labels.some(l => sameLabel(l, f.label)) !== f.on, 'already_done');
    need(!!deps.queueGithub, 'github_off');
    await deps.queueGithub!({ kind: 'label', id: deps.newId(), thread: thread.id, label: f.label, on: f.on, by: who.id });
    return;
  }
  if (f.type === 'action') {
    need(id(f.thread) && ['idea', 'done', 'reopen'].includes(f.kind));
    const cur = await deps.store.getThread(f.thread); need(!!cur, 'forbidden');
    const space = await memberSpace(deps, who, cur!.space);
    const thread = await mutateThread(deps, cur!.id, { type: 'action', kind: f.kind });
    await broadcast(deps, thread.space, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(thread) });
    // Closed or Later, by a trusted human: the thread gives the hand back (or leaves the queue). Not an untrusted member.
    if (f.kind !== 'reopen' && thread.kind !== 'topic' && space.trusted.includes(who.id)) { await leave(deps, space, thread, false); await stopCi(deps, thread); if (f.kind === 'done') await closedLeads(deps, space, thread); }
    return;
  }
  throw new Refused('unknown_type');
}

/**
 * The person's message makes an agent act in this conversation. Lead (`trusted`): anywhere. Contributor: in a Lounge
 * topic, or in a work thread a lead invited them into (`invited`), and only plain text: never an answer to a question
 * or approval card, nor a `/command` for the agent (both act on the agent's work). Without `msg`: whether their
 * messages count as context there.
 */
export function wakes(space: Space, who: string, thread: Pick<Thread, 'kind' | 'invited'>, msg?: Pick<Message, 'type' | 'text'>): boolean {
  if (space.trusted.includes(who)) return true;
  if (!(space.contributors ?? []).includes(who)) return false;
  if (thread.kind !== 'topic' && !(thread.invited ?? []).includes(who)) return false;
  return !msg || (msg.type === 'text' && !msg.text.trimStart().startsWith('/'));
}

/**
 * « Done » on a wait whose agent resumes (`outcome.resume`): the trusted human's message « Done », by the path of any
 * reply (clears the outcome, wakes the agent through `wakes()`). The write re-checks the wait: a double click or a
 * second tab finds it cleared and posts nothing.
 */
const STALE_WAIT = new Error('stale_wait');
async function doneReply(deps: Deps, space: Space, who: Principal, cur: StoredThread, at: number, text: string) {
  const msg: Message = { id: deps.newId(), thread: cur.id, author: { kind: 'human', id: who.id }, type: 'text', text, at: deps.now() };
  const seed = await peopleOf(deps, cur);
  let before: string[] = [];
  let thread: StoredThread;
  try {
    thread = await mutateThread(deps, cur.id, x => {
      if (x.facts.outcome?.kind !== 'waiting' || x.facts.outcome.at !== at) throw STALE_WAIT;
      return { type: 'human.post', trusted: true };
    }, undefined, undefined, x => { before = x.people ?? seed; return { ...unarchive(x), people: withPerson(before, who.id) } });
  } catch (e) { if (e === STALE_WAIT) return; throw e; }
  await deps.store.upsertMessage(msg);
  await afterHumanMessage(deps, space, who, thread, msg, 'message.created', messageTo(before, [], who.id, space.members));
}

/** Broadcasts to humans, then delivers to the agent in charge only if the author may make it act here (`wakes`). */
/**
 * Humans concerned by a conversation (protocol/notify.ts). Missing on one older than the rule: rebuilt once from its
 * opener, its topic author and the authors of its last PEOPLE_SEED messages (stored by the post that follows).
 */
const PEOPLE_SEED = 100;
export async function peopleOf(deps: Deps, t: StoredThread): Promise<string[]> {
  if (t.people) return t.people;
  let out: string[] = [];
  for (const p of [t.opener, t.author]) if (p) out = withPerson(out, p);
  for (const m of await deps.store.lastMessages(t.id, PEOPLE_SEED)) if (m.author.kind === 'human') out = withPerson(out, m.author.id);
  return out;
}

/** `notify`: the members a new message is for (`messageTo`): told to their tabs (alert) and queued for their Web Push. */
export async function afterHumanMessage(deps: Deps, space: Space, who: Principal, thread: StoredThread, msg: Message, event: 'message.created' | 'message.updated' = 'message.created', notify: string[] = []) {
  notify = await withoutMuted(deps, space, notify, msg.text); // a muted space rings only for a mention (hub/src/mute.ts)
  await broadcast(deps, space.id, { v: 2, type: 'event', event, data: msg, ...(notify.length ? { notify } : {}) });
  await broadcast(deps, space.id, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(thread) });
  // Best effort, like the Your turn push: a queue failure never fails the post that already happened.
  if (notify.length && deps.queuePush && !thread.memoryReview && !thread.archived)
    await deps.queuePush({ thread: thread.id, version: thread.version, to: notify, by: who.id, msg: msg.id }).catch(e => console.error('push_queue_failed', (e as Error)?.name));
  if (!wakes(space, who.id, thread, msg)) return; // safeguard: a member never triggers an agent turn, a contributor only in the Lounge
  if (thread.general) return await fromGeneral(deps, space, who, thread, msg);
  const last = await deps.store.lastMessages(thread.id, 30);
  if (thread.kind === 'topic') { // passive agents in the Lounge: only the ones the message is for
    // An applet's run opened as a topic (« threads » off): its first message is for the applet's agent, already titled.
    const run = thread.applet?.msg === msg.id;
    // A run's « Discuss the result » topic: a message without a mention is for the applet's agent (hub/src/applets.ts).
    const agents = run ? [thread.owner] : msg.voiceAsk ? [voiceAgent(thread, last)] : addressed(space, last, msg, talksTo(space, thread) ? thread : undefined);
    const naming = !run && event === 'message.created' && wantsHeading(space, thread, msg, last);
    for (const agent of agents) await deliverPending(deps, space, await speaker(deps, thread, agent), msg, last, agent, naming && titlesInTurn(space, thread, agent));
    // Not titled in a turn of this message: a short turn of the memory agent, out of sight (one per new topic, no batch).
    if (naming && !agents.some(a => titlesInTurn(space, thread, a))) await wakeTitler(deps, space, thread, msg).catch(e => console.error('title_wake_failed', (e as Error)?.message?.slice(0, 200)));
    return;
  }
  // Board task turn running (or granted): the message waits for its end, then goes to the same session (`turn.ended`).
  // Why: Hermes' default busy mode would interrupt the task turn with it.
  if (flowTurn(thread, deps.now())) return;
  // The agents it mentions, else the one whose reply it follows, else the agent in charge. A guest just answers.
  const agents = addressed(space, last, msg, thread);
  for (const a of agents.filter(x => x !== thread.owner)) { thread = await speaker(deps, thread, a); await deliverPending(deps, space, thread, msg, last, a); }
  if (!agents.includes(thread.owner)) return;
  // Board-driven space: no hand nor resources (the flow holds the hand only for a task), delivered at once.
  const work = !boardDriven(space);
  // A new exchange: the thread leaves the resource queues (the agent re-acquires what it needs).
  if (work && parallelOf(space).resources.length) await freeResources(deps, space, thread.id, { held: false, queued: true });
  // An edited message is delivered again: its edit time, not its post time (already delivered), is the new input.
  // Queued: a talk turn now (Lounge rights, queuetalk.ts); the message is delivered again only if nothing followed it.
  if (work && !(await take(deps, space, thread, msg.edited ?? msg.at, who.id))) return await talkWhileQueued(deps, space, thread, msg, last);
  // Opened from a card and never started: its kickoff never reached the agent (a send that failed after the hand was
  // taken, e.g. a throttled WebSocket post). This message brings the brief with it, else the agent works without it.
  if (thread.from && thread.lastTurnAt === 0) return await kickoff(deps, space, thread, who.id, last);
  await deliverPending(deps, space, thread, msg, last);
}

/**
 * General: never an agent turn there. A message that @mentions agents of the space (from a human who may wake them,
 * checked by the caller) opens a topic from it, where they answer as in any topic (`deliver.context.ambient`).
 */
async function fromGeneral(deps: Deps, space: Space, who: Principal, general: StoredThread, msg: Message) {
  if (msg.type !== 'text' || !visibleAgents(space).some(a => mentions(msg.text, a))) return;
  const r = await openSubtopic(deps, space, general, msg, who.id);
  if (r.created) await afterHumanMessage(deps, space, who, r.topic, r.first); // broadcast, delivery, title: a topic's first message
}

/** Agent woken by « Send to <agent> » on a General message: always the space's agent in charge, if it is one of its agents. */
export const loungeAgent = (s: Space): string | null => s.defaultAgent && agentsOf(s).includes(s.defaultAgent) ? s.defaultAgent : null;

/**
 * « Send to <agent> »: the topic opened from a General message, delivered to `agent` as if the message mentioned it.
 * Topic already open: the agent gets its latest human message, with what it has not seen since its last reply.
 */
async function wakeInSubtopic(deps: Deps, space: Space, topic: StoredThread, first: Message, agent: string, created: boolean) {
  const last = await deps.store.lastMessages(topic.id, 30);
  const msg = created ? first : last.filter(m => m.author.kind === 'human' && !m.deleted && (m.type === 'text' || m.type === 'answer')).at(-1) ?? first;
  const naming = created && wantsHeading(space, topic, first, last);
  await deliverPending(deps, space, await speaker(deps, topic, agent), msg, last, agent, naming && titlesInTurn(space, topic, agent));
  if (naming && !titlesInTurn(space, topic, agent)) await wakeTitler(deps, space, topic, first).catch(e => console.error('title_wake_failed', (e as Error)?.message?.slice(0, 200)));
}

/** Messages read to check an edit: the edited one must be among them (older ones always have a human after them). */
const EDIT_WINDOW = 50;

/**
 * Edit of one's own last message (↑ in the client). Rules in `protocol/edit.ts`, checked on fresh data and written
 * under the thread's `version` guard: a message posted or a turn started between the check and the write moves the
 * version, and the check runs again on the new state. The message has its own `rev` guard (two tabs editing at once:
 * the second gets `stale`). Then it behaves like a new post of the same message: the partial answer of a stopped turn
 * that called no tool is erased, and the edited text (marked `edited`) is delivered to the agent again.
 */
async function editMessage(deps: Deps, who: Principal, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  need(str(f.client_id, 64) && id(f.thread) && id(f.msg) && Number.isSafeInteger(f.rev) && f.rev >= 0 && str(f.text, MAX_TEXT));
  const first = await deps.store.getThread(f.thread); need(!!first, 'forbidden');
  const space = await memberSpace(deps, who, first!.space);
  const trusted = space.trusted.includes(who.id);
  for (let attempt = 0; ; attempt++) {
    const cur = await deps.store.getThread(first!.id); need(!!cur, 'forbidden');
    const last = await deps.store.lastMessages(cur!.id, EDIT_WINDOW);
    const block = editBlock(last, f.msg, who.id, cur!.facts.turnActive);
    if (block) throw new Refused(block);
    const m = last.find(x => x.id === f.msg)!;
    need((m.rev ?? 0) === f.rev, 'stale');
    if (m.text === f.text) { await reply({ v: 2, type: 'ack', client_id: f.client_id, thread: cur!.id, msg_id: m.id }); return; }
    // First message of the conversation (fewer messages than the window): its title and topic text follow the edit.
    const opening = last.length < EDIT_WINDOW && last[0]?.id === m.id;
    let thread: StoredThread;
    try {
      thread = await mutateThread(deps, cur!.id, { type: 'human.post', trusted }, undefined, undefined, x => {
        if (x.version !== cur!.version) throw new Refused('stale'); // moved since the check: check again
        let y = trusted ? unarchive(x) : x;
        if (opening && y.title === m.text.slice(0, 80)) y = { ...y, title: f.text.slice(0, 80) };
        if (opening && y.kind === 'topic') y = { ...y, text: topicText(f.text) };
        if (y.general && y.last?.at === m.at && y.last.author === m.author.id) y = { ...y, last: { ...y.last, text: topicText(f.text) } }; // General's preview follows
        return y;
      });
    } catch (e) { if (e instanceof Refused && e.code === 'stale' && attempt < 2) continue; throw e; }
    const r = await deps.store.upsertMessage({ ...m, text: f.text, edited: deps.now(), rev: f.rev + 1 });
    need(!!r, 'stale'); // another tab's edit won
    const gone = erasedByEdit(last, m.id);
    for (const x of gone) await deps.store.deleteMessage(thread.id, x);
    await reply({ v: 2, type: 'ack', client_id: f.client_id, thread: thread.id, msg_id: m.id });
    if (gone.length) await broadcast(deps, space.id, { v: 2, type: 'event', event: 'message.deleted', data: { thread: thread.id, ids: gone } });
    await afterHumanMessage(deps, space, who, thread, r!.message, 'message.updated');
    return;
  }
}

/**
 * Deletion of one's own message (`deletable`), any time, nobody else's. The item stays in place (id, author, time,
 * reactions, cards, threads opened from it, pins): its text and attachments go (S3 objects too) and `deleted` is set,
 * under the message's `rev` guard. A General message and the first message of the topic opened from it are the same
 * words: deleting either empties both. Never a turn: agents get one context line at their next turn (deletionsSince).
 */
async function deleteOwnMessage(deps: Deps, who: Principal, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  need(str(f.client_id, 64) && id(f.thread) && id(f.msg) && Number.isSafeInteger(f.rev) && f.rev >= 0);
  const thread = await deps.store.getThread(f.thread); need(!!thread, 'forbidden');
  const space = await memberSpace(deps, who, thread!.space);
  const m = await deps.store.getMessage(thread!.id, f.msg); need(!!m, 'unknown');
  if (!deletable(m!, who.id)) throw new Refused('not_author');
  const ack = () => reply({ v: 2, type: 'ack', client_id: f.client_id, thread: thread!.id, msg_id: m!.id });
  if (m!.deleted) { await ack(); return; } // a second tab, a retry: already done
  need((m!.rev ?? 0) === f.rev, 'stale');
  const deleted = { at: deps.now(), by: who.id };
  need(await eraseOne(deps, space, thread!, m!, deleted), 'stale');
  await ack();
  const twin = m!.subtopic ? { thread: m!.subtopic, id: subtopicFirstId(m!.id) }
    : thread!.from && thread!.fromMsg && m!.id === subtopicFirstId(thread!.fromMsg) ? { thread: thread!.from, id: thread!.fromMsg } : null;
  const other = twin && await deps.store.getThread(twin.thread);
  const copy = other && other.space === space.id ? await deps.store.getMessage(other.id, twin!.id) : null;
  if (other && copy && !copy.deleted && deletable(copy, who.id)) await eraseOne(deps, space, other, copy, deleted);
}

/** Empties `m` (store, S3 objects, the thread's lines copied from its text), then every client shows it deleted. */
async function eraseOne(deps: Deps, space: Space, thread: StoredThread, m: Message, deleted: { at: number; by: string }): Promise<boolean> {
  const r = await deps.store.eraseMessage(thread.id, m.id, (m.rev ?? 0) + 1, deleted);
  if (!r) return false; // another tab's edit or delete won
  for (const x of m.files ?? []) await deps.files?.remove(fileKey(space.id, x.id));
  // Copies of the words on the thread: a title or topic text taken from it, General's last-message line.
  const from = (y: StoredThread) => ({ title: y.title === m.text.slice(0, 80), text: y.kind === 'topic' && !!y.text && y.text === topicText(m.text),
    last: !!y.general && y.last?.at === m.at && y.last.author === m.author.id && !!y.last.text });
  const hit = from(thread);
  if (m.text && (hit.title || hit.text || hit.last)) {
    const y = await mutateThread(deps, thread.id, { type: 'noop' }, undefined, undefined, x => {
      const h = from(x);
      // A topic's first message gone: the agent's heading was made from it, it goes too (a lead's own heading stays).
      const { heading, ...rest } = x, keep = !h.text || heading?.by.kind !== 'agent';
      return { ...rest, ...(keep && heading ? { heading } : {}), ...(h.title || h.text ? { title: DELETED_TITLE } : {}), ...(h.text ? { text: '' } : {}),
        ...(h.last ? { last: { ...x.last!, text: '' } } : {}) };
    }, false);
    await broadcast(deps, space.id, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(y) });
  }
  await broadcast(deps, space.id, { v: 2, type: 'event', event: 'message.updated', data: r });
  return true;
}

/**
 * Messages deleted since the agent last spoke (`deliver.context.deleted`, the plugin tells the agent to drop them):
 * never a turn of its own, it rides on the next one. Only the deletions of humans who may make it act here (same
 * filter as the context). The words are gone: author and the message's time only.
 */
function deletionsSince(space: Space, thread: StoredThread, last: Message[], after: number): { who: string; at: number }[] {
  return last.filter(m => m.deleted && m.deleted.at > after && m.author.kind === 'human' && wakes(space, m.author.id, thread))
    .map(m => ({ who: space.names?.[m.author.id] ?? 'Member', at: m.at }));
}

/** Delivers `msg` with, as context, what was said since the agent last spoke (reactions included). `queued`: a talk
 *  turn of a queued thread (queuetalk.ts); `whole`: the whole history goes (a thread never started: its brief, signed by the agent). */
export async function deliverPending(deps: Deps, space: Space, thread: StoredThread, msg: Message, last: Message[], agent = thread.owner, nameTopic = false, queued?: QueuedTalk, whole = false, relaunched = false) {
  // What `agent` has not seen: everything since its own last reply (another agent's answers included).
  const since = whole ? -1 : last.findLastIndex(m => m.author.kind === 'agent' && m.author.id === agent);
    const after = since >= 0 ? last[since].at : 0;
  await deliver(deps, space, thread, msg, last.slice(since + 1).filter(m => m.id !== msg.id),
    [...await reactionsSince(deps, space, thread, last, after), ...dismissalsSince(space, thread, last, agent, after)], agent, nameTopic, deletionsSince(space, thread, last, after), [], queued, relaunched);
}

/**
 * Cards of `agent` (thread, issue, plan) dismissed by a trusted human since the agent last spoke, as context lines of
 * its next turn: without them the agent kept bringing up a proposal the human had set aside. Never a turn of its own.
 */
function dismissalsSince(space: Space, thread: StoredThread, last: Message[], agent: string, after: number): { who: string; text: string; at: number }[] {
  const out: { who: string; text: string; at: number }[] = [];
  for (const m of last) {
    const c = m.propose ? { kind: 'thread', by: m.propose.by ?? thread.owner, ...m.propose } : m.newIssue ? { kind: 'issue', ...m.newIssue } : m.plan ? { kind: 'plan', ...m.plan } : null;
    const d = c?.status === 'dismissed' ? c.dismissed : undefined;
    if (!c || !d || c.by !== agent || d.at <= after || !wakes(space, d.by, thread)) continue;
    out.push({ who: space.names?.[d.by] ?? 'Member', at: d.at,
      text: `(clicked Not now on your ${c.kind} card "${c.title.slice(0, 100)}": it is dismissed, do not bring it up again unless asked)` });
  }
  return out;
}

/**
 * The space's agents a message is for. An answer to a question card: the agent that asked. Else the ones it mentions,
 * else the agent that just replied (follow-up). Then, in a Lounge topic (`thread` absent), the only agent of a solo
 * space, and a mention of anyone else keeps the message between humans; in a work thread, the agent in charge.
 */
/**
 * The agent a voice request is for: in a Lounge topic the last agent that spoke there (no agent is at work in a topic,
 * its owner is only the space's default agent), else the topic's owner; in a thread its agent in charge. The client
 * applies the same rule to its « Voice » button (client/src/preview.ts voiceAgent).
 */
export function voiceAgent(thread: Pick<StoredThread, 'kind' | 'owner'>, last: Pick<Message, 'author'>[]): string {
  if (thread.kind !== 'topic') return thread.owner;
  return last.filter(m => m.author.kind === 'agent').at(-1)?.author.id ?? thread.owner;
}

// A backstage memory agent is never addressed: not @mentioned by hand, nor as the owner of a conversation it had
// before it went backstage (that one waits for another agent).
function addressed(space: Space, last: Message[], msg: Message, thread?: StoredThread): string[] {
  const hidden = backstageAgent(space);
  return addressedAmong(space, last, msg, thread).filter(a => a !== hidden);
}
function addressedAmong(space: Space, last: Message[], msg: Message, thread?: StoredThread): string[] {
  const agents = visibleAgents(space);
  const asker = msg.type === 'answer' ? last.find(m => m.type === 'ask' && m.ask?.id === msg.ask?.id)?.author : undefined;
  if (asker?.kind === 'agent' && (agents.includes(asker.id) || asker.id === thread?.owner)) return [asker.id];
  const named = agents.filter(a => mentions(msg.text, a));
  if (named.length) return named;
  const prev = repliedBefore(last, msg);
  if (prev && (agents.includes(prev) || prev === thread?.owner)) return [prev];
  if (thread) return [thread.owner];
  return solo(space, msg.author.id) && !MENTION_RE.test(msg.text) ? agents : [];
}

/**
 * One agent and one human, a lead (`trusted`): nobody else to talk to, so a topic message without mention is for the
 * agent. Why only then: with two humans, an exchange between them would wake the agent and cost tokens.
 */
const solo = (s: Space, who: string) => visibleAgents(s).length === 1 && s.members.length === 1 && s.members[0] === who && s.trusted.includes(who);

/** `agent` is handed a turn in the conversation, recorded first so that its instance may answer there (`fromInstance`). */
export async function speaker(deps: Deps, topic: StoredThread, agent: string): Promise<StoredThread> {
  if (Object.hasOwn(turnsOf(topic), agent)) return topic;
  return await mutateThread(deps, topic.id, { type: 'noop' }, undefined, undefined, x => {
    const t = turnsOf(x);
    return Object.hasOwn(t, agent) ? x : { ...x, turns: { ...t, [agent]: { at: 0, active: false } } };
  });
}

// ---------------------------------------------------------------- the agent's hand per space, shared resources
// Product decisions. strict (default): in a space, the agent works on one thread at a time (two threads can touch the
// same stack). cooperative: up to `max` threads at once (one worktree per thread on the agent side), and what really
// conflicts (a stack, the emulator, the gateway) is a shared resource taken with `resource.acquire` right before use.
// The agent keeps its place on a thread until the task is finished, even while waiting for an answer; the other
// threads wait in arrival order. One record per (space, agent) and one per (space, resource), written under a
// `version` guard (concurrent Lambdas). Lounge topics are not part of it (discussion, not work).
export const parallelOf = (s: Space): Parallel => s.parallel ?? DEFAULT_PARALLEL;
/** Threads an agent may hold at once in the space. */
const slots = (s: Space) => parallelOf(s).mode === 'strict' ? 1 : parallelOf(s).max;
const publicLock = (l: StoredLock): AgentLock => ({ space: l.space, agent: l.agent, holders: l.holders, queue: l.queue, since: l.since, version: l.version });
export const publicResource = (r: StoredResource): ResourceLock => ({ space: r.space, resource: r.resource, holder: r.holder, agent: r.agent, queue: r.queue, since: r.since, version: r.version });
export const omit = <T>(o: Record<string, T>, k: string) => { const { [k]: _, ...rest } = o; return rest };

/** A hand written before parallel work (`holder`, `delivered` as a number) is read in the current shape; the next write replaces it. */
export function normLock(l: any): StoredLock | null {
  if (!l) return null;
  const { holder, ...rest } = l;
  const holders: string[] = Array.isArray(l.holders) ? l.holders : holder ? [holder] : [];
  const delivered: Record<string, number> = typeof l.delivered === 'number' ? (holder ? { [holder]: l.delivered } : {}) : l.delivered ?? {};
  return { ...rest, holders, delivered, by: l.by ?? {}, queue: l.queue ?? [] };
}

/** Read-modify-write of the hand, optimistic lock, 3 attempts. `fn` returns null when there is nothing to change. */
export async function mutateLock(deps: Deps, space: string, agent: string, fn: (l: StoredLock) => StoredLock | null): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = normLock(await deps.store.getLock(space, agent));
    const base: StoredLock = cur ?? { space, agent, holders: [], queue: [], since: 0, version: 0, by: {}, delivered: {} };
    const n = fn(base);
    if (!n) return;
    const next = { ...n, version: base.version + 1 };
    if (!(await deps.store.putLock(next, cur ? cur.version : null))) continue;
    // Only if what humans see changed (not for `delivered`).
    if (next.holders.join() !== base.holders.join() || next.queue.join() !== base.queue.join()) await broadcast(deps, space, { v: 2, type: 'event', event: 'lock.updated', data: publicLock(next) });
    return;
  }
  throw new Error('lock_conflict');
}

/** A queue head getting a place: who queued it, and its talk turns while waiting (queuetalk.ts). */
type Next = { thread: string; by: string; talk?: Talk };
/** Free places go to the queue heads, in order. Returns the new hand and who must be handed over. */
function promote(space: Space, l: StoredLock, now: number): { lock: StoredLock; next: Next[] } {
  let { holders, queue, by, delivered } = l, talk = l.talk ?? {};
  const next: Next[] = [];
  while (holders.length < slots(space) && queue.length) {
    const [n, ...rest] = queue;
    next.push({ thread: n, by: by[n], ...(talk[n] ? { talk: talk[n] } : {}) });
    holders = [...holders, n]; queue = rest; by = omit(by, n); talk = omit(talk, n); delivered = { ...delivered, [n]: 0 };
  }
  return { lock: { ...l, holders, queue, by, delivered, talk, since: next.length ? now : l.since }, next };
}

/**
 * A message (`at`) from a trusted human (`by`) waits for the agent in this thread: true if it must be delivered now
 * (a free place or already held by this thread, message not delivered yet), false if the thread goes (or stays) in the queue.
 */
export async function take(deps: Deps, space: Space, thread: StoredThread, at: number, by: string): Promise<boolean> {
  let go = false;
  await mutateLock(deps, space.id, thread.owner, l => {
    go = false;
    if (l.holders.includes(thread.id)) { if ((l.delivered[thread.id] ?? 0) >= at) return null; go = true; return { ...l, delivered: { ...l.delivered, [thread.id]: at } }; } // already delivered by the handover
    if (l.holders.length < slots(space)) { go = true; return { ...l, holders: [...l.holders, thread.id], queue: l.queue.filter(x => x !== thread.id), by: omit(l.by, thread.id), talk: omit(l.talk ?? {}, thread.id), since: deps.now(), delivered: { ...l.delivered, [thread.id]: at } }; }
    if (l.queue.includes(thread.id)) return null; // keeps its place
    return { ...l, queue: [...l.queue, thread.id], by: { ...l.by, [thread.id]: by } };
  });
  return go;
}

/**
 * The thread gives its place back (task finished, Closed, Idea, archived, "Release") or leaves the queue; the next ones
 * go and get what was waiting for them. `onlyHolder`: "Release" only acts on a thread holding a place.
 * In both cases, the thread also frees the resources it holds and leaves the resource queues.
 */
export async function leave(deps: Deps, space: Space, thread: StoredThread, onlyHolder: boolean) {
  let next: Next[] = [];
  await mutateLock(deps, space.id, thread.owner, l => {
    next = [];
    let base = l;
    if (l.holders.includes(thread.id)) base = { ...l, holders: l.holders.filter(x => x !== thread.id), delivered: omit(l.delivered, thread.id), since: deps.now() };
    else if (!onlyHolder && l.queue.includes(thread.id)) base = { ...l, queue: l.queue.filter(x => x !== thread.id), by: omit(l.by, thread.id), talk: omit(l.talk ?? {}, thread.id) };
    else return null;
    const p = promote(space, base, deps.now());
    next = p.next;
    return p.lock;
  });
  await freeResources(deps, space, thread.id, { held: true, queued: true });
  for (const n of next) await handOver(deps, space, thread.owner, n);
}

/** After a settings change (more places): the queue heads go right away. */
async function fillPlaces(deps: Deps, space: Space, agent: string) {
  let next: Next[] = [];
  await mutateLock(deps, space.id, agent, l => { const p = promote(space, l, deps.now()); next = p.next; return next.length ? p.lock : null; });
  for (const n of next) await handOver(deps, space, agent, n);
}

/** Handover: the thread leaving the queue gets the last trusted message that was waiting (or its kickoff from the Lounge). */
async function handOver(deps: Deps, space: Space, agent: string, next: Next) {
  const thread = await deps.store.getThread(next.thread);
  const skip = () => leave(deps, space, thread ?? ({ id: next.thread, owner: agent } as StoredThread), true);
  if (!thread || thread.archived || thread.facts.manual || thread.owner !== agent) return await skip(); // put away or changed meanwhile
  const last = await deps.store.lastMessages(thread.id, 30);
  if (thread.from && (thread.lastTurnAt === 0 || next.talk?.fresh)) { // opened from the Lounge, never started (talk turns aside)
    if (!last.length || !(await take(deps, space, thread, last[0].at, next.by))) return;
    return await kickoff(deps, space, thread, next.by, last);
  }
  const since = last.findLastIndex(m => m.author.kind === 'agent' && m.author.id === agent);
  // A message for a guest only (it mentions another agent) was delivered to it at once, not queued for the owner.
  const msg = last.slice(since + 1).filter((m, i) => m.author.kind === 'human' && space.trusted.includes(m.author.id) && (m.type === 'text' || m.type === 'answer')
    && addressed(space, last.slice(0, since + 2 + i), m, thread).includes(agent)).at(-1);
  if (next.talk && relaunchOf(next.talk, msg) === 'relaunch') { // talked while queued: the hub relaunches the agent on the work
    const go: Message = { id: deps.newId(), thread: thread.id, author: { kind: 'human', id: next.by }, type: 'text', at: deps.now(), text: RELAUNCH_TEXT };
    if (!(await take(deps, space, thread, Math.max(go.at, msg?.at ?? 0), next.by))) return;
    return await deliver(deps, space, thread, go, [], [], agent, false, [], [], undefined, true);
  }
  if (!msg) return await skip(); // nothing to deliver: the place goes to the next one
  if (!(await take(deps, space, thread, msg.at, next.by))) return; // already delivered by a message that arrived during the handover
  await deliverPending(deps, space, thread, msg, last, agent, false, undefined, false, !!next.talk);
}

/** Human who triggered the running turn of a thread (last human message if it may wake the agent there, or the lead who opened it from the Lounge). */
export async function turnAuthor(deps: Deps, space: Space, thread: StoredThread): Promise<string | null> {
  if (flowTurn(thread, deps.now())) return null; // a board task's turn: triggered by the flow, not by a human
  const human = (await deps.store.lastMessages(thread.id, 100)).filter(m => m.author.kind === 'human').at(-1);
  if (human) return wakes(space, human.author.id, thread, human) ? human.author.id : null;
  // A routine's run (Settings › Routines): the admin it is attributed to, while still a lead.
  if (thread.routine) return space.trusted.includes(thread.routine.by) ? thread.routine.by : null;
  if (!thread.from) return null;
  if (thread.opener) return space.trusted.includes(thread.opener) ? thread.opener : null;
  // Opened before the hub recorded `opener`: opening a card is reserved to trusted humans (same gate as `outcome`);
  // the resume is attributed to the trusted human whose request led to the card.
  const topic = await deps.store.lastMessages(thread.from, 100);
  const card = topic.find(m => m.type === 'propose' && m.propose?.thread === thread.id);
  if (!card) return null;
  return topic.filter(m => m.id < card.id && m.author.kind === 'human' && space.trusted.includes(m.author.id)).at(-1)?.author.id ?? null;
}

/**
 * Trusted humans' reactions posted since the agent last spoke, as context of its next turn
 * (data lines, like unseen messages). Other members' reactions never reach it.
 */
async function reactionsSince(deps: Deps, space: Space, thread: StoredThread, last: Message[], after: number): Promise<{ who: string; text: string; at: number }[]> {
  const byId = new Map(last.map(m => [m.id, m]));
  return (await deps.store.listReactions(thread.id))
    .filter(r => r.on && r.hubAt > after && wakes(space, r.user, thread) && byId.has(r.msg))
    .map(r => {
      const m = byId.get(r.msg)!;
      const excerpt = m.text.replace(/\s+/g, ' ').trim().slice(0, 100);
      const whose = m.author.kind === 'agent' ? 'your message' : 'the message';
      return { who: space.names?.[r.user] ?? 'Member', text: `(reaction ${r.emoji} to ${whose} "${excerpt}${m.text.length > 100 ? '…' : ''}")`, at: r.hubAt };
    });
}

export async function deliver(deps: Deps, space: Space, thread: StoredThread, msg: Message, context: Message[], reactions: { who: string; text: string; at: number }[] = [], agent = thread.owner, nameTopic = false, deleted: { who: string; at: number }[] = [], extra: (FileRef & { by: string })[] = [], queued?: QueuedTalk, relaunched = false) {
  // Backstage memory agent: woken only by the memory passes (memory.ts, their own delivery), never by a conversation.
  if (agent === backstageAgent(space)) return void console.log('backstage_refused', JSON.stringify({ space: space.id, thread: thread.id, agent }));
  const name = (m: Message) => m.author.kind === 'agent' ? cap(m.author.id) : m.author.kind === 'system' ? 'briefling' : space.names?.[m.author.id] ?? 'Member';
  // Only messages from agents and from humans who may make the agent act here serve as context (same safeguard as delivery).
  const kept = context.filter(m => m.type !== 'propose' && !m.deleted && (m.author.kind === 'agent' || (m.author.kind === 'human' && wakes(space, m.author.id, thread))));
  const unseen = [...kept.map(m => ({ who: name(m), text: m.text + attached(m), at: m.at })), ...reactions]
    .sort((a, b) => a.at - b.at).map(({ who, text }) => ({ who, text }));
  // Attachments of the message and of its context (same filter), in chronological order, the MAX_FILES most recent:
  // an image posted alone then "@agent look" in the next message must reach the agent.
  // `by`: author of the file's message, so the instance can tell a voice note of the requester from other audio.
  const own = (m: Message) => (m.files ?? []).map(f => ({ ...f, by: m.author.id }));
  // `extra`: attachments picked by the kickoff from the topic (its messages are not sent), oldest first.
  // A run's discussion topic: the agent's first turn there gets the run's values, result and files (hub/src/applets.ts).
  const talk = thread.appletTalk ? await talkFor(deps, space, thread, msg, agent).catch(e => { console.error('applet_talk_context_failed', (e as Error)?.name); return null }) : null;
  const refs = [...extra, ...(talk?.files ?? []), ...[...kept].sort((a, b) => a.at - b.at).flatMap(own), ...own(msg)].slice(-MAX_FILES);
  const files = deps.files && refs.length ? await Promise.all(refs.map(async x => ({ ...x, url: await deps.files!.presignGet(fileKey(space.id, x.id), x) }))) : undefined;
  const guest = isGuest(thread, agent);
  const work = thread.kind !== 'topic' && !boardDriven(space) && !guest;
  const issue = boardDriven(space) ? await issueContext(deps, thread, context) : null;
  const { memory, tags: memoryTags } = await turnMemory(deps, space, thread, msg, agent);
  const tagVocab = nameTopic || (work && !thread.tags && !thread.memoryReview) ? await tagVocabFor(deps, space) : { list: [], open: false };
  const elsewhere = guest || thread.memoryReview ? [] : await otherSpaces(deps, space, thread, msg, agent);
  // First turn of a topic opened from General: what was said there just before, once (same author filter as `kept`).
  const ambient = thread.from && thread.fromMsg && msg.id === subtopicFirstId(thread.fromMsg)
    ? (await deps.store.lastMessages(thread.from, AMBIENT_MAX, thread.fromMsg))
      .filter(m => !m.deleted && (m.author.kind === 'agent' || (m.author.kind === 'human' && wakes(space, m.author.id, { kind: 'topic' }))))
      .map(m => ({ who: name(m), text: m.text + attached(m) }))
    : [];
  const spawned = thread.kind === 'topic' && thread.spawned?.length ? await spawnedContext(deps, space.id, thread.spawned) : [];
  // A new conversation on the subject of a pending lead of the space: the agent mentions it once (hub/src/leads.ts).
  const recalled = await recallFor(deps, space, thread, msg, agent).catch(e => { console.error('leads_recall_failed', JSON.stringify({ thread: thread.id, err: (e as Error)?.name })); return { leads: [] as LeadRecalled[] } });
  // An applet's run: its first message reaches the agent wrapped (instruction, delivery rule, values as untrusted data).
  const run = thread.applet && msg.id === thread.applet.msg ? thread.applet : null;
  const message = run ? { ...msg, text: appletPrompt(run.name, run.instruction, name(msg), msg.text, run.id, thread.kind === 'topic') } : talk ? { ...msg, text: talk.text } : msg;
  const frame: HubFrame = { v: 2, type: 'deliver', thread: thread.id, space: space.id, agent, message, author_name: name(msg), ...(files ? { files } : {}),
    context: { title: thread.title, kind: thread.kind ?? 'thread', ...(space.about ? { space_about: space.about } : {}), unseen,
      ...(msg.author.kind === 'human' && nontechOf(space).includes(msg.author.id) ? { author_nontech: true as const } : {}),
      ...(work && parallelOf(space).resources.length ? { resources: parallelOf(space).resources } : {}),
      ...(work && Object.keys(parallelOf(space).rules ?? {}).length ? { resource_rules: parallelOf(space).rules } : {}),
      ...(work && slots(space) > 1 ? { parallel: true } : {}), ...(issue ? { issue } : {}), ...(boardDriven(space) ? { repos: reposOf(space) } : {}),
      ...(thread.kind !== 'topic' && !guest && space.ci && modOn(space, 'ci') && reposOf(space).length ? { ci: reposOf(space) } : {}),
      // « threads » module off: threads: false, so the plugin drops the propose_thread / propose_plan instructions.
      ...(!modOn(space, 'threads') ? { threads: false as const } : {}),
      // No repo attached: no `pushed` (no commit/push instruction for a space about anything else), only `code` when
      // there is one, also in topics (the plugin words the Lounge rules for code or not).
      // « code » module off (protocol/modules.ts): code: false, so the plugin drops those instructions even if it mounts a project.
      ...(!modOn(space, 'code') ? { code: false } : { ...(work && reposOf(space).length ? { pushed: reposOf(space) } : {}), ...(reposOf(space).length ? { code: true } : {}) }),
      ...(memory.length ? { memory } : {}), ...(memoryTags.length ? { memory_tags: memoryTags } : {}),
      ...(guest ? { in_charge: thread.owner } : {}), ...(queued && work ? { queued } : {}), ...(relaunched && work ? { relaunched: true } : {}), ...(nameTopic ? { name_topic: true } : {}), ...(tagVocab.list.length || tagVocab.open ? { tag_vocab: tagVocab.list } : {}), ...(tagVocab.open ? { tag_open: true as const } : {}), ...(ambient.length ? { ambient } : {}), ...(spawned.length ? { spawned } : {}), ...(deleted.length ? { deleted } : {}),
      ...(recalled.leads.length ? { leads: recalled.leads.map(l => ({ from: l.from, from_title: l.fromTitle, what: l.what })) } : {}),
      ...(elsewhere.length ? { spaces: elsewhere } : {}) } };
  const reached = await toInstances(deps, space.id, agent, frame);
  // Nobody received it: say so in the conversation instead of losing it silently (not replayed, not stored).
  if (!reached) await broadcast(deps, space.id, { v: 2, type: 'event', event: 'message.undelivered', data: { thread: thread.id, message: msg.id, agent } });
}

/**
 * `context.spaces`: the other spaces `agent` serves where the human of the turn is a member (targets of a cross-space
 * `thread.propose`, readable with `memory_search`). The instance check is left to the frame itself (several instances
 * may serve one agent). A failure never blocks the delivery.
 */
async function otherSpaces(deps: Deps, space: Space, thread: StoredThread, msg: Message, agent: string): Promise<{ id: string; name: string }[]> {
  try {
    const who = msg.author.kind === 'human' ? (wakes(space, msg.author.id, thread, msg) ? msg.author.id : null) : await turnAuthor(deps, space, thread);
    if (!who) return [];
    return (await deps.store.listSpaces()).filter(s => s.id !== space.id && agentsOf(s).includes(agent) && canSee(s, who))
      .map(s => ({ id: s.id, name: s.name ?? s.id })).slice(0, MAX_SPACES);
  } catch (e) { console.error('other_spaces_failed', (e as Error)?.message?.slice(0, 200)); return [] }
}

/** An instance serving `agent` is subscribed to the space (nothing sent): a routine run needs someone to deliver to. */
export async function reachable(deps: Deps, space: string, agent: string): Promise<boolean> {
  for (const sub of await deps.store.listSubs(space)) {
    if (sub.kind !== 'instance') continue;
    if ((await deps.store.getInstance(sub.principal))?.agents.includes(agent)) return true;
  }
  return false;
}

/** Sends `frame` to every connection of an instance serving `agent` subscribed to the space; returns how many got it. */
export async function toInstances(deps: Deps, space: string, agent: string, frame: HubFrame): Promise<number> {
  let reached = 0;
  for (const sub of await deps.store.listSubs(space)) {
    if (sub.kind !== 'instance') continue;
    const inst = await deps.store.getInstance(sub.principal);
    if (!inst?.agents.includes(agent)) continue;
    const ok = await sendOne(deps, sub.connId, frame);
    if (ok) reached++;
    else if (ok === false) await deps.store.deleteSub(space, sub.connId);
  }
  return reached;
}

const withoutStopping = (f: StoredThread): StoredThread => { const { stopping, ...rest } = f; return rest };

/** Bounds of the issue context sent on every turn (GitHub content, possibly from outsiders: data, never instructions). */
export const ISSUE_BODY_MAX = 4000, ISSUE_COMMENT_MAX = 1500, ISSUE_COMMENTS = 10;
/**
 * The issue behind a thread of a board-driven space: its state on the board, its body, and the GitHub cards posted
 * since the agent last spoke (`context`). Held cards (outsiders while vetting) never reach the agent.
 */
async function issueContext(deps: Deps, thread: StoredThread, context: Message[]): Promise<IssueContext | null> {
  if (!thread.issue || !thread.board) return null;
  const b = thread.board, body = b.body ? await deps.store.getMessage(thread.id, b.body) : null;
  const who = (m: Message) => m.gh!.agent ? `${m.gh!.login} (agent ${m.gh!.agent})` : m.gh!.login || 'ghost';
  const comments = context.filter(m => m.type === 'github' && m.gh && !m.gh.held && m.gh.kind !== 'issue').slice(-ISSUE_COMMENTS)
    .map(m => ({ who: who(m), at: m.at, text: (m.gh!.kind === 'pr' ? `Pull request ${m.gh!.state ?? ''}: ${m.gh!.title ?? ''} ${m.gh!.url}` : m.text).slice(0, ISSUE_COMMENT_MAX) }));
  return { ref: `${thread.issue.repo}#${thread.issue.number}`, url: thread.issue.url, title: thread.title, state: b.state, column: b.column, labels: b.labels,
    vetting: b.vetting, body: body && !body.gh?.held ? body.text.slice(0, ISSUE_BODY_MAX) : '', comments };
}

/** Origin of a hidden conversation's spend: a Radar run, the titling of a topic, else the memory agent. */
export const hiddenOrigin = (t: StoredThread): HiddenOrigin => t.radarRun ? 'radar' : t.titleFor ? 'title' : t.exRun ? 'mail' : 'memory';

/** Adds a hidden turn's spend to its UTC day / origin / agent row (optimistic, a few retries: turn ends are rare). */
async function countHidden(deps: Deps, thread: StoredThread, agent: string, usage: Usage) {
  const day = new Date(deps.now()).toISOString().slice(0, 10), origin = hiddenOrigin(thread);
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await deps.store.getHiddenUsage(thread.space, day, origin, agent);
    const next: HiddenUsage = { space: thread.space, day, origin, agent, usage: addUsage(cur?.usage, usage), version: (cur?.version ?? 0) + 1 };
    if (await deps.store.putHiddenUsage(next, cur ? cur.version : null)) return;
  }
  throw new Error('hidden_usage_conflict');
}

async function fromInstance(deps: Deps, who: Principal, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  need(id(f.thread));
  const cur = await deps.store.getThread(f.thread); need(!!cur, 'forbidden');
  const inst = await deps.store.getInstance(who.id);
  need(!!inst && inst.spaces.includes(cur!.space), 'forbidden');
  need(!cur!.general, 'forbidden'); // General: no agent message, turn nor card, ever (it answers in a topic opened from there)
  const as = await speakingAgent(deps, inst!, cur!); need(!!as, 'forbidden');
  const guest = isGuest(cur!, as!);
  if (guest && !GUEST_FRAMES.has(f.type)) throw new Refused('not_in_charge');
  try { return await instanceFrame(deps, who, inst!, cur!, as!, f, reply); }
  catch (e) {
    // A refused tool call (frame with a client_id) goes to the timeline: an agent reading it back (thread_read) sees
    // what the hub turned down. Not the streaming frames (no client_id): a stopped turn's deltas would flood it.
    if (e instanceof Refused && str(f.client_id, 64)) await logEvent(deps, cur!, { at: deps.now(), kind: 'refused', agent: as!, frame: String(f.type).slice(0, 40), code: e.code });
    throw e;
  }
}

/** An agent frame in conversation `cur`, past fromInstance's gates (`as` speaks there, guests limited to GUEST_FRAMES). */
async function instanceFrame(deps: Deps, who: Principal, inst: Instance, cur: StoredThread, as: string, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  const agent = { kind: 'agent' as const, id: as };
  const topic = cur.kind === 'topic';
  const guest = isGuest(cur, as);
  switch (f.type) {
    case 'turn.started': case 'turn.ended': {
      need(Number.isSafeInteger(f.at) && f.at > 0);
      need(f.type === 'turn.started' || ((f.stopped === undefined || typeof f.stopped === 'boolean') && (f.acted === undefined || typeof f.acted === 'boolean')));
      // A talk turn of a queued thread is no reply to see: the thread stays Waiting, never Your turn (queuetalk.ts).
      const talking = f.type === 'turn.ended' && !topic && !guest && await queuedNow(deps, cur);
      const e: FactEvent = f.type === 'turn.ended' ? { type: 'turn.ended', at: f.at, unseen: !topic && !guest && !talking } : { type: 'turn.started' };
      // Spend of the turn, added once: a replayed turn end (same `at`) or an older one is stale, like its facts.
      const usage = f.type === 'turn.ended' ? parseUsage(f.usage) : null;
      // A fresh turn start or end closes any stop request (`stopBy`: who asked it, read on the write that wins).
      // In a topic and for a thread's guest, freshness is per agent (each instance has its own clock); the thread's
      // owner keeps the thread's clock. The conversation stays « working » until the last agent in a turn there ends
      // it; the owner's turn end still makes it Your turn (shown once the guests are done).
      const own = !topic && !guest;
      let fresh = false, stopBy: string | undefined, flowEnded = false, heldSince = 0;
      const event = (b: StoredThread): FactEvent | { type: 'noop' } => {
        const t = turnsOf(b);
        fresh = own ? f.at > b.lastTurnAt : f.at > (t[as!]?.at ?? 0);
        const others = Object.entries(t).some(([a, x]) => a !== as && x.active);
        if (!fresh) return { type: 'noop' };
        if (f.type === 'turn.ended' && others) return own ? { ...e, busy: true } as FactEvent : { type: 'noop' };
        return e;
      };
      const thread = await mutateThread(deps, cur!.id, event, undefined, own ? f.at : undefined, b => {
        stopBy = b.stopping?.by;
        flowEnded = false;
        if (!fresh) return b;
        let x = usage ? { ...b, usage: addUsage(b.usage, usage) } : b;
        // Flow: a task turn's spend is also counted as `task` (the rest is discussion); its end clears the flow turn.
        flowEnded = f.type === 'turn.ended' && own && !!b.flow?.turn;
        if (flowEnded) heldSince = b.flow!.turn;
        if (flowEnded) x = { ...x, flow: { ...b.flow!, turn: 0 }, ...(usage ? { taskUsage: addUsage(b.taskUsage, usage) } : {}) };
        if (topic || guest || b.turns) x = { ...x, turns: { ...turnsOf(b), [as!]: { at: f.at, active: f.type === 'turn.started' } }, ...(topic ? { lastTurnAt: Math.max(b.lastTurnAt, f.at) } : {}) };
        // An applet's run closes once its agent said done and its turn (the delivery message included) is over; a run
        // opened as a topic never closes on its own (Lounge rules).
        if (f.type === 'turn.ended' && own && b.applet && b.kind !== 'topic' && b.facts.outcome?.kind === 'done' && !b.archived) x = { ...x, archived: { by: b.owner, at: deps.now() } };
        return x.stopping ? withoutStopping(x) : x;
      });
      if (fresh) await logEvent(deps, thread, { at: deps.now(), kind: 'turn', agent: as!, phase: f.type === 'turn.started' ? 'start' : 'end', ...(f.type === 'turn.ended' && f.stopped === true ? { stopped: true } : {}) });
      // The « Stopped by » line goes out before the turn end: a client waiting to edit the message (↑) decides on
      // the turn end whether the stopped answer still blocks the edit, so the line must already be there.
      if (f.type === 'turn.ended' && fresh && f.stopped === true) {
        const space = await deps.store.getSpace(thread.space);
        const name = stopBy ? space?.names?.[stopBy] ?? 'Member' : null;
        const line: Message = { id: deps.newId(), thread: thread.id, author: { kind: 'system', id: 'briefling' }, type: 'text', at: deps.now(),
          text: name ? `Stopped by ${name}.` : 'Stopped.', stop: { ...(stopBy ? { by: stopBy } : {}), acted: f.acted === true } };
        const r = await deps.store.upsertMessage(line);
        if (r) await broadcast(deps, thread.space, { v: 2, type: 'event', event: 'message.created', data: r.message });
      }
      await broadcast(deps, thread.space, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(thread) });
      if (f.type === 'turn.ended' && !thread.memoryReview && !guest) await deps.queueSummary?.(thread.id, f.at);
      // A hidden conversation has no index row (Metrics never lists it): its spend is also counted per day and origin.
      if (fresh && usage && thread.memoryReview) await countHidden(deps, thread, as!, usage).catch(e => console.error('hidden_usage_failed', (e as Error)?.message?.slice(0, 200)));
      if (f.type === 'turn.ended' && fresh && thread.memoryReview && !thread.radarRun && !thread.exRun && !thread.exSync && !thread.titleFor) await memoryTurnEnded(deps, thread).catch(e => console.error('memory_run_end_failed', (e as Error)?.message?.slice(0, 200)));
      if (f.type === 'turn.ended' && fresh && thread.radarRun) await radarRunEnded(deps, thread, usage).catch(e => console.error('radar_run_end_failed', (e as Error)?.message?.slice(0, 200)));
      // Mail exchanges: a lead's sync ended, its exchanges go to the summary agent; a summary run ended, it is recorded.
      if (f.type === 'turn.ended' && fresh && (thread.exSync || thread.exRun)) await exchangeTurnEnded(deps, thread).catch(e => console.error('exchange_turn_end_failed', (e as Error)?.message?.slice(0, 200)));
      // End of the turn (not an old one arriving late): the resources it held are freed, a parked thread becomes eligible.
      if (f.type === 'turn.ended' && own && thread.lastTurnAt === f.at) {
        const space = await deps.store.getSpace(thread.space);
        if (space) await freeResources(deps, space, thread.id, { held: true, queued: false });
        if (space && fresh && flowEnded) await deliverHeld(deps, space, thread, heldSince);
      }
      // Its last message @mentions other agents of the space: they are woken, within the space's cap (hub/src/relay.ts).
      if (f.type === 'turn.ended' && fresh && f.stopped !== true) await relayMentions(deps, thread, as!).catch(e => console.error('relay_failed', (e as Error)?.message?.slice(0, 200)));
      return;
    }
    case 'resource.acquire': return await acquire(deps, cur!, f, reply);
    case 'resource.release': {
      need(str(f.client_id, 64) && typeof f.resource === 'string' && RESOURCE_RE.test(f.resource));
      const space = await deps.store.getSpace(cur!.space); need(!!space, 'forbidden');
      const r = await deps.store.getResource(space!.id, f.resource);
      if (r?.holder === cur!.id) {
        await mutateResource(deps, space!.id, f.resource, x => x.holder === cur!.id ? { ...x, holder: null, agent: null, since: deps.now() } : null);
        await logEvent(deps, cur!, { at: deps.now(), kind: 'resource', resource: f.resource, op: 'released' });
        await pump(deps, space!, f.resource);
      }
      await reply({ v: 2, type: 'ack', client_id: f.client_id, thread: cur!.id, msg_id: '' });
      return;
    }
    case 'message.delta':
      need(id(f.msg_id) && str(f.text, MAX_TEXT));
      await broadcast(deps, cur!.space, { v: 2, type: 'event', event: 'message.delta', data: { thread: cur!.id, msg_id: f.msg_id, text: f.text } });
      return;
    case 'message.final': {
      need(id(f.msg_id) && str(f.text, MAX_TEXT) && (f.rev === undefined || (Number.isSafeInteger(f.rev) && f.rev > 0)) && fileIds(f.files)
        && (f.notice === undefined || f.notice === true));
      const files = await attach(deps, who.id, cur!.space, f.msg_id, f.files);
      const r = await deps.store.upsertMessage({ id: f.msg_id, thread: cur!.id, author: agent, type: 'text', text: f.text, at: deps.now(), ...(f.rev ? { rev: f.rev } : {}), ...(files.length ? { files } : {}), ...(f.notice ? { notice: true as const } : {}) });
      if (!r) return; // outdated edit arriving after a more recent one: ignored
      // Its @mentions ring (mute or not, one per turn, hub/src/mute.ts); the edits of a message never ring again.
      const notify = r.created ? await agentMentions(deps, cur!, as!, r.message) : [];
      await broadcast(deps, cur!.space, { v: 2, type: 'event', event: r.created ? 'message.created' : 'message.updated', data: r.message, ...(notify.length ? { notify } : {}) });
      if (cur!.facts.pendingAsk === f.msg_id) { // the open card became text (expired approval): it no longer holds the thread on Your turn
        const thread = await mutateThread(deps, cur!.id, { type: 'ask.closed', ask_id: f.msg_id });
        await broadcast(deps, thread.space, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(thread) });
      }
      if (notify.length && deps.queuePush)
        await deps.queuePush({ thread: cur!.id, version: cur!.version, to: notify, by: as!, byAgent: true, msg: r.message.id }).catch(e => console.error('push_queue_failed', (e as Error)?.name));
      return;
    }
    case 'status':
      // Ephemeral (nothing is written); outside a turn, refused: no ghost "working" after the end.
      need((f.text === null || str(f.text, MAX_STATUS)) && Number.isSafeInteger(f.rev) && f.rev > 0
        && (f.since === undefined || (Number.isSafeInteger(f.since) && f.since > 0))
        && (f.steps === undefined || (Number.isSafeInteger(f.steps) && f.steps >= 0))
        && (f.recent === undefined || (Array.isArray(f.recent) && f.recent.length <= MAX_ACTIVITY && f.recent.every((s: unknown) => str(s, MAX_STATUS)))));
      need(inTurn(cur!, as!), 'no_turn');
      await broadcast(deps, cur!.space, { v: 2, type: 'event', event: 'thread.status', data: { thread: cur!.id, agent: as!, text: f.text, rev: f.rev,
        ...(f.since !== undefined ? { since: f.since } : {}), ...(f.steps !== undefined ? { steps: f.steps } : {}), ...(f.recent !== undefined ? { recent: f.recent } : {}) } });
      return;
    case 'ask': {
      need(id(f.ask_id) && str(f.q, 2000) && Array.isArray(f.options) && f.options.length <= 6 && f.options.every((o: unknown) => str(o, 200)));
      const msg: Message = { id: f.ask_id, thread: cur!.id, author: agent, type: 'ask', text: f.q, ask: { id: f.ask_id, options: f.options }, at: deps.now() };
      await deps.store.upsertMessage(msg);
      const thread = await mutateThread(deps, cur!.id, { type: 'ask', ask_id: f.ask_id, approval: isApprovalAsk(f.options) });
      await broadcast(deps, thread.space, { v: 2, type: 'event', event: 'message.created', data: msg });
      await broadcast(deps, thread.space, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(thread) });
      return;
    }
    case 'ask.choices': {
      const items = askItems(f.items);
      need(str(f.client_id, 64) && typeof f.text === 'string' && f.text.length <= ASK_TEXT_MAX && !!items);
      need(inTurn(cur!, as!) || cronCard(cur!, as!), 'no_turn');
      const askId = deps.newId(); // the card's id is its ask id (as for a clarify `ask`)
      const msg: Message = { id: askId, thread: cur!.id, author: agent, type: 'ask', text: f.text.trim(), ask: { id: askId, options: [], items: items! }, at: deps.now() };
      await deps.store.upsertMessage(msg);
      const thread = await mutateThread(deps, cur!.id, { type: 'ask', ask_id: askId });
      await broadcast(deps, thread.space, { v: 2, type: 'event', event: 'message.created', data: msg });
      await broadcast(deps, thread.space, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(thread) });
      await reply({ v: 2, type: 'ack', client_id: f.client_id, thread: thread.id, msg_id: askId });
      return;
    }
    case 'thread.propose': return await propose(deps, inst!, cur!, as!, f, reply);
    case 'about.propose': return await proposeAbout(deps, cur!, as!, f, reply);
    case 'topic.title': return await topicTitle(deps, cur!, as!, f, reply);
    case 'issue.propose': return await proposeIssue(deps, cur!, as!, f, reply);
    case 'plan.propose': return await proposePlan(deps, cur!, as!, f, reply);
    case 'elevation.request': return await requestElevation(deps, cur!, as!, f, reply);
    case 'thread.outcome': return await outcome(deps, cur!, f, reply);
    case 'thread.background': return await background(deps, cur!, f);
    case 'ci.watch': return await ciWatch(deps, cur!, as!, f, reply);
    case 'space.threads': case 'thread.read': case 'space.metrics': return await introspect(deps, inst!, cur!, as!, f, reply);
    case 'applet.propose': return await appletPropose(deps, cur!, as!, f, reply);
    case 'reminder.propose': case 'memory.search': case 'memory.read': case 'memory.propose': case 'memory.review': case 'memory.synthesis':
    case 'memory.tag': case 'memory.tagmerge': case 'memory.threadtag': case 'radar.signal': case 'radar.profile': case 'mail.import': case 'exchange.read':
    case 'exchange.summary': case 'browser.frame': return await agentModule(f.type)!(deps, cur!, as!, f, reply, inst!);
    case 'applet.list': return await appletList(deps, cur!, as!, f, reply);
  }
  throw new Refused('unknown_type');
}

/** End of a task turn granted at `since`: the trusted humans' messages that waited for it go to the agent, same session. */
async function deliverHeld(deps: Deps, space: Space, thread: StoredThread, since: number) {
  const last = await deps.store.lastMessages(thread.id, 30);
  const waiting = last.filter(m => m.author.kind === 'human' && space.trusted.includes(m.author.id) && (m.type === 'text' || m.type === 'answer') && m.at >= since);
  const msg = waiting.at(-1);
  if (!msg) return;
  const agents = addressed(space, last, msg, thread);
  for (const a of agents.filter(x => x !== thread.owner)) { thread = await speaker(deps, thread, a); await deliverPending(deps, space, thread, msg, last, a); }
  if (agents.includes(thread.owner)) await deliver(deps, space, thread, msg, waiting.filter(m => m.id !== msg.id));
}

/**
 * Read-modify-write of a thread, with an optimistic lock and 3 attempts.
 * API Gateway can invoke the Lambda in parallel for two frames of the same connection:
 * without a version, one update can overwrite another. `turnAt` ignores a turn event
 * older than the last applied one (arrival order not guaranteed).
 */
export async function mutateThread(deps: Deps, threadId: string | null, e: FactEvent | { type: 'noop' } | ((f: StoredThread) => FactEvent | { type: 'noop' }), create?: Pick<Thread, 'id' | 'space' | 'title' | 'owner' | 'kind' | 'from' | 'author' | 'authorAgent' | 'text' | 'opener'>, turnAt?: number,
  patch: (f: StoredThread) => StoredThread = f => f, touch = true): Promise<StoredThread> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = threadId ? await deps.store.getThread(threadId) : null;
    if (threadId && !cur) throw new Refused('forbidden');
    const base: StoredThread = cur ?? { ...create!, state: 'calm', facts: initialFacts(), updatedAt: 0, version: 0, lastTurnAt: 0 };
    const stale = turnAt !== undefined && turnAt <= base.lastTurnAt;
    const ev = typeof e === 'function' ? e(base) : e; // before `patch`, which may read what it computed
    const facts = stale || ev.type === 'noop' ? base.facts : applyFact(base.facts, ev as FactEvent);
    const patched = patch(base);
    // touch = false: not activity (a topic title), the conversation keeps its place and read state.
    const next: StoredThread = { ...patched, facts, state: computeState(facts, patched.board?.labels), updatedAt: touch || !cur ? deps.now() : base.updatedAt, version: base.version + 1, lastTurnAt: stale || turnAt === undefined ? patched.lastTurnAt : turnAt };
    if (await deps.store.putThread(next, cur ? cur.version : null)) {
      // Web Push on the transition to Your turn (Message and GitHub Lambdas: the others have no queuePush). Best effort:
      // a queue failure never fails the write that already happened.
      if (deps.queuePush && !next.memoryReview && becameYours(cur, next)) await deps.queuePush({ thread: next.id, version: next.version }).catch(e => console.error('push_queue_failed', (e as Error)?.name));
      return next;
    }
    threadId = threadId ?? next.id; // concurrent creation of the same thread: read it again
  }
  throw new Error('thread_conflict');
}

/** The mail-exchange origin a thread keeps from the topic it is opened from (request → topic → thread, hub only). */
export const exchangeOf = (parent: StoredThread) => parent.exchange ? { exchange: parent.exchange } : {};

/** A trusted human's message (or Unarchive) brings an archived thread back. */
export const unarchive = (f: StoredThread): StoredThread => { if (!f.archived) return f; const { archived, ...rest } = f; return rest };

// `version` lets the client ignore a broadcast that arrives late (concurrent Lambdas, order not guaranteed).
const publicThread = (f: StoredThread): PublicThread => ({ id: f.id, space: f.space, title: f.title, owner: f.owner, state: f.state, updatedAt: f.updatedAt, version: f.version,
  ...(f.kind ? { kind: f.kind } : {}), ...(f.from ? { from: f.from } : {}), ...(f.fromMsg ? { fromMsg: f.fromMsg } : {}), ...(f.general ? { general: true } : {}), ...(f.last ? { last: f.last } : {}), ...(f.author ? { author: f.author } : {}), ...(f.authorAgent ? { authorAgent: true } : {}), ...(f.text ? { text: f.text } : {}), ...(f.heading ? { heading: f.heading } : {}), ...(f.tags ? { tags: f.tags } : {}), ...(f.spawned ? { spawned: f.spawned } : {}), ...(f.nextOpened?.length ? { nextOpened: f.nextOpened } : {}), ...(f.leadsRecalled?.length ? { leadsRecalled: f.leadsRecalled } : {}), ...(f.plan ? { plan: f.plan } : {}), ...(f.issue ? { issue: f.issue } : {}), ...(f.issuePending ? { issuePending: true } : {}),
  ...(f.archived ? { archived: f.archived } : {}), ...(f.people?.length ? { people: f.people } : {}), ...(f.invited?.length ? { invited: f.invited } : {}), ...(f.facts.unseenReply ? { unseen: f.facts.unseenReply } : {}), ...(f.facts.outcome ? { outcome: f.facts.outcome } : {}), ...(f.facts.pendingAsk ? { pendingAsk: f.facts.pendingAsk } : {}), ...(f.facts.pendingAsk && f.facts.pendingApproval ? { pendingApproval: true as const } : {}),
  ...(f.usage ? { usage: f.usage } : {}), ...(f.taskUsage ? { taskUsage: f.taskUsage } : {}), ...(f.board ? { board: f.board } : {}), ...(f.stopping ? { stopping: f.stopping } : {}), ...(f.ci?.length ? { ci: f.ci } : {}), ...(f.background?.tasks.length ? { background: f.background } : {}),
  ...((f.kind === 'topic' || f.turns) && workingIn(f).length ? { working: workingIn(f) } : {}), ...(f.memoryReview ? { memoryReview: true } : {}) });
export { publicThread };

export const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
// In the context, the agent knows which message carried which attachment (names already cleaned at upload).
const attached = (m: Message) => m.files?.length ? `\n[attachment: ${m.files.map(f => f.name).join(', ')}]` : '';
/** `@Gideon` like `@gideon`: comparison ignoring accents and case. */
export const mentions = (text: string, agent: string) => new RegExp(`(^|\\s)@${fold(agent)}(?![\\p{L}\\p{N}_-])`, 'u').test(fold(text));
const MENTION_RE = /(^|\s)@[\p{L}\p{N}_-]/u;
/**
 * Follow-up in a topic: the agent whose reply is the previous message (hub cards ignored), when this message does not
 * call someone else (`@joachim …` talks to Joachim, not to the agent).
 */
function repliedBefore(last: Message[], msg: Message): string | null {
  if (MENTION_RE.test(msg.text)) return null; // a mention, but of no agent of the space (tested before)
  const prev = last.filter(m => m.id !== msg.id && m.at <= msg.at && m.author.kind !== 'system').at(-1);
  return prev?.author.kind === 'agent' ? prev.author.id : null;
}

/**
 * The agent an instance speaks as in a conversation: the one in charge if it serves it, else an agent of the space
 * (re-read now: removed meanwhile = refused) that was handed a turn there (Lounge topic, or a thread's guest). An
 * instance serving several of them answers as the first one (one agent per instance in practice).
 */
export async function speakingAgent(deps: Deps, inst: Instance, t: StoredThread): Promise<string | null> {
  const a = inst.agents.includes(t.owner) ? t.owner : inst.agents.find(x => Object.hasOwn(turnsOf(t), x));
  if (!a) return null;
  const space = await deps.store.getSpace(t.space);
  if (!space || (a !== t.owner && !agentsOf(space).includes(a))) return null;
  // A backstage memory agent speaks only in a hidden topic (its memory passes), never in a conversation.
  return a === backstageAgent(space) && !t.memoryReview ? null : a;
}

/**
 * What a card's `context` brings to the kickoff, instead of the topic's messages: the agent's summary, a link back to
 * the source conversation (thread_read), and the topic's attachments (same author filter as the delivery): the
 * MAX_FILES newest sent, each named with its author and an excerpt of its message (a screenshot alone says nothing),
 * the older ones listed by name only.
 */
function kickoffContext(space: Space, thread: StoredThread, parent: StoredThread | null, before: Message[], context: string) {
  const who = (m: Message) => m.author.kind === 'agent' ? cap(m.author.id) : space.names?.[m.author.id] ?? 'Member';
  const kept = before.filter(m => m.type !== 'propose' && !m.deleted && m.files?.length
    && (m.author.kind === 'agent' || (m.author.kind === 'human' && wakes(space, m.author.id, thread))));
  const all = [...kept].sort((a, b) => a.at - b.at).flatMap(m => m.files!.map(f => ({ f, m })));
  const sent = all.slice(-MAX_FILES), older = all.slice(0, -MAX_FILES).map(x => x.f.name);
  const excerpt = (t: string) => { const x = t.replace(/\s+/g, ' ').trim(); return x.length > 100 ? `${x.slice(0, 100)}…` : x; };
  const where = parent ? `${parent.kind === 'topic' ? 'the Lounge topic' : 'the thread'} "${parent.title}" (id ${parent.id})` : 'the source conversation';
  let text = `\n\nContext (your summary of the conversation when you proposed it, approved with the brief):\n${context}`
    + `\n\nSource: ${where}. Its messages are not included: read it with thread_read if a detail is missing (attachment names only).`;
  if (sent.length) text += `\n\nAttachments of the conversation, sent with this message (oldest first):\n`
    + sent.map(({ f, m }) => `- ${f.name}, from ${who(m)}${excerpt(m.text) ? `: "${excerpt(m.text)}"` : ''}`).join('\n');
  if (older.length) text += `\nOlder attachments, not sent: ${older.join(', ')}`;
  return { text, files: sent.map(({ f, m }) => ({ ...f, by: m.author.id })) };
}

/**
 * Turn outcome announced by the agent (`turn_outcome` tool): done, or done while waiting for an action from the human.
 * Safeguards: threads only (a Lounge topic never goes Your turn), during a running turn triggered by a
 * trusted human (last trusted human message; no human message = thread opened from a card,
 * opening already reserved to trusted humans). The agent never clears a wait: a turn only starts
 * after a trusted human's message, which already cleared it (state.ts, human.post).
 * Optional `summary`: the agent's summary of the thread, stored under the same gates (this thread only, never a topic);
 * a malformed one refuses the whole frame (bad_frame) so the agent can fix it.
 */
async function outcome(deps: Deps, thread: StoredThread, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  const action = typeof f.action === 'string' ? f.action.replace(/\s+/g, ' ').trim() : '';
  need(str(f.client_id, 64) && (f.outcome === 'done' || f.outcome === 'waiting') && (f.action === undefined || typeof f.action === 'string')
    && action.length <= MAX_ACTION && (f.outcome === 'done' || action.length > 0) && (f.resume === undefined || typeof f.resume === 'boolean'));
  const summary = f.summary === undefined || f.summary === null ? null : cleanTurnSummary(f.summary);
  need(f.summary === undefined || f.summary === null || !!summary);
  need(thread.kind !== 'topic', 'not_thread');
  need(thread.facts.turnActive, 'no_turn');
  need(!thread.facts.parked, 'parked'); // waiting for a resource: neither finished nor waiting for the human
  need(!flowTurn(thread, deps.now()), 'no_turn'); // a board task's turn: the board status says how it ends
  need(!(await queuedNow(deps, thread)), 'queued'); // a talk turn: the thread keeps its place in the queue, nothing to end
  const space = await deps.store.getSpace(thread.space); need(!!space, 'forbidden');
  const human = (await deps.store.lastMessages(thread.id, 100)).filter(m => m.author.kind === 'human').at(-1);
  need(human ? space!.trusted.includes(human.author.id) : !!thread.from, 'no_turn');
  const tags = await agentTags(deps, space!, f.tags); // before any write: an unknown tag refuses the whole frame
  const out: Outcome = f.outcome === 'waiting' ? { kind: 'waiting', action, at: deps.now(), ...(f.resume === true ? { resume: true as const } : {}) } : { kind: 'done', at: deps.now() };
  const next = await mutateThread(deps, thread.id, { type: 'outcome', outcome: out }, undefined, undefined, x => withAgentTags(x, tags, x.owner, out.at));
  await logEvent(deps, next, { at: out.at, kind: 'outcome', agent: next.owner, outcome: out.kind, ...(out.action ? { action: out.action } : {}) });
  await broadcast(deps, next.space, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(next) });
  if (summary) {
    const s: ThreadSummary = { thread: next.id, at: out.at, ...summary };
    if (await deps.store.putSummary(s)) await broadcast(deps, next.space, { v: 2, type: 'event', event: 'summary.updated', data: s });
  }
  await reply({ v: 2, type: 'ack', client_id: f.client_id, thread: thread.id, msg_id: '' });
  // Done: the agent gives the hand back, the next thread of the space goes. "Waiting" keeps it (not finished).
  if (out.kind === 'done') { await leave(deps, space!, next, false); await advancePlan(deps, space!, next); await closedLeads(deps, space!, next); }
}

/** A thread closed: its summary's unopened lines for an agent become pending leads (hub/src/leads.ts). Never blocks the closure. */
async function closedLeads(deps: Deps, space: Space, thread: StoredThread) {
  try { await captureLeads(deps, space, thread) } catch (e) { console.error('leads_capture_failed', JSON.stringify({ thread: thread.id, err: (e as Error)?.name })) }
}

// ---------------------------------------------------------------- project memory (protocol/memory.ts)
/**
 * Space an agent may read for its turn in `cur` (memory, introspection): a running turn of this agent started by a
 * trusted human, the conversation's space not archived. Another space (`want`): the instance and the agent serve it AND
 * the human who started the turn is a member of it (an agent never carries a space's content to someone who cannot see it).
 */
export async function readableSpace(deps: Deps, inst: Instance, cur: StoredThread, as: string, want: string | undefined): Promise<Space> {
  need(inTurn(cur, as), 'no_turn');
  const home = await deps.store.getSpace(cur.space); need(!!home && !home.archived, 'forbidden');
  const requester = await turnAuthor(deps, home!, cur); need(!!requester, 'no_turn');
  if (want === undefined || want === home!.id) return home!;
  const other = await deps.store.getSpace(want);
  need(!!other && inst.spaces.includes(other.id) && agentsOf(other).includes(as) && canSee(other, requester!), 'forbidden');
  return other!;
}

/**
 * The agent declares the commits it pushed (`pushed_commits` tool). Same gates as `turn_outcome` except a parked thread
 * is allowed (the agent pushes before taking the stack, then may wait for it). Any `owner/name` repo is recorded (push
 * event, listed in Thread info › Code, display only: nothing is read on GitHub for it). Only an attached repo, stored as
 * the admin wrote it, gets more: its PR read when the panel opens and, with the admin's switch on, its CI followed by
 * the poller (ci.ts). `by` = the trusted human whose message started the turn (slice 2 attributes the wake-up to them).
 */
async function ciWatch(deps: Deps, thread: StoredThread, as: string, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  need(str(f.client_id, 64) && Array.isArray(f.commits) && f.commits.length > 0 && f.commits.length <= CI_MAX_COMMITS
    && f.commits.every((c: any) => c && typeof c.repo === 'string' && c.repo.length <= 140 && REPO_RE.test(c.repo.trim()) && typeof c.sha === 'string' && SHA_RE.test(c.sha)
      && (c.branch === undefined || (typeof c.branch === 'string' && BRANCH_RE.test(c.branch)))));
  need(thread.kind !== 'topic', 'not_thread');
  need(inTurn(thread, as), 'no_turn');
  need(!(await queuedNow(deps, thread)), 'queued'); // a talk turn of a queued thread: nothing is pushed there
  const space = await deps.store.getSpace(thread.space); need(!!space, 'forbidden');
  const repos = reposOf(space!);
  // repo (the admin's spelling when attached, else the agent's, case-folded for the key) -> head, the last one given wins
  const commits = new Map<string, { repo: string; sha: string; branch?: string; attached: boolean }>();
  for (const c of f.commits as { repo: string; sha: string; branch?: string }[]) {
    const given = c.repo.trim(), att = repos.find(r => r.toLowerCase() === given.toLowerCase());
    commits.set((att ?? given).toLowerCase(), { repo: att ?? given, sha: c.sha, ...(c.branch ? { branch: c.branch } : {}), attached: !!att });
  }
  const by = await turnAuthor(deps, space!, thread); need(!!by, 'no_turn');
  const followed = space!.ci === true && modOn(space!, 'ci') ? [...commits.values()].filter(c => c.attached) : [];
  if (followed.length) {
    const open = (await deps.store.listCiWatches()).filter(w => w.thread === thread.id);
    need(new Set([...open.map(w => w.repo), ...followed.map(c => c.repo)]).size <= CI_MAX_WATCHES, 'too_many');
  }
  const now = deps.now();
  // Thread info panel: recorded for every repo, CI follow-up on or not.
  for (const c of commits.values()) await logEvent(deps, thread, { at: now, kind: 'push', agent: as, repo: c.repo, sha: c.sha, ...(c.branch ? { branch: c.branch } : {}) });
  if (!followed.length) {
    console.log('ci_pushed', thread.id, [...commits.values()].map(c => `${c.repo}@${c.sha.slice(0, 7)}`).join(','));
    await reply({ v: 2, type: 'ack', client_id: f.client_id, thread: thread.id, msg_id: '' });
    return;
  }
  for (const { repo, sha } of followed) await deps.store.putCiWatch({ thread: thread.id, space: space!.id, repo, sha, by: by!, since: now, deadline: now + CI_DEADLINE_MS });
  const next = await mutateThread(deps, thread.id, { type: 'noop' }, undefined, undefined,
    x => ({ ...x, ci: followed.reduce((ci, { repo, sha }) => withPill(ci, { repo, sha, verdict: 'running', at: now, n: 0, failed: 0 }), x.ci) }));
  console.log('ci_watch', thread.id, [...commits.values()].map(c => `${c.repo}@${c.sha.slice(0, 7)}${c.attached ? '' : '(display)'}`).join(','));
  await broadcast(deps, next.space, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(next) });
  await reply({ v: 2, type: 'ack', client_id: f.client_id, thread: thread.id, msg_id: '' });
}

/**
 * Kickoff of a thread opened from a card (right away, or at the handover if it was waiting for its turn).
 * `msgs`: messages of the thread, the first one is the brief (or the copied request); the next ones go into context.
 * Safeguard: the agent never works on its own text. What triggers the turn is the opening of the thread by
 * a trusted human (`by`), who approved the brief shown on the card: the delivery is attributed to them. Message
 * not stored (the thread shows the brief signed by the agent). Context: a card with `context` sends that summary, a link
 * back and the topic's newest attachments (kickoffContext); an older card without it, the whole topic for a Lounge card.
 * Nothing from a parent thread (its title and id only, in the kickoff text).
 */
export async function kickoff(deps: Deps, space: Space, thread: StoredThread, by: string, msgs: Message[], found?: { card: Message; before: Message[]; parent: StoredThread }) {
  let card = found?.card, before = found?.before ?? [], parent = found?.parent ?? null;
  if (!found) {
    parent = await deps.store.getThread(thread.from!);
    const src = await deps.store.lastMessages(thread.from!, 100);
    // A plan step: its card may be older than the parent's last 100 messages, read it directly.
    card = thread.plan ? await deps.store.getMessage(thread.plan.parent, thread.plan.card) ?? undefined : src.find(m => m.type === 'propose' && m.propose?.thread === thread.id);
    before = card && parent?.kind === 'topic' && (!thread.plan || thread.plan.step === 0) ? src.filter(m => m.id < card!.id) : [];
  }
  const [first, ...later] = msgs;
  const plan = card?.type === 'plan' && thread.plan ? card.plan : undefined;
  if (plan) {
    const i = thread.plan!.step, step = plan.steps[i];
    const from = parent && parent.kind !== 'topic' ? `the thread "${parent.title}" (id ${parent.id}; its history is not included)` : 'the Lounge';
    const list = plan.steps.map((s, k) => `${k + 1}. ${s.title}${k < i ? ' (finished)' : k === i ? ' (this thread)' : ''}`).join('\n');
    const ctx = plan.context ? kickoffContext(space, thread, parent, before, plan.context) : null;
    const go: Message = { id: deps.newId(), thread: thread.id, author: { kind: 'human', id: by }, type: 'text', at: deps.now(),
      text: `Step ${i + 1} of ${plan.steps.length} of the plan "${plan.title}", proposed from ${from}. I approved the whole plan: start this step, `
        + `and only this one. When it is finished, end this thread with turn_outcome done: briefling then opens the next step `
        + `(a waiting outcome holds the plan until I unblock it).\n\nSteps:\n${list}\n\nThis step:\n\n${step?.brief ?? first.text}${ctx?.text ?? ''}` };
    // With a context, the topic's messages stay out (the summary and the link replace them); without, as before.
    return ctx ? await deliver(deps, space, thread, go, later, [], thread.owner, false, [], ctx.files) : await deliver(deps, space, thread, go, [...before, ...later]);
  }
  // Opened from a Radar signal while the agent was busy: same go as at the click.
  if (thread.radar && !card) return await deliver(deps, space, thread, radarGo(thread, by, first, deps), later);
  // Opened from a line « Next » of a summary while the agent was busy: same go as at the click.
  if (thread.nextOf && !card) return await nextKickoff(deps, space, thread, by, first, later);
  const brief = card?.propose?.brief;
  if (!brief) { const ask = before.filter(m => m.author.kind === 'human').at(-1); return await deliver(deps, space, thread, first, [...before.filter(m => m.id !== ask?.id), ...later]); }
  const origin = parent && parent.kind !== 'topic'
    ? `Thread opened from the thread "${parent.title}" (id ${parent.id}; its history is not included)`
    : 'Thread opened from the Lounge';
  const context = card?.propose?.context;
  const ctx = context ? kickoffContext(space, thread, parent, before, context) : null;
  const go: Message = { id: deps.newId(), thread: thread.id, author: { kind: 'human', id: by }, type: 'text', at: deps.now(),
    text: `${origin}: I approved your brief, start the work.\n\n${brief}${ctx?.text ?? ''}` };
  // Card with a context: brief + context + link + attachments, none of the topic's messages. Older card: the whole topic.
  if (ctx) return await deliver(deps, space, thread, go, later, [], thread.owner, false, [], ctx.files);
  await deliver(deps, space, thread, go, [...before, ...later]);
}

/**
 * One subscriber of a fan-out: true = sent, false = connection gone (the caller drops the subscription), null = failed
 * otherwise (e.g. still throttled after the sender's retries): logged, the subscription kept, and the loop goes on, so
 * one failing subscriber never fails the frame nor starves the subscribers after it.
 */
export async function sendOne(deps: Pick<Deps, 'sender'>, connId: string, frame: HubFrame): Promise<boolean | null> {
  try { return await deps.sender.send(connId, frame); }
  catch (e) { console.error('send_failed', frameKind(frame), connId, (e as Error)?.name); return null; }
}

export async function broadcast(deps: Pick<Deps, 'store' | 'sender'>, space: string, frame: HubFrame) {
  for (const sub of await deps.store.listSubs(space)) {
    if (sub.kind !== 'human') continue;
    if ((await sendOne(deps, sub.connId, frame)) === false) await deps.store.deleteSub(space, sub.connId);
  }
}

// ---------------------------------------------------------------- spaces (admin)
// product decision: a global admin role (him only) creates spaces and sets members, trust and agents.
// Choosing `trusted` or `agents` is deciding who makes an agent act: never a member nor a trusted human.
// The right is re-read from the database on every frame (not in the token nor the connection): removing it takes effect at once.
/** Contributors as stored, kept consistent with the other roles (members only, never a lead). */
const contributorsOf = (s: Space): string[] => (s.contributors ?? []).filter(c => s.members.includes(c) && !s.trusted.includes(c));
/** Humans whose messages may make the space's agents act somewhere (the plugin's allowlist): leads and contributors. */
export const allowedOf = (s: Space): string[] => [...s.trusted, ...contributorsOf(s)];
/** Members the admin flagged « not technical » (Settings › Members): their turns ask the agent for plain words. */
const nontechOf = (s: Pick<Space, 'members' | 'nontech'>): string[] => (s.nontech ?? []).filter(m => s.members.includes(m));
/** `nontech: true` for the member flagged « not technical », nothing for anyone else (the list stays admin-only). */
const nontechFor = (s: Pick<Space, 'members' | 'nontech'>, who: string): { nontech?: true } => nontechOf(s).includes(who) ? { nontech: true } : {};
/** Space admins as stored: members only (a member removed loses the role). */
export const adminsOf = (s: Pick<Space, 'members' | 'admins'>): string[] => (s.admins ?? []).filter(m => s.members.includes(m));
/** `who` is an admin of this space (not a global admin): named by a global admin, member, space not archived. */
export const isSpaceAdmin = (s: Space | null | undefined, who: string): boolean => !!s && !s.archived && adminsOf(s).includes(who);
const adminFor = (s: Space, who: string): { admin?: true } => isSpaceAdmin(s, who) ? { admin: true } : {};
/**
 * Admin rights on one space: a global admin, or an admin of that space. Both read from the store at each call (like
 * `INDEX/ADMINS`), so a role removed takes effect on the next frame, without reconnection.
 */
export async function canAdmin(deps: Pick<Deps, 'store'>, who: string, space: string | Space | null | undefined): Promise<boolean> {
  if (await deps.store.isAdmin(who)) return true;
  const s = typeof space === 'string' ? await deps.store.getSpace(space) : space;
  return isSpaceAdmin(s, who);
}
export const settingsOf = (s: Space): SpaceSettings => ({ id: s.id, name: s.name ?? s.id, about: s.about ?? '', members: s.members, trusted: s.trusted, contributors: contributorsOf(s), nontech: nontechOf(s), admins: adminsOf(s),
  agents: s.agents ?? [s.defaultAgent], defaultAgent: s.defaultAgent, ...(s.archived ? { archived: s.archived } : {}), parallel: parallelOf(s), version: s.version ?? 0,
  agentRoles: Object.fromEntries((s.agents ?? [s.defaultAgent]).filter(a => s.agentRoles?.[a]).map(a => [a, s.agentRoles![a]])),
  // driver as chosen (not boardDriven): turning the « board » module off must not lose the choice at the next save
  driver: s.driver === 'board' && !!s.github ? 'board' : 'briefling', identities: s.identities ?? [], board: !!s.github, repos: reposOf(s), repoOrgs: s.repoOrgs ?? [], ci: s.ci === true, memory: memoryMode(s), memoryAgent: memoryAgentOf(s), memoryHidden: !!backstageAgent(s),
  memoryBatch: batchOf(s), memoryCompact: compactOf(s), tagMax: tagMaxOf(s), relayMax: relayMaxOf(s), modules: modulesOn(s.modulesOff, s.modulesIn) });
/** Agents' functions from the admin's frame: keys among the space's agents, values validRole, '' dropped (null if malformed). */
function agentRolesIn(x: any, agents: string[]): Record<string, string> | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const out: Record<string, string> = {};
  for (const [a, r] of Object.entries(x)) {
    const v = validRole(r);
    if (!agents.includes(a) || v === null) return null;
    if (v) out[a] = v;
  }
  return out;
}
/** Agents' photos that change, from the admin's frame: keys among the space's agents, values validAvatar ('' = removed). */
function agentAvatarsIn(x: any, agents: string[]): Record<string, string> | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const out: Record<string, string> = {};
  for (const [a, v] of Object.entries(x)) {
    const ok = validAvatar(v);
    if (!agents.includes(a) || ok === null) return null;
    out[a] = ok;
  }
  return out;
}
/** Parallel settings from the admin's frame (null if malformed). strict always means one thread at a time. */
function parallelIn(x: any): Parallel | null {
  if (!x || typeof x !== 'object' || (x.mode !== 'strict' && x.mode !== 'cooperative')) return null;
  if (!Number.isSafeInteger(x.max) || x.max < 1 || x.max > MAX_PARALLEL) return null;
  if (!ids(x.resources, MAX_RESOURCES, RESOURCE_RE) || !x.resources.every(typedResource)) return null;
  // Every resource comes with its usage rule, and only those: agents read it verbatim, nothing is guessed from the name.
  const rules: Record<string, string> = {}, given = x.rules ?? (x.resources.length ? null : {}); // no resource: `rules` may be absent
  if (!given || typeof given !== 'object' || Array.isArray(given) || Object.keys(given).length !== x.resources.length) return null;
  for (const r of x.resources as string[]) {
    const v = Object.hasOwn(given, r) ? validResourceRule(given[r]) : null;
    if (v === null) return null;
    rules[r] = v;
  }
  return { mode: x.mode, max: x.mode === 'strict' ? 1 : x.max, resources: [...x.resources], ...(x.resources.length ? { rules } : {}) };
}
const ids = (x: unknown, max: number, re: RegExp) => Array.isArray(x) && x.length <= max && x.every(v => typeof v === 'string' && re.test(v)) && new Set(x).size === x.length;

/** Admin directory: accounts already member of a space (display name) and agents served by an instance. */
export async function directory(deps: Deps) {
  const spaces = await deps.store.listSpaces();
  const people = new Map<string, string>();
  for (const s of spaces) for (const m of s.members) if (!people.has(m) || s.names?.[m]) people.set(m, s.names?.[m] ?? people.get(m) ?? m.slice(0, 6));
  // A human's function is the same everywhere: a space they join gets it like their name.
  const roles = new Map<string, string>();
  for (const s of spaces) for (const [m, r] of Object.entries(s.roles ?? {})) if (r && s.members.includes(m)) roles.set(m, r);
  const avatars = new Map<string, string>(); // same for the photo
  for (const s of spaces) for (const [m, a] of Object.entries(s.avatars ?? {})) if (a && s.members.includes(m)) avatars.set(m, a);
  const instances = await deps.store.listInstances();
  const agents = [...new Set(instances.flatMap(i => i.agents))].sort();
  return { spaces, people, roles, avatars, agents, instances };
}

/**
 * Secrets for an agent (« Secret » button, protocol/secret.ts). Trusted humans of the space only, in a thread or topic,
 * for one of the space's agents. The value arrives encrypted for the public key of the agent's live instance: the hub
 * relays it to that instance's connections in the space and stores none of it, only the line « X shared NAME with
 * agent ». No live connection = refused (`not_connected`), nothing is kept for later.
 */
async function secretTargets(deps: Deps, space: string, agent: string): Promise<{ connId: string; key: string; at: number }[]> {
  const out: { connId: string; key: string; at: number }[] = [];
  for (const sub of await deps.store.listSubs(space)) {
    if (sub.kind !== 'instance') continue;
    const inst = await deps.store.getInstance(sub.principal);
    if (inst?.agents.includes(agent) && inst.plugin?.secretKey && !out.some(o => o.connId === sub.connId)) out.push({ connId: sub.connId, key: inst.plugin.secretKey, at: inst.plugin.at });
  }
  return out.sort((a, b) => b.at - a.at); // most recent key first (two instances of one agent: the last one started)
}

async function secretHuman(deps: Deps, who: Principal, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  need(str(f.client_id, 64) && id(f.thread) && typeof f.agent === 'string' && AGENT_RE.test(f.agent));
  const cur = await deps.store.getThread(f.thread); need(!!cur, 'forbidden');
  const space = await memberSpace(deps, who, cur!.space);
  need(space.trusted.includes(who.id), 'forbidden'); // hands the agent a credential it will act with
  need(visibleAgents(space).includes(f.agent), 'forbidden');
  const targets = await secretTargets(deps, space.id, f.agent);
  if (f.type === 'secret.key') {
    need(targets.length > 0, 'not_connected');
    return void await reply({ v: 2, type: 'secret.key', client_id: f.client_id, agent: f.agent, key: targets[0].key });
  }
  need(typeof f.key === 'string' && SECRET_KEY_RE.test(f.key) && typeof f.name === 'string' && SECRET_NAME_RE.test(f.name) && isSecretKind(f.kind)
    && typeof f.epk === 'string' && SECRET_KEY_RE.test(f.epk) && typeof f.iv === 'string' && SECRET_IV_RE.test(f.iv)
    && typeof f.ct === 'string' && f.ct.length <= SECRET_CT_MAX && SECRET_CT_RE.test(f.ct));
  need(targets.length > 0, 'not_connected');
  const mine = targets.filter(t => t.key === f.key);
  need(mine.length > 0, 'stale_key'); // the gateway restarted since the key was read: its new key can't open it
  // The line is written before the relay: the plugin's `secret.received` may come back before this Lambda goes on.
  const by = space.names?.[who.id] ?? 'Member';
  const line: Message = { id: deps.newId(), thread: cur!.id, author: { kind: 'system', id: 'briefling' }, type: 'text', at: deps.now(),
    text: `${by} shared ${f.name} with ${f.agent}.`, secret: { name: f.name, kind: f.kind, agent: f.agent, by: who.id, status: 'sent' } };
  await deps.store.upsertMessage(line);
  let reached = 0;
  for (const t of mine) {
    const ok = await sendOne(deps, t.connId, { v: 2, type: 'secret.deliver', id: line.id, space: space.id, thread: cur!.id, agent: f.agent, from: who.id,
      name: f.name, kind: f.kind, epk: f.epk, iv: f.iv, ct: f.ct });
    if (ok) reached++;
    else if (ok === false) await deps.store.deleteSub(space.id, t.connId);
  }
  if (!reached) await deps.store.deleteMessage(cur!.id, line.id);
  need(reached > 0, 'not_connected');
  const now = await deps.store.getMessage(cur!.id, line.id); // already « received » if the plugin was quick
  if (now) await broadcast(deps, space.id, { v: 2, type: 'event', event: 'message.created', data: now });
  await reply({ v: 2, type: 'ack', client_id: f.client_id, thread: cur!.id, msg_id: line.id });
}

/** The plugin wrote (or could not open) a secret: the line shows it. Only an instance serving that line's agent, once. */
async function secretReceived(deps: Deps, who: Principal, f: any) {
  need(id(f.thread) && str(f.id, 64) && typeof f.ok === 'boolean');
  const cur = await deps.store.getThread(f.thread); need(!!cur, 'forbidden');
  const inst = await deps.store.getInstance(who.id);
  need(!!inst && inst.spaces.includes(cur!.space), 'forbidden');
  const m = await deps.store.getMessage(cur!.id, f.id);
  need(!!m?.secret && inst!.agents.includes(m.secret.agent), 'forbidden');
  if (m!.secret!.status !== 'sent') return; // a second connection of the instance, or a replay
  const status: SecretStatus = f.ok ? 'received' : 'failed';
  const r = await deps.store.upsertMessage({ ...m!, secret: { ...m!.secret!, status }, rev: (m!.rev ?? 0) + 1 });
  if (r) await broadcast(deps, cur!.space, { v: 2, type: 'event', event: 'message.updated', data: r.message });
}

/** Per agent, the plugin release of its most recently reporting instance. */
function agentPlugins(instances: Instance[]): Record<string, AgentPlugin> {
  const out: Record<string, AgentPlugin> = {};
  for (const i of instances) if (i.plugin) for (const a of i.agents) if (!out[a] || out[a].at < i.plugin.at) { const { secretKey, ...p } = i.plugin; out[a] = p; }
  return out;
}

async function admin(deps: Deps, who: Principal, f: any, reply: (f: HubFrame) => Promise<boolean>, connId = '') {
  // Global admin, or admin of the frame's space (Space.admins): both read again on every frame. A space admin gets
  // only their spaces; creating or archiving a space and naming its admins stay with the global admins.
  const global = await deps.store.isAdmin(who.id);
  if (f.type === 'admin.spaces') {
    const d = await directory(deps);
    const mine = global ? d.spaces : d.spaces.filter(s => isSpaceAdmin(s, who.id));
    need(mine.length > 0, 'forbidden');
    const ids = new Set(mine.map(s => s.id)), seen = new Set(mine.flatMap(s => s.members)), served = new Set(mine.flatMap(s => s.agents ?? [s.defaultAgent]));
    const pending = await deps.users?.pending() ?? new Map<string, number>();
    // Directory: every account for a global admin; a space admin sees the members of their spaces only.
    const people: DirectoryPerson[] = [...d.people].filter(([id]) => global || seen.has(id)).map(([id, name]) => pending.has(id) ? { id, name, invite: inviteState(deps, pending.get(id)!) } : { id, name });
    const plugins = agentPlugins(d.instances);
    await reply({ v: 2, type: 'admin.spaces', spaces: mine.map(settingsOf).sort((a, b) => a.name.localeCompare(b.name)),
      people: people.map(p => d.roles.get(p.id) ? { ...p, role: d.roles.get(p.id) } : p).sort((a, b) => a.name.localeCompare(b.name)), agents: d.agents,
      invites: (await invitesOf(deps, d.instances)).filter(i => global || ids.has(i.space)),
      plugins: global ? plugins : Object.fromEntries(Object.entries(plugins).filter(([a]) => served.has(a))) });
    return;
  }
  if (f.type === 'member.profile' || f.type === 'member.reinvite') {
    // A person, not a space: a space admin only for someone whose every space is one they administer.
    if (!global) {
      const theirs = typeof f.person === 'string' ? (await deps.store.listSpaces()).filter(s => s.members.includes(f.person)) : [];
      need(theirs.length > 0 && theirs.every(s => isSpaceAdmin(s, who.id)), 'forbidden');
    }
    return await member(deps, f, reply);
  }
  need(str(f.client_id, 64) && typeof f.space === 'string' && SPACE_ID_RE.test(f.space));
  if (!global) need(f.type !== 'space.archive' && !(f.type === 'space.save' && f.version === null) && isSpaceAdmin(await deps.store.getSpace(f.space), who.id), 'forbidden');
  if (f.type === 'flowcfg.get' || f.type === 'flowcfg.save' || f.type === 'flowcfg.head') return await flowConfig(deps, who, f, reply, connId);
  if (f.type === 'space.invite') return await invite(deps, f, reply);
  if (f.type === 'agent.invite') return await agentInvite(deps, who, f, reply);
  if (f.type === 'flowpilot.get' || f.type === 'flowpilot.link' || f.type === 'flowpilot.back') return await flowPilotFrame(deps, who, f, reply);
  if (typeof f.type === 'string' && f.type.startsWith('routine.')) return await routineFrame(deps, who, f, reply);
  if (typeof f.type === 'string' && f.type.startsWith('radarcfg.')) return await radarConfigFrame(deps, who, f, reply);
  if (f.type === 'agent.revoke') return await agentRevoke(deps, f, reply);
  if (f.type === 'agent.remove') return await agentRemove(deps, f, reply);
  if (f.type === 'space.archive') {
    need(Number.isSafeInteger(f.version) && f.version >= 0 && typeof f.on === 'boolean');
    const cur = await deps.store.getSpace(f.space); need(!!cur, 'forbidden');
    need((cur!.version ?? 0) === f.version, 'stale');
    const { archived, ...rest } = cur!;
    const next: Space = { ...rest, ...(f.on ? { archived: { by: who.id, at: deps.now() } } : {}), version: f.version + 1 };
    need(await deps.store.updateSpace(next, f.version), 'stale');
    await afterSpaceChange(deps, next, (await deps.store.listInstances()));
    await reply({ v: 2, type: 'space.saved', client_id: f.client_id, space: settingsOf(next) });
    return;
  }
  // space.save: creation (version null) or update
  need((f.version === null || (Number.isSafeInteger(f.version) && f.version >= 0)) && str(f.name, 60) && f.name.trim().length > 0
    && typeof f.about === 'string' && f.about.length <= MAX_ABOUT && ids(f.members, 50, ID_RE) && ids(f.trusted, 50, ID_RE)
    && ids(f.agents, 10, AGENT_RE) && f.agents.length > 0 && typeof f.defaultAgent === 'string');
  const parallel = f.parallel === undefined ? undefined : parallelIn(f.parallel);
  need(parallel !== null, 'bad_frame');
  const agentRoles = f.agentRoles === undefined ? undefined : agentRolesIn(f.agentRoles, f.agents);
  need(agentRoles !== null, 'bad_role');
  const agentAvatars = f.agentAvatars === undefined ? {} : agentAvatarsIn(f.agentAvatars, f.agents);
  need(agentAvatars !== null, 'bad_avatar');
  need(f.driver === undefined || f.driver === 'briefling' || f.driver === 'board', 'bad_frame');
  // Agent identities: GitHub logins, compared in lower case like unstrikeable does.
  const identities: string[] | undefined = f.identities === undefined ? undefined : Array.isArray(f.identities) ? f.identities.map((x: unknown) => typeof x === 'string' ? x.trim().toLowerCase() : '') : [];
  need(identities === undefined || ids(identities, MAX_IDENTITIES, GH_LOGIN_RE), 'bad_identity');
  // Attached repos: `owner/name` as GitHub writes them, no duplicate whatever the case (GitHub names are case-insensitive).
  const repos: string[] | undefined = f.repos === undefined ? undefined : Array.isArray(f.repos) ? f.repos.map((x: unknown) => typeof x === 'string' ? x.trim() : '') : [''];
  need(repos === undefined || (ids(repos, MAX_REPOS, REPO_RE) && new Set(repos.map(r => r.toLowerCase())).size === repos.length), 'bad_repo');
  // Orgs validated for the space's admins (global admin only, checked below): GitHub owners in lower case; missing = unchanged.
  const repoOrgs: string[] | undefined = f.repoOrgs === undefined ? undefined : Array.isArray(f.repoOrgs) ? f.repoOrgs.map((x: unknown) => typeof x === 'string' ? x.trim().toLowerCase() : '') : [''];
  need(repoOrgs === undefined || ids(repoOrgs, MAX_REPO_ORGS, GH_LOGIN_RE), 'bad_frame');
  need(f.ci === undefined || typeof f.ci === 'boolean', 'bad_frame');
  need(f.modules === undefined || validModules(f.modules), 'bad_frame'); // missing = unchanged
  need(f.memory === undefined || MEMORY_MODES.includes(f.memory), 'bad_frame');
  need(f.memoryAgent === undefined || (typeof f.memoryAgent === 'string' && f.agents.includes(f.memoryAgent)), 'bad_agent');
  need(f.memoryHidden === undefined || typeof f.memoryHidden === 'boolean', 'bad_frame');
  need((f.memoryBatch === undefined || validBatch(f.memoryBatch)) && (f.memoryCompact === undefined || validCompact(f.memoryCompact)) && (f.tagMax === undefined || validTagMax(f.tagMax)) && (f.relayMax === undefined || validRelayMax(f.relayMax)), 'bad_frame');
  need(f.trusted.every((t: string) => f.members.includes(t)), 'trusted_not_member'); // trust is only given to a member
  // Contributors: missing = unchanged (older tab); a role is only given to a member, one role per person.
  need(f.contributors === undefined || ids(f.contributors, 50, ID_RE), 'bad_frame');
  need((f.contributors ?? []).every((c: string) => f.members.includes(c)), 'trusted_not_member');
  need(!(f.contributors ?? []).some((c: string) => f.trusted.includes(c)), 'bad_frame');
  // Not technical: a flag only the admin sets (this frame is admin-only), never self-declared; members only, missing = unchanged.
  need(f.nontech === undefined || ids(f.nontech, 50, ID_RE), 'bad_frame');
  need((f.nontech ?? []).every((m: string) => f.members.includes(m)), 'trusted_not_member');
  // Space admins: members only, named by a global admin; missing = unchanged. Another admin of the space keeps the role
  // and the membership (a space admin can neither name nor remove one, nor leave by removing themself).
  need(f.admins === undefined || ids(f.admins, 50, ID_RE), 'bad_frame');
  need((f.admins ?? []).every((m: string) => f.members.includes(m)), 'trusted_not_member');
  need(f.agents.includes(f.defaultAgent), 'bad_frame');
  need(f.aboutCard === undefined || (!!f.aboutCard && typeof f.aboutCard === 'object' && id(f.aboutCard.thread) && id(f.aboutCard.msg)), 'bad_frame');
  const d = await directory(deps);
  const cur = d.spaces.find(s => s.id === f.space) ?? null;
  if (f.version === null) { need(!RESERVED_SPACES.includes(f.space), 'reserved'); need(!cur, 'exists'); }
  else { need(!!cur, 'forbidden'); need((cur!.version ?? 0) === f.version, 'stale'); }
  if (!global) {
    const kept = adminsOf(cur!);
    need(f.admins === undefined || (f.admins.length === kept.length && kept.every((m: string) => f.admins.includes(m))), 'forbidden');
    need(kept.every(m => f.members.includes(m)), 'forbidden');
    // Attached repos: the GitHub App's token reads them (memory import) and commits to them (flow git source), and the
    // App is installed per org, not per space. A space admin adds or removes only repos of the orgs a global admin
    // validated for this space (`repoOrgs`), and never changes that list.
    const orgs = cur!.repoOrgs ?? [];
    need(repoOrgs === undefined || (repoOrgs.length === orgs.length && repoOrgs.every(o => orgs.includes(o))), 'forbidden');
    const was = reposOf(cur!).map(r => r.toLowerCase()), now = (repos ?? reposOf(cur!)).map(r => r.toLowerCase());
    const moved = [...now.filter(r => !was.includes(r)), ...was.filter(r => !now.includes(r))];
    need(moved.every(r => orgs.includes(r.split('/')[0])), 'forbidden');
  }
  const admins: string[] = (f.admins ?? cur?.admins ?? []).filter((m: string) => f.members.includes(m));
  // Memory agent publishing alone (rules included): only once the admin ticked the risk warning (no tool on its profile,
  // which the hub cannot check); logged as the audit trail of who accepted it.
  if (f.memory === 'agentAuto' && cur?.memory !== 'agentAuto') {
    need(f.memoryAck === true, 'bad_frame');
    console.log('memory_risk_ack', JSON.stringify({ space: f.space, by: who.id, agent: f.memoryAgent ?? cur?.memoryAgent ?? f.defaultAgent }));
  }
  need(f.driver !== 'board' || !!cur?.github, 'no_board'); // the external driver reads an attached GitHub Project
  // Only accounts and agents that exist: no invented member, no agent that no instance serves
  // (a former agent already in the space stays accepted).
  need(f.members.every((m: string) => d.people.has(m) || cur?.members.includes(m)), 'unknown_member');
  need(f.agents.every((a: string) => d.agents.includes(a) || cur?.agents?.includes(a)), 'unknown_agent');
  const names = { ...(cur?.names ?? {}) };
  for (const m of f.members as string[]) names[m] ??= d.people.get(m) ?? m.slice(0, 6);
  const roles = { ...(cur?.roles ?? {}) };
  for (const m of f.members as string[]) if (!roles[m] && d.roles.get(m)) roles[m] = d.roles.get(m)!;
  const avatars = { ...(cur?.avatars ?? {}) };
  for (const m of f.members as string[]) if (!avatars[m] && d.avatars.get(m)) avatars[m] = d.avatars.get(m)!;
  const next: Space = { ...(cur ?? {}), id: f.space, name: f.name.trim(), about: f.about.trim(), members: f.members, trusted: f.trusted,
    contributors: contributorsOf({ ...(cur ?? { id: f.space, defaultAgent: f.defaultAgent }), members: f.members, trusted: f.trusted, contributors: f.contributors ?? cur?.contributors ?? [] }),
    nontech: nontechOf({ members: f.members, nontech: f.nontech ?? cur?.nontech ?? [] }), admins,
    agents: f.agents, defaultAgent: f.defaultAgent, names, roles, avatars, ...(parallel ? { parallel } : {}), version: (f.version ?? 0) + 1,
    ...(f.driver ? { driver: f.driver as Driver } : {}), ...(identities ? { identities } : {}), ...(repos ? { repos } : {}), ...(repoOrgs ? { repoOrgs } : {}), ...(typeof f.ci === 'boolean' ? { ci: f.ci } : {}),
    ...(f.modules ? { modulesOff: modulesOffOf(f.modules), modulesIn: modulesInOf(f.modules) } : {}),
    ...(f.memory ? { memory: f.memory as MemoryMode } : {}), ...(f.memoryAgent ? { memoryAgent: f.memoryAgent } : {}),
    ...(typeof f.memoryHidden === 'boolean' ? { memoryHidden: f.memoryHidden } : {}),
    ...(f.memoryBatch ? { memoryBatch: { n: f.memoryBatch.n, minutes: f.memoryBatch.minutes } } : {}),
    ...(f.memoryCompact ? { memoryCompact: { n: f.memoryCompact.n, words: f.memoryCompact.words } } : {}),
    ...(f.tagMax !== undefined ? { tagMax: f.tagMax } : {}), ...(f.relayMax !== undefined ? { relayMax: f.relayMax } : {}),
    // removed agents lose their function; missing in the frame (older tab) = unchanged
    agentRoles: Object.fromEntries(Object.entries(agentRoles ?? cur?.agentRoles ?? {}).filter(([a, r]) => r && (f.agents as string[]).includes(a))),
    // photos: the frame only carries the ones that change ('' = removed); removed agents lose theirs
    agentAvatars: Object.fromEntries(Object.entries({ ...(cur?.agentAvatars ?? {}), ...agentAvatars }).filter(([a, v]) => v && (f.agents as string[]).includes(a))) };
  // Backstage memory agent: only an agent other than the one in charge (that one answers every conversation).
  need(!next.memoryHidden || !!backstageAgent(next), 'bad_agent');
  need(cur ? await deps.store.updateSpace(next, f.version) : await deps.store.createSpace(next), cur ? 'stale' : 'exists');
  await afterSpaceChange(deps, next, d.instances);
  if (cur && parallel && !boardDriven(next)) { // more places: the queues move now; resources removed: their queues are emptied
    for (const l of await deps.store.listLocks(next.id)) await fillPlaces(deps, next, l.agent);
    await dropResources(deps, next);
  }
  if (boardDriven(next) && !boardDriven(cur!)) {
    // Switch to the board driver: no more hand nor queues (a queued thread would wait forever), and the import of
    // the open issues starts now instead of at the next poll.
    for (const l of await deps.store.listLocks(next.id)) await mutateLock(deps, next.id, l.agent, x => x.holders.length || x.queue.length ? { ...x, holders: [], queue: [], by: {}, delivered: {}, talk: {} } : null);
    await deps.queueGithub?.({ kind: 'poll', space: next.id });
  }
  if (cur && f.aboutCard && next.about !== (cur.about ?? '').trim()) await aboutApplied(deps, who, next, f.aboutCard);
  await reply({ v: 2, type: 'space.saved', client_id: f.client_id, space: settingsOf(next) });
}

/**
 * Brief draft card applied: the admin saved a brief that changed, from the form the card filled. Only a draft card of
 * this space, not applied yet; anything else is ignored (the save itself already succeeded).
 */
async function aboutApplied(deps: Deps, who: Principal, space: Space, ref: { thread: string; msg: string }) {
  const th = await deps.store.getThread(ref.thread);
  if (!th || th.space !== space.id) return;
  const m = await deps.store.getMessage(th.id, ref.msg);
  if (m?.type !== 'about' || !m.about || m.about.applied) return;
  const r = await deps.store.upsertMessage({ ...m, about: { ...m.about, applied: { by: who.id, at: deps.now() } }, rev: (m.rev ?? 0) + 1 });
  if (r) await broadcast(deps, space.id, { v: 2, type: 'event', event: 'message.updated', data: r.message });
}

/**
 * After a settings change: the instances of the space's agents get access, the others lose it; every subscribed
 * human learns the new name, or that they no longer have access, and the subscription of removed people is dropped
 * at once (otherwise they would keep receiving messages until the end of their connection). The open connections of
 * an instance subscribed with `*` get the space now (created, agent added back, unarchived), not at their next
 * reconnection: until then every message to the agent there was lost.
 */
export async function afterSpaceChange(deps: Deps, s: Space, instances: Instance[]) {
  const open = new Set<string>();
  for (const inst of instances) {
    const want = !s.archived && inst.agents.some(a => (s.agents ?? [s.defaultAgent]).includes(a));
    if (want) open.add(inst.id);
    if (want !== inst.spaces.includes(s.id)) await deps.store.bindInstance(inst.id, s.id, want);
  }
  await notifyMembers(deps, s, open);
  if (!open.size) return;
  const subscribed = new Set((await deps.store.listSubs(s.id)).map(x => x.connId));
  for (const inst of open) for (const connId of await deps.store.listInstanceConns(inst))
    if (!subscribed.has(connId)) await deps.store.putSub(s.id, { connId, kind: 'instance', principal: inst });
  // Roles may have changed: the plugins that take their allowlist from the hub get the new one.
  const users = allowedOf(s);
  for (const sub of await deps.store.listSubs(s.id))
    if (sub.kind === 'instance' && open.has(sub.principal)) await sendOne(deps, sub.connId, { v: 2, type: 'allowed', space: s.id, users });
  // Project, repos or agents may have changed: config.yml with them (same bundle = same sha, the plugin skips it).
  await pushFlowConfig(deps, s).catch(e => console.error('flow_push_failed', s.id, (e as Error)?.message?.slice(0, 200)));
  await presenceChanged(deps, s.id); // agents added or removed
}
export const inviteState = (deps: Deps, since: number) => deps.now() - since > INVITE_VALID_MS ? 'expired' as const : 'pending' as const;
/** Members of the space with their display name (the id's start when none was ever set). */
export const humansOf = (s: Space): Person[] => s.members.map(m => ({ id: m, name: s.names?.[m] ?? m.slice(0, 6), kind: 'human' as const, ...(s.roles?.[m] ? { role: s.roles[m] } : {}),
  ...(s.avatars?.[m] ? { avatar: s.avatars[m] } : {}) }));
/** space.updated: members (with their photo), the agents a human sees (as in `synced`: the backstage memory agent left
 *  out) and their photos, within the photos' frame budget. Without `agents`, an agent that just joined was in
 *  `presence.changed` but missing from the client's people until a reload (Lounge stack, @ list). */
function membersOf(s: Space): { humans: Person[]; agents: string[]; agentAvatars?: Record<string, string> } {
  const agents = s.agents ?? [s.defaultAgent];
  const { people, bytes } = fitAvatars(humansOf(s));
  const av = fitAvatars(Object.entries(s.agentAvatars ?? {}).filter(([a, v]) => v && agents.includes(a)).map(([id, avatar]) => ({ id, avatar })), AVATARS_MAX_BYTES - bytes).people;
  const agentAvatars = Object.fromEntries(av.filter(p => p.avatar).map(p => [p.id, p.avatar!]));
  return { humans: people, agents: visibleAgents(s), ...(Object.keys(agentAvatars).length ? { agentAvatars } : {}) };
}
/**
 * Every subscribed human learns the space's name, its members' names, or that they no longer have access (their
 * subscription is then dropped at once, otherwise they would keep receiving messages until the end of their connection).
 * `open`: instances still allowed (settings change); omitted = instances untouched.
 */
export async function notifyMembers(deps: Deps, s: Space, open?: Set<string>) {
  for (const sub of await deps.store.listSubs(s.id)) {
    if (sub.kind === 'instance') { if (open && !open.has(sub.principal)) await deps.store.deleteSub(s.id, sub.connId); continue; }
    const member = canSee(s, sub.principal);
    const alive = await sendOne(deps, sub.connId, { v: 2, type: 'event', event: 'space.updated', data: { id: s.id, name: s.name ?? s.id, member, ...(member ? { ...membersOf(s), agentRoles: settingsOf(s).agentRoles, driver: boardDriven(s) ? 'board' : 'briefling', memPending: memPendingFor(s, sub.principal), modules: modulesOn(s.modulesOff, s.modulesIn), ...nontechFor(s, sub.principal), ...adminFor(s, sub.principal) } : {}) } });
    if (alive === false || !member) await deps.store.deleteSub(s.id, sub.connId);
  }
}

// ---------------------------------------------------------------- attachments
// Private S3. Upload goes through a presigned form (key, type and max size enforced by the S3 policy);
// a message only references an attachment after checks: same space, same author, object really present,
// size within bounds, never already bound to another message. Read: 10 min presigned URL, members only.
export const fileKey = (space: string, id: string) => `f/${space}/${id}`;
const INLINE_MIME = new Set([...INLINE_IMAGE_MIME, ...INLINE_AUDIO_MIME, ...INLINE_VIDEO_MIME]);
const MIME_RE = /^[a-z]+\/[a-z0-9.+-]{1,100}$/;
/** Displayable file name: no path nor control characters, bounded. */
export const cleanName = (n: string) => n.replace(/[\u0000-\u001f\u007f/\\]/g, '_').replace(/^\.+/, '').trim().slice(0, 150) || 'file';
export const isInline = (mime: string) => INLINE_MIME.has(mime);
/** How S3 serves a read: images, audio and video inline with their own type (shown/played in the page), the rest forced to
 *  download as an opaque type, so a browser never renders an uploaded HTML or SVG. */
export function servedAs(f: { mime: string; name: string }): { type: string; disposition: string } {
  const inline = isInline(f.mime);
  const name = f.name;
  return { type: inline ? f.mime : 'application/octet-stream',
    disposition: `${inline ? 'inline' : 'attachment'}; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}` };
}
const fileIds = (x: unknown) => x === undefined || (Array.isArray(x) && x.length <= MAX_FILES && x.every(id) && new Set(x).size === x.length);

async function upload(deps: Deps, who: Principal, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  need(str(f.client_id, 64) && id(f.space) && str(f.name, 300) && typeof f.mime === 'string' && Number.isSafeInteger(f.size) && f.size > 0);
  // Declared type kept only if well-formed; it is only used for display, never to execute anything.
  const mime = MIME_RE.test(f.mime) ? f.mime : 'application/octet-stream';
  // Cap by type (videos get more); the S3 form policy then enforces this declared size and type.
  need(f.size <= maxFileBytes(mime), 'file_too_large');
  need(!!deps.files, 'files_off');
  if (who.kind === 'human') await memberSpace(deps, who, f.space);
  else { const inst = await deps.store.getInstance(who.id); need(!!inst && inst.spaces.includes(f.space), 'forbidden'); }
  const a: Attachment = { id: deps.newId(), name: cleanName(f.name), mime, size: f.size, space: f.space, by: who.id, at: deps.now() };
  await deps.store.putAttachment(a);
  const post = await deps.files!.presignPost(fileKey(a.space, a.id), a.mime, a.size);
  await reply({ v: 2, type: 'upload.ready', client_id: f.client_id, file: { id: a.id, name: a.name, mime: a.mime, size: a.size }, post });
}

export async function attach(deps: Deps, by: string, space: string, msg: string, ids?: string[]): Promise<FileRef[]> {
  if (!ids?.length) return [];
  need(!!deps.files, 'files_off');
  const found = await deps.store.getAttachments(ids);
  const out: FileRef[] = [];
  for (const fid of ids) {
    const a = found.find(x => x.id === fid);
    need(!!a && a.space === space && a.by === by, 'bad_file');
    if (a!.msg === msg) { out.push({ id: a!.id, name: a!.name, mime: a!.mime, size: a!.size }); continue; } // re-edit (streaming)
    const real = await deps.files!.size(fileKey(space, fid));
    need(real !== null && real <= a!.size, 'file_not_uploaded');
    need(await deps.store.claimAttachment(fid, msg), 'bad_file');
    out.push({ id: a!.id, name: a!.name, mime: a!.mime, size: real! });
  }
  return out;
}

async function fileUrls(deps: Deps, who: Principal, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  need(Array.isArray(f.ids) && f.ids.length > 0 && f.ids.length <= 50 && f.ids.every(id));
  need(!!deps.files, 'files_off');
  const urls: Record<string, string> = {};
  const spaces = new Map<string, boolean>();
  for (const a of await deps.store.getAttachments(f.ids)) {
    if (!a.msg) continue; // not published yet: invisible
    if (!spaces.has(a.space)) { const s = await deps.store.getSpace(a.space); spaces.set(a.space, !!s && canSee(s, who.id)); }
    if (spaces.get(a.space)) urls[a.id] = await deps.files!.presignGet(fileKey(a.space, a.id), a);
  }
  await reply({ v: 2, type: 'files.urls', urls });
}
