// Temporary AWS elevation card (elevation/CONTRACT.md). The approval itself (passkey, Face ID) happens on the approval
// page of the AWS management account, never in this app: agents are Admin on the account that serves it, so it could
// be altered. The card only follows the request: Check, Renew, Revoke, Not now.
import type { Elevation } from '../../protocol/frames.ts';

/** What the card offers now: check (request alive), renew (request expired), revoke (running grant), or nothing. */
export function elevationState(e: Elevation, now: number): 'check' | 'renew' | 'running' | 'over' | 'closed' {
  if (e.status === 'open') return e.requestExpires > now && e.error !== 'expired' ? 'check' : 'renew';
  if (e.status === 'granted') return (e.expiresAt ?? 0) > now ? 'running' : 'over';
  return 'closed';
}

/** The approval page address as pasted by the owner: https only, with a path (its secret prefix); else null. */
export function elevationPageUrl(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.pathname.length < 2) return null;
  return u.origin + u.pathname;
}
