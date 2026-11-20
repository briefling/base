// What a schedule fire runs, whoever fired it: the routine Lambda (EventBridge Scheduler, hub/src/handlers/routine.ts)
// or the standalone server's own scheduler (hub/src/localsched.ts). The input carries ids only; the run re-reads and
// re-checks everything.
import type { Deps } from './router.ts';
import { runRoutine, type RoutineFire } from './routines.ts';
import { runRadar } from './radar.ts';
import { SPACE_ID_RE } from '../../protocol/frames.ts';
import { fireModule } from './modules.ts';

export async function fireSchedule(deps: Deps, e: RoutineFire) {
  // The space's Radar schedule (Settings › Radar): a managed pass, everything re-checked by runRadar.
  if (e?.radar === true && typeof e.space === 'string' && SPACE_ID_RE.test(e.space)) return { result: await runRadar(deps, e.space, 'pass') };
  // A module's schedule (a reminder's due time: hub/src/modules.ts), everything re-checked by the module.
  const mod = typeof e?.space === 'string' && SPACE_ID_RE.test(e.space) ? fireModule(e) : undefined;
  if (mod) return { result: await mod.fire!.run(deps, e) };
  if (typeof e?.space !== 'string' || !SPACE_ID_RE.test(e.space) || typeof e.routine !== 'string' || !/^[a-z0-9]{1,40}$/.test(e.routine)) {
    console.error('routine_bad_input'); return;
  }
  const result = await runRoutine(deps, e.space, e.routine!);
  return { result };
}
