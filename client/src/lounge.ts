// Card of a topic in the Lounge list, DOM-free (tested by node): who started it and which text to show.
import { generalId, isGeneralId, type Message, type PublicThread } from '../../protocol/frames.ts';
import { t } from './i18n.ts';

export interface LoungeCard { heading: string | null; text: string; author: { id: string; name: string; agent?: true } | null }

/** Name of a topic wherever it is cited (header, « from » links): its title when it has one, else its short title. */
export const topicName = (f: Pick<PublicThread, 'heading' | 'title'>): string => f.heading?.text ?? f.title;

/**
 * Heading = the topic's title (agent in charge or a lead), shown in bold above a shorter text; null until it lands.
 * Text = first message kept by the hub (`text`); a topic older than this field falls back to its title (80 characters).
 * Author missing (older topic, not yet filled by the topics backfill script in scripts/): no avatar.
 * Author who left the space: "A member"; oneself: one's name, "You" if it is not known (as in a thread).
 * Opened by an agent on its own (`authorAgent`, a cron's report): the agent, named like its messages (id capitalised).
 */
export function loungeCard(f: PublicThread, me: string, nameOf: (id: string) => string | null): LoungeCard {
  const text = f.text ?? f.title, heading = f.heading?.text || null;
  if (!f.author) return { heading, text, author: null };
  if (f.authorAgent) return { heading, text, author: { id: f.author, name: f.author[0].toUpperCase() + f.author.slice(1), agent: true } };
  return { heading, text, author: { id: f.author, name: nameOf(f.author) ?? (f.author === me ? t('you') : t('a_member_cap')) } };
}

// ---------------------------------------------------------------- General (one flat room per space, top of the Lounge)
/** The space's General room: never a topic of the list, never counted, never pinned/archived/renamed. */
export const isGeneral = (f: Pick<PublicThread, 'id' | 'general'>): boolean => !!f.general || isGeneralId(f.id);

/** Topics listed in the Lounge of `space` (list, unread counter): live, General excluded, last activity first. */
export function loungeTopics(all: Iterable<PublicThread>, space: string): PublicThread[] {
  return [...all].filter(f => f.space === space && f.kind === 'topic' && !f.archived && !isGeneral(f)).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** General of `space` once the hub created it (its first post); null before: the client still shows the row and the room. */
export const generalOf = (all: ReadonlyMap<string, PublicThread>, space: string): PublicThread | null => all.get(generalId(space)) ?? null;

/** Stand-in for a General not created yet: same shape as the real room, so the view renders the same way. */
export const generalStub = (space: string): PublicThread =>
  ({ id: generalId(space), space, title: '', owner: '-', kind: 'topic', general: true, state: 'calm', updatedAt: 0, version: 0 });

/** Link under a General message to its topic, with the signals of that topic's row in the Lounge list (same sources). */
export interface SubtopicLink {
  id: string;
  /** Topic name once loaded, else null (generic label, no signal: nothing is known yet). */
  name: string | null;
  /** Bold, as the list row: the caller's unread rule. */
  unread: boolean;
  /** « agent at work » chip, shown by the list only when `state === 'run'`. */
  working: boolean;
  /** Threads opened from the topic (`spawned`); 0 = no « → N threads ». */
  threads: number;
  /** Last activity (`updatedAt`), null when unknown. */
  at: number | null;
}
export function subtopicLink(m: Pick<Message, 'subtopic'>, get: (id: string) => PublicThread | undefined, unread: (f: PublicThread) => boolean = () => false): SubtopicLink | null {
  if (!m.subtopic) return null;
  const f = get(m.subtopic);
  if (!f) return { id: m.subtopic, name: null, unread: false, working: false, threads: 0, at: null };
  return { id: m.subtopic, name: topicName(f), ...topicActivity(f, unread), working: f.state === 'run', threads: f.spawned?.length ?? 0 };
}

/** Last activity of a topic, as its card and the « → topic » link under a Bar message show it: the time, and whether
 *  it is unread (dot + time in the Your-turn colour). No known time (0) = no time and never unread: nothing to point at. */
export type TopicActivity = { at: number | null; unread: boolean };
export function topicActivity<T extends Pick<PublicThread, 'updatedAt'>>(f: T, unread: (f: T) => boolean): TopicActivity {
  const at = f.updatedAt || null;
  return { at, unread: at !== null && unread(f) };
}
/** The topic card's title line: a working topic keeps the dot but drops the time, its « X working » chip already says
 *  « now », and chip + time leave no room for the title on a 250 px list card. */
export function topicCardWhen<T extends Pick<PublicThread, 'updatedAt' | 'state'>>(f: T, unread: (f: T) => boolean): TopicActivity {
  const a = topicActivity(f, unread);
  return f.state === 'run' ? { ...a, at: null } : a;
}

/** Topic opened from a General message: its header links back to General. */
export const fromGeneral = (f: Pick<PublicThread, 'from'>): boolean => isGeneralId(f.from);

/** Where a topic header links to its origin. Born from a Bar message: the « {space} Bar » crumb itself (a separate
 *  « from the Bar » link would repeat it: same word, same icon, same place). Born from another topic or a thread: a
 *  « from X » link, which names something the crumb does not. Opened with « + Topic », or parent not synced: none. */
export type TopicOrigin = { at: 'crumb' } | { at: 'from'; parent: PublicThread } | null;
export function topicOrigin(f: Pick<PublicThread, 'from'>, get: (id: string) => PublicThread | undefined): TopicOrigin {
  if (fromGeneral(f)) return { at: 'crumb' };
  const parent = f.from ? get(f.from) : undefined;
  return parent ? { at: 'from', parent } : null;
}

/** Screen when « Reply as topic » was sent: the Lounge of `space` (null elsewhere) and the open conversation then. */
export type SubtopicOrigin = { space: string | null; sel: string | null };
/** Whether the ack of « Reply as topic » opens the new topic: yes while the user is still on the Lounge he sent it from
 *  with the same conversation open (none in the « All » feed, General's room, or a topic in the wide right pane);
 *  no once he went elsewhere or opened something else meanwhile. */
export function subtopicOpens(sent: SubtopicOrigin, view: { kind: string; id?: string }, sel: string | null): boolean {
  return !!sent.space && view.kind === 'lounge' && view.id === sent.space && sel === sent.sel;
}
