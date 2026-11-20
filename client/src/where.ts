// « space · agent » line of a list card, DOM-free (tested in client/test/where.test.ts).

/** `space` set = the Now view, which mixes spaces: space name and agent. A space list names the agent only when it
 *  can't be guessed: several agents in the space, or a thread owned by an agent no longer in it. null = no line. */
export function whereText(space: string | null, owner: string, agents: readonly string[]): string | null {
  if (space !== null) return `${space} · ${owner}`;
  return agents.length > 1 || !agents.includes(owner) ? owner : null;
}
