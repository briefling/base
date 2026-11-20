// Visitor page, pure rules (protocol/preview.ts « Visitor link »): what the page says, and whether it comes back by
// itself after a cut. DOM-free, so client/test/visit.test.ts runs them.

/** A cut is retried (a page reload: new socket, new session) at most VISIT_RETRIES times within VISIT_RETRY_MS. */
export const VISIT_RETRIES = 4;
export const VISIT_RETRY_MS = 2 * 60_000;
export const VISIT_RETRY_DELAY_MS = 1500;
/** API Gateway drops a socket after 10 min without traffic. */
export const VISIT_PING_MS = 4 * 60_000;

/** Why the page stops: the link is over (expired, revoked or replaced: the hub refuses the socket), the preview is off,
 *  it was opened on another device, the agent is away, or anything else. */
export type VisitEnd = 'expired' | 'stopped' | 'elsewhere' | 'away' | 'error';
/** Hub or peer code -> retry (the cut may heal: network, agent peer) or the end it means. */
export function visitOutcome(code: string): 'retry' | VisitEnd {
  if (code === 'expired' || code === 'refused') return 'expired';
  if (code === 'not_shared' || code === 'gone') return 'stopped';
  if (code === 'replaced') return 'elsewhere';
  if (code === 'not_connected') return 'away';
  if (code === 'closed' || code === 'channel' || code === 'peer_failed' || code === 'timeout' || code === 'socket') return 'retry';
  return 'error';
}
/** One more automatic retry? `past` = the earlier retries' times (ms). Never past the link's deadline. */
export function visitRetry(past: readonly number[], now: number, until: number | null): boolean {
  if (until !== null && now >= until) return false;
  return past.filter(t => now - t < VISIT_RETRY_MS).length < VISIT_RETRIES;
}

export type VisitKey = 'connecting' | 'reconnecting' | 'until' | 'retry' | VisitEnd;
const FR: Record<VisitKey, string> = {
  connecting: 'Connexion à la preview…',
  reconnecting: 'Connexion perdue, reconnexion…',
  until: 'Lien valable jusqu’à {t}',
  retry: 'Réessayer',
  expired: 'Ce lien a expiré ou a été révoqué. Demandez-en un nouveau à la personne qui vous l’a envoyé.',
  stopped: 'Cette preview n’est plus partagée.',
  elsewhere: 'La preview a été ouverte sur un autre appareil.',
  away: 'La preview n’est pas disponible pour le moment.',
  error: 'La preview n’a pas pu s’ouvrir.',
};
const EN: Record<VisitKey, string> = {
  connecting: 'Connecting to the preview…',
  reconnecting: 'Connection lost, reconnecting…',
  until: 'Link valid until {t}',
  retry: 'Try again',
  expired: 'This link has expired or was revoked. Ask the person who sent it for a new one.',
  stopped: 'This preview is no longer shared.',
  elsewhere: 'The preview was opened on another device.',
  away: 'The preview is not available right now.',
  error: 'The preview could not open.',
};
/** French for a French browser, English otherwise. */
export function visitText(k: VisitKey, lang: string, p: { t?: string } = {}): string {
  const s = (/^fr\b/i.test(lang) ? FR : EN)[k];
  return s.replace('{t}', p.t ?? '');
}
