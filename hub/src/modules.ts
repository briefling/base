// Hub side of the space modules that live in their own files (protocol/modules.ts): one small interface, so a module
// plugs its frames, its scheduled fires and its pushes into the router, the Routine Lambda and the Push Lambda with one
// line each, instead of growing router.ts: the memory (hub/src/memory.ts, always on), the reminders
// (hub/src/reminders.ts), the mail exchanges, the Radar, the Metrics and the Flow view (exchanges.ts, radar.ts,
// metrics.ts, lineage.ts), the conversation tags (tags.ts), the personal mutes (mute.ts), « Open the thread » on a summary's next step (nextsteps.ts), the pending leads (leads.ts), « X is typing… » (typing.ts); the next modules register here the same way.
import type { HubFrame, Principal } from '../../protocol/frames.ts';
import type { Module } from '../../protocol/modules.ts';
import type { Deps, Instance, StoredThread } from './router.ts';
import type { PushDeps } from './push.ts';
import { memory } from './memory.ts';
import { reminders } from './reminders.ts';
import { exchanges } from './exchanges.ts';
import { radar } from './radar.ts';
import { metrics } from './metrics.ts';
import { lineage } from './lineage.ts';
import { tags } from './tags.ts';
import { mute } from './mute.ts';
import { browser } from './browser.ts';
import { nextsteps } from './nextsteps.ts';
import { leads } from './leads.ts';
import { typing } from './typing.ts';
import { pinapp } from './pinapp.ts';

type Reply = (f: HubFrame) => Promise<boolean>;
export interface HubModule {
  /** Its switch in the space Settings (protocol/modules.ts); absent = a module without on/off, always there (memory). */
  module?: Module;
  /** Human frames `<prefix>.*`, one prefix or several (the module checks membership, its own rules and that it is on in the space; an unknown
   *  type is refused `unknown_type`). `connId` = the human's connection, for an answer that comes later (another Lambda). */
  prefix: string | readonly string[];
  human(deps: Deps, who: Principal, f: any, reply: Reply, connId: string): Promise<void>;
  /** Agent frames by type, during a turn in `cur` (the conversation of the agent's connection), sent by `inst`. */
  agent?: Record<string, (deps: Deps, cur: StoredThread, as: string, f: any, reply: Reply, inst: Instance) => Promise<void>>;
  /** An EventBridge schedule of this module fired (Routine Lambda): `owns` recognises its input. */
  fire?: { owns(e: unknown): boolean; run(deps: Deps, e: any): Promise<unknown> };
  /** A Web Push job of this module (Push Lambda): `owns` recognises it; `label` names it in the logs (never content). */
  push?: { owns(job: unknown): boolean; label(job: any): string; send(deps: PushDeps, job: any): Promise<{ sent: number; gone: number; failed: number; skipped?: string }> };
}

// Built at first use, not at load: whoever imports a module file first (hub/test/lineage.test.ts → lineage.ts) goes
// through the cycle module → router.ts → this file, and a list built at load reads that module before it is defined.
let modules: readonly HubModule[] | undefined;
export const hubModules = (): readonly HubModule[] => modules ??= [memory, reminders, exchanges, radar, metrics, lineage, tags, mute, browser, nextsteps, leads, typing, pinapp];

/** The module whose human frames this type belongs to. */
export const humanModule = (type: unknown) => typeof type === 'string' ? hubModules().find(m => [m.prefix].flat().some(p => type.startsWith(`${p}.`))) : undefined;
/** The agent handler of this frame type, if a module owns it. */
export const agentModule = (type: unknown) => typeof type === 'string' ? hubModules().map(m => m.agent?.[type]).find(Boolean) : undefined;
export const fireModule = (e: unknown) => hubModules().find(m => m.fire?.owns(e));
export const pushModule = (job: unknown) => hubModules().find(m => m.push?.owns(job));
