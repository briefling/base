// Hash routes (#/…) <-> the view on screen. Pure: the space list is passed in.
import { isSpTab, type SpTab } from './spaces.ts';
import { isModuleView, type ModuleView } from './modules.ts';

export type View = { kind: 'now' } | { kind: 'space'; id: string } | { kind: 'lounge'; id: string } | { kind: 'overview'; id: string } | { kind: 'later'; id: string } | { kind: 'closed'; id: string }
  | { kind: 'settings'; id: string; tab?: SpTab } | { kind: 'metrics'; id: string } | { kind: 'memory'; id: string } | { kind: 'radar'; id: string } | { kind: 'applets'; id: string; pin?: string } | { kind: 'exchanges'; id: string } | { kind: 'lineage'; id: string } | { kind: 'workflow'; id: string } | { kind: 'newspace' }
  | { kind: ModuleView; id: string }; // a module in its own files (client/src/modules.ts): `#/<space>/<module>`

export function routeOf(v: View, sel: string | null): string {
  if (v.kind === 'newspace') return '#/new-space';
  const base = v.kind === 'now' ? '#/now' : `#/${encodeURIComponent(v.id)}${v.kind === 'lounge' ? '/lounge' : v.kind === 'overview' ? '/overview' : v.kind === 'later' ? '/later' : v.kind === 'closed' ? '/closed' : v.kind === 'settings' ? `/settings${v.tab && v.tab !== 'general' ? `/${v.tab}` : ''}` : v.kind === 'metrics' ? '/metrics' : v.kind === 'memory' ? '/memory' : v.kind === 'radar' ? '/radar' : v.kind === 'applets' ? `/applets${v.pin ? `/${encodeURIComponent(v.pin)}` : ''}` : v.kind === 'exchanges' ? '/exchanges' : v.kind === 'lineage' ? '/lineage' : v.kind === 'workflow' ? '/workflow' : isModuleView(v.kind) ? `/${v.kind}` : ''}`;
  return sel && sel !== 'new' ? `${base}/${encodeURIComponent(sel)}` : base;
}

/** `spaces`: ids of the known spaces, null before the hub answers (the route is then kept, checked at `subscribed`). */
export function parseRoute(hash: string, spaces: string[] | null): { view: View; sel: string | null } {
  const [sp, a, b, c] = hash.replace(/^#\/?/, '').split('/').map(x => { try { return decodeURIComponent(x); } catch { return ''; } });
  if (!sp || sp === 'now') return { view: { kind: 'now' }, sel: a || null };
  if (sp === 'new-space') return { view: { kind: 'newspace' }, sel: null };
  if (spaces && !spaces.includes(sp)) return { view: { kind: 'now' }, sel: null };
  if (a === 'settings') return { view: { kind: 'settings', id: sp, ...(isSpTab(b) && b !== 'general' ? { tab: b } : {}) }, sel: null };
  if (a === 'lounge') return { view: { kind: 'lounge', id: sp }, sel: b || null };
  if (a === 'overview') return { view: { kind: 'overview', id: sp }, sel: null };
  if (a === 'metrics') return { view: { kind: 'metrics', id: sp }, sel: null };
  if (a === 'memory') return { view: { kind: 'memory', id: sp }, sel: null };
  if (a === 'radar') return { view: { kind: 'radar', id: sp }, sel: null };
  // `/applets/<id>[/<conversation>]`: one applet alone, pinned as a mini-app (client/src/pinapp.ts), its conversations inside it.
  if (a === 'applets') return b ? { view: { kind: 'applets', id: sp, pin: b }, sel: c || null } : { view: { kind: 'applets', id: sp }, sel: null };
  if (a === 'exchanges') return { view: { kind: 'exchanges', id: sp }, sel: null };
  if (a === 'lineage') return { view: { kind: 'lineage', id: sp }, sel: null };
  if (a === 'workflow') return { view: { kind: 'workflow', id: sp }, sel: null };
  if (isModuleView(a)) return { view: { kind: a, id: sp }, sel: null };
  if (a === 'later') return { view: { kind: 'later', id: sp }, sel: b || null };
  // `/archived`: the entry before Closed replaced it (old links, open tabs).
  if (a === 'closed' || a === 'archived') return { view: { kind: 'closed', id: sp }, sel: b || null };
  return { view: { kind: 'space', id: sp }, sel: a || null };
}
