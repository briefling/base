// « Pipe » summary of a board workflow (Settings › Work): the board's columns in order, under each one the roles that
// act there, the agents holding those roles and the triggers; then quiet notes on how each role gets its agent.
// DOM-free, computed from the stored config only (FlowDef + FlowTeam), tested in client/test/flowpipe.test.ts.
import { FLOW_TRIGGERS, type FlowDef, type FlowTrigger, type RoleAssign } from '../../protocol/flowcfg.ts';
import type { FlowTeam } from '../../protocol/flowteam.ts';

/** A role acting in one column: `agents` empty = nobody holds the role (shown « — », tooltip « not assigned »). */
export interface PipeActor { role: string; assign: RoleAssign; agents: string[]; triggers: FlowTrigger[] }
export interface PipeColumn { key: string; column: string; actors: PipeActor[] }
/**
 * `label`: the team assigns the role by hand with the `<role>:<agent>` label (not a gap, Blair's loom case).
 * `unstaffed`: the role picks its agent itself (`all`, `auto`) but no agent of the team has it: to assign by hand.
 */
export type PipeNote = { kind: 'label'; role: string } | { kind: 'unstaffed'; role: string; columns: string[] };

const holders = (team: FlowTeam, role: string) => team.agents.filter(a => a.roles.includes(role)).map(a => a.name);

/** Columns in board order; a column where no role acts has no actor. Human roles never act (no triggers). */
export function flowPipe(def: FlowDef, team: FlowTeam): PipeColumn[] {
  return def.states.map(s => ({ key: s.key, column: s.column || s.key,
    actors: def.roles.filter(r => r.assign !== 'human' && (r.on[s.key]?.length ?? 0) > 0)
      .map(r => ({ role: r.name, assign: r.assign, agents: holders(team, r.name), triggers: FLOW_TRIGGERS.filter(tr => r.on[s.key].includes(tr)) })) }));
}

/** One note per acting role that needs a human: assigned by label, or no agent holds it. In role order. */
export function pipeNotes(def: FlowDef, team: FlowTeam): PipeNote[] {
  const notes: PipeNote[] = [];
  for (const r of def.roles) {
    if (r.assign === 'human') continue;
    const columns = def.states.filter(s => (r.on[s.key]?.length ?? 0) > 0).map(s => s.column || s.key);
    if (!columns.length) continue;
    if (r.assign === 'label') notes.push({ kind: 'label', role: r.name });
    else if (!holders(team, r.name).length) notes.push({ kind: 'unstaffed', role: r.name, columns });
  }
  return notes;
}
