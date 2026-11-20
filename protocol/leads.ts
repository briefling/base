// Pending leads of a space (« pistes en attente »): when a thread closes, the lines « Next » its summary
// gives to an agent and that nobody opened become leads of the space, stored by the hub (hub/src/leads.ts), listed and
// deletable in the Leads view (client/src/leadsview.ts). When a new topic or thread starts on the same subject, its
// agent gets the closest one in its context, once, and mentions it in one line (« we had talked about it »), with an
// Open button under its message. Noise is the real risk: the threshold is strict and a lead is recalled only once.
// Pure: shared by the hub (capture, matching), the client (who a line is for, the view) and the tests.
import type { Person } from './frames.ts';

export const LEADS_MAX = 200;           // per space: the oldest leads go first past it
export const LEAD_TEXT_MAX = 2000;      // the line as the summary wrote it (summary lines are short)
export const RECALL_MAX = 2;            // leads recalled at a conversation's start, at most
/** Strict threshold, measured on the prod data (docs/project-status.md « Pending leads »): at least this many shared words… */
export const MATCH_MIN_WORDS = 3;
/** …covering at least this share of the lead's own words. */
export const MATCH_MIN_SHARE = 0.4;
/** The conversation text the recall reads: its title and its first message, cut there. */
export const RECALL_TEXT_MAX = 3000;

/** A lead: a line « Next » for an agent, left unopened when its thread closed. Id = its origin thread + a hash of the
 *  line: the same line captured twice (closed, reopened, closed) stays one lead. */
export interface Lead {
  id: string; space: string;
  /** The closed thread it comes from, its title and its agent then (who gets the thread when it is opened). */
  from: string; fromTitle: string; agent: string;
  who: string; what: string; at: number;
  /** Recalled once, at the start of this conversation: never again. */
  recalled?: { thread: string; at: number };
  /** The tags of its closed thread (`Thread.tags`), copied when it is saved; `[]` = none. Absent on leads saved before
   *  Nov 18 until `lead.list` fills them in once. */
  tags?: string[];
  /** The Lounge topic it is being discussed in (`lead.open`), set just before the lead leaves the list. */
  topic?: string;
  version: number;
}

export type StepKind = 'agent' | 'human';
const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
/** What the summary model writes for « the agent » without its name (« Agent », « l'agent », « the agent »). */
const GENERIC_AGENT = new Set(['agent', "l'agent", 'the agent', 'ia', 'ai']);

/**
 * Who a line is for, from its `who` as the summary model wrote it: an agent of the space (its name, or « Agent »), a
 * human of the space (name or first name, accents and case ignored). Null when nobody or both match (« Blair and
 * the agent », a homonym): no button rather than the wrong one, and no lead.
 */
export function stepKind(who: string, people: readonly Pick<Person, 'id' | 'name' | 'kind' | 'gone'>[]): StepKind | null {
  const w = norm(who);
  if (!w) return null;
  if (GENERIC_AGENT.has(w)) return 'agent';
  const names = (p: Pick<Person, 'id' | 'name'>) => { const n = norm(p.name), id = norm(p.id); return [n, n.split(' ')[0], id] };
  const hit = (k: Person['kind']) => people.some(p => p.kind === k && !p.gone && names(p).includes(w));
  const agent = hit('agent'), human = hit('human');
  return agent === human ? null : agent ? 'agent' : 'human';
}

// Words that say nothing about the subject of a line: common French and English words, and the vocabulary every
// briefling conversation shares (thread, step, plugin, deploy…). Measured on prod (docs/project-status.md « Pending leads »): without the
// second half, « sortir … de main.ts » or « briefling space routine » matched unrelated conversations.
const STOP = new Set(('alors aussi autre autres avec avoir bien cela cest celle cette comme dans depuis donc elle elles encore '
  + 'entre etre fait faire faut leur leurs mais meme mettre moins notre nous pour plus quand quel quelle quels sans selon '
  + 'seulement sont tout tous toute toutes tres vers votre vous ceux chaque ainsi apres avant deja ensuite pendant puis sous '
  + 'etait sera peut veut dire voir afin lors juste trop quoi voila merci fois rien chose choses partir cote '
  + 'about also been could from have here into just like make more need only over some than that them then there these '
  + 'they this very want what when where which will with would your each other those were being does done after before '
  + 'under then once again still deux trois quatre '
  + 'chantier chantiers sujet sujets thread threads topic topics agent agents etape etapes step steps plan plans '
  + 'prochain prochaine next verifier check tester test tests valider demande demander proposer propose ouvrir open '
  + 'sortir extraire move split refacto module modules client hub main router plugin gateway profil profils '
  + 'briefling space spaces').split(' '));

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
/** Words of a text that say what it is about: folded, 4+ letters, no number, no common word, plural cut, first 6 letters
 *  (« vulnérabilités » and « vulnérabilité » are one word, so are « routine » and « routines »). */
export function leadWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of fold(text.replace(/@[\w.-]+/g, ' ').replace(/https?:\/\/\S+/g, ' ')).split(/[^a-z0-9]+/)) {
    if (w.length < 4 || /^\d+$/.test(w) || STOP.has(w)) continue;
    const s = w.length > 4 && /[sx]$/.test(w) ? w.slice(0, -1) : w;
    if (!STOP.has(s)) out.add(s.slice(0, 6));
  }
  return out;
}

/** How close a lead is to a conversation's text: the shared words, null below the strict threshold. */
export function leadMatch(lead: string | Set<string>, text: string | Set<string>): { words: number; share: number } | null {
  const a = typeof lead === 'string' ? leadWords(lead) : lead, b = typeof text === 'string' ? leadWords(text) : text;
  if (!a.size) return null;
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  const share = n / a.size;
  return n >= MATCH_MIN_WORDS && share >= MATCH_MIN_SHARE ? { words: n, share } : null;
}

/** The leads to recall at a conversation's start: not recalled yet, not from this conversation, above the threshold,
 *  best first (more shared words, then a larger share, then the most recent), RECALL_MAX at most. */
export function recallLeads(leads: readonly Lead[], text: string, self: string): Lead[] {
  const b = leadWords(text.slice(0, RECALL_TEXT_MAX));
  return leads.filter(l => !l.recalled && l.from !== self).map(l => ({ l, m: leadMatch(l.what, b) }))
    .filter((x): x is { l: Lead; m: { words: number; share: number } } => !!x.m)
    .sort((x, y) => y.m.words - x.m.words || y.m.share - x.m.share || y.l.at - x.l.at).slice(0, RECALL_MAX).map(x => x.l);
}

/** Stable id of a lead: its origin thread and a short hash (FNV-1a, 32 bits) of the line. */
export function leadId(from: string, what: string): string {
  let h = 0x811c9dc5;
  for (const c of what) { h ^= c.codePointAt(0)!; h = Math.imul(h, 0x01000193) >>> 0; }
  return `${from}-${h.toString(36)}`;
}
