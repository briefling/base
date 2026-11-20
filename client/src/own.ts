// The user's own messages never make a thread unread, DOM-free (tested by node).
//
// "Read" is stored when a thread is displayed (`markSeen` in main.ts). A topic posted from the Lounge composer and
// left before the hub answered was never displayed: without this, it came back unread for its own author.
// Hub order for a `post` / `answer` (router `fromHuman`): `ack` to the sender, then `message.created` and
// `thread.upserted` broadcast by the same Lambda. So the first upsert of that thread after the ack is the user's own
// write; anything later (agent turn, reply) still counts as unread.

/** Frames whose `ack` means "your message is stored". */
const WRITES = new Set(['post', 'answer', 'message.edit']); // an edit is acked, then upserts the thread, like a post

export interface OwnWrites {
  /** A frame was sent to the hub. */
  sent(frame: object): void;
  /** `ack` received. */
  acked(clientId: string, thread: string): void;
  /** `thread.upserted` received: true if it carries the user's own write (mark it read). One answer per write. */
  own(thread: string): boolean;
  /** Connection lost: an ack or an upsert may never come, don't let a later change pass for the user's. */
  reset(): void;
}

export function ownWrites(): OwnWrites {
  const sentIds = new Set<string>(), pending = new Set<string>();
  return {
    sent(frame) { const f = frame as { type?: unknown; client_id?: unknown }; if (WRITES.has(f.type as string) && typeof f.client_id === 'string') sentIds.add(f.client_id); },
    acked(clientId, thread) { if (sentIds.delete(clientId)) pending.add(thread); },
    own(thread) { return pending.delete(thread); },
    reset() { sentIds.clear(); pending.clear(); },
  };
}
