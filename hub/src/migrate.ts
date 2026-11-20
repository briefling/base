// English rename of the stored data (protocol v2): pure transform of one DynamoDB item, used by
// scripts/migrate-english.ts and unit-tested in hub/test/migrate.test.ts. Ids never change (Hermes sessions are
// keyed by thread id) and stored message text is user content: only keys, attribute names and enum values move.
//   FIL#<id> (META, MSG#, SUMMARY, REACT#)  -> THREAD#<id>
//   SPACE#<space> / FIL#<id> (sync index)    -> SPACE#<space> / THREAD#<id>
//   attribute `fil` -> `thread` (messages, reactions, summaries, pins; attachments if ever present)
//   propose.fil -> propose.thread; kind 'fil' | 'sujet' -> 'thread' | 'topic'
//   summary ou_on_en_est / decide / prochaine_etape {qui, quoi} / en_attente_de -> status / decisions / next_steps {who, what} / waiting_on
// Idempotent: an already migrated item comes back unchanged (same reference), so a second run writes nothing.

export type Item = Record<string, any>;
export type Key = { pk: string; sk: string };
export type ItemType = 'thread' | 'message' | 'summary' | 'reaction' | 'thread-other' | 'thread-index' | 'lock' | 'space' | 'github'
  | 'space-other' | 'pin' | 'attachment' | 'index' | 'instance' | 'connection' | 'subscription' | 'user-other' | 'other';

const OLD = 'FIL#', NEW = 'THREAD#';
const KINDS: Record<string, string> = { fil: 'thread', sujet: 'topic' };

/** Item type from its keys (old or new layout), for the per-type counts of the script. */
export function itemType(i: Item): ItemType {
  const pk = String(i.pk), sk = String(i.sk);
  if (pk.startsWith(OLD) || pk.startsWith(NEW)) {
    if (sk === 'META') return 'thread';
    if (sk.startsWith('MSG#')) return 'message';
    if (sk === 'SUMMARY') return 'summary';
    if (sk.startsWith('REACT#')) return 'reaction';
    return 'thread-other';
  }
  if (pk.startsWith('SPACE#')) {
    if (sk.startsWith(OLD) || sk.startsWith(NEW)) return 'thread-index';
    if (sk.startsWith('LOCK#')) return 'lock';
    if (sk === 'META') return 'space';
    if (sk === 'GITHUB') return 'github';
    return 'space-other';
  }
  if (pk.startsWith('USER#')) return sk.startsWith('PIN#') ? 'pin' : 'user-other'; // SEEN# marks (read state) postdate v2: nothing to migrate
  if (pk.startsWith('ATT#')) return 'attachment';
  if (pk === 'INDEX') return 'index';
  if (pk.startsWith('INSTANCE#')) return 'instance';
  if (pk.startsWith('CONN#')) return 'connection';
  if (pk.startsWith('SUB#')) return 'subscription';
  return 'other';
}

const renameFil = (o: Item): Item => {
  if (!('fil' in o)) return o;
  const { fil, ...rest } = o;
  return { ...rest, thread: rest.thread ?? fil };
};

/** Summary written with the French keys (before protocol v2) -> English keys; English ones are kept as they are. */
const summary = (s: Item): Item => {
  if (!('ou_on_en_est' in s || 'decide' in s || 'prochaine_etape' in s || 'en_attente_de' in s)) return s;
  const { ou_on_en_est, decide, prochaine_etape, en_attente_de, ...rest } = s;
  return { ...rest, status: rest.status ?? ou_on_en_est, decisions: rest.decisions ?? decide ?? [],
    next_steps: rest.next_steps ?? (prochaine_etape ?? []).map((x: Item) => ({ who: x.who ?? x.qui, what: x.what ?? x.quoi })),
    waiting_on: rest.waiting_on !== undefined ? rest.waiting_on : en_attente_de ?? null };
};

/**
 * Transforms one stored item into the items that replace it. Unchanged item = `[item]` (same reference): nothing to
 * write. Otherwise one item, under the new key (old key to delete) or under the same key (rewrite in place).
 */
export function migrateItem(item: Item): Item[] {
  const type = itemType(item);
  let x: Item = item;
  // keys
  const pk = String(item.pk), sk = String(item.sk);
  if (pk.startsWith(OLD)) x = { ...x, pk: NEW + pk.slice(OLD.length) };
  if (type === 'thread-index' && sk.startsWith(OLD)) x = { ...x, sk: NEW + sk.slice(OLD.length) };
  // attributes
  x = renameFil(x);
  if ((type === 'thread' || type === 'thread-index') && typeof x.kind === 'string' && KINDS[x.kind]) x = { ...x, kind: KINDS[x.kind] };
  if (type === 'message' && x.propose && typeof x.propose === 'object' && 'fil' in x.propose) x = { ...x, propose: renameFil(x.propose) };
  if (type === 'summary') x = summary(x);
  return [x === item || sameJson(x, item) ? item : x];
}

/** What the script does with an item: nothing, rewrite under the same key, or move to a new key (put new, delete old). */
export type Step = { type: ItemType; action: 'skip' } | { type: ItemType; action: 'rewrite'; put: Item } | { type: ItemType; action: 'move'; put: Item; del: Key };

export function plan(item: Item): Step {
  const type = itemType(item);
  const [next] = migrateItem(item);
  if (next === item) return { type, action: 'skip' };
  if (next.pk === item.pk && next.sk === item.sk) return { type, action: 'rewrite', put: next };
  return { type, action: 'move', put: next, del: { pk: item.pk, sk: item.sk } };
}

// Key order does not matter for "unchanged" (a renamed attribute moves to the end of the object).
const sorted = (v: any): any => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' && !(v instanceof Set)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])])) : v instanceof Set ? [...v].sort() : v;
const sameJson = (a: unknown, b: unknown) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
