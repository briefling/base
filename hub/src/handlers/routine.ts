// Routine Lambda: invoked by the EventBridge schedule of a routine (Settings › Routines), never from outside (no URL, no
// API: only the scheduler role may invoke it). What a fire runs: hub/src/fire.ts (shared with the standalone server).
import { store, newId, makeSenderFromEndpoint, queuePush, queueGithub } from '../aws.ts';
import type { RoutineFire } from '../routines.ts';
import { fireSchedule } from '../fire.ts';

const sender = makeSenderFromEndpoint(process.env.WS_ENDPOINT!);

export async function handler(e: RoutineFire) {
  // queueGithub: a Radar pass with the bug or security detector is delivered by the GitHub Lambda once it read the repos.
  return fireSchedule({ store, sender, now: () => Date.now(), newId, queuePush, queueGithub }, e);
}
