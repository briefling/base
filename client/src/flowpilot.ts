// Switch of a flow agent from unstrikeable to briefling (docs/design-flow.md § 13), Settings › Driver (admin):
// pure helpers, DOM-free so node can test them.
import { FLOW_SWITCH_TTL_MS, type FlowPilot } from '../../protocol/frames.ts';

export type PilotStatus = 'none' | 'pending' | 'expired' | 'piloted';

/** Link the agent redeems with its `flow_switch` tool: the static setup page with the one-time code, space and agent. */
export const switchLink = (origin: string, code: string, space: string, agent: string) =>
  `${origin.replace(/\/+$/, '')}/agent.md?switch=${encodeURIComponent(code)}&space=${encodeURIComponent(space)}&agent=${encodeURIComponent(agent)}`;

/** Prompt the admin pastes in a briefling thread with that agent. English on purpose: it is read by the agent, not shown as UI. */
export const switchPrompt = (link: string, space: string, agent: string) => [
  `Switch your board work in the briefling space "${space}" from unstrikeable to briefling:`,
  `1. Remove your \`uns_poll\` cron job for ${agent} (cronjob tool: list the jobs, remove the one running \`uns poll\`). If you cannot, say so: the next step pauses unstrikeable anyway.`,
  `2. Call the \`flow_switch\` tool with this link: ${link}`,
  '3. Tell me what it answered (events imported, spend, state file paused).',
].join('\n');

/** The agent's pilot record, if any (the hub keeps one per agent and space). */
export const pilotOf = (pilots: readonly FlowPilot[] | undefined, agent: string): FlowPilot | null => pilots?.find(p => p.agent === agent) ?? null;

/** Pending link past its expiry (24 h after it was made when the hub sent no expiry) = expired. */
export const pilotStatus = (p: FlowPilot | null, now: number): PilotStatus =>
  !p ? 'none' : p.state === 'piloted' ? 'piloted' : (p.expiresAt ?? p.at + FLOW_SWITCH_TTL_MS) <= now ? 'expired' : 'pending';

/** What the row's button does: make a link, cancel the pending one, or go back to unstrikeable (two clicks). */
export const pilotAction = (s: PilotStatus): 'link' | 'cancel' | 'back' => s === 'pending' ? 'cancel' : s === 'piloted' ? 'back' : 'link';

/** Agents shown in the Pilot block: the space's agents, plus any agent the hub still holds a record for, sorted. */
export const pilotAgents = (agents: readonly string[], pilots: readonly FlowPilot[] | undefined) =>
  [...new Set([...agents, ...(pilots ?? []).map(p => p.agent)])].sort();
