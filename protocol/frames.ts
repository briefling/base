// briefling protocol v2: JSON frames exchanged over the hub WebSocket.
// Single source of truth for the TypeScript types (the Hermes Python plugin follows this file).

import type { BrowserFrame } from './browser.ts';
import type { AgentMemoryEntry, MemoryAction, MemoryBatch, MemoryCompact, MemoryEntry, MemoryFileError, MemoryKind, MemoryMode, MemoryReviewVerdict, MemoryRun, MemoryVocab, MemoryWake, PushedMemoryEntry } from './memory.ts';
import type { FlowDef } from './flowcfg.ts';
import type { BundleFile, BundleTarget, FlowSource, FlowTeam } from './flowteam.ts';
import type { SecretKind, SecretLine } from './secret.ts';
import type { Routine, RoutineDraft } from './routines.ts';
import type { Applet, AppletCard, AppletDraft, AppletResult, AppletRunInfo, AppletValue } from './applets.ts';
import type { Correspondent, Exchange, ExchangeConfig, ExchangeMail, ExchangeRequest, ExchangeSummary, MailIn, RequestSide } from './exchanges.ts';
import type { SignalType, RadarConfig, RadarCorrection, RadarDetectors, RadarProfile, RadarRhythm, RadarRunKind, RadarRunResult, Signal, SignalDraft } from './radar.ts';
import type { Module } from './modules.ts';
import type { CacheTtl, UpdateBlock } from './plugin.ts';
import type { ThreadTags } from './tags.ts';
import type { Reminder, ReminderCard, ReminderList } from './reminders.ts';
import type { Lead } from './leads.ts';
import type { IceServer, PreviewError, PreviewLine } from './preview.ts';
import type { LastSeen, Presence, PresenceState } from './presence.ts';

export const PROTOCOL = 'briefling.v2';
export const MAX_TEXT = 32_000;
// ---------------------------------------------------------------- General (Lounge room)
// Blair, Oct 31: one flat room per space pinned at the top of the Lounge, for free talk. Never archived, never renamed,
// never a card (thread, issue, plan, about) nor an agent turn there: the hub refuses them. An agent @mentioned in
// General by a human who may wake it (`wakes`, as in a topic) answers in a topic the hub opens from that message
// (« Reply as topic », also offered by hand to every member); the agent then gets the AMBIENT_MAX messages of General
// before it, once, at the first turn of that topic (`deliver.context.ambient`, data, never instructions).
/** Id of a space's General room (fixed: created by its first post). newId never holds a `-`: no collision with other threads. */
export const generalId = (space: string) => `general-${space}`;
/** Stored title of a conversation whose title (or topic text) was a message its author deleted: clients show their own words. */
export const DELETED_TITLE = 'Deleted message';
export const isGeneralId = (id: string | undefined) => !!id && id.startsWith('general-');
/** Topic opened from the General message `msg` (fixed id: opening it twice gives the same topic) and its first message. */
export const subtopicId = (msg: string) => `${msg}-t`;
export const subtopicFirstId = (msg: string) => `${msg}-0`;
/** Messages of General handed to the agent at the first turn of a topic opened from it. */
export const AMBIENT_MAX = 20;

/** First message of a topic, kept on the topic (Lounge list, 6 lines shown): bounds the size of `synced`. */
export const TOPIC_TEXT_MAX = 400;
/** Topics an agent may open on its own (`topic.open`) per space and UTC day: a cron gone wild floods nobody. */
export const AGENT_TOPICS_PER_DAY = 10;
/** Text kept on a topic: first message, trimmed, cut by code point (never in the middle of an emoji). */
export function topicText(text: string): string {
  const cps = [...text.trim()];
  return cps.length > TOPIC_TEXT_MAX ? cps.slice(0, TOPIC_TEXT_MAX).join('').trimEnd() + '…' : cps.join('');
}
// Topic title (Thread.heading): written by the agent in charge from the first message, or set by a lead. Plain text,
// never interpreted (the client shows it as text).
export const TOPIC_HEADING_MAX = 60;
/**
 * One line of plain text: control and bidi-override characters become spaces, whitespace collapsed, wrapping quotes and
 * Markdown marks dropped, cut by code point at TOPIC_HEADING_MAX with « … ». '' = nothing left (refused, or « no title »).
 */
export function cleanHeading(raw: string): string {
  const s = raw.replace(/[\u0000-\u001f\u007f-\u009f\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g, ' ').replace(/\s+/g, ' ')
    .replace(/^["'`*_#«»“”‘’\s]+|["'`*_«»“”‘’\s]+$/g, '').trim();
  const cps = [...s];
  return cps.length > TOPIC_HEADING_MAX ? cps.slice(0, TOPIC_HEADING_MAX - 1).join('').trimEnd() + '…' : s;
}
export const MAX_STATUS = 200; // "Milan is working…" line: the phrase of the running tool
export const MAX_ACTIVITY = 10; // status.recent: the last tool phrases of the turn (activity feed under that line)
export const MAX_BRIEF = 1500; // brief of a "Make it a thread?" card (3 to 5 lines expected)
/** `context` of a thread or plan card: the agent's summary of the conversation (decisions, refused options and why,
 *  constraints, files and ids cited). With it, the kickoff sends brief + context + a link + the newest attachments,
 *  never the topic's messages. */
export const MAX_CONTEXT = 1500;
export const MAX_ACTION = 200; // "waiting for <action>": what the agent expects from the human, one line
/**
 * « To decide » card (`ask.choices`, agent tool `ask_choices`): 1 to 5 points, each with a short label, its question
 * and 2 to 4 choices, the recommended one first. Unlike a clarify `ask`, the agent ends its turn: the card stays open
 * until a trusted human answers it (an `answer` whose `option` is the composed text « label → choice » per line) or
 * writes a message in the conversation (that message is the answer and closes the card), or the agent asks again.
 */
export interface AskItem { label: string; q: string; options: string[] }
export const ASK_ITEMS_MAX = 5, ASK_OPTIONS_MIN = 2, ASK_OPTIONS_MAX = 4, ASK_LABEL_MAX = 60, ASK_ITEM_Q_MAX = 500, ASK_OPTION_MAX = 200;
export const ASK_TEXT_MAX = 2000; // intro of the card, and an `answer`'s `option`
// Thread summary written by the agent with its turn outcome (`thread.outcome.summary`), every field on one line.
export const SUMMARY_STATUS_MAX = 500;  // where the work stands, one or two sentences
export const SUMMARY_ITEMS_MAX = 8;     // decisions, next steps
export const SUMMARY_ITEM_MAX = 300;    // one decision, one next step's `what`
export const SUMMARY_WHO_MAX = 60;      // who must act (a next step's `who`)
export const SUMMARY_WAITING_MAX = 120; // waiting_on
export const MAX_FILE_BYTES = 20 * 1024 * 1024;   // per attachment (videos: MAX_VIDEO_BYTES)
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // a phone video in 1080p is ~100 MB per minute; zip archives too
export const MAX_FILES = 10;                   // per message
/** Attachments shown in the page: the hub serves only these inline with their type, everything else is forced to
 *  download as application/octet-stream. Raster images and the audio formats browsers play; never SVG, HTML or PDF
 *  (active content). Recorded voice is audio/webm (Chrome, Firefox: opus) or audio/mp4 (Safari). */
export const INLINE_IMAGE_MIME: readonly string[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const INLINE_AUDIO_MIME: readonly string[] = ['audio/webm', 'audio/ogg', 'audio/opus', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a',
  'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/flac'];
/** Videos played in the page (passive media, like audio). A `.mov` from an iPhone is often HEVC, which Chrome may not
 *  decode: the player then stays black and the download button remains. */
export const INLINE_VIDEO_MIME: readonly string[] = ['video/mp4', 'video/webm', 'video/quicktime'];
/** Zip archives (always downloaded, never shown): a generated document set or a project export is often over 20 MB.
 *  `application/x-zip-compressed` is what browsers on Windows declare for a .zip. */
export const ARCHIVE_MIME: readonly string[] = ['application/zip', 'application/x-zip-compressed'];
/** Size cap of one attachment by its declared type: checked by the client, the hub `upload` and the S3 form policy
 *  (videos and zip archives get MAX_VIDEO_BYTES). The plugin applies the same caps on its side (adapter.py). */
export const maxFileBytes = (mime: string) => INLINE_VIDEO_MIME.includes(mime) || ARCHIVE_MIME.includes(mime) ? MAX_VIDEO_BYTES : MAX_FILE_BYTES;
export const MAX_ABOUT = 4000;  // space description sent to the agent
export const MAX_SPACES = 50;   // spaces listed at subscribe
/** Thread list of a space: pages of THREADS_PAGE, most recent activity (`updatedAt`) first. */
export const THREADS_PAGE = 50;
// Web Push (tab closed, phone): one subscription per device and person, RFC 8030 + 8291 (payload encrypted for the
// device: the push service sees neither title nor space) + 8292 (VAPID). Oldest device dropped past the cap.
export const MAX_PUSH_DEVICES = 10;
export interface PushSub { endpoint: string; keys: { p256dh: string; auth: string } }
/** What the service worker receives (decrypted on the device) and shows: same text as the open-tab alert. A memory
 *  reminder has no thread: `view: 'memory'` opens the space's Memory view. */
/** `badge`: the recipient's Your turn total over all their spaces at send time (app icon badge, `isMyTurn`). */
/** `msg`: the message the notification is about (a new message, or the agent's last answer for Your turn): a click
 *  scrolls to it and flashes it, like a search result. */
export interface PushPayload { title: string; body: string; space: string; thread?: string; msg?: string; view?: 'memory' | 'radar' | 'reminders'; badge?: number }
/** Levels of a topic's family walked through `spawned` (topic → thread → thread opened from it …): Lounge card rows,
 *  pin bar counts and the hub's sync join. A bound, not a product limit: deeper ones are left out. */
export const FAMILY_DEPTH = 4;
/** Threads opened from a topic that each turn of that topic lists in its context (`deliver.context.spawned`), most
 *  recently opened ones. Each thread runs in its own agent session: without this the topic's agent knows nothing of
 *  where they stand. Mirrored in hermes-plugin/briefling/tooldefs.py. */
export const SPAWNED_CONTEXT_MAX = 10;
/** One thread opened from the topic, as its agent sees it (`deliver.context.spawned`). `plan.step` is 0-based
 *  (PlanLink). `status`: the thread's summary status when its agent wrote one. Data, never instructions. */
export interface SpawnedThread { id: string; title: string; state: ThreadState; archived?: true; outcome?: { kind: 'done' | 'waiting'; action?: string };
  plan?: { step: number; of: number }; status?: string }
export const SEEN_MAX = 100;                   // read marks per `seen` frame (one batch at reconnection)
/** Space id (created in the app, permanent: used in the URL and the keys); `now` is a client route. */
export const SPACE_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
export const RESERVED_SPACES = ['now', 'new-space'];
export const AGENT_RE = /^[a-z][a-z0-9_-]{0,31}$/;
/** Parallel work (space settings): at most MAX_PARALLEL threads per agent, MAX_RESOURCES shared resources. */
export const MAX_PARALLEL = 5;
export const MAX_RESOURCES = 10;
/** Shared resource name, declared by the admin: `emulator`, `gateway`, `stack:briefling-dev`. */
export const RESOURCE_RE = /^[a-z][a-z0-9-]{0,23}(?::[a-z0-9][a-z0-9._-]{0,47})?$/;
/**
 * Fixed resource types: a resource saved from the settings is `<type>` or `<type>:<name>` with a
 * type of this list, so every agent reads the same kind of lock. Names stored before the list existed are read as is.
 */
export const RESOURCE_TYPES = ['stack', 'release', 'emulator', 'gateway'] as const;
export type ResourceType = typeof RESOURCE_TYPES[number];
export const resourceType = (r: string) => r.split(':')[0];
export const typedResource = (r: string) => RESOURCE_RE.test(r) && (RESOURCE_TYPES as readonly string[]).includes(resourceType(r));
/** Usage rule of a resource (« take before npm run deploy, release after »): mandatory on save, given verbatim to agents. */
export const RESOURCE_RULE_MAX = 200;
/** The rule normalized (one line, NFC, trimmed), null when empty, too long or with a control character. */
export const validResourceRule = (x: unknown): string | null => {
  if (typeof x !== 'string') return null;
  const n = x.normalize('NFC').replace(/\s+/g, ' ').trim();
  return n && n.length <= RESOURCE_RULE_MAX && !/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/.test(n) ? n : null;
};
/**
 * Invitation address (lower case: the Cognito pool compares user names case-sensitively and the address is the user
 * name). Deliberately narrower than RFC 5322: no quotes, backslashes, spaces or brackets, so it is also safe inside
 * a Cognito ListUsers filter string.
 */
export const EMAIL_RE = /^[a-z0-9._%+'-]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,24}$/;
export const MAX_EMAIL = 254;
/** Typed address -> canonical form (trimmed, lower case), null if it is not one we accept. */
export const normEmail = (x: unknown): string | null => {
  if (typeof x !== 'string') return null;
  const e = x.trim().toLowerCase();
  return e.length <= MAX_EMAIL && EMAIL_RE.test(e) ? e : null;
};

/** A space as a member sees it (sidebar list). */
export interface SpaceInfo { id: string; name: string; memPending?: number; modules?: Module[]; nontech?: true; admin?: true; muted?: true } // memPending: memory entries waiting for you (reviewers only); modules: on (protocol/modules.ts), missing = all;
// nontech: YOU are flagged « not technical » in this space (sent to that member only): the client folds the technical details
// admin: YOU are an admin of this space (Space.admins, sent to that member only): its Settings open to you
// muted: YOU put this space on mute (personal, hub/src/mute.ts): its messages stop notifying you, except your turns and mentions
/**
 * Space settings, read and written by the admins only (global hub role, or `admins` of this space). `version` grows on every write:
 * the hub refuses (`stale`) a save made on an outdated version. `trusted` ⊆ `members`, `defaultAgent` ∈ `agents`.
 * Roles of a space, each one includes the previous (Blair, Oct 2026): member (`members`: reads and writes, no agent acts
 * on their messages), contributor (`contributors`: the agents also answer them in the Lounge, they launch nothing), lead
 * (`trusted`: also makes the agents work: opens threads, archives, stops a turn, approves an issue; their go is the ship
 * go). `contributors` ⊆ `members`, disjoint from `trusted`. `nontech` ⊆ `members`: people the admin flagged « not
 * technical » (any role); the agents talk to them without jargon. Set by the admin only, never by the member.
 * Archived: hidden from everyone, threads kept, agents unplugged; reversible.
 */
/** Plugin release an agent's instance reported at its last connection. */
export interface AgentPlugin { version: string; at: number; kind?: 'acp'; secretKey?: string; voice?: true; update?: UpdateBlock; cacheTtl?: CacheTtl } // kind 'acp': an ACP bridge (protocol/bridge-release.ts), else the Hermes plugin; secretKey: protocol/secret.ts; voice: its last subscribe announced voice; update: why it will not self-update; cacheTtl: Hermes' prompt cache setting (protocol/plugin.ts)
export interface SpaceSettings { id: string; name: string; about: string; members: string[]; trusted: string[]; contributors: string[]; nontech: string[]; agents: string[]; defaultAgent: string;
  admins: string[];                   // space admins (members): this space's settings, named by a global admin only
  archived?: { by: string; at: number }; parallel: Parallel; version: number;
  agentRoles: Record<string, string>; // function shown next to each agent (« Milan · Dev »), display only
  driver: Driver;                     // who drives the work (see Driver)
  identities: string[];               // GitHub logins of the board's agents (trusted authors), lower case
  board: boolean;                     // a GitHub Project is attached (the external driver needs one)
  repos: string[];                    // attached repos `owner/name` (admin list, REPO_RE); a Project is optional
  repoOrgs: string[];                 // owners (GH_LOGIN_RE, lower case) a global admin validated: a space admin attaches their repos only
  ci: boolean;                        // CI follow-up (`pushed_commits`), off by default
  memory: MemoryMode;                 // gate of the project memory (protocol/memory.ts), agent by default
  memoryAgent: string;                // agent that reviews proposals (agent mode) and compacts; default the agent in charge
  memoryHidden: boolean;              // the memory agent is backstage (protocol/memory.ts backstageAgent), off by default
  memoryBatch: MemoryBatch;           // when the memory agent reviews (agent mode), defaults applied
  memoryCompact: MemoryCompact;       // when the memory agent compacts, defaults applied
  tagMax: number;                     // cap of the space's tag vocabulary (protocol/memory.ts TAG_MAX_DEFAULT), default applied
  relayMax: number;                   // wakes of an agent by another agent's mention between two human messages (protocol/relay.ts), 0 = off
  modules: Module[] }                 // optional sections turned on (protocol/modules.ts); every one for a space never set
/**
 * Who drives the work in a space (admin setting « Driver », product decision, docs/design-external-board.md).
 * briefling = today's behaviour. board = an external board (unstrikeable on a GitHub Project) drives the agents:
 * every open issue of the Project gets its thread (`Thread.board`), created by the poller when the author is trusted
 * (org member or collaborator, repo writer, one of the space's agent `identities`, the briefling App) or once a
 * member's go lifted the vetting; GitHub content shows as read-only cards (Message.gh). No agent hand, no shared
 * resources, no `propose_thread` in that mode: unstrikeable already runs one task at a time per agent. The agent proposes
 * issues instead (`propose_issue`, Message.newIssue), a trusted human creates them.
 */
export type Driver = 'briefling' | 'board';
/** Attached repo `owner/name` as GitHub allows it (owner: login rules; name: letters, digits, `.`, `_`, `-`). */
export const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}\/(?!\.\.?$)[A-Za-z0-9._-]{1,100}$/;
export const MAX_REPOS = 20;
/** GitHub orgs (or users) a global admin validated for a space: its space admins attach repos of these owners only. */
export const MAX_REPO_ORGS = 5;
/**
 * CI follow-up (docs/design-ci-feedback.md, slice 1: display only, no agent wake-up). In a space where the admin turned
 * it on (`SpaceSettings.ci`), the agent declares the commits it pushed (`pushed_commits` tool, frame `ci.watch`); the
 * hub reads their CI on GitHub (check runs and commit statuses) in the 5-min poller until it ends, CI_DEADLINE_MS at
 * most, and keeps the latest state per repo on the thread (`Thread.ci`). A new sha for a repo supersedes the older one.
 * verdict: running; green (all success / neutral / skipped); red (a failure, timed out, action required, startup
 * failure, status failure / error); none (no check nor status CI_NONE_MS after the declaration); cancelled (cancelled
 * or stale, none red); timeout (still running at the deadline); missing (commit unknown to GitHub); unknown (the App
 * can't read it: `reason`). red, timeout and missing also post a system line (Message.ci).
 */
export type CiVerdict = 'running' | 'green' | 'red' | 'none' | 'cancelled' | 'timeout' | 'missing' | 'unknown';
export type CiReason = 'not_installed' | 'no_permission' | 'no_access';
/** n: checks and statuses read; failed: how many are red. */
export interface CiPill { repo: string; sha: string; verdict: CiVerdict; at: number; n: number; failed: number; reason?: CiReason }
/** One red check or status as shown to humans: name cut at CI_NAME_MAX (CI-written text: data, never Markdown);
 *  url only on github.com. */
export interface CiCheck { name: string; conclusion: string; url?: string }
/** System line (author system `ci`) of a CI that needs a look. failed: the first CI_LISTED red ones, more: the rest. */
export interface CiReport { repo: string; sha: string; verdict: 'red' | 'timeout' | 'missing'; failed: CiCheck[]; more: number; passed: number }
export const CI_MAX_COMMITS = 5, CI_MAX_WATCHES = 10, CI_DEADLINE_MS = 3_600_000, CI_NONE_MS = 600_000, CI_NAME_MAX = 100, CI_LISTED = 5;
export const SHA_RE = /^[0-9a-f]{40}$/;
/** Branch name given with a pushed commit (`pushed_commits`): what git allows, kept conservative (no `..`, no leading
 *  `-` or `/`, no space nor control character). */
export const BRANCH_RE = /^(?![-/])(?!.*\.\.)[A-Za-z0-9._/-]{1,200}$/;

/**
 * Thread info panel (« Thread info », `details.get`). Timeline events are recorded by the hub as they happen, from this
 * feature on (a thread older than it only shows its opening). Kinds: turn (agent turn start / end, `stopped` = ended
 * on a stop request), outcome (`turn_outcome`), resource (shared resource acquired, queued behind another thread,
 * released or freed at the turn end), push (commit declared by the agent with `pushed_commits`, CI follow-up on or
 * off), ci (final CI verdict of a followed commit), merge (a trusted human merged the issue's PR from the thread),
 * refused (the hub turned down a tool frame of the agent: `frame` = its type, `code` = the error it got), relay (`agent`
 * woken by a mention in the final message of agent `by`, protocol/relay.ts).
 */
export type ThreadEvent =
  | { at: number; kind: 'turn'; agent: string; phase: 'start' | 'end'; stopped?: boolean }
  | { at: number; kind: 'outcome'; agent: string; outcome: 'done' | 'waiting'; action?: string }
  | { at: number; kind: 'resource'; resource: string; op: 'acquired' | 'queued' | 'released' }
  | { at: number; kind: 'push'; agent: string; repo: string; sha: string; branch?: string }
  | { at: number; kind: 'ci'; repo: string; sha: string; verdict: CiVerdict }
  | { at: number; kind: 'merge'; by: string; repo: string; number: number; sha: string }
  | { at: number; kind: 'refused'; agent: string; frame: string; code: string }
  | { at: number; kind: 'relay'; agent: string; by: string };
/** A file attached to one of the thread's messages (`msg`, author `by`, message date `at`). */
export interface DetailsFile extends FileRef { msg: string; by: string; at: number }
/** opened: date of the first message and, for a thread opened from a card, its originating conversation. more: older
 *  events or files left out (DETAILS_MAX_EVENTS / DETAILS_MAX_FILES newest kept). */
// followed: pushed repos whose pull request is read on GitHub (attached ones; a `details.prs` follows); the others
// (any `owner/name` an agent declared) are listed without a PR line. Absent from an older hub: all are looked up.
export interface ThreadDetails { thread: string; opened: { at: number; from?: { id: string; title: string } } | null; files: DetailsFile[];
  events: ThreadEvent[]; more: boolean; followed?: string[] }
/** Pull request of a pushed head, read on GitHub when the panel opens (title cut at 200, link only on github.com). */
export interface PrState { repo: string; number: number; title: string; url: string; state: 'open' | 'closed' | 'merged'; draft: boolean; branch?: string }
export interface PrError { repo: string; code: 'not_installed' | 'no_permission' | 'failed' }
export const DETAILS_MAX_EVENTS = 300, DETAILS_MAX_FILES = 100;
/** GitHub login (agent identity of the board): letters, digits, single hyphens, 39 characters at most. */
export const GH_LOGIN_RE = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/;
export const MAX_IDENTITIES = 20;
/**
 * How an agent works on several threads of the space (admin setting).
 * strict = one thread at a time, imposed by the hub (`max` is always 1). cooperative = up to `max` threads at once
 * (one worktree per thread on the agent side). In both modes, `resources` are the shared resources (stack, emulator,
 * gateway) an agent must take with its `acquire_resource` tool right before using one: one thread at a time per
 * resource, the others wait in a queue. Cooperative: nothing technically prevents an agent from using a resource
 * without acquiring it (assumed). Missing on old spaces = DEFAULT_PARALLEL.
 */
/** `rules`: usage rule per resource (keys among `resources`); missing on resources saved before rules existed. */
export interface Parallel { mode: 'strict' | 'cooperative'; max: number; resources: string[]; rules?: Record<string, string> }
export const DEFAULT_PARALLEL: Parallel = { mode: 'strict', max: 1, resources: [] };
/**
 * Allowed reactions: fixed list (no full picker, no dependency), 9 × 6 grid in the client,
 * ordered by use. The hub refuses anything else. The first 8 are the former list: never remove them
 * (reactions already posted would no longer show).
 */
export const REACTIONS = [
  '✅', '👀', '🙌', '👍', '❤️', '😂', '🎉', '🤔', '👎', // agreement, seen, kudos
  '🙏', '💯', '🔥', '🚀', '👏', '💪', '😍', '😅', '😬', // enthusiasm, awkwardness
  '🙂', '😉', '😎', '🤯', '😱', '😢', '😡', '🥲', '😴', // mood
  '⏳', '🚧', '🐛', '🔧', '✨', '💡', '📌', '🔒', '⚠️', // work in progress, bug, idea, security
  '❌', '❓', '❗', '⭐', '✏️', '📝', '📎', '🔗', '🧪', // refusal, question, to review, test
  '🤝', '👌', '🤞', '🤷', '🙈', '🍾', '☕', '🍕', '🎯', // team, chill
] as const;

/** Draft of a space description (`about`) proposed by the agent in charge; see Message.about. */
// `applied`: an admin saved the space's brief from this card (`space.save` with `aboutCard`, and the brief changed).
export interface AboutDraft { text: string; base: string; by: string; why?: string; applied?: { by: string; at: number } }

/** Attachment (stored in S3, private; read through short-lived presigned URLs). */
export interface FileRef { id: string; name: string; mime: string; size: number }

export type ThreadState = 'you' | 'run' | 'wait' | 'calm' | 'idea' | 'done';
export const THREAD_STATES: readonly ThreadState[] = ['you', 'run', 'wait', 'calm', 'idea', 'done'];

/**
 * GitHub card (Message.type 'github', author system `github`): the issue body, a comment or a linked PR, copied by
 * the poller in a board-driven space. Read-only, never sent back to GitHub. `held`: written by an outsider while the
 * issue waits for a member's go (vetting): folded for humans, never given to an agent. `agent`: board agent that
 * wrote it (`<!-- uns:agent=x -->` marker). `cut`: body cut at GH_CARD_MAX (the link has the rest).
 */
export interface GhCard { kind: 'issue' | 'comment' | 'pr'; login: string; url: string; agent?: string; held?: boolean; cut?: boolean;
  state?: string; title?: string } // pr: OPEN / CLOSED / MERGED and its title
export const GH_CARD_MAX = 8000;
/** GitHub label name: 1-50 characters (GitHub's limit), no control character. Compared case-insensitively, like GitHub. */
export const MAX_LABEL = 50;
/** Set and lifted by unstrikeable only (a member's comment is the go): never editable from briefling. */
export const VETTING_LABEL = 'needs:vetting';
export const validLabel = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= MAX_LABEL && x === x.trim() && !/[\u0000-\u001f\u007f]/.test(x);
/** Label of the issue's repo, offered by the picker of an issue thread (`labels` reply). color: 6 hex digits, no #. */
export interface RepoLabel { name: string; color: string; description: string }
/**
 * Merge button of an issue thread (board-driven space): shown while the issue is OPEN in the flow's `approved` column
 * (humans merge): the flow config's column (`synced.mergeColumn`), MERGE_COLUMN when the space has no flow config. The GitHub Lambda reads the issue's open linked PRs and the PR itself
 * (`merge.get`); the button exists only with exactly one open PR in an attached repo. `pr.sha` = head commit read: the
 * merge is sent with it, so a commit pushed after the look is refused. `blocked` null = mergeable (squash):
 * conflict (unstrikeable sends it back to the dev), checks (CI not green: red or still running), blocked (branch
 * protection), behind (protection wants it up to date), draft, base (does not target the default branch), unknown
 * (GitHub still computing after a re-read), merged / closed (no longer open).
 */
export const MERGE_COLUMN = 'To merge';
export type MergeBlock = 'conflict' | 'checks' | 'blocked' | 'behind' | 'draft' | 'base' | 'unknown' | 'merged' | 'closed';
export interface MergeInfo { pr: { repo: string; number: number; title: string; url: string; sha: string } | null; prs: number; blocked: MergeBlock | null }
/**
 * "Create this issue?" card (Message.type 'issue', author system `briefling`), posted in a Lounge topic or a thread of a
 * board-driven space when the agent `by` calls `propose_issue`. Nothing is written to GitHub until a trusted human clicks
 * Create the issue (`approver`): the GitHub Lambda then creates it with the briefling App (no label), adds it to the
 * Project, opens its thread `repo#N` (body as the first GitHub card) and links the card to it (`thread`, `number`,
 * `url`). status: open -> pending (clicked) -> done | failed; open -> dismissed (Not now). failed: `error` says why, no
 * automatic retry; a human may retry only while no issue was created (`number` unset). One open card per conversation
 * (open, pending, or failed without an issue), shared with "Make it a thread?"; open -> superseded when the same agent
 * proposes a new card in the conversation.
 */
export interface NewIssue { repo: string; title: string; body: string; by: string; status: 'open' | 'pending' | 'done' | 'failed' | 'dismissed' | 'superseded';
  dismissed?: Dismissal; superseded?: Supersession; approver?: string; claimed?: boolean; thread?: string; number?: number; url?: string; error?: NewIssueError }
/** not_installed: no briefling App on the organization; github: GitHub refused or failed; refused: the gate no longer
 *  holds (repo detached, approver no longer trusted); thread: issue created but its thread could not be opened (the
 *  poller opens it); project: status done, but the issue could not be added to the Project. */
/** Who clicked Not now on a card (thread, issue, plan) and when (hub time): the agent that proposed it is told on its
 *  next turn, as a context line (it is never woken for it). Absent on cards dismissed before it was recorded. */
export interface Dismissal { by: string; at: number }
/** A card (thread, issue, plan) still open when the same agent proposed a new one in the conversation: the new card
 *  (`card`, its message id) replaces it at `at` (hub time). Only from status open; read-only afterwards, like dismissed. */
export interface Supersession { card: string; at: number }
export type NewIssueError = 'not_installed' | 'github' | 'refused' | 'thread' | 'project';
/** GitHub limits the title to 256 characters; the body is kept well under GitHub's 65 536 (it is shown on the card). */
export const NEW_ISSUE_TITLE_MAX = 256, NEW_ISSUE_BODY_MAX = 20_000;

/**
 * Temporary AWS elevation card (`request_elevation` tool, elevation/CONTRACT.md): an agent asks for the `AgentElevated`
 * permission set on one AWS account for a few minutes. The approval is NOT done in briefling: agents are Admin on the
 * briefling account, so its PWA could be altered. The owner approves with a passkey on the approval page of the
 * management account (briefling never knows its URL); the card only creates the request, reads its state (« Check »)
 * and revokes. `nonce` = the request id in the elevation Lambda, `requestExpires` = ms epoch; `grant`/`expiresAt` once
 * granted.
 */
export interface Elevation { agent: string; account: string; minutes: number; reason: string; by: string;
  status: 'open' | 'granted' | 'dismissed' | 'revoked'; nonce: string; requestExpires: number;
  checker?: string; grant?: string; expiresAt?: number; error?: ElevationError; dismissed?: Dismissal; revoked?: { by: string; at: number } }
/** Last « Check » that found no grant: not approved yet, request expired, IdC failed, or the Lambda unreachable. */
export type ElevationError = 'not_approved' | 'expired' | 'failed' | 'unavailable';
export const ELEVATION_ERRORS: readonly ElevationError[] = ['not_approved', 'expired', 'failed', 'unavailable'];
export const ELEVATION_MINUTES_MIN = 5, ELEVATION_MINUTES_MAX = 60, ELEVATION_REASON_MAX = 300;
export const ELEVATION_ACCOUNT_RE = /^\d{12}$/;
export const ELEVATION_ROLE = 'AgentElevated';

/**
 * "Launch this plan?" card (Message.type 'plan', author system `briefling`), posted in a Lounge topic or a thread when
 * the agent `by` calls `propose_plan`: N steps run in order, one click of a trusted human (`approver`) approves them all.
 * Two drivers, picked by the space:
 * - briefling (no `repo`): open -> running (step 0's thread opened at once, `current` = the step being worked on). When
 *   the agent ends the current step's thread `done` (or a trusted human clicks Done on its wait), the hub opens the next
 *   step's thread, attributed to the approver (trust re-checked then). A `waiting` outcome or a Release does not finish
 *   the step: the plan waits until the thread really ends. running -> done (last step finished) | stopped (Stop, a
 *   trusted human: the running step goes on, no next one opens) | failed (`refused`: the approver or the agent left).
 * - external board (`repo`, board-driven space): open -> pending (clicked) -> done | failed. The GitHub Lambda creates
 *   the N issues in that attached repo, adds them to the Project, opens their threads, then makes each issue blocked by
 *   the previous one (GitHub issue dependencies); the board's flow skips blocked items, so they run in order. Each
 *   created issue is recorded on its step at once (`number`): a retry (by hand, after `failed`) only does what is left.
 * open -> dismissed (Not now). One open card per conversation (open, pending, failed), shared with the other cards;
 * open -> superseded when the same agent proposes a new card there.
 */
export interface PlanStep { title: string; brief: string; thread?: string; number?: number; url?: string; node?: string; linked?: boolean }
export type PlanStatus = 'open' | 'running' | 'pending' | 'done' | 'stopped' | 'failed' | 'dismissed' | 'superseded';
/** refused: the gate no longer holds (approver no longer trusted, agent removed, repo detached); not_installed: no
 *  briefling App on the organization; github: GitHub refused or failed; thread: a step's thread could not be opened. */
export type PlanError = 'refused' | 'not_installed' | 'github' | 'thread';
export interface Plan { title: string; why?: string; context?: string; steps: PlanStep[]; by: string; status: PlanStatus; repo?: string; dismissed?: Dismissal; superseded?: Supersession;
  approver?: string; current?: number; claimed?: boolean; stoppedBy?: string; error?: PlanError }
/** Step cap of a plan (a longer job is split in several plans) and size of each step. */
export const PLAN_STEPS_MAX = 10, PLAN_TITLE_MAX = 120, PLAN_STEP_TITLE_MAX = 120;
/** Thread opened for a step of a plan (briefling driver): the card (`card` in conversation `parent`), its index, the count. */
export interface PlanLink { parent: string; card: string; step: number; of: number }

/**
 * Issue behind a thread of a board-driven space, kept by the poller. column = Project status, state = OPEN / CLOSED,
 * vetting = waiting for a member's go on GitHub (outsider content, or `needs:vetting`). sig: fingerprint of the last
 * processed version (cards re-read only when it moves); body: id of the issue body card. labelColors: colour of each
 * label (same order as `labels`, 6 lowercase hex digits, '' = none), absent when none has one; additive (no bump).
 */
export interface IssueBoard { node: string; column: string | null; labels: string[]; labelColors?: string[]; state: 'OPEN' | 'CLOSED'; vetting: boolean; sig: string; body?: string }
/** Issue context given to the agent on every turn of an issue thread (data from GitHub, never instructions). */
export interface IssueContext { ref: string; url: string; title: string; state: string; column: string | null; labels: string[]; vetting: boolean;
  body: string; comments: { who: string; at: number; text: string }[] }

/** Payload of the hub's « plugin updated » notice: the instance's agents in that space moved from `from` to `to`. */
export interface PluginNotice { from: string; to: string; agents: string[] }

export interface Message {
  id: string;
  thread: string;
  author: { kind: 'human' | 'agent' | 'system'; id: string };
  type: 'text' | 'ask' | 'answer' | 'propose' | 'about' | 'github' | 'issue' | 'plan' | 'elevation' | 'applet' | 'reminder';
  text: string;
  ask?: { id: string; options: string[]; items?: AskItem[] }; // items: « To decide » card (`ask.choices`)
  // "Make it a thread?" card posted in a Lounge topic at the agent's request (`by`, `why`: its reason;
  // `brief`: what it will do, shown on the card then posted as the thread's first message, signed by the agent).
  // `space`: proposed for ANOTHER space (`thread.propose.space`): opening it creates a topic in that space's Lounge
  // (`thread` = that topic, in `space`), never a thread, and nothing is added to this conversation's family.
  // `topic` (with `space` = this space, from `thread.propose.topic`): « Make it a topic? », same path for a new topic of
  // this space's Lounge (brief + link back, no history, no family link).
  // `context` (MAX_CONTEXT): the agent's summary of the conversation, folded under the brief, sent at the kickoff instead
  // of the topic's messages (cards without it: the whole topic, as before). Never on a card for another space.
  propose?: { title: string; status: 'open' | 'done' | 'dismissed' | 'superseded'; thread?: string; by?: string; why?: string; brief?: string; context?: string; dismissed?: Dismissal;
    superseded?: Supersession; space?: string; topic?: true };
  // "Space description draft" card posted in a Lounge topic by the agent in charge (`propose_space_about` tool):
  // `text` = proposed `about`, `base` = the space's `about` when it was proposed (the client shows the diff), `by` = agent.
  // A draft only: the admin applies it to the Settings form, reviews and saves; it is never written to the space.
  about?: AboutDraft;
  // Applet card (`applet.propose`, docs/design-applets.md): an agent's applet draft; a lead saves it (`applet.accept`).
  applet?: AppletCard;
  // Reminder card (`reminder.propose`, protocol/reminders.ts): an agent's reminder draft; a member adds it (`reminder.accept`).
  reminder?: ReminderCard;
  // System line « Stopped by <by> » posted by the hub when a turn ends on a stop (`turn.stop`): `by` = the trusted
  // human who asked (missing if the hub has no record of it); `acted` = the agent had called at least one tool in that
  // turn (what it did stays done). The client renders it translated; `text` is the English fallback.
  stop?: { by?: string; acted: boolean };
  // A lead tapped « Voice » with no voice line on (`post` with `voice`): delivered to the agent in charge, whose plugin
  // turns it into « open your voice channel » (voice_open). The client renders it translated; `text` is the English fallback.
  voiceAsk?: true;
  // System line « <by> shared <name> with <agent> » (« Secret » button, protocol/secret.ts): never the value. The
  // client renders it translated with its status; `text` is the English fallback.
  secret?: SecretLine;
  // Line « <agent> shares a preview: <label> (port <port>) » posted by the hub on the agent's `preview.share`
  // (protocol/preview.ts); trusted humans get an « Open preview » button while it is on. `text` is the English fallback.
  preview?: PreviewLine;
  // Agent message flagged by its plugin as a gateway notice (Hermes status line, not the agent's words): small grey line.
  notice?: true;
  // Hub notice « plugin updated » (with `notice`): the client merges neighbouring ones to the same `to` into one line.
  // `agents` are agent ids; `text` stays the English fallback for older clients.
  plugin?: PluginNotice;
  // The agents-relay limit notice (hub/src/relay.ts, with `notice`): the cap that was reached. The client renders it
  // translated; `text` is the English fallback.
  relayCap?: number;
  // Hub time of the author's last edit (`message.edit`, human text messages only): the client shows « (edited) ».
  // Delivered to the agent too, so the plugin tells it the message replaces its earlier version.
  edited?: number;
  // Deleted by its author (`message.delete`): the item stays (id, author, time, reactions, links), its text is emptied and
  // its attachments removed (S3 objects included); `at` = hub time, `by` = the author. The client shows « Message deleted ».
  deleted?: { at: number; by: string };
  // General message: the topic opened from it (« Reply as topic » or an agent mention), shown as a link under it.
  subtopic?: string;
  // First message of a topic opened from a card of another space (cross-space `thread.propose`): the conversation it
  // came from, shown as a link (only members of that space can open it). Nothing else of it is copied.
  origin?: { space: string; thread: string };
  gh?: GhCard; // type 'github'
  newIssue?: NewIssue; // type 'issue': "Create this issue?" card (`propose_issue` tool)
  plan?: Plan; // type 'plan': "Launch this plan?" card (`propose_plan` tool)
  elevation?: Elevation; // type 'elevation': AWS elevation request card (`request_elevation` tool)
  // CI line (type 'text', author system `ci`): rendered by the client; `text` is an English fallback without any
  // CI-written name (it reaches the summary model).
  ci?: CiReport;
  files?: FileRef[];
  at: number;
  rev?: number;
}

export interface Thread {
  id: string;
  space: string;
  title: string;
  owner: string; // agent in charge
  // topic = a ☕ Lounge conversation: the agent only speaks when mentioned, never in "Now".
  kind?: 'thread' | 'topic';
  from?: string;      // thread: originating topic; topic: General, when opened from one of its messages
  fromMsg?: string;   // topic opened from General: the General message it started from
  general?: boolean;  // the space's General room (`generalId`): flat, pinned at the top of the Lounge
  // General: its latest human message (author, text cut like a topic's first message, time), previewed on its Lounge row.
  last?: { author: string; text: string; at: number };
  // topic: who started it and its first message (cut at TOPIC_TEXT_MAX, "…" if cut), shown in the Lounge list.
  // Missing on old topics: the client falls back to `title`.
  author?: string;
  text?: string;
  // topic opened by an agent on its own (`topic.open`, e.g. from a cron): `author` is that agent's id, not a human's.
  authorAgent?: true;
  // topic: short title (cleanHeading), written once by the agent in charge from the first message of a lead's topic
  // (`topic.title`), or set / cleared by a lead (action `rename`). Missing = the Lounge list shows `text`. Writing it
  // never moves `updatedAt` (not activity: no reorder, no unread).
  heading?: { text: string; by: { kind: 'agent' | 'human'; id: string }; at: number };
  // topic or thread: 1-2 tags of the space's memory vocabulary (protocol/tags.ts), given by the agent in charge with
  // `topic.title` / `thread.outcome`, corrected by a lead (`tags.set`). Not activity (never moves `updatedAt`).
  tags?: ThreadTags;
  // Hidden conversation where the agent in charge titles that topic (hub only, never public; also `memoryReview`).
  titleFor?: string;
  spawned?: string[]; // topic: threads opened from it; thread: threads opened from that thread (the topic's family goes FAMILY_DEPTH deep)
  plan?: PlanLink; // thread opened for a step of a plan (briefling driver)
  issue?: { repo: string; number: number; url: string }; // GitHub issue created from this thread
  issuePending?: boolean; // creation in progress (anti-duplicate reservation)
  board?: IssueBoard; // board-driven space: the issue's state on the board (poller)
  opener?: string; // thread opened from a Lounge card: the trusted human who opened it (hub only, never public)
  // topic opened by a run of a routine (Settings › Routines): the routine and the admin the run is attributed to (hub only).
  routine?: { id: string; by: string; radar?: true }; // radar: the run is a Radar pass (protocol/radar.ts)
  // thread opened by a run of an applet (Applets menu): the applet, the lead who launched it, the run's first message
  // (delivered wrapped in appletPrompt) and the instruction frozen at launch (hub only). `turn_outcome done` archives it.
  // « threads » module off: the run is a Lounge topic instead (never archived on its own).
  applet?: { id: string; name: string; by: string; msg: string; instruction: string };
  // Lounge topic « Discuss the result » of an applet's run (`applet.talk`, id talkId(run)): a message without a mention
  // goes to the applet's agent (its owner), whose first turn there gets the run's values and result (hub only).
  appletTalk?: { applet: string; run: string };
  radar?: string;   // thread opened from a Radar signal: its id (hub only)
  // thread opened from a line « Next » of another thread's summary (`next.open`, hub/src/nextsteps.ts): its origin, for
  // the go delivered at a late kickoff (hub only).
  nextOf?: string;
  // The lines « Next » of this thread's summary a lead opened as threads (`next.open`): the line's text and the thread,
  // oldest first (NEXT_OPENED_MAX). Keyed by the text: a later summary that keeps the line keeps its link.
  nextOpened?: NextOpened[];
  // Pending leads of the space recalled at this conversation's start (protocol/leads.ts): its agent mentioned them, the
  // client shows them under its reply, each with its decision once taken (`decided`, `thread`).
  leadsRecalled?: LeadRecalled[];
  radarN?: number;  // Radar pass: signals written so far (RADAR_SIGNALS_PER_PASS, hub only)
  radarKeys?: string[]; // managed pass: keys of the items the hub read for the bug and security detectors (hub only)
  // Hidden Radar run of Settings › Radar (also `memoryReview`): the profile pass (radar_profile) or a managed pass (hub only).
  radarRun?: RadarRunKind;
  // Hidden summary run of the Exchanges (also `memoryReview`): the exchanges it may read and write, and for « Propose
  // to memory » the one mail (hub only, protocol/exchanges.ts).
  exRun?: { ids: string[]; mail?: string; proposed?: true };
  // A lead's turn imported mails (mail.import): that lead, so its end hands the exchanges to the summary agent (hub only).
  exSync?: string;
  // thread or topic opened from a request of a mail exchange, or a thread opened from such a topic (hub only, never public)
  exchange?: { id: string; req: string };
  // Humans concerned (protocol/notify.ts): the card's opener, then everyone who wrote, in order of arrival. Your turn
  // and new-message notifications go to them. Missing = older conversation, rebuilt from its messages on the next post.
  people?: string[];
  // Contributors a lead invited into this work thread (action `invite`): their plain-text messages wake the agent here
  // like in a Lounge topic (`wakes`); still no card answer nor `/command`. Only counts while they stay contributors.
  // Missing = nobody. Not `people` (a post adds its author there, so every thread would open itself).
  invited?: string[];
  // Archived for the whole space (trusted human, `by`): hidden from lists, Now and the Lounge badge,
  // visible in "Archived". Reversible; a message from a trusted human brings it back.
  archived?: { by: string; at: number };
  // LLM spend of the agent in this thread, summed by the hub from `turn.ended.usage`. Missing = nothing counted yet
  // (threads older than the feature included). Visible to every member of the space.
  usage?: Usage;
  // Flow: the part of `usage` spent by board-task turns (`origin: flow`); the rest is discussion. Missing = none.
  taskUsage?: Usage;
  // A trusted human asked to stop the running turn (`turn.stop`, `by`, hub time `at`): the client shows « stop
  // requested » until the agent confirms with its turn end, which clears it (a new turn start does too).
  stopping?: { by: string; at: number };
  // CI follow-up: latest state per repo of the commits the agent declared (see CiVerdict). Missing = never followed.
  ci?: CiPill[];
  // Background work the agent declared (sub-agents, processes it gets notified of), see Background. Missing = none.
  background?: Background;
  // Hidden system conversation: the space's memory agent reviews proposals (agent mode), or the agent in charge titles
  // a new topic (`titleFor`). Never listed (no index row), never Your turn (a topic), no push nor summary, clients drop it.
  memoryReview?: boolean;
  state: ThreadState;
  facts: ThreadFacts;
  updatedAt: number;
}

/**
 * LLM spend, as estimated by Hermes' pricing (never an invoice). `usd` only sums the calls that could be priced.
 * status: actual = billed amount reported by the provider; estimated = list price; included = subscription (0 $);
 * unknown = some calls could not be priced (`usd` is a lower bound). Merged by `mergeCostStatus`.
 */
export type CostStatus = 'actual' | 'included' | 'estimated' | 'unknown';
export const COST_STATUSES: readonly CostStatus[] = ['actual', 'included', 'estimated', 'unknown'];
/**
 * What an LLM call was for, classified by the plugin from the tools the model decided in that call (the command never
 * leaves the instance): answer = no tool (writing the reply) or a briefling tool; read = file/web/skill reads and
 * read-only shell; code = file edits; test / deploy / git = shell commands; coordination = locks, board, project memory,
 * background processes, task lists, skills, the call that starts sub-agents; review = every
 * call of Hermes' background self-improvement review; compress = context compression; other = the rest (Hermes' own
 * titles, vision, approvals included). Deferred tools count as the tool they call, `execute_code` by its code (the shell
 * rules, writing a file = code), a sub-agent's calls by what they do. One category per call, the most specific action wins.
 */
export type Activity = 'answer' | 'read' | 'code' | 'test' | 'deploy' | 'git' | 'coordination' | 'review' | 'compress' | 'other';
export const ACTIVITIES: readonly Activity[] = ['answer', 'read', 'code', 'test', 'deploy', 'git', 'coordination', 'review', 'compress',
  'other'];
/** Categories dropped since, still in stored turns and sent by older plugins: read as their successor, the base is never
 *  rewritten (`delegate` = sub-agents, until plugin 0.3.28: read as other, since what they did is unknown). */
const RETIRED_ACTIVITIES: Record<string, Activity> = { delegate: 'other' };
/** The activity of a stored or received key: itself, its successor when retired, null when unknown. */
export const activityOf = (k: string): Activity | null =>
  ACTIVITIES.includes(k as Activity) ? k as Activity : Object.hasOwn(RETIRED_ACTIVITIES, k) ? RETIRED_ACTIVITIES[k] : null;
/** A split with its retired keys folded into their successor (sums kept). */
export function foldActivity<V extends ActivitySpend>(x: Partial<Record<string, V>>): Partial<Record<Activity, ActivitySpend>> {
  const out: Partial<Record<Activity, ActivitySpend>> = {};
  for (const [k, v] of Object.entries(x)) {
    const a = v && activityOf(k);
    if (!a || !v) continue;
    const c = out[a];
    out[a] = c ? { usd: Math.round((c.usd + v.usd) * 1e6) / 1e6, calls: c.calls + v.calls } : { usd: v.usd, calls: v.calls };
  }
  return out;
}
export interface ActivitySpend { usd: number; calls: number }
// activity: split of `usd`/`calls` by Activity, sent since plugin 0.3.22; missing on older turns (their spend is « not split »).
export interface Usage { usd: number; input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number; calls: number; status: CostStatus; activity?: Partial<Record<Activity, ActivitySpend>> }
/** Least reliable status wins (order of COST_STATUSES): one unpriced call makes the total a lower bound. */
export const mergeCostStatus = (a: CostStatus, b: CostStatus): CostStatus => COST_STATUSES.indexOf(a) >= COST_STATUSES.indexOf(b) ? a : b;

/**
 * Metrics of a space (Metrics view), computed by the hub on each `metrics.get` from the threads and their messages.
 * Threads, topics, initiators, agents in charge and cost cover the items CREATED in the period (`usage` is a running
 * total per thread: the cost of an older thread that spent during the period is not in it); messages are counted by
 * their own date. Cost only counts since the plugin sends `turn.ended.usage` (no backfill): `costed` of `items` have one.
 * Initiator: `author` of a topic; for a thread its `opener` (the human who opened the card), else, on older threads,
 * the trusted human whose request led to the card, or the author of the first human message (thread posted directly);
 * '' = unknown. `partial`: the space had more than METRICS_MAX_THREADS active threads, the oldest were left out.
 * `days`: messages per calendar day in the time zone of the request (`metrics.get.tz`, UTC when missing or unknown),
 * from the first day with a message in the period to today, empty days included, at most METRICS_MAX_DAYS (the latest).
 * `cost.median` / `cost.top`: over the threads (not topics) created in the period that have a cost; top = most expensive.
 */
export type MetricsPeriod = '7d' | '30d' | 'all';
export const METRICS_PERIODS: readonly MetricsPeriod[] = ['7d', '30d', 'all'];
export type MetricsBucket = ThreadState | 'archived';
export interface MetricsCount { id: string; n: number }
export interface MetricsDay { day: string; human: number; agent: number } // day: YYYY-MM-DD
export interface MetricsCostly { id: string; title: string; usd: number }
/**
 * Where the spend went (« Where the tokens go »): topics count whole as `discussion` (Lounge talk), threads by the
 * Activity of each call; `unsplit` = thread spend from turns ended before the plugin sent `usage.activity`.
 */
export type CostBucket = Activity | 'discussion' | 'unsplit';
export type MetricsSplit = Partial<Record<CostBucket, ActivitySpend>>;
/** Where the spend of one thread or topic went: a topic is Lounge talk as a whole; a thread is split by the activity
 *  of each call, and what its older turns spent without a split stays `unsplit` (a rounding drift with no call is not
 *  a spend). The Metrics view and the info pane (which passes a topic as a thread, to see its activities) share it. */
export function costSplit(f: { kind?: PublicThread['kind']; usage?: Usage }): MetricsSplit {
  const u = f.usage;
  if (!u) return {};
  if (f.kind === 'topic') return { discussion: { usd: u.usd, calls: u.calls } };
  const out: MetricsSplit = foldActivity(u.activity ?? {});
  let usd = u.usd, calls = u.calls;
  for (const a of Object.values(u.activity ?? {})) { usd -= a.usd; calls -= a.calls; }
  usd = Math.round(usd * 1e6) / 1e6;
  if (calls > 0) out.unsplit = { usd: Math.max(0, usd), calls: Math.max(0, calls) };
  return out;
}
export interface SpaceMetrics {
  period: MetricsPeriod;
  since: number | null; // start of the period (hub clock), null = everything
  at: number;           // computed at
  threads: Partial<Record<MetricsBucket, number>>; // by current state; done includes Quiet with a `done` outcome (Closed)
  topics: { open: number; archived: number };
  openers: MetricsCount[];      // threads per initiator (humans)
  topicAuthors: MetricsCount[]; // topics per author
  owners: MetricsCount[];       // threads per agent in charge
  messages: (MetricsCount & { kind: 'human' | 'agent' })[]; // messages written in the period, system cards excluded
  // hidden: spend of the hub's hidden turns (Radar runs, memory review, titling), per origin, by UTC day (counted in
  // total and byAgent; missing from an older hub).
  cost: { total: Usage | null; byAgent: (MetricsCount & { usage: Usage; split: MetricsSplit })[]; costed: number; items: number; median: number | null; top: MetricsCostly[]; split: MetricsSplit; hidden?: { origin: HiddenOrigin; usage: Usage }[] };
  days: MetricsDay[];
  partial?: boolean;
  // Radar (signals first seen in the period, by type and how the team sorted them; passes started in it and their
  // spend). Missing when the space has neither (or from an older hub).
  radar?: RadarMetrics;
}
export interface RadarMetrics { kinds: { kind: SignalType; n: number; thread: number; topic?: number; dismissed: number }[]; passes: number; usd: number; signals: number }
/** Where a hidden turn's spend comes from (no index row: counted apart, `SPACE#<s>` / `HIDDENCOST#<day>#<origin>#<agent>`). */
export const HIDDEN_ORIGINS = ['radar', 'memory', 'title', 'mail'] as const;
export type HiddenOrigin = typeof HIDDEN_ORIGINS[number];
export interface HiddenUsage { space: string; day: string; origin: HiddenOrigin; agent: string; usage: Usage; version: number }
export const METRICS_MAX_THREADS = 2000;
export const METRICS_MAX_DAYS = 366;
export const METRICS_TOP = 5;

/**
 * Flow view of a space (`lineage.get`): who started which topic and thread, what each one opened, computed on demand
 * from the threads and their messages (no stored aggregate). Nodes: Lounge topics (roots), threads (`parent` = the
 * topic or thread they were opened from) and propose cards still open (`parent` = the conversation holding them).
 * `who`: initiator (topic author; thread opener, same fallbacks as the metrics; card: the proposing agent), '' unknown.
 * `segs` (threads only), deduced from the messages, never recorded: work (1) = from a human message (or the first
 * agent message) to the last agent message before the next human message (agent message times are their FIRST
 * chunk: a turn's tail after its last message start is not seen); discussion (0) = from there to the next human
 * message when it comes within LINEAGE_IDLE_MS; longer gaps = nothing happens. A thread In progress has its last
 * work stretched to `at`. `context`: ancestor outside the period, sent so the lineage stays whole (no activity read).
 */
export type LineagePeriod = '3d' | '7d' | '30d';
export const LINEAGE_PERIODS: readonly LineagePeriod[] = ['3d', '7d', '30d'];
export const LINEAGE_MAX_THREADS = 500;   // most recently active threads read per call; `partial` beyond
export const LINEAGE_MAX_SEGMENTS = 120;  // latest segments kept per thread
export const LINEAGE_IDLE_MS = 2 * 3_600_000;
export type LineageSeg = [start: number, end: number, work: 0 | 1];
export interface LineageNode {
  id: string;                 // thread or topic id; card: `card:<message id>`
  kind: 'topic' | 'thread' | 'card';
  title: string;
  parent?: string;
  who: string;
  owner?: string;             // agent in charge (topic, thread)
  state?: MetricsBucket;      // topic, thread
  usd?: number;               // running cost of the conversation, when known
  start: number;              // first message (card: posted at)
  last: number;               // last message
  segs?: LineageSeg[];
  context?: boolean;
}
export interface SpaceLineage { period: LineagePeriod; since: number | null; at: number; nodes: LineageNode[]; partial?: boolean }

/** Public view of a thread. `version` grows on every write: the client keeps the highest. */
// `unseen`: end of a turn not seen yet (see ThreadFacts.unseenReply), sent back in `thread.seen`.
// `outcome`: turn outcome announced by the agent (ThreadFacts.outcome); `at` is sent back in the `handled` action.
// working: the agents in a turn there right now (several agents can be called in a topic, or by a mention in a thread);
// absent = none, or a thread no other agent was called in (its owner works when `state` is run).
// pendingAsk: the question card still open (facts.pendingAsk), so the client knows a « To decide » card was closed.
// pendingApproval: that open card is a command approval (facts.pendingApproval), labelled « To approve » instead of « Your turn ».
export type PublicThread = Omit<Thread, 'facts'> & { version: number; unseen?: number; outcome?: Outcome; working?: string[]; pendingAsk?: string; pendingApproval?: true };

/**
 * Buttons of an exec approval card, as the Hermes plugin sends them (hermes-plugin/briefling/adapter.py _APPROVAL_LABELS)
 * in a plain `ask` frame. An `ask` whose every option is one of them is an approval. An agent could label a question
 * that way: it only changes the badge, the thread stays Your turn either way.
 */
export const APPROVAL_OPTIONS: readonly string[] = ['Approve', 'For this session', 'Always', 'Deny'];
export const isApprovalAsk = (options: readonly string[]) => options.length > 0 && options.every(o => APPROVAL_OPTIONS.includes(o));

/**
 * Turn outcome, announced by the agent (plugin tool, `thread.outcome` frame, never inferred from its text).
 * done = finished; waiting = finished, but the agent waits for an action from the human (`action`, e.g. "/restart the gateway").
 * `at`: hub timestamp of the announcement, guards the "Done" button (like `ask_id`).
 */
export interface Outcome { kind: 'done' | 'waiting'; action?: string; at: number; /** Set by the hub, not the agent: its background work was lost (`action` = their goals). */ lost?: true;
  /** `waiting` only: the agent resumes once the action is done, so « Done » posts a message from the human instead of finishing the thread. */ resume?: true }

/**
 * Background work of a thread (Nov 2026): sub-agents (`delegate_task` in the background) and processes the agent gets
 * notified of (`notify`), declared by the plugin with `thread.background` (full list each time, empty = all ended).
 * The plugin re-sends a non-empty list every BG_BEAT_MS; each frame pushes the deadline (hub record `BGWATCH`, not the
 * thread: a beat rewrites no thread) to hub time + BG_LEASE_MS. A deadline passed with no new frame (container
 * restarted, gateway down) = the work is lost: the 5-min poller clears the list and sets a `waiting` outcome with
 * `lost` (Your turn, Web Push). A Quiet thread with background work shows « In progress (background) ».
 * `since`: when the task started (agent clock, display only).
 */
export interface BgTask { id: string; kind: 'delegate' | 'process'; goal: string; since: number }
export interface Background { tasks: BgTask[] }
export const BG_MAX_TASKS = 10, BG_GOAL_MAX = 200, BG_ID_MAX = 64, BG_BEAT_MS = 5 * 60_000, BG_LEASE_MS = 15 * 60_000;

export interface ThreadFacts {
  turnActive: boolean;
  pendingAsk: string | null; // id of the question waiting for a human answer
  // That open card is a command approval (`isApprovalAsk`): still Your turn, labelled « To approve ». Cleared with pendingAsk.
  pendingApproval?: boolean;
  // End (`at`) of the agent's last turn not yet seen by a trusted human: the thread stays "Your turn".
  // Missing on threads written before this field (= seen). Never set on a Lounge topic.
  unseenReply?: number | null;
  // Last outcome announced by the agent. `waiting` keeps the thread "Your turn" even once seen: only a trusted
  // human clears it (reply in the thread, or "Done" which turns it into `done`). Missing on old threads.
  outcome?: Outcome | null;
  manual: 'idea' | 'done' | null;
  // Resource the thread waits for (`resource.acquire` queued): state Waiting, the end of that turn is not "Your turn".
  // Cleared when the hub grants it (resume), by a trusted human's message, Done, Closed, Idea. Missing = null.
  parked?: string | null;
}

// ---- client -> hub
export type ClientFrame =
  // spaces missing: every space the user is a member of (not archived), listed by the hub in `subscribed.list`.
  | { v: 2; type: 'subscribe'; spaces?: string[] }
  // Admin only (checked by the hub on every frame): all spaces, the account directory and known agents.
  | { v: 2; type: 'admin.spaces' }
  // Creates (version null) or updates a space. Admin only. Reply `space.saved` or `error` (ref = client_id).
  // parallel missing: unchanged (DEFAULT_PARALLEL at creation). strict forces max to 1.
  // agentRoles: function of each agent of the space (validRole, keys among `agents`); missing = unchanged.
  // agentAvatars: only the photos that change (validAvatar, '' = removed; agents missing = unchanged; `bad_avatar`). They
  // are not in SpaceSettings (size: every space of `admin.spaces`): the form shows them from the space's people.
  // driver / identities: missing = unchanged; driver 'board' needs an attached GitHub Project (`no_board` otherwise).
  // repos (REPO_RE, MAX_REPOS, `bad_repo`) / ci / memory / memoryBatch / memoryCompact (protocol/memory.ts bounds):
  // missing = unchanged.
  | { v: 2; type: 'space.save'; client_id: string; space: string; version: number | null; name: string; about: string;
      members: string[]; trusted: string[]; contributors?: string[]; nontech?: string[]; agents: string[]; defaultAgent: string; parallel?: Parallel; agentRoles?: Record<string, string>; agentAvatars?: Record<string, string>;
      driver?: Driver; identities?: string[]; repos?: string[]; ci?: boolean; memory?: MemoryMode; memoryAgent?: string; memoryHidden?: boolean;
      memoryBatch?: MemoryBatch; memoryCompact?: MemoryCompact; tagMax?: number; relayMax?: number; modules?: Module[]; // tagMax, relayMax: validTagMax, validRelayMax, missing = unchanged
      // modules: on, validModules (protocol/modules.ts)
      // the brief draft card the admin applied to this form (« Apply to the brief »): if the save changes the brief, the
      // hub marks that card `about.applied` and broadcasts `message.updated` (a card of another space is ignored)
      aboutCard?: { thread: string; msg: string } }
  | { v: 2; type: 'space.archive'; client_id: string; space: string; version: number; on: boolean }
  // Flow editor (docs/design-flow.md slice 2), admin only: playbooks are prompts. flowcfg.get: the space's history and one
  // version (missing = the latest). Reply `flowcfg`. flowcfg.save: new version `base + 1` (base = the version the editor
  // loaded, 0 = none yet); `stale` if another save got there first, `bad_flow` if protocol/flowcfg.ts validateFlow finds
  // anything. Rollback = save an old version's def again. Reply `flowcfg.saved` or `error` (ref = client_id).
  // team (slice 3, protocol/flowteam.ts): staff, limits, identities, sheets, trusted authors / bots, culture; checked by
  // validateTeam (`bad_team`: agents of the space only) and the whole bundle by bundleIssues (`bad_flow`); missing =
  // the latest version's team. Each saved version is pushed to the flow's agents (`flow.config`).
  // source (protocol/flowteam.ts FlowSource, null = briefling; missing = the latest version's): with a git source the save
  // is a commit made by the GitHub Lambda (reply later: `flowcfg.saved` or `error` `changed_meanwhile` with `detail`);
  // head = the branch head the editor read (`flowcfg.git`), required then. flowcfg.get on a git source also reads the
  // branch head again (reply `flowcfg.git`).
  | { v: 2; type: 'flowcfg.get'; client_id: string; space: string; version?: number }
  // Board page, flow block (docs/design-flow.md § 4.6), any member: each flow agent's live state and the space's latest
  // closed tasks. Reply `flowstate`.
  | { v: 2; type: 'flowstate.get'; client_id: string; space: string }
  // Pause / Resume of a flow agent, trusted humans of a board-driven space: sent to the instances serving it in the
  // space (`flow.pause`); a running turn is not cut. Resume also lifts a quota pause (for the rest of that day). Reply
  // `flowstate.paused`; errors: forbidden, not_board, unreached (no instance of that agent connected).
  | { v: 2; type: 'flowstate.pause'; client_id: string; space: string; agent: string; paused: boolean }
  // The editor picked another git source: read that branch's head (reply `flowcfg.git`), nothing else.
  | { v: 2; type: 'flowcfg.head'; client_id: string; space: string; source: FlowSource }
  | { v: 2; type: 'flowcfg.save'; client_id: string; space: string; base: number; def: FlowDef; team?: FlowTeam; source?: FlowSource | null; head?: string }
  // Switch of a flow agent from unstrikeable to briefling (docs/design-flow.md § 13), global admin only, board-driven
  // space. flowpilot.get: reply `flowpilot.list`. flowpilot.link: one-time code (AGENT_CODE_BYTES, FLOW_SWITCH_TTL_MS,
  // stored hashed, bound to space + agent) returned ONCE in `flowpilot.linked`; a new link replaces a pending one.
  // Errors: forbidden, not_board, not_flow_agent (no role in the space's flow team), already_piloted.
  // flowpilot.back: the agent goes back to unstrikeable (or a pending link is cancelled): the hub forgets the pilot,
  // sends `flow.pilot {piloted: false}` to its instances; reply `flowpilot.list`. Error: not_piloted.
  | { v: 2; type: 'flowpilot.get'; client_id: string; space: string }
  // Settings › Routines (global admin, trusted in the space; protocol/routines.ts). Each reply is `routine.list`.
  // routine.save: `id` absent = creation (ROUTINES_MAX per space), else `version` must match (stale). The agent must
  // serve the space. The hub writes the routine then its EventBridge schedule (error schedule_failed: saved, not
  // scheduled; saving again retries). routine.run: one run now, whatever `active` (same gates as a scheduled run,
  // attributed to the admin who clicks); its result is the routine's `lastRun`. Errors: forbidden, not_trusted, stale,
  // too_many, not_found.
  | { v: 2; type: 'routine.list'; client_id: string; space: string }
  | ({ v: 2; type: 'routine.save'; client_id: string; space: string; id?: string; version?: number } & RoutineDraft)
  | { v: 2; type: 'routine.delete'; client_id: string; space: string; id: string; version: number }
  | { v: 2; type: 'routine.run'; client_id: string; space: string; id: string }
  // Applets menu (protocol/applets.ts, docs/design-applets.md). Leads: list, launch, delete, set who launches
  // (applet.set), save a card (applet.accept). Contributors: list and launch the applets not for leads only (their run
  // thread invites them, so their follow-ups wake the agent). Reply `applet.list`, except applet.run: `ack` (thread =
  // the new thread). applet.accept saves the draft of an applet card (creation, or the update it names: version must
  // match, stale; an update keeps who launches). applet.run: values checked against the schema (bad_value + `detail`
  // = the field), files as for `post`. Errors: forbidden, not_trusted, stale, too_many, not_found, bad_value, agent.
  | { v: 2; type: 'applet.list'; client_id: string; space: string }
  // pinapp.get: where the applet's home-screen app lives (protocol/pinapp.ts, hub/src/pinapp.ts); with `icons` (upload
  // ids of the PIN_SIZES PNGs, in order) the hub publishes or refreshes it. Answer: `pinapp.state`.
  // drawn: what the client managed to draw on each icon (PIN_DRAWN), logged only.
  | { v: 2; type: 'pinapp.get'; client_id: string; space: string; id: string; icons?: string[]; drawn?: string[] }
  // Reminders (module `reminders`, hub/src/reminders.ts): every member of the space; fields checked by protocol/reminders.ts.
  | { v: 2; type: `reminder.${'list' | 'save' | 'done' | 'delete' | 'clear' | 'list_save' | 'list_delete' | 'accept'}`; client_id: string; [k: string]: unknown }
  | { v: 2; type: 'applet.delete'; client_id: string; space: string; id: string; version: number }
  | { v: 2; type: 'applet.accept'; client_id: string; thread: string; msg: string; contributors?: boolean } // new applet: false = leads only
  | { v: 2; type: 'applet.set'; client_id: string; space: string; id: string; version: number; leadsOnly: boolean }
  | { v: 2; type: 'applet.run'; client_id: string; space: string; id: string; version: number; values: Record<string, AppletValue>; files?: Record<string, string> }
  // Results (whoever may launch the applet and see the run's conversation): its runs, newest first (`applet.runs`); one
  // run with its values and the agent's final text (`applet.result`); « Discuss the result » (`applet.talk`): `ack`
  // (thread = the run's Lounge topic, created at the first click, the same after). Errors: not_trusted, not_found.
  | { v: 2; type: 'applet.runs'; client_id: string; space: string; id: string }
  | { v: 2; type: 'applet.result'; client_id: string; space: string; run: string }
  | { v: 2; type: 'applet.talk'; client_id: string; space: string; run: string }
  // Radar view (protocol/radar.ts). radar.list: members, reply `radar.list`. radar.dismiss / radar.open / radar.topic:
  // leads, on a `new` signal at `version` (open: also a `topic` one; stale otherwise); reply `ack` (open: `thread` = the
  // thread opened, its kickoff is the lead's turn; topic: `thread` = the Lounge topic opened, where the agent is woken
  // for its analysis). Every change goes to the space's humans as `radar.updated`. Errors: forbidden, not_found, stale.
  | { v: 2; type: 'radar.list'; client_id: string; space: string }
  // Exchanges view (protocol/exchanges.ts, docs/design-mail-exchanges.md), the space's leads only. exchange.list: reply
  // `exchange.list` (correspondents + rows, no body). exchange.get: reply `exchange.get` (mails oldest first, small
  // bodies inline within EXCHANGE_GET_BODY_BUDGET). exchange.body: one mail's body (reply `exchange.body`: `text`, or a
  // 5-min `url` for a body kept on S3). exchange.close / reopen at `version`; exchange.delete removes the exchange, its
  // mails and their S3 bodies. Changes go to the leads as `exchange.updated` / `exchange.removed`. Errors: forbidden,
  // not_found, stale.
  | { v: 2; type: 'exchange.list'; client_id: string; space: string }
  | { v: 2; type: 'exchange.get'; client_id: string; space: string; id: string }
  | { v: 2; type: 'exchange.body'; client_id: string; space: string; id: string; mail: string }
  | { v: 2; type: 'exchange.close' | 'exchange.reopen' | 'exchange.delete'; client_id: string; space: string; id: string; version: number }
  // Tranche 2. exchange.request at the exchange's `version`: tick (`done`), untick (`open`), remove (`delete`) one
  // request, or open a thread from it (`thread`: owned by the space's default agent, the exchange as its origin; reply
  // `ack` with the thread), or a Lounge topic (`topic`: the request as first message signed by that agent, no agent
  // turn; reply `ack` with the topic). exchange.summarize: a summary run now on this exchange; exchange.remember: a « Propose to
  // memory » run on one mail (reply `ack`, or an error: no_agent, running, unreached, untrusted).
  | { v: 2; type: 'exchange.request'; client_id: string; space: string; id: string; version: number; req: string; op: 'done' | 'open' | 'delete' | 'thread' | 'topic' }
  | { v: 2; type: 'exchange.summarize'; client_id: string; space: string; id: string }
  | { v: 2; type: 'exchange.remember'; client_id: string; space: string; id: string; mail: string }
  // Settings › Correspondents (global admins). correspondent.save creates (no id) or edits at `version`; delete keeps the
  // exchanges. Reply `correspondent.list`; leads get `correspondents.updated`. Errors: forbidden, stale, too_many,
  // bad_frame (an address or a public mail domain such as @gmail.com).
  | { v: 2; type: 'correspondent.list'; client_id: string; space: string }
  | { v: 2; type: 'correspondent.save'; client_id: string; space: string; id?: string; version?: number; name?: string; company: string; role: Correspondent['role']; addrs: string[] }
  | { v: 2; type: 'correspondent.delete'; client_id: string; space: string; id: string; version: number }
  // Settings › Correspondents › summary agent ('' = none) at the config's `version` (0 = never saved). Reply `correspondent.list`.
  | { v: 2; type: 'exchangecfg.save'; client_id: string; space: string; agent: string; lang: 'en' | 'fr'; version: number }
  // Settings › Radar (global admins; writes: a lead of the space too, the passes are their turns). radarcfg.get: reply
  // `radarcfg`. radarcfg.save at `version` (0 = never saved): agent, detectors, rhythm, and `profile` = the admin
  // validates it (as corrected; the proposal is cleared); rhythm off removes nothing, it disables the schedule.
  // radarcfg.run: one hidden run now, `profile` (the agent deduces the profile) or `pass` (a Radar pass); reply
  // `radarcfg` with `run`. Every change also goes out as `radarcfg.updated`. Errors: forbidden, not_trusted, stale,
  // no_profile (rhythm on, or a pass, without a validated profile), schedule_failed. radarcfg.reject at `version`:
  // drops the waiting proposal (a pass's correction is kept as `rejected`, its signals cited); stale without one.
  | { v: 2; type: 'radarcfg.get'; client_id: string; space: string }
  | { v: 2; type: 'radarcfg.reject'; client_id: string; space: string; version: number }
  | { v: 2; type: 'radarcfg.save'; client_id: string; space: string; version: number; agent: string; detectors: RadarDetectors; rhythm: RadarRhythm; profile?: RadarProfile }
  | { v: 2; type: 'radarcfg.run'; client_id: string; space: string; what: RadarRunKind }
  | { v: 2; type: 'radar.dismiss'; client_id: string; space: string; id: string; version: number; reason: string }
  | { v: 2; type: 'radar.open' | 'radar.topic'; client_id: string; space: string; id: string; version: number }
  | { v: 2; type: 'flowpilot.link'; client_id: string; space: string; agent: string }
  | { v: 2; type: 'flowpilot.back'; client_id: string; space: string; agent: string }
  // Admin only: adds the account of this address to the space as a plain member (never trusted). No account yet:
  // Cognito creates it (user name = the address) and mails the invitation. Reply `space.invited` or `error` (ref = client_id).
  | { v: 2; type: 'space.invite'; client_id: string; space: string; email: string }
  // Agents (admin only). agent.invite: an instance already serves `agent` -> added to the space at once (result added /
  // already); otherwise a one-time invitation code (AGENT_CODE_BYTES random, valid AGENT_INVITE_TTL_MS, stored hashed,
  // bound to agent + space) is returned ONCE in `agent.invited.code` (link `<AppUrl>/agent.md?code=<code>`); a new
  // invitation for the same agent + space revokes the previous pending one. Reply `agent.invited` or `error`.
  // renew: a new link for an agent of this space whose invited instance must be replaced (lost secret, new host); its
  // join creates a new client + instance on the same name (history, spaces, trust kept), then deletes the old ones.
  // An agent of the space served by no instance (plugged into another stack) gets a plain link.
  // Refused not_served (not in the space) or static_agent (an infra instance, re-plugged by hand).
  | { v: 2; type: 'agent.invite'; client_id: string; space: string; agent: string; renew?: true }
  // agent.revoke: a pending invitation can no longer be redeemed. Reply `agent.invites` or `error`.
  | { v: 2; type: 'agent.revoke'; client_id: string; space: string; invite: string }
  // agent.remove: the agent leaves the space (its pending invitations there are revoked). An instance created by an
  // invitation that serves no space anymore loses its access at once: Cognito client and INSTANCE# deleted, open
  // connections closed. Refused `last_agent` when it is the space's only agent. Reply `agent.removed` or `error`.
  | { v: 2; type: 'agent.remove'; client_id: string; space: string; agent: string }
  // Only frame accepted on a join connection (`Sec-WebSocket-Protocol: briefling.v2, join.<code>`): redeems the code.
  // Reply `agent.joined` or `error` (invite_used, invite_expired, invite_revoked, agent_exists, forbidden).
  | { v: 2; type: 'agent.join'; client_id: string }
  // Any human: their display name and function (role, validRole; missing = unchanged), in every space they are a member
  // of. avatar: their photo (validAvatar, '' = removed, missing = unchanged; `bad_avatar` otherwise), the same everywhere.
  // Reply `profile.saved` or `error` (ref = client_id).
  | { v: 2; type: 'profile.save'; client_id: string; name: string; role?: string; avatar?: string }
  // Global admin, for a person who never signed in (invitation pending or expired; `forbidden` once they did: their
  // profile is theirs). member.profile: their display name and function, written like profile.save in every space they
  // are a member of (same bad_name / bad_role / name_taken checks). member.reinvite: Cognito mails them a new temporary
  // password, valid again for 7 days. Reply `member.saved` (the person as the directory shows it) or `error`.
  | { v: 2; type: 'member.profile'; client_id: string; person: string; name: string; role?: string }
  | { v: 2; type: 'member.reinvite'; client_id: string; person: string }
  // general: a message in the space's General room (created by its first post); no `thread`, `title` nor `kind` then.
  // voice: the « Voice » button of a conversation with no voice line on (protocol/preview.ts « Voice on request »): a
  // lead asks the agent in charge of an existing thread to open its voice channel. Only with `thread`, no file; the
  // agent must be connected and announce voice (`Presence.voice`), else `no_voice`; a non-lead gets `not_trusted`.
  // The hub stores a message with `voiceAsk` and its own English text (the client's `text` is ignored).
  | { v: 2; type: 'post'; client_id: string; space: string; thread?: string; title?: string; text: string; kind?: 'thread' | 'topic'; files?: string[]; general?: true; voice?: true }
  // upload: asks for an S3 upload authorization (presigned form, size and type enforced); files: read URLs.
  | { v: 2; type: 'upload'; client_id: string; space: string; name: string; mime: string; size: number }
  | { v: 2; type: 'files'; ids: string[] }
  | { v: 2; type: 'answer'; client_id: string; thread: string; ask_id: string; option: string }
  | { v: 2; type: 'action'; thread: string; kind: 'idea' | 'done' | 'reopen' }
  // promote: opens a thread from the `msg` card of a topic, with the whole topic as context; dismiss: "Not now".
  | { v: 2; type: 'action'; thread: string; kind: 'promote'; msg: string; title: string }
  | { v: 2; type: 'action'; thread: string; kind: 'dismiss'; msg: string }
  // create_issue: a trusted human approves the `msg` "Create this issue?" card of that conversation (Message.newIssue);
  // the GitHub Lambda creates it. Also the retry of a failed card that created no issue. `dismiss` closes it too.
  | { v: 2; type: 'action'; thread: string; kind: 'create_issue'; msg: string }
  // plan_start: a trusted human launches the `msg` "Launch this plan?" card (Message.plan): opens step 1 (briefling) or
  // queues the issues' creation (board); also the retry of a failed board plan. plan_stop: stops a running plan (the
  // step in progress goes on, no next one opens). `dismiss` closes an open card.
  | { v: 2; type: 'action'; thread: string; kind: 'plan_start' | 'plan_stop'; msg: string }
  // elevation: a trusted human acts on the `msg` elevation card (Message.elevation). check: asks the elevation Lambda
  // whether the request was approved on the approval page; poll: the same, sent by the app every few seconds while the
  // card is on screen, which changes the card only once the request is settled (no « not approved yet »); renew: a new request (the old one expired); revoke: ends a
  // running grant now; dismiss: Not now on an open card.
  | { v: 2; type: 'action'; thread: string; kind: 'elevation'; msg: string; op: 'check' | 'poll' | 'renew' | 'revoke' | 'dismiss' }
  // issue: creates a GitHub issue from the thread (summary as body), in a repo linked to the space.
  | { v: 2; type: 'action'; thread: string; kind: 'issue'; repo: string }
  // label: adds (on) or removes a label of the issue behind a thread of a board-driven space, written by the briefling
  // App. Trusted humans only, checked again by the GitHub Lambda; `needs:vetting` refused (unstrikeable owns it). Done =
  // `thread.upserted` (board.labels) + a system line naming the human; failure = a system line, never retried.
  | { v: 2; type: 'action'; thread: string; kind: 'label'; label: string; on: boolean }
  // labels.get: the labels of that issue's repo (picker), read from GitHub on demand. Same gate as `label`.
  // Reply `labels` or `error` (ref = client_id).
  | { v: 2; type: 'labels.get'; client_id: string; thread: string }
  // merge.get: can that issue's PR be merged now (MergeInfo, read from GitHub on demand)? Gate: `label`'s + the issue OPEN
  // in MERGE_COLUMN. Reply `merge` or `error` (ref = client_id): not_to_merge, forbidden, not_board, no_issue.
  | { v: 2; type: 'merge.get'; client_id: string; thread: string }
  // details.get: the thread info panel (ThreadDetails). Gate: member of the space. Reply `details`, then `details.prs`
  // when the thread has pushed commits in attached repos (read on GitHub by the GitHub Lambda); `error` (ref = client_id).
  | { v: 2; type: 'details.get'; client_id: string; thread: string }
  // merge: a trusted human merges the PR shown (repo, number, head sha), squash, then its head branch is deleted. Same
  // gate, checked again by the GitHub Lambda with a fresh read; done or refused = a system line naming the human, then a
  // fresh `merge` (same client_id) to this connection, or an `error` (ref = client_id) when there is no fresh state
  // (gate refused, GitHub failed, github_permission). Never retried.
  | { v: 2; type: 'action'; thread: string; kind: 'merge'; client_id: string; repo: string; number: number; sha: string }
  // handled: "Done", the (trusted) human did the expected action (`at` = outcome.at shown); the thread is finished.
  // When the wait says `resume`, the hub posts « Done » (« Fait » with lang 'fr') as the human's message instead: the
  // agent resumes, like after any reply of theirs.
  | { v: 2; type: 'action'; thread: string; kind: 'handled'; at: number; lang?: 'en' | 'fr' }
  // release: "Release", a trusted human takes the hand back from the agent on this thread (`thread` = one holding it,
  // otherwise no effect); the next thread in the queue goes. Also frees the resources this thread holds. For a stuck
  // agent or an abandoned thread.
  | { v: 2; type: 'action'; thread: string; kind: 'release' }
  // ci_stop: « Stop CI follow-up », a trusted human ends the CI follow-up of the commits declared in this thread (their
  // running pills go). Done, Closed, Later and Archive do it too.
  | { v: 2; type: 'action'; thread: string; kind: 'ci_stop' }
  // archive / unarchive: for the whole space, trusted humans only. `version` = the one of the thread shown:
  // refused (`stale`) if it changed since, and (`turn_active`) while an agent turn is running.
  | { v: 2; type: 'action'; thread: string; kind: 'archive' | 'unarchive'; version: number }
  // rename: a lead sets the title of a Lounge topic (cleanHeading; '' = back to no title, the first message shows).
  | { v: 2; type: 'action'; thread: string; kind: 'rename'; title: string }
  // invite: a lead invites a contributor of the space into a work thread (`on: true`) or removes them (`on: false`),
  // see Thread.invited. Never a topic (contributors already talk there), never another role.
  | { v: 2; type: 'action'; thread: string; kind: 'invite'; user: string; on: boolean }
  // « Reply as topic » on the General message `msg` (any member): opens (or finds) the topic started from it, acked
  // with `ack { client_id, thread: <topic>, msg_id: <its first message> }`. Wakes no agent.
  | { v: 2; type: 'action'; client_id: string; thread: string; kind: 'subtopic'; msg: string; wake?: boolean } // wake: « Send to <agent> », refused `forbidden` (like a mention) or `no_agent`
  // pin: personal pin (for oneself only, follows across devices). `at` grows client-side: the hub
  // ignores a frame older than the last applied one (concurrent Lambdas, order not guaranteed).
  | { v: 2; type: 'pin'; thread: string; on: boolean; at: number }
  // typing.set: this human is typing in the composer of `thread` (at most every 3 s while typing; `off` at the send or
  // when the field is emptied). Never stored, never acknowledged: relayed as `typing.updated` (hub/src/typing.ts).
  | { v: 2; type: 'typing.set'; thread: string; off?: true }
  // mute.set: personal mute of a space (any member, for oneself; hub/src/mute.ts). `at` grows client-side, like pin.
  | { v: 2; type: 'mute.set'; space: string; on: boolean; at: number }
  // next.open: a lead opens a line « Next » of a thread's summary as a new thread for that thread's agent (hub/src/nextsteps.ts).
  // `what` = the line's text, as the summary has it now. Answer: `ack { thread: <the thread> }`, the same one on a second click.
  | { v: 2; type: 'next.open'; client_id: string; thread: string; what: string }
  // Pending leads of a space (protocol/leads.ts, hub/src/leads.ts), module « threads ». lead.list: members, reply
  // `lead.list`. lead.delete: a lead, reply ack. lead.open: a lead, opens a Lounge topic with the lead's agent to discuss
  // it before acting (no thread, no work), reply ack (`thread` = the topic, the same one on a second click). lead.take:
  // a lead, in the conversation that recalled it (`thread`): taken there, `text` posted there as the lead's message
  // (it wakes the agent), once (a second click only acks). `thread` on lead.open: the conversation the button is in,
  // so a lead deleted meanwhile still opens from its recall. Changes go to the space as `lead.updated`, decisions on
  // the conversation's `leadsRecalled`. Errors: forbidden, module_off, not_found, stale.
  | { v: 2; type: 'lead.list'; client_id: string; space: string }
  | { v: 2; type: 'lead.delete'; client_id: string; space: string; id: string }
  | { v: 2; type: 'lead.open'; client_id: string; space: string; id: string; thread?: string }
  | { v: 2; type: 'lead.take'; client_id: string; space: string; id: string; thread: string; text: string }
  // browser.watch: the conversation this tab has on screen (null = none), for the agent's browser thumbnail (protocol/browser.ts).
  | { v: 2; type: 'browser.watch'; space: string; thread: string | null }
  // react: reaction (REACTIONS list) to a message, for oneself. `at` grows client-side, like pin. Any member;
  // the agent only sees trusted humans' reactions, as context of the next turn, never as a trigger.
  | { v: 2; type: 'react'; thread: string; msg: string; emoji: string; on: boolean; at: number }
  | { v: 2; type: 'sync'; space: string }        // threads of a space + directory (mentions)
  // threads.page: next page of the space's thread list (infinite scroll), `cursor` = the last one received
  // (`synced.cursor` or `threads.page.cursor`), opaque. Same membership check as sync.
  | { v: 2; type: 'threads.page'; space: string; cursor: string }
  // history: latest messages of a thread; with `before` (a message id), the page of messages just older than it
  // (search result further back than what is loaded: the client walks back page by page, contiguous).
  | { v: 2; type: 'history'; thread: string; before?: string }
  // search (⌘K, humans only): every space the person is a member of (checked by the hub on every frame), archived
  // threads included. Messages, thread and topic titles, attachment names (never their content).
  // `space`: only that space (must be one the person sees, else forbidden). `since` (epoch ms): only messages from
  // then on, and titles of threads updated since. Both optional; filters applied after the same Scan (no read saved).
  | { v: 2; type: 'search'; q: string; space?: string; since?: number }
  // metrics.get: activity of the space over a period, computed on demand by the hub (no stored aggregate). Any member.
  // tz: IANA time zone of the person (activity per day), optional.
  | { v: 2; type: 'metrics.get'; space: string; period: MetricsPeriod; tz?: string }
  // lineage.get: Flow view of the space over a period (who started what, what opened what), computed on demand. Any member.
  | { v: 2; type: 'lineage.get'; space: string; period: LineagePeriod }
  // thread.seen: a trusted human saw the agent's reply (end of turn `at`, the one of the `unseen` received).
  // Ignored if a more recent turn ended since: never clear a reply that was not shown.
  | { v: 2; type: 'thread.seen'; thread: string; at: number }
  // seen: personal read marks (for oneself, follows across devices; not the Your turn `thread.seen` above).
  // `at` = the thread's `updatedAt` read; a mark only moves forward (an older one is ignored). Up to SEEN_MAX
  // threads of `space` per frame: the client also re-sends at each sync the marks the hub lacks (offline, first run).
  | { v: 2; type: 'seen'; space: string; marks: SeenMark[] }
  // Stop the agent's running turn (trusted human of the space; refused `no_turn` outside a turn, `not_connected` when
  // no instance of the agent is connected). The partial answer stays; the turn end posts « Stopped by <name> ».
  | { v: 2; type: 'turn.stop'; thread: string }
  // Secret for an agent (trusted human of the space, thread or topic; protocol/secret.ts). `secret.key` asks the public
  // key of the agent's live instance (answered `secret.key`, refused `not_connected` when none is connected with a
  // plugin that takes secrets). `secret.send` carries the value encrypted for that `key`: refused `stale_key` when the
  // instance restarted since (new key: ask again), `not_connected` when nobody received it. Answered by `ack`.
  | { v: 2; type: 'secret.key'; client_id: string; thread: string; agent: string }
  | { v: 2; type: 'secret.send'; client_id: string; thread: string; agent: string; key: string; name: string; kind: SecretKind;
      epk: string; iv: string; ct: string }
  // Agent web preview (protocol/preview.ts). preview.open: a trusted human of the space opens the preview line `msg`
  // (status on) of `thread`; answered `preview.ready` (session + this viewer's TURN credentials). Errors: forbidden,
  // not_shared, not_connected, preview_off. preview.offer: the viewer's complete offer (candidates gathered), relayed to
  // the agent; only from the connection that opened the session (`forbidden` otherwise, `not_found` once expired).
  // preview.close: the viewer closed it; relayed to the agent, whose peer stops.
  | { v: 2; type: 'preview.open'; client_id: string; thread: string; msg: string }
  | { v: 2; type: 'preview.offer'; session: string; sdp: string }
  | { v: 2; type: 'preview.close'; session: string }
  // Visitor link (protocol/preview.ts « Visitor link »): a trusted human makes (or replaces) the link of the web or
  // screen line `msg` of `thread`, valid `minutes` (default VISITOR_MIN_DEFAULT); answered `preview.visitor` with the
  // token, to this connection only. preview.unvisitor revokes it, answered `ack`. Errors: forbidden, not_shared.
  | { v: 2; type: 'preview.visitor'; client_id: string; thread: string; msg: string; minutes?: number }
  | { v: 2; type: 'preview.unvisitor'; client_id: string; thread: string; msg: string }
  // Edit one's own last message (rules in `protocol/edit.ts`, refusal = its `EditBlock` code). `rev` = the message's
  // `rev` as read (0 if none): a stale one is refused `stale`. While the agent works the hub refuses `busy`: stop it
  // first and wait for its turn end. Answered by `ack`; the edited text is delivered to the agent again (trusted
  // author), the partial answer of a stopped turn that called no tool is erased (`message.deleted`).
  | { v: 2; type: 'message.edit'; client_id: string; thread: string; msg: string; rev: number; text: string }
  // Delete one's own message (`deletable` in protocol/edit.ts, refusal `not_author`), any time: the hub keeps the item,
  // empties its text and attachments, sets `deleted` and broadcasts `message.updated` (a topic opened from a General
  // message and its first-message copy go together). Never a turn: agents get one context line at their next turn.
  // `rev` as read (0 if none): stale = `stale`. Answered by `ack`; deleting a deleted message is acked again.
  | { v: 2; type: 'message.delete'; client_id: string; thread: string; msg: string; rev: number }
  // Web Push of this device (humans). push.key: the hub's VAPID public key (base64url, the browser's
  // applicationServerKey); reply `push.key`, or `error` `push_off` when no key is configured (alerts stay tab-only).
  // push.subscribe: records or refreshes this device for the person (sent at every connection while alerts are on);
  // `lang` = language of the notification text; the endpoint must be a known push service (`push_endpoint` otherwise).
  // push.unsubscribe: forgets this device (alerts turned off, logout), own devices only. Both answered `push.saved`.
  | { v: 2; type: 'push.key'; client_id: string }
  | { v: 2; type: 'push.subscribe'; client_id: string; sub: PushSub; lang: 'en' | 'fr' }
  | { v: 2; type: 'push.unsubscribe'; client_id: string; endpoint: string }
  // Project memory (Memory view). memory.list: every entry of the space, any status, any member; reply `memory`.
  // memory.decide: approve / reject a pending entry (reviewers: protocol/memory.ts canReview), archive a published one or
  // restore an archived one (trusted humans). `version` = the one shown (`stale` otherwise). Reply `memory.entry`, and
  // `memory.updated` to the space. Errors: forbidden, not_found, stale, bad_action.
  | { v: 2; type: 'memory.list'; space: string }
  // memory.wake: review now (trusted humans, agent mode; thresholds and cooldown skipped, never while a memory turn
  // runs). memory.compact: compact now (trusted humans, any mode; never while a synthesis waits for a human). Reply
  // `memory.woken`. The thresholds are space settings (space.save).
  | { v: 2; type: 'memory.wake'; client_id: string; space: string }
  | { v: 2; type: 'memory.compact'; client_id: string; space: string }
  | { v: 2; type: 'memory.decide'; client_id: string; space: string; id: string; version: number; action: MemoryAction }
  // tags.set: a lead sets (or clears, `tags: []`) the tags of a topic or a thread (protocol/tags.ts), checked against
  // the space's memory vocabulary. Reply: `ack` or `error` (ref = client_id): forbidden, unknown_tag, bad_frame.
  | { v: 2; type: 'tags.set'; client_id: string; thread: string; tags: string[] }
  // memory.tags: a trusted human sets the tags of an entry (0 to MEMORY_TAGS_MAX, protocol/memory.ts tagsIn), any status
  // but rejected. `version` = the one shown. Reply `memory.entry` and `memory.updated`. Errors: forbidden, not_found,
  // stale, bad_frame. memory.autotag: « Tag entries » (trusted humans): wakes the memory agent to tag the published
  // entries without tags (one turn, memory_tag); reply `memory.woken` (what: tag; nothing = every entry has tags).
  | { v: 2; type: 'memory.tags'; client_id: string; space: string; id: string; version: number; tags: string[] }
  | { v: 2; type: 'memory.autotag'; client_id: string; space: string }
  // memory.vocab: a trusted human decides on the tag vocabulary (protocol/memory.ts « tag vocabulary »). approve: the
  // waiting merge of `tag` is applied (every entry carrying `tag` gets its `to`, `tag` becomes an alias); reject: it
  // is dropped; unalias: the alias `tag` is removed (entries keep their tag). `version` = the vocabulary shown. Reply
  // `memory.vocabulary` (retagged: entries rewritten), `memory.vocab.updated` and `memory.updated` per entry to the
  // space. Errors: forbidden, not_found, stale, bad_frame.
  | { v: 2; type: 'memory.vocab'; client_id: string; space: string; version: number; action: 'approve' | 'approve_all' | 'reject' | 'unalias'; tag?: string } // approve_all: every waiting merge, `tag` ignored
  // memory.import: « Import from repo » (global admin, member of the space, `repo` attached to it). The GitHub Lambda reads
  // the repo's memory files at its default branch head and publishes the new ones (protocol/memory.ts memoryFileIn);
  // reply `memory.imported`. Errors before the read: forbidden, repo_not_attached, github_off.
  | { v: 2; type: 'memory.import'; client_id: string; space: string; repo: string }
  // presence.set: this tab's state (protocol/presence.ts), sent only when it changes and again after each `subscribed`
  // (a new subscription starts active). Humans only; the hub stores it on the connection's subscriptions and sends
  // `presence.changed` to the members of those spaces.
  | { v: 2; type: 'presence.set'; state: PresenceState; idle?: number } // idle: away only, this tab's last input (ms)
  | { v: 2; type: 'ping' };

// ---- instance -> hub
export type InstanceFrame =
  // spaces missing: every space of the instance (those of its agents, held by the hub).
  // plugin: the plugin release (plugin.yaml `version`, x.y.z) reported at every connection, shown to admins in the
  // space Settings; missing = a plugin from before versioning. Additive: the protocol version does not change.
  // plugin.secret_key: public key for secrets (protocol/secret.ts), new at every gateway start; missing = this plugin
  // does not take secrets.
  // plugin.voice: this host runs a voice daemon its agents can start (protocol/preview.ts « Voice on request »).
  | { v: 2; type: 'subscribe'; spaces?: string[]; plugin?: { version: string; secret_key?: string; voice?: true; updated_from?: string; update?: UpdateBlock; cache_ttl?: string } } // updated_from: first connection after a self-update; cache_ttl: Hermes' prompt_caching.cache_ttl
  // The plugin wrote (ok) or could not decrypt/store a secret it was handed (`secret.deliver`).
  | { v: 2; type: 'secret.received'; thread: string; id: string; ok: boolean }
  // Agent web preview (protocol/preview.ts). preview.share: the agent (`agent`, served by this instance and in the
  // thread's space) shares 127.0.0.1:`port` in `thread`; the hub posts the line and answers `preview.shared` with its id
  // (`client_id` echoed). preview.stop: that line goes off. preview.answer / candidate / failed: the agent's peer for
  // `session`, relayed to the viewer (only from an instance serving the session's agent).
  // A screen share sends `device` (adb serial) instead of `port`, a voice channel `voice: true`: exactly one of port,
  // device, voice.
  | { v: 2; type: 'preview.share'; client_id: string; thread: string; agent: string; port?: number; device?: string; voice?: true; label: string }
  | { v: 2; type: 'preview.stop'; client_id: string; thread: string; msg: string }
  | { v: 2; type: 'preview.answer'; session: string; sdp: string }
  | { v: 2; type: 'preview.candidate'; session: string; candidate: string; mid: string | null }
  | { v: 2; type: 'preview.failed'; session: string; code: PreviewError }
  | { v: 2; type: 'turn.started'; thread: string; at: number }
  // usage: LLM spend since the previous turn end of this thread (main loop, sub-agents, auxiliary calls), missing if
  // none. The hub adds it to the thread once per turn end (a replayed or older `at` is ignored).
  // stopped: the turn ended because of a `turn.stop` (the plugin interrupted it); acted: at least one tool was called
  // during that turn. Both missing on a normal end and from plugins older than the stop button.
  | { v: 2; type: 'turn.ended'; thread: string; at: number; usage?: Usage; stopped?: boolean; acted?: boolean }
  | { v: 2; type: 'message.delta'; thread: string; msg_id: string; text: string }
  // message.final = writes the message (created or replaced: Hermes platforms stream through successive edits).
  // msg_id sortable in time (base36 timestamp first), it orders the thread.
  // rev: grows per msg_id. Frames of one connection run in concurrent Lambdas,
  // an older edit can arrive after the latest one: the hub ignores any rev <= the stored one.
  // notice: a gateway lifecycle/status line (« ⏳ Working », « 💾 Self-improvement review »), not the agent's words: the
  // client shows it as a small grey line; nothing else changes (agent messages never drive push, unread or Your turn).
  | { v: 2; type: 'message.final'; thread: string; msg_id: string; text: string; rev?: number; files?: string[]; notice?: true }
  | { v: 2; type: 'upload'; client_id: string; space: string; name: string; mime: string; size: number }
  // empty options = open question: the answer arrives as a normal post.
  | { v: 2; type: 'ask'; thread: string; ask_id: string; q: string; options: string[] }
  // « To decide » card (see AskItem): answered `ack` (msg_id = the card, also its ask id). Errors: no_turn.
  | { v: 2; type: 'ask.choices'; client_id: string; thread: string; text: string; items: AskItem[] }
  // status: what the agent is doing right now ("Running npm test"), null = it is thinking. Ephemeral: relayed to
  // humans, never stored, refused outside a turn. rev grows (concurrent Lambdas): the client keeps the highest.
  // Optional, same lifetime: since = turn start (ms, plugin clock), steps = model calls so far in the turn,
  // recent = the last tool phrases of the turn, oldest first (activity feed; replaces the gateway's stored
  // « ⏳ Working — N min » message).
  | { v: 2; type: 'status'; thread: string; text: string | null; rev: number; since?: number; steps?: number; recent?: string[] }
  // thread.propose: the agent proposes to open a thread from a Lounge topic or from a thread (`propose_thread` tool,
  // never parsed text); the card shows in that conversation. A thread opened from a thread gets only the brief and a
  // link to its parent (`from`), a thread opened from a topic gets the whole topic.
  // The hub posts the card only during a turn triggered by a trusted human, at most one open card;
  // a human always opens the thread. Reply: `ack` (client_id) or `error` (ref = client_id).
  // brief (short Markdown): the plan approved by the human who opens the thread; it becomes the thread's first message.
  // space: another space (one of `deliver.context.spaces`): the card still shows here, but opening it creates a TOPIC
  // in that space's Lounge (first message = the brief signed by the agent + `origin`, no history copied). brief is then
  // required. Gates: the instance and the agent serve that space, the human of the turn is a member of it, and the
  // human who opens the card is trusted there (else `forbidden`). Accepted from and to a board-driven space (a topic).
    // `context` (optional, MAX_CONTEXT): the agent's summary of the conversation, shown folded under the brief and sent at
  // the kickoff with a link back and the newest MAX_FILES attachments, instead of the topic's messages.
  | { v: 2; type: 'thread.propose'; client_id: string; thread: string; title: string; why?: string; brief?: string; context?: string; space?: string; topic?: boolean }
  // topic.open: an agent opens a Lounge topic on its own, outside any turn (a cron job's report, `deliver=briefling:<space>`).
  // First message = `text`, signed by the agent; the topic shows as a card in the Lounge feed and its members are
  // notified like for a human's message. Never a message in General. Gates: the instance and the agent serve the space
  // (`agent`: one of the instance's agents, default = the space's agent in charge if served, else the first served),
  // space not archived, at most AGENT_TOPICS_PER_DAY per agent and space (UTC day, else `limit`). Reply: `ack` (thread =
  // the topic, msg_id = its first message) or `error`.
  | { v: 2; type: 'topic.open'; client_id: string; space: string; text: string; title?: string; agent?: string }
  // about.propose: the agent in charge drafts the space description (`propose_space_about` tool, Space Settings
  // "Draft with the agent"). Accepted only in a Lounge topic of the space, during a turn triggered by a trusted human
  // who is admin, from the space's agent in charge (`defaultAgent`). Shown as a card; never written to the space: the
  // admin applies it to the Settings form and saves. Reply: `ack` (client_id) or `error` (ref = client_id):
  // not_topic, no_turn, not_admin, not_in_charge, bad_frame.
  | { v: 2; type: 'about.propose'; client_id: string; thread: string; text: string; why?: string }
  // topic.title: the agent in charge titles a new Lounge topic (`topic_title` tool), from the topic itself when its first
  // message was for the agent (`deliver.context.name_topic`), else from the hidden conversation the hub opened for it
  // (`Thread.titleFor`). Accepted during the agent's turn there, for a topic opened by a lead (re-read now) that has no
  // title yet. Cleaned and cut by the hub (cleanHeading). Reply: `ack` or `error` (ref = client_id): no_turn,
  // not_in_charge, not_trusted, already_titled, bad_frame, unknown_tag.
  // `tags` (optional, 1-2, protocol/tags.ts): the topic's tags, from `deliver.context.tag_vocab` only (else unknown_tag,
  // nothing written); ignored when a lead already set them.
  | { v: 2; type: 'topic.title'; client_id: string; thread: string; title: string; tags?: string[] }
  // issue.propose: the agent proposes a GitHub issue (`propose_issue` tool) in a Lounge topic or a thread of a
  // board-driven space; the hub posts a "Create this issue?" card (Message.newIssue) and creates nothing. Accepted during
  // a turn triggered by a trusted human, in a repo attached to the space, at most one open card per conversation.
  // Reply: `ack` (client_id, msg_id = the card) or `error` (ref = client_id): no_turn, not_board, repo_not_attached,
  // already_proposed, bad_frame.
  | { v: 2; type: 'issue.propose'; client_id: string; thread: string; repo: string; title: string; body: string }
  // plan.propose: the agent proposes a plan of ordered steps (`propose_plan` tool) in a Lounge topic or a thread; the
  // hub posts a "Launch this plan?" card (Message.plan). Same gates as `thread.propose` / `issue.propose`: a turn
  // triggered by a trusted human, one open card per conversation, 2 to PLAN_STEPS_MAX steps (title + brief each, brief
  // up to MAX_BRIEF). Board-driven space: `repo` required, one of the attached repos (the steps become issues);
  // elsewhere `repo` is refused (the steps become threads). Reply: `ack` (msg_id = the card) or `error`: no_turn,
  // repo_not_attached, not_board, already_proposed, bad_frame.
  // elevation.request: the agent asks for temporary admin (`AgentElevated`) on an AWS account (`request_elevation`
  // tool); the hub gets a challenge from the elevation Lambda and posts the card. During a turn triggered by a trusted
  // human, never as a guest. Reply: `ack` (msg_id = the card) or `error`: no_turn, elevation_off, agent_not_allowed,
  // account_not_allowed, elevation_failed, bad_frame.
  | { v: 2; type: 'elevation.request'; client_id: string; thread: string; account: string; minutes: number; reason: string }
  | { v: 2; type: 'plan.propose'; client_id: string; thread: string; title: string; why?: string; context?: string; steps: { title: string; brief: string }[]; repo?: string }
  // thread.outcome: at the end of a turn, the agent says how the turn ends (`turn_outcome` tool). Threads only (not the Lounge),
  // during a turn triggered by a trusted human. Reply: `ack` (client_id) or `error` (ref = client_id).
  // Refused (`parked`) while the thread waits for a resource: the agent just ends its turn.
  // `summary` (optional): the agent's summary of the whole thread, replaces the one shown at the top (checked by
  // cleanTurnSummary, stored as THREAD#/SUMMARY, `summary.updated` to the humans). Displayed as text, never interpreted.
  // resume (waiting only): the agent carries on once the human did the action (their « Done » then wakes it).
  // tags (optional, 1-2): the thread's tags, as for topic.title (unknown_tag refuses the whole frame).
  | { v: 2; type: 'thread.outcome'; client_id: string; thread: string; outcome: 'done' | 'waiting'; action?: string; resume?: boolean; summary?: TurnSummary; tags?: string[] }
  // thread.background: the agent in charge's background work in the thread (Background), sent by the plugin outside any
  // turn too, full list (≤ BG_MAX_TASKS). Threads only (not the Lounge), never a guest. No reply; refused: bad_frame,
  // not_thread, not_in_charge.
  | { v: 2; type: 'thread.background'; thread: string; tasks: BgTask[] }
  // resource.acquire: the agent takes a shared resource of the space (`acquire_resource` tool), right before using it.
  // Threads only, during a turn triggered by a trusted human, resource declared in the space settings.
  // Reply `resource.result`: granted (free, or already held by this thread; held until `resource.release` or the end of
  // the turn), or queued: the thread is parked (state Waiting), the agent must end its turn without turn_outcome; when the
  // resource frees up, the hub grants it to the thread and delivers a resume message (attributed to the human who
  // triggered the parked turn). Errors: not_thread, no_turn, unknown_resource.
  | { v: 2; type: 'resource.acquire'; client_id: string; thread: string; resource: string }
  // ci.watch: the agent declares the commits it just pushed (`pushed_commits` tool, `branch` optional, BRANCH_RE): always
  // recorded for the thread info panel (ThreadEvent push); the hub also follows their CI (CiVerdict) when the space has it on.
  // Threads only, during a turn triggered by a trusted human (parked included), repos
  // among the attached ones (case-insensitive), full sha (SHA_RE), CI_MAX_COMMITS per frame, CI_MAX_WATCHES repos
  // followed per thread. Reply `ack` or `error` (ref = client_id): not_thread, no_turn, repo_not_attached,
  // too_many, bad_frame.
  | { v: 2; type: 'ci.watch'; client_id: string; thread: string; commits: { repo: string; sha: string; branch?: string }[] }
  // resource.release: done with it (no effect if this thread does not hold it). Reply `ack`.
  | { v: 2; type: 'resource.release'; client_id: string; thread: string; resource: string }
  // Project memory (protocol/memory.ts), during a turn triggered by a trusted human, threads and topics.
  // memory.search / memory.read: published entries of `space` (missing = the conversation's space). Another space only
  // if the agent serves it AND the human who started the turn is a member of it. Reply `memory.result` (entries =
  // agent view, data with provenance). Errors: no_turn, forbidden, not_found.
  // memory.propose: a new entry of the conversation's space, never written directly: the space's gate publishes it or
  // queues it for a human. Reply `memory.proposed`. Errors: no_turn, forbidden, memory_full, queue_full, bad_frame.
  // tags: 1 to MEMORY_TAGS_MAX (optional on the wire: older plugins send none).
  | { v: 2; type: 'memory.search'; client_id: string; thread: string; q: string; space?: string }
  | { v: 2; type: 'memory.read'; client_id: string; thread: string; id: string; space?: string }
  // Introspection, read only (tools space_threads / thread_read / space_metrics): an agent looks back at conversations
  // of a space to understand what went wrong. Same gates as memory.search: running turn triggered by a trusted human,
  // the space (missing = this conversation's) served by the instance and the agent, the human of the turn a member of
  // it, space not archived. Hidden conversations (memory review, titling) are never listed nor read. Reply
  // `introspect.result`. Errors: no_turn, forbidden, not_found (thread.read), too_big (space.metrics), bad_frame.
  // space.threads: newest activity first, INTROSPECT_PAGE per page (`offset`), filters on activity date (`since` /
  // `until`, ms), state, kind and `who` (topic author or agent in charge); each with its summary and LLM spend.
  | { v: 2; type: 'space.threads'; client_id: string; thread: string; space?: string; since?: number; until?: number; state?: ThreadState;
      kind?: 'thread' | 'topic'; who?: string; offset?: number }
  // thread.read: one conversation (`target`), its last INTROSPECT_MESSAGES messages (`before` = older page) and, on the
  // first page, its summary and timeline events (turns, outcomes, refusals, resources, pushes, CI; topics record none).
  | { v: 2; type: 'thread.read'; client_id: string; thread: string; target: string; before?: string }
  // space.metrics: the Metrics view (`metrics`, period 7d|30d|all) or the Flow view (`lineage`, period 3d|7d|30d).
  | { v: 2; type: 'space.metrics'; client_id: string; thread: string; space?: string; view: 'metrics' | 'lineage'; period: MetricsPeriod | LineagePeriod; tz?: string }
  // `replaces`: published entries this one goes back on (a decision changed); approved, they are archived (supersededBy),
  // restorable. Every id must be a published entry of the space (else not_found).
  | { v: 2; type: 'memory.propose'; client_id: string; thread: string; text: string; kind: MemoryKind; sources: string[]; tags?: string[]; replaces?: string[] }
  // Radar pass only (topic of a routine flagged radar, its agent, in its turn): records a finding; a known key updates
  // it (reply `ack`, msg_id = the signal id). Errors: not_radar, no_turn, forbidden, limit (RADAR_SIGNALS_PER_PASS),
  // not_source (managed pass: a bug or security signal under a key the hub did not read for it).
  | ({ v: 2; type: 'radar.signal'; client_id: string; thread: string } & SignalDraft)
  // Applet card (tool applet_propose): during a turn started by a lead, an applet draft for a lead to save; `id` +
  // `version`: the applet it updates. Reply `ack` (msg_id = the card). Errors: no_turn, forbidden, not_found, too_many.
  | { v: 2; type: 'applet.propose'; client_id: string; thread: string; draft: AppletDraft; id?: string; why?: string }
  // The space's applets as saved (ids, versions, drafts), during a turn: what applet_propose updates. Reply `applet.list`.
  | { v: 2; type: 'applet.list'; client_id: string; thread: string }
  | { v: 2; type: 'reminder.propose'; client_id: string; thread: string; title: string; notes?: string; date?: string; time?: string; tz?: string; why?: string }
  // One mail of the space's correspondents (protocol/exchanges.ts), during a turn of the agent started by a lead of the
  // space (not a routine). Idempotent on the Message-ID. Reply `mail.imported`. Writes no message and wakes no one.
  // Errors: no_turn, not_lead, forbidden, not_a_correspondent, full (MAIL_PER_EXCHANGE_MAX), bad_message_id,
  // bad_references, bad_address, bad_date, bad_subject, bad_body, bad_mail.
  | { v: 2; type: 'mail.import'; client_id: string; thread: string; mail: MailIn }
  // Hidden summary run only (its agent, in its turn, an exchange it was handed). exchange.read: reply `exchange.read`
  // (the mails as untrusted data, newest first within EX_READ_BUDGET). exchange.summary: summary + new requests +
  // requests settled (summaryIn), reply `ack`. Errors: not_run, no_turn, forbidden, not_found, bad_status,
  // bad_decisions, bad_mail, stale, bad_requests, old_mail, bad_done, full.
  | { v: 2; type: 'exchange.read'; client_id: string; thread: string; id: string }
  // browser.frame: a JPEG capture of the agent's browser (base64), or end: true when it closed it (protocol/browser.ts).
  | { v: 2; type: 'browser.frame'; thread: string; at: number; jpeg?: string; w?: number; h?: number; end?: true }
  | { v: 2; type: 'exchange.summary'; client_id: string; thread: string; id: string; status: string; decisions: string[]; through: string;
      requests?: { what: string; side: RequestSide; mail: string }[]; done?: string[] }
  // Hidden Radar run, its agent, in its turn: the profile pass sends the deduced profile, a Radar pass a correction
  // learnt from the sorting (`why` + `from` = dismissed signals no correction cited yet, required there, refused in the
  // profile pass), stored as the proposal an admin validates or rejects in Settings › Radar (a second call replaces it).
  // Reply `ack`. Errors: not_radar, no_turn, forbidden, not_dismissed, pending (a profile pass's proposal waits).
  | ({ v: 2; type: 'radar.profile'; client_id: string; thread: string } & RadarProfile & Partial<RadarCorrection>)
  // memory.tag: the memory agent tags published entries of its space, only in the review conversation during a tagging
  // turn (memory.autotag). Each item replaces that entry's tags. Reply `memory.tagged` (skipped: ids not published in
  // the space). Errors: no_turn, forbidden, bad_frame.
  | { v: 2; type: 'memory.tag'; client_id: string; thread: string; items: { id: string; tags: string[] }[] }
  // memory.review: the memory agent's verdict on a queued entry, only in the space's review conversation during its
  // turn. approve -> published, reject -> rejected, human -> stays for a human. Reply `memory.reviewed`. Errors:
  // no_turn, forbidden (not the review conversation or not the memory agent), not_found (not waiting for it).
  | { v: 2; type: 'memory.review'; client_id: string; thread: string; id: string; verdict: MemoryReviewVerdict; why: string }
  // memory.synthesis: the memory agent's synthesis replacing `supersedes` (published entries of the space), only in the
  // review conversation during a compaction turn: a merge (2+ ids), a rewrite (1 id), or with `drop` a removal (text =
  // why). Stored pending (same control as its own proposals); a trusted human's approval archives the replaced entries
  // (a drop is archived too, never published). Reply `memory.proposed`. Errors: no_turn, forbidden, not_found (an id not
  // published), busy (an id already in a waiting synthesis), queue_full (MEMORY_PENDING_MAX syntheses wait), bad_frame.
  | { v: 2; type: 'memory.synthesis'; client_id: string; thread: string; text: string; kind: MemoryKind; sources?: string[]; supersedes: string[]; tags?: string[]; drop?: boolean }
  // memory.tagmerge: the memory agent proposes tag merges ({from, to}: same concept, `to` the English tag), only in the
  // review conversation during a compaction turn. Stored waiting for a trusted human (memory.vocab). Reply
  // `memory.tagmerged` (skipped: `from` not kept: a tag not in use, already waiting, or the vocabulary full). Errors:
  // no_turn, forbidden, bad_frame, stale.
  | { v: 2; type: 'memory.tagmerge'; client_id: string; thread: string; merges: { from: string; to: string }[] }
  // memory.threadtag: the memory agent tags conversations left untagged, listed in its compaction message (protocol/
  // tags.ts untaggedPrompt), same gates as memory.tagmerge. Vocabulary only (never a new tag), never over existing tags,
  // not activity. Reply `memory.threadtagged` (skipped: not a conversation of the space, already tagged, or a tag
  // outside the vocabulary). Errors: no_turn, forbidden, bad_frame.
  | { v: 2; type: 'memory.threadtag'; client_id: string; thread: string; items: { id: string; tags: string[] }[] }
  // Flow (docs/design-flow.md): the agent's plugin runs the board rules and asks the hub before starting a task.
  // flow.task: `agent` (served by this instance, in the space) takes the board event `key` on issue `ref` (`owner/repo#N`,
  // repo attached) of a board-driven `space`. The hub finds or creates the issue thread, gives the agent the hand on it
  // (one task per agent and space), records the task and marks the coming turn `origin: flow` (tools reserved to a
  // trusted human's turn are refused in it; human messages wait for its end). Reply `flow.result`: started {thread},
  // queued (a turn already runs in that thread: retry later), busy (the agent holds another task in the space).
  // Errors: forbidden, not_board, repo_not_attached, bad_frame.
  | { v: 2; type: 'flow.task'; client_id: string; space: string; agent: string; ref: string; key: string; trigger: string; title: string }
  // flow.done: the task is closed (done, blocked, gone, lost): the hub releases the hand and stores the record. Reply
  // `ack`; a task the hub no longer holds is still recorded (idempotent per agent and start).
  | { v: 2; type: 'flow.done'; client_id: string; space: string; agent: string; ref: string; key: string; record: FlowRecord }
  // flow.config.status: what the plugin made of a `flow.config` for one of its agents: ok (loaded with the engine's
  // load_company, now in use) or the error (the plugin keeps its last good version). No reply; the editor shows it.
  | { v: 2; type: 'flow.config.status'; space: string; agent: string; version: number; sha: string; ok: boolean; error?: string; commit?: string }
  // flow.state: the agent's live flow state in the space (pause, current task, spend, caps, alerts), sent when it
  // changes and at each connection. No reply; the hub stores the last one and broadcasts it to the space's humans.
  | { v: 2; type: 'flow.state'; space: string; agent: string; state: FlowStateReport }
  // flow.switch: the agent's plugin redeems a switch code (`flowpilot.link`) after importing unstrikeable's state and
  // pausing it. Reply `flow.switched` (the plugin then pilots) or `error`: bad_code (unknown, used, expired, other
  // space or agent), forbidden, not_board.
  | { v: 2; type: 'flow.switch'; client_id: string; space: string; agent: string; code: string; imported: FlowImported }
  | { v: 2; type: 'ping' };

/**
 * Who pilots a flow agent's board work in a space (docs/design-flow.md § 13). No record = not briefling (unstrikeable,
 * or nothing): the plugin never ticks for it and the hub refuses its `flow.task`. pending: a switch link was made and
 * not redeemed yet (expiresAt); piloted: the plugin runs the board (since). by: who made the link (Cognito sub).
 */
export interface FlowPilot { agent: string; state: 'pending' | 'piloted'; by: string; at: number; expiresAt?: number; since?: number; imported?: FlowImported }
/** What the plugin took over from unstrikeable at the switch (display): events already delivered, items with run
 *  counters, spend over the last 30 days (USD). */
export interface FlowImported { seen: number; refs: number; spent: number }
export const FLOW_SWITCH_TTL_MS = 24 * 3600 * 1000;

// ---- hub -> client / instance
/** One saved version of a space's flow (`SPACE#<s>` / `FLOWCFG#<version>`): who, when, sha256 of the def's JSON. */
export interface FlowVersionMeta { version: number; by: string; at: number; sha: string; commit?: string }
/** source: where it was saved (null/missing = briefling); commit: the commit the save made (or found unchanged). */
export interface FlowVersion extends FlowVersionMeta { def: FlowDef; team: FlowTeam; source?: FlowSource | null; commit?: string }
/** Last `flow.config.status` of an agent (`SPACE#<s>` / `FLOWSTAT#<agent>`): the version it loaded or refused. */
export interface FlowAgentStatus { agent: string; version: number; sha: string; ok: boolean; error?: string; at: number; commit?: string }
export const GIT_SHA_RE = /^[0-9a-f]{40}$/;
export const FLOW_STATUS_ERROR_MAX = 500;
/** sha256 (hex) of the bundle's files, the plugin's cache key. */
export const BUNDLE_SHA_RE = /^[0-9a-f]{64}$/;
/** Versions listed by `flowcfg` (each is ~100 bytes: the frame stays far below API Gateway's 128 KB). */
export const FLOW_HISTORY_MAX = 200;

/** Bounds of the flow frames. Task key = the engine's event key (`<ref>|<role>|<trigger>|<sig>`). */
export const FLOW_KEY_MAX = 300, FLOW_TRIGGER_RE = /^[a-z][a-z0-9_-]{0,30}\.[a-z][a-z0-9_-]{0,30}$/, FLOW_TITLE_MAX = 300;
// Owner kept loose (the repo must also be one of the space's attached repos, compared case-insensitively).
export const FLOW_REF_RE = /^([A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100})#([1-9][0-9]{0,8})$/;
export const FLOW_OUTCOMES = ['done', 'blocked', 'gone', 'lost'] as const;
/** Spend in USD: today (the agent machine's calendar day, as its daily cap counts) and the rolling 30 days. */
export interface FlowCost { day: number; month: number }
/**
 * Live state of a flow agent in a space (docs/design-flow.md § 4.6), as its plugin reports it (`flow.state`). Times in
 * seconds, the plugin's clock. paused.by: quota = a cost cap stopped it, human = Pause. current.running: a turn of the
 * task runs now; alive: its last sign of life (turn start, or end of its last turn). usage: everything counts towards
 * the caps, task turns and discussion (humans talking to it in the space) shown apart. alerts: the engine's latest
 * (lost task, quota pause), a week at most.
 */
export interface FlowStateReport {
  paused: { by: 'human' | 'quota'; reason: string; since: number } | null;
  current: { ref: string; trigger: string; thread: string | null; since: number; running: boolean; alive: number | null } | null;
  usage: { task: FlowCost; discussion: FlowCost };
  caps: { day: number | null; month: number | null };
  alerts: { at: number; ref: string; text: string }[];
}
/** Stored by the hub (`SPACE#<s>` / `FLOWLIVE#<agent>`): the last report, `at` = hub time (ms) it arrived. */
export interface FlowAgentState extends FlowStateReport { agent: string; at: number }
export const FLOW_ALERTS_MAX = 5, FLOW_ALERT_MAX = 300, FLOW_REASON_MAX = 200;
/** Closed tasks the Board's flow block lists (newest first). */
export const FLOW_TASKS_SHOWN = 30;
/** flow.wake: at most one per space in this window (hub side). */
export const FLOW_WAKE_MS = 30_000;
/** One closed task as the Board shows it (`FLOWREC#`, without the engine key). */
export interface FlowTaskRow extends FlowRecord { agent: string; thread: string | null; ref: string }
/**
 * One closed board task, as the plugin's engine records it (times in seconds, unstrikeable's format). cost = the task's
 * LLM spend (turns tagged `task`), null when unknown. Stored by the hub per space (`FLOWREC#`).
 */
export interface FlowRecord { outcome: (typeof FLOW_OUTCOMES)[number]; kind: string | null; trigger: string; start: number; end: number;
  retries: number; runs: number; reviews: number; cost: number | null }

export type HubFrame =
  // list: names of the accepted spaces (humans); admin: the user is a global admin (creates and configures every space;
  // an admin of one space gets `admin: true` on that space's SpaceInfo instead).
  // allowed (instances): per accepted space, the humans whose messages may make its agents act (leads + contributors,
  // Cognito subs). A plugin set to take its allowlist from the hub (`BRIEFLING_ALLOWED_FROM=hub`) uses it instead
  // of a list written on the agent host; updated by `allowed` on every settings save.
  // `me`: the human's hub user id (a standalone server with OIDC: not the provider's `sub`, the client cannot read it in its token).
  | { v: 2; type: 'subscribed'; spaces: string[]; denied: string[]; list?: SpaceInfo[]; admin?: boolean; me?: string; allowed?: Record<string, string[]>
      release?: { version: string; commit: string } } // release: instances only, the plugin release this hub was deployed with (self-update)
  // release (instances behind it, once per `npm run deploy`, hub/src/release.ts): same as `subscribed.release`, without
  // waiting for the next connection. Plugins up to 0.3.84 ignore it and get the release at their next reconnection.
  | { v: 2; type: 'release'; release: { version: string; commit: string } }
  // people.invite: account created by an invitation and never signed in (pending), past the 7 days of its temporary password (expired).
  // invites: agent invitations of every space (kept 30 days after expiry).
  // plugins: per agent, the plugin version its instance last reported at connect (`at` = ms), absent if never reported.
  | { v: 2; type: 'admin.spaces'; spaces: SpaceSettings[]; people: DirectoryPerson[]; agents: string[]; invites?: AgentInvite[]; plugins?: Record<string, AgentPlugin> }
  // result: link = new invitation, `code` shown once (never stored in clear); added = agent already served by an
  // instance, now in the space; already = was in the space. invites: the space's invitations, fresh.
  | { v: 2; type: 'agent.invited'; client_id: string; space: SpaceSettings; agent: string; result: 'link' | 'added' | 'already'; code?: string; invites: AgentInvite[] }
  | { v: 2; type: 'agent.invites'; client_id: string; space: string; invites: AgentInvite[] }
  // access: deleted = the instance had no other space and was created by an invitation (client deleted, connections
  // closed); kept = it still serves other spaces, or it is a static instance (infra).
  | { v: 2; type: 'agent.removed'; client_id: string; space: SpaceSettings; agent: string; access: 'deleted' | 'kept'; invites: AgentInvite[] }
  // Join connection only, sent once: the instance's credentials (never logged nor shown by the plugin), the spaces it
  // serves and the trusted humans of the space (plugin allowlist). token_url = Cognito client-credentials endpoint.
  | { v: 2; type: 'agent.joined'; client_id: string; agent: string; spaces: string[]; allowed: string[];
      credentials: { client_id: string; client_secret: string; token_url: string } }
  | { v: 2; type: 'space.saved'; client_id: string; space: SpaceSettings }
  // history: newest first, at most FLOW_HISTORY_MAX. version: the one asked (latest by default), null if none.
  // status: each flow agent's last answer to a pushed version. target: department, Project and repos config.yml uses.
  | { v: 2; type: 'flowcfg'; client_id: string; space: string; history: FlowVersionMeta[]; version: FlowVersion | null; status: FlowAgentStatus[];
      target: BundleTarget; agents: string[] }
  | { v: 2; type: 'flowcfg.saved'; client_id: string; space: string; version: FlowVersionMeta }
  // Git source: the branch head just read (the base of the next save), or why it could not be read.
  | { v: 2; type: 'flowcfg.git'; client_id: string; space: string; head: string | null; error?: string }
  // result: invited = new account, mail sent by Cognito; added = existing account, no mail; already = was a member.
  | { v: 2; type: 'space.invited'; client_id: string; space: SpaceSettings; person: DirectoryPerson; result: 'invited' | 'added' | 'already' }
  | { v: 2; type: 'profile.saved'; client_id: string; name: string; role: string }
  | { v: 2; type: 'member.saved'; client_id: string; person: DirectoryPerson; result: 'saved' | 'reinvited' }
  // space.updated: settings changed by the admin, a member added or renamed; member false = no access anymore (removed or
  // archived), the hub drops the subscription. humans: the space's members with their current name and function, agentRoles:
  // the agents' functions, agents: the agents a human sees (no backstage memory agent; missing = older hub) (member true only).
  | { v: 2; type: 'event'; event: 'space.updated'; data: SpaceInfo & { member: boolean; humans?: Person[]; agents?: string[]; agentRoles?: Record<string, string>; agentAvatars?: Record<string, string>; driver?: Driver } }
  // memory.pending: memory entries waiting for a human decision (protocol/memory.ts waitsForHuman), sent to the space's
  // reviewers only (canReview) whenever it changes; the Memory entry of the sidebar shows it as a badge.
  | { v: 2; type: 'event'; event: 'memory.pending'; data: { space: string; n: number } }
  // presence.changed: the whole list of who is connected in the space (protocol/presence.ts), to its subscribed members,
  // after a subscription, a disconnection or a `presence.set`.
  | { v: 2; type: 'event'; event: 'presence.changed'; data: { space: string; presence: Presence[]; lastSeen?: LastSeen } }
  | { v: 2; type: 'ack'; client_id: string; thread: string; msg_id: string }
  // notify: the members a human's new message is for (protocol/notify.ts `messageTo`): their tabs alert.
  | { v: 2; type: 'event'; event: 'message.created' | 'message.updated'; data: Message; notify?: string[] }
  | { v: 2; type: 'event'; event: 'message.delta'; data: { thread: string; msg_id: string; text: string } }
  // agent: whose turn the phrase belongs to (a topic can have several agents working; `rev` is per agent's instance).
  | { v: 2; type: 'event'; event: 'thread.status'; data: { thread: string; agent?: string; text: string | null; rev: number; since?: number; steps?: number; recent?: string[] } }
  // Ephemeral (never stored): no connection of the agent in charge received this message; it is not replayed.
  | { v: 2; type: 'event'; event: 'message.undelivered'; data: { thread: string; message: string; agent: string } }
  // Messages removed from the thread: the partial answer of a stopped turn erased by an edit of the message it answered.
  | { v: 2; type: 'event'; event: 'message.deleted'; data: { thread: string; ids: string[] } }
  | { v: 2; type: 'event'; event: 'thread.upserted'; data: PublicThread }
  | { v: 2; type: 'event'; event: 'summary.updated'; data: ThreadSummary }
  | { v: 2; type: 'event'; event: 'github.updated'; data: GhSnapshot }
  // pin.updated: sent only to the connections of the person who pinned (never to the rest of the space).
  | { v: 2; type: 'event'; event: 'pin.updated'; data: Pin }
  // typing.updated: someone is typing in `thread` (`off`: stopped), to the space's other members' tabs only, never to
  // an agent; the client forgets it 6 s after the last one (client/src/typing.ts).
  | { v: 2; type: 'event'; event: 'typing.updated'; data: { space: string; thread: string; who: string; off?: true } }
  // mute.updated: sent only to the connections of the person who muted (never to the rest of the space).
  | { v: 2; type: 'event'; event: 'mute.updated'; data: Mute }
  // browser.frame: relayed only to the members' tabs watching that conversation, never stored. browser.watchers: to the agent, how many got it.
  | { v: 2; type: 'event'; event: 'browser.frame'; data: BrowserFrame }
  | { v: 2; type: 'browser.watchers'; thread: string; n: number }
  // seen.updated: the marks a `seen` frame moved forward, only to the connections of that person.
  | { v: 2; type: 'event'; event: 'seen.updated'; data: { space: string; marks: SeenMark[] } }
  | { v: 2; type: 'event'; event: 'reaction.updated'; data: Reaction }
  | { v: 2; type: 'event'; event: 'lock.updated'; data: AgentLock }
  | { v: 2; type: 'event'; event: 'resource.updated'; data: ResourceLock }
  // Project memory: an entry was proposed or decided (humans of the space).
  | { v: 2; type: 'event'; event: 'memory.updated'; data: MemoryEntry }
  // Reply to memory.list. review: the person may approve/reject pending entries; trusted: may archive/restore.
  // vocab: the space's tag aliases and the merges waiting for a trusted human. The entries come in chunks under the
  // WebSocket message limit (memoryChunks): `memory` carries the first, then `memory.entries` the next ones, in order;
  // `more` = another chunk follows.
  | { v: 2; type: 'memory'; space: string; mode: MemoryMode; entries: MemoryEntry[]; review: boolean; trusted: boolean;
      agent: string; vocab: MemoryVocab; more?: boolean; run?: MemoryRun }
  // The memory agent's turn started (run without `ended`) or ended (`ended`, `n`), to every member: the view's banner.
  | { v: 2; type: 'event'; event: 'memory.run'; data: { space: string; run: MemoryRun } }
  | { v: 2; type: 'memory.entries'; space: string; entries: MemoryEntry[]; more: boolean }
  | { v: 2; type: 'event'; event: 'memory.vocab.updated'; data: MemoryVocab }
  | { v: 2; type: 'memory.vocabulary'; client_id: string; vocab: MemoryVocab; retagged: number }
  // Reply to memory.wake (what: review) and memory.compact (what: compact). nothing: no entry to review / no entry
  // published; pending: a synthesis waits for a human; running / cooldown: a memory turn runs or just ran.
  // what: tag = reply to memory.autotag.
  | { v: 2; type: 'memory.woken'; client_id: string; space: string; what: 'review' | 'compact' | 'tag'; result: MemoryWake }
  // Reply to memory.import. added: entries published now; existing: files imported before (same path, any status,
  // never overwritten); failed: files refused (never truncated). error: nothing written (memory_full with `live`, the
  // live entries, and `wanted`, the new files; too_many; forbidden; github_*; git_not_found).
  | { v: 2; type: 'memory.imported'; client_id: string; space: string; repo: string; sha?: string; added: number; existing: number;
      failed: { path: string; why: MemoryFileError }[]; error?: string; live?: number; wanted?: number }
  | { v: 2; type: 'memory.reviewed'; client_id: string; id: string; status: MemoryEntry['status'] }
  | { v: 2; type: 'flow.result'; client_id: string; status: 'started' | 'queued' | 'busy'; thread?: string }
  // Switch by link (admins). flowpilot.linked: the code, ONCE. flowpilot.updated: a pilot changed (link, switch, back),
  // to the space's humans; Settings and the flow block follow it.
  | { v: 2; type: 'flowpilot.list'; client_id: string; space: string; pilots: FlowPilot[] }
  | { v: 2; type: 'routine.list'; client_id: string; space: string; routines: Routine[] }
  | { v: 2; type: 'applet.list'; client_id: string; space: string; applets: Applet[] }
  // token: the app's `/a/<token>/` (none: never published); fresh: its files match the applet's name and emoji.
  | { v: 2; type: 'pinapp.state'; client_id: string; space: string; id: string; token?: string; fresh: boolean }
  | { v: 2; type: 'applet.runs'; client_id: string; space: string; applet: string; runs: AppletRunInfo[] }
  | { v: 2; type: 'applet.result'; client_id: string; space: string; result: AppletResult }
  | { v: 2; type: 'reminder.list'; client_id: string; space: string; lists: ReminderList[]; reminders: Reminder[] }
  // Answer of every reminder write: the item written (none for a delete or a clear).
  | { v: 2; type: 'reminder.saved'; client_id: string; space: string; reminder?: Reminder; list?: ReminderList }
  // A change of the space's reminders (any member, any device): the items written, the ids removed.
  | { v: 2; type: 'lead.list'; client_id: string; space: string; leads: Lead[] }
  | { v: 2; type: 'event'; event: 'lead.updated'; data: { space: string; leads?: Lead[]; removed?: string[] } }
  | { v: 2; type: 'event'; event: 'reminder.updated'; data: { space: string; lists?: ReminderList[]; reminders?: Reminder[]; removed?: string[]; removedLists?: string[] } }
  | { v: 2; type: 'radar.list'; client_id: string; space: string; signals: Signal[] }
  | { v: 2; type: 'event'; event: 'radar.updated'; data: Signal }
  | { v: 2; type: 'exchange.list'; client_id: string; space: string; correspondents: Correspondent[]; exchanges: Exchange[] }
  | { v: 2; type: 'exchange.get'; client_id: string; space: string; exchange: Exchange; mails: ExchangeMail[] }
  | { v: 2; type: 'exchange.body'; client_id: string; space: string; id: string; mail: string; text?: string; url?: string }
  | { v: 2; type: 'correspondent.list'; client_id: string; space: string; correspondents: Correspondent[]; config?: ExchangeConfig }
  | { v: 2; type: 'exchange.read'; client_id: string; exchange: { id: string; subject: string; with: string; state: Exchange['state']; count: number };
      summary: ExchangeSummary | null; requests: ExchangeRequest[]; note: string;
      mails: { id: string; date: string; dir: 'in' | 'out'; from: string; to: string[]; subject: string; text?: string; cut?: true }[] }
  | { v: 2; type: 'mail.imported'; client_id: string; result: 'imported' | 'known'; exchange: string; state: Exchange['state'] }
  | { v: 2; type: 'event'; event: 'exchange.updated'; data: Exchange }
  | { v: 2; type: 'event'; event: 'exchange.removed'; data: { space: string; id: string } }
  | { v: 2; type: 'event'; event: 'correspondents.updated'; data: { space: string; correspondents: Correspondent[] } }
  | { v: 2; type: 'radarcfg'; client_id: string; space: string; config: RadarConfig; run?: RadarRunResult }
  | { v: 2; type: 'event'; event: 'radarcfg.updated'; data: RadarConfig }
  | { v: 2; type: 'flowpilot.linked'; client_id: string; space: string; agent: string; code: string; pilots: FlowPilot[] }
  | { v: 2; type: 'event'; event: 'flowpilot.updated'; data: { space: string; pilots: FlowPilot[] } }
  | { v: 2; type: 'flow.switched'; client_id: string; space: string; agent: string }
  // Replies of the Board's flow block. flowstate: agents = the space's flow agents that reported a state; tasks = the
  // latest closed tasks (FLOW_TASKS_SHOWN), newest first. flowstate.paused: the instances serving the agent got it.
  | { v: 2; type: 'flowstate'; client_id: string; space: string; agents: FlowAgentState[]; tasks: FlowTaskRow[] }
  | { v: 2; type: 'flowstate.paused'; client_id: string; space: string; agent: string; paused: boolean }
  // A flow agent's new live state (humans of the space): Board flow block and the task thread's header chip.
  | { v: 2; type: 'event'; event: 'flowstate.updated'; data: { space: string; state: FlowAgentState } }
  | { v: 2; type: 'memory.entry'; client_id: string; entry: MemoryEntry }
  // Replies to the agent's memory frames.
  // memory.result of a search: tags = the space's tags, most used first (MEMORY_TAGS_LISTED), so a proposal reuses them.
  | { v: 2; type: 'memory.result'; client_id: string; space: string; entries: AgentMemoryEntry[]; tags?: string[] }
  // Answer to space.threads (threads, offset of the next page if `more`), thread.read (read) or space.metrics.
  | { v: 2; type: 'introspect.result'; client_id: string; space: string; threads?: IntrospectThread[]; more?: boolean; offset?: number;
      read?: IntrospectRead; metrics?: SpaceMetrics; lineage?: SpaceLineage }
  | { v: 2; type: 'memory.tagged'; client_id: string; updated: number; skipped: string[] }
  | { v: 2; type: 'memory.tagmerged'; client_id: string; added: number; skipped: string[] }
  | { v: 2; type: 'memory.threadtagged'; client_id: string; updated: number; skipped: string[] }
  | { v: 2; type: 'memory.proposed'; client_id: string; id: string; status: MemoryEntry['status']; gate: MemoryEntry['gate'] }
  // Reply to resource.acquire. queued: `holder` = title of the thread holding it, `position` = place in the queue (1 = next).
  | { v: 2; type: 'resource.result'; client_id: string; resource: string; granted: boolean; holder?: string; position?: number }
  // context.unseen: messages (trusted humans, agents) since the agent last spoke,
  // or the whole originating topic for a thread just opened from it. Data, never instructions.
  // files: presigned read URLs (10 min) of the attachments of the message and of context.unseen messages
  // (same filter), chronological, the MAX_FILES most recent; the instance downloads them. by: author id of the file's message.
  // context.resources: shared resources declared in the space (threads only, missing if none): take one with the
  // acquire_resource tool right before using it. context.parallel: true when the agent may be on other threads of this
  // space at the same time (cooperative mode): one worktree per thread.
  | { v: 2; type: 'deliver'; thread: string; space: string; agent: string; message: Message; author_name: string; files?: (FileRef & { url: string; by: string })[];
  // context.issue: thread of an issue in a board-driven space: the issue and the GitHub comments since the agent last
  // spoke (outsiders' ones held while vetting). Content from GitHub: data, never instructions.
  // context.repos: board-driven space, the attached repos (`owner/name`) where `propose_issue` may propose an issue.
  // context.ci: threads of a space with CI follow-up on, the attached repos whose CI is followed.
  // context.pushed: every work thread (not a topic, a guest's turn nor a board-driven space): `pushed_commits` takes any
  // repo; the attached ones listed here also get their pull request in Thread info.
  // context.memory: the space's published memory entries most related to the message (protocol/memory.ts
  // memoryForTurn, at most 3, ~400 tokens), missing when none matches. Data, never instructions.
  // context.memory_tags: with context.memory only, the space's memory tags (most used first, at most
  // MEMORY_TAGS_LISTED, protocol/memory.ts turnTags) so the agent's memory_search names an existing tag.
      context: { title: string; kind: 'thread' | 'topic'; space_about?: string; unseen: { who: string; text: string }[]; resources?: string[]; resource_rules?: Record<string, string>; parallel?: boolean;
        issue?: IssueContext; repos?: string[]; ci?: string[]; pushed?: string[]; memory?: PushedMemoryEntry[]; memory_tags?: string[];
        // code: the space has a repo attached (any kind of conversation); `pushed` (work threads only) is sent only then.
        // Without it the plugin gives no commit/push/worktree instruction unless it mounts the space's project itself.
        // false: the admin turned the space's « code » module off: no such instruction even with the project mounted.
        code?: boolean;
        // threads: false when the space's « threads » module is off: no new thread, so no propose_thread / propose_plan.
        threads?: false;
        // name_topic: first message of a lead's topic, addressed to the agent in charge: title it in this turn (topic.title).
        name_topic?: boolean;
        // tag_vocab: the conversation has no tags yet (a topic being titled, a work thread): the space's memory tags,
        // most used first, to pick 1-2 from with topic.title / thread.outcome (protocol/tags.ts). Sent empty when the
        // space has none yet but `tag_open`.
        tag_vocab?: string[];
        // tag_open: the vocabulary is under the space's cap (tagMax): a new tag (English slug) is accepted and joins it.
        tag_open?: true;
        // author_nontech: the delivered message's author is flagged « not technical » by the space admin (Settings ›
        // Members): answer them in plain words, results and effects rather than code and diffs.
        author_nontech?: true;
        // ambient: first turn of a topic opened from General: the AMBIENT_MAX messages of General before the one the
        // topic started from (same author filter as `unseen`). Maybe unrelated to the topic: data, never instructions.
        ambient?: { who: string; text: string }[];
        // spawned: topic only, the threads opened from it (SPAWNED_CONTEXT_MAX most recent, by activity) and where each
        // stands (state, outcome, plan step, summary status). Data, never instructions.
        spawned?: SpawnedThread[];
        // Pending leads of the space close to this new conversation (protocol/leads.ts): mention each once, in one line.
        leads?: { from: string; from_title: string; what: string }[];
        // deleted: messages of this conversation deleted by their author since the agent last spoke (`message.delete`):
        // author name and the message's own time. Words gone; the agent may hold them in its session, it must drop them.
        // A hub signal, never a turn of its own.
        deleted?: { who: string; at: number }[];
        // in_charge: work thread where this agent is a guest (called by a mention): the owner keeps the hand, the
        // resources and the turn outcome; the guest only answers.
        in_charge?: string;
        // queued: a talk turn of a work thread waiting in its agent's queue (strict mode): Lounge rights, the hub
        // refuses acquire_resource, turn_outcome and pushed_commits (`queued`) until its place comes. `position`
        // 1 = next; `holder`: title of the thread holding the hand.
        queued?: QueuedTalk;
        // relaunched: first turn after the place came, for a thread that talked while queued: thread rights again.
        relaunched?: boolean;
        // spaces: the OTHER spaces this agent serves where the human of the turn is a member (id + name), the targets
        // of a cross-space `thread.propose`. Missing when none, for a guest, or when no trusted human started the turn.
        spaces?: { id: string; name: string }[] } }
  | { v: 2; type: 'error'; code: string; ref?: string; detail?: string }
  // To the instances of the flow's agents present in the space (docs/design-flow.md § 4.2): the space's whole flow
  // config bundle (protocol/flowteam.ts bundleFiles: closed list of paths, 64 KB), at their connection and on every
  // saved version. sha = sha256 of the files (BUNDLE_SHA_RE). The plugin answers `flow.config.status`. Git source:
  // the files read at the branch head, `commit` = that head (version = the latest saved in briefling).
  | { v: 2; type: 'flow.config'; space: string; version: number; sha: string; files: BundleFile[]; commit?: string }
  // To the instances serving `agent` in the space: Pause / Resume from a trusted human (`by` = their display name). The
  // plugin answers with `flow.state`. A running turn is not cut.
  | { v: 2; type: 'flow.pause'; space: string; agent: string; paused: boolean; by: string }
  // To the instances subscribed to the space, after every change of its settings: the new `subscribed.allowed` entry.
  | { v: 2; type: 'allowed'; space: string; users: string[] }
  // To the instances of the space's flow agents (docs/design-flow.md § 4.4): « read the board now », never a task. Sent
  // when briefling changed the board (label, issue created, merge, hand released, pause lifted) or the hub's poll saw
  // an issue move; at most one per space per FLOW_WAKE_MS. The plugin skips it less than 60 s after its last tick.
  | { v: 2; type: 'flow.wake'; space: string }
  // To the instances serving `agent` in a board-driven space: whether the plugin pilots its board work there. Sent at
  // each subscribe for every agent of the instance in every board-driven space it subscribed (true or false), and on
  // `flowpilot.back` (false). The plugin ticks only while the last value it got is true (one pilot per agent).
  | { v: 2; type: 'flow.pilot'; space: string; agent: string; piloted: boolean }
  // To the agent's instance: a trusted human (`by`, Cognito sub) asks to stop the running turn of `thread`. The plugin
  // interrupts it (gateway `/stop`) and answers with `turn.ended` {stopped, acted}.
  | { v: 2; type: 'turn.stop'; thread: string; by: string }
  // To the live connections of the instance whose key encrypted it: a secret from trusted human `from` (protocol/secret.ts).
  // `id` = the line's message id, echoed in `secret.received`. Nothing of it is stored by the hub.
  | { v: 2; type: 'secret.deliver'; id: string; space: string; thread: string; agent: string; from: string; name: string;
      kind: SecretKind; epk: string; iv: string; ct: string }
  // Answer to `secret.key`: the agent's current public key.
  | { v: 2; type: 'secret.key'; client_id: string; agent: string; key: string }
  // Agent web preview (protocol/preview.ts). To the agent: preview.shared answers preview.share / preview.stop (`msg` =
  // the line); preview.offer opens a session on its share `port` of `thread` (`ice` = the agent's own TURN credentials);
  // preview.close: the viewer left. To the viewer: preview.ready answers preview.open (`ice` = its TURN credentials,
  // `label` and `port` of the line); preview.answer / candidate / failed come from the agent's peer (failed also from
  // the hub: not_connected when the offer reached no live instance). preview.offer and preview.ready carry exactly one
  // of `port`, `device` (screen share), `voice: true` (voice channel), copied from the line.
  | { v: 2; type: 'preview.shared'; client_id: string; thread: string; msg: string }
  // `max_s`: a visitor's session, seconds left before its link's deadline: the peer stops then.
  | { v: 2; type: 'preview.offer'; session: string; space: string; thread: string; msg: string; port?: number; device?: string; voice?: true; sdp: string; ice: IceServer[]; max_s?: number }
  | { v: 2; type: 'preview.close'; session: string }
  // `until`: a visitor's session, the link's deadline (ms).
  | { v: 2; type: 'preview.ready'; client_id: string; session: string; thread: string; msg: string; port?: number; device?: string; voice?: true; label: string; ice: IceServer[]; until?: number }
  // Answer to preview.visitor: the token of the new link (protocol/preview.ts), shown to that lead only.
  | { v: 2; type: 'preview.visitor'; client_id: string; thread: string; msg: string; token: string; until: number }
  | { v: 2; type: 'preview.answer'; session: string; sdp: string }
  | { v: 2; type: 'preview.candidate'; session: string; candidate: string; mid: string | null }
  | { v: 2; type: 'preview.failed'; session: string; code: PreviewError }
  // threads: the first page (THREADS_PAGE most recent by activity) plus, whatever their age, the threads that must
  // always be there: pinned by this person, Your turn, In progress. cursor: next page (`threads.page`), null = no more.
  // pins: pins of the connected person in this space (hers only). seen: her read marks of the threads sent.
  // locks: one per agent that already worked here.
  // resources: one per resource already used in the space. parallel: the space's mode (queue display).
  // driver: who drives the work (Board lists every open item, linked to its thread, in 'board').
  // trusted: the person is a trusted human of the space (display only: the hub checks every frame).
  // contributors: the space's contributors, sent to leads only (they invite them into a thread, Thread.invited).
  | { v: 2; type: 'synced'; space: string; threads: PublicThread[]; people: Person[]; github: GhSnapshot | null; repos: string[]; pins: Pin[]; seen: SeenMark[]; locks: AgentLock[];
      resources: ResourceLock[]; parallel: Parallel; cursor: string | null; driver?: Driver; trusted?: boolean; contributors?: string[];
      applets?: number; // the applets this person may launch (a lead: all; a contributor: those not for leads only), missing = none: the menu shows only then
      mergeColumn?: string; // board-driven: the flow's `approved` column (the Merge button's), missing = MERGE_COLUMN
      workColumns?: string[]; // board-driven: the flow's columns from `doing` to `approved` excluded (workColumns), missing = none
      flow?: FlowAgentState[]; // board-driven: the flow agents' live states (task thread header chip), missing = none
      wakeAgent?: string; // the agent « Send to <agent> » wakes from a Bar message, when this person may wake agents there; missing = no such action
      presence?: Presence[]; lastSeen?: LastSeen } // who is connected in the space (protocol/presence.ts), then `presence.changed`
  // Reply to threads.page: the next THREADS_PAGE threads by activity (may repeat a thread already received: keep the
  // highest `version`); cursor null = end of the list.
  | { v: 2; type: 'threads.page'; space: string; threads: PublicThread[]; seen: SeenMark[]; cursor: string | null }
  // Reply to metrics.get.
  | { v: 2; type: 'metrics'; space: string; metrics: SpaceMetrics }
  // Reply to lineage.get.
  | { v: 2; type: 'lineage'; space: string; lineage: SpaceLineage }
  // reactions: those of the thread (on: false included, for the client's `at` guard).
  // more: older messages exist before the first one sent (ask with `before` = its id); `before` echoed.
  // threadInfo: public view of the thread, so a thread not loaded in the list yet (Board link, old link) can be shown.
  | { v: 2; type: 'history'; thread: string; messages: Message[]; truncated: boolean; summary: ThreadSummary | null; reactions: Reaction[]; before?: string; more?: boolean;
      threadInfo?: PublicThread }
  // Search answer, `q` echoed (the client drops answers to an older query). `threads`: public view of every thread
  // of `hits` (title, space, archived). `more`: other matches past SEARCH_MAX_HITS.
  | { v: 2; type: 'search'; q: string; space?: string; since?: number; hits: SearchHit[]; threads: PublicThread[]; more: boolean } // space/since echoed
  | { v: 2; type: 'labels'; client_id: string; thread: string; labels: RepoLabel[] }
  | { v: 2; type: 'push.key'; client_id: string; key: string }
  | { v: 2; type: 'push.saved'; client_id: string; on: boolean }
  | { v: 2; type: 'merge'; client_id: string; thread: string; merge: MergeInfo }
  | { v: 2; type: 'details'; client_id: string; details: ThreadDetails }
  | { v: 2; type: 'details.prs'; client_id: string; thread: string; prs: PrState[]; errors: PrError[] }
  | { v: 2; type: 'upload.ready'; client_id: string; file: FileRef; post: { url: string; fields: Record<string, string> } }
  | { v: 2; type: 'files.urls'; urls: Record<string, string> }
  | { v: 2; type: 'pong' };

/** A search match: in a message (`msg`, field text or file name) or in the thread's title (no `msg`). Newest first, titles first. */
export interface SearchHit { thread: string; msg?: string; field: 'text' | 'file' | 'title'; author?: Message['author']; at: number; snippet: string }

/** Living summary of a thread, written by the agent with its turn outcome (`thread.outcome.summary`). The Bedrock
 *  pipeline (hub/src/summarize.ts, 60 s after a turn) is dormant: not wired in the stack while the account is blocked. */
export interface ThreadSummary {
  thread: string;
  at: number; // end of the summarized turn
  status: string;
  decisions: string[];
  next_steps: { who: string; what: string }[];
  waiting_on: string | null;
}
export type TurnSummary = Omit<ThreadSummary, 'thread' | 'at'>;

/** Introspection (`space.threads`): one conversation of the list, with its summary when the agent wrote one. */
export type IntrospectThread = Pick<PublicThread, 'id' | 'kind' | 'title' | 'author' | 'owner' | 'from' | 'state' | 'archived' | 'outcome' | 'usage' | 'updatedAt'>
  & { summary?: TurnSummary };
/** A message as an agent reads it back: no attachment content (names only), no secret, no preview session. */
export type IntrospectMessage = Pick<Message, 'id' | 'at' | 'author' | 'type' | 'text'> & Partial<Pick<Message, 'ask' | 'propose' | 'ci' | 'stop' | 'deleted' | 'edited' | 'notice'>>
  & { files?: string[] };
/** Introspection (`thread.read`): newest messages kept, oldest first; `more` = older messages left, read them with `before`. */
export interface IntrospectRead { thread: PublicThread; summary: ThreadSummary | null; messages: IntrospectMessage[]; events: ThreadEvent[]; more: boolean;
  names: Record<string, string> }

const oneLine = (x: unknown, max: number): string | null => {
  if (typeof x !== 'string') return null;
  const s = x.replace(/\s+/g, ' ').trim();
  return s && s.length <= max ? s : null;
};
/** Checks and normalizes a summary sent by an agent (every field on one line, within the limits above). null = refused. */
export function cleanTurnSummary(x: unknown): TurnSummary | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const status = oneLine(o.status, SUMMARY_STATUS_MAX);
  const dec = o.decisions ?? [], next = o.next_steps ?? [];
  if (!status || !Array.isArray(dec) || !Array.isArray(next) || dec.length > SUMMARY_ITEMS_MAX || next.length > SUMMARY_ITEMS_MAX) return null;
  const decisions = dec.map(d => oneLine(d, SUMMARY_ITEM_MAX));
  const next_steps = next.map((e: any) => e && typeof e === 'object' ? { who: oneLine(e.who, SUMMARY_WHO_MAX), what: oneLine(e.what, SUMMARY_ITEM_MAX) } : null);
  if (decisions.some(d => d === null) || next_steps.some(e => !e || e.who === null || e.what === null)) return null;
  const w = o.waiting_on;
  if (w !== undefined && w !== null && typeof w !== 'string') return null;
  const waiting_on = typeof w === 'string' && w.trim() ? oneLine(w, SUMMARY_WAITING_MAX) : null;
  if (typeof w === 'string' && w.trim() && !waiting_on) return null;
  return { status, decisions: decisions as string[], next_steps: next_steps as { who: string; what: string }[], waiting_on };
}

/** Item of the GitHub Project linked to a space (read every 5 min, never written except issue creation). */
export interface GhItem {
  id: string;
  kind: 'issue' | 'pr' | 'draft';
  title: string;
  status: string | null; // Project "Status" column
  state: string;         // OPEN, CLOSED, MERGED, DRAFT
  number?: number;
  url?: string;
  repo?: string;
  assignees: string[];
  labels?: string[];
  /** Colour of each label (same order as `labels`), 6 lowercase hex digits validated by the hub, '' = none. Additive (no bump). */
  labelColors?: string[];
  thread?: string; // board-driven space: the issue's thread
}
/** `error: 'not_installed'`: the GitHub App is not installed on the Project's organization (items empty, project = owner #number). */
export interface GhSnapshot { space: string; at: number; project: { title: string; url: string }; items: GhItem[]; error?: 'not_installed' }

/** Personal pin of a thread or a topic; `on: false` = unpinned (kept for the `at` guard). */
export interface Pin { thread: string; space: string; on: boolean; at: number }
/** Personal mute of a space (one per person and space, kept when turned off for the `at` guard). */
export interface Mute { space: string; on: boolean; at: number }

/** Personal read mark: the person read `thread` up to its `updatedAt` = `at` (hub clock). */
export interface SeenMark { thread: string; at: number }

/** A person's reaction to a message. `at`: client clock (guard); `hubAt`: hub clock (agent context). */
export interface Reaction { thread: string; msg: string; emoji: string; user: string; on: boolean; at: number; hubAt: number }

/**
 * The agent's hand per space: it works on at most `Parallel.max` threads at once (1 in strict mode),
 * `holders`, and keeps each until the task is finished (`done` outcome announced by it, "Done", Closed, Idea, archiving
 * or "Release" by a trusted human), even while waiting for an answer. Other threads where a trusted human writes to it
 * wait in `queue`, in arrival order; a thread picked up again goes back to the end of the queue. Lounge topics are not in it.
 * `version` grows on every write: the client keeps the highest.
 */
/** Context of a talk turn while queued (deliver.context.queued). */
export type QueuedTalk = { position: number; holder?: string };
export interface AgentLock { space: string; agent: string; holders: string[]; queue: string[]; since: number; version: number }
/**
 * A shared resource of the space (`Parallel.resources`): held by one thread at a time (`holder`, its agent `agent`),
 * from `resource.acquire` to `resource.release` or the end of that turn (also freed by Done, Closed, Idea, archiving,
 * "Release"). `queue`: parked threads, in arrival order. `version` guard like AgentLock.
 */
export interface ResourceLock { space: string; resource: string; holder: string | null; agent: string | null; queue: string[]; since: number; version: number }

// gone: former agent of the space. role: function shown to humans (« Blair · Gérant »), never sent to agents, no right attached.
// avatar: profile photo (validAvatar data URL), the initial on a colour otherwise; a human sets theirs, an admin an agent's per space.
export interface Person { id: string; name: string; kind: 'human' | 'agent'; gone?: boolean; role?: string; avatar?: string }
/** Admin directory entry; invite set while an invited account has never signed in. */
// role: the person's function (the same in every space), absent when none.
export interface DirectoryPerson { id: string; name: string; role?: string; invite?: 'pending' | 'expired' }
/** Display name chosen by the person (profile): spaces collapsed, 1 to MAX_NAME characters, no control or bidi character, no @ (mentions). */
export const MAX_NAME = 40;
export const validName = (x: unknown): string | null => {
  if (typeof x !== 'string') return null;
  const n = x.normalize('NFC').replace(/\s+/g, ' ').trim();
  return n.length >= 1 && n.length <= MAX_NAME && !/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff@]/.test(n) ? n : null;
};
/**
 * Function (role) shown next to a name: spaces collapsed, 0 to MAX_ROLE characters ('' = none), no control or bidi
 * character. Display only: no right depends on it, and it is never sent to an agent.
 */
export const MAX_ROLE = 60;
export const validRole = (x: unknown): string | null => {
  if (typeof x !== 'string') return null;
  const n = x.normalize('NFC').replace(/\s+/g, ' ').trim();
  return n.length <= MAX_ROLE && !/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/.test(n) ? n : null;
};
/**
 * Profile photo: a data URL of a png, jpeg or webp image, MAX_AVATAR characters at most ('' = none, the initial shows).
 * Never SVG (it can carry script). The client crops it square and shrinks it to AVATAR_PX in webp; the hub checks the
 * prefix, the base64 alphabet and the file signature, so the bytes are the type announced. Stored in the space record
 * and sent with the member list: no S3, no expiring link, no outside service.
 */
export const MAX_AVATAR = 16_384;
export const AVATAR_PX = 96;
export const AVATAR_MIME = ['image/webp', 'image/png', 'image/jpeg'] as const;
const AVATAR_SIG: Record<string, (head: string) => boolean> = {
  'image/png': b => b.startsWith('\x89PNG\r\n\x1a\n'), 'image/jpeg': b => b.startsWith('\xff\xd8\xff'),
  'image/webp': b => b.startsWith('RIFF') && b.slice(8, 12) === 'WEBP' };
export const validAvatar = (x: unknown): string | null => {
  if (x === '') return '';
  if (typeof x !== 'string' || x.length > MAX_AVATAR) return null;
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(x);
  if (!m || m[2].length % 4 !== 0 || m[2].length < 16) return null;
  let head: string;
  try { head = atob(m[2].slice(0, 16)); } catch { return null; }
  return AVATAR_SIG[m[1]](head) ? x : null;
};
/** Name comparison ignoring case, accents, spaces and . _ - (two people must not differ only by those). */
export const nameKey = (n: string) => n.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[\s._-]+/g, '');

/**
 * Agent invitation (Settings). state: pending (code not redeemed, before expiresAt), expired (pending past expiresAt),
 * used (redeemed, the instance never connected yet), connected (its instance subscribed at least once), revoked.
 */
export interface AgentInvite { id: string; space: string; agent: string; by: string; at: number; expiresAt: number;
  state: 'pending' | 'expired' | 'used' | 'connected' | 'revoked'; usedAt?: number; renew?: true }
export const AGENT_INVITE_TTL_MS = 24 * 3600 * 1000;
export const AGENT_CODE_BYTES = 24; // 192 bits, base64url (32 characters)
export const AGENT_CODE_RE = /^[A-Za-z0-9_-]{32}$/;

// join: connection opened with an invitation code (id = its SHA-256, hex); it can only send `agent.join`.
// visitor: connection opened with a visitor link (id = its preview line); preview frames of that line only.
export type Principal = { kind: 'human'; id: string } | { kind: 'instance'; id: string } | { kind: 'join'; id: string } | { kind: 'visitor'; id: string };
/** What a visitor connection sends (protocol/preview.ts « Visitor link »): the line comes from the connection. */
export type VisitorFrame =
  | { v: 2; type: 'preview.open'; client_id: string }
  | { v: 2; type: 'preview.offer'; session: string; sdp: string }
  | { v: 2; type: 'preview.close'; session: string }
  | { v: 2; type: 'ping' };

/** A line « Next » of a summary opened as a thread (`Thread.nextOpened`). */
export interface NextOpened { what: string; thread: string }
/** A pending lead recalled at a conversation's start (`Thread.leadsRecalled`, protocol/leads.ts). */
export interface LeadRecalled {
  id: string; from: string; fromTitle: string; what: string; at: number;
  /** Who the summary line was for (« planned for »), as the summary wrote it; absent on recalls stored before Nov 18. */
  who?: string;
  /** The thread or topic it became: a thread opened from the summary line (`next.open`, older `lead.open`), or the topic
   *  of `lead.open` (« discuss it apart »). */
  thread?: string;
  /** What a lead decided for it, once (hub/src/leads.ts): taken in this conversation (`lead.take`), discussed apart in a
   *  topic (`lead.open`), opened as a thread (`next.open`), deleted from the Leads view. Absent: still to decide (or,
   *  with `thread`, a thread opened before Nov 18). Public: every member sees the same decision. */
  decided?: LeadDecision;
}
export interface LeadDecision { how: 'here' | 'topic' | 'thread' | 'dropped'; by: string; at: number }
/** Lines kept per thread: the oldest go first (their link only, the threads stay). */
export const NEXT_OPENED_MAX = 30;
