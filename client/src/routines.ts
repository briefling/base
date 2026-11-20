// Settings › Routines: the editor's form and the list's summary line (pure, tested). Rules in protocol/routines.ts.
import { routineIn, WEEKDAYS, type Routine, type RoutineDraft } from '../../protocol/routines.ts';

/** The editor: a new routine (`id` absent) or an edit of `version`. */
export interface RoutineForm extends RoutineDraft { id?: string; version?: number }

export const newRoutine = (agent: string): RoutineForm => ({ name: '', instruction: '', agent, days: [...WEEKDAYS], time: '08:30', active: true });
export const editRoutine = (r: Routine): RoutineForm => ({ id: r.id, version: r.version, name: r.name, instruction: r.instruction, agent: r.agent, days: [...r.days], time: r.time, active: r.active, ...(r.radar ? { radar: true } : {}) });

export const toggleDay = (f: RoutineForm, d: number): RoutineForm =>
  ({ ...f, days: f.days.includes(d) ? f.days.filter(x => x !== d) : [...f.days, d].sort((a, b) => a - b) });

/** What is missing before saving (null = ready): the hub checks the same rules (routineIn). */
export function routineFormError(f: RoutineForm, agents: string[]): 'name' | 'instruction' | 'days' | 'time' | 'agent' | null {
  if (!f.name.trim()) return 'name';
  if (!f.instruction.trim()) return 'instruction';
  if (!f.days.length) return 'days';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(f.time)) return 'time';
  if (!agents.includes(f.agent)) return 'agent';
  return routineIn(f) ? null : 'name';
}

/** The `routine.save` frame of the form. */
export const routinePayload = (f: RoutineForm, space: string, client_id: string) => ({ type: 'routine.save', client_id, space,
  ...(f.id ? { id: f.id, version: f.version } : {}), name: f.name.trim(), instruction: f.instruction.trim(), agent: f.agent, days: f.days, time: f.time, active: f.active, ...(f.radar ? { radar: true } : {}) });

/** Days of the list line: « Weekdays », « Every day », else the short names (`names[d]`, 1 = Monday). */
export function daysText(days: number[], names: string[], weekdays: string, everyDay: string): string {
  const s = [...days].sort((a, b) => a - b).join();
  if (s === '1,2,3,4,5') return weekdays;
  if (s === '1,2,3,4,5,6,7') return everyDay;
  return [...days].sort((a, b) => a - b).map(d => names[d]).join(', ');
}
