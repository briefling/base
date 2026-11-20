// Hermes plugin releases: version format, status shown in the space Settings.
// The plugin is published to the public repo briefling/hermes-plugin by scripts/publish-plugin.ts, which also
// rewrites protocol/plugin-release.ts (the release the app offers: Settings, agent.md). The public repo names no hub:
// Hermes checks updates against its `main` (git ls-remote), never against a URL of one instance.

import { PLUGIN_RELEASE } from './plugin-release.ts';
import { BRIDGE_RELEASE } from './bridge-release.ts';

export interface PluginRelease {
  version: string;   // semver of plugin.yaml, x.y.z
  commit: string;    // full sha of the release commit in the public repo ('' = never published)
  protocol: string;  // PROTOCOL spoken by that release
  released: string;  // YYYY-MM-DD ('' = never published)
}

/** ACP bridge releases (acp-bridge/, public repo briefling/acp-bridge, tag v<version>), written by
 *  scripts/publish-acp-bridge.ts into protocol/bridge-release.ts: a bridge instance gets this one, never the plugin's. */
export interface BridgeRelease {
  version: string;   // acp-bridge/pyproject.toml version, x.y.z
  commit: string;    // full sha the public repo's tag v<version> points to ('' = never published)
  released: string;  // YYYY-MM-DD
}

/** Plain x.y.z (no pre-release): what plugin.yaml carries and what the hub accepts at subscribe. */
export const PLUGIN_VERSION_RE = /^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/;

/** -1 / 0 / 1, or null when either side is not a plain x.y.z. */
export function compareVersions(a: string, b: string): number | null {
  const pa = PLUGIN_VERSION_RE.exec(a), pb = PLUGIN_VERSION_RE.exec(b);
  if (!pa || !pb) return null;
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d) return Math.sign(d);
  }
  return 0;
}

/** First release that installs newer ones by itself (hermes-plugin/briefling/selfupdate.py). */
export const SELF_UPDATE_SINCE = '0.3.73';
/** First ACP bridge release that installs newer ones by itself (acp-bridge/briefling_acp/selfupdate.py); older bridges
 *  report no version at all, so they never show a banner. */
export const BRIDGE_SELF_UPDATE_SINCE = '0.3.42';
/** Why an agent behind the latest release will not catch up alone: its auto-update failed, is off (BRIEFLING_AUTO_UPDATE=0),
 *  its install is pinned (--ref) or not a git checkout (manual), or its plugin predates the self-update (old). */
export type PluginStuck = 'failed' | 'off' | 'pinned' | 'manual' | 'old';
export const UPDATE_BLOCKS = ['failed', 'off', 'pinned', 'manual'] as const;
export type UpdateBlock = typeof UPDATE_BLOCKS[number];
export const isUpdateBlock = (v: unknown): v is UpdateBlock => typeof v === 'string' && (UPDATE_BLOCKS as readonly string[]).includes(v);
/** Hermes' `prompt_caching.cache_ttl` as the plugin reports it (`5m` when the key is absent, Hermes' default). Any other
 *  value (a disabled cache, a future tier) is ignored by the hub: the agent row then shows nothing. */
export const CACHE_TTLS = ['5m', '1h', 'auto'] as const;
export type CacheTtl = typeof CACHE_TTLS[number];
export const isCacheTtl = (v: unknown): v is CacheTtl => typeof v === 'string' && (CACHE_TTLS as readonly string[]).includes(v);

/** Hub: the agent's banner reason, from what its instance last reported at subscribe; undefined = up to date, or it updates itself
 *  (a plain lag after a release lasts until its next connection, at most ~2 h: no banner for that). */
export function stuckOf(plugin: { version?: string; update?: string } | undefined, latest: string, since = SELF_UPDATE_SINCE): PluginStuck | undefined {
  if (!plugin?.version) return undefined; // no version reported: an ACP bridge before 0.3.42, never a banner
  if (compareVersions(plugin.version, latest) !== -1) return undefined;
  if (compareVersions(plugin.version, since) === -1) return 'old';
  return isUpdateBlock(plugin.update) ? plugin.update : undefined;
}

/** The release an instance should run, by what it is: an ACP bridge (`kind: 'acp'`) or the Hermes plugin. */
export function latestFor(kind: string | undefined): { version: string; commit: string; since: string } {
  return kind === 'acp' ? { version: BRIDGE_RELEASE.version, commit: BRIDGE_RELEASE.commit, since: BRIDGE_SELF_UPDATE_SINCE }
    : { version: PLUGIN_RELEASE.version, commit: PLUGIN_RELEASE.commit, since: SELF_UPDATE_SINCE };
}

export type Bump = 'patch' | 'minor' | 'major';

/** Next version: a bump kind, or an explicit x.y.z that must be greater than the current one. */
export function nextVersion(current: string, want: Bump | string): string {
  const m = PLUGIN_VERSION_RE.exec(current);
  if (!m) throw new Error(`current version ${JSON.stringify(current)} is not x.y.z`);
  const [x, y, z] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (want === 'major') return `${x + 1}.0.0`;
  if (want === 'minor') return `${x}.${y + 1}.0`;
  if (want === 'patch') return `${x}.${y}.${z + 1}`;
  if (compareVersions(want, current) !== 1) throw new Error(`version ${JSON.stringify(want)} must be x.y.z and greater than ${current}`);
  return want;
}

/** Throws unless every field is what the publish script may write into protocol/plugin-release.ts. */
export function checkRelease(r: PluginRelease): PluginRelease {
  if (!PLUGIN_VERSION_RE.test(r.version)) throw new Error(`bad plugin version ${JSON.stringify(r.version)}`);
  if (r.commit && !/^[0-9a-f]{40}$/.test(r.commit)) throw new Error(`bad plugin commit ${JSON.stringify(r.commit)}`);
  if (r.released && !/^\d{4}-\d{2}-\d{2}$/.test(r.released)) throw new Error(`bad release date ${JSON.stringify(r.released)}`);
  if (!/^[a-z0-9.]{1,32}$/.test(r.protocol)) throw new Error(`bad protocol ${JSON.stringify(r.protocol)}`);
  return r;
}

/** Settings line of an agent: `unknown` = never reported (plugin before versioning) or unreadable. */
export type PluginStatus = 'current' | 'outdated' | 'unknown';

export function pluginStatus(reported: string | undefined, latest: string): PluginStatus {
  const c = reported === undefined ? null : compareVersions(reported, latest);
  return c === null ? 'unknown' : c < 0 ? 'outdated' : 'current';
}
