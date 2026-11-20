// Settings › Radar: the form (settings + the profile to validate, one item per line) and its frames (pure, tested).
// Rules in protocol/radar.ts (radarSettingsIn, profileIn): the hub checks the same ones again.
import { RADAR_RUN_MS, profileIn, type RadarConfig, type RadarDetectors, type RadarProfile, type RadarRhythm } from '../../protocol/radar.ts';
import { detectorsOf } from '../../protocol/radar.ts';

export interface RadarForm {
  version: number; agent: string; detectors: RadarDetectors; rhythm: RadarRhythm;
  // The profile as edited: the agent's proposal when there is one (to validate), else the validated profile.
  product: string; competitors: string; tech: string; sources: string; ignore: string;
}

const lines = (xs: string[] | undefined) => (xs ?? []).join('\n');
const items = (s: string) => s.split('\n').map(x => x.trim()).filter(Boolean);

/** Shown profile: the proposal waiting for validation first, else the validated one. */
export const shownProfile = (c: RadarConfig): RadarProfile | undefined => c.proposed ?? c.profile;

export function radarForm(c: RadarConfig, defaultAgent: string, agents: string[]): RadarForm {
  const p = shownProfile(c);
  return { version: c.version, agent: c.agent && agents.includes(c.agent) ? c.agent : defaultAgent, detectors: detectorsOf(c.detectors), rhythm: c.rhythm,
    product: p?.product ?? '', competitors: lines(p?.competitors), tech: lines(p?.tech), sources: lines(p?.sources), ignore: lines(p?.ignore) };
}

export type ProfileList = 'competitors' | 'tech' | 'sources' | 'ignore';
/** What a waiting correction changes in the validated profile: per list, lines added and removed; product reworded. */
export interface ProfileDiff { product: boolean; lists: { list: ProfileList; added: string[]; removed: string[] }[] }
export function profileDiff(c: RadarConfig): ProfileDiff | null {
  const a = c.profile, b = c.proposed;
  if (!a || !b?.from) return null;
  const lists = (['competitors', 'tech', 'sources', 'ignore'] as const).map(list => {
    const x = a[list] ?? [], y = b[list] ?? [];
    return { list, added: y.filter(s => !x.includes(s)), removed: x.filter(s => !y.includes(s)) };
  }).filter(d => d.added.length || d.removed.length);
  return { product: a.product !== b.product, lists };
}

/** The edited profile, or null if the hub would refuse it (too many lines, an item too long, a non-https source). */
export const formProfile = (f: RadarForm): RadarProfile | null =>
  profileIn({ product: f.product, competitors: items(f.competitors), tech: items(f.tech), sources: items(f.sources), ignore: items(f.ignore) });

/** What blocks a save (null = ready): a rhythm needs a validated profile, or this save validates one. */
export function radarFormError(f: RadarForm, c: RadarConfig, validating: boolean): 'profile' | 'no_profile' | null {
  if (validating) return formProfile(f) ? null : 'profile';
  return f.rhythm !== 'off' && !c.profile ? 'no_profile' : null;
}

/** The `radarcfg.save` frame: the settings, plus the profile when the admin validates it. */
export function radarPayload(f: RadarForm, space: string, client_id: string, validating: boolean) {
  const profile = validating ? formProfile(f) : null;
  return { type: 'radarcfg.save', client_id, space, version: f.version, agent: f.agent, detectors: f.detectors, rhythm: f.rhythm, ...(profile ? { profile } : {}) };
}

/** The settings differ from the saved config (the profile is saved by « Validate » only). */
export const settingsChanged = (f: RadarForm, c: RadarConfig, defaultAgent: string) =>
  f.rhythm !== c.rhythm || f.agent !== (c.agent ?? defaultAgent) || (Object.keys(f.detectors) as (keyof RadarDetectors)[]).some(k => f.detectors[k] !== c.detectors[k]);

/** The `radarcfg.reject` frame: drops the waiting proposal (a pass's correction is remembered as rejected). */
export const rejectPayload = (c: RadarConfig, space: string, client_id: string) => ({ type: 'radarcfg.reject', client_id, space, version: c.version });

/** A hidden run is under way: started, its turn not ended (the hub records the end), younger than RADAR_RUN_MS. */
export const radarRunning = (c: RadarConfig, now: number) => c.run?.result === 'started' && !c.run.ended && now - c.run.at < RADAR_RUN_MS;
