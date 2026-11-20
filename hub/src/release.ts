// Plugin release push (docs/project-status.md « Plugin self-update »). `subscribed.release` only reaches an instance at
// its next connection (API Gateway cuts them every 2 h), so a fresh release waited up to 2 h. Once `npm run deploy` has
// the stack up, it invokes the Release Lambda (handlers/release.ts): every connected instance behind this hub's
// release gets one `release` frame and starts its self-update now, with the same gates as at subscribe (public main
// IS that commit, never a downgrade, restart only when the gateway is idle). The event carries nothing: the release
// sent is the one this hub was built with, so the invoker can only make the hub repeat what it already says.
// An ACP bridge (instance reported with `kind: 'acp'`) gets the bridge's release instead (protocol/bridge-release.ts).
import { PLUGIN_RELEASE } from '../../protocol/plugin-release.ts';
import { BRIDGE_RELEASE } from '../../protocol/bridge-release.ts';
import { compareVersions, type BridgeRelease, type PluginRelease } from '../../protocol/plugin.ts';
import { instanceConns } from './agents.ts';
import { sendOne, type Deps } from './router.ts';

/** Sends `release` to the connections of every instance whose last reported plugin is older (or unknown). */
export async function announceRelease(deps: Pick<Deps, 'store' | 'sender'>, release: PluginRelease = PLUGIN_RELEASE,
  bridge: BridgeRelease = BRIDGE_RELEASE) {
  const out = { instances: 0, sent: 0 };
  for (const inst of await deps.store.listInstances()) {
    const rel = inst.plugin?.kind === 'acp' ? bridge : release;
    if (!rel.commit) continue; // never published: nothing to install
    const frame = { v: 2 as const, type: 'release' as const, release: { version: rel.version, commit: rel.commit } };
    const v = inst.plugin?.version;
    if (v && compareVersions(v, rel.version) !== -1) continue; // up to date (or newer: a rollback never downgrades)
    const conns = await instanceConns(deps, inst);
    if (!conns.size) continue;
    out.instances++;
    for (const c of conns) if (await sendOne(deps, c, frame)) out.sent++;
  }
  return out;
}
