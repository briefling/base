// briefling client v0 (PWA): in-app Cognito sign-in (client/src/login.ts), hub WebSocket, Now / thread / composer.
// Security: no innerHTML, all received content goes through textContent; access token in sessionStorage, refresh token in localStorage (client/src/tokens.ts)
// (lost when the tab closes); strict CSP set by CloudFront.
import { keepFrame, shownFrame, BROWSER_STALE_MS, BROWSER_STILL_MS } from '../../protocol/browser.ts';
import type { BrowserFrame } from '../../protocol/browser.ts';
import { ciWorst, ciTip, ciTone, ciRef, ciRunning, commitUrl, ciLineParts, ciLineTail, checkUrl } from './ci.ts';
import { renderMarkdown } from './markdown.ts';
import type { HubFrame, Message, PublicThread, ThreadState, Person, ThreadSummary, GhSnapshot, FileRef, Pin, Mute, Reaction, AgentLock, ResourceLock, Parallel, SpaceInfo, SearchHit, Driver, RepoLabel, SeenMark, CiReport } from '../../protocol/frames.ts';
import { settingsModule, type AdminData, type SettingsModule } from './settingsview.ts';
import { canEditLabels, fixedLabel, pickable, sameLabel } from './labels.ts';
import { canMerge, mergeStale, mergeView, type MergeEntry } from './merge.ts';
import { codeBlocks, duration, timelineRows, type Prs, type TimelineRow } from './details.ts';
import type { ThreadDetails } from '../../protocol/frames.ts';
import type { SearchPeriod } from '../../protocol/search.ts';
import { jumpTarget } from './search.ts';
import { msgRoute, splitMsg, linkUrl } from './link.ts';
import { REACTIONS, PROTOCOL, DEFAULT_PARALLEL } from '../../protocol/frames.ts';
import { shrinkAvatar } from './avatar.ts';
import { upsertVersioned, lockKey, resourceKey, normalizeLock, posIn, parkedOn, heldWithQueue, keepsPlace, placeOf, waitOrder } from './locks.ts';
import { alertKind, becameYours, lastAnswer, tabTitle } from './notify.ts';
import { isMyTurn, yourTurnFor } from '../../protocol/notify.ts';
import { NOTIF_CACHE, NOTIF_CHANNEL, NOTIF_KEY, b64urlToBytes, notifMsg, pendingTarget, pushApp, pushPlan, sameKey, setBadge, showAskBanner, type BadgeNav } from './push.ts';
import { spaceGroups } from './spacegroups.ts';
import { applyMute, mutedSet, mutesOf, type Mutes } from './mute.ts';
import { noteTyping, TYPING_TTL_MS, type Typing } from './typing.ts';
import { turnOf, myTurn, turnLabel, summaryTone, summaryWaits } from './turnof.ts';
import { askDone, type AskPick } from './ask.ts';
import { busyCounts, workingAgents, statusKey, pruneStatus, progressOf } from './busy.ts';
import { hasBoard, boardGroups, listGroups, boardModeKey, parseBoardMode, itemLabels, labelInk, boardWorking, type BoardMode } from './board.ts';
import { topicName, isGeneral, loungeTopics, generalOf, generalStub, subtopicLink, topicOrigin, topicCardWhen, subtopicOpens, type SubtopicOrigin } from './lounge.ts';
import { DELETED_TITLE, generalId, isGeneralId } from '../../protocol/frames.ts';
import { deletable } from '../../protocol/edit.ts';
import { dotOf, localState, stuckAgents, stuckKey, presLine, roster, withAgents, type Dot, type LastSeen, type Presence, type PresenceState } from '../../protocol/presence.ts';
import { familyIds, rowMark, spawnedCounts, topicFamily } from './spawned.ts';
import { ownWrites } from './own.ts';
import { syncMarks, mergeMarks, markRead } from './seen.ts';
import { convOrder } from './order.ts';
import { planStepThreads } from './plan.ts';
import { bgCount, bgLine, bgTasks, bgTip, bgWork } from './background.ts';
import { agentDone, shelfOf, laterOf, closedOf, closedAt, shelfCounts, followView } from './shelves.ts';
import { whereText } from './where.ts';
import { remember, reopen, type LastConv } from './lastconv.ts';
import { newPaging, onPage, hasMore, takeNext, cancel, cursorAt } from './paging.ts';
import { buildFeed, feedGrouped, namesPlus, pluginRunInfo, pluginRuns } from './feed.ts';
import { unreadMark, type UnreadMark } from './unread.ts';
import { unreadFab, fabDir, type FabTopic } from './unreadfab.ts';
import { GAP_LOUNGE, GAP_THREAD, groupPrev, groupsUnder } from './grouping.ts';
import { dueExchanges } from './exchanges.ts';
import { toSort } from './radar.ts';
import { moduleOn, type Module } from '../../protocol/modules.ts';
import { isModuleView, type ClientModule, type ModuleView, type UiKit } from './modules.ts';
import { remindersModule } from './remindersview.ts';
import { nextStepsView } from './nextstepsview.ts';
import { leadsModule } from './leadsview.ts';
import { memoryModule, type MemoryModule } from './memoryview.ts';
import { workflowEditor, type WorkflowEditor } from './workflowview.ts';
import { metricsModule, type MetricsModule } from './metricsview.ts';
import { lineageModule, type LineageModule } from './lineageview.ts';
import { recentsModule, type RecentsModule } from './recentsview.ts';
import { exchangesModule, type ExchangesModule } from './exchangesview.ts';
import { radarModule, type RadarModule } from './radarview.ts';
import { cardsModule, type Cards } from './cards.ts';
import { appletsModule, type Applets } from './appletsview.ts';
import { installSummaryFold } from './sumfold.ts';
import { installRoute, phoneOs, pinHead } from './pinapp.ts';
import { previewModule } from './previewview.ts';
import { viewerModule } from './viewerview.ts';
import { attachmentsModule, composerModule } from './composerview.ts';
import { loginModule } from './loginview.ts';
import { paletteModule } from './paletteview.ts';
import { shortcutsModule } from './shortcutsview.ts';
import { feedOf, foldRuns, techRow } from './tech.ts';
import { steadyActivity } from './activity.ts';
import { viewOn, VIEW_MODULE, SP_TABS, isSpTab } from './spaces.ts';
import { parseRoute as parseRouteOf, routeOf, type View } from './route.ts';
import { t, tn, ordinal, quote, lang, setLang, hasKey, type Key } from './i18n.ts';
import { on, cur, patch, type Change } from './patch.ts';
import { insertedKind, litKind, capBursts, vtDir, play, reduced, type Kind, type Screen } from './motion.ts';
import { fmtDur, peaksOf, playedBars, FLAT_PEAKS } from './audio.ts';
import { atBottom, convPlan, keyboardUp, newAbove, NEAR, pagePanned, viewportStuck, WAKE_MS } from './scroll.ts';
import { onHistory, nextOlder, claimOlder, hasOlder, olderFailed, type Older } from './older.ts';
import { newTopWatch, watchTop, pinScroll } from './topsentinel.ts';
import { isNewBuild } from './version.ts';
import { costLabel, costTitle, usdLabel, splitRows, reasoningShare, type SplitRow } from './cost.ts';
import { capGauge, chipOf, durationLabel, flowStatus, spent } from './flowstate.ts';
import type { CostBucket, FlowAgentState, FlowTaskRow, Usage } from '../../protocol/frames.ts';
import { costSplit } from '../../protocol/frames.ts';
import { encryptSecret, secretFormError, suggestName } from './secret.ts';
import { SECRET_KINDS, SECRET_VALUE_MAX, type SecretKind } from '../../protocol/secret.ts';
import { paneOf, backBy, cardActions, longPress } from './mobile.ts';
import { loungeLayout, threadView } from './split.ts';
import { applyCols, grips, type PaneLayout } from './panes.ts';
import { newBoot, onSubscribed, onSynced, splash, unloaded, nextCheck, TIMEOUT } from './boot.ts';
import { reconnector } from './reconnect.ts';
import { authorizeQuery } from './auth.ts';
import { refresh, revoke, type Idp, type Tokens } from './login.ts';
import { saveTokens as storeTokens, readTokens as loadTokens, clearTokens } from './tokens.ts';
import { takeLocalToken, localToken, forgetLocalToken } from './localauth.ts';
import { machineModule } from './machineview.ts';
import { serverUpdateModule } from './serverupdate.ts';
import { oidcClient, type OidcCfg } from './oidc.ts';
import { noteUndelivered, agentActive, noticeAfter, type UndeliveredMap } from './undelivered.ts';
import { pencilOn, type Editing } from './edit.ts';
import { growAll } from './autogrow.ts';

// No space list in the config: the hub gives each user their own at `subscribe`.
// `authDomain`: Managed Login (fallback sign-in page); `idpUrl`: Cognito's API endpoint of the region (in-app sign-in).
// `previewUrl`: origin of the agent web previews (no trailing slash); absent = the feature is off (no button).
// `local`: standalone server without OIDC (hub/src/server.ts): its admin token stands for the Cognito one (localauth.ts).
// `oidc`: standalone server with an OIDC provider (hub/src/oidc.ts): sign-in at that issuer (client/src/oidc.ts), no Cognito.
type Cfg = { clientId: string; authDomain: string; idpUrl: string; wsUrl: string; previewUrl?: string; local?: { user: string }; oidc?: OidcCfg };

const cfg: Cfg = await (await fetch('/config.json', { cache: 'no-store' })).json();
const REDIRECT = `${location.origin}/`;
const PK = 'briefling.pkce';
const idp: Idp = { url: cfg.idpUrl, clientId: cfg.clientId, fetch: (u, i) => fetch(u, i) };
const oidc = cfg.oidc ? oidcClient(cfg.oidc, REDIRECT, sessionStorage) : null;
if (cfg.local) { const rest = takeLocalToken(location.hash, localStorage); if (rest !== null) history.replaceState(null, '', `${location.pathname}${location.search}${rest}`); }
// « Install » from the Android app opened Chrome on `/?install=<space>/<applet>` (an intent URL has no fragment): its route
{ const r = installRoute(location.search); if (r) history.replaceState(null, '', `${location.pathname}${r}`); }

// ---------------------------------------------------------------- auth
// In-app sign-in screen (loginView, Cognito API in client/src/login.ts). The Cognito Managed Login page (code + PKCE,
// hostedLogin) stays reachable from a link on that screen until the in-app one is validated.
const b64url = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b))))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rand = () => b64url(crypto.getRandomValues(new Uint8Array(32)));

async function hostedLogin(): Promise<never> {
  const verifier = rand(), state = rand();
  sessionStorage.setItem(PK, JSON.stringify({ verifier, state, route: location.hash })); // the route survives the Cognito round trip
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const q = authorizeQuery({ clientId: cfg.clientId, redirectUri: REDIRECT, state, challenge, lang: lang() });
  location.assign(`https://${cfg.authDomain}/oauth2/authorize?${q}`);
  return new Promise<never>(() => {});
}
async function tokenCall(body: Record<string, string>): Promise<Tokens | null> {
  const r = await fetch(`https://${cfg.authDomain}/oauth2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: cfg.clientId, ...body }) });
  if (!r.ok) return null;
  const j = await r.json();
  return { access: j.access_token, refresh: j.refresh_token ?? body.refresh_token, exp: Date.now() + j.expires_in * 1000 };
}
const saveTokens = (t: Tokens) => storeTokens(sessionStorage, localStorage, t);
async function handleCallback() {
  if (oidc) {
    const back = await oidc.callback(new URL(location.href)).catch(() => null); // refused: signed out, sign in again
    if (back !== null || /[?&](code|error)=/.test(location.search)) history.replaceState(null, '', '/' + (back?.route ?? ''));
    if (back) saveTokens(back.tokens);
    return;
  }
  const q = new URLSearchParams(location.search);
  const code = q.get('code'); if (!code) return;
  const pk = JSON.parse(sessionStorage.getItem(PK) ?? 'null');
  sessionStorage.removeItem(PK);
  history.replaceState(null, '', '/' + (typeof pk?.route === 'string' && pk.route.startsWith('#/') ? pk.route : ''));
  if (!pk || q.get('state') !== pk.state) return; // CSRF: unknown state, the code is ignored
  const t = await tokenCall({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: pk.verifier });
  if (t) saveTokens({ ...t, hosted: true });
}
const readTokens = (): Tokens | null => loadTokens(sessionStorage, localStorage);
async function accessToken(): Promise<string> {
  if (cfg.local) return localToken(localStorage) ?? localMissing();
  const t = readTokens();
  if (t && t.exp - Date.now() > 120_000) return t.access;
  if (oidc) { // expired or none: back through the issuer (no refresh token, client/src/oidc.ts)
    clearTokens(sessionStorage, localStorage);
    return signedOut ? oidcSignedOut() : oidc.login(location.hash);
  }
  if (t?.refresh) {
    const n = await refresh(idp, t.refresh, Date.now()); // a network failure throws: connect() is retried (client/src/reconnect.ts), still signed in
    if (n) { saveTokens({ ...n, hosted: t.hosted }); return n.access; }
    clearTokens(sessionStorage, localStorage); // refused (expired, revoked): not tried again at the next start
  }
  return login();
}
/** Standalone server, no token stored: only the URL its console printed signs in. */
function localMissing(): Promise<never> {
  window.clearTimeout(bootTimer);
  document.body.replaceChildren(h('p', { class: 'local-missing' }, t('local_open_link')));
  return new Promise<never>(() => {});
}
/** OIDC, after a logout: a button, not an automatic redirect (the provider's own session would sign in again at once). */
const signedOut = sessionStorage.getItem('briefling.signedout') === '1';
function oidcSignedOut(): Promise<never> {
  window.clearTimeout(bootTimer);
  document.body.replaceChildren(h('p', { class: 'local-missing' }, t('oidc_signed_out'), ' ',
    h('button', { class: 'btn', onclick: () => { sessionStorage.removeItem('briefling.signedout'); void oidc!.login('') } }, t('oidc_sign_in'))));
  return new Promise<never>(() => {});
}
async function logout() {
  if (oidc) {
    await pushLogout().catch(() => {}); await setBadge(navigator as BadgeNav, 0);
    sessionStorage.clear(); clearTokens(sessionStorage, localStorage); sessionStorage.setItem('briefling.signedout', '1');
    location.assign(REDIRECT); return;
  }
  if (cfg.local) { forgetLocalToken(localStorage); sessionStorage.clear(); location.assign('/'); return; }
  await pushLogout().catch(() => {}); // this device stops receiving this person's pushes
  await setBadge(navigator as BadgeNav, 0); // the next person must not see this one's count
  const tk = readTokens();
  // Revoked at Cognito (bounded wait: the device forgets the tokens anyway).
  if (tk?.refresh) await Promise.race([revoke(idp, tk.refresh).catch(() => false), new Promise(r => window.setTimeout(r, 3000))]);
  sessionStorage.clear(); clearTokens(sessionStorage, localStorage);
  // Signed in through Managed Login: its own session cookie ends too, otherwise its page would sign in again without a password.
  location.assign(tk?.hosted ? `https://${cfg.authDomain}/logout?${new URLSearchParams({ client_id: cfg.clientId, logout_uri: REDIRECT })}` : REDIRECT);
}

// Sign-in screen and profile dialog: client/src/loginview.ts, built on first use (the boot state below must exist).
let LG: ReturnType<typeof loginModule> | undefined;
const lg = () => LG ??= loginModule(kitOf(), S, { idp, rand, hostedLogin, saveTokens, B, stopBoot: () => window.clearTimeout(bootTimer), themeSwitch, langBtn,
  iconBtn, withRole, personRole, avatarField, pickAvatar, oidc: !!oidc });
const login = () => lg().login();
// OIDC: the hub's user id is not the provider's `sub` (an invitation exists before the first sign-in): `subscribed` says it.
const mySub = (tok: string) => cfg.local ? cfg.local.user : oidc ? S.me : JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub as string;

// ---------------------------------------------------------------- state
const S = {
  me: '', conn: 'off' as 'off' | 'on' | 'retry',
  view: { kind: 'now' } as View,
  spaces: null as SpaceInfo[] | null, // the user's spaces, given by the hub (null before the answer)
  admin: false,                        // global admin role: create and configure spaces (the hub checks again on every frame)
  adm: null as AdminData | null,        // Settings data (client/src/settingsview.ts)
  // "Draft with the agent" panel of the settings (space id, typed repos and notes), and the draft card the admin
  // applied, waiting for the settings form of its space to be built (then put into the brief field, never saved).
  aboutAsk: null as { space: string; repos: string; notes: string; err: string } | null,
  aboutApply: null as { space: string; text: string; base: string; thread: string; msg: string } | null,
  briefOpen: new Set<string>(), // propose cards whose long brief was unfolded (message ids)
  askPicks: new Map<string, AskPick[]>(), // « To decide » cards: the picks not sent yet (card id -> one per point)
  askSent: new Set<string>(),             // « To decide » cards whose answer was sent (no second click)
  pins: new Map<string, Pin>(),        // personal pins (hub), per thread; the most recent (`at`) wins
  typing: new Map() as Typing,         // who else is typing, per conversation (client/src/typing.ts)
  mutes: new Map() as Mutes,           // personal mutes (hub), per space (client/src/mute.ts)
  mutedOpen: false,                    // the sidebar's « Muted » group unfolded (this tab only)
  reacts: new Map<string, Map<string, Reaction>>(), // per thread: `${msg}|${emoji}|${user}` -> reaction (the most recent wins)
  picker: '' as string,            // message whose reaction picker is open
  github: new Map<string, GhSnapshot | null>(),
  flow: new Map<string, Map<string, FlowAgentState>>(), // flow agents' live states per space (synced.flow, flowstate.updated)
  flowTasks: new Map<string, FlowTaskRow[]>(), // Board flow block: the latest closed tasks per space (flowstate.get)
  flowPause: new Map<string, { cid: string; err: string }>(), // `${space}|${agent}`: Pause / Resume sent, its refusal
  presence: new Map<string, Presence[]>(),    // who is connected, per space (synced, then presence.changed)
  lastSeen: new Map<string, LastSeen>(),      // when each one not connected was last seen, per space (same frames)
  presOpen: '',                                // space whose « not connected » list is unfolded in the Lounge header
  repos: new Map<string, string[]>(),
  subtopicCid: '', // client_id of « Reply as topic » on a General message: its ack opens the topic
  subtopicAt: { space: null, sel: null } as SubtopicOrigin, // screen it was sent from (subtopicOpens)
  newTopicCid: '', // client_id of the topic just posted from the Lounge composer: its ack opens the new topic
  sel: null as string | null,      // open thread, or 'new'
  threads: new Map<string, PublicThread>(),
  msgs: new Map<string, Map<string, Message>>(),
  loaded: new Set<string>(),
  people: new Map<string, Person[]>(), // directory per space (mentions)
  mySpaces: null as Set<string> | null, // spaces we are a member of (null until the hub answers)
  summaries: new Map<string, ThreadSummary>(),
  browser: new Map<string, { f: BrowserFrame; got: number; prev?: string }>(), // statusKey -> last capture of the agent's browser (protocol/browser.ts) + the one before (crossfade), ephemeral
  status: new Map<string, { text: string | null; rev: number; since?: number; steps?: number; recent?: string[] }>(), // what the agent is doing (ephemeral, during a turn)
  feedOpen: new Set<string>(), // statusKey of the activity feeds unfolded under a working line (this tab only)
  undelivered: new Map() as UndeliveredMap, // thread -> message no connection of the agent received (ephemeral)
  locks: new Map<string, AgentLock>(), // `${space}|${agent}` -> threads holding the hand and queue
  resources: new Map<string, ResourceLock>(), // `${space}|${resource}` -> thread holding the shared resource and queue
  parallel: new Map<string, Parallel>(),      // parallel work settings per space (from synced)
  driver: new Map<string, Driver>(),          // who drives the work per space (synced, space.updated); missing = briefling
  mergeCol: new Map<string, string>(),        // board-driven space: the flow's approved column (synced.mergeColumn)
  workCols: new Map<string, string[]>(),      // board-driven space: the flow's work columns (synced.workColumns)
  trusted: new Set<string>(),                 // spaces where I am a trusted human (synced; display only, the hub checks)
  contributors: new Map<string, string[]>(),  // leads only: the space's contributors, to invite into a thread (synced)
  wakeAgent: new Map<string, string>(),  // space → agent « Send to <agent> » wakes from a Bar message, when I may (synced)
  labelPick: null as { thread: string; cid: string; labels: RepoLabel[] | null; err: string } | null, // open label picker
  labelBusy: new Set<string>(),               // `${thread}|${label}` sent, waiting for the GitHub Lambda's line
  // Thread info panel: open or not (kept per browser), and its data per thread (asked again when the thread moves).
  info: localStorage.getItem('briefling.info') === '1',
  details: new Map<string, { cid: string; key: string; data: ThreadDetails | null; prs: Prs | null; err: string }>(),
  merge: new Map<string, MergeEntry>(),       // thread -> Merge button state (asked to GitHub on demand, issue in « To merge »)
  paging: newPaging(),                        // thread list pages per space (infinite scroll)
  below: '',  // thread showing the "New messages ↓" pill (scrolled up when a message arrived)
  above: '',  // list pane (data-k) showing the "New ↑" pill (scrolled down when an item arrived above)
  shown: { thread: '', count: -1 }, // conversation of the last render and its message count (-1: not loaded)
  err: '',
  // Narrow screens: sidebar drawer open; touch long-press menu (bottom sheet) of a list card or a message.
  drawer: false,
  menu: null as { kind: 'card' | 'space'; id: string } | { kind: 'msg' | 'select' | 'next'; thread: string; id: string } | null, // select = « Select text » page
  // Search result being opened: older history pages are asked until `msg` is loaded, then it is scrolled to and
  // flashed (`flash`, cleared after the animation).
  jump: null as { thread: string; msg: string; asked?: string } | null,
  older: new Map() as Older, // per conversation: older messages left above (infinite scroll up)
  prepended: '', // conversation that just got an older page above: the next render keeps the reader's place
  flash: '',
  // Edit of one's last message (↑ in the empty composer, client/src/edit.ts): confirm the stop of a working agent,
  // wait for its turn end, then the text in the composer. One at a time, cancelled when the conversation changes.
  editing: null as Editing | null,
};
// Search palette (⌘K): query typed, answer of the hub for that query, keyboard selection.
// all/period: scope of the palette (reset on each opening); asked: scope of the last frame sent, matched against the answer.
// rs: selection in the recents list shown while nothing is typed.
const P = { open: false, q: '', hits: [] as SearchHit[], threads: new Map<string, PublicThread>(), more: false, wait: false, sel: 0, rs: 0,
  all: false, period: 'all' as SearchPeriod, asked: { scope: '', space: undefined as string | undefined, since: undefined as number | undefined } };
const label = (st: ThreadState) => t(`state_${st}`);
/** A thread's state label: « To approve » for Your turn on a command approval (hub `pendingApproval`), else its state. */
const rowStateLabel = (f: PublicThread, st: ThreadState) => st === 'you' && f.pendingApproval ? t('state_approve') : label(st);
/** Optional modules of a space as its members see them (protocol/modules.ts; missing = all on). */
const modsOf = (space: string) => S.spaces?.find(s => s.id === space)?.modules;
const modOn = (space: string, m: Module) => moduleOn(modsOf(space), m);
/** I am flagged « not technical » in this space (SpaceInfo.nontech): technical details fold behind « Details » (tech.ts). */
const nontech = (space: string) => !!S.spaces?.find(s => s.id === space)?.nontech;
/** Settings of this space open to me: global admin, or admin of this space (SpaceInfo.admin); the hub checks again on every frame. */
const spaceAdmin = (space: string) => S.admin || !!S.spaces?.find(s => s.id === space)?.admin;
/** `el` as is, or folded behind « Details » for a non-technical reader of `space` (nothing removed, one click unfolds it). */
const techFold = (space: string, el: HTMLElement | null, label: string = t('tech_details')) =>
  el && nontech(space) ? h('details', { class: 'tech-fold' }, h('summary', {}, label), el) : el;
/** Markdown options of a message or a card of `space`: code blocks (diffs, tool output, logs) folded for a non-technical reader. */
const mdOpts = (space: string) => nontech(space) ? { fold: t('tech_details') } : undefined;
const spaceName = (id: string) => S.spaces?.find(s => s.id === id)?.name ?? S.adm?.spaces.find(s => s.id === id)?.name ?? id;
const personName = (id: string) => { for (const ps of S.people.values()) { const p = ps.find(x => x.id === id); if (p) return p.name; } return null; };
/** A human's function is the same in every space; an agent's is set per space (Settings), hence `space`. */
const personRole = (id: string, space?: string) => {
  for (const [s, ps] of S.people) { if (space && s !== space) continue; const p = ps.find(x => x.id === id); if (p?.role) return p.role; }
  return '';
};
/** Photo of a person ('' = their initial): a human's is the same everywhere, an agent's is set per space (Settings). */
const personAvatar = (id: string, kind: string, space?: string) => {
  if (kind === 'system') return '';
  for (const [s, ps] of S.people) { if (kind === 'agent' && space && s !== space) continue; const p = ps.find(x => x.id === id && x.kind === kind); if (p?.avatar) return p.avatar; }
  return '';
};
/** Inside an avatar: the photo (same shape as the box, CSS) or the initial. */
const face = (src: string, name: string): Node => src ? h('img', { class: 'av-img', src, alt: '', draggable: 'false' }) : document.createTextNode(name.slice(0, 1).toUpperCase());
/** « Joachim · Product owner »: what a hover or a suggestion shows (name alone without a function). */
const withRole = (name: string, role: string) => role ? `${name} · ${role}` : name;
const who = (m: Message) => m.author.kind === 'agent' ? m.author.id[0].toUpperCase() + m.author.id.slice(1) : m.author.id === S.me ? t('you') : m.author.kind === 'system' ? 'briefling' : personName(m.author.id) ?? t('member_id', { id: m.author.id.slice(0, 6) });
// Dates and times through Intl, in the UI language.
const hhmm = (ts: number) => new Date(ts).toLocaleTimeString(lang(), { hour: '2-digit', minute: '2-digit' });
const fullDate = (ts: number) => new Date(ts).toLocaleString(lang(), { dateStyle: 'full', timeStyle: 'short' });
/** "just now", "5 min ago", "3 h ago", then the date. */
const since = (ts: number) => { const s = (Date.now() - ts) / 1000; return s < 60 ? t('time_now') : s < 3600 ? t('time_min_ago', { n: Math.floor(s / 60) }) : s < 86400 ? t('time_h_ago', { n: Math.floor(s / 3600) }) : new Date(ts).toLocaleDateString(lang(), { day: 'numeric', month: 'short' }) + ` · ${hhmm(ts)}`; };
// Colour by class (the CSP forbids inline style attributes).
const avatarClass = (a: Message['author']) => a.kind !== 'human' ? `av-${a.kind}` : `av-${[...a.id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7) % 7}`;
const ago = (ts: number) => { const s = (Date.now() - ts) / 1000; return s < 60 ? t('time_now') : s < 3600 ? t('ago_min', { n: Math.floor(s / 60) }) : s < 86400 ? t('ago_h', { n: Math.floor(s / 3600) }) : t('ago_d', { n: Math.floor(s / 86400) }); };

// ---------------------------------------------------------------- read / unread (per person on the hub, localStorage = offline cache)
// A thread is unread if it moved since the last time it was opened, on any device. First run on a device: threads
// with no mark at all (neither here nor on the hub) count as read.
const SEEN_KEY = 'briefling.seen';
const seen: Record<string, number> = (() => { try { return JSON.parse(localStorage.getItem(SEEN_KEY) ?? 'null') ?? {}; } catch { return {}; } })();
const firstRun = localStorage.getItem(SEEN_KEY) === null;
const saveSeen = () => localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
// Not through send(): offline it calls render() again. A mark not sent is sent again by the next sync (local > hub).
const sendMarks = (space: string, marks: SeenMark[]) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ v: 2, type: 'seen', space, marks })); };
function syncSeen(space: string, threads: PublicThread[], hub: SeenMark[]) {
  const r = syncMarks(seen, hub, threads, firstRun);
  if (r.changed) saveSeen();
  for (const marks of r.upload) sendMarks(space, marks);
}
function readNow(f: PublicThread) { const m = markRead(seen, f); if (m) { saveSeen(); sendMarks(f.space, [m]); } }
// "Seen" on the hub side: the agent's reply (end of turn `unseen`) shown in a visible tab takes the thread out of "Your turn".
const seenSent = new Map<string, number>(); // thread -> end of turn already reported (one frame per reply)
function markSeen() {
  const f = S.sel && S.sel !== 'new' ? S.threads.get(S.sel) : null;
  // Read only when shown: a tab left open in the background must not mark it read on the other devices.
  if (f && document.visibilityState === 'visible') readNow(f);
  // Lounge feed on screen (the list pane, alone on a phone only without a conversation open): General is being read.
  const g = shownGeneral();
  if (g && document.visibilityState === 'visible') readNow(g);
  // Not through send(): offline it calls render() again, hence markSeen(). A lost frame is sent again on reconnection.
  if (f?.unseen && seenSent.get(f.id) !== f.unseen && document.visibilityState === 'visible' && ws?.readyState === WebSocket.OPEN) {
    seenSent.set(f.id, f.unseen); ws.send(JSON.stringify({ v: 2, type: 'thread.seen', thread: f.id, at: f.unseen }));
  }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { render(); checkVersion(); } });
const unread = (f: PublicThread) => S.sel !== f.id && f.updatedAt > (seen[f.id] ?? 0);
// « New messages » marker (rules: unread.ts), Bar feed and topics only: each one on screen keeps the read mark it had
// when it came on screen, since markSeen moves it at once; dropped when it leaves the screen. `pillOff`: its
// « ↑ N unread » pill was used, or its marker came into view. `unreadJump`: the conversation whose marker the next
// renders scroll to, paging back until it is loaded (`unreadAfter`).
const frozen = new Map<string, number | undefined>(), pillOff = new Set<string>();
let unreadJump = '';
// Bar feed's floating pill (unreadfab.ts): topic cards it already took the reader to, for as long as the feed stays on
// screen; its Bar messages part is `pillOff` (the « New messages » line reached).
const fabDone = new Set<string>();
/** What the feed's last render gave the pill, to redraw the pill alone when a card comes on screen (`fabRefresh`). */
let fabLast: { gid: string; u: UnreadMark | null; topics: FabTopic[] } | null = null;
/** The pill's last arrow (`fabArrow`), so a render draws it right away; the oldest target is most often above. */
let fabUp = true;
function freezeMarks() {
  if (S.view.kind !== 'lounge' || (S.sel && narrow())) fabDone.clear();
  const on = [S.sel && S.sel !== 'new' ? S.threads.get(S.sel) : undefined, shownGeneral() ?? undefined]
    .filter((f): f is PublicThread => f?.kind === 'topic').map(f => f.id);
  for (const id of [...frozen.keys()]) if (!on.includes(id)) { frozen.delete(id); pillOff.delete(id); if (unreadJump === id) unreadJump = ''; }
  for (const id of on) if (!frozen.has(id)) frozen.set(id, seen[id]);
}
// Called once the history is loaded. Nothing unread then = no marker for the rest of the visit: a message arriving while
// the reader is there is not « new since last time » (the frozen mark would otherwise put the line above it).
function unreadOf(id: string, msgs: Message[]): UnreadMark | null {
  if (!frozen.has(id)) return null;
  const u = unreadMark(msgs, frozen.get(id), S.me, hasOlder(S.older, id));
  if (!u.first) frozen.set(id, Infinity);
  return u;
}
// The user's own message is read even if the thread was never displayed (topic posted, view left before the ack).
const own = ownWrites();
function ownSeen(f: PublicThread) { if (own.own(f.id)) readNow(f); }

// ---------------------------------------------------------------- theme
type Theme = 'auto' | 'light' | 'dark';
const applyTheme = (th: Theme) => { if (th === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', th); };
let theme: Theme = (['auto', 'light', 'dark'] as const).find(th => th === localStorage.getItem('briefling.theme')) ?? 'auto';
applyTheme(theme);
function themeSwitch() {
  const b = (th: Theme, text: string) => h('button', { class: theme === th ? 'on' : '', title: th === 'auto' ? t('theme_auto_title') : '',
    onclick: () => { theme = th; localStorage.setItem('briefling.theme', th); applyTheme(th); render(); } }, text);
  return h('div', { class: 'theme', role: 'group', 'aria-label': t('theme') }, b('auto', t('theme_auto')), b('light', t('theme_light')), b('dark', t('theme_dark')));
}
/** EN/FR next to the bell: one toggle (pressed = French), saved in localStorage, re-renders without a reload. */
function langBtn() {
  const fr = lang() === 'fr';
  return h('button', { class: 'btn ic lang', type: 'button', title: t('lang_switch'), 'aria-label': t('lang_switch'), 'aria-pressed': String(fr),
    onclick: () => { setLang(fr ? 'en' : 'fr'); render(); syncPush(); } }, t('lang_code')); // push text follows the language
}

// ---------------------------------------------------------------- alerts (thread becoming Your turn)
// Open tab only (Notification API, no Web Push nor service worker): when a thread becomes Your turn
// while the tab is hidden or unfocused, system notification (in front of the app: pop only, except the open thread) (thread title, never a message excerpt)
// and a small synthesized "pop" (Web Audio: no file, nothing to load). Permission asked on a click, never at load.
const AL_KEY = 'briefling.bell';
// A single bell: on = notification (if the browser allows it) + pop + Web Push of this device; struck through = nothing.
// On by default (Blair, Oct 2026). The permission can only be asked on a click: while it was never asked, a click on the
// active bell asks for it instead of turning alerts off.
const alerts = { on: localStorage.getItem(AL_KEY) !== 'off' };
const saveAlerts = () => localStorage.setItem(AL_KEY, alerts.on ? 'on' : 'off');
const notifPerm = () => 'Notification' in window ? Notification.permission : 'unsupported';
// The browser only allows sound after a gesture on the page: audio context created on the first click or key press.
let audio: AudioContext | null = null;
const unlockAudio = () => { if (!alerts.on) return; audio ??= new AudioContext(); if (audio.state === 'suspended') void audio.resume(); };
for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, unlockAudio, { capture: true });
function pop() {
  if (!audio) return;
  if (audio.state === 'suspended') void audio.resume();
  const at = audio.currentTime, o = audio.createOscillator(), g = audio.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(420, at); o.frequency.exponentialRampToValueAtTime(1100, at + 0.06);
  g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.3, at + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
  o.connect(g).connect(audio.destination); o.start(at); o.stop(at + 0.13);
}
let lastPop = 0;
/** Your turn: only the humans concerned by the thread (protocol/notify.ts), like its Web Push. */
function alertYours(f: PublicThread) {
  if (yourTurnFor(f.people, S.me, muted(f.space))) alertThread(f.id, f.title, t(f.pendingApproval ? 'notif_approve_short' : 'notif_body', { space: spaceName(f.space) }), lastAnswer(S.msgs.get(f.id)?.values() ?? []));
}
/** A new message the hub addressed to me (`notify` of the event: a human's, or the first one of a topic an agent opened
 *  on its own): same alert, « <name> wrote · <space> ». */
function alertMessage(m: Message, notify: string[] | undefined) {
  if (!S.me || !notify?.includes(S.me) || m.author.kind === 'system' || m.author.id === S.me) return;
  const f = S.threads.get(m.thread);
  if (!f || f.memoryReview) return; // a thread this tab never loaded (past the first page): its Web Push still goes
  const name = m.author.kind === 'agent' ? cap(m.author.id) : S.people.get(f.space)?.find(p => p.id === m.author.id)?.name ?? m.author.id.slice(0, 6);
  alertThread(f.id, f.title, t('notif_msg_body', { name, space: spaceName(f.space) }), m.id);
}
/** `msg`: the message the alert is about; a click on the notification jumps to it (goMessage). */
function alertThread(thread: string, title: string, body: string, msg: string | null) {
  if (!alerts.on) return;
  const kind = alertKind(document.visibilityState !== 'visible' || !document.hasFocus(), S.sel === thread);
  if (kind === 'none') return;
  if (Date.now() - lastPop > 1500) { lastPop = Date.now(); pop(); } // several threads at once (reconnection): a single pop
  if (kind !== 'both' || notifPerm() !== 'granted') return; // in front of the app: the pop is enough
  if (pushOn) return; // this device gets the Web Push: the service worker shows it (one notification, not two)
  try {
    // tag = thread: a new notification of the same thread replaces the previous one. silent: the pop is enough.
    const n = new Notification(title, { body, tag: thread, silent: true });
    n.onclick = () => { window.focus(); n.close(); goMessage(thread, msg); };
  } catch { /* browser requiring a service worker: no notification, the pop and the counter remain */ }
}
/** Thread update received from the hub: reports the switch to Your turn (never a thread already Your turn at load). */
/** Conversation the user just posted in from its Later/Closed shelf (shelves.ts `followView`): '' when none. */
let posted = '';
/** Before sending a post: remember it when the open conversation sits on the shelf shown, so the view can follow it. */
const notePosted = (f: PublicThread) => { posted = (S.view.kind === 'later' || S.view.kind === 'closed') && S.sel === f.id ? f.id : ''; };
/** After a thread update: the conversation the user reopened by posting leaves the shelf, the view goes with it. */
function followPosted(id: string) {
  const f = S.threads.get(id);
  const to = f && followView(S.view, S.sel, posted, f);
  if (to) { S.view = to; posted = ''; }
}
function upsertThreadAlert(f: PublicThread) {
  if (f.memoryReview) return; // the memory agent's hidden review conversation: never listed
  const before = S.threads.get(f.id);
  upsertThread(f);
  const after = S.threads.get(f.id)!;
  if (becameYours(before, after)) alertYours(after);
}
/** Bell at the bottom of the sidebar: a click turns alerts on (and asks for the permission the first time) or off. */
function bellBtn() {
  const perm = notifPerm();
  const text = !alerts.on ? t('bell_off') : perm === 'default' ? t('bell_allow') : perm !== 'granted' ? t('bell_sound_only') : pushOn ? t('bell_on_push') : t('bell_on');
  return iconBtn(alerts.on ? 'bell' : 'bellOff', text, async () => {
    if (alerts.on && perm === 'default') { unlockAudio(); await Notification.requestPermission(); render(); syncPush(); return; }
    alerts.on = !alerts.on; saveAlerts();
    if (alerts.on) { unlockAudio(); pop(); if (perm === 'default') await Notification.requestPermission(); }
    render(); syncPush();
  }, { class: `btn ic bell ${alerts.on ? 'on' : ''}`, 'aria-pressed': String(alerts.on) });
}

// ---------------------------------------------------------------- PWA + Web Push (this device)
// Service worker (client/src/sw.ts): app shell + Web Push. Push follows the bell: on with the permission granted = this
// device is (re-)subscribed at every connection (hub `USER#<sub>/PUSH#<id>`, refreshed lang); off or logout = forgotten.
// iOS: PushManager only exists in the installed app (Add to Home Screen); a Safari tab keeps the open-tab alerts.
// iOS 26+ installed app: the system blurs the page top under the status bar unless a fixed opaque element touches the
// top edge; the `ios-app` class shows that element (`.topcap`, style.css). Detected with `navigator.standalone` (iOS
// only): `(display-mode: standalone)` reports false in an iOS 27 home-screen app.
if ((navigator as Navigator & { standalone?: boolean }).standalone === true) document.documentElement.classList.add('ios-app');
// iOS (app or Safari tab): its form bar (arrows + ✓) floats over the bottom of the visual viewport, style.css `html.ios.kb-up`.
if (phoneOs(navigator.userAgent, navigator.maxTouchPoints) === 'ios') document.documentElement.classList.add('ios');
const PUSH_OWNER = 'briefling.pushOwner';
const ASK_LATER = 'briefling.askLater';
const installed = () => matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
/** Installed app whose permission was never asked (iOS resets it at reinstall): one tap asks it (gesture required). */
function askBanner() {
  if (!pushApp(location.pathname) || !showAskBanner(installed(), pushSupported(), notifPerm(), alerts.on, localStorage.getItem(ASK_LATER) === '1')) return null;
  return h('div', { class: 'askperm', role: 'status', 'data-k': 'askperm' }, icon('bell', 14) as unknown as Node, h('span', {}, t('ask_notif')),
    h('button', { class: 'btn pri', type: 'button', onclick: async () => { unlockAudio(); await Notification.requestPermission(); render(); syncPush(); } }, t('ask_notif_on')),
    h('button', { class: 'linkbtn', type: 'button', onclick: () => { localStorage.setItem(ASK_LATER, '1'); render(); } }, t('ask_notif_later')));
} // who this browser's subscription was made for (another account drops it)
const swReady: Promise<ServiceWorkerRegistration | null> = 'serviceWorker' in navigator
  ? navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then(() => navigator.serviceWorker.ready).catch(() => null)
  : Promise.resolve(null);
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
let pushOn = false; // this device is subscribed hub-side (bell tooltip; the page then leaves the notification to the worker)
const pending = new Map<string, (f: HubFrame | null) => void>();
/** One request/answer on the socket (client_id = ref): the answer, or null on refusal, closed socket or after `ms`. */
function request(f: { type: string; [k: string]: unknown }, ms = 5000, raw = false): Promise<HubFrame | null> {
  const client_id = rand().slice(0, 20);
  return new Promise(res => {
    const done = (x: HubFrame | null) => { if (pending.delete(client_id)) res(raw || x?.type !== 'error' ? x : null); };
    pending.set(client_id, done);
    if (ws?.readyState !== WebSocket.OPEN) return done(null);
    ws.send(JSON.stringify({ v: 2, ...f, client_id }));
    window.setTimeout(() => done(null), ms);
  });
}
/** Answer to a `request` (push.key, push.saved, or an error with its ref): consumed, never shown as an error banner. */
function answered(f: HubFrame): boolean {
  const ref = f.type === 'push.key' || f.type === 'push.saved' || f.type === 'secret.key' || f.type === 'ack' || f.type === 'preview.visitor' || f.type === 'exchange.list' || f.type === 'exchange.get' || f.type === 'exchange.body' || f.type === 'correspondent.list' || f.type === 'applet.list' || f.type === 'pinapp.state' || f.type === 'upload.ready' || f.type === 'applet.runs' || f.type === 'applet.result' || f.type === 'reminder.list' || f.type === 'reminder.saved' || f.type === 'lead.list' ? f.client_id : f.type === 'error' ? f.ref : undefined;
  const done = ref ? pending.get(ref) : undefined;
  if (!done) return false;
  done(f);
  return true;
}
let pushBusy: Promise<void> = Promise.resolve();
/** Aligns this device with the bell; serialised (a click during a connection waits for it). Never throws. */
function syncPush() { pushBusy = pushBusy.then(doSyncPush).catch(() => {}).then(() => render()); }
async function doSyncPush() {
  const reg = await swReady;
  if (!reg || !pushSupported() || S.conn !== 'on') return;
  let sub = await reg.pushManager.getSubscription();
  // a pinned applet's own app never notifies (briefling's app does): one it subscribed before is dropped
  if (!pushApp(location.pathname)) { if (sub) await dropPush(sub); pushOn = false; return; }
  const plan = pushPlan(alerts.on, true, notifPerm(), !!sub, localStorage.getItem(PUSH_OWNER), S.me);
  if (plan === 'off') { pushOn = false; return; }
  if (plan === 'unsubscribe') { await dropPush(sub!); sub = null; if (!alerts.on || notifPerm() !== 'granted') return; }
  const k = await request({ type: 'push.key' });
  if (k?.type !== 'push.key') { pushOn = false; return; } // no key on this hub: open-tab alerts only
  if (sub && !sameKey(sub.options.applicationServerKey, k.key)) { await sub.unsubscribe(); sub = null; } // key rotated
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(k.key) });
  localStorage.setItem(PUSH_OWNER, S.me);
  const j = sub.toJSON();
  const r = await request({ type: 'push.subscribe', sub: { endpoint: j.endpoint, keys: j.keys }, lang: lang() });
  pushOn = r?.type === 'push.saved' && r.on;
}
/** Forgets this device: hub first (while the socket is up), then the browser (its endpoint then answers 410 anyway). */
async function dropPush(sub: PushSubscription) {
  await request({ type: 'push.unsubscribe', endpoint: sub.endpoint }, 1500);
  await sub.unsubscribe().catch(() => false);
  localStorage.removeItem(PUSH_OWNER); pushOn = false;
}
/** Logout: bounded wait, the redirect to Cognito follows anyway. */
async function pushLogout() {
  const reg = await Promise.race([swReady, new Promise<null>(r => window.setTimeout(() => r(null), 1000))]);
  const sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
  if (sub) await dropPush(sub);
}
// Notification click while a tab is open: the service worker focuses it and asks it to open the thread.
navigator.serviceWorker?.addEventListener('message', (e: MessageEvent) => { if (openNotif(e.data)) render(); });
/** A tapped notification's target (the worker's `open` message, or the one stored for a cold start): routes to it,
 *  false when it is not one. */
function openNotif(x: unknown): boolean {
  const d = x as { type?: string; space?: unknown; thread?: unknown; msg?: unknown; view?: unknown } | null;
  // Memory reminder: the space's Memory view (the hub re-checks membership on memory.list).
  if (d?.type === 'open' && d.view === 'memory' && typeof d.space === 'string') { applyRoute(routeOf({ kind: 'memory', id: d.space }, null)); return true; }
  if (d?.type === 'open' && d.view === 'radar' && typeof d.space === 'string') { applyRoute(routeOf({ kind: 'radar', id: d.space }, null)); return true; }
  if (d?.type === 'open' && isModuleView(d.view) && typeof d.space === 'string') { applyRoute(routeOf({ kind: d.view, id: d.space }, null)); return true; }
  if (d?.type !== 'open' || typeof d.thread !== 'string' || !d.thread || typeof d.space !== 'string') return false;
  const msg = notifMsg(d.msg), route = routeOf({ kind: 'space', id: d.space }, d.thread);
  if (S.threads.has(d.thread)) goMessage(d.thread, msg);
  else applyRoute(msg ? msgRoute(route, msg) : route); // the message link: same jump once the thread loads
  return true;
}
/** Notification tapped while the worker listed no window: the target it stored before openWindow() (iOS drops the URL's hash on a cold start, and may list no window for an app in the background,
 *  then brings it back without reloading it; see NotifTarget). Read at start and back in the foreground, once (deleted);
 *  older than NOTIF_TTL = nothing to open. True when it routed. */
async function takeNotifTarget(): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  try {
    const c = await caches.open(NOTIF_CACHE), res = await c.match(NOTIF_KEY);
    if (!res) return false;
    await c.delete(NOTIF_KEY);
    const t = pendingTarget(await res.json().catch(() => null), Date.now());
    return !!t && openNotif({ type: 'open', ...t });
  } catch { return false; /* no Cache API (private mode): the URL's route stands */ }
}
const notifWake = () => { if (document.visibilityState === 'visible') void takeNotifTarget().then(ok => { if (ok) render(); }); };
document.addEventListener('visibilitychange', notifWake);
window.addEventListener('focus', notifWake);
// App on screen when the tap came (iOS listed no window): the worker pings this channel after storing the target.
if (typeof BroadcastChannel !== 'undefined') new BroadcastChannel(NOTIF_CHANNEL).onmessage = () => void takeNotifTarget().then(ok => { if (ok) render(); });

// ---------------------------------------------------------------- navigation (History API)
// The URL reflects the view and the open conversation: a refresh or Back/Forward brings you back there.
// Hash (#/…): CloudFront only serves the root, and the OAuth return (?code=) doesn't touch the hash (routes: route.ts).
const parseRoute = (hash: string) => parseRouteOf(hash, S.spaces?.map(s => s.id) ?? null);
let lastRoute = '';
/** Called on every render: pushes a history entry when the view or the conversation changes. */
function syncUrl() {
  const r = routeOf(S.view, S.sel);
  if (r === lastRoute) return;
  // `prev`: the route this entry came from, so the narrow layout's Back button can pop instead of pushing (mobile.ts backBy).
  if (location.hash !== r) history[lastRoute ? 'pushState' : 'replaceState'](lastRoute ? { prev: lastRoute } : null, '', r);
  lastRoute = r;
}
function applyRoute(hash: string) {
  const { route, msg } = splitMsg(hash), { view, sel } = parseRoute(route);
  if (view.kind !== S.view.kind) mem().clearNotices(); // memory notices belong to the page that asked
  S.view = view; S.sel = sel; S.err = '';
  lastRoute = routeOf(view, sel);
  if (location.hash !== lastRoute) history.replaceState(null, '', lastRoute); // unknown or empty route, message link: URL normalized
  // Message link: same jump as a search result (history walked back to the message, scrolled to, flashed).
  S.jump = sel && sel !== 'new' && msg ? { thread: sel, msg } : null;
  if (sel && S.jump && S.loaded.has(sel)) walkBack(sel, [...(S.msgs.get(sel)?.keys() ?? [])].sort()[0]); // ids are time-sortable
  else if (sel) loadHistory(sel);
}
window.addEventListener('popstate', () => { S.drawer = false; S.menu = null; applyRoute(location.hash); render(); });
// ---------------------------------------------------------------- socket
let ws: WebSocket | null = null, ping: number | undefined, resub: number | undefined;
// Retries (client/src/reconnect.ts): a failed connect() (token refresh thrown offline) is retried like a lost WebSocket.
const conn = reconnector(connect, (e) => { console.warn('hub connection failed', e); S.conn = 'retry'; render(); },
  { set: (fn, ms) => window.setTimeout(fn, ms), clear: (id) => window.clearTimeout(id) });
/** Waiting out the backoff (up to 30 s): reconnect now. Back online, tab shown again, « Reconnecting… » banner clicked. */
const reconnectNow = () => { if (online && conn.now()) render(); };
// First load (client/src/boot.ts): the index.html splash stays until every space answered, then never comes back;
// afterwards a lost connection shows the `.netbar` banner instead. `online`: browser network state (events below).
const B = newBoot(Date.now());
// index.html puts the splash inside #app (an older cached bundle then renders over it): out of #app before any render.
document.body.append(document.getElementById('splash') ?? '');
let online = navigator.onLine, bootTimer: number | undefined;
function bootTick() {
  const now = Date.now(), spaces = S.mySpaces ?? [], sp = splash(B, spaces, now), el = document.getElementById('splash');
  if (el && sp.kind !== 'gone') {
    el.classList.toggle('slow', sp.kind === 'slow' || !online);
    el.querySelector('.msg')!.textContent = !online ? t('net_offline') : sp.kind === 'slow' ? t('hub_silent') : '';
    if (sp.kind === 'leave') { B.out = true; el.classList.add('out'); window.setTimeout(() => el.remove(), 450); } // after the CSS fade
  }
  // Wakes up at the next deadline only (min display, hub or space TIMEOUT): render() then also refreshes the « not loaded » marks.
  window.clearTimeout(bootTimer);
  const d = nextCheck(B, spaces, now);
  if (d !== null) bootTimer = window.setTimeout(() => B.subscribed ? render() : bootTick(), d + 5);
}
function netChange() {
  online = navigator.onLine;
  reconnectNow();
  render();
}
window.addEventListener('online', netChange);
window.addEventListener('offline', netChange);
// New front version (client/src/version.ts): checked when the hub connection opens, when the tab is shown again and every
// 10 min. Never reloads by itself: a draft being typed would be lost. Click = fetch the new files past every cache, reload.
declare const __BUILD__: string; // compiled in by scripts/build-client.ts
declare const __VOICE_WORKLET__: string; // same: /voice-worklet.js?v=<hash>
let updateReady = false;
async function checkVersion() {
  if (updateReady) return;
  try {
    const r = await fetch('/version.json', { cache: 'no-store' });
    if (r.ok && isNewBuild(__BUILD__, await r.json())) { updateReady = true; render(); }
  } catch { /* offline, or no file (local dev): the next check retries */ }
}
window.setInterval(checkVersion, 10 * 60_000);
async function reloadApp() {
  await Promise.allSettled(['/app.js', '/style.css'].map(u => fetch(u, { cache: 'reload' })));
  location.reload();
}
/** « New version available · Reload » pill, where the connection banner goes (that one wins while it is shown). */
function updatebar() {
  if (!updateReady || !B.out) return null;
  return h('button', { class: 'netbar update', type: 'button', 'data-k': 'updatebar', onclick: reloadApp },
    icon('refresh', 14) as unknown as Node, h('span', {}, t('update_ready'), ' · ', h('b', {}, t('update_reload'))));
}
/** Leads of the current space: its connected agents whose plugin is behind and will not update by itself (protocol/plugin.ts
 *  stuckOf), with why; the admin gets a link to Settings › Agents. Same place as the pill above (they win while shown). */
function agentbar() {
  const space = S.view.kind === 'now' || S.view.kind === 'newspace' ? null : S.view.id;
  if (!B.out || !space || !S.trusted.has(space)) return null;
  const stuck = stuckAgents(S.presence.get(space));
  if (!stuck.length) return null;
  // One line (names only, the reasons in the tooltip), dismissed per space until the set of agents or reasons changes.
  const key = stuckKey(stuck), store = `briefling.agentbar.${space}`;
  if (localStorage.getItem(store) === key) return null;
  const name = (id: string) => id[0].toUpperCase() + id.slice(1);
  const why = stuck.map(x => `${name(x.id)} : ${t(`stuck_${x.stuck}` as Key)}`).join('\n');
  return h('div', { class: 'netbar stuck', role: 'status', 'data-k': 'agentbar', title: why }, icon('refresh', 14) as unknown as Node,
    h('span', { class: 'stuck-t' }, t('agents_stuck', { list: stuck.map(x => name(x.id)).join(', ') })),
    spaceAdmin(space) ? h('a', { href: routeOf({ kind: 'settings', id: space, tab: 'agents' }, null) }, t('agents_stuck_see')) : null,
    h('button', { type: 'button', class: 'stuck-x', 'data-k': 'agentbar-x', 'aria-label': t('agents_stuck_dismiss'),
      onclick: () => { localStorage.setItem(store, key); render(); } }, icon('x', 14) as unknown as Node));
}
/** Connection banner once the app is shown: browser offline, or WebSocket lost and reconnecting. */
function netbar() {
  if (!B.out || (online && S.conn !== 'retry')) return null;
  if (!online) return h('div', { class: 'netbar off', role: 'status', 'data-k': 'netbar' }, icon('wifiOff', 14) as unknown as Node, t('net_offline'));
  // Click = reconnect now, never a page reload (a draft being typed would be lost).
  return h('button', { class: 'netbar', type: 'button', role: 'status', 'data-k': 'netbar', title: t('conn_retry_now'), onclick: reconnectNow },
    icon('refresh', 14) as unknown as Node, h('span', {}, t('conn_retry'), ' · ', h('b', {}, t('conn_retry_now'))));
}
// Presence (protocol/presence.ts): this tab reports 'away' after AWAY_MS without input, 'active' at the next one; only
// the transitions are sent. A hidden tab gets no input, so it turns away after the same delay.
let lastInput = Date.now(), presSent: PresenceState = 'active';
function presenceTick() {
  const st = localState(lastInput, Date.now());
  if (st !== presSent && ws?.readyState === WebSocket.OPEN) { ws.send(JSON.stringify({ v: 2, type: 'presence.set', state: st, ...(st === 'away' ? { idle: lastInput } : {}) })); presSent = st; }
}
const presenceInput = () => { lastInput = Date.now(); if (presSent === 'away') presenceTick(); };
for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) window.addEventListener(ev, presenceInput, { passive: true, capture: true });
// Scrolling up or a plain click in a thread's messages folds its Summary (client/src/sumfold.ts); the chevron reopens it.
installSummaryFold(() => { const sc = document.querySelector('.conv details.sumcard') as HTMLDetailsElement | null; if (sc) sc.open = false; });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { presenceInput(); reconnectNow(); } });
// Each minute: the state above, and the relative times of the Lounge's « Who is here » (idle · 25 min, seen 3 h ago).
window.setInterval(() => { presenceTick(); if (S.view.kind === 'lounge') render(); }, 60_000);
const send = (f: object) => { if (ws?.readyState === WebSocket.OPEN) { own.sent(f); ws.send(JSON.stringify({ v: 2, ...f })); return true } S.err = t('err_offline'); render(); return false; };
async function connect() {
  const tok = await accessToken();
  S.me = mySub(tok);
  ws = new WebSocket(cfg.wsUrl, [PROTOCOL, tok]);
  ws.onopen = () => {
    conn.opened(); S.conn = 'on'; S.err = ''; S.loaded.clear(); feedAsked.clear(); olderFailed(S.older); seenSent.clear(); own.reset();
    send({ type: 'subscribe' }); // the hub picks: every space we are a member of
    // No answer (failed Lambda): asked again every TIMEOUT on this socket (subscribe is idempotent hub-side) until `subscribed`.
    window.clearInterval(resub); resub = window.setInterval(() => send({ type: 'subscribe' }), TIMEOUT);
    // sync only for accepted spaces (`subscribed` answer): no error for a space we are not a member of
    if (S.sel && S.sel !== 'new') loadHistory(S.sel);
    ping = window.setInterval(() => send({ type: 'ping' }), 5 * 60_000); // API Gateway cuts after 10 min without traffic
    render();
    checkVersion(); // back after a deploy (the hub too may have moved): is the front still the served one?
  };
  ws.onmessage = (e) => onFrame(JSON.parse(String(e.data)) as HubFrame);
  ws.onclose = () => {
    window.clearInterval(ping); window.clearInterval(resub); S.conn = 'retry';
    closePreview(); // its session belongs to this connection: a new one can't send its offer
    render();
    conn.failed();
  };
}
function upsertThread(f: PublicThread) { if (f.memoryReview) return; if (f.title === DELETED_TITLE) f = { ...f, title: t('msg_deleted') }; const cur = S.threads.get(f.id); if (!cur || f.version > cur.version) S.threads.set(f.id, f); }
function upsertMsg(m: Message) {
  if (!S.msgs.has(m.thread)) S.msgs.set(m.thread, new Map());
  const cur = S.msgs.get(m.thread)!.get(m.id);
  if (cur?.rev && m.rev && m.rev < cur.rev) return; // broadcast of an older edit arriving late
  S.msgs.get(m.thread)!.set(m.id, m);
}
function upsertLock(l: AgentLock) { const n = normalizeLock(l); upsertVersioned(S.locks, lockKey(n), n); }
function upsertResource(r: ResourceLock) { upsertVersioned(S.resources, resourceKey(r), r); }
function upsertPin(p: Pin) { const cur = S.pins.get(p.thread); if (!cur || cur.at < p.at) S.pins.set(p.thread, p); }
// Personal pin: applied right away, confirmed by the hub (pin.updated to our own connections only).
// Client clock for the `at` guards (pins, reactions): strictly increasing, even on a double click.
let lastAt = 0;
const tick = () => lastAt = Math.max(Date.now(), lastAt + 1);
/** Personal mute of a space (client/src/mute.ts): applied right away, confirmed by the hub (`mute.updated`). */
const muted = (space: string) => mutedSet(S.mutes).has(space);
function toggleMute(space: string) {
  const m: Mute = { space, on: !muted(space), at: tick() };
  if (send({ type: 'mute.set', space, on: m.on, at: m.at })) { applyMute(S.mutes, m); render(); }
}
function togglePin(f: PublicThread) {
  const p: Pin = { thread: f.id, space: f.space, on: !pinned(f), at: tick() };
  if (send({ type: 'pin', thread: p.thread, on: p.on, at: p.at })) { upsertPin(p); render(); }
}
function upsertReaction(x: Reaction) {
  if (!S.reacts.has(x.thread)) S.reacts.set(x.thread, new Map());
  const m = S.reacts.get(x.thread)!, k = `${x.msg}|${x.emoji}|${x.user}`, cur = m.get(k);
  if (!cur || cur.at < x.at) m.set(k, x);
}
/** Reactions shown on a message: per emoji (order of the fixed list), with who. */
function reactionsOf(m: Message): { emoji: string; users: string[] }[] {
  const all = [...(S.reacts.get(m.thread)?.values() ?? [])].filter(x => x.msg === m.id && x.on);
  return REACTIONS.map(e => ({ emoji: e as string, users: all.filter(x => x.emoji === e).sort((a, b) => a.at - b.at).map(x => x.user) })).filter(x => x.users.length);
}
function react(m: Message, emoji: string) {
  const on = !reactionsOf(m).find(x => x.emoji === emoji)?.users.includes(S.me);
  const x: Reaction = { thread: m.thread, msg: m.id, emoji, user: S.me, on, at: tick(), hubAt: 0 };
  S.picker = '';
  if (send({ type: 'react', thread: x.thread, msg: x.msg, emoji, on, at: x.at })) { upsertReaction(x); render(); }
}
const pinned = (f: PublicThread) => !!S.pins.get(f.id)?.on;
const live = (f: PublicThread) => !f.archived; // archived: hidden everywhere except in "Archived"
function upsertSummary(s: ThreadSummary) { const cur = S.summaries.get(s.thread); if (!cur || cur.at < s.at) S.summaries.set(s.thread, s); }
/** Error code from the hub, in plain words when we know it. */
const errText = (code: string) => { const k = `err_${code}`; return hasKey(k) ? t(k) : t('err_hub_refused', { code }); };
function onFrame(f: HubFrame) {
  if (answered(f)) return;
  if (onPreviewFrame(f)) return;
  if (f.type === 'subscribed') {
    window.clearInterval(resub); onSubscribed(B, f.spaces, Date.now());
    if (f.me) S.me = f.me;
    presSent = 'active'; presenceTick(); // a new subscription starts active hub-side: re-send away if we are
    watchSent = null; // a new subscription has no watched conversation hub-side: syncWatch sends it again at the render
    S.mySpaces = new Set(f.spaces); S.spaces = f.list ?? f.spaces.map(id => ({ id, name: id })); S.admin = !!f.admin; S.mutes = mutesOf(f.list ?? []); if (S.admin) SU?.start();
    mem().pendingFrom(f.list ?? []);
    // Route opened before the answer (refresh): space we are not a member of, or admin page without the role.
    if (S.view.kind === 'newspace' ? !S.admin : S.view.kind !== 'now' && (!S.mySpaces.has(S.view.id) || ((S.view.kind === 'settings' || S.view.kind === 'workflow') && !spaceAdmin(S.view.id)))) { S.view = { kind: 'now' }; S.sel = null; S.jump = null; }
    for (const sp of f.spaces) send({ type: 'sync', space: sp });
    syncPush(); // every connection: refreshes this device's subscription (or drops it if alerts are off)
  }
  else if (f.type === 'member.saved') { lg().profileSaved(f.client_id); st().memberSaved(f); } // the admin's edit of an invitee (Settings › Members)
  else if (st().frame(f)) { /* Settings: admin data, saves, invitations, pilots, routines, Radar config (client/src/settingsview.ts) */ }
  else if (wf().frame(f)) { /* workflow editor: answers and errors (client/src/workflowview.ts) */ }
  else if (rd().frame(f)) { /* Radar view (client/src/radarview.ts) */ }
  else if (f.type === 'profile.saved') { lg().profileSaved(f.client_id); }
  else if (f.type === 'error' && f.ref && lg().profileRefused(f.ref, f.code)) { /* error shown in the dialog */ }
  else if (f.type === 'error' && f.ref && f.ref === S.editing?.cid) { const th = S.threads.get(S.editing.thread); S.editing = null; editHint(f.code, th ? cap(th.owner) : ''); }
  else if (f.type === 'synced') { onSynced(B, f.space); for (const m of mods()) if (!m.module || modOn(f.space, m.module)) m.synced(f.space); ap().appletN.set(f.space, f.applets ?? 0); if (f.presence) S.presence.set(f.space, f.presence); if (f.lastSeen) S.lastSeen.set(f.space, f.lastSeen); f.threads.forEach(upsertThreadAlert); if (S.sel === generalId(f.space)) loadHistory(S.sel); syncSeen(f.space, f.threads, f.seen ?? []); S.people.set(f.space, f.people ?? []); S.github.set(f.space, f.github ?? null); S.repos.set(f.space, f.repos ?? []); (f.pins ?? []).forEach(upsertPin); (f.locks ?? []).forEach(upsertLock);
    (f.resources ?? []).forEach(upsertResource); S.parallel.set(f.space, f.parallel ?? DEFAULT_PARALLEL); onPage(S.paging, f.space, f.cursor ?? null);
    S.driver.set(f.space, f.driver ?? 'briefling'); if (f.mergeColumn) S.mergeCol.set(f.space, f.mergeColumn); else S.mergeCol.delete(f.space); S.workCols.set(f.space, f.workColumns ?? []); if (f.trusted) S.trusted.add(f.space); else S.trusted.delete(f.space); S.contributors.set(f.space, f.contributors ?? []); if (f.wakeAgent) S.wakeAgent.set(f.space, f.wakeAgent); else S.wakeAgent.delete(f.space);
    if (f.trusted && !ex().by.has(f.space)) void ex().list(f.space, true); // Your turn: exchanges ours for 3 days (no push)
    S.flow.set(f.space, new Map((f.flow ?? []).map(x => [x.agent, x]))); }
  else if (f.type === 'flowstate') { S.flow.set(f.space, new Map(f.agents.map(x => [x.agent, x]))); S.flowTasks.set(f.space, f.tasks); }
  else if (f.type === 'flowstate.paused') { for (const [k, e] of S.flowPause) if (e.cid === f.client_id) S.flowPause.delete(k); }
  else if (f.type === 'error' && f.ref && [...S.flowPause.values()].some(e => e.cid === f.ref)) { const e = [...S.flowPause.values()].find(e => e.cid === f.ref)!; e.cid = ''; e.err = errText(f.code); }
  else if (f.type === 'labels') { if (S.labelPick?.cid === f.client_id) S.labelPick.labels = f.labels; }
  else if (f.type === 'error' && f.ref && f.ref === S.labelPick?.cid) { S.labelPick.err = errText(f.code); }
  else if (f.type === 'details') { const e = S.details.get(f.details.thread); if (e?.cid === f.client_id) Object.assign(e, { data: f.details, err: '' }); }
  else if (f.type === 'details.prs') { const e = S.details.get(f.thread); if (e?.cid === f.client_id) e.prs = { prs: f.prs, errors: f.errors }; }
  else if (f.type === 'error' && f.ref && [...S.details.values()].some(e => e.cid === f.ref)) { const e = [...S.details.values()].find(e => e.cid === f.ref)!; e.err = errText(f.code); }
  else if (f.type === 'merge') { const e = S.merge.get(f.thread); if (e?.cid === f.client_id) Object.assign(e, { info: f.merge, err: '', busy: false, confirm: false }); }
  else if (f.type === 'error' && f.ref && [...S.merge.values()].some(e => e.cid === f.ref)) { const e = [...S.merge.values()].find(e => e.cid === f.ref)!; Object.assign(e, { err: errText(f.code), busy: false, confirm: false }); }
  // Next page of a list (infinite scroll): merged by version like live events, never an alert (old threads).
  else if (f.type === 'threads.page') { f.threads.forEach(upsertThread); syncSeen(f.space, f.threads, f.seen ?? []); onPage(S.paging, f.space, f.cursor); }
  else if (mx().frame(f)) { /* Metrics view (client/src/metricsview.ts) */ }
  else if (lin().frame(f)) { /* Flow view (client/src/lineageview.ts) */ }
  else if (mem().frame(f)) { /* memory: answers and events (client/src/memoryview.ts) */ }
  // threadInfo: a thread not loaded in the list yet (Board link, old link) becomes known and shows.
  else if (f.type === 'history') { if (f.threadInfo) upsertThread(f.threadInfo); f.messages.forEach(upsertMsg); (f.reactions ?? []).forEach(upsertReaction); S.loaded.add(f.thread); if (f.summary) upsertSummary(f.summary);
    onHistory(S.older, f.thread, { before: f.before, more: !!f.more, first: f.messages[0]?.id });
    if (f.before && f.messages.length && S.jump?.thread !== f.thread) S.prepended = f.thread;
    if (S.jump?.thread === f.thread) walkBack(f.thread, f.more ? f.messages[0]?.id : undefined); }
  else if (f.type === 'search') { if (P.open && f.q === P.q && f.space === P.asked.space && f.since === P.asked.since) { P.hits = f.hits; P.threads = new Map(f.threads.map(x => [x.id, x])); P.more = f.more; P.wait = false; P.sel = f.hits.length ? 0 : -1; } }
  else if (f.type === 'ack') {
    own.acked(f.client_id, f.thread); voiceAcked(f.client_id, f.msg_id);
    if (S.editing?.cid && f.client_id === S.editing.cid) S.editing = null; // edit stored: the composer goes back to the draft
    // A thread opened from a "Make it a thread?" card: no navigation, the user stays in the topic and the card
    // turns into a link card to the thread (`proposeEl`, status done).
    // Topic posted from the Lounge composer (`newTopic`, shown for 'new' and when nothing is selected): open it,
    // unless the user has meanwhile left the Lounge or opened something else.
    if (S.newTopicCid && f.client_id === S.newTopicCid) { S.newTopicCid = '';
      if (S.view.kind === 'lounge' && (S.sel === 'new' || !S.sel || !S.threads.has(S.sel))) { S.sel = f.thread; S.loaded.add(f.thread); } }
    // « Reply as topic » in General (its room, or the « All » feed with nothing selected): open the topic, unless the
    // user has meanwhile left the Lounge or opened another conversation.
    if (S.subtopicCid && f.client_id === S.subtopicCid) { S.subtopicCid = '';
      if (subtopicOpens(S.subtopicAt, S.view, S.sel)) { S.sel = f.thread; loadHistory(f.thread); } }
  }
  else if (f.type === 'upload.ready') { onUploadReady(f); return; }
  else if (f.type === 'files.urls') { const exp = Date.now() + 9 * 60_000; for (const [k, u] of Object.entries(f.urls)) fileUrls.set(k, { url: u, exp }); onUrls(); }
  else if (f.type === 'error' && f.ref && uploadFailed(f.ref, f.code)) { /* error shown on the chip */ }
  else if (f.type === 'error') { S.err = errText(f.code); S.labelBusy.clear(); if (f.code === 'not_connected' && S.editing?.phase === 'stopping') S.editing = null; }
  else if (f.type === 'event') {
    if (f.event === 'thread.upserted') { if (isGeneralId(f.data.id) && !S.threads.has(f.data.id)) S.loaded.add(f.data.id); upsertThreadAlert(f.data); followPosted(f.data.id); ownSeen(f.data); agentActive(S.undelivered, f.data.id, { state: f.data.state }); const cur = S.threads.get(f.data.id); if (cur) pruneStatus(S.status, cur); voiceOnThread(f.data); }
    else if (f.event === 'message.undelivered') noteUndelivered(S.undelivered, f.data);
    else if (f.event === 'browser.frame') {
      const k = statusKey(f.data.thread, f.data.agent), cur = S.browser.get(k), next = keepFrame(cur?.f, f.data);
      if (next === null) S.browser.delete(k); else if (next !== cur?.f) { S.browser.set(k, { f: next, got: Date.now(), prev: cur?.f.jpeg }); stillTimer(); }
      for (const [x, b] of S.browser) if (Date.now() - b.got >= BROWSER_STALE_MS) S.browser.delete(x); // ~20 KB each: never kept past their use
    }
    else if (f.event === 'thread.status') {
      const k = statusKey(f.data.thread, f.data.agent ?? S.threads.get(f.data.thread)?.owner ?? ''), cur = S.status.get(k);
      if (!cur || cur.rev < f.data.rev) S.status.set(k, { text: f.data.text, rev: f.data.rev, since: f.data.since, steps: f.data.steps, recent: f.data.recent });
    }
    else if (f.event === 'message.created' || f.event === 'message.updated') { upsertMsg(f.data); voiceOnMessage(f.data); voiceOnLine(f.data);
      if (f.data.deleted && S.editing?.msg === f.data.id) { S.editing = null; editHint('deleted', ''); } /* deleted from another tab */
      if (f.event === 'message.created') { if (f.data.author.kind === 'human') noteTyping(S.typing, f.data.thread, f.data.author.id, true, Date.now()); agentActive(S.undelivered, f.data.thread, { author: f.data.author }); alertMessage(f.data, f.notify); } if (f.data.author.kind === 'system' && f.data.author.id === 'briefling') labelDone(f.data.thread); }
    else if (f.event === 'message.deleted') { const ms = S.msgs.get(f.data.thread); for (const id of f.data.ids) ms?.delete(id); }
    else if (f.event === 'summary.updated') upsertSummary(f.data);
    else if (st().event(f)) { /* radarcfg.updated, flowpilot.updated (client/src/settingsview.ts) */ }
    else if (ex().event(f)) { /* exchange.updated / exchange.removed (client/src/exchangesview.ts) */ }
    else if (f.event === 'correspondents.updated') { const l = ex().by.get(f.data.space); if (l) l.correspondents = f.data.correspondents; st().correspondents(f.data.space, f.data.correspondents); }
    else if (rd().event(f)) { /* radar.updated (client/src/radarview.ts) */ }
    else if (f.event === 'presence.changed') { S.presence.set(f.data.space, f.data.presence); if (f.data.lastSeen) S.lastSeen.set(f.data.space, f.data.lastSeen); }
    else if (f.event === 'github.updated') S.github.set(f.data.space, f.data);
    else if (f.event === 'pin.updated') upsertPin(f.data);
    else if (f.event === 'mute.updated') applyMute(S.mutes, f.data);
    else if (f.event === 'typing.updated') { noteTyping(S.typing, f.data.thread, f.data.who, !!f.data.off, Date.now()); if (!f.data.off) setTimeout(render, TYPING_TTL_MS + 50); }
    else if (f.event === 'seen.updated') { if (mergeMarks(seen, f.data.marks ?? [])) saveSeen(); }
    else if (f.event === 'reaction.updated') upsertReaction(f.data);
    else if (f.event === 'lock.updated') upsertLock(f.data);
    else if (f.event === 'resource.updated') upsertResource(f.data);
    else if (f.event === 'space.updated') onSpaceUpdated(f.data);
    else if (f.event === 'flowstate.updated') onFlowState(f.data.space, f.data.state);
    else if (mods().some(m => m.frame(f))) { /* a module's event (client/src/modules.ts) */ }
  } else return;
  render();
}
// ---------------------------------------------------------------- modules in their own files (client/src/modules.ts)
let MODS: ClientModule[] | null = null, KIT: UiKit | null = null;
/** Standalone server (local token or OIDC): its update from npm, for the admins (client/src/serverupdate.ts). */
let SU: ReturnType<typeof serverUpdateModule> | null = null;
/** The kit lent to the modules: it reads state and helpers defined across this file (built once, on first use). */
function kitOf(): UiKit {
  return KIT ??= { h, icon, t, tn, render, request, errText, me: () => S.me, people: sp => S.people.get(sp) ?? [], spaceName, menuBtn, cardBand, go,
    open: (space, view) => { S.view = { kind: view, id: space }; S.sel = null; S.drawer = false; render(); },
    send, post: f => { if (ws?.readyState !== WebSocket.OPEN) return false; ws.send(JSON.stringify({ v: 2, ...f })); return true; },
    since, ago, personAvatar, withIcon, personName, trusted: sp => S.trusted.has(sp), threadTitle: id => S.threads.get(id)?.title, thread: id => S.threads.get(id), goMessage, modOn };
}
/** Built on first use: the modules read state and helpers defined across this file. */
function mods(): ClientModule[] {
  if (MODS) return MODS;
  const kit = kitOf();
  MEM = memoryModule(kit, (space, exchange, mail) => { S.view = { kind: 'exchanges', id: space }; S.sel = null;
    ex().openMail(exchange, mail); render(); });
  const openIn = (view: View, id: string) => { S.view = view; open(id); };
  const opened = (th: string) => { S.loaded.add(th); render(); return goThread(th); };
  const admin = spaceAdmin;
  MX = metricsModule(kit, openIn, splitBar, reasoningLine);
  LIN = lineageModule(kit, openIn);
  EX = exchangesModule(kit, admin, opened, view => { S.view = view; S.sel = null; });
  CD = cardsModule(kit, S, { spaceAdmin, open, goThread, chip, archivedTip, richText, mdOpts, who, ghLink, kindIc, dirty: () => st().dirty(), unread, shown, label, pressAttrs, cardMenu,
    familyIndent, messageEl, avatarClass, face, authorDot, fullDate, hhmm });
  AP = appletsModule(kit, S, { open, pendings, addFiles, fmtSize, urlFor, md: (text, space) => renderMarkdown(text, x => richText(x, space), mdOpts(space)) });
  const machine = cfg.local || oidc ? machineModule(kit, () => oidc ? readTokens()?.access ?? null : localToken(localStorage)) : null;
  SU = cfg.local || oidc ? serverUpdateModule(kit, () => oidc ? readTokens()?.access ?? null : localToken(localStorage), () => S.admin) : null;
  ST = settingsModule(kit, S, { spaceAdmin, open, mem, wf, aboutAskEl: CD.aboutAskEl, avatarField, pickAvatar, presDot, whenShort, openMember: p => lg().openMember(p),
    ...(machine ? { machine: (sp: string) => machine.el(sp) } : {}), oidc: !!oidc });
  RD = radarModule(kit, admin, opened, goThread, ST.radarCfgBy);
  WFE = workflowEditor(kit, spaceAdmin, space => { S.view = { kind: 'workflow', id: space }; S.sel = null; render(); });
  const markOf = (f: PublicThread) => rowMark(f, shown(f));
  RC = recentsModule(kit, { threads: () => S.threads.values(), unread, mark: markOf, sel: () => S.sel, narrow,
    active: f => { const m = markOf(f); return m === 'run' || m === 'you' || m === 'wait'; },
    label: f => CD!.rowLabel(f, markOf(f)), say: f => archivedTip(f) ?? chip(f)?.textContent ?? label(shown(f)),
    go: goRecent, newTopic: sp => { S.drawer = false; S.view = { kind: 'lounge', id: sp }; open('new'); },
    more: sp => hasMore(S.paging, sp), loadMore });
  LD = leadsModule(kit, { goThread });
  return MODS = [remindersModule(kit), LD, MEM];
}
let WFE: WorkflowEditor | null = null;
/** Pending leads (client/src/leadsview.ts): its view is a module, its « We had talked about it » goes under an agent's reply. */
let LD: ReturnType<typeof leadsModule> | null = null;
/** Actions on the lines « Next » of the summary card (client/src/nextstepsview.ts); the long press opens them in the sheet. */
let NS: ReturnType<typeof nextStepsView> | null = null;
const ns = () => NS ??= nextStepsView(kitOf(), { press: (thread, i) => pressAttrs({ kind: 'next', thread, id: String(i) }), goThread });
let RC: RecentsModule | null = null;
/** The Recents pane (Lounge header button) and the list of ⌘K with nothing typed. */
const rc = (): RecentsModule => { mods(); return RC!; };
/** The workflow editor (admin route, not a sidebar module): main.ts reaches it from the frames, the route and Settings › Work. */
const wf = (): WorkflowEditor => { mods(); return WFE!; };
let MX: MetricsModule | null = null, LIN: LineageModule | null = null, EX: ExchangesModule | null = null, RD: RadarModule | null = null;
/** The Metrics, Flow (lineage), Exchanges and Radar views: their sidebar entries, route and frames stay in main.ts. */
const mx = (): MetricsModule => { mods(); return MX!; };
const lin = (): LineageModule => { mods(); return LIN!; };
const ex = (): ExchangesModule => { mods(); return EX!; };
const rd = (): RadarModule => { mods(); return RD!; };
let CD: Cards | null = null, AP: Applets | null = null;
/** The conversation cards and the applets (client/src/cards.ts, appletsview.ts): `messageEl` and the Lounge feed reach them. */
const cd = (): Cards => { mods(); return CD!; };
const ap = (): Applets => { mods(); return AP!; };
let ST: SettingsModule | null = null;
/** The Settings pages (admin route): main.ts reaches them from the frames, the route and the Lounge's draft panel. */
const st = (): SettingsModule => { mods(); return ST!; };
let MEM: MemoryModule | null = null;
/** The memory module (always on): main.ts still reaches it from the sync, the Settings and the sidebar. */
const mem = (): MemoryModule => { mods(); return MEM!; };
const modView = (v: ModuleView) => mods().find(m => m.view === v)!;
const modViewOf = (v: View): { kind: ModuleView; id: string } | null => isModuleView(v.kind) ? v as { kind: ModuleView; id: string } : null;
let modShown = '';
/** Next page of the space's thread list, when the bottom of the list shows (one request at a time, online only). */
function loadMore(space: string) {
  if (ws?.readyState !== WebSocket.OPEN) return; // the reconnection's sync starts the list again
  const cursor = takeNext(S.paging, space);
  if (cursor && !send({ type: 'threads.page', space, cursor })) cancel(S.paging, space);
}
/** Bottom of a list with more threads to load: watched by render() (IntersectionObserver), loads the next page. */
const moreEl = (space: string) => hasMore(S.paging, space) ? h('div', { class: 'more', 'data-k': 'more', 'data-space': space }, t('ex_loading')) : null;
let moreObs: IntersectionObserver | null = null;
function watchMore() {
  moreObs?.disconnect(); moreObs = null;
  const m = document.querySelector('.list .more') as HTMLElement | null;
  if (!m) return;
  // Root = the list's own scroller, so the margin starts loading a little before the end shows.
  moreObs = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) loadMore(m.dataset.space!); },
    { root: m.closest('.scroll'), rootMargin: '0px 0px 400px 0px' });
  moreObs.observe(m);
}
function loadHistory(thread: string) { if (!S.loaded.has(thread) && (!isGeneralId(thread) || S.threads.has(thread))) send({ type: 'history', thread }); }
/** Top of a conversation with older messages left: watched by render(), loads the page above (infinite scroll up). */
const olderW = newTopWatch();
function watchOlder() {
  // Root = the conversation's scroller; kept across renders (client/src/topsentinel.ts: the iPhone paging loop).
  const m = document.querySelector('.conv .msgs > .older') as HTMLElement | null;
  watchTop(olderW, m, m?.closest('.msgs') ?? null, () => loadOlder(m!.dataset.thread!));
}
function loadOlder(thread: string) {
  const before = nextOlder(S.older, thread);
  if (before && !send({ type: 'history', thread, before })) olderFailed(S.older);
}
/** Jump to a search result: done once the message is loaded; otherwise the page older than `oldest`, if any. */
function walkBack(thread: string, oldest: string | undefined) {
  if (!S.jump || S.msgs.get(thread)?.has(S.jump.msg)) return;
  if (oldest && S.jump.asked === oldest) return; // render() and the history answer both walk back: one request per page
  if (!oldest) { S.jump = null; return; } // not found (deleted?): the thread stays open
  S.jump.asked = oldest;
  // The top sentinel of the page shown may ask the same page (slow hub): one request, its answer walks on.
  if (claimOlder(S.older, thread, oldest) && !send({ type: 'history', thread, before: oldest })) { S.jump.asked = undefined; olderFailed(S.older); }
}

// ---------------------------------------------------------------- search palette (⌘K): client/src/paletteview.ts, built below
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

// ---------------------------------------------------------------- rendering (plain DOM, never innerHTML)
type Child = Node | string | null | false | undefined;
function h(tag: string, attrs: Record<string, any> = {}, ...kids: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) on(el, k.slice(2), v); else if (k === 'class') el.className = v; else if (v !== false && v != null) el.setAttribute(k, String(v));
  }
  for (const c of kids) if (c) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}
// ---------------------------------------------------------------- icons
// Paths adapted from Lucide (https://lucide.dev, ISC license, © Lucide Contributors): a few icons,
// no dependency. SVG built in the DOM (createElementNS), no innerHTML nor inline style (CSP).
const ICONS: Record<string, string[]> = {
  reminder: ['M13 5h8', 'M13 12h8', 'M13 19h8', 'm3 17 2 2 4-4', 'm3 7 2 2 4-4'],
  calendar: ['M8 2v4', 'M16 2v4', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M3 10h18'],
  sun: ['M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z', 'M12 2v2', 'M12 20v2', 'm4.93 4.93 1.41 1.41', 'm17.66 17.66 1.41 1.41', 'M2 12h2', 'M20 12h2', 'm6.34 17.66-1.41 1.41', 'm19.07 4.93-1.41 1.41'],
  bell: ['M10.268 21a2 2 0 0 0 3.464 0', 'M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326'],
  bellOff: ['M10.268 21a2 2 0 0 0 3.464 0', 'M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742', 'm2 2 20 20', 'M8.668 3.01A6 6 0 0 1 18 8c0 2.687.77 4.653 1.707 6.05'],
  pin: ['M12 17v5', 'M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z'],
  archive: ['M3 3h18a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z', 'M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8', 'M10 12h4'],
  unarchive: ['M3 3h18a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z', 'M4 8v11a2 2 0 0 0 2 2h2', 'M20 8v11a2 2 0 0 1-2 2h-2', 'M9 15l3-3 3 3', 'M12 12v9'],
  later: ['M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0', 'M12 6v6l4 2'],
  applet: ['M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M10 4v4', 'M2 8h20', 'M6 4v4'], // lucide app-window (ISC)
  unlock: ['M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z', 'M7 11V7a5 5 0 0 1 9.9-1'], // lock-open
  lock: ['M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z', 'M7 11V7a5 5 0 0 1 10 0v4'], // lock
  close: ['M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0', 'M9 12l2 2 4-4'],
  github: ['M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4', 'M9 18c-4.51 2-5-2-7-2'],
  reopen: ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5'],
  react: ['M22 11v1a10 10 0 1 1-9-10', 'M8 14s1.5 2 4 2 4-2 4-2', 'M9 9h.01', 'M15 9h.01', 'M16 5h6', 'M19 2v6'],
  // Sidebar: Now, space, Board, Lounge (replaces the ☕ emoji); Later reuses `later`, Closed reuses `archive`.
  inbox: ['M22 12h-6l-2 3h-4l-2-3H2', 'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z'],
  folder: ['M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'],
  bot: ['M12 8V4H8', 'M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z', 'M2 14h2', 'M20 14h2', 'M15 13v2', 'M9 13v2'],
  dollar: ['M12 2v20', 'M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6'],
  chart: ['M3 3v16a2 2 0 0 0 2 2h16', 'M18 17V9', 'M13 17V5', 'M8 17v-3'],
  crown: ['M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z', 'M5 21h14'],
  branch: ['M6 3v12', 'M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M18 9a9 9 0 0 1-9 9'], // git-branch
  // Lucide « book-open » (ISC): the space's project memory
  // Radar signal types (Lucide bug, shield, users, cpu; ISC).
  bug: ['m8 2 1.88 1.88', 'M14.12 3.88 16 2', 'M9 7.13v-1a3.003 3.003 0 1 1 6 0v1', 'M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6', 'M12 20v-9', 'M6.53 9C4.6 8.8 3 7.1 3 5', 'M6 13H2', 'M3 21c0-2.1 1.7-3.9 3.8-4', 'M20.97 5c0 2.1-1.6 3.8-3.5 4', 'M22 13h-4', 'M17.2 17c2.1.1 3.8 1.9 3.8 4'],
  shield: ['M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z'],
  users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M5 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  code: ['m16 18 6-6-6-6', 'm8 6-6 6 6 6'],
  cpu: ['M6 6h12v12H6z', 'M9 9h6v6H9z', 'M15 2v2', 'M15 20v2', 'M2 15h2', 'M2 9h2', 'M20 15h2', 'M20 9h2', 'M9 2v2', 'M9 20v2'],
  radar: ['M19.07 4.93A10 10 0 0 0 6.99 3.34', 'M4 6h.01', 'M2.29 9.62A10 10 0 1 0 21.31 8.35', 'M16.24 7.76A6 6 0 1 0 8.23 16.67', 'M12 18h.01', 'M17.99 11.66A6 6 0 0 1 15.77 16.67', 'M12 12h.01', 'm13.41 10.59 5.66-5.66'], // lucide radar
  memory: ['M12 7v14', 'M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z'],
  // Board modes (Lucide list, columns-3).
  list: ['M3 5h.01', 'M3 12h.01', 'M3 19h.01', 'M8 5h13', 'M8 12h13', 'M8 19h13'],
  columns: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M9 3v18', 'M15 3v18'],
  track: ['m3 17 2 2 4-4', 'm3 7 2 2 4-4', 'M13 6h8', 'M13 12h8', 'M13 18h8'],
  cloudOff: ['m2 2 20 20', 'M5.782 5.782A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.307-.193', 'M21.532 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7.008 7.008 0 0 0 10 5.07'],
  wifiOff: ['M12 20h.01', 'M8.5 16.429a5 5 0 0 1 7 0', 'M5 12.859a10 10 0 0 1 5.17-2.69', 'M19 12.859a10 10 0 0 0-2.007-1.523', 'M2 8.82a15 15 0 0 1 4.177-2.643', 'M22 8.82a15 15 0 0 0-11.288-3.764', 'm2 2 20 20'],
  refresh: ['M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16', 'M8 16H3v5'],
  messageCircle: ['M7.9 20A9 9 0 1 0 4 16.1L2 22Z'], // a topic in the Lounge feed (Lucide message-circle)
  coffee: ['M10 2v2', 'M14 2v2', 'M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1', 'M6 2v2'],
  // Attachments: Attach button (replaces 📎) and attached file (replaces 📄).
  messagesSquare: ['M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z', 'M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1'], // the Lounge (Bar / Comptoir) and its General room (Lucide messages-square); topics keep the coffee cup
  paperclip: ['m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551'],
  // Audio: record (mic), stop, player (play, pause), audio attachment (audio-lines).
  mic: ['M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z', 'M19 10v2a7 7 0 0 1-14 0v-2', 'M12 19v3'],
  stop: ['M6 5h12a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z'],
  play: ['M6 4.8a1.5 1.5 0 0 1 2.26-1.3l10.5 6.2a1.5 1.5 0 0 1 0 2.6l-10.5 6.2A1.5 1.5 0 0 1 6 17.2z'],
  pause: ['M14 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z', 'M7 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z'],
  download: ['M12 15V3', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 10 5 5 5-5'],
  audio: ['M2 10v3', 'M6 6v11', 'M10 3v18', 'M14 8v7', 'M18 5v13', 'M22 10v3'],
  file: ['M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z', 'M14 2v5a1 1 0 0 0 1 1h5'],
  // Sections of the thread list (Pinned reuses `pin`, Later `later`, Closed `close`) and folding of Quiet.
  you: ['M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2', 'M8 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0'],
  run: ['M21 12a9 9 0 1 1-6.219-8.56'],
  wait: ['M5 22h14', 'M5 2h14', 'M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22', 'M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2'],
  calm: ['M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'],
  chevronRight: ['m9 18 6-6-6-6'],
  chevronDown: ['m6 9 6 6 6-6'],
  chevronUp: ['m18 15-6-6-6 6'],
  // New-content pills: « New ↑ » on lists, « New messages ↓ » in a thread.
  arrowUp: ['m5 12 7-7 7 7', 'M12 19V5'],
  mail: ['M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'm22 6-10 7L2 6'], // lucide mail (ISC)
  arrowRight: ['M5 12h14', 'm12 5 7 7-7 7'],
  askCard: ['M7.9 20A9 9 0 1 0 4 16.1L2 22Z', 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3', 'M12 17h.01'], // message-circle-question
  arrowDown: ['M12 5v14', 'm19 12-7 7-7-7'],
  // "Topic" button (space and Lounge): new conversation in the Lounge.
  // Spaces (admin): "+" in the sidebar, Settings under each space.
  plus: ['M5 12h14', 'M12 5v14'],
  search: ['m21 21-4.34-4.34', 'M3 11a8 8 0 1 0 16 0a8 8 0 1 0-16 0'], // search palette (⌘K)
  settings: ['M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z', 'M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0'],
  thread: ['m15 12-8.373 8.373a1 1 0 1 1-3-3L12 9', 'm18 15 4-4', 'm21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172V7l-2.26-2.26a6 6 0 0 0-4.202-1.756L9 2.96l.92.82A6.18 6.18 0 0 1 12 8.4V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5'], // hammer (« chantier »)
  // Narrow screens: drawer button, back to the list, long-press menu (copy a message).
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  chevronLeft: ['m15 18-6-6 6-6'],
  copy: ['M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z', 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'],
  // Lucide « trash-2 » (ISC): delete one's own message
  trash: ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', 'M10 11v6', 'M14 11v6'],
  check: ['M20 6 9 17l-5-5'],
  summary: ['M15 12h-5', 'M15 8h-5', 'M19 17V5a2 2 0 0 0-2-2H4', 'M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3'], // scroll-text
  textSelect: ['M5 3a2 2 0 0 0-2 2', 'M19 3a2 2 0 0 1 2 2', 'M21 19a2 2 0 0 1-2 2', 'M5 21a2 2 0 0 1-2-2', 'M9 3h1', 'M9 21h1', 'M14 3h1', 'M14 21h1', 'M3 9v1', 'M21 9v1', 'M3 14v1', 'M21 14v1', 'M7 8h10', 'M7 12h10', 'M7 16h6'], // Lucide text-select: « Select text » row
  link: ['M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'], // copy a thread/message link
  key: ['M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z', 'M16.5 7.5h.01'], // key-round: share a secret
  pencil: ['M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z', 'm15 5 4 4'], // edit profile
  messageSquarePlus: ['M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z', 'M12 8v6', 'M9 11h6'],
  x: ['M18 6 6 18', 'm6 6 12 12'], // close the image viewer
  monitor: ['M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M8 21h8', 'M12 17v4'], // agent web preview (Lucide monitor)
  smartphone: ['M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z', 'M12 18h.01'],
  // install page of an applet (client/src/installview.ts): the browsers' own menu glyphs (Lucide share, square-plus, ellipsis-vertical)
  share: ['M12 2v13', 'm16 6-4-4-4 4', 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8'],
  squarePlus: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M8 12h8', 'M12 8v8'],
  moreV: ['M12 5h.01', 'M12 12h.01', 'M12 19h.01'], // screen share (Lucide smartphone)
  // Android navigation bar of a screen share: back (triangle), home (circle), recent apps (square).
  navBack: ['M16 5v14L6 12z'], navHome: ['M12 6.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11z'], navRecents: ['M7 7h10v10H7z'],
  // Thread info panel (Lucide info, git-pull-request, git-commit-horizontal, circle-dot).
  info: ['M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0', 'M12 16v-4', 'M12 8h.01'],
  pr: ['M15 18a3 3 0 1 0 6 0a3 3 0 1 0-6 0', 'M3 6a3 3 0 1 0 6 0a3 3 0 1 0-6 0', 'M13 6h3a2 2 0 0 1 2 2v7', 'M6 9v12'],
  commit: ['M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0', 'M3 12h6', 'M15 12h6'],
  issue: ['M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0', 'M11 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0'],
};
/** Section icon per thread state (space list, Now). */
const STATE_ICON: Record<ThreadState, string> = { you: 'you', run: 'run', wait: 'wait', calm: 'calm', idea: 'later', done: 'close' };
/** Quiet section unfolded: true on every load, a click folds it until the next load (not remembered). */
let calmOpen = true;
// Answered question: only the answer, as a past-tense status line (« Approved », « Denied ») after a green tick or a red
// cross; no pill, no button look, the other options are not shown.
function askDoneEl(options: readonly string[], answer: string): HTMLElement {
  const d = askDone(options, answer);
  return h('div', { class: `opts done ${d.ok ? 'ok' : 'no'}` }, icon(d.ok ? 'check' : 'x', 15), h('span', { class: 'past' }, 'past' in d ? t(d.past) : d.text));
}

function icon(name: string, size = 16): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, String(v));
  for (const d of ICONS[name]) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); svg.append(p); }
  return svg;
}
/** Lounge cup above the empty-conversation greeting: the coffee icon, its 3 steam strokes animated in CSS
 *  (`.cup .steam`, stopped under prefers-reduced-motion). Decorative, hidden from screen readers. */
function cup(): SVGSVGElement {
  const svg = icon('coffee', 64);
  svg.setAttribute('class', 'cup');
  const left = { M6: 's1', M10: 's2', M14: 's3' } as Record<string, string>;   // left to right: staggered delays
  svg.querySelectorAll('path').forEach(p => { const m = /^(M\d+) 2v2$/.exec(p.getAttribute('d') ?? ''); if (m) p.setAttribute('class', `steam ${left[m[1]]}`); });
  return svg;
}
/** Icon + text on one line (titles, breadcrumb): replaces the emojis of the interface. */
const withIcon = (name: string, text: string, size = 14) => h('span', { class: 'with-ic' }, icon(name, size) as unknown as Node, text);
const { openPalette, paletteEl } = paletteModule(kitOf(), S, P, { rc, goRecent, upsertThread, loadHistory, walkBack, who,
  profileOn: () => lg().profileOn(), closeProfile: () => lg().closeProfile(), viewerOn: () => !!vw.viewer });
// Desktop shortcuts (client/src/shortcutsview.ts): recents switcher (Ctrl/⌥ Tab), ⌘1…9 spaces, ⌘/ help.
const SC = shortcutsModule(kitOf(), { sel: () => S.sel, goRecent, goSpace: id => { S.drawer = false; goEntry({ kind: 'lounge', id }); },
  spaces: () => { const g = barGroups(S.view.kind === 'now' || S.view.kind === 'newspace' ? null : S.view.id); return [...g.active, ...g.inactive, ...g.muted].map(s => s.id); },
  rc, busy: () => P.open || lg().profileOn() || !!vw.viewer });
/** Icon button: the label stays in the tooltip and for screen readers. */
const iconBtn = (name: string, text: string, onclick: (e: Event) => void, extra: Record<string, any> = {}) =>
  h('button', { class: 'btn ic', type: 'button', title: text, 'aria-label': text, onclick, ...extra }, icon(name) as unknown as Node);
/** Pin toggle (thread header, list card): same pin icon in both states, coloured and pressed when pinned, like the bell. */
const pinToggle = (f: PublicThread, offText: string, onclick: (e: Event) => void) => {
  const on = pinned(f);
  return iconBtn('pin', on ? t('unpin') : offText, onclick, { class: `btn ic pin${on ? ' on' : ''}`, 'aria-pressed': String(on) });
};
/** Hover menu of a list card (pin, unarchive on archived cards; archive only from the thread header): the click doesn't open the card. */
function cardMenu(f: PublicThread) {
  // preventDefault: in Now the menu sits inside the row's link (recentsview.ts), whose click would open the thread.
  const stop = (fn: () => void) => (e: Event) => { e.preventDefault(); e.stopPropagation(); fn(); };
  return h('div', { class: 'hov' },
    pinToggle(f, t('pin_card'), stop(() => togglePin(f))),
    f.archived ? iconBtn('unarchive', t('unarchive'), stop(() => send({ type: 'action', thread: f.id, kind: 'unarchive', version: f.version }))) : null,
    placeRelease(f, stop));
}
const QUICK = ['✅', '👀', '🙌'];
// The grid (9 × 6) opens downwards, or upwards if the message is at the bottom of the thread (otherwise cut by the scroll).
let pickerUp = false;
function togglePicker(e: Event, m: Message) {
  e.stopPropagation();
  const row = (e.currentTarget as HTMLElement).closest('.m'), box = row?.closest('.msgs');
  if (row && box) { const r = row.getBoundingClientRect(), b = box.getBoundingClientRect(); pickerUp = b.bottom - r.top < 260 && r.top - b.top > 260; }
  S.picker = S.picker === m.id ? '' : m.id; render();
}
/** Delete one's own message (`message.delete`), after a confirm: every client shows « Message deleted » in its place. */
function deleteMsg(m: Message) {
  if (!confirm(t('delete_confirm'))) return;
  send({ type: 'message.delete', client_id: rand().slice(0, 20), thread: m.thread, msg: m.id, rev: m.rev ?? 0 });
}
const canDelete = (m: Message) => deletable(m, S.me) && !m.deleted;
/** Pencil next to Delete: on my message that ↑ would open in its conversation (rules: pencilOn, client/src/edit.ts). */
function canPencil(m: Message) {
  const f = S.threads.get(m.thread);
  return !!f && canDelete(m) && pencilOn(S.msgs.get(f.id)?.values() ?? [], S.me, f.state === 'run', S.trusted.has(f.space)) === m.id;
}
/** Same edit mode as ↑ in the composer of the message's conversation. */
function pencilEdit(m: Message) { const f = S.threads.get(m.thread); if (f) startEdit(f); }
/** Bar on message hover (like Slack): three quick reactions and the full picker. A deleted message has none. */
function msgTools(m: Message) {
  if (m.deleted) return null;
  return h('div', { class: `m-tools ${S.picker === m.id ? 'open' : ''}` },
    ...QUICK.map(e => h('button', { class: 'btn ic emo', type: 'button', title: t('react_with', { emoji: e }), onclick: () => react(m, e) }, e)),
    iconBtn('react', t('add_reaction'), (e: Event) => togglePicker(e, m)),
    linkBtn(`m:${m.id}`, copyUrl(m.thread, m.id), 'link_msg'),
    isGeneralId(m.thread) ? iconBtn('messageSquarePlus', t('reply_topic'), (e: Event) => { e.stopPropagation(); replyAsTopic(m); }, { class: 'btn ic reply-topic' }) : null,
    sendAgentOf(m) ? iconBtn('bot', t('send_to_agent', { agent: cap(sendAgentOf(m)!) }), (e: Event) => { e.stopPropagation(); replyAsTopic(m, true); }, { class: 'btn ic send-agent' }) : null,
    canPencil(m) ? iconBtn('pencil', t('edit_msg'), (e: Event) => { e.stopPropagation(); pencilEdit(m); }, { class: 'btn ic edit-msg' }) : null,
    canDelete(m) ? iconBtn('trash', t('delete_msg'), (e: Event) => { e.stopPropagation(); deleteMsg(m); }, { class: 'btn ic del-msg' }) : null,
    S.picker === m.id ? h('div', { class: `picker ${pickerUp ? 'up' : ''}`, role: 'menu' }, ...REACTIONS.map(e => h('button', { class: 'btn ic emo', type: 'button', title: e, onclick: () => react(m, e) }, e))) : null);
}
/** Reactions under the message: a click adds or removes one's own; the tooltip says who. */
function reactionsEl(m: Message) {
  const rs = reactionsOf(m);
  if (!rs.length) return null;
  const names = (us: string[]) => us.map(u => u === S.me ? t('you_lc') : personName(u) ?? t('a_member')).join(', ');
  return h('div', { class: 'reacts' }, ...rs.map(x => h('button', { class: `react ${x.users.includes(S.me) ? 'mine' : ''}`, type: 'button', title: `${x.emoji} ${names(x.users)}`, onclick: () => react(m, x.emoji) },
    h('span', {}, x.emoji), h('b', {}, String(x.users.length)))),
    iconBtn('react', t('add_reaction'), (e: Event) => togglePicker(e, m), { class: 'btn ic react-add' }));
}
document.addEventListener('click', (e) => { if (S.picker && !(e.target as Element).closest?.('.picker, .m-tools, .react-add')) { S.picker = ''; render(); } });
document.addEventListener('click', (e) => { if (S.presOpen && !(e.target as Element).closest?.('.pres')) { S.presOpen = ''; render(); } });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && (S.picker || S.menu || S.drawer || S.presOpen)) { S.picker = ''; S.menu = null; S.drawer = false; S.presOpen = ''; render(); } });

// ---------------------------------------------------------------- touch: long press = the hover menu
// No hover on a touch screen: a long press on a list card (pin, archive) or a message (reactions, copy) opens the
// same actions in a bottom sheet. Touch only (pointerType), a mouse keeps the hover menus and its right click.
const press = longPress<number>({ set: (fn, ms) => window.setTimeout(fn, ms), clear: (t) => window.clearTimeout(t) });
document.addEventListener('pointerdown', () => press.touchStart(), true);
// The click a fired press may produce must not open the card under the sheet.
document.addEventListener('click', (e) => { if (press.swallow()) { e.preventDefault(); e.stopPropagation(); } }, true);
function pressAttrs(menu: NonNullable<typeof S.menu>) {
  const fire = () => { S.menu = menu; S.picker = ''; navigator.vibrate?.(10); render(); };
  return {
    onpointerdown: (e: PointerEvent) => { if (e.pointerType === 'touch' && e.isPrimary) press.down(e.clientX, e.clientY, fire); },
    onpointermove: (e: PointerEvent) => press.move(e.clientX, e.clientY),
    onpointerup: () => press.up(), onpointercancel: () => press.up(),
    // Android's own long-press signal: no callout/selection menu, our sheet instead (a mouse right click is untouched).
    oncontextmenu: (e: Event) => { if (press.touching()) { e.preventDefault(); press.fireNow(); } },
  };
}
const sheetRow = (ic: string, text: string, onclick: () => void, disabled = false) =>
  h('button', { class: 'sheet-row', type: 'button', role: 'menuitem', disabled, onclick }, icon(ic, 20) as unknown as Node, h('span', {}, text));
/** Bottom sheet of the long press: the card's pin/archive, or the message's reactions + copy. */
function sheet() {
  const m = S.menu;
  if (!m) return null;
  const close = () => { S.menu = null; render(); };
  let title = '', head: Child[] = [], rows: Child[] = [];
  if (m.kind === 'card') {
    const f = S.threads.get(m.id);
    if (!f) { S.menu = null; return null; }
    title = f.title; head = [f.title];
    rows = cardActions({ pinned: pinned(f), archived: !!f.archived }).map(a =>
      a.kind === 'unarchive' ? sheetRow(a.kind, t('unarchive'), () => { S.menu = null; send({ type: 'action', thread: f.id, kind: a.kind, version: f.version }); render(); })
        : sheetRow('pin', a.kind === 'pin' ? t('pin_card') : t('unpin'), () => { S.menu = null; togglePin(f); render(); }));
  } else if (m.kind === 'space') {
    const name = spaceName(m.id);
    title = name; head = [name];
    rows = [sheetRow(muted(m.id) ? 'bell' : 'bellOff', t(muted(m.id) ? 'space_unmute' : 'space_mute', { space: name }), () => { S.menu = null; toggleMute(m.id); })];
  } else if (m.kind === 'next') {
    const f = S.threads.get(m.thread), st = S.summaries.get(m.thread)?.next_steps[Number(m.id)];
    const a = f && st ? ns().action(f, st) : null;
    if (!a) { S.menu = null; return null; }
    title = st!.who; head = [h('b', {}, st!.who), ' ', st!.what.slice(0, 160)];
    rows = [sheetRow(a.icon, a.label, () => { S.menu = null; a.run(); render(); })];
  } else if (m.kind === 'select') {
    const msg = S.msgs.get(m.thread)?.get(m.id);
    if (!msg || msg.deleted) { S.menu = null; return null; }
    return selectPage(msg, close);
  } else if (m.kind === 'msg') {
    const msg = S.msgs.get(m.thread)?.get(m.id);
    if (!msg || msg.deleted) { S.menu = null; return null; }
    title = who(msg); head = [h('b', {}, title), ' ', msg.text.replace(/[*_`#>]+/g, '').trim().slice(0, 160)]; // excerpt: Markdown marks dropped
    const mine = new Set(reactionsOf(msg).filter(x => x.users.includes(S.me)).map(x => x.emoji));
    rows = [h('div', { class: 'sheet-emo', role: 'group', 'aria-label': t('add_reaction') }, ...REACTIONS.map(e =>
        h('button', { class: `btn ic emo ${mine.has(e) ? 'mine' : ''}`, type: 'button', title: t('react_with', { emoji: e }), 'aria-label': t('react_with', { emoji: e }),
          'aria-pressed': String(mine.has(e)), onclick: () => { S.menu = null; react(msg, e); render(); } }, e))),
      isGeneralId(msg.thread) ? sheetRow('messageSquarePlus', t('reply_topic'), () => { S.menu = null; replyAsTopic(msg); render(); }) : null,
      sendAgentOf(msg) ? sheetRow('bot', t('send_to_agent', { agent: cap(sendAgentOf(msg)!) }), () => { S.menu = null; replyAsTopic(msg, true); render(); }) : null,
      msg.text.trim() && navigator.clipboard ? sheetRow('copy', t('copy_text'), () => { void navigator.clipboard.writeText(msg.text); close(); }) : null,
      msg.text.trim() ? sheetRow('textSelect', t('select_text'), () => { S.menu = { kind: 'select', thread: msg.thread, id: msg.id }; render(); }) : null,
      navigator.clipboard ? sheetRow('link', t('link_msg'), () => { void navigator.clipboard.writeText(copyUrl(msg.thread, msg.id)); close(); }) : null,
      canPencil(msg) ? sheetRow('pencil', t('edit_msg'), () => { close(); pencilEdit(msg); }) : null,
      canDelete(msg) ? sheetRow('trash', t('delete_msg'), () => { close(); deleteMsg(msg); }) : null];
  }
  return h('div', { class: 'sheet-wrap', 'data-k': 'sheet' }, h('div', { class: 'scrim', onclick: close }),
    h('div', { class: 'sheet', role: 'menu', 'aria-label': title }, h('div', { class: 'sheet-t' }, ...head), ...rows,
      h('button', { class: 'sheet-row cancel', type: 'button', onclick: close }, t('cancel'))));
}
/** « Select text » (touch): the message's rendered text on a full page outside `.m`, so native selection works there
 *  while the long press on the bubble stays free for the sheet (`.m` keeps `user-select:none` on touch, style.css). */
function selectPage(msg: Message, close: () => void) {
  const space = S.threads.get(msg.thread)?.space ?? '';
  return h('div', { class: 'sel-page', 'data-k': 'sel-page', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('select_text') },
    h('div', { class: 'sel-head' }, h('b', {}, who(msg)),
      h('button', { class: 'btn sel-close', type: 'button', onclick: close }, t('select_close'))),
    h('div', { class: 'sel-body md' }, renderMarkdown(msg.text, x => richText(x, space))));
}
// ---------------------------------------------------------------- narrow screens: drawer and Back
/** Your turn total (drawer button, Now, tab title, app icon badge): the hub's push `badge` counts with the same `isMyTurn`. */
const yourTurnCount = () => [...S.threads.values()].filter(counted).length + dueExchanges(ex().by, S.trusted, Date.now()).length;
let lastBadge = -1; // app icon badge last set by this tab
/** Opens the sidebar drawer (narrow screens only, hidden by CSS otherwise); badge = Your turn count, like Now. */
function menuBtn() {
  const n = yourTurnCount();
  return h('button', { class: 'btn ic mob menu-btn', type: 'button', title: t('menu'), 'aria-label': t('menu'), 'aria-expanded': String(S.drawer),
    onclick: () => { S.drawer = true; render(); } }, icon('menu', 20) as unknown as Node, n ? h('b', {}, String(n)) : null);
}
/** Back from a conversation to its list (narrow screens only). */
function back() {
  const list = routeOf(S.view, null);
  if (S.sel !== 'new' && backBy(history.state, list) === 'history') { history.back(); return; }
  S.sel = null; S.err = '';
  if (location.hash !== list) { history.replaceState(history.state, '', list); lastRoute = list; }
  render();
}
const backBtn = () => iconBtn('chevronLeft', t('back'), back, { class: 'btn ic mob back' });
/** Cross of the Lounge's side pane (wide screens only, style.css): back to the feed alone, its reading position kept. */
const paneClose = () => S.view.kind === 'lounge' ? iconBtn('x', t('pane_close'), () => open(null), { class: 'btn ic pane-x', 'data-k': 'pane-x' }) : null;

// The agent's hand per space: up to Parallel.max threads at once (`holders`, 1 in strict mode), the other threads wait
// for their turn in `queue`. Shared resources (ResourceLock): one holder thread each, parked threads in their queue.
const lockOf = (f: PublicThread) => f.kind === 'topic' ? null : S.locks.get(`${f.space}|${f.owner}`) ?? null;
/** Place in the agent queue (1 = the next one), null if the thread is not waiting. */
const queuePos = (f: PublicThread) => posIn(lockOf(f)?.queue, f.id);
/** Resource the thread is parked on (hub state Waiting), with its place in that resource's queue. */
const parked = (f: PublicThread) => parkedOn(S.resources.values(), f);
/** State shown: a queued or parked thread is "Waiting" (unless it is Your turn, filed away or in progress). */
/** Your turn of other members (`people`, same rule as the push): the humans it waits on, null if it is mine. */
const theirTurn = (f: PublicThread) => turnOf(f, S.me, S.people.get(f.space));
/** Your turn for me: what Now, the sidebar badges and the tab title count. */
const mine = (f: PublicThread) => myTurn(f, S.me, S.people.get(f.space), muted(f.space));
/** Counted in the Your turn totals: `isMyTurn` (protocol/notify.ts), members = the space's humans still there. */
const counted = (f: PublicThread) => isMyTurn(f, S.me, S.people.get(f.space)?.filter(p => p.kind === 'human' && !p.gone).map(p => p.id), muted(f.space));
/** State shown: a queued or parked thread is "Waiting" (unless it is Your turn, filed away or in progress); someone
 *  else's Your turn is filed under Waiting too, its chip naming them (« Jérôme's turn »). */
// A queued thread stays Waiting while its agent answers there (talk turn, hub/src/queuetalk.ts): it keeps its place.
const shown = (f: PublicThread): ThreadState => ((queuePos(f) || parked(f)) && f.state === 'calm') || (queuePos(f) && f.state === 'run') || theirTurn(f) ? 'wait' : workCol(f) || bgWork(f) ? 'run' : f.state;
/** Quiet, but its issue sits in a work column of the flow (In progress, In review): shown In progress, chip = the column. */
const workCol = (f: PublicThread) => boardWorking(f, S.workCols.get(f.space));
const titleOf = (id: string | null) => (id && S.threads.get(id)?.title) || t('another_thread');
/** Titles of the threads holding the agent's hand, quoted ("another thread" when none is known). */
const holderTitles = (l: AgentLock) => (l.holders.length ? l.holders : [null]).map(titleOf).map(quote).join(', ');
/** Why a Waiting thread waits (its place in the resource or agent queue): the Waiting chip's tooltip, not a line under
 *  the card (too much text in the list). */
const queueText = (f: PublicThread) => {
  const p = parked(f);
  if (p) return t('res_queue_line', { pos: ordinal(p.pos), resource: p.lock.resource, title: quote(titleOf(p.lock.holder)) });
  const n = queuePos(f);
  return n ? t('queue_line', { pos: ordinal(n), agent: cap(f.owner), title: holderTitles(lockOf(f)!) }) : null;
};
/** Where the thread stands in its queue (agent or resource): the place shown in clear on its card. */
const placeIn = (f: PublicThread) => placeOf(lockOf(f), S.resources.values(), f);
/** « 1st in Milan's queue » on a list card (the tooltip alone never shows on a phone). */
const placeChip = (f: PublicThread) => {
  const p = placeIn(f);
  return p ? h('span', { class: 'chip c-qpos' }, p.on === 'agent' ? t('queue_pos', { pos: ordinal(p.pos), agent: cap(p.name) }) : t('res_queue_pos', { pos: ordinal(p.pos), resource: p.name })) : null;
};
/** « Jérôme's turn » (« +1 » when several are concerned, every name in the tooltip). */
const turnChip = (ids: string[], space: string) => {
  const l = turnLabel(ids, S.people.get(space));
  return h('span', { class: 'chip c-wait c-their tip tip-below', 'data-tip': t('turn_of_tip', { names: l.all.join(', ') }) },
    l.more ? t('turn_of_more', { name: l.name, n: l.more }) : t('turn_of', { name: l.name }));
};
const chip = (f: PublicThread) => { if (agentDone(shown(f), f)) return doneChip(f); const to = theirTurn(f); if (to) return turnChip(to, f.space); if (workCol(f)) return colChip(f); if (bgWork(f)) return bgChip(f); const q = queueText(f); const run = f.state === 'run', names = run ? workingAgents(f).join(', ') : '';
  // data-name: a phone thread header shows only the names (CSS ::after, so textContent stays the full text), the full text kept for screen readers.
  return h('span', { class: `chip c-${shown(f)}${q ? ' tip tip-below' : ''}`, 'data-tip': q, 'data-name': run ? names : undefined }, run && h('span', { class: 'pulse' }), run ? h('span', { class: 'cw-full' }, t('chip_working', { agent: names })) : rowStateLabel(f, shown(f))); };
/** Quiet thread whose agent still runs work in the background: « In progress (background) », the goals in the tooltip. */
const bgChip = (f: PublicThread) => h('span', { class: 'chip c-run tip tip-below', 'data-tip': t('bg_tip', { list: bgTip(f) }) }, t('chip_bg'));
/** Background work on a thread shown in another state (Your turn, in a turn…): « background · 2 » next to the chip. */
const bgBadge = (f: PublicThread) => bgCount(f) && !bgWork(f) && f.state !== 'done' && f.state !== 'idea'
  ? h('span', { class: 'chip c-bg tip tip-below', 'data-tip': t('bg_tip', { list: bgTip(f) }) }, t('bg_badge', { n: bgCount(f) })) : null;
const threadLink = (id: string) => S.threads.has(id)
  ? h('a', { href: '#', onclick: (e: Event) => { e.preventDefault(); goThread(id); } }, quote(titleOf(id))) : null;
/** "Release" in the thread header: takes the hand back from the thread holding it (stuck agent, abandoned thread) and
 *  frees its resources hub-side. Shown on the holder while others wait, and on a queued thread with a single holder.
 *  The hub only accepts a trusted human. */
function releaseBtn(f: PublicThread) {
  if (f.kind === 'topic') return null;
  const l = lockOf(f), held = heldWithQueue(S.resources.values(), f);
  const holds = !!(l?.holders.includes(f.id) && l.queue.length) || held.length > 0;
  const id = holds ? f.id : l && queuePos(f) && l.holders.length === 1 ? l.holders[0] : null;
  if (!id) return null;
  const agent = cap(holds ? l?.agent ?? held[0]?.agent ?? f.owner : l!.agent);
  return iconBtn('unlock', t('release_title', { agent, title: quote(titleOf(id)) }), () => release(id, agent), { 'aria-label': t('release_btn', { agent }) });
}
/** Release from the header or a list card: same confirmation (only when the holder is mid-turn, read at click time). */
function release(id: string, agent: string) {
  const holder = S.threads.get(id);
  if (holder?.state === 'run' && !confirm(t('release_confirm', { agent, title: quote(holder.title) }))) return;
  send({ type: 'action', thread: id, kind: 'release' });
}
/** « Holds a slot » on a list card: the thread keeps one of the agent's places while nothing runs there (cooperative
 *  mode keeps it until closed or released, so a quiet thread could fill `max` unseen). Release is in the card's hover menu. */
const placeBadge = (f: PublicThread) => {
  const l = lockOf(f);
  return keepsPlace(l, f) ? h('span', { class: 'chip c-place tip tip-below', 'data-tip': t('keeps_place_tip', { agent: cap(l!.agent) }) }, icon('lock', 11) as unknown as Node, t('keeps_place')) : null;
};
function placeRelease(f: PublicThread, stop: (fn: () => void) => (e: Event) => void) {
  const l = lockOf(f);
  if (!keepsPlace(l, f)) return null;
  const agent = cap(l!.agent);
  return iconBtn('unlock', t('release_title', { agent, title: quote(f.title) }), stop(() => release(f.id, agent)), { 'aria-label': t('release_btn', { agent }) });
}
/** One thin line under the thread header (the boxed banner repeated the chip and the status line): waiting
 *  (resource, then agent hand), or holding while other threads wait. Release is in the header icons. */
function lockLine(f: PublicThread) {
  if (f.kind === 'topic') return null;
  const l = lockOf(f), n = queuePos(f), p = parked(f);
  const parts: (Node | string | null)[][] = [];
  if (p) {
    const by = p.lock.holder;
    parts.push([h('b', {}, t('res_wait_b')), h('code', {}, p.lock.resource),
      !by ? t('res_wait_free') : S.threads.has(by) ? h('span', {}, t('res_wait_by'), threadLink(by)) : t('res_wait_by_unknown', { title: t('another_thread') }),
      t('res_wait_tail', { pos: ordinal(p.pos), agent: cap(f.owner) })]);
  }
  if (l && n) {
    const links = l.holders.map(id => threadLink(id) ?? quote(titleOf(id)));
    parts.push([h('b', {}, t('queued_b')),
      l.holders.length > 1 ? t('queued_on_many', { agent: cap(f.owner) }) : t('queued_on', { agent: cap(f.owner) }),
      ...(links.length ? links.flatMap((x, i) => i ? [', ', x] : [x]) : [t('queued_running')]),
      t('queued_tail', { pos: ordinal(n), agent: cap(f.owner) })]);
  }
  if (l?.holders.includes(f.id) && l.queue.length) parts.push([h('b', {}, t('holder_b', { agent: cap(f.owner) })), tn('holder_tail', l.queue.length),
    l.queue.map(titleOf).map(quote).join(', ')]);
  for (const r of heldWithQueue(S.resources.values(), f)) parts.push([h('b', {}, t('res_holder_b')), h('code', {}, r.resource), tn('res_holder_tail', r.queue.length),
    r.queue.map(titleOf).map(quote).join(', ')]);
  return parts.length ? h('div', { class: 'lockline', role: 'status' }, ...parts.flatMap((x, i) => i ? [' · ', ...x] : x)) : null;
}
// "Milan is working…" line under the last message, while the turn runs: that's where one looks
// (the chip at the top stays for whoever lands on the thread or scrolled up the history). The phrase of the running tool
// comes from the plugin (status frame) and replaces the former tool progress bubbles.
/** « Milan is not connected, message not delivered »: under the message the hub could not hand to the agent. */
const undeliveredEl = (agent: string) => h('div', { class: 'undelivered', 'data-k': 'undelivered', role: 'status' }, icon('wifiOff', 14) as unknown as Node,
  h('span', {}, t('undelivered', { agent: cap(agent) })));
// A topic or a thread can have several agents working at once: one line each, the Stop button (it stops them all) on the last.
function workingEl(f: PublicThread) {
  const agents = workingAgents(f);
  if (!agents.length) return null;
  const all = agents.map(cap).join(', ');
  // Stop: trusted humans only (the hub checks). Once asked, « stop requested… » for everyone until the turn end.
  // Text link after a « · » (pick, variant B): muted at rest, accent orange + underline on hover.
  const stop = f.stopping ? h('span', { class: 'w-stopping' }, t('stop_asked'))
    : S.trusted.has(f.space) ? h('button', { class: 'w-stop tip', type: 'button', 'data-tip': t('stop_turn_tip', { agent: all }), 'aria-label': t('stop_turn_tip', { agent: all }),
      onclick: () => send({ type: 'turn.stop', thread: f.id }) }, t('stop_turn')) : null;
  const line = (a: string, last: boolean) => {
    const k = statusKey(f.id, a), st = S.status.get(k), plain = nontech(f.space), what = plain ? null : st?.text, end = last ? stop : null;
    const p = progressOf(st, Date.now()), meta = [p.min !== null ? t('w_min', { n: p.min }) : '', p.steps !== null ? tn('w_steps', p.steps) : ''].filter(Boolean).join(' · ');
    const n = plain ? feedOf(st?.recent, st?.text).length : st?.recent?.length ?? 0, open = n > 0 && S.feedOpen.has(k);
    const verb = steadyActivity(st?.recent, st?.text); // « Milan is searching… »: client/src/activity.ts
    // Activity feed toggle: the last tool phrases of the turn (status.recent), unfolded under the line.
    const feedBtn = n ? h('button', { class: 'w-feed-btn', type: 'button', 'aria-expanded': String(open), title: t('w_feed_tip', { agent: cap(a) }),
      onclick: () => { if (!S.feedOpen.delete(k)) S.feedOpen.add(k); render(); } }, icon(open ? 'chevronDown' : 'chevronRight', 12) as unknown as Node, tn('w_feed', n)) : null;
    return h('div', { class: 'working', 'data-k': agents.length === 1 ? 'working' : `working:${a}`, role: 'status' }, h('span', { class: 'pulse' }),
      h('span', { class: 'w-who' }, t(verb === 'work' ? 'working' : `working_${verb}`, { agent: cap(a) })), what ? h('span', { class: 'w-what' }, what) : null,
      meta ? h('span', { class: 'w-meta' }, meta) : null, feedBtn,
      end ? h('span', { class: 'w-sep', 'aria-hidden': 'true' }, '·') : null, end);
  };
  return agents.length === 1 ? line(agents[0], true) : h('div', { class: 'workings', 'data-k': 'working' }, ...agents.map((a, i) => line(a, i === agents.length - 1)));
}
/** No turn running but background work declared: same look as the working line, so the thread does not read as idle.
 * Click = the info panel and its task list (threads only: a topic has no panel). No Stop: the hub cannot stop it. */
function bgWorkingEl(f: PublicThread) {
  const l = bgLine(f, Date.now());
  if (!l) return null;
  const dur = l.min === null ? '' : l.min < 60 ? t('w_min', { n: l.min }) : t('w_h', { n: Math.floor(l.min / 60) });
  const meta = [l.more ? tn('bg_more', l.more) : '', dur].filter(Boolean).join(' · ');
  const panel = f.kind !== 'topic';
  return h(panel ? 'button' : 'div', { class: `working bg-working${panel ? ' w-click' : ''}`, 'data-k': 'bg-working', role: 'status', title: bgTip(f),
    ...(panel ? { type: 'button', 'aria-label': t('bg_open_tip'), onclick: () => setInfo(true) } : {}) }, h('span', { class: 'pulse' }),
    h('span', { class: 'w-who' }, t('bg_working', { agent: cap(f.owner) })), h('span', { class: 'w-what' }, l.goal), meta ? h('span', { class: 'w-meta' }, meta) : null);
}
// Agent's browser thumbnail (protocol/browser.ts): this tab tells the hub which conversation it has on screen (a hidden
// tab: none), so the agent's captures come only while someone looks. One frame per change, per space.
let watchSent: { space: string; thread: string } | null = null;
function syncWatch() {
  const f = S.sel && S.sel !== 'new' && !document.hidden ? S.threads.get(S.sel) : undefined;
  const want = f && S.mySpaces?.has(f.space) ? { space: f.space, thread: f.id } : null;
  if (want?.thread === watchSent?.thread || ws?.readyState !== WebSocket.OPEN || !S.mySpaces?.size) return;
  if (watchSent && watchSent.space !== want?.space) ws.send(JSON.stringify({ v: 2, type: 'browser.watch', space: watchSent.space, thread: null }));
  if (want) ws.send(JSON.stringify({ v: 2, type: 'browser.watch', ...want }));
  watchSent = want;
}
document.addEventListener('visibilitychange', syncWatch);
/** The last capture of each working agent's browser, under its line; a click enlarges it. Dropped when stale (BROWSER_STALE_MS). */
// One re-render when the newest capture turns still (BROWSER_STILL_MS without a new one): the glow slows and fades.
let stillT: ReturnType<typeof setTimeout> | undefined;
function stillTimer() { clearTimeout(stillT); stillT = setTimeout(render, BROWSER_STILL_MS + 50); }
function browserEls(f: PublicThread) {
  const working = workingAgents(f), now = Date.now();
  return [...S.browser].flatMap(([k, b]) => {
    const fr = b.f.thread === f.id ? shownFrame(b.f, b.got, now, working.includes(b.f.agent)) : null;
    if (!fr) return [];
    const big = S.feedOpen.has(`browser:${k}`), still = now - b.got >= BROWSER_STILL_MS, label = t('browser_tip', { agent: cap(fr.agent) });
    const size = fr.w && fr.h ? { width: String(fr.w), height: String(fr.h) } : {};
    // Live look: a light running around the frame (two stable layers, fast and slow, crossfaded when still, so the
    // rotation never jumps), a pulsing « Live » badge, and each new capture fading in over the previous one (keyed by
    // its `at`, so morphdom inserts a new <img> and its animation plays).
    return [h('button', { class: `w-browser${big ? ' big' : ''}${still ? ' still' : ''}`, type: 'button', 'data-k': `browser:${fr.agent}`, title: label, 'aria-label': label, 'aria-expanded': String(big),
      onclick: () => { if (!S.feedOpen.delete(`browser:${k}`)) S.feedOpen.add(`browser:${k}`); render(); } },
      h('span', { class: 'wb-glow fast', 'aria-hidden': 'true' }), h('span', { class: 'wb-glow slow', 'aria-hidden': 'true' }),
      h('span', { class: 'wb-frame' },
        b.prev ? h('img', { class: 'wb-prev', 'data-k': 'prev', src: `data:image/jpeg;base64,${b.prev}`, alt: '', ...size }) : null,
        h('img', { class: 'wb-cur', 'data-k': `at:${fr.at}`, src: `data:image/jpeg;base64,${fr.jpeg}`, alt: '', ...size })),
      h('span', { class: 'wb-live', 'aria-hidden': 'true' }, h('span', { class: 'wb-dot' }), t('browser_live')))];
  });
}
/** Unfolded activity feeds under the working line(s): oldest first, the running tool last. Ephemeral, never stored. */
function activityEls(f: PublicThread) {
  return workingAgents(f).flatMap(a => {
    const k = statusKey(f.id, a), st = S.status.get(k), recent = nontech(f.space) ? feedOf(st?.recent, st?.text) : st?.recent ?? [];
    return recent.length && S.feedOpen.has(k) ? [h('ol', { class: 'w-feed', 'data-k': `feed:${a}`, 'aria-label': t('w_feed_tip', { agent: cap(a) }) },
      ...recent.map(r => h('li', {}, r)))] : [];
  });
}
/** « Stopped by Blair » line posted by the hub at the end of a stopped turn, in the reader's language. */
const stopText = (m: Message) => m.voiceAsk ? t('voice_asked') : !m.stop ? m.text : !m.stop.by ? t('stopped')
  : t('stopped_by', { name: personName(m.stop.by) ?? (m.stop.by === S.me ? t('you') : t('member_id', { id: m.stop.by.slice(0, 6) })) });
// Turn outcome announced by the agent: "✓ done" next to the chip, or the action it expects from you (stays Your turn until "Done").
// A wait set by the hub because the background work went silent (`lost`) says so before the goals.
const waitingFor = (f: PublicThread) => f.state !== 'run' && f.outcome?.kind === 'waiting' ? (f.outcome.lost ? t('bg_lost') : '') + (f.outcome.action ?? '') : null;
const doneChip = (f: PublicThread) => h('span', { class: 'chip c-ok', title: t('done_title', { agent: cap(f.owner) }) }, t('done_tag'));
// Extra « ✓ done » next to the state chip (Your turn, Waiting); when Quiet, the state chip itself says it (`agentDone`).
const doneTag = (f: PublicThread) => f.state !== 'run' && f.outcome?.kind === 'done' && !agentDone(shown(f), f) ? doneChip(f) : null;
const waitLine = (f: PublicThread) => { const a = waitingFor(f); return a === null ? null : h('div', { class: 'await-line' }, h('b', {}, t('waiting_for')), a); };
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
// « Done » already sent for this wait (`outcome.at`): a double click sends nothing more (the hub re-checks it too).
let handledAt = 0;
function awaitBanner(f: PublicThread) {
  const a = waitingFor(f);
  if (a === null) return null;
  const at = f.outcome!.at, resume = !!f.outcome!.resume;
  return h('div', { class: 'await', role: 'status' },
    h('div', { class: 'aw-t' }, h('b', {}, t('await_b', { agent: cap(f.owner) })), a),
    h('button', { class: 'btn pri', title: t(resume ? 'handled_resume_title' : 'handled_title', { agent: cap(f.owner) }),
      onclick: () => { if (handledAt === at) return; handledAt = at; send({ type: 'action', thread: f.id, kind: 'handled', at, lang: lang() }) } },
      t(resume ? 'handled_resume_btn' : 'handled_btn')));
}
const open = (id: string | null) => { S.sel = id; S.err = ''; S.jump = null; if (id && id !== 'new') loadHistory(id); render(); };
const lastConv: LastConv = new Map(); // last conversation per sidebar entry, this tab only (lastconv.ts)
const narrow = () => matchMedia('(max-width:700px)').matches; // same breakpoint as style.css: one pane at a time
/** Space, Lounge, Later, Closed entries: reopen the conversation left there; a click on the active entry shows the list alone. */
function goEntry(v: { kind: 'space' | 'lounge' | 'later' | 'closed'; id: string }) {
  const active = routeOf(S.view, null) === routeOf(v, null);
  const sel = reopen(lastConv, v, id => S.threads.get(id), { active, narrow: narrow() });
  S.view = v; open(v.kind === 'lounge' && sel && isGeneralId(sel) ? null : sel);
}

/** Pulsing dot right after the entry's name (an agent is at work behind it); `tip` says what. */
function busyDot(el: HTMLElement, tip: string) {
  if (tip) el.querySelector('.nav-t')!.after(h('span', { class: 'pulse busy', role: 'img', title: tip, 'aria-label': tip }));
  return el;
}
/** Tooltip of the busy dot: running threads, topics in progress, or both (folded space row). */
const busyTip = (n: { threads: number; topics: number }) =>
  [n.threads ? tn('busy', n.threads) : '', n.topics ? tn('busy_topics', n.topics) : ''].filter(Boolean).join(' · ');
/** Space entry: the busy dot while folded (threads and topics); unfolded, it moves onto Lounge / Work (one place at a time). */
function spaceNav(space: string, el: HTMLElement, here: boolean) {
  if (!here) busyDot(el, busyTip(busyCounts(S.threads.values(), space)));
  // `synced` never came (boot.ts TIMEOUT): marked until it arrives; the space's lists stay on « Loading… ».
  if (unloaded(B, [space], Date.now()).length) (el.querySelector('.busy') ?? el.querySelector('.nav-t'))!.after(
    h('span', { class: 'unloaded', role: 'img', title: t('space_unloaded'), 'aria-label': t('space_unloaded') }, icon('cloudOff', 14) as unknown as Node));
  return el;
}
/** Spaces of the sidebar: active ones, then a light separator and the inactive ones (no activity for 48 h,
 * spacegroups.ts); no separator when one group is empty. `entry` draws one space (row + its sub-entries). */
function barGroups(open: string | null) {
  const mine = (S.spaces ?? []).filter(s => !S.mySpaces || S.mySpaces.has(s.id));
  return spaceGroups(mine, S.threads.values(), { now: Date.now(), open, unknown: new Set(mine.map(s => s.id).filter(id => !B.synced.has(id))), muted: mutedSet(S.mutes) });
}
function spaceList(open: string | null, entry: (s: { id: string; name: string }) => (HTMLElement | null)[]) {
  const g = barGroups(open);
  // Muted: a group folded at the bottom, unfolded while it holds the open space.
  const unfolded = S.mutedOpen || g.muted.some(s => s.id === open);
  return [...g.active.flatMap(entry),
    g.active.length && g.inactive.length ? h('div', { class: 'sp-sep', role: 'separator', title: t('spaces_inactive'), 'aria-label': t('spaces_inactive') }) : null,
    ...g.inactive.flatMap(entry),
    g.muted.length ? h('button', { type: 'button', class: 'sp-muted-h', 'data-k': 'sp-muted', 'aria-expanded': String(unfolded), onclick: () => { S.mutedOpen = !unfolded; render(); } },
      icon(unfolded ? 'chevronDown' : 'chevronRight', 13) as unknown as Node, h('span', {}, t('spaces_muted')), h('span', { class: 'n' }, String(g.muted.length))) : null,
    ...(unfolded ? g.muted.flatMap(entry) : [])];
}
function side() {
  const nYou = yourTurnCount();
  // calm: neutral counter (unread Lounge topics), not to be mistaken for "Your turn".
  // Narrow screens: picking an entry closes the drawer.
  const memBadgeTip = (el: HTMLElement, n?: number) => { if (n) el.title = tn('mem_pending', n); return el; };
  const nav = (ic: string, text: string, on: boolean, open: () => void, badge?: number, calm = false, go = () => { S.drawer = false; open(); }) =>
    h('div', { class: `nav ${on ? 'on' : ''}`, tabindex: 0, onclick: go, onkeydown: (e: KeyboardEvent) => e.key === 'Enter' && go() },
      icon(ic) as unknown as Node, h('span', { class: 'nav-t' }, text), badge ? h('b', { class: calm ? 'calm' : '' }, String(badge)) : null);
  // Now stands out: "Your turn" counter always shown (orange when there is something, neutral at zero).
  const now = nav('inbox', t('now'), S.view.kind === 'now', () => { S.view = { kind: 'now' }; render(); });
  now.classList.add('now');
  now.append(h('b', { class: nYou ? '' : 'zero', title: t('your_turn_count', { n: nYou }) }, String(nYou)));
  const find = nav('search', t('search'), P.open, openPalette);
  const curSpace = S.view.kind === 'now' || S.view.kind === 'newspace' ? null : S.view.id;
  find.classList.add('find');
  find.append(h('kbd', {}, IS_MAC ? '⌘K' : 'Ctrl K'));
  return h('aside', { class: 'side' },
    h('div', { class: 'brand' }, 'brief', h('span', {}, 'ling')),
    now, find,
    h('div', { class: 'label sp-label' }, h('span', {}, t('spaces')),
      S.admin ? iconBtn('plus', t('new_space'), () => { S.view = { kind: 'newspace' }; S.sel = null; S.err = ''; S.drawer = false; render(); }, { class: `btn ic sp-add ${S.view.kind === 'newspace' ? 'on' : ''}` }) : null),
    ...spaceList(curSpace, s => {
      // Only the current space is unfolded (~25 lines of sidebar); Settings = the gear on the space row.
      const here = curSpace === s.id;
      // A click on the space opens its Lounge (discuss before acting); the thread list is the Work entry.
      // Your turn counter: on the space row while folded, on Work once unfolded (one place at a time).
      const nYouHere = [...S.threads.values()].filter(f => f.space === s.id && counted(f)).length;
      const row = spaceNav(s.id, nav('folder', s.name, false, () => goEntry({ kind: 'lounge', id: s.id }), here ? 0 : nYouHere), here);
      const busyHere = here ? busyCounts(S.threads.values(), s.id) : null;
      const loungeUnread = muted(s.id) ? 0 : loungeTopics(S.threads.values(), s.id).filter(unread).length; // muted: no Lounge counter
      // Folded space: its Lounge unread counter moves onto the space row (neutral, like on the Lounge entry).
      if (!here && loungeUnread) row.insertBefore(h('b', { class: 'calm', title: tn('lounge_unread', loungeUnread), 'aria-label': tn('lounge_unread', loungeUnread) }, String(loungeUnread)), row.querySelector(':scope > b'));
      // Settings: admin only (the hub refuses the others anyway). Gear before the badges, shown on hover (style.css).
      // Mute (any member): on hover, left of the gear; touch: long press on the row (sheet).
      row.insertBefore(iconBtn(muted(s.id) ? 'bell' : 'bellOff', t(muted(s.id) ? 'space_unmute' : 'space_mute', { space: s.name }), (e: Event) => { e.stopPropagation(); toggleMute(s.id); },
        { class: `btn ic sp-mute${spaceAdmin(s.id) ? '' : ' solo'}`, 'data-k': `sp-mute-${s.id}` }), row.querySelector(':scope > b'));
      // Through on(), never as properties: patch() hands over only on() handlers, a property kept the first render's space.
      for (const [k, fn] of Object.entries(pressAttrs({ kind: 'space', id: s.id }))) on(row, k.slice(2), fn);
      if (spaceAdmin(s.id)) row.insertBefore(iconBtn('settings', t('settings_title', { space: s.name }), (e: Event) => { e.stopPropagation(); S.view = { kind: 'settings', id: s.id }; S.sel = null; S.err = ''; S.drawer = false; render(); },
        { class: `btn ic sp-gear ${S.view.kind === 'settings' && S.view.id === s.id ? 'on' : ''}` }), row.querySelector(':scope > b'));
      return [h('div', { class: 'space' }, row),
        here ? h('div', { class: 'sub' },
          busyDot(nav('messagesSquare', t('lounge'), S.view.kind === 'lounge' && S.view.id === s.id, () => goEntry({ kind: 'lounge', id: s.id }),
            loungeUnread, true), busyTip({ threads: 0, topics: busyHere!.topics })),
          busyDot(nav('thread', t('nav_work'), (S.view.kind === 'space' || S.view.kind === 'later' || S.view.kind === 'closed') && S.view.id === s.id, () => goEntry({ kind: 'space', id: s.id }), nYouHere),
            busyTip({ threads: busyHere!.threads, topics: 0 })),
          // Modules in their own files (reminders…): every member, when the module is on (the always-on ones have their own place).
          ...mods().filter(m => m.module && modOn(s.id, m.module) && (m.shown?.(s.id) ?? true)).map(m => nav(m.icon, t(m.label), S.view.kind === m.view && S.view.id === s.id, () => { S.view = { kind: m.view, id: s.id }; S.sel = null; render(); }, m.badge(s.id))),
          // Board: only if a GitHub Project is linked to the space.
          modOn(s.id, 'board') && hasBoard(S.github.get(s.id), S.repos.get(s.id))
            ? nav('track', t('board'), S.view.kind === 'overview' && S.view.id === s.id, () => { S.view = { kind: 'overview', id: s.id }; S.sel = null; render(); }) : null,
          // Flow: every member (the hub checks membership; who started what is shown to all, rights to be decided later).
          !modOn(s.id, 'lineage') ? null : nav('branch', t('lineage'), S.view.kind === 'lineage' && S.view.id === s.id, () => { S.view = { kind: 'lineage', id: s.id }; S.sel = null; render(); }),
          // Radar: every member reads it (leads sort); badge = signals to sort, once listed.
          !modOn(s.id, 'radar') ? null : nav('radar', t('radar'), S.view.kind === 'radar' && S.view.id === s.id, () => { S.view = { kind: 'radar', id: s.id }; S.sel = null; render(); }, toSort(rd().by.get(s.id)) || undefined, true),
          // Applets: the space's leads only (they launch agent turns; the hub refuses the others).
          // « threads » off: still there, a run then opens a Lounge topic (hub/src/applets.ts).
          ap().hasApplets(s.id) || (S.view.kind === 'applets' && S.view.id === s.id) ? nav('applet', t('applets'), S.view.kind === 'applets' && S.view.id === s.id, () => { S.view = { kind: 'applets', id: s.id }; S.sel = null; ap().reset(); render(); }, undefined, true) : null,
          // Exchanges: the space's leads only (the hub refuses the others); mails with its correspondents.
          S.trusted.has(s.id) && modOn(s.id, 'exchanges') ? nav('mail', t('exchanges'), S.view.kind === 'exchanges' && S.view.id === s.id, () => { S.view = { kind: 'exchanges', id: s.id }; S.sel = null; ex().unfold(''); render(); }, undefined, true) : null,
          // Metrics: every member (the hub checks membership).
          !modOn(s.id, 'metrics') ? null : nav('chart', t('metrics'), S.view.kind === 'metrics' && S.view.id === s.id, () => { S.view = { kind: 'metrics', id: s.id }; S.sel = null; render(); }),
          // Memory: every member reads it (the hub checks membership and every decision); badge = entries waiting for my review.
          memBadgeTip(nav('memory', t('memory'), S.view.kind === 'memory' && S.view.id === s.id, () => { S.view = { kind: 'memory', id: s.id }; S.sel = null; mem().reset(); render(); }, mem().badge(s.id), true), mem().badge(s.id))) : null];
    }),
    h('div', { class: 'foot' },
      // The footer is ~190 px wide: the extra icon buttons (bell, language) sit on the "Hub connected" row.
      h('div', { class: 'foot-row' }, h('div', { class: 'conn' }, h('span', { class: `dot ${S.conn === 'on' ? 'ok' : S.conn === 'retry' ? 'ko' : ''}` }), S.conn === 'on' ? t('conn_on') : S.conn === 'retry' ? t('conn_retry') : t('conn_off')),
        h('div', { class: 'foot-btns' }, bellBtn(), langBtn())),
      themeSwitch(),
      lg().profileEl(),
      h('button', { class: 'linkbtn', onclick: logout }, t('logout'))));
}
// « Secret » dialog (client/src/secret.ts): the value is encrypted here for the agent's key, never posted as text.
let secretDlg: { thread: string; space: string; agent: string; name: string; kind: SecretKind; value: string; busy: boolean; err: string } | null = null;
function openSecret(f: PublicThread) {
  secretDlg = { thread: f.id, space: f.space, agent: f.owner, name: '', kind: 'password', value: '', busy: false, err: '' }; render();
  setTimeout(() => (document.getElementById('sec-name') as HTMLInputElement | null)?.focus());
}
function closeSecret() { secretDlg = null; render(); } // the value goes with the state, nothing else holds it
async function sendSecret() {
  const d = secretDlg;
  if (!d || d.busy) return;
  const name = secretFormError(d.name, d.value) === 'name' ? suggestName(d.name) : d.name;
  const bad = secretFormError(name, d.value);
  if (bad) { d.err = t(bad === 'name' ? 'err_secret_name' : bad === 'empty' ? 'err_secret_empty' : 'err_secret_long'); render(); return; }
  d.name = name; d.busy = true; d.err = ''; render();
  const agent = cap(d.agent);
  const fail = (code?: string) => { if (secretDlg !== d) return; d.busy = false;
    d.err = t(code === 'not_connected' ? 'err_secret_offline' : code === 'stale_key' ? 'err_secret_stale' : code === 'forbidden' ? 'err_secret_forbidden' : 'err_secret_failed', { agent }); render(); };
  const k = await request({ type: 'secret.key', thread: d.thread, agent: d.agent }, 8000, true);
  if (k?.type !== 'secret.key') return fail(k?.type === 'error' ? k.code : undefined);
  let box;
  try { box = await encryptSecret(k.key, { space: d.space, thread: d.thread, agent: d.agent, name, kind: d.kind }, d.value); }
  catch { return fail(); }
  if (secretDlg !== d) return; // closed meanwhile: nothing sent
  const r = await request({ type: 'secret.send', thread: d.thread, agent: d.agent, key: k.key, name, kind: d.kind, ...box }, 8000, true);
  if (r?.type !== 'ack') return fail(r?.type === 'error' ? r.code : undefined);
  if (secretDlg === d) closeSecret();
}
function secretDialog() {
  const d = secretDlg!, agent = cap(d.agent);
  const keys = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); closeSecret(); }
    else if (e.key === 'Enter' && !e.isComposing && (e.target as HTMLElement).tagName !== 'TEXTAREA') { e.preventDefault(); void sendSecret(); } };
  const set = (fn: (v: string) => void) => (e: Event) => { fn((e.target as HTMLInputElement).value); d.err = ''; };
  const field = (id: string, label: string, el: HTMLElement) => h('div', { class: 'sp-field' }, h('label', { class: 'label', for: id }, label), el);
  // Value: never echoed back from the state into the DOM on re-render (the field keeps it), no autofill, no spellcheck.
  const common = { id: 'sec-value', autocomplete: 'off', spellcheck: 'false', 'data-1p-ignore': 'true', 'data-lpignore': 'true', maxlength: SECRET_VALUE_MAX, onkeydown: keys, oninput: set(v => { d.value = v; }) };
  const value = d.kind === 'private_key' ? h('textarea', { ...common, rows: 6, class: 'sec-val' }) : h('input', { ...common, type: 'password' });
  (value as HTMLInputElement).value = d.value;
  return h('div', { class: 'pal-wrap', 'data-k': 'secret' },
    h('div', { class: 'scrim', onclick: closeSecret }),
    h('div', { class: 'dlg', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sec-t', onkeydown: keys },
      h('h2', { id: 'sec-t' }, t('secret_dlg', { agent })),
      field('sec-name', t('secret_name'), h('input', { id: 'sec-name', value: d.name, maxlength: 64, placeholder: 'DB_PASSWORD', autocomplete: 'off', spellcheck: 'false', oninput: set(v => { d.name = v; }) })),
      field('sec-kind', t('secret_kind'), h('select', { id: 'sec-kind', onchange: (e: Event) => { d.kind = (e.target as HTMLSelectElement).value as SecretKind; render(); } },
        ...SECRET_KINDS.map(k => h('option', { value: k, selected: k === d.kind }, t(`secret_kind_${k}` as Key))))),
      field('sec-value', t('secret_value'), value),
      h('div', { class: 'sp-hint' }, t(d.kind === 'totp' ? 'secret_hint_totp' : 'secret_hint', { agent })),
      d.err ? h('div', { class: 'err dlg-err', role: 'alert' }, d.err) : null,
      h('div', { class: 'dlg-btns' },
        h('button', { class: 'btn ghost', onclick: closeSecret }, t('cancel')),
        h('button', { class: 'btn pri', disabled: d.busy, onclick: () => void sendSecret() }, d.busy ? t('secret_sending') : t('secret_send')))));
}
/** Line « Blair shared DB_PASSWORD with Milan · received » (never the value). */
function secretLineEl(m: Message) {
  const s = m.secret!, by = s.by === S.me ? (personName(s.by) ?? t('you')) : personName(s.by) ?? t('member_id', { id: s.by.slice(0, 6) });
  return h('div', { class: 'm system sec-line', title: fullDate(m.at) }, h('span', { class: 'm-gut' }, hhmm(m.at)),
    h('div', { class: 'md' }, icon('key', 13) as unknown as Node, ' ', t('secret_line', { by, name: s.name, agent: cap(s.agent) }), ' · ',
      h('span', { class: `sec-st ${s.status}` }, t(`secret_${s.status}` as Key))));
}
// ---------------------------------------------------------------- agent web preview, voice channel, visitor link (client/src/previewview.ts)
const { openPreview, closePreview, onPreviewFrame, voiceDock, pvBar, askVoice, voiceAcked, voiceOnLine, voiceOnMessage, voiceOnThread, voiceDraftEls, previewLineEl, open: pvOpen } = previewModule(kitOf(), S, { rand, cap, iconBtn, fullDate, cardBand, kindIc, noteMentions: (space, text) => noteMentions(space, text), toBottom, notePosted,
  avatarClass, face, previewUrl: cfg.previewUrl, voiceAgentOf: (th: PublicThread) => voiceAgentOf(th) });
/** Photo chosen: shrunk here (client/src/avatar.ts), or a visible message (type, unreadable, too big). */
async function pickAvatar(file: File, ok: (src: string) => void, ko: (err: string) => void) {
  const r = await shrinkAvatar(file);
  if (r.startsWith('data:')) ok(r); else ko(t(`err_${r}` as Key));
  render();
}
/** Photo row (Profile, agents' Settings): the avatar as others will see it, « Choose a photo », « Remove ». */
function avatarField(src: string, name: string, kind: 'human' | 'agent', k: string, pick: (f: File | undefined) => void, remove: () => void, disabled = false) {
  const file = h('input', { type: 'file', accept: 'image/*', hidden: true, 'data-k': `${k}-file`, 'aria-label': t('avatar_pick'),
    onchange: (e: Event) => { const i = e.target as HTMLInputElement; const f = i.files?.[0]; i.value = ''; pick(f); } });
  const open = () => (file as HTMLInputElement).click();
  // Agent row of the Settings (compact): the avatar is the button, a cross removes the photo.
  if (kind === 'agent') return h('div', { class: 'av-field compact', 'data-k': k }, file,
    h('button', { class: 'avatar av-pick av-agent tip', type: 'button', 'data-k': `${k}-pick`, disabled, onclick: open, 'data-tip': src ? t('avatar_change') : t('avatar_pick'),
      'aria-label': `${src ? t('avatar_change') : t('avatar_pick')} (${cap(name)})` }, face(src, name)),
    src ? iconBtn('x', t('avatar_remove'), remove, { class: 'btn ic av-rm', 'data-k': `${k}-remove`, disabled }) : null);
  return h('div', { class: 'av-field', 'data-k': k },
    h('span', { class: `avatar av-big av-round ${avatarClass({ kind: 'human', id: S.me })}`, 'aria-hidden': 'true' }, face(src, name)),
    file,
    h('button', { class: 'btn', type: 'button', 'data-k': `${k}-pick`, disabled, onclick: open }, src ? t('avatar_change') : t('avatar_pick')),
    src ? h('button', { class: 'btn ghost', type: 'button', 'data-k': `${k}-remove`, disabled, onclick: remove }, t('avatar_remove')) : null);
}
function list() {
  if (S.view.kind === 'lounge') return loungeList(S.view.id);
  if (S.view.kind === 'later') return laterList(S.view.id);
  if (S.view.kind === 'closed') return closedList(S.view.id);
  const all = [...S.threads.values()].filter(f => live(f) && f.kind !== 'topic').sort((a, b) => b.updatedAt - a.updatedAt);
  const now = S.view.kind === 'now';
  const space = S.view.kind === 'space' ? S.view.id : null;
  // Pinned: at the top of the space list, for oneself only; they leave their state group but keep their chip.
  const pins = now ? [] : all.filter(f => f.space === space && pinned(f));
  // Empty sections hidden: no "Nothing here.", hence never a counter at 0.
  const dues = now ? dueExchanges(ex().by, S.trusted, Date.now()).filter(x => modOn(x.space, 'exchanges')) : []; // Your turn of a lead: exchanges ours for 3 days
  const groups: [string, string, PublicThread[]][] = (now ? []
    : [['pin', t('pinned'), pins] as [string, string, PublicThread[]],
      // Later (idea) and Closed (done) have their own sidebar entries, out of the work list.
      ...(['you', 'run', 'wait', 'calm'] as ThreadState[]).map(st => { const fs = all.filter(f => f.space === space && shown(f) === st && !pinned(f) && !shelfOf(f)); return [st, label(st), st === 'wait' ? waitOrder(fs, placeIn) : fs] as [string, string, PublicThread[]]; })])
    .filter(([key, , fs]) => fs.length || (key === 'you' && dues.length));
  const card = threadCard;
  return h('section', { class: 'list' },
    h('header', {}, menuBtn(), h('div', {}, h('h2', {}, now ? t('now') : spaceName(space!)), now ? h('p', {}, t('now_sub')) : null),
      // Space list: back to its Bar (Blair, in place of the removed « Topic » button); Now spans every space, so none.
      space ? barBtn(space) : null),
    space ? shelfSeg(space, 'space') : null,
    // Now: the Recents tree of every space, Active only, my turns first; the exchanges due to a lead above.
    now ? h('div', { class: 'scroll' }, rc().nowEl({ mine, muted: mutedSet(S.mutes), extra: f => [columnChip(f), placeBadge(f), waitLine(f)], menu: cardMenu, press: f => pressAttrs({ kind: 'card', id: f.id }),
      top: dues.length ? h('div', { class: 'secbox', 'data-k': 'b:you' }, h('div', { class: 'group label', 'data-k': 'g:you' }, icon(STATE_ICON.you, 13) as unknown as Node, label('you'),
        h('span', { class: 'count' }, String(dues.length))), ...dues.map(ex().dueCard)) : null })) :
    h('div', { class: 'scroll' }, ...groups.flatMap(([key, name, fs]) => {
      const svg = icon(key === 'pin' ? 'pin' : STATE_ICON[key as ThreadState], 13);
      // In progress: its loader spins (`.spin`, style.css). The whole svg turns: square box centred on the arc (r=9
      // around 12,12), so the rotation stays round. Unkeyed but always the header's first child: morphdom keeps the
      // node across renders, so the animation never restarts.
      if (key === 'run') svg.setAttribute('class', 'spin');
      const extra = key === 'you' ? dues.map(ex().dueCard) : [];
      const ic = svg as unknown as Node, n = h('span', { class: 'count' }, String(fs.length + extra.length));
      // Pinned: same framed block as in the Lounge (blue frame and title). Every section is framed the same way
      // (the sections were hard to tell apart), Pinned stands out by its colour.
      // Every child keyed, headers too: patch() then inserts a new card or section in place (see patch.ts).
      if (key === 'pin') return [h('div', { class: 'pinbox', 'data-k': 'g:pin' }, h('div', { class: 'group label' }, ic, name, n), ...fs.map(card))];
      if (key !== 'calm') return [h('div', { class: 'secbox', 'data-k': `b:${key}` }, h('div', { class: 'group label', 'data-k': `g:${key}` }, ic, name, n), ...fs.map(card), ...extra)];
      // Quiet: the only foldable section, unfolded on every load (finished threads now leave it for Closed, so it stays
      // short); a click folds it until the next load.
      const open = calmOpen;
      return [h('div', { class: 'secbox', 'data-k': 'b:calm' }, h('button', { class: 'group label fold', 'data-k': 'g:calm', type: 'button', 'aria-expanded': String(open), title: open ? t('fold') : t('unfold'), onclick: () => { calmOpen = !open; render(); } },
        ic, name, n, icon(open ? 'chevronDown' : 'chevronRight', 13) as unknown as Node), ...(open ? fs.map(card) : []))];
    }), space ? moreEl(space) : null));
}
// Gateway notices (« ⏳ Working », « 💾 Self-improvement review », flagged by the plugin): one small grey line, no avatar
// nor author header, cut to one line; a click shows it all (state of this tab only).
const openNotices = new Set<string>();
function noticeEl(m: Message) {
  const open = openNotices.has(m.id);
  const toggle = () => { if (!openNotices.delete(m.id)) openNotices.add(m.id); render(); };
  return h('div', { class: `m notice${open ? ' open' : ''}`, role: 'button', tabindex: '0', 'aria-expanded': String(open),
    title: `${fullDate(m.at)} · ${t(open ? 'notice_fold' : 'notice_unfold')}`, onclick: toggle,
    onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } } },
    h('span', { class: 'm-gut' }, hhmm(m.at)), h('span', { class: 'm-notice-t' }, m.relayCap !== undefined ? t('relay_cap', { n: m.relayCap }) : m.text));
}
/** Hub « plugin updated » notices merged by the feed (`pluginRuns`): « ⟳ Plugin 0.3.76 · Milan, Gideon, Radar +2 »;
 *  a click shows every agent and the version they came from. Same grey line as `noticeEl`, keyed on the run's first id. */
function pluginNoticeEl(run: Message[]) {
  const m = run[0], p = pluginRunInfo(run), names = p.agents.map(cap), open = openNotices.has(m.id);
  const toggle = () => { if (!openNotices.delete(m.id)) openNotices.add(m.id); render(); };
  const text = open ? t('plugin_notice_open', { to: p.to, from: p.from.join(', '), agents: names.join(', ') })
    : t('plugin_notice', { to: p.to, agents: namesPlus(names) });
  return h('div', { class: `m notice plugin-notice${open ? ' open' : ''}`, role: 'button', tabindex: '0', 'aria-expanded': String(open), 'data-k': `pn:${m.id}`,
    title: `${fullDate(m.at)} · ${t(open ? 'notice_fold' : 'notice_unfold')}`, onclick: toggle,
    onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } } },
    h('span', { class: 'm-gut' }, hhmm(m.at)), h('span', { class: 'm-notice-t' }, icon('refresh', 12) as unknown as Node, text));
}
/** `cont`: grouped under the item before, decided by the caller (the Lounge feed, where topic cards count); else from `all`. */
function messageEl(m: Message, all: Message[], th: PublicThread, cont?: boolean) {
  if (m.type === 'answer') return null; // shown in its question card
  if (m.type === 'propose') return cd().proposeEl(m, all, th);
  if (m.type === 'issue' && m.newIssue) return cd().issueCardEl(m, th);
  if (m.type === 'plan' && m.plan) return cd().planCardEl(m, th);
  if (m.type === 'elevation' && m.elevation) return cd().elevationCardEl(m, th);
  if (m.type === 'about') return cd().aboutEl(m, all, th);
  if (m.type === 'applet' && m.applet) return ap().appletCardEl(m, th);
  const modCard = mods().find(x => x.card?.type === m.type)?.card;
  if (modCard && m.reminder) return modCard.el(m, th);
  if (m.type === 'github') return ghCardEl(m, th);
  if (m.secret) return secretLineEl(m);
  if (m.preview) return previewLineEl(m, th);
  if (m.plugin) return pluginNoticeEl([m]);
  if (m.notice) return noticeEl(m);
  if (m.type === 'ask' && m.ask?.items) return cd().decideEl(m, all, th);
  if (m.type === 'ask') {
    const ans = all.find(x => x.type === 'answer' && x.ask?.id === m.ask?.id);
    const live = !ans && th.state === 'you' && all.filter(x => x.type === 'ask').at(-1)?.id === m.id;
    const agent = m.author.kind === 'agent' ? who(m) : th.owner ? cap(th.owner) : t('the_agent');
    return h('div', { class: `ask k-ask ${ans ? 'done' : ''}` }, cardBand('askCard', t('card_ask'), t(live ? 'card_ask_wait' : 'card_by', { agent })),
      h('div', { class: 'k-body' }, h('div', { class: 'q md' }, renderMarkdown(m.text, x => richText(x, th.space), mdOpts(th.space))),
        ans ? askDoneEl(m.ask!.options, ans.text)
          : live && m.ask!.options.length ? h('div', { class: 'opts' }, ...m.ask!.options.map((o, i) => h('button', { class: `btn ${i === 0 ? 'pri' : ''}`, onclick: () => send({ type: 'answer', client_id: rand().slice(0, 20), thread: th.id, ask_id: m.ask!.id, option: o }) }, o)))
            : live ? h('div', { class: 'ans' }, t('answer_in_composer')) : null));
  }
  // Slack style: left-aligned list, avatar + name + time; close messages of the same author are grouped.
  const prev = groupPrev(all, all.indexOf(m));
  const grouped = cont ?? (!!prev && groupsUnder({ ...prev, lead: prev.type === 'text' }, { ...m, lead: true }, isGeneral(th) ? GAP_LOUNGE : GAP_THREAD));
  const text = stopText(m);
  const md = m.deleted ? h('div', { class: 'm-deleted', title: fullDate(m.deleted.at) }, t('msg_deleted'))
    : m.ci ? techFold(th.space, ciLineEl(m.ci), t('tech_ci')) : text.trim() ? h('div', { class: 'md' }, renderMarkdown(text, x => richText(x, th.space), mdOpts(th.space))) : null;
  // Grouped, the body is the flex item next to the gutter: `m-body` (min-width:0) keeps a long code block scrolling inside it.
  const body = h('div', grouped ? { class: 'm-body' } : {}, md, m.deleted ? null : filesEl(m));
  // « (edited) »: next to the time in the header; a grouped message has none, so at the end of its last paragraph.
  const edited = m.edited && !m.deleted ? h('span', { class: 'm-edited tip', 'data-tip': t('edited_tip', { date: fullDate(m.edited) }) }, t('edited')) : null;
  if (edited && grouped) { const last = md?.lastElementChild; if (last?.tagName === 'P') last.append(' ', edited); else body.append(edited); }
  body.append(...[originEl(m), subtopicEl(m, th), th.leadsRecalled && m.author.kind === 'agent' ? (mods(), LD!.recallEl(th, m, all)) : null, reactionsEl(m)].filter((x): x is HTMLElement => !!x));
  const lp = pressAttrs({ kind: 'msg', thread: m.thread, id: m.id });
  // A system line grouped under another one keeps the system look (label lines often come in a row).
  if (grouped) return h('div', { class: `m cont${m.author.kind === 'system' ? ' system' : ''}`, ...lp }, h('span', { class: 'm-gut', title: fullDate(m.at) }, hhmm(m.at)), body, msgTools(m));
  const name = m.author.id === S.me ? (personName(m.author.id) ?? t('you')) : who(m);
  // Hover on the avatar or the name: « Name · Function » (nothing more to show without a function).
  const role = m.author.kind === 'system' ? '' : personRole(m.author.id, m.author.kind === 'agent' ? th.space : undefined);
  return h('div', { class: `m ${m.author.kind}`, ...lp },
    h('div', { class: `avatar ${avatarClass(m.author)} ${role ? 'tip' : ''}`, ...(role ? { 'data-tip': withRole(name, role) } : {}) }, face(personAvatar(m.author.id, m.author.kind, th.space), name), authorDot(m.author, th.space)),
    h('div', { class: 'm-body' },
      h('div', { class: 'm-head' }, h('span', { class: `m-name ${role ? 'tip' : ''}`, ...(role ? { 'data-tip': withRole(name, role) } : {}) }, name),
        m.author.kind === 'agent' ? h('span', { class: 'm-badge' }, t('agent_badge')) : null,
        h('span', { class: 'm-time', title: fullDate(m.at) }, since(m.at)), edited),
      body), msgTools(m));
}

// ---------------------------------------------------------------- links and mentions
// Links: found by regex, validated by the browser's URL parser, http(s) only, opened without referrer.
const fold = (x: string) => x.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const TOKEN_RE = /(https?:\/\/[^\s<>"]+)|(@[\p{L}\p{N}_-]+)/gu;
function richText(text: string, space: string): Node[] {
  const out: Node[] = [];
  // Directory of the space + agents that spoke in the loaded threads (a former agent stays recognizable).
  const people: Person[] = [...(S.people.get(space) ?? [])];
  for (const msgs of S.msgs.values()) for (const m of msgs.values())
    if (m.author.kind === 'agent' && !people.some(p => p.id === m.author.id)) people.push({ id: m.author.id, name: m.author.id[0].toUpperCase() + m.author.id.slice(1), kind: 'agent', gone: true });
  let last = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    let tok = m[0], start = m.index!;
    if (m[1]) tok = tok.replace(/[.,;:!?)\]»'"]+$/, ''); // trailing punctuation outside the link
    out.push(document.createTextNode(text.slice(last, start)));
    if (m[1]) {
      let url: URL | null = null;
      try { url = new URL(tok); } catch { /* plain text */ }
      out.push(url && (url.protocol === 'https:' || url.protocol === 'http:')
        ? h('a', { href: url.href, target: '_blank', rel: 'noopener noreferrer' }, tok)
        : document.createTextNode(tok));
    } else {
      const p = people.find(x => fold(x.name) === fold(tok.slice(1)));
      // Same colour as the mentioned person's avatar; a mention of oneself stands out more.
      out.push(p ? h('span', { class: `mention ${avatarClass({ kind: p.kind, id: p.id })} ${p.id === S.me ? 'mine' : ''} ${p.gone ? 'gone' : ''}`, title: p.gone ? t('gone_title', { name: p.name }) : '' }, tok) : document.createTextNode(tok));
    }
    last = start + tok.length;
  }
  out.push(document.createTextNode(text.slice(last)));
  return out;
}

// ---------------------------------------------------------------- @ autocompletion, attachments, message files (client/src/composerview.ts)
const { noteMentions, attachMentions, pendings, fileUrls, fmtSize, addFiles, onUploadReady, uploadFailed, sendWait, msgText, attachments, urlFor, stickToBottom, filesEl } = attachmentsModule(kitOf(), S, {
  rand, avatarClass, face, iconBtn, dlButton: f => dlButton(f), videoEl, audioEl, openViewer: (th, fid) => openViewer(th, fid), keepAtEnd: el => keepAtEnd(el) });
// ---------------------------------------------------------------- audio: player
// Pill (pick, variant C of design/v0-audio-waveform-variants.png): play button, waveform, time; a discreet
// download button on hover. ONE audio element for the whole app, outside the rendered tree: render() never touches
// it, so playback survives every patch, and starting another file pauses the previous one. Each message shows a player
// built from `aud` (position, duration, waveform per file); while playing, the played bars and the time are updated in
// place, not through render(). Read URLs expire (10 min): a play click without a valid URL asks for one and starts
// when it arrives (`want`); a playback error (URL expired mid-file) asks again once and resumes at the same position.
const aud = new Map<string, { t: number; dur: number; peaks: number[] | null }>();
const pl = { el: null as HTMLAudioElement | null, fid: '', want: '', retried: '' };
const analysed = new Set<string>();
const audOf = (fid: string) => { let a = aud.get(fid); if (!a) aud.set(fid, a = { t: 0, dur: NaN, peaks: null }); return a; };
const playing = (fid: string) => pl.fid === fid && !!pl.el && !pl.el.paused;
const timeText = (fid: string, size: number) => {
  const a = audOf(fid), total = fmtDur(a.dur);
  return a.t > 0 || playing(fid) ? (total ? `${fmtDur(a.t)} / ${total}` : fmtDur(a.t)) : total || fmtSize(size);
};
/** Moves the played bars and the time of the players of `fid` without a render. */
function tickPlayer(fid: string) {
  const a = audOf(fid), n = playedBars(a.t, a.dur);
  for (const el of document.querySelectorAll<HTMLElement>(`.aplayer[data-fid="${fid}"]`)) {
    el.querySelectorAll('.ap-wave i').forEach((b, i) => b.classList.toggle('p', i < n));
    el.querySelector('.ap-wave')?.setAttribute('aria-valuenow', String(Math.round(a.t)));
    const tm = el.querySelector('.ap-time'); if (tm) tm.textContent = timeText(fid, Number(el.dataset.size));
  }
}
/** Waveform and duration before any play: the file is read (CORS GET on the files bucket, `connect-src`) and decoded
 *  offline. Too big or not decodable: neutral bars, and the duration from a metadata read instead (a WebM straight
 *  from MediaRecorder has none in its header: seeking far past the end makes the browser read through). */
const ANALYSE_MAX = 10 * 1024 * 1024;
async function analyse(fid: string, url: string, size: number) {
  if (analysed.has(fid)) return; analysed.add(fid);
  const a = audOf(fid);
  try {
    if (size > ANALYSE_MAX) throw new Error('too big');
    const r = await fetch(url); if (!r.ok) throw new Error(String(r.status));
    const buf = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await r.arrayBuffer());
    a.peaks = peaksOf(buf.getChannelData(0)); a.dur = buf.duration; render(); return;
  } catch { /* fall back below */ }
  const x = new Audio(); x.preload = 'metadata';
  const done = () => { if (Number.isFinite(x.duration) && x.duration > 0) { a.dur = x.duration; x.removeAttribute('src'); x.load(); render(); return true; } return false; };
  x.onloadedmetadata = () => { if (!done()) { x.ondurationchange = done; x.currentTime = 1e101; } };
  x.src = url;
}
function player(): HTMLAudioElement {
  if (pl.el) return pl.el;
  const el = pl.el = new Audio(); el.preload = 'auto';
  el.ontimeupdate = () => { if (pl.fid) { audOf(pl.fid).t = el.currentTime; tickPlayer(pl.fid); } };
  el.ondurationchange = () => { if (pl.fid && Number.isFinite(el.duration)) audOf(pl.fid).dur = el.duration; };
  el.onplay = el.onpause = () => render();
  el.onended = () => { if (pl.fid) audOf(pl.fid).t = 0; render(); };
  el.onerror = () => {
    const fid = pl.fid; if (!fid || pl.retried === fid) { S.err = t('audio_failed'); render(); return; }
    pl.retried = fid; pl.fid = ''; fileUrls.delete(fid); pl.want = fid; urlFor(fid);
  };
  return el;
}
function startAudio(fid: string, url: string) {
  const el = player(), a = audOf(fid);
  if (pl.fid !== fid) {
    // Position read BEFORE the src change: loading resets currentTime to 0 and fires a timeupdate that would overwrite it.
    const at = a.t;
    pl.fid = fid; el.src = url;
    if (at > 0) el.addEventListener('loadedmetadata', () => { el.currentTime = at; }, { once: true });
  }
  pl.want = '';
  el.play().catch(() => { /* refused (autoplay policy after the URL wait): the button stays on Play */ render(); });
}
function togglePlay(fid: string) {
  if (playing(fid)) { pl.el!.pause(); return; }
  pl.retried = '';
  const u = pl.fid === fid ? pl.el!.src : urlFor(fid);
  if (u) startAudio(fid, u); else { pl.want = fid; render(); }
}
/** URLs arrived: a play click waiting for one starts now. */
function onUrls() { if (pl.want) { const u = fileUrls.get(pl.want); if (u) startAudio(pl.want, u.url); } }
/** Seek to `v` permille of the file. */
function seek(fid: string, v: number) {
  const a = audOf(fid); if (!(a.dur > 0)) return;
  a.t = Math.min(1000, Math.max(0, v)) / 1000 * a.dur;
  if (pl.fid === fid && pl.el) pl.el.currentTime = a.t;
  tickPlayer(fid);
}
/** Download (audio, images, videos): the read URL is served inline (shown or played in the page), and `download` is
 *  ignored cross-origin, so the file is fetched and saved from a blob URL under its own name. */
async function downloadFile(f: FileRef) {
  const u = urlFor(f.id); if (!u) return;
  try {
    const r = await fetch(u); if (!r.ok) throw new Error(String(r.status));
    const href = URL.createObjectURL(await r.blob());
    const a = document.createElement('a'); a.href = href; a.download = f.name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  } catch { S.err = t('download_failed'); render(); }
}
/** Download button shown on hover over an image or a video (always visible without hover, on touch screens). */
const dlButton = (f: FileRef) => h('button', { class: 'm-dl', type: 'button', 'aria-label': `${t('download')}: ${f.name}`, title: t('download'),
  onclick: (e: MouseEvent) => { e.preventDefault(); void downloadFile(f); } }, icon('download', 14) as unknown as Node);
// ---------------------------------------------------------------- image viewer (client/src/viewerview.ts)
const vw = viewerModule(kitOf(), S, { iconBtn, urlFor, downloadFile });
const { openViewer, viewerEl } = vw;
// ---------------------------------------------------------------- video
// Native player, `preload="metadata"`: only the header (duration, first frame) is read until play. The element is part
// of the rendered tree, so its `src` must never change while it lives: a fresh read URL would restart the video. It keeps
// the first URL it got (`vidSrc`); when that URL expires mid-watch (10 min), the next range read fails, the error asks
// a new URL once and resumes at the same position.
const vidSrc = new Map<string, string>();
const vidResume = new Map<string, { t: number; play: boolean }>();
function videoError(f: FileRef, el: HTMLVideoElement) {
  if (vidResume.has(f.id)) { vidResume.delete(f.id); S.err = t('video_failed'); render(); return; }
  vidResume.set(f.id, { t: el.currentTime, play: !el.paused || el.currentTime > 0 });
  vidSrc.delete(f.id); fileUrls.delete(f.id); urlFor(f.id); render();
}
function videoReady(f: FileRef, el: HTMLVideoElement) {
  const r = vidResume.get(f.id); if (!r) return;
  vidResume.delete(f.id);
  if (r.t > 0) el.currentTime = r.t;
  if (r.play) void el.play().catch(() => {});
}
function videoEl(f: FileRef) {
  const u = vidSrc.get(f.id) ?? urlFor(f.id);
  if (!u) return h('div', { class: 'img-ph vid-ph' }, f.name);
  vidSrc.set(f.id, u);
  return h('div', { class: 'media vid', 'data-fid': f.id },
    h('video', { src: u, controls: true, preload: 'metadata', playsinline: true, title: f.name, 'aria-label': f.name,
      onloadedmetadata: (e: Event) => { stickToBottom(e); videoReady(f, e.currentTarget as HTMLVideoElement); },
      onerror: (e: Event) => videoError(f, e.currentTarget as HTMLVideoElement) }),
    dlButton(f));
}
function audioEl(f: FileRef) {
  const u = urlFor(f.id), a = audOf(f.id), on = playing(f.id), wait = pl.want === f.id;
  if (u && !analysed.has(f.id)) void analyse(f.id, u, f.size);
  const n = playedBars(a.t, a.dur), ready = a.dur > 0;
  const at = (e: MouseEvent) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); return (e.clientX - r.left) / r.width * 1000; };
  const step = (e: KeyboardEvent) => {
    const d = e.key === 'ArrowRight' ? 5 : e.key === 'ArrowLeft' ? -5 : 0; if (!d || !ready) return;
    e.preventDefault(); seek(f.id, (audOf(f.id).t + d) / a.dur * 1000);
  };
  return h('div', { class: `aplayer${on ? ' on' : ''}`, 'data-fid': f.id, 'data-size': f.size, title: f.name },
    h('button', { class: 'ap-play', type: 'button', 'aria-label': `${t(on ? 'pause' : 'play')}: ${f.name}`, disabled: wait, onclick: () => togglePlay(f.id) },
      icon(on ? 'pause' : 'play', 14) as unknown as Node),
    h('div', { class: `ap-wave${a.peaks ? '' : ' flat'}`, role: 'slider', tabindex: ready ? 0 : -1, 'aria-label': t('seek'), 'aria-valuemin': 0,
      'aria-valuemax': ready ? Math.round(a.dur) : 0, 'aria-valuenow': Math.round(a.t), 'aria-disabled': ready ? false : 'true',
      onclick: (e: MouseEvent) => seek(f.id, at(e)), onkeydown: step },
      ...(a.peaks ?? FLAT_PEAKS).map((l, i) => h('i', { class: `l${l}${i < n ? ' p' : ''}` }))),
    h('span', { class: 'ap-time' }, timeText(f.id, f.size)),
    h('button', { class: 'ap-dl', type: 'button', 'aria-label': `${t('download')}: ${f.name}`, title: t('download'), disabled: !u, onclick: () => downloadFile(f) },
      icon('download', 14) as unknown as Node));
}
// ---------------------------------------------------------------- audio: recorder (client/src/recorder.ts)
// ---------------------------------------------------------------- Lounge: topics
// From the Lounge of its space on a wide screen, the thread opens in the side pane and the feed stays (split.ts).
const goThread = (id: string, list = false) => { const f = S.threads.get(id); if (f) S.view = threadView(S.view, f.space, { narrow: narrow(), list }); open(id); };
/** Notification click (Web Push, tab alert): opens the thread as before and, given the message it is about, jumps to
 *  it like a search result (older pages walked back, scrolled to, flashed). */
function goMessage(thread: string, msg: string | null) {
  goThread(thread, true);
  if (!msg || S.sel !== thread) return;
  S.jump = { thread, msg };
  if (S.loaded.has(thread)) walkBack(thread, [...(S.msgs.get(thread)?.keys() ?? [])].sort()[0]); // else: the history answer walks back
  render();
}
/** A row of Recents (pane or ⌘K): a topic in its Lounge, a thread like a thread line of the feed. */
function goRecent(f: PublicThread) { S.drawer = false; if (f.kind === 'topic') { S.view = { kind: 'lounge', id: f.space }; open(f.id); } else goThread(f.id); }
// No direct thread creation: it is discussed in the Lounge first, the thread is born from a "Make it a thread?" card.
// « + Topic » (a topic without a Bar message): in the Recents pane, since « Topics only », its former place, is gone.
// « [thread icon] Threads [1 in progress] [3 waiting] »: the topic's threads by state, in the colours of the state chips.
function spawnedRow(f: PublicThread, key = 'sp') {
  if (!f.spawned?.length) return null;
  const c = spawnedCounts(familyIds(f, id => S.threads.get(id)), id => S.threads.get(id), shown);
  return h('div', { class: 'where spawned-row' }, h('span', { class: 'sp-lbl' }, icon('thread', 13) as unknown as Node, tn('spawned', c.reduce((s, x) => s + x.n, 0) || f.spawned.length)),
    ...c.map(x => h('span', { class: `chip c-${x.bucket}`, 'data-k': `${key}:${f.id}:${x.bucket}` }, tn(`sp_${x.bucket}`, x.n))));
}
// A thread opened from a thread sits under its parent, one step in per level (`--fd`, see .fc-threads a.sub).
const familyIndent = (depth: number) => depth > 1 ? { class: 'sub', style: `--fd:${depth - 1}` } : {};
// Topic header: the same « Threads [chips] » row, folded; unfolded = one line per thread (ellipsed title + its state
// chip), scrolling past 40vh. Native <details>: patch.ts keeps it unfolded across renders, a new pane starts folded.
function spawnedFold(f: PublicThread) {
  const row = spawnedRow(f, 'sph'); // own chip keys: the Lounge list card next to it carries `sp:` ones
  if (!row) return null;
  const kids = topicFamily(f, id => S.threads.get(id));
  return h('details', { class: 'spawned', 'data-k': `spawned:${f.id}` }, h('summary', {}, icon('chevronRight', 12) as unknown as Node, row),
    h('div', { class: 'spawned-list' }, ...kids.map(({ f: x, depth }) => h('a', { href: '#', 'data-k': `spl:${x.id}`, title: x.title, ...familyIndent(depth), onclick: (e: Event) => { e.preventDefault(); goThread(x.id); } },
      h('span', { class: 'sp-title' }, x.title), chip(x)))));
}
// « general » module off: the space's entry is its topics (the Recents tree, like Now) instead of the General feed.
const loungeList = (space: string) => modOn(space, 'general') ? feedList(space)
  : h('section', { class: 'list rc-only' }, h('header', {}, menuBtn(), h('div', {}, h('h2', {}, withIcon('messagesSquare', t('topics_title', { space: spaceName(space) }), 18))), presenceStack(space)),
    ...rc().inline(space));
// ---------------------------------------------------------------- Lounge as one feed (« D3 »; rules: feed.ts)
// The Bar's messages and the topics in one timeline in the list pane, composer at the bottom; a topic is a card at its
// creation time (title, last activity, one line per thread with its state), the conversation opens on the right as
// before. Finding a topic again by activity: the Recents pane (client/src/recentsview.ts), not a filter of this feed.
const feedAsked = new Set<string>();           // General history asked by the feed (once per connection)
let feedLoad = { space: '', msgs: false, topics: false }; // what the feed's top sentinel pages (last render)
/** Dot on a message's avatar: the author's state now (not when they wrote it); none for a system line or someone gone. */
const authorDot = (a: Message['author'], space: string) => a.kind !== 'system' && S.people.get(space)?.some(p => p.id === a.id && !p.gone)
  ? presDot(dotOf({ id: a.id, kind: a.kind === 'agent' ? 'agent' : 'human' }, S.presence.get(space))) : null;
/** Presence dot: green active, orange away, red agent offline (protocol/presence.ts `dotOf`). */
const presDot = (d: Dot | null) => d ? h('span', { class: `pdot ${d}`, 'aria-hidden': 'true' }) : null;
/** Avatar in the presence lists: a human round, an agent square (both with their initial, the colours of their
 *  messages); `tip` = the name and state in a real tooltip on hover (desktop; touch opens the list instead). */
function presAv(p: Person, dot: Dot | 'none', label: string, tip: boolean) {
  return h('span', { class: `pav avatar ${p.kind === 'agent' ? 'pav-agent' : ''} ${avatarClass({ kind: p.kind, id: p.id })} ${tip ? 'tip' : ''}`,
    ...(tip ? { 'data-tip': label } : {}), 'aria-label': label, 'data-pres': `${p.id}:${dot}` }, face(p.avatar ?? '', p.name), dot === 'none' ? null : presDot(dot));
}
/** Lounge header: the stack of who is here (green, orange), then a button with the number of people not connected (red
 *  dot while an agent is down, so that news stays visible folded). A click on either opens the whole list (here, then
 *  not connected): a popover on desktop, a bottom sheet on a narrow screen. */
function presenceStack(space: string) {
  const { here, absent } = roster(S.people.get(space) ?? [], S.presence.get(space));
  if (!here.length && !absent.length) return null;
  const MAX = narrow() ? 3 : 5, shown = here.slice(0, MAX), extra = here.length - shown.length, open = S.presOpen === space;
  const now = Date.now(), seen = S.lastSeen.get(space) ?? {}, since = new Map((S.presence.get(space) ?? []).map(x => [x.id, x.since]));
  const dur = (d: { unit: 'min' | 'h' | 'd'; n: number }) => t(`ago_${d.unit}` as Key, { n: d.n });
  const state = (p: Person & { dot: Dot | 'none' }) => { const l = presLine(p, p.dot === 'away' ? since.get(p.id) : seen[p.id], now); return t(`pres_${l.k}` as Key, 'd' in l ? { d: dur(l.d) } : {}); };
  const label = (p: Person & { dot: Dot | 'none' }) => `${p.name}${p.kind === 'agent' ? ` (${t('agent_badge')})` : ''} · ${state(p)}`;
  const toggle = () => { S.presOpen = open ? '' : space; render(); };
  const row = (p: Person & { dot: Dot | 'none' }) => h('div', { class: 'pres-row', 'data-k': `pres-row-${p.id}` }, presAv(p, p.dot, label(p), false),
    h('span', { class: 'pres-name' }, p.name, p.kind === 'agent' ? h('span', { class: 'm-badge' }, t('agent_badge')) : null), h('span', { class: 'pres-st' }, state(p)));
  const rows = [here.length ? h('div', { class: 'group label' }, t('pres_here_n', { n: here.length })) : null, ...here.map(row),
    absent.length ? h('div', { class: 'group label' }, t('pres_absent', { n: absent.length })) : null, ...absent.map(row)];
  const close = () => { S.presOpen = ''; render(); };
  const list = !open ? null : narrow()
    ? h('div', { class: 'sheet-wrap', 'data-k': 'pres-sheet' }, h('div', { class: 'scrim', onclick: close }),
      h('div', { class: 'sheet pres-sheet', role: 'dialog', 'aria-label': t('pres_label') }, h('div', { class: 'sheet-t' }, t('pres_label')), ...rows,
        h('button', { class: 'sheet-row cancel', type: 'button', onclick: close }, t('pane_close'))))
    : h('div', { class: 'pres-pop', 'data-k': 'pres-pop', role: 'dialog', 'aria-label': t('pres_label') }, ...rows);
  return h('div', { class: 'pres', 'data-k': 'pres', role: 'group', 'aria-label': t('pres_label') },
    h('button', { class: 'pres-stack', type: 'button', 'data-k': 'pres-stack', 'aria-expanded': String(open), 'aria-label': t('pres_label'), onclick: toggle },
      ...shown.map(p => presAv(p, p.dot, label(p), true)), extra ? h('span', { class: 'pav pav-extra' }, `+${extra}`) : null),
    absent.length ? h('button', { class: `pres-more ${open ? 'on' : ''}`, type: 'button', 'data-k': 'pres-more', 'aria-expanded': String(open), 'aria-label': t('pres_absent', { n: absent.length }), onclick: toggle },
      String(absent.length), icon('chevronDown', 13) as unknown as Node, absent.some(p => p.dot === 'off') ? presDot('off') : null) : null,
    list);
}
/** General thread whose feed is on screen (the list pane, alone on a phone only without a conversation open). */
function shownGeneral() { return S.view.kind === 'lounge' && (!S.sel || !narrow()) ? generalOf(S.threads, S.view.id) : null; }
function openGeneral(space: string) { S.view = { kind: 'lounge', id: space }; open(null); }
function feedList(space: string) {
  const gid = generalId(space), real = generalOf(S.threads, space), f = real ?? generalStub(space);
  if (real && !S.loaded.has(gid) && !feedAsked.has(gid) && ws?.readyState === WebSocket.OPEN) { feedAsked.add(gid); send({ type: 'history', thread: gid }); }
  const topics = loungeTopics(S.threads.values(), space), loaded = !real || S.loaded.has(gid);
  const oldest = hasOlder(S.older, gid) ? S.older.get(gid)?.oldest : null;
  const feed = buildFeed(real && S.loaded.has(gid) ? S.msgs.get(gid)?.values() ?? [] : [], topics,
    { msgs: oldest ? S.msgs.get(gid)?.get(oldest)?.at ?? null : null, topics: hasMore(S.paging, space) ? cursorAt(S.paging, space) : null });
  feedLoad = { space, ...feed.load };
  const cont = feedGrouped(feed.items), shownMsgs = feed.items.flatMap(x => x.kind === 'msg' ? [x.m] : []), plug = pluginRuns(feed.items);
  // The marker sits before the first item at or after the first unread Bar message (it may be a topic card now).
  const u = real && S.loaded.has(gid) ? unreadOf(gid, convOrder(S.msgs.get(gid)?.values() ?? [])) : null;
  const sepAt = u && !u.more ? u.firstAt : null, sepI = sepAt === null ? -1 : feed.items.findIndex(x => x.at >= sepAt);
  const body = !loaded ? [h('div', { class: 'blank', 'data-k': 'blank' }, t('ex_loading'))]
    : !feed.items.length && feed.floor === null ? [h('div', { class: 'blank', 'data-k': 'blank' }, t('general_empty'))]
      : [feed.floor !== null ? h('div', { class: 'feed-older', 'data-k': 'feed-older', 'data-space': space }, t('ex_loading')) : null,
        ...feed.items.flatMap((x, i) => [i === sepI ? unreadSep() : null, x.kind === 'msg' ? (plug.hidden.has(x.m.id) ? null : plug.runs.has(x.m.id) ? keyed(pluginNoticeEl(plug.runs.get(x.m.id)!), `m:${x.m.id}`) : editMark(keyed(messageEl(x.m, shownMsgs, f, cont.has(x)), `m:${x.m.id}`), x.m.id)) : cd().topicCard(x.f, x.at, cont.has(x))])];
  const fabTopics: FabTopic[] = feed.items.flatMap(x => x.kind === 'topic' ? [{ id: x.f.id, at: x.at, unread: topicCardWhen(x.f, unread).unread }] : []);
  fabLast = loaded && feed.items.length ? { gid, u, topics: fabTopics } : null;
  if (fabLast) body.push(fabEl(gid, unreadFab(u, pillOff.has(gid), fabTopics, fabDone)));
  const head = h('header', {}, menuBtn(), h('div', {}, h('h2', {}, withIcon('messagesSquare', t('lounge_title', { space: spaceName(space) }), 18))), presenceStack(space), rc().button(space));
  const ta = h('textarea', { placeholder: t(touchOnly() ? 'general_ph_touch' : 'general_ph'), ...NO_AUTOFILL }) as HTMLTextAreaElement;
  const sug = h('div', { class: 'suggest', hidden: true });
  attachMentions(ta, space, sug);
  const att = attachments(f.id, space, ta);
  const go = () => { const text = msgText(cur(ta), att, go); if (text && send({ type: 'post', client_id: rand().slice(0, 20), space, text, general: true, ...att.payload() })) { noteMentions(space, text); cur(ta).value = ''; drafts.delete(f.id); att.clear(); feedStick = true; render(); } };
  const composer = editableComposer(f, ta, sug, att, go, h('span', { class: 'grow' }, t('reply_in'), h('span', { class: 'route' }, t('general'))));
  return h('section', { class: 'list feed' }, head, pinBar(topics), h('div', { class: 'scroll feed-msgs', ...unreadAttrs(gid, u) }, ...body), composer);
}
/** Pinned topics (both modes): one folded line under the header (a feed reads bottom-up: a block on top would never
 *  show); unfolded, one line per topic with its state. They stay at their date in the feed too. */
function pinBar(topics: PublicThread[]) {
  const pins = topics.filter(pinned);
  if (!pins.length) return null;
  // In a band of its own with the header's background: the cups watermark stays behind the messages only.
  return h('div', { class: 'pinzone', 'data-k': 'pinzone' }, h('details', { class: 'pinbar', 'data-k': 'pinbar' }, h('summary', {}, icon('chevronRight', 12) as unknown as Node, icon('pin', 13) as unknown as Node, t('pinned'), h('span', { class: 'count' }, String(pins.length))),
    h('div', { class: 'pin-list' }, ...pins.map(p => h('a', { href: '#', class: unread(p) ? 'unread' : '', 'data-k': `pl:${p.id}`, onclick: (e: Event) => { e.preventDefault(); open(p.id); } },
      icon('coffee', 12) as unknown as Node, h('span', { class: 'sp-title' }, topicName(p)), p.state === 'run' ? chip(p) : null,
      ...spawnedCounts(familyIds(p, id => S.threads.get(id)), id => S.threads.get(id), shown).map(x => h('span', { class: `chip c-${x.bucket}` }, tn(`sp_${x.bucket}`, x.n))))))));
}
/** Feed scroll: at the bottom on open and after one's own post; otherwise the item under the reader's eyes stays put
 *  (a page loaded above, a message arriving below). */
let feedStick = false;
let feedJump = '';  // topic whose card the feed scrolls to and flashes on its next render (crumb link « {space} Bar »)
function feedAnchor(sc: HTMLElement | null): { bottom: true } | { k: string; top: number } | null {
  if (!sc) return null;
  if (!sc.clientHeight || atBottom(sc.scrollTop, sc.scrollHeight, sc.clientHeight)) return { bottom: true };
  const top = sc.getBoundingClientRect().top;
  // Never the top sentinel: read at the very top, it stayed first once the page landed, so nothing moved back and the
  // next page was asked at once, page after page (iPhone loop, any browser at scrollTop 0).
  for (const c of sc.children) { const r = c.getBoundingClientRect(), k = c.getAttribute('data-k'); if (k && !c.classList.contains('pill-wrap') && !c.classList.contains('feed-older') && r.bottom > top + 1) return { k, top: r.top }; }
  return { bottom: true };
}
function feedRestore(sc: HTMLElement | null, a: ReturnType<typeof feedAnchor>) {
  if (!sc) return;
  if (!a || 'bottom' in a || feedStick) { sc.scrollTop = sc.scrollHeight; feedStick = false; return; }
  const el = sc.querySelector(`:scope > [data-k="${CSS.escape(a.k)}"]`);
  if (el) pinScroll(sc, sc.scrollTop + el.getBoundingClientRect().top - a.top);
}
const feedW = newTopWatch();
function watchFeed() {
  const m = document.querySelector('.list.feed .feed-older') as HTMLElement | null;
  watchTop(feedW, m, m?.closest('.scroll') ?? null, () => {
    if (feedLoad.space !== m!.dataset.space) return;
    if (feedLoad.topics) loadMore(feedLoad.space);
    if (feedLoad.msgs) loadOlder(generalId(feedLoad.space));
  });
}
// Card of the thread lists (space, Now, Later).
function threadCard(f: PublicThread) {
  const done = doneTag(f);
  return h('div', { class: `thread ${S.sel === f.id ? 'sel' : ''} ${unread(f) ? 'unread' : ''}`, ...cardKey(f, f.updatedAt), ...pressAttrs({ kind: 'card', id: f.id }), tabindex: 0, onclick: () => open(f.id), onkeydown: (e: KeyboardEvent) => e.key === 'Enter' && open(f.id) },
    h('div', { class: 'top' }, h('span', { class: 't' }, ...richText(f.title, f.space)), h('span', { class: 'when' }, ago(f.updatedAt))),
    whereEl(f), chip(f), bgBadge(f), ciBadge(f), placeChip(f), columnChip(f), done, placeBadge(f), waitLine(f), cardMenu(f));
}
/** « space · agent » under a card: always in Now (several spaces); inside a space only the agent, and only when the
 *  space has several agents or the thread's agent left it (the line repeated what the view already says). */
function whereEl(f: PublicThread) {
  const agents = (S.people.get(f.space) ?? []).filter(p => p.kind === 'agent' && !p.gone).map(p => p.id);
  const w = whereText(S.view.kind === 'now' ? spaceName(f.space) : null, f.owner, agents);
  return w === null ? null : h('div', { class: 'where' }, w);
}
// Card of Closed: finished and archived mixed, told apart by one badge (✓ done / Archived), no state chip.
function closedCard(f: PublicThread) {
  const at = closedAt(f);
  return h('div', { class: `thread ${S.sel === f.id ? 'sel' : ''} ${unread(f) ? 'unread' : ''}`, ...cardKey(f, at), ...pressAttrs({ kind: 'card', id: f.id }), tabindex: 0, onclick: () => open(f.id), onkeydown: (e: KeyboardEvent) => e.key === 'Enter' && open(f.id) },
    h('div', { class: 'top' }, h('span', { class: 't' }, ...richText(f.title, f.space)), h('span', { class: 'when' }, ago(at))),
    h('div', { class: 'where' }, f.kind === 'topic' ? withIcon('coffee', t('lounge_topic'), 12) : t('thread_by', { owner: f.owner }),
      f.archived ? t('archived_by', { name: byName(f.archived.by) }) : ''),
    f.archived ? h('span', { class: 'chip c-calm' }, t('archived_b'))
      : h('span', { class: 'chip c-done', title: f.state === 'done' ? label('done') : t('done_title', { agent: cap(f.owner) }) }, t('done_tag')),
    cardMenu(f));
}
/** Filter heading the space list, Later and Closed (one « Work » sidebar entry instead of three): full
 *  width under the header, each segment goes to its existing route. Counters on In progress and Later only (shelfCounts). */
function shelfSeg(space: string, cur: 'space' | 'later' | 'closed') {
  const n = shelfCounts(S.threads.values(), space);
  // Icons of the former sidebar entries: phone only (style.css), too busy on desktop.
  const b = (k: 'space' | 'later' | 'closed', ic: string, text: string, count: number | null) => h('button', { class: k === cur ? 'on' : '',
    'aria-pressed': String(k === cur), 'data-k': `seg:${k}`, onclick: () => goEntry({ kind: k, id: space }) },
    icon(ic, 13) as unknown as Node, text, count == null ? null : h('span', { class: 'sg-n' }, String(count)));
  return h('div', { class: 'seg shelf-seg', role: 'group', 'aria-label': t('nav_work'), 'data-k': 'shelf-seg' },
    b('space', 'thread', t('seg_work'), n.work), b('later', 'later', t('nav_later'), n.later), b('closed', 'archive', t('nav_closed'), null));
}
/** Back to the space's Bar (Blair, in place of the removed « Topic » button), on the space list, Later and Closed alike
 *  so the header does not jump when the filter switches view. */
const barBtn = (space: string) => h('button', { class: 'btn bar-btn', title: t('to_general_title', { space: spaceName(space) }), onclick: () => openGeneral(space) },
  withIcon('messagesSquare', t('general'), 16));
function shelfList(space: string, cur: 'later' | 'closed', kids: HTMLElement[], empty: string) {
  return h('section', { class: 'list' },
    h('header', {}, menuBtn(), h('div', {}, h('h2', {}, spaceName(space))), barBtn(space)),
    shelfSeg(space, cur),
    h('div', { class: 'scroll' }, ...(kids.length ? kids : hasMore(S.paging, space) ? [] : [h('div', { class: 'empty', 'data-k': 'empty' }, empty)]), moreEl(space)));
}
// "Later" of a space: threads set aside (state idea), last activity first. Reopen is in the thread header.
function laterList(space: string) {
  return shelfList(space, 'later', laterOf(S.threads.values(), space).map(threadCard), t('nothing_later'));
}
// "Closed" of a space: finished threads (closed, or the agent said done) and archived threads and topics, one list.
function closedList(space: string) {
  return shelfList(space, 'closed', closedOf(S.threads.values(), space).map(closedCard), t('nothing_closed'));
}
// thread.seen sent (thread opened) but not back yet: the version will move, a click now would be `stale`.
const seenPending = (f: PublicThread) => !!f.unseen && seenSent.get(f.id) === f.unseen;
const byName = (id: string) => id === S.me ? t('you_lc') : personName(id) ?? t('a_member');
const archivedTip = (f: PublicThread) => f.archived ? t('archived_tip', { name: byName(f.archived.by) }) : null;
// Pin (for oneself) and Archive (for the whole space, trusted humans: the hub checks) in the header.
/** Leads name a topic for everyone (plain text, cleaned by the hub); empty = back to the first message. */
function renameBtn(f: PublicThread) {
  if (!S.trusted.has(f.space)) return null;
  return iconBtn('pencil', t('rename_topic'), () => {
    const v = prompt(t('rename_topic_ask'), f.heading?.text ?? '');
    if (v !== null && v.trim() !== (f.heading?.text ?? '')) send({ type: 'action', thread: f.id, kind: 'rename', title: v });
  }, { 'data-k': 'rename' });
}
function pinBtn(f: PublicThread) {
  return pinToggle(f, t('pin_header'), () => togglePin(f));
}
/** « Copy link »: absolute URL of the thread (`#/<space>/<thread>`, opens it wherever it lives) or of a message in it. */
function copyUrl(thread: string, msg?: string): string {
  const f = S.threads.get(thread), route = routeOf({ kind: 'space', id: f?.space ?? (S.view.kind === 'now' || S.view.kind === 'newspace' ? '' : S.view.id) }, thread);
  return linkUrl(location, msg ? msgRoute(route, msg) : route);
}
/** Key of the link button just copied: shows a check for 1.5 s. */
let copied = '', copiedTimer: number | undefined;
function linkBtn(key: string, url: string, label: Key) {
  if (!navigator.clipboard) return null;
  const done = copied === key;
  return iconBtn(done ? 'check' : 'link', done ? t('link_copied') : t(label), (e: Event) => {
    e.stopPropagation();
    navigator.clipboard.writeText(url).then(() => {
      copied = key; window.clearTimeout(copiedTimer);
      copiedTimer = window.setTimeout(() => { copied = ''; render(); }, 1500); render();
    }, () => {});
  }, { class: `btn ic link-copy ${done ? 'done' : ''}` });
}
function archiveBtn(f: PublicThread) {
  if (f.archived) return null; // Unarchive is in the banner
  const busy = f.state === 'run' || seenPending(f);
  return iconBtn('archive', f.state === 'run' ? t('archive_busy', { agent: cap(f.owner) }) : t('archive_header'),
    () => send({ type: 'action', thread: f.id, kind: 'archive', version: f.version }), { disabled: busy });
}
// No confirmation dialog: it is reversible, the banner says what happened and offers the way back.
function archivedBanner(f: PublicThread) {
  if (!f.archived) return null;
  return h('div', { class: 'archived', role: 'status' },
    h('div', { class: 'aw-t' }, h('b', {}, t('archived_b')), t('archived_banner', { name: byName(f.archived.by), when: since(f.archived.at) }),
      f.issue ? t('archived_issue', { ref: `${f.issue.repo.split('/')[1]}#${f.issue.number}` }) : ''),
    h('button', { class: 'btn', disabled: seenPending(f), onclick: () => send({ type: 'action', thread: f.id, kind: 'unarchive', version: f.version }) }, t('unarchive')));
}
function newTopic(sp: string) {
  const ta = h('textarea', { placeholder: t('new_topic_ph'), ...NO_AUTOFILL }) as HTMLTextAreaElement;
  bindDraft(ta, 'topic');   // no title field: the hub takes the start of the message
  const sug = h('div', { class: 'suggest', hidden: true });
  attachMentions(ta, sp, sug);
  const att = attachments('topic', sp, ta);
  const go = () => { const text = msgText(cur(ta), att, go); if (!text) return; const cid = rand().slice(0, 20);
    if (send({ type: 'post', client_id: cid, space: sp, kind: 'topic', text, ...att.payload() })) { noteMentions(sp, text); S.newTopicCid = cid; drafts.delete('topic'); att.clear(); } };
  onEnterSend(ta, go);
  // Autofocus, except under an open dialog (search palette, profile): every render (each keystroke, each
  // `search` answer) would otherwise pull the focus back here. Re-checked in the timeout: a dialog may open meanwhile.
  const dialog = () => P.open || lg().profileOn() || !!vw.viewer;
  if (!dialog() && !document.activeElement?.closest?.('.composer')) setTimeout(() => { if (!dialog()) cur(ta).focus(); });
  // Empty conversation: greeting + composer centred together (`.conv.empty`); the first message opens the
  // regular view with the composer at the bottom, no animation (the field must not move under the cursor).
  return h('section', { class: 'conv empty topic' }, backBtn(), paneClose(), cup() as unknown as Node, h('div', { class: 'hello' }, t('empty_hello')), S.err && h('div', { class: 'err' }, S.err),
    h('div', { class: 'composer', ...att.drop }, sug, att.chips, ta, h('div', { class: 'bar' }, att.clip, h('span', { class: 'grow' }, t('new_topic_in'), h('span', { class: 'route' }, withIcon('coffee', spaceName(sp), 12))), sendBtn('topic', go, t(touchOnly() ? 'launch_touch' : 'launch')))));
}
function topicView(f: PublicThread) {
  const all = convOrder(S.msgs.get(f.id)?.values() ?? []);
  const agent = f.owner[0].toUpperCase() + f.owner.slice(1);
  const ta = h('textarea', { placeholder: t('topic_reply_ph', { agent }), ...NO_AUTOFILL }) as HTMLTextAreaElement;
  const sug = h('div', { class: 'suggest', hidden: true });
  attachMentions(ta, f.space, sug);
  const att = attachments(f.id, f.space, ta);
  const go = () => { const text = msgText(cur(ta), att, go); if (text) notePosted(f); if (text && send({ type: 'post', client_id: rand().slice(0, 20), space: f.space, thread: f.id, text, ...att.payload() })) { noteMentions(f.space, text); cur(ta).value = ''; drafts.delete(f.id); att.clear(); toBottom(); } };
  const composer = editableComposer(f, ta, sug, att, go, h('span', { class: 'grow' }, t('reply_in'), h('span', { class: 'route' }, topicName(f))));
  const first = all.find(m => m.author.kind === 'human');
  const msgs = msgsEl(f, all);
  return h('section', { class: 'conv topic' },
    h('div', { class: 'state' }, h('div', { class: 'crumb' }, backBtn(), topicCrumb(f, first), fromEl(f), f.state === 'run' ? chip(f) : null, costEl(f, 'crumb'), paneClose()),
      h('div', { class: 'row' }, h('h1', {}, ...(f.heading ? [f.heading.text] : richText(f.title, f.space))), h('div', { class: 'acts' }, renameBtn(f), pinBtn(f), archiveBtn(f), linkBtn(`t:${f.id}`, copyUrl(f.id), 'link_thread'))),
      spawnedFold(f)),
    convHeads(archivedBanner(f)), msgs, composer); // the archived banner comes and goes: same box as a thread's (conv)
}
/** General: a topic view without pin, archive, rename nor spawned threads; the composer posts with `general: true`. */
function generalView(space: string) {
  const real = generalOf(S.threads, space), f = real ?? generalStub(space);
  const all = convOrder(S.msgs.get(f.id)?.values() ?? []);
  const ta = h('textarea', { placeholder: t(touchOnly() ? 'general_ph_touch' : 'general_ph'), ...NO_AUTOFILL }) as HTMLTextAreaElement;
  const sug = h('div', { class: 'suggest', hidden: true });
  attachMentions(ta, space, sug);
  const att = attachments(f.id, space, ta);
  const go = () => { const text = msgText(cur(ta), att, go); if (text && send({ type: 'post', client_id: rand().slice(0, 20), space, text, general: true, ...att.payload() })) { noteMentions(space, text); cur(ta).value = ''; drafts.delete(f.id); att.clear(); toBottom(); } };
  const composer = editableComposer(f, ta, sug, att, go, h('span', { class: 'grow' }, t('reply_in'), h('span', { class: 'route' }, t('general'))));
  // Not created yet: nothing to load, an empty room with its composer (the first post creates it).
  const msgs = real ? msgsEl(f, all) : h('div', { class: 'msgs' }, h('div', { class: 'blank', 'data-k': 'blank' }, t('general_empty')));
  return h('section', { class: 'conv topic general' },
    h('div', { class: 'state' }, h('div', { class: 'crumb' }, backBtn(), withIcon('messagesSquare', t('lounge_title', { space: spaceName(space) }), 13), paneClose()),
      h('div', { class: 'row' }, h('h1', {}, withIcon('messagesSquare', t('general'), 20)), h('div', { class: 'acts' }, real ? linkBtn(`t:${f.id}`, copyUrl(f.id), 'link_thread') : null))),
    msgs, composer);
}
/** « Reply as topic » on a General message: opens its topic when already known, else asks the hub (ack opens it).
 *  `wake` (« Send to <agent> »): always asks the hub, which also wakes the agent in charge there, topic open or not. */
function replyAsTopic(m: Message, wake = false) {
  const space = S.threads.get(m.thread)?.space;
  if (!wake && m.subtopic && space && S.threads.has(m.subtopic)) { S.view = { kind: 'lounge', id: space }; open(m.subtopic); return; }
  const cid = rand().slice(0, 20);
  if (send({ type: 'action', client_id: cid, thread: m.thread, kind: 'subtopic', msg: m.id, ...(wake ? { wake: true } : {}) })) {
    S.subtopicCid = cid; S.subtopicAt = { space: S.view.kind === 'lounge' ? S.view.id : null, sel: S.sel };
  }
}
/** Agent « Send to <agent> » would wake from this Bar message (a human's text, when I may wake agents there), else null. */
function sendAgentOf(m: Message): string | null {
  const space = isGeneralId(m.thread) ? S.threads.get(m.thread)?.space : undefined;
  return space && m.author.kind === 'human' && m.type === 'text' ? S.wakeAgent.get(space) ?? null : null;
}
/** Under a General message: link to the topic opened from it (its name once loaded), with the signals of its Lounge
 *  row: bold when unread, the same working chip, « → N threads », last activity. Rules: subtopicLink (lounge.ts). */
function subtopicEl(m: Message, th: PublicThread) {
  const l = isGeneral(th) ? subtopicLink(m, id => S.threads.get(id), unread) : null;
  if (!l) return null;
  const f = S.threads.get(l.id);
  return h('a', { class: `subtopic${l.unread ? ' unread' : ''}`, href: '#', onclick: (e: Event) => { e.preventDefault(); S.view = { kind: 'lounge', id: th.space }; open(l.id); } },
    h('span', { class: 'st-name' }, withIcon('coffee', l.name === null ? t('to_topic') : t('to_topic_named', { title: l.name }), 12)),
    l.working && f ? chip(f) : null,
    l.threads ? h('span', { class: 'st-threads' }, tn('to_threads', l.threads)) : null,
    l.at ? h('span', { class: 'when', title: fullDate(l.at) }, ago(l.at)) : null);
}
// "Make it a thread?" card: the context of the thread will be the whole topic (not a guessed selection).
/** Header link to where the thread was opened from: its Lounge topic, or its parent thread (card posted in a thread). */
/** « {space} Bar · started by X »: only the space name shrinks (« … ») on a narrow screen, so the cost stays on the line.
 *  A topic born from a Bar message makes « {space} Bar » the link back to that message in the feed. */
function topicCrumb(f: PublicThread, first: Message | undefined) {
  const name = h('span', { class: 'cr-name' }, t('lounge_title', { space: spaceName(f.space) }));
  const by = first ? h('span', { class: 'cr-by' }, t('started_by', { name: first.author.kind === 'human' && first.author.id === S.me ? t('you_lc') : who(first) })) : null;
  const ic = icon('messagesSquare', 13) as unknown as Node;
  if (topicOrigin(f, id => S.threads.get(id))?.at !== 'crumb') return h('span', { class: 'with-ic cr' }, ic, name, by);
  return h('span', { class: 'with-ic cr' }, h('a', { class: 'with-ic cr-origin', href: '#', title: t('to_origin'), 'aria-label': t('to_origin'),
    onclick: (e: Event) => { e.preventDefault(); feedJump = f.id; openGeneral(f.space); } }, ic, name), by);
}
function fromEl(f: PublicThread) {
  // Born from a Bar message: the crumb is the link (`topicCrumb`).
  const o = topicOrigin(f, id => S.threads.get(id));
  if (o?.at !== 'from') return null;
  const p = o.parent;
  if (p.kind !== 'topic') return h('a', { class: 'from', href: '#', onclick: (e: Event) => { e.preventDefault(); goThread(p.id); } }, withIcon('thread', t('from_thread', { title: p.title }), 12));
  return h('a', { class: 'from', href: '#', onclick: (e: Event) => { e.preventDefault(); S.view = { kind: 'lounge', id: f.space }; open(p.id); } }, withIcon('coffee', t('from_topic', { title: topicName(p) }), 12));
}
/** Header of a plan step's thread: « Plan · step i/N » and one pill per step, a link when that step's thread is open. */
function planNavEl(f: PublicThread) {
  if (!f.plan) return null;
  const { step, of } = f.plan;
  const ids = planStepThreads(f.plan, S.threads.values());
  const pill = (k: number) => {
    const id = ids[k], x = id ? S.threads.get(id) : null;
    if (k === step) return h('span', { class: 'pn cur', 'aria-current': 'step', title: t('plan_nav_go', { i: k + 1, title: f.title }) }, String(k + 1));
    if (!x) return h('span', { class: 'pn off', title: t('plan_nav_unopened', { i: k + 1 }) }, String(k + 1));
    return h('a', { class: 'pn', href: '#', title: t('plan_nav_go', { i: k + 1, title: x.title }), 'aria-label': t('plan_nav_go', { i: k + 1, title: x.title }),
      onclick: (e: Event) => { e.preventDefault(); goThread(x.id); } }, String(k + 1));
  };
  return h('span', { class: 'plan-nav' }, withIcon('list', t('plan_nav', { i: step + 1, n: of }), 12), ...Array.from({ length: of }, (_, k) => pill(k)));
}
/** First message of a topic born from another space's card: where it came from (a link only if that space is ours). */
function originEl(m: Message) {
  const o = m.origin;
  if (!o) return null;
  const src = S.threads.get(o.thread);
  if (!src || src.space !== o.space) return h('div', { class: 'from' }, withIcon('coffee', t('origin_elsewhere'), 12));
  return h('a', { class: 'from', href: '#', onclick: (e: Event) => { e.preventDefault(); if (src.kind === 'topic') { S.view = { kind: 'lounge', id: src.space }; open(src.id); } else goThread(src.id); } },
    withIcon(src.kind === 'topic' ? 'coffee' : 'thread', t('origin_from', { title: src.kind === 'topic' ? topicName(src) : src.title, space: spaceName(src.space) }), 12));
}

function kindIc(name: string) { return h('span', { class: 'k-ic', 'aria-hidden': 'true' }, icon(name, 15) as unknown as Node); }
function cardBand(ic: string, label: string, sub: string) {
  return h('div', { class: 'k-band' }, kindIc(ic), h('div', { class: 'k-lab' }, h('div', { class: 'k-t' }, label), h('div', { class: 'k-s' }, sub)));
}
/** Primary button label followed by an arrow. */
function go(label: string): Child[] { return [h('span', {}, label), icon('arrowRight', 15) as unknown as Node]; }

// ---------------------------------------------------------------- GitHub and "Board"
const safeUrl = (u?: string) => { try { const x = new URL(u ?? ''); return x.protocol === 'https:' && x.hostname === 'github.com' ? x.href : null; } catch { return null; } };
const ghLink = (u: string | undefined, text: string) => { const x = safeUrl(u); return x ? h('a', { href: x, target: '_blank', rel: 'noopener noreferrer' }, text) : h('span', {}, text); };
// GitHub card (board-driven space): issue body, comment or linked PR, read-only. Rendered like the other Markdown
// (h()/textContent, links checked); held = written by an outsider while the issue waits for a member's go: folded.
const PR_STATE: Record<string, Key> = { OPEN: 'gh_pr_open', MERGED: 'gh_pr_merged', CLOSED: 'gh_pr_closed' };
function ghCardEl(m: Message, th: PublicThread) {
  const g = m.gh!, url = safeUrl(g.url);
  const text = g.kind === 'pr'
    ? h('div', { class: 'ghc-pr' }, h('b', {}, t('gh_pr')), ' ', ghLink(g.url, g.title ?? ''), g.state ? h('span', { class: `ov-tag pr-${(g.state).toLowerCase()}` }, ` · ${PR_STATE[g.state] ? t(PR_STATE[g.state]) : g.state.toLowerCase()}`) : null)
    : m.text.trim() ? h('div', { class: 'md' }, renderMarkdown(m.text, x => richText(x, th.space), mdOpts(th.space))) : null;
  const body = g.held ? h('details', { class: 'ghc-held' }, h('summary', {}, t('gh_held')), text) : text;
  return h('div', { class: 'm github', 'data-gh': g.kind },
    h('div', { class: 'avatar av-system' }, icon('github', 18) as unknown as Node),
    h('div', { class: 'm-body' },
      h('div', { class: 'm-head' }, h('span', { class: 'm-name' }, g.login || 'ghost'),
        h('span', { class: 'm-badge gh' }, t('gh_badge')), g.agent ? h('span', { class: 'm-badge' }, t('gh_agent', { name: g.agent })) : null,
        g.kind === 'issue' ? h('span', { class: 'ghc-what' }, t('gh_opened')) : null,
        h('span', { class: 'm-time', title: fullDate(m.at) }, since(m.at)),
        url ? h('a', { class: 'ghc-link', href: url, target: '_blank', rel: 'noopener noreferrer' }, t('gh_view')) : null),
      h('div', { class: 'ghc' }, body, g.cut ? h('div', { class: 'ghc-cut' }, t('gh_cut')) : null)));
}
// Board-driven thread: the board column next to the state chip, the issue's labels, and the vetting banner.
const colChip = (f: PublicThread) => f.board?.column ? h('span', { class: 'chip c-col', title: t('gh_column') }, f.board.column) : null;
/** Column chip next to the state chip; none when the column already is the state chip (workCol). */
const columnChip = (f: PublicThread) => workCol(f) ? null : colChip(f);
// Labels: chips; a trusted human removes one (×) or adds one of the repo's (picker, read from GitHub when opened). Written
// by the briefling App through the GitHub Lambda; the thread gets a line naming who did it (or why it failed).
const busyKey = (thread: string, label: string) => `${thread}|${label.toLowerCase()}`;
function labelDone(thread: string) { for (const k of [...S.labelBusy]) if (k.startsWith(`${thread}|`)) S.labelBusy.delete(k); }
function setLabel(f: PublicThread, label: string, on: boolean) {
  if (!send({ type: 'action', thread: f.id, kind: 'label', label, on })) return;
  const k = busyKey(f.id, label);
  S.labelBusy.add(k); S.labelPick = null; S.err = '';
  window.setTimeout(() => { if (S.labelBusy.delete(k)) render(); }, 30_000); // no answer (GitHub off): the button comes back
  render();
}
function openLabels(f: PublicThread) {
  if (S.labelPick?.thread === f.id) { S.labelPick = null; render(); return; }
  const cid = rand().slice(0, 20);
  if (send({ type: 'labels.get', client_id: cid, thread: f.id })) S.labelPick = { thread: f.id, cid, labels: null, err: '' };
  render();
}
function labelPicker(f: PublicThread) {
  const p = S.labelPick!;
  const offer = p.labels ? pickable(p.labels, f.board?.labels ?? []) : [];
  return h('div', { class: 'gh-pick', role: 'menu' },
    p.err ? h('div', { class: 'gh-pick-note err' }, p.err)
      : !p.labels ? h('div', { class: 'gh-pick-note' }, t('label_loading'))
      : !offer.length ? h('div', { class: 'gh-pick-note' }, t('label_none'))
      : null,
    ...offer.map(l => h('button', { class: 'gh-pick-row', type: 'button', role: 'menuitem', title: l.description || l.name, onclick: () => setLabel(f, l.name, true) },
      h('span', { class: 'gh-pick-name' }, l.name), l.description ? h('span', { class: 'gh-pick-desc' }, l.description) : null)));
}
function labelsEl(f: PublicThread) {
  const labels = f.board ? itemLabels(f.board) : [];
  const edit = canEditLabels(f, S.driver.get(f.space) === 'board', S.trusted.has(f.space));
  if (!labels.length && !edit) return null;
  const chips = labels.map(({ name: l, color }) => {
    const busy = S.labelBusy.has(busyKey(f.id, l));
    return h('span', { class: `lb gh-label${color ? ` ${labelClass(color)}` : ''}${busy ? ' busy' : ''}`, title: fixedLabel(l) ? t('label_fixed') : undefined }, l,
      edit && !fixedLabel(l) ? h('button', { class: 'gh-x', type: 'button', disabled: busy, title: t('label_remove', { label: l }), 'aria-label': t('label_remove', { label: l }),
        onclick: () => setLabel(f, l, false) }, '×') : null);
  });
  // An addition on its way shows as a pending chip until the line comes.
  const adding = edit ? [...S.labelBusy].filter(k => k.startsWith(`${f.id}|`)).map(k => k.slice(f.id.length + 1)).filter(l => !labels.some(x => sameLabel(x.name, l))) : [];
  return h('div', { class: 'gh-labels' }, ...chips, ...adding.map(l => h('span', { class: 'lb gh-label busy' }, l)),
    edit ? h('span', { class: 'gh-add-wrap' },
      h('button', { class: 'gh-add', type: 'button', 'aria-expanded': S.labelPick?.thread === f.id ? 'true' : 'false', title: t('label_add_title'), onclick: () => openLabels(f) }, t('label_add')),
      S.labelPick?.thread === f.id ? labelPicker(f) : null) : null);
}
document.addEventListener('click', (e) => { if (S.labelPick && !(e.target as Element).closest?.('.gh-add-wrap')) { S.labelPick = null; render(); } });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.labelPick) { S.labelPick = null; render(); } });
function vettingBanner(f: PublicThread) {
  if (!f.board?.vetting) return null;
  return h('div', { class: 'queued' }, h('div', { class: 'aw-t' }, t('vetting_banner')), f.issue ? ghLink(f.issue.url, t('vetting_open')) : null);
}
// Merge button (issue in « To merge », unstrikeable `approved`: humans merge). Asked to GitHub through the hub when the
// thread shows and whenever the board moves; exactly one open PR = the button. Two clicks (Merge, then Confirm) send the
// PR and head sha shown; the GitHub Lambda merges squash at that sha, deletes the branch and posts the line.
const mergeKey = (f: PublicThread) => `${f.board?.column ?? ''}|${f.board?.sig ?? ''}`;
function askMerge(f: PublicThread) {
  const cid = rand().slice(0, 20);
  S.merge.set(f.id, { cid, sig: mergeKey(f), info: null, err: '', busy: false, confirm: false });
  // Out of render(): send() re-renders when offline.
  window.setTimeout(() => { if (!send({ type: 'merge.get', client_id: cid, thread: f.id })) { const e = S.merge.get(f.id); if (e?.cid === cid) { e.err = t('err_offline'); render(); } } });
}
let mergeConfirmTimer = 0;
function clickMerge(f: PublicThread, e: MergeEntry) {
  const pr = e.info?.pr;
  if (!pr || e.busy) return;
  if (!e.confirm) {
    e.confirm = true;
    window.clearTimeout(mergeConfirmTimer);
    mergeConfirmTimer = window.setTimeout(() => { if (e.confirm) { e.confirm = false; render(); } }, 10_000);
    render(); return;
  }
  const cid = rand().slice(0, 20);
  if (!send({ type: 'action', thread: f.id, kind: 'merge', client_id: cid, repo: pr.repo, number: pr.number, sha: pr.sha })) return;
  Object.assign(e, { cid, busy: true, confirm: false });
  render();
}
// Banner at the top of the conversation (the header has no room for reasons): one place for the whole flow,
// checking → ready (Merge) → confirm (Cancel / Confirm the merge) → merging → merged, or why it can't merge yet.
function mergeBanner(f: PublicThread) {
  if (!canMerge(f, S.driver.get(f.space) === 'board', S.trusted.has(f.space), S.mergeCol.get(f.space))) return null;
  let e = S.merge.get(f.id);
  if (mergeStale(e, mergeKey(f)) && !e?.busy) { askMerge(f); e = S.merge.get(f.id); }
  const v = mergeView(e);
  if (v.kind === 'none') return null;
  const bar = (state: string, text: (Node | string)[], pr: Node | null, ...btns: (Node | null)[]) =>
    h('div', { class: `mergebar mb-${state}`, role: 'status' }, h('div', { class: 'aw-t' }, h('div', {}, ...text), pr ? h('div', { class: 'mb-pr' }, pr) : null),
      h('div', { class: 'mb-acts' }, ...btns));
  const again = h('button', { class: 'btn', type: 'button', onclick: () => { askMerge(f); render(); } }, t('merge_retry'));
  if (v.kind === 'checking') return bar('checking', [h('b', {}, t('merge_checking'))], null);
  if (v.kind === 'error') return bar('error', [h('b', {}, t('merge_failed')), ' · ', v.err], null, again);
  const ref = `${v.pr.repo.split('/')[1]}#${v.pr.number}`, sha = () => h('code', {}, v.pr.sha.slice(0, 7));
  const pr = h('span', {}, ghLink(v.pr.url, ref), ' · ', v.pr.title);
  if (v.kind === 'blocked' && v.blocked === 'merged') return bar('merged', [h('b', {}, t('merge_done', { ref }))], pr);
  if (v.kind === 'blocked') return bar('blocked', [h('b', {}, t('merge_blocked')), ' · ', t(`merge_why_${v.blocked}` as Key)], pr, v.retry ? again : null);
  if (e!.busy) return bar('busy', [h('span', { class: 'pulse' }), h('b', {}, t('merge_busy', { ref }))], pr);
  if (e!.confirm) return bar('confirm', [h('b', {}, t('merge_confirm_q', { ref })), ' ', t('merge_confirm_how1'), sha(), t('merge_confirm_how2')], pr,
    h('button', { class: 'btn', type: 'button', onclick: () => { e!.confirm = false; render(); } }, t('merge_cancel')),
    h('button', { class: 'btn danger', type: 'button', onclick: () => clickMerge(f, e!) }, t('merge_confirm')));
  return bar('ready', [h('b', {}, t('merge_ready')), ' · ', t('merge_ready_how1'), sha(), t('merge_ready_how2')], pr,
    h('button', { class: 'btn pri', type: 'button', onclick: () => clickMerge(f, e!) }, t('merge_btn', { ref })));
}
// "→ Issue" button: only if the space has linked repos; the hub checks everything again (trust, repo).
function issueEl(f: PublicThread) {
  if (f.issue) return h('span', { class: 'issue-ok' }, ghLink(f.issue.url, `${f.issue.repo.split('/')[1]}#${f.issue.number}`));
  if (f.issuePending) return h('span', { class: 'issue-ok' }, t('issue_pending'));
  const repos = S.repos.get(f.space) ?? [];
  if (!repos.length) return null;
  const sel = repos.length > 1 ? h('select', { class: 'repo', 'aria-label': t('repo') }, ...repos.map(r => h('option', { value: r }, r.split('/')[1]))) as HTMLSelectElement : null;
  return h('span', { class: 'issue-make' }, sel,
    h('button', { class: 'btn ghost', title: t('issue_title', { repos: repos.join(', ') }),
      onclick: () => send({ type: 'action', thread: f.id, kind: 'issue', repo: sel ? cur(sel).value : repos[0] }) }, t('issue_btn')));
}
// Board: GitHub Project items without a thread, grouped by status. Threads are in the space view (#N tag).
// Two read-only modes: List = one block per status, one line per item; Columns = one column per status, cards.
function boardMode(space: string): BoardMode {
  try { return parseBoardMode(localStorage.getItem(boardModeKey(space))); } catch { return 'list'; }
}
// Label colours: one class per colour in a constructed stylesheet. The CSP forbids `style` attributes, and an inline
// colour set through `el.style` would be re-applied by morphdom with setAttribute('style'), which the CSP blocks.
const labelSheet = new CSSStyleSheet();
const labelRules = new Set<string>();
function labelClass(hex: string): string {
  if (!labelRules.size) document.adoptedStyleSheets = [...document.adoptedStyleSheets, labelSheet];
  if (!labelRules.has(hex)) { labelSheet.insertRule(`.lb.lc-${hex}{background:#${hex};color:#${labelInk(hex)}}`); labelRules.add(hex); }
  return `lc-${hex}`;
}
function overview(space: string) {
  const gh = S.github.get(space);
  // Board-driven space: every open item, the title opens its thread (loaded on demand: history carries it).
  const ext = S.driver.get(space) === 'board';
  const groups = boardGroups(gh, [...S.threads.values()].filter(f => f.space === space && f.kind !== 'topic'), ext);
  const mode = boardMode(space);
  const setMode = (m: BoardMode) => { try { localStorage.setItem(boardModeKey(space), m); } catch { /* private mode: not remembered */ } render(); };
  const toThread = (id: string) => { S.view = { kind: 'space', id: space }; open(id); };
  type Item = GhSnapshot['items'][number];
  // Type only when it is not an issue (PR, draft PR, draft item).
  const kind = (i: Item) => i.kind === 'issue' ? null : h('span', { class: 'bk' },
    i.kind === 'pr' ? (i.state === 'DRAFT' ? `${t('gh_pr')} · ${t('gh_draft_tag')}` : t('gh_pr')) : t('gh_draft'));
  const title = (i: Item) => ext && i.thread ? h('a', { href: `#/${encodeURIComponent(space)}/${encodeURIComponent(i.thread)}`, class: 'ov-thread',
    onclick: (e: Event) => { e.preventDefault(); toThread(i.thread!); } }, i.title) : ghLink(i.url, i.title);
  const ref = (i: Item) => i.repo && i.number ? h('span', { class: 'bref' }, ext ? ghLink(i.url, `${i.repo.split('/')[1]}#${i.number}`) : `${i.repo.split('/')[1]}#${i.number}`) : null;
  const labels = (i: Item, n: number) => {
    const ls = itemLabels(i);
    return [...ls.slice(0, n).map(l => h('span', { class: `lb${l.color ? ` ${labelClass(l.color)}` : ''}` }, l.name)),
      ls.length > n ? h('span', { class: 'lb lb-more', title: ls.slice(n).map(l => l.name).join(', ') }, `+${ls.length - n}`) : null];
  };
  // Thread state: known for the threads loaded in the list (board-driven space); otherwise what the item lacks.
  const stateOf = (i: Item): ThreadState | null => { const f = ext && i.thread ? S.threads.get(i.thread) : undefined; return f ? shown(f) : null; };
  const state = (i: Item) => {
    const st = stateOf(i);
    if (st) return h('span', { class: `stp s-${st}` }, h('i', {}), label(st));
    return ext && !i.thread ? h('span', { class: i.kind === 'issue' ? 'stp ov-wait' : 'stp' }, i.kind === 'issue' ? t('board_waiting_go') : t('board_no_thread')) : null;
  };
  const row = (i: Item) => h('div', { class: `br s-${stateOf(i) ?? 'none'}` }, h('span', { class: 'bar' }), ref(i),
    h('span', { class: 'br-t' }, kind(i), title(i)), h('span', { class: 'br-l' }, ...labels(i, 3)), state(i));
  const card = (i: Item) => h('div', { class: `bc s-${stateOf(i) ?? 'none'}` }, h('div', { class: 'bc-t' }, kind(i), title(i)),
    h('div', { class: 'bc-m' }, ref(i), ...labels(i, 4), h('span', { class: 'sp' }), state(i)));
  // Status names come from the GitHub Project (user data, not translated); '' = no status.
  const head = (st: string, n: number) => h('div', { class: 'gh-h' }, h('span', { class: 'gname' }, st || t('board_no_status')), h('span', { class: 'gcount' }, String(n)));
  const body = mode === 'columns'
    ? [h('div', { class: 'cols' }, ...groups.map(([st, items]) => h('section', { class: 'col' }, head(st, items.length), h('div', { class: 'cl' }, ...items.map(card)))))]
    : listGroups(groups).map(([st, items]) => h('section', { class: 'bg' }, head(st, items.length), h('div', { class: 'rows' }, ...items.map(row))));
  const seg = groups.length ? h('div', { class: 'seg', role: 'group', 'aria-label': t('board_mode') },
    ...([['list', 'list', 'board_list'], ['columns', 'columns', 'board_columns']] as const).map(([m, ic, k]) =>
      h('button', { class: mode === m ? 'on' : '', 'aria-pressed': String(mode === m), onclick: () => setMode(m) }, icon(ic, 14) as unknown as Node, t(k)))) : null;
  return h('section', { class: `overview board ${mode}` },
    h('header', {}, menuBtn(), h('div', {}, h('h2', {}, t('board_title', { space: spaceName(space) })),
      h('p', {}, gh ? h('span', {}, t('gh_project'), ghLink(gh.project.url, gh.project.title), t('gh_read', { ago: ago(gh.at) }), ext ? ` · ${t('board_ext_sub')}` : '')
        : t('gh_pending'))), seg),
    h('div', { class: 'scroll' }, ext ? flowBlock(space) : null,
      ...(groups.length ? body
        : gh?.error === 'not_installed' ? [h('div', { class: 'empty' }, t('board_not_installed'))]
        : gh ? [h('div', { class: 'empty' }, t('board_all_linked'))] : [])));
}

// ---------------------------------------------------------------- flow block (docs/design-flow.md § 4.6)
// Board page of a board-driven space: each flow agent (status, task, spend against its caps, alerts, Pause / Resume for
// trusted humans) and the latest closed tasks. Live states come with `synced` and `flowstate.updated`; the tasks are
// asked on each entry (`flowstate.get`) and again when an agent's task changes.
let flowFor = ''; // space whose closed tasks were last asked
function onFlowState(space: string, st: FlowAgentState) {
  const m = S.flow.get(space) ?? new Map<string, FlowAgentState>();
  if (m.get(st.agent)?.current?.ref !== st.current?.ref) flowFor = ''; // a task ended or started: its record may be new
  m.set(st.agent, st); S.flow.set(space, m);
}
/** "10:42" today, "Tue 10:42" before. */
const whenShort = (ms: number) => new Date(ms).toDateString() === new Date().toDateString() ? hhmm(ms)
  : new Date(ms).toLocaleString(lang(), { weekday: 'short', hour: '2-digit', minute: '2-digit' });
/** Task thread header: « Gideon · working · last activity 10:42 ». */
function flowChip(f: PublicThread) {
  const c = chipOf(S.flow.get(f.space)?.values() ?? [], f.id);
  if (!c) return null;
  return h('span', { class: `chip fl-st st-${c.status}`, 'data-k': 'flow-chip' }, c.status === 'working' ? h('span', { class: 'pulse' }) : null,
    `${cap(c.agent)} · ${t(`flow_st_${c.status}` as Key)} · ${t('flow_last', { time: whenShort(c.last) })}`);
}
function flowBlock(space: string) {
  const states = [...(S.flow.get(space)?.values() ?? [])].sort((a, b) => a.agent.localeCompare(b.agent));
  const tasks = S.flowTasks.get(space) ?? [];
  if (!states.length && !tasks.length) return null;
  const l = lang(), trusted = S.trusted.has(space);
  const short = (ref: string) => ref.split('/')[1] ?? ref;
  const link = (thread: string | null, text: string) => thread ? h('a', { href: `#/${encodeURIComponent(space)}/${encodeURIComponent(thread)}`, class: 'ov-thread',
    onclick: (e: Event) => { e.preventDefault(); S.view = { kind: 'space', id: space }; open(thread); } }, text) : h('span', {}, text);
  const gauge = (label: string, s: FlowAgentState, w: 'day' | 'month') => {
    const total = spent(s, w), cp = s.caps[w], g = capGauge(total, cp);
    return h('div', { class: `fl-g${g ? ` ${g.level}` : ''}` }, h('span', { class: 'fl-gk' }, label),
      h('span', { class: 'fl-gv' }, cp === null ? `${usdLabel(total, l)} · ${t('flow_no_cap')}` : `${usdLabel(total, l)} / ${usdLabel(cp, l)}`),
      h('span', { class: 'fl-bar' }, h('i', { style: `width:${Math.round((g?.share ?? 0) * 100)}%` })),
      h('span', { class: 'fl-split' }, t('flow_split', { task: usdLabel(s.usage.task[w], l), disc: usdLabel(s.usage.discussion[w], l) })));
  };
  const card = (s: FlowAgentState) => {
    const st = flowStatus(s), k = `${space}|${s.agent}`, p = S.flowPause.get(k), paused = !!s.paused;
    const toggle = () => { const cid = rand().slice(0, 20); if (send({ type: 'flowstate.pause', client_id: cid, space, agent: s.agent, paused: !paused })) { S.flowPause.set(k, { cid, err: '' }); render(); } };
    const btn = trusted ? h('button', { class: 'btn fl-btn', type: 'button', disabled: !!p?.cid, onclick: toggle,
      title: paused ? (s.paused!.by === 'quota' ? t('flow_resume_quota_tip') : t('flow_resume_tip')) : t('flow_pause_tip') },
      icon(paused ? 'play' : 'pause', 13) as unknown as Node, t(paused ? 'flow_resume' : 'flow_pause')) : null;
    const task = s.current ? h('div', { class: 'fl-task' }, h('span', { class: 'fl-k' }, t('flow_task')), link(s.current.thread, short(s.current.ref)),
      h('span', { class: 'fl-trig' }, s.current.trigger),
      h('span', { class: 'fl-m' }, t('flow_since', { time: whenShort(s.current.since * 1000) }), ' · ', t('flow_last', { time: whenShort((s.current.alive ?? s.current.since) * 1000) })))
      : h('div', { class: 'fl-task fl-none' }, t('flow_no_task'));
    return h('div', { class: `fl-card st-${st}`, 'data-k': `fl:${s.agent}` },
      h('div', { class: 'fl-h' }, h('b', {}, cap(s.agent)), h('span', { class: `chip fl-st st-${st}` }, st === 'working' ? h('span', { class: 'pulse' }) : null, t(`flow_st_${st}` as Key)),
        h('span', { class: 'sp' }), btn),
      s.paused ? h('div', { class: 'fl-why' }, s.paused.reason) : null,
      task, gauge(t('flow_today'), s, 'day'), gauge(t('flow_30d'), s, 'month'),
      ...s.alerts.slice().reverse().map(a => h('div', { class: 'fl-alert' }, h('b', {}, whenShort(a.at * 1000)), ` ${a.text}`)),
      p?.err ? h('div', { class: 'fl-err' }, p.err) : null);
  };
  const cols = ['flow_col_issue', 'flow_col_agent', 'flow_col_outcome', 'flow_col_kind', 'flow_col_time', 'flow_col_cost', 'flow_col_end'] as const;
  const row = (r: FlowTaskRow) => h('div', { class: 'fl-row' }, link(r.thread, short(r.ref)), h('span', {}, cap(r.agent)),
    h('span', { class: `fl-out o-${r.outcome}` }, t(`flow_out_${r.outcome}` as Key)), h('span', { class: 'fl-dim' }, r.kind ?? '—'),
    h('span', {}, durationLabel(r.end - r.start, l)), h('span', {}, r.cost === null ? '—' : usdLabel(r.cost, l)), h('span', { class: 'fl-dim' }, whenShort(r.end * 1000)));
  const head = (key: Key, n?: number) => h('div', { class: 'gh-h' }, h('span', { class: 'gname' }, t(key)), n === undefined ? null : h('span', { class: 'gcount' }, String(n)));
  return h('section', { class: 'fl', 'data-k': 'flow-block' }, head('flow_agents', states.length),
    states.length ? h('div', { class: 'fl-cards' }, ...states.map(card)) : h('div', { class: 'fl-none' }, t('flow_unreported')),
    tasks.length ? head('flow_tasks') : null,
    tasks.length ? h('div', { class: 'fl-rows' }, h('div', { class: 'fl-row fl-th' }, ...cols.map(c => h('span', {}, t(c)))), ...tasks.slice(0, 12).map(row)) : null);
}

/** « Where the tokens go »: one stacked bar (SVG, sizes as attributes for the CSP) + a legend with each share. Shared by
 *  the Metrics view and the thread info pane. Each segment's tooltip gives its dollars and calls. */
// Labels by bucket (`act_misc` for « other »: a key ending in `_other` reads as a plural pair to the i18n test).
const ACT_LABEL: Record<CostBucket, Key> = { discussion: 'act_discussion', answer: 'act_answer', read: 'act_read', code: 'act_code', test: 'act_test',
  deploy: 'act_deploy', git: 'act_git', coordination: 'act_coordination', review: 'act_review', compress: 'act_compress', other: 'act_misc', unsplit: 'act_unsplit' };
const actLabel = (b: CostBucket) => t(ACT_LABEL[b]);
let hatchSeq = 0;
function splitBar(rows: SplitRow[]) {
  const l = lang(), n = (x: number) => new Intl.NumberFormat(l).format(x);
  const pct = (r: SplitRow) => r.pct < 1 ? '<1 %' : `${n(r.pct)} %`;
  const tip = (r: SplitRow) => `${actLabel(r.id)} · ${usdLabel(r.usd, l)} · ${tn('cost_calls', r.calls, { n: n(r.calls) })}`;
  const total = rows.reduce((s, r) => s + r.usd, 0);
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  // No viewBox: x/width in % keep the user space in pixels, so the « not split » hatch stays at 45° whatever the bar's width.
  for (const [k, v] of Object.entries({ class: 'mx-stack', role: 'img',
    'aria-label': rows.map(r => `${actLabel(r.id)} ${pct(r)}`).join(', ') })) svg.setAttribute(k, String(v));
  const set = (el: Element, attrs: Record<string, string | number>) => { for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v)); return el; };
  const hatch = `mx-hatch-${++hatchSeq}`; // one id per bar: Metrics and the thread details can show two bars at once
  const pattern = set(document.createElementNS(NS, 'pattern'), { id: hatch, class: 'mx-hatch', patternUnits: 'userSpaceOnUse', width: 5, height: 5, patternTransform: 'rotate(45)' });
  pattern.append(set(document.createElementNS(NS, 'path'), { class: 'mx-hatch-bg', d: 'M0 0H5V5H0Z' }), set(document.createElementNS(NS, 'path'), { class: 'mx-hatch-line', d: 'M1 0V5' }));
  const defs = document.createElementNS(NS, 'defs'); defs.append(pattern); svg.append(defs);
  let x = 0;
  const share = (usd: number) => `${total ? usd / total * 100 : 0}%`;
  for (const r of rows) {
    const rect = set(document.createElementNS(NS, 'rect'), { class: `a-${r.id}`, x: share(x), y: 0, width: share(r.usd), height: '100%' });
    if (r.id === 'unsplit') rect.setAttribute('fill', `url(#${hatch})`); // the stylesheet colours only rects without a fill attribute
    const title = document.createElementNS(NS, 'title'); title.textContent = tip(r); rect.append(title);
    svg.append(rect); x += r.usd;
  }
  return [h('div', { class: 'mx-stackbox' }, svg as unknown as Node),
    h('div', { class: 'mx-legend', 'data-k': 'split-legend' }, ...rows.map(r => h('span', { class: `mx-key a-${r.id}`, title: tip(r) }, h('i', {}), actLabel(r.id), h('b', {}, pct(r)))))];
}
const reasoningLine = (u: Usage | null | undefined) => {
  const p = reasoningShare(u);
  return h('p', { class: 'mx-reason' }, p === null ? t('metrics_reasoning_none') : t('metrics_reasoning', { pct: new Intl.NumberFormat(lang()).format(p) }));
};

/** Settings changed by the admin: new name, or no access anymore (removed, archived) -> the space disappears from the app. */
/** Agent with the function the admin just set (none = removed). */
const agentWithRole = ({ role: _, ...p }: Person, role: string | undefined): Person => role ? { ...p, role } : p;
/** Agent with the photo the admin set (none = removed). */
const agentWithAvatar = ({ avatar: _, ...p }: Person, avatar: string | undefined): Person => avatar ? { ...p, avatar } : p;
function onSpaceUpdated(d: SpaceInfo & { member: boolean; humans?: Person[]; agents?: string[]; agentRoles?: Record<string, string>; agentAvatars?: Record<string, string>; driver?: Driver }) {
  if (d.member) {
    if (d.driver) S.driver.set(d.id, d.driver);
    if (d.memPending !== undefined) mem().pendingSet(d.id, d.memPending); // 0 = no longer a reviewer, or nothing waits
    S.spaces = S.spaces?.map(s => s.id === d.id ? { id: d.id, name: d.name, ...(d.modules ? { modules: d.modules } : {}), ...(d.nontech ? { nontech: true as const } : {}), ...(d.admin ? { admin: true as const } : {}) } : s) ?? null;
    // Member added or renamed, agent joined or removed: messages, the @ list and the Lounge stack follow at once.
    if (d.humans && S.people.has(d.id)) S.people.set(d.id, withAgents(d.humans, S.people.get(d.id)!, d.agents,
      a => ({ id: a, name: a[0].toUpperCase() + a.slice(1), kind: 'agent' as const }))
      .map(p => p.kind === 'human' ? p : agentWithAvatar(d.agentRoles ? agentWithRole(p, d.agentRoles[p.id]) : p, d.agentAvatars?.[p.id]))); // photos come with `humans`
    return;
  }
  S.spaces = S.spaces?.filter(s => s.id !== d.id) ?? null; S.mySpaces?.delete(d.id);
  for (const [k, f] of S.threads) if (f.space === d.id) S.threads.delete(k);
  // Settings opened by the admin (they just archived it, or another tab did): spaces page, where the archived ones are.
  // This `space.updated` arrives before `space.saved`: without this, the admin would end up on Now with no way back.
  if (S.view.kind === 'settings' && S.view.id === d.id && S.admin) { S.view = { kind: 'newspace' }; return; } // global admin: the spaces page
  if (S.view.kind !== 'now' && S.view.kind !== 'newspace' && S.view.id === d.id) { S.view = { kind: 'now' }; S.sel = null; }
}

// "Summary": living summary written by the agent (protocol field `status`). Text rendering only (textContent).
// A card of the conversation-card family; its colour follows the thread (`summaryTone`): green done, orange Your turn,
// blue otherwise; the thread's state chip on the right of the band says which. Opens unfolded; the chevron folds it
// (patch.ts keeps it across renders, never stored), and so do scrolling up or a plain click in the messages (sumfold.ts) and starting to
// write on a phone. No data-k: a
// new keyed <details> is first placed as an empty closed placeholder, whose fold patch.ts would then copy.
function summaryEl(f: PublicThread) {
  const s = S.summaries.get(f.id);
  if (!s) return null;
  const sect = (cls: string, ic: string, title: string, rows: Node[]) => h('div', { class: `sc-sec ${cls}` },
    h('span', { class: 'sc-ic', 'aria-hidden': 'true' }, icon(ic, 13) as unknown as Node), h('div', { class: 'sc-rows' }, h('div', { class: 'sc-h' }, title), ...rows));
  return h('details', { class: `sumcard t-${summaryTone(f, S.me, S.people.get(f.space))}`, open: true },
    h('summary', { class: 'k-band' }, kindIc('summary'), h('b', {}, t('summary')), h('span', { class: 'sc-at' }, `· ${ago(s.at)}`),
      h('span', { class: 'sc-chip' }, chip(f)), icon('chevronDown', 16) as unknown as Node),
    h('div', { class: 'sc-body' },
      h('p', { class: 'sc-st' }, s.status),
      s.decisions.length ? sect('sc-dec', 'check', t('decided'), s.decisions.map(d => h('div', {}, d))) : null,
      s.next_steps.length ? sect('sc-next', 'arrowRight', t('next'), s.next_steps.map((e, i) => ns().row(f, i, e))) : null,
      summaryWaits(f, s.waiting_on) ? h('div', { class: 'sc-wait' }, icon('later', 13) as unknown as Node, h('span', {}, t('waiting_on', { who: s.waiting_on }))) : null));
}
function conv() {
  const f = S.sel && S.sel !== 'new' ? S.threads.get(S.sel) : null;
  // General: its own view, even before its first post (not in S.threads yet).
  if (S.sel && isGeneralId(S.sel) && (f || S.view.kind === 'lounge')) return generalView(f?.space ?? (S.view as { id: string }).id);
  // Lounge with nothing selected: the new-topic composer instead of an empty "pick a topic" screen.
  if (!f && S.view.kind === 'lounge' && S.sel !== 'new') return h('section', { class: 'conv empty' }, paneClose(), h('div', { class: 'blank' }, t('feed_pick')));
  if (!f && S.view.kind === 'lounge') return newTopic(S.view.id);
  if (!f) return h('section', { class: 'conv' }, h('div', { class: 'blank' }, S.view.kind === 'closed' || S.view.kind === 'later' ? t('pick_shelved') : t('pick_thread')));
  if (f.kind === 'topic') return topicView(f);
  const all = convOrder(S.msgs.get(f.id)?.values() ?? []);
  const act = (kind: string, ic: string, key: Key) => iconBtn(ic, t(key), () => send({ type: 'action', thread: f.id, kind }));
  const ta = h('textarea', { placeholder: t(touchOnly() ? 'write_to_touch' : 'write_to', { agent: f.owner }), ...NO_AUTOFILL,
    // Phone: writing folds the Summary, so the keyboard leaves room for the messages.
    onfocus: () => { const sc = narrow() && document.querySelector('.conv details.sumcard') as HTMLDetailsElement | null; if (sc) sc.open = false; } }) as HTMLTextAreaElement;
  const sug = h('div', { class: 'suggest', hidden: true });
  attachMentions(ta, f.space, sug);
  const att = attachments(f.id, f.space, ta);
  const go = () => { const text = msgText(cur(ta), att, go); if (text) notePosted(f); if (text && send({ type: 'post', client_id: rand().slice(0, 20), space: f.space, thread: f.id, text, ...att.payload() })) { noteMentions(f.space, text); cur(ta).value = ''; drafts.delete(f.id); att.clear(); toBottom(); } };
  const composer = editableComposer(f, ta, sug, att, go, h('span', { class: 'grow' }, t('send_in'), h('span', { class: 'route' }, f.title)));
  const msgs = msgsEl(f, all);
  // `work`: a thread (not a topic nor an empty screen), the graph-paper background (style.css)
  return h('section', { class: 'conv work' },
    h('div', { class: 'state' }, h('div', { class: 'crumb' }, backBtn(), `${spaceName(f.space)} · ${f.owner}`, chip(f), bgBadge(f), flowChip(f), columnChip(f), doneTag(f), ciHead(f),
      fromEl(f), planNavEl(f), costEl(f, 'crumb'), paneClose()),
      h('div', { class: 'row' }, h('h1', {}, ...richText(f.title, f.space)), h('div', { class: 'acts' },
        issueEl(f), ...(f.state === 'idea' || f.state === 'done' ? [act('reopen', 'reopen', 'reopen')] : [act('idea', 'later', 'later'), act('done', 'close', 'close')]), releaseBtn(f), pinBtn(f), archiveBtn(f), linkBtn(`t:${f.id}`, copyUrl(f.id), 'link_thread'), infoBtn())),
      labelsEl(f)),
    convHeads(h('div', { class: 'bans' }, archivedBanner(f), vettingBanner(f), mergeBanner(f), awaitBanner(f), lockLine(f)), summaryEl(f)), msgs, composer);
}
/** What comes and goes above `.msgs` (banners, lock line, Summary), in one always-present `display: contents` box.
 *  Why: those siblings are unkeyed and morphdom matches them by position, so one appearing turned the old `.msgs` into
 *  it and built a fresh one at scrollTop 0 (a data-k on `.msgs` does not help: a moved scroller resets too). The banners
 *  sit in their own box before the Summary so that the <details> (unkeyed, see summaryEl) keeps its slot and its fold. */
const convHeads = (...kids: (Node | null)[]) => h('div', { class: 'heads' }, ...kids);
// ---------------------------------------------------------------- thread info panel (client/src/details.ts)
// Right column of a thread: Code (issue, repos, branch, PR, commits and their CI), Assets (files, shared resources),
// Timeline. Asked on opening, on another thread, and again 1.5 s after the open thread moved (`updatedAt`).
function setInfo(on: boolean) { S.info = on; try { localStorage.setItem('briefling.info', on ? '1' : '0'); } catch { /* private mode */ } render(); }
const infoBtn = () => iconBtn('info', t('det_title'), () => setInfo(!S.info), { class: `btn ic info-btn ${S.info ? 'on' : ''}`, 'aria-pressed': String(S.info) });
let detailsTimer: number | undefined;
function askDetails(f: PublicThread) {
  const key = `${f.id}|${f.updatedAt}`, e = S.details.get(f.id);
  if (e?.key === key) return;
  const cid = rand().slice(0, 20);
  S.details.set(f.id, { cid, key, data: e?.data ?? null, prs: e?.prs ?? null, err: '' });
  window.clearTimeout(detailsTimer);
  detailsTimer = window.setTimeout(() => {
    if (S.details.get(f.id)?.cid !== cid || send({ type: 'details.get', client_id: cid, thread: f.id })) return;
    const x = S.details.get(f.id); if (x?.cid === cid) { x.err = t('err_offline'); render(); }
  }, e?.data ? 1500 : 0);
}
/** Commit row of the panel: the short sha only (the repo is the row above), linked to GitHub. */
const shaLink = (c: { repo: string; sha: string }) => { const u = commitUrl(c); return [u ? h('a', { class: 'det-sha', href: u, target: '_blank', rel: 'noopener noreferrer' }, h('code', {}, c.sha.slice(0, 7))) : h('code', { class: 'det-sha' }, c.sha.slice(0, 7))]; };
const repoShort = (repo: string) => repo.split('/')[1] ?? repo;
/** Day header of the timeline: Today, Yesterday, else « Mon 26 Oct ». */
function detDay(ts: number) {
  const d = new Date(ts), now = new Date(), day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  return diff <= 0 ? t('date_today') : diff === 1 ? t('date_yesterday') : d.toLocaleDateString(lang(), { weekday: 'short', day: 'numeric', month: 'short' });
}
const detRow = (ic: string, ...kids: Child[]) => h('div', { class: 'det-row' }, icon(ic, 14) as unknown as Node, ...kids);
const detPill = (cls: string, text: string) => h('span', { class: `det-pill ${cls}` }, text);
const personOf = (id: string | undefined) => id ? personName(id) ?? cap(id) : '';
/** Info pane « Cost »: total + where it went, by activity (a topic too: passed without its kind). None without usage. */
function detCost(f: PublicThread): Child[] {
  if (!f.usage) return [];
  const rows = splitRows(costSplit({ usage: f.usage }));
  return [h('h3', {}, t('det_cost')), h('div', { class: 'det-cost', 'data-k': 'det-cost' },
    h('div', { class: 'det-row' }, icon('dollar', 14) as unknown as Node, h('span', { class: 'v', title: costTitle(f.usage, lang()) }, costLabel(f.usage, lang()))),
    ...splitBar(rows), reasoningLine(f.usage))];
}
function infoPane(f: PublicThread) {
  askDetails(f);
  const e = S.details.get(f.id)!, d = e.data;
  const head = h('div', { class: 'det-head' }, h('b', {}, t('det_title')), iconBtn('x', t('det_close'), () => setInfo(false)));
  if (!d) return h('aside', { class: 'det', 'aria-label': t('det_title') }, head, h('div', { class: 'det-body' }, h('p', { class: 'det-muted' }, e.err || t('ex_loading'))));
  // Code
  const code: Child[] = [];
  if (f.issue) code.push(detRow('issue', h('span', { class: 'v' }, ghLink(f.issue.url, t('det_issue', { ref: `${repoShort(f.issue.repo)}#${f.issue.number}` }))),
    f.board ? detPill(f.board.state === 'OPEN' ? 'open' : 'done', t(f.board.state === 'OPEN' ? 'det_issue_open' : 'det_issue_closed')) : null));
  for (const b of codeBlocks(d, f.ci, e.prs)) {
    code.push(detRow('github', h('span', { class: 'v' }, ghLink(`https://github.com/${b.repo}`, b.repo))));
    if (b.branch) code.push(detRow('branch', h('code', { class: 'v' }, b.branch)));
    for (const p of b.prs) code.push(detRow('pr', h('span', { class: 'v' }, ghLink(p.url, `#${p.number} ${p.title}`)),
      p.draft && p.state === 'open' ? detPill('', t('det_pr_draft')) : null, detPill(p.state, t(PR_STATE[p.state.toUpperCase()]))));
    if (!b.prs.length && b.followed) code.push(detRow('pr', h('span', { class: 'v det-muted' }, b.error ? t(`det_pr_err_${b.error}` as Key) : e.prs ? t('det_pr_none') : t('det_pr_reading'))));
    for (const c of b.commits.slice(0, 10)) code.push(detRow('commit', h('span', { class: 'v' }, ...shaLink(c)),
      c.verdict ? detPill(`ci ci-${ciTone(c.verdict)}`, t(`ci_${c.verdict}` as Key)) : null, h('span', { class: 'det-meta' }, hhmm(c.at))));
  }
  if (!code.length) code.push(h('p', { class: 'det-muted' }, t('det_code_none')));
  const codeOn = modOn(f.space, 'code'); // « code » module off: no Code block
  // Assets: files newest first, then the shared resources this thread holds or waits for
  const assets: Child[] = d.files.slice().reverse().map(x => {
    const u = urlFor(x.id);
    return detRow('file', h('span', { class: 'v' }, u ? h('a', { href: u, target: '_blank', rel: 'noopener noreferrer' }, x.name) : x.name),
      h('span', { class: 'det-meta' }, `${personOf(x.by)} · ${since(x.at)}`));
  });
  for (const r of S.resources.values()) {
    if (r.space !== f.space || (r.holder !== f.id && !r.queue.includes(f.id))) continue;
    assets.push(detRow('lock', h('code', { class: 'v' }, r.resource), r.holder === f.id ? detPill('open', t('det_res_held')) : detPill('wait', t('det_res_waiting'))));
  }
  if (!assets.length) assets.push(h('p', { class: 'det-muted' }, t('det_assets_none')));
  // Invited contributors (Thread.invited): a lead invites or removes them; everyone sees who is invited.
  const invited = f.invited ?? [], lead = S.trusted.has(f.space) && f.kind !== 'topic';
  const pool = lead ? [...new Set([...invited, ...(S.contributors.get(f.space) ?? [])])] : invited;
  const guests = pool.map(u => detRow('users', h('span', { class: 'v' }, personOf(u)),
    !lead ? null : h('button', { class: 'btn ghost det-invite', type: 'button', 'data-k': `invite:${u}`, 'aria-pressed': String(invited.includes(u)),
      onclick: () => send({ type: 'action', thread: f.id, kind: 'invite', user: u, on: !invited.includes(u) }) }, t(invited.includes(u) ? 'det_invite_remove' : 'det_invite_add')),
    invited.includes(u) ? detPill('open', t('det_invited')) : null));
  // Background work the agent declared (live, from the thread itself): goal, kind, running since
  const bg = bgTasks(f).map(x => detRow('run', h('span', { class: 'v' }, x.goal), detPill('wait', t(x.kind === 'delegate' ? 'det_bg_delegate' : 'det_bg_process')),
    h('span', { class: 'det-meta' }, since(x.since))));
  // Timeline, grouped by day
  const tl: Child[] = [];
  let day = '';
  const evEl = (r: TimelineRow) => {
    const vars: Record<string, string> = { ...r.vars, who: personOf(r.who) };
    if (r.key === 'det_ci') vars.verdict = t(`ci_${r.vars.verdict}` as Key);
    if (r.key === 'det_opened_from') vars.title = quote(r.vars.title);
    return h('li', { class: `det-ev tone-${r.tone}` }, h('span', { class: 'det-t' }, hhmm(r.at)), h('span', { class: 'det-dot' }),
      h('span', { class: 'det-x' }, t(r.key, vars), r.end ? h('small', {}, `${hhmm(r.end)} · ${duration(r.end - r.at)}`) : null));
  };
  // Not technical: each run of pushes, CI, locks… of a day becomes one folded line « N technical details »
  const plain = nontech(f.space);
  for (const run of foldRuns(timelineRows(d), r => plain && techRow(r.key))) {
    const first = run.tech ? run.rows[0] : run.row, dl = detDay(first.at);
    if (dl !== day) { day = dl; tl.push(h('li', { class: 'det-day' }, dl)); }
    if (!run.tech) { tl.push(evEl(run.row)); continue; }
    const rows = run.rows.filter(r => detDay(r.at) === dl), rest = run.rows.slice(rows.length);
    tl.push(h('li', { class: 'det-ev tone-calm tech-run' }, h('span', { class: 'det-t' }, hhmm(first.at)), h('span', { class: 'det-dot' }),
      h('details', { class: 'tech-fold det-x' }, h('summary', {}, tn('tech_rows', rows.length)), h('ul', { class: 'det-tl' }, ...rows.map(evEl)))));
    for (const r of rest) { const d2 = detDay(r.at); if (d2 !== day) { day = d2; tl.push(h('li', { class: 'det-day' }, d2)); } tl.push(evEl(r)); }
  }
  return h('aside', { class: 'det', 'aria-label': t('det_title') }, head,
    h('div', { class: 'det-body' },
      ...(!codeOn ? [] : nontech(f.space) ? [h('details', { class: 'tech-fold det-fold', 'data-k': 'det-code' }, h('summary', {}, t('det_code')), ...code)] : [h('h3', {}, t('det_code')), ...code]),
      h('h3', {}, t('det_assets')), ...assets,
      ...(guests.length ? [h('h3', {}, t('det_guests')), ...(lead ? [h('p', { class: 'det-muted' }, t('det_guests_hint'))] : []), ...guests] : []),
      ...(bg.length ? [h('h3', {}, t('det_bg')), ...bg] : []),
      ...detCost(f),
      h('h3', {}, t('det_timeline')),
      d.events.length ? null : h('p', { class: 'det-muted' }, t('det_tl_empty')),
      h('ul', { class: 'det-tl' }, ...tl),
      d.more ? h('p', { class: 'det-muted' }, t('det_more')) : null));
}
// ---------------------------------------------------------------- CI follow-up (pills and lines, client/src/ci.ts)
/** Dot after the state chip: the worst CI of the thread, every repo in the tooltip. Nothing when nothing was followed. */
function ciDot(f: PublicThread) {
  const p = ciWorst(f.ci);
  if (!p || !modOn(f.space, 'ci')) return null;
  const tip = ciTip(f.ci!);
  return h('span', { class: `ci-dot ci-${ciTone(p.verdict)} tip tip-below`, 'data-tip': tip, 'aria-label': tip, role: 'img' });
}
/** Card: the same worst CI as a neutral chip with a short label (« CI ok », « CI ko »), readable without hovering. */
function ciBadge(f: PublicThread) {
  const p = ciWorst(f.ci);
  if (!p || !modOn(f.space, 'ci') || nontech(f.space)) return null;
  const tone = ciTone(p.verdict), tip = ciTip(f.ci!);
  return h('span', { class: 'chip c-place ci-badge tip tip-below', 'data-tip': tip, 'aria-label': tip },
    h('span', { class: `ci-dot ci-${tone}`, 'aria-hidden': 'true' }), t(CI_SHORT[tone]));
}
const CI_SHORT = { run: 'ci_short_run', green: 'ci_short_green', red: 'ci_short_red', grey: 'ci_short_grey' } as const;
const commitLink = (p: { repo: string; sha: string }, cls = 'ci-ref') => {
  const url = commitUrl(p);
  return url ? h('a', { class: cls, href: url, target: '_blank', rel: 'noopener noreferrer' }, ciRef(p)) : h('code', { class: cls }, ciRef(p));
};
/** Header: the dot, the commit it is about (link to GitHub) and, while a CI runs, « Stop CI follow-up » (trusted humans). */
function ciHead(f: PublicThread) {
  const p = ciWorst(f.ci);
  if (!p || !modOn(f.space, 'ci')) return null;
  const stop = ciRunning(f.ci) && S.trusted.has(f.space)
    ? h('button', { class: 'btn ghost ci-stop', type: 'button', title: t('ci_stop_title'), onclick: () => send({ type: 'action', thread: f.id, kind: 'ci_stop' }) }, t('ci_stop')) : null;
  return h('span', { class: 'ci-head' }, ciDot(f), nontech(f.space) ? null : commitLink(p), stop); // not technical: the commit stays in the dot's tooltip
}
/** CI line (red, never finished, commit unknown): names as plain text (CI-written), links on github.com only. */
function ciLineEl(r: CiReport) {
  const { before, after } = ciLineParts(r);
  const head = h('p', {}, before, commitLink(r), after);
  const list = r.failed.length ? h('ul', { class: 'ci-list' }, ...r.failed.map(c => {
    const url = checkUrl(c.url);
    const name = h('code', {}, c.name);
    return h('li', {}, url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, name) : name, ` ${c.conclusion.replace(/_/g, ' ')}`);
  })) : null;
  const tail = ciLineTail(r);
  return h('div', { class: `md ci-line ci-${r.verdict}` }, head, list, tail.length ? h('p', { class: 'ci-tail' }, tail.join(' · ')) : null);
}

// LLM spend of the agent in this thread (every member sees it); token detail and status on hover.
/** Spend of the conversation: in the composer bar on a computer, so the header keeps its room; on a phone
 *  in the header line as before (`where` picks the copy style.css shows: crumb below 700 px, bar above). */
function costEl(f: PublicThread, where: 'crumb' | 'bar') {
  if (!f.usage) return null;
  const title = costTitle(f.usage, lang());
  return h('span', { class: `cost cost-${where}`, title, 'aria-label': title, tabindex: '0' }, costLabel(f.usage, lang()));
}
// ---------------------------------------------------------------- composer and the edit of the last message (client/src/composerview.ts)
const { editableComposer, voiceAgentOf, sendBtn, startEdit, stepStop, editHint, NO_AUTOFILL, touchOnly, onEnterSend, drafts, bindDraft } = composerModule(kitOf(), S, {
  rand, cap, iconBtn, keyed, costEl, openSecret, noteMentions, pendings, sendWait, pvOpen, openPreview, askVoice,
  paletteOn: () => P.open, profileOn: () => lg().profileOn(), viewerOn: () => !!vw.viewer });
/** Messages of a thread (keyed by id) and the "New messages ↓" pill, cleared once the reader reaches the bottom. */
function msgsEl(f: PublicThread, all: Message[]) {
  const notice = noticeAfter(S.undelivered, f.id, all.map(m => m.id));
  const scrolled = (e: Event) => { const el = e.currentTarget as HTMLElement; if (S.below === f.id && atBottom(el.scrollTop, el.scrollHeight, el.clientHeight)) { S.below = ''; render(); } };
  const u = S.loaded.has(f.id) ? unreadOf(f.id, all) : null;
  return h('div', { class: 'msgs', onscroll: scrolled, ...unreadAttrs(f.id, u) }, unreadPill(f.id, u),
    ...(S.loaded.has(f.id) ? [hasOlder(S.older, f.id) ? h('div', { class: 'older', 'data-k': 'older', 'data-thread': f.id }, t('ex_loading')) : null, ...all.flatMap(m => [m.id === u?.first && !u.more ? unreadSep() : null, editMark(flashed(keyed(messageEl(m, all, f), `m:${m.id}`), m.id), m.id), notice?.after === m.id ? undeliveredEl(notice.agent) : null]),
      notice && notice.after === null ? undeliveredEl(notice.agent) : null, ...voiceDraftEls(f), workingEl(f), bgWorkingEl(f), ...activityEls(f), ...browserEls(f)] : [h('div', { class: 'blank', 'data-k': 'blank' }, t('ex_loading'))]),
    S.below === f.id ? h('div', { class: 'pill-wrap down', 'data-k': 'pill:down' }, h('button', { class: 'btn pill', type: 'button', onclick: toBottom }, t('new_messages'), icon('arrowDown', 14) as unknown as Node)) : null);
}
/** The message being edited (or waiting for the agent's stop to be edited): highlighted in the list. */
function editMark<T extends Element | null>(el: T, id: string): T { if (el && S.editing?.msg === id) el.classList.add('editing'); return el; }
/** The message a search result opened: flashed once (style.css `.flash`). */
function flashed<T extends Element | null>(el: T, id: string): T { if (el && S.flash === id) el.classList.add('flash'); return el; }
/** The « New messages » line before the first unread message, and the pill that scrolls to it (`unreadAfter`). */
const unreadSep = () => h('div', { class: 'unread-sep', 'data-k': 'unread-sep', role: 'separator' }, h('span', {}, t('new_messages')));
const unreadAttrs = (id: string, u: UnreadMark | null) => u?.first ? { 'data-uid': id, 'data-more': u.more ? '1' : '0' } : {};
function unreadPill(id: string, u: UnreadMark | null) {
  if (!u?.n || pillOff.has(id)) return null;
  return h('div', { class: 'pill-wrap up unread-pill', 'data-k': 'pill:unread' }, h('button', { class: 'btn pill', type: 'button', onclick: () => { unreadJump = id; render(); } },
    icon('arrowUp', 14) as unknown as Node, u.more ? t('unread_up_more', { n: u.n }) : tn('unread_up', u.n)));
}
/** Bar feed: « N unread · M unread topics ↑/↓ » above the composer (rules: unreadfab.ts). A tap goes to the next target:
 *  the « New messages » line (paging back like the « ↑ N unread » pill of a topic) or the next unread topic card. */
function fabEl(gid: string, fab: ReturnType<typeof unreadFab>) {
  if (!fab) return null;
  const parts = [fab.msgs ? (fab.more ? t('unread_up_more', { n: fab.msgs }) : tn('unread_up', fab.msgs)) : '', fab.topics ? tn('fab_topics', fab.topics) : ''].filter(Boolean);
  const go = () => {
    const nx = fab.next;
    if (nx.kind === 'msgs') { pillOff.add(gid); unreadJump = gid; render(); return; }
    fabDone.add(nx.id); render();
    const sc = document.querySelector<HTMLElement>('.list.feed .feed-msgs'), card = sc?.querySelector<HTMLElement>(`[data-k="c:${nx.id}"]`);
    if (sc && card) { sc.scrollTop += card.getBoundingClientRect().top - sc.getBoundingClientRect().top - 8; card.classList.add('flash'); }
  };
  return h('div', { class: 'pill-wrap down unread-fab', 'data-k': 'fab:unread', 'data-next': fab.next.kind === 'msgs' ? 'unread-sep' : `c:${fab.next.id}`, 'data-dir': fabUp ? 'up' : 'down' },
    h('button', { class: 'btn pill', type: 'button', onclick: go }, parts.join(' · '), icon(fabUp ? 'arrowUp' : 'arrowDown', 14) as unknown as Node));
}
/** After a render or a scroll: point the pill's arrow at its next target (rule: `fabDir`), swapping the icon alone. */
function fabArrow(sc: HTMLElement) {
  const el = sc.querySelector<HTMLElement>(':scope > [data-k="fab:unread"]'), btn = el?.querySelector('button');
  if (!el || !btn) return;
  const target = sc.querySelector<HTMLElement>(`:scope > [data-k="${el.dataset.next}"]`)?.getBoundingClientRect() ?? null;
  const dir = fabDir(target, sc.getBoundingClientRect());
  fabUp = dir === 'up';
  if (el.dataset.dir === dir) return;
  el.dataset.dir = dir; btn.lastElementChild?.replaceWith(icon(fabUp ? 'arrowUp' : 'arrowDown', 14));
}
/** After a render: the pending jump to a marker (scrolled to once loaded, else the page above is asked: the conversation's
 *  history, or what the feed's top sentinel pages), and a marker in view retires its pill. */
function unreadAfter(app: Element) {
  for (const sc of app.querySelectorAll<HTMLElement>('[data-uid]')) {
    const id = sc.dataset.uid!, sep = sc.querySelector<HTMLElement>(':scope > [data-k="unread-sep"]'), top = sc.getBoundingClientRect().top;
    const off = () => { pillOff.add(id); sc.querySelector(':scope > [data-k="pill:unread"]')?.remove(); };
    if (unreadJump === id) {
      if (sep && sc.dataset.more !== '1') { unreadJump = ''; off(); sc.scrollTop += sep.getBoundingClientRect().top - top - 8; continue; }
      const feed = sc.classList.contains('feed-msgs');
      if (feed && feedLoad.space && (feedLoad.msgs || feedLoad.topics)) { if (feedLoad.topics) loadMore(feedLoad.space); if (feedLoad.msgs) loadOlder(id); }
      else if (!feed && hasOlder(S.older, id)) loadOlder(id);
      else { unreadJump = ''; off(); sc.scrollTop = 0; } // not found (deleted?): the top is the closest
    } else if (sep && sc.querySelector(':scope > [data-k="pill:unread"]') && sepInView(sc, sep)) off();
  }
}
/** Unread topic cards fully on screen count as reached by the floating pill, like its « New messages » line (Blair,
 *  Nov 7: « 1 active topic ↓ » showed for a topic just opened under his eyes, the feed at the bottom). True = one added. */
function fabSeen(sc: HTMLElement): boolean {
  const a = sc.getBoundingClientRect(); let added = false;
  for (const c of sc.querySelectorAll<HTMLElement>(':scope > [data-k^="c:"]')) {
    const id = c.dataset.k!.slice(2), f = S.threads.get(id), r = c.querySelector(':scope > .fc-att')?.getBoundingClientRect();
    if (!f || !r || fabDone.has(id) || !topicCardWhen(f, unread).unread) continue;
    if (r.top >= a.top - 1 && r.bottom <= a.bottom + 1) { fabDone.add(id); added = true; }
  }
  return added;
}
/** Cards just seen: redraw the pill alone, not the page (a render would drop the `flash` of a card just jumped to). */
function fabRefresh(sc: HTMLElement) {
  const old = sc.querySelector(':scope > [data-k="fab:unread"]');
  if (!old || !fabLast || !fabSeen(sc)) return;
  const el = fabEl(fabLast.gid, unreadFab(fabLast.u, pillOff.has(fabLast.gid), fabLast.topics, fabDone));
  if (el) old.replaceWith(el); else old.remove();
}
const sepInView = (sc: Element, sep: Element) => { const a = sc.getBoundingClientRect(), r = sep.getBoundingClientRect(); return r.bottom > a.top && r.top < a.bottom; };
// Scrolling a marker into view retires its pill (no render: nothing else changes). In the Bar feed it counts the Bar's
// messages as reached in the floating pill (a render, to update its count). Scroll events only: the first render of a
// feed sits at the top for a moment before going to the bottom, and that must not count.
document.addEventListener('scroll', e => {
  const sc = e.target;
  if (sc instanceof HTMLElement && sc.matches('.list.feed .feed-msgs')) { fabRefresh(sc); fabArrow(sc); }
  if (!(sc instanceof HTMLElement) || !sc.dataset.uid || unreadJump === sc.dataset.uid) return;
  const sep = sc.querySelector(':scope > [data-k="unread-sep"]'), pill = sc.querySelector(':scope > [data-k="pill:unread"]');
  if (sep && pill && sepInView(sc, sep)) { pillOff.add(sc.dataset.uid); pill.remove(); }
  else if (sep && !pillOff.has(sc.dataset.uid) && sc.classList.contains('feed-msgs') && sepInView(sc, sep)) { pillOff.add(sc.dataset.uid); render(); }
}, true);
function toBottom() { S.below = ''; const m = document.querySelector('.conv .msgs'); if (m) m.scrollTop = m.scrollHeight; render(); }
function keyed<T extends Element | null>(el: T, k: string): T { el?.setAttribute('data-k', k); return el; }
/** List card: keyed by thread (moved, not rewritten, when the order changes), `data-at` = its sort time (New ↑ pill). */
function cardKey(f: PublicThread, at: number) { return { 'data-k': `c:${f.id}`, 'data-at': at }; }
/** "New ↑" pill at the top of a list pane, cleared once the reader is back at the top. */
function listPill(pane: HTMLElement, key: string) {
  const sc = pane.querySelector('.scroll') as HTMLElement | null;
  if (!sc) return;
  on(sc, 'scroll', () => { if (S.above === key && sc && cur(sc).scrollTop <= NEAR) { S.above = ''; render(); } });
  if (S.above === key) sc.prepend(h('div', { class: 'pill-wrap up', 'data-k': 'pill:up' }, h('button', { class: 'btn pill', type: 'button',
    onclick: () => { S.above = ''; cur(sc).scrollTop = 0; render(); } }, t('new_items'), icon('arrowUp', 14) as unknown as Node)));
}
/** Cards of a list pane in order: [key, sort time]. */
function cardsOf(el: Element | null): [string, string][] { return [...(el?.querySelectorAll('[data-k][data-at]') ?? [])].map(c => [c.getAttribute('data-k')!, c.getAttribute('data-at')!]); }
// View change (route, a detail opened): drawn inside a View Transition (motion.ts), so render() is then asynchronous
// for one frame; renders asked meanwhile are folded into it (it draws the latest state). Automated browsers keep
// synchronous navigation: test/ui-render.py asserts right after a click (its motion step lifts `webdriver`).
let shownScreen: Screen | null = null, vtWait = false;
const screenNow = (): Screen => {
  const detail = mem().detail() || rd().detail() || ex().detail() || (S.info && S.sel ? 'info' : '');
  return { key: `${routeOf(S.view, S.sel)}|${detail}`, depth: S.sel || detail ? 1 : 0 };
};
function render() {
  if (vtWait) return;
  const dir = lg().signingIn() ? null : vtDir(shownScreen, screenNow());
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
  if (dir && doc.startViewTransition && !reduced() && !navigator.webdriver) {
    const root = document.documentElement;
    vtWait = true; root.dataset.vt = dir;
    try {
      doc.startViewTransition(() => { vtWait = false; draw(); }).finished.catch(() => {}).finally(() => { if (root.dataset.vt === dir) delete root.dataset.vt; });
      return;
    } catch { vtWait = false; delete root.dataset.vt; }
  }
  draw();
}

// Motion of what the patch inserted or relit (rules in motion.ts). A message or card arrives only next to messages or
// cards already on screen: the first page of a conversation loaded after its pane is not an arrival.
function moved(ch: Change) {
  const xs: { el: Element; kind: Kind }[] = [], added = new Set(ch.added);
  const item = (e: Element) => /^[mc]:/.test(e.getAttribute('data-k') ?? '');
  for (const el of ch.added) {
    const kind = insertedKind(el.getAttribute('data-k'), el.localName, el.parentElement?.getAttribute('class') ?? '');
    if (kind && (kind !== 'arrive' || [...el.parentElement!.children].some(c => !added.has(c) && item(c)))) xs.push({ el, kind });
  }
  for (const { el, was } of ch.restyled) { const kind = litKind(el.localName, was, el.getAttribute('class') ?? ''); if (kind) xs.push({ el, kind }); }
  play(capBursts(xs));
}

function draw() {
  syncWatch();
  if (lg().signingIn()) { shownScreen = null; patch(document.getElementById('app')!, lg().loginView()); return; }
  freezeMarks();
  markSeen();
  // `#/<space>/overview` without a board (checkable once the space is synced): space view, without a history entry.
  if (S.view.kind === 'overview' && S.github.has(S.view.id) && !hasBoard(S.github.get(S.view.id), S.repos.get(S.view.id))) {
    S.view = { kind: 'space', id: S.view.id }; S.sel = null;
    lastRoute = routeOf(S.view, null); history.replaceState(null, '', lastRoute);
  }
  // View of a module turned off (old link, open tab): the space's threads, without a history entry.
  if (S.view.kind in VIEW_MODULE && 'id' in S.view && !viewOn(S.view.kind, modsOf(S.view.id))) {
    S.view = { kind: 'space', id: S.view.id }; S.sel = null;
    lastRoute = routeOf(S.view, null); history.replaceState(null, '', lastRoute);
  }
  syncUrl(); SC.seen(S.sel);
  const pv = pvOpen();
  if (pv && routeOf(S.view, S.sel) !== pv.route) closePreview(); else pvBar(); // navigated away (Back): the preview stops
  remember(lastConv, S.view, S.sel);
  if (posted && (S.sel !== posted || (S.view.kind !== 'later' && S.view.kind !== 'closed'))) posted = ''; // left it: forget
  const nYours = yourTurnCount();
  document.title = tabTitle(nYours);
  // App icon badge: same total, once every space is synced (a partial count would undo the service worker's badge).
  if (nYours !== lastBadge && S.mySpaces && [...S.mySpaces].every(s => B.synced.has(s))) { lastBadge = nYours; void setBadge(navigator as BadgeNav, nYours); }
  const v = S.view;
  st().route(v, ws?.readyState === WebSocket.OPEN); // Settings (client/src/settingsview.ts)
  // The new tree is diffed into the page (patch.ts): unchanged nodes stay, hence scroll, selection, focus and caret.
  // Panes are keyed by route: another list or thread = a fresh pane (top of the list, bottom of the thread).
  const app = document.getElementById('app')!;
  const paneKey = `p:${routeOf(v, null)}`, isList = v.kind === 'now' || v.kind === 'space' || v.kind === 'lounge' || v.kind === 'later' || v.kind === 'closed';
  const oldPane = app.querySelector('.shell > [data-k^="p:"]');
  const oldSc = oldPane?.getAttribute('data-k') === paneKey ? oldPane.querySelector('.scroll') as HTMLElement | null : null;
  const feedA = oldPane?.getAttribute('data-k') === paneKey ? feedAnchor(oldPane.querySelector('.feed-msgs')) : null;
  const seenCards = new Map(cardsOf(oldSc)), firstSeen = oldSc && oldSc.scrollTop > NEAR ? firstVisible(oldSc) : null;
  // Conversation: follow the bottom on open or when already there; scrolled up, a new message shows the pill instead.
  // Pinned applet (`#/<space>/applets/<id>`, client/src/pinapp.ts): the applet alone, full screen; a conversation opened
  // from it shows inside it (pinConv), never the rest of briefling.
  const pin = v.kind === 'applets' ? v.pin : undefined;
  if (!pin) pinHead(null);
  const th = (isList || pin) && S.sel && S.threads.has(S.sel) ? S.sel : '';
  const oldMsgs = app.querySelector('.conv .msgs') as HTMLElement | null;
  const count = th && S.loaded.has(th) ? S.msgs.get(th)?.size ?? 0 : -1;
  const jumping = !!th && S.jump?.thread === th;
  const plan = jumping ? 'keep' : th ? convPlan({ opened: th !== S.shown.thread || S.shown.count < 0, grew: count > S.shown.count, older: S.prepended === th,
    wasAtBottom: !oldMsgs || atBottom(oldMsgs.scrollTop, oldMsgs.scrollHeight, oldMsgs.clientHeight) }) : 'keep';
  S.prepended = '';
  // Older page put above: the same distance from the bottom after the patch = the same message under the reader's eyes.
  const fromBottom = plan === 'anchor' && oldMsgs ? oldMsgs.scrollHeight - oldMsgs.scrollTop : -1;
  if (plan === 'pill') S.below = th; else if (plan === 'bottom') S.below = '';
  S.shown = { thread: th, count };
  // Another conversation (or none) on screen: the edit is cancelled. The Comptoir feed has its own composer (General).
  if (S.editing && S.editing.thread !== th && S.editing.thread !== shownGeneral()?.id) S.editing = null;
  if (vw.viewer && vw.viewer.thread !== th) vw.viewer = null;           // the viewer belongs to its conversation
  if (S.editing?.phase === 'stopping') stepStop(S.editing);
  // Metrics: computed by the hub on demand, asked on every entry and period change (never polled).
  if (v.kind === 'metrics') mx().entered(v.id, ws?.readyState === WebSocket.OPEN);
  else mx().left();
  // Board flow block: closed tasks asked on every entry (live states come with synced and flowstate.updated).
  if (v.kind === 'overview' && S.driver.get(v.id) === 'board') { if (flowFor !== v.id && ws?.readyState === WebSocket.OPEN) { flowFor = v.id; ws.send(JSON.stringify({ v: 2, type: 'flowstate.get', client_id: rand().slice(0, 20), space: v.id })); } }
  else flowFor = '';
  // Flow: same, computed on demand on every entry and period change.
  if (v.kind === 'lineage') lin().entered(v.id, ws?.readyState === WebSocket.OPEN);
  else lin().left();
  // Radar: listed by the hub on every entry, then kept up to date by `radar.updated` (never polled).
  if (v.kind === 'radar') rd().entered(v.id, ws?.readyState === WebSocket.OPEN, spaceAdmin(v.id));
  else rd().left();
  // Applets: listed on every entry (leads), then by the answer of each save, delete or run.
  if (v.kind === 'applets') ap().entered(v.id, ws?.readyState === WebSocket.OPEN, v.pin);
  else ap().left();
  // Exchanges: listed on every entry, then kept up to date by `exchange.updated` / `exchange.removed` (never polled).
  if (v.kind === 'exchanges') ex().entered(v.id, ws?.readyState === WebSocket.OPEN);
  else ex().left();
  // Workflow editor: read on every entry (latest version + history), older versions on demand.
  if (v.kind === 'workflow' || (v.kind === 'settings' && S.adm?.spaces.find(s => s.id === v.id)?.board)) {
    wf().entered(v.id, ws?.readyState === WebSocket.OPEN && spaceAdmin(v.id)); }
  else wf().left();
  const mv = modViewOf(v), shownMod = mv ? `${mv.kind}:${mv.id}` : '';
  if (modShown && modShown !== shownMod) mods().find(m => modShown.startsWith(`${m.view}:`))?.leave?.();
  modShown = shownMod;
  const mid = pin && S.sel && v.kind === 'applets' ? keyed(ap().pinConv(v.id, pin, conv(), back), `v:${routeOf(v, S.sel)}`) : keyed(mv ? modView(mv.kind).el(mv.id) : v.kind === 'overview' ? overview(v.id) : v.kind === 'metrics' ? mx().el(v.id) : v.kind === 'lineage' ? lin().el(v.id) : v.kind === 'radar' ? rd().el(v.id) : v.kind === 'applets' ? ap().appletsView(v.id) : v.kind === 'exchanges' ? ex().el(v.id) : v.kind === 'workflow' ? wf().el(v.id) : v.kind === 'settings' || v.kind === 'newspace' ? st().el() : list(), paneKey);
  if (S.above !== paneKey) S.above = '';
  if (isList) { if (newAbove(seenCards, cardsOf(mid), firstSeen)) S.above = paneKey; listPill(mid, paneKey); }
  // Narrow screens (style.css @media): one pane at a time (`pane-*`), sidebar as a drawer over a scrim.
  // Recents: a column on the right of a wide screen (the info pane steps aside meanwhile), a bottom sheet on a phone.
  const rcSpace = v.kind === 'now' || v.kind === 'newspace' ? undefined : v.id, docked = rc().docked(rcSpace);
  const infoOf = isList && S.info && S.sel && !docked ? S.threads.get(S.sel) : undefined, info = infoOf && infoOf.kind !== 'topic' ? infoOf : null;
  // Lounge without a selection: the feed alone (full width above 700 px, the list pane on a phone), no right pane.
  const right = isList && !(v.kind === 'lounge' && !S.sel);
  // Resizable columns (client/src/panes.ts): a grip per column edge, widths as CSS variables on <html>.
  const cols: PaneLayout = { lounge: loungeLayout(v, S.sel), list: isList, info: !!info, recents: docked };
  const ch = patch(app, h('div', { class: pin ? 'shell pinapp' : `shell pane-${paneOf(isList, S.sel)} ${cols.lounge} ${S.drawer ? 'drawer' : ''} ${info ? 'info' : ''} ${docked ? 'recents' : ''}` },
    ...(pin ? [mid] : [side(), mid, right ? keyed(conv(), `v:${routeOf(v, S.sel)}`) : null, info ? keyed(infoPane(info), `i:${info.id}`) : null, rc().pane(rcSpace), ...grips(cols, h)]),
    S.drawer ? h('div', { class: 'scrim', 'data-k': 'scrim', onclick: () => { S.drawer = false; render(); } }) : null, sheet(), P.open ? paletteEl() : null, SC.el(), lg().profileOn() ? lg().profileDialog() : null, secretDlg ? secretDialog() : null, SU?.dialog() ?? null, vw.viewer ? viewerEl() : null, netbar() ?? updatebar() ?? SU?.bar() ?? agentbar(), askBanner()));
  shownScreen = screenNow();
  applyCols(cols);
  moved(ch);
  growAll(app); // composer height (no field-sizing): before the scroll restores below
  voiceDock(app);
  feedRestore(app.querySelector('.list.feed .feed-msgs'), feedA);
  if (feedJump) { // the card may be older than the loaded page: then the feed simply stays at the bottom
    const el = app.querySelector(`.list.feed .feed-msgs > [data-k="c:${CSS.escape(feedJump)}"]`);
    feedJump = '';
    if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); window.setTimeout(() => el.classList.remove('flash'), 2600); }
  }
  if (plan === 'bottom') { const m = app.querySelector('.conv .msgs'); if (m) m.scrollTop = m.scrollHeight; }
  if (fromBottom >= 0) { const m = app.querySelector<HTMLElement>('.conv .msgs'); if (m) pinScroll(m, m.scrollHeight - fromBottom); }
  // Loaded only: a live message (an alert's) can sit in S.msgs before the history, its element not drawn yet.
  if (jumping && S.jump && S.loaded.has(th) && S.msgs.get(th)?.has(S.jump.msg)) {
    const id = jumpTarget(S.msgs.get(th)!.values(), S.jump.msg), el = app.querySelector(`.conv .msgs [data-k="m:${CSS.escape(id)}"]`);
    S.jump = null;
    if (el) {
      el.scrollIntoView({ block: 'center' }); S.flash = id; el.classList.add('flash');
      window.setTimeout(() => { if (S.flash === id) { S.flash = ''; render(); } }, 2600);
    }
  }
  unreadAfter(app);
  // A topic arriving at the bottom of a feed read to its end is seen as it comes (the pill must not point at it).
  const fsc = app.querySelector<HTMLElement>('.list.feed .feed-msgs');
  if (fsc?.clientHeight && atBottom(fsc.scrollTop, fsc.scrollHeight, fsc.clientHeight)) fabRefresh(fsc);
  if (fsc) fabArrow(fsc);
  keepBottoms(app);
  watchMore();
  watchOlder();
  rc().watch();
  watchFeed();
  bootTick();
}
/** Key of the first card visible in a scrolled list. */
function firstVisible(sc: Element) {
  const top = sc.getBoundingClientRect().top;
  for (const c of sc.querySelectorAll('[data-k][data-at]')) if (c.getBoundingClientRect().bottom > top + 1) return c.getAttribute('data-k');
  return null;
}
setInterval(render, 60_000); // relative timestamps
// A conversation scroller that changes size (keyboard, the iOS autofill bar sliding in after it, the composer growing)
// keeps a reader who was at the bottom at the bottom. Chromium does it by scroll anchoring, Safari has none: the last
// message slid under the composer on focus. The bottom state is the one of the last scroll, read before the change.
// Same for an image loading late (`stickToBottom`, composerview.ts), in a thread and in the Lounge feed.
const atEnd = new WeakMap<Element, boolean>();
// scrollTop we wrote to re-stick: its scroll event comes a frame later, when another image may have grown the content
// already; it must not be read as the reader leaving the bottom.
const stuckAt = new WeakMap<Element, number>();
function keepAtEnd(el: Element) {
  const v = atEnd.get(el);
  if (v) { el.scrollTop = el.scrollHeight; stuckAt.set(el, el.scrollTop); }
  return v !== undefined;
}
const sizeKeeper = new ResizeObserver(es => {
  for (const e of es) { const el = e.target as HTMLElement; if (!el.isConnected) sizeKeeper.unobserve(el); else keepAtEnd(el); }
});
document.addEventListener('scroll', e => {
  const el = e.target;
  if (el instanceof HTMLElement && atEnd.has(el) && stuckAt.get(el) !== el.scrollTop) atEnd.set(el, atBottom(el.scrollTop, el.scrollHeight, el.clientHeight));
}, true);
function keepBottoms(app: Element) {
  for (const el of app.querySelectorAll('.conv .msgs, .list.feed .feed-msgs')) {
    if (!atEnd.has(el)) sizeKeeper.observe(el);
    atEnd.set(el, atBottom(el.scrollTop, el.scrollHeight, el.clientHeight));
  }
}
// Virtual keyboard: the shell follows the visual viewport (style.css `--vvh`, narrow screens only), so the composer
// stays right above the keyboard where the browser doesn't resize the page itself (iOS Safari); a conversation read
// at the bottom stays at the bottom. CSSOM property, not a style attribute: allowed by the CSP. Ignored while zoomed.
// Never taller than the window: iOS (installed app) can keep a stale, too-big visual viewport height after the keyboard
// or a return from the background, and a shell taller than the screen stops `.msgs` scrolling and hides the composer.
// So the height is also recomputed on the way back to the app, on rotation and when the keyboard closes, then once more
// a moment later (iOS reports the final size after the event).
const vv = window.visualViewport;
if (vv) {
  const fit = () => {
    if (vv.scale > 1.01) return;
    const m = document.querySelector('.conv .msgs') as HTMLElement | null, stick = !!m && atBottom(m.scrollTop, m.scrollHeight, m.clientHeight);
    const h = Math.round(Math.min(vv.height, window.innerHeight));
    tallest.set(window.innerWidth, Math.max(h, tallest.get(window.innerWidth) ?? 0));
    document.documentElement.style.setProperty('--vvh', `${h}px`);
    kbd(narrow() && keyboardUp({ typing: typing(), height: h, tallest: tallest.get(window.innerWidth) ?? 0 }));
    if (stick) m!.scrollTop = m!.scrollHeight;
    unpan();
  };
  // Phone keyboard up: the `kb-up` class compacts the conversation header and hides the « X is waiting on you » banner
  // and the Summary (style.css), so the keyboard leaves room for the messages (one line was left).
  // Removed a moment after the blur, not at once: the tap that left the field must land on the button it aimed at,
  // not on what slid under the finger when the header came back.
  let kbdOff = 0;
  const kbd = (on: boolean) => {
    const root = document.documentElement;
    clearTimeout(kbdOff);
    if (on) root.classList.add('kb-up');
    else if (root.classList.contains('kb-up')) kbdOff = window.setTimeout(() => { if (!typing()) { root.classList.remove('kb-up'); fit(); } }, 250);
  };
  // Tallest visible height seen per window width (rotation = its own case), to tell a shell stuck at the keyboard height.
  const tallest = new Map<number, number>();
  const typing = () => { const a = document.activeElement; return !!a && (a.matches('input, textarea, select') || (a as HTMLElement).isContentEditable); };
  // Back in the app with the keyboard gone but the height still shrunk (viewportStuck): hide and show #app with a forced
  // reflow in between, which makes WebKit measure the viewport again (WebKit bug 237961; same fix: dev.to « Fixing the
  // iOS standalone-PWA keyboard bug that shrinks your viewport »). display:none drops the scroll positions: keep them.
  const heal = () => {
    fit();
    if (vv.scale > 1.01 || !viewportStuck({ typing: typing(), height: Math.round(Math.min(vv.height, window.innerHeight)), tallest: tallest.get(window.innerWidth) ?? 0 })) return;
    const app = document.getElementById('app');
    if (!app) return;
    const kept = [...app.querySelectorAll<HTMLElement>('*')].filter(e => e.scrollTop > 0).map(e => [e, e.scrollTop] as const);
    app.style.display = 'none';
    void app.offsetHeight;
    app.style.display = '';
    for (const [e, top] of kept) e.scrollTop = top;
    fit();
  };
  // Return to the app: re-read the height a few times (grappa-irc #649: the final size can come after 300 ms).
  const wake = () => { fit(); for (const ms of WAKE_MS) setTimeout(heal, ms); };
  // iOS pans the page on focus to lift the field above the keyboard, sometimes after the resize: undo it whenever it
  // shows up (`scroll` of the visual viewport), else the shrunk shell stays shifted up and the screen shows the void
  // under it, the composer stuck at the top (pagePanned).
  const unpan = () => { if (pagePanned({ scale: vv.scale, offsetTop: vv.offsetTop, scrollY: window.scrollY })) window.scrollTo(0, 0); };
  const refit = () => { fit(); setTimeout(fit, 300); };
  vv.addEventListener('resize', fit);
  vv.addEventListener('scroll', unpan);
  window.addEventListener('focusin', refit);
  window.addEventListener('resize', fit);
  window.addEventListener('pageshow', wake);
  window.addEventListener('focus', wake);
  window.addEventListener('focusout', refit);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wake(); });
  fit();
}

await handleCallback();
applyRoute(location.hash);
await takeNotifTarget();
bootTick(); // starts the hub TIMEOUT even if the token or the socket never gets to a render()
await conn.start();
