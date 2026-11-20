// Editing one's last message from the composer (↑ in an empty composer). DOM-free so node can test it; the rules of
// what may be edited live in protocol/edit.ts (shared with the hub), this file only holds the client's steps:
// confirm (the agent works: stop it first?) -> stopping (wait for its turn end) -> edit (text in the composer) -> sent.
import { editBlock, lastOwn, type EditBlock } from '../../protocol/edit.ts';
import type { Message } from '../../protocol/frames.ts';

export type EditPhase = 'confirm' | 'stopping' | 'edit';
/** Edit in progress (one at a time, in the open conversation). `cid` = client_id of the message.edit in flight. */
export interface Editing { thread: string; msg: string; phase: EditPhase; text: string; orig: string; rev: number; cid?: string }
/** Why ↑ shows a hint instead of editing: a refusal code, or 'untrusted' (busy, and the reader may not stop the agent). */
export type EditHint = EditBlock | 'untrusted';

type Keyish = { key: string; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean; isComposing?: boolean };
/** ↑ opens the edit: plain ArrowUp, empty composer (no pending attachment), @ suggestions closed, no edit open yet. */
export const isEditKey = (e: Keyish, value: string, suggestOpen: boolean, editing: boolean) =>
  e.key === 'ArrowUp' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && !e.isComposing && value === '' && !suggestOpen && !editing;

/** Text put in the composer: the message's text (a message made of files only carries ' '). */
export const editText = (m: Message) => m.text.trim() ? m.text : '';
/** The edit opened on `m`. */
export const editOf = (m: Message): Editing => ({ thread: m.thread, msg: m.id, phase: 'edit', text: editText(m), orig: editText(m), rev: m.rev ?? 0 });

/**
 * What ↑ does in a conversation: null = nothing of mine to edit (the key keeps its default); 'edit' = open it;
 * 'confirm' = the agent works and I may stop it (ask first); 'hint' = refused, with why.
 */
export function onUp(msgs: Iterable<Message>, me: string, turnActive: boolean, trusted: boolean):
  { kind: 'edit' | 'confirm'; msg: Message } | { kind: 'hint'; hint: EditHint } | null {
  const all = [...msgs], m = lastOwn(all, me);
  if (!m) return null;
  const b = editBlock(all, m.id, me, turnActive);
  if (!b) return { kind: 'edit', msg: m };
  if (b === 'busy') return trusted ? { kind: 'confirm', msg: m } : { kind: 'hint', hint: 'untrusted' };
  return { kind: 'hint', hint: b };
}

/**
 * Message the pencil (hover bar, mobile sheet) goes on: the one ↑ would open (edit, or confirm the stop), never a
 * refused one, so the pencil only shows where a click does something.
 */
export function pencilOn(msgs: Iterable<Message>, me: string, turnActive: boolean, trusted: boolean): string | null {
  const r = onUp(msgs, me, turnActive, trusted);
  return r && r.kind !== 'hint' ? r.msg.id : null;
}

/**
 * Next step while waiting for the stopped turn to end (checked on every render): 'wait' while the turn runs, then
 * 'edit' if the message is still editable, else the refusal code (e.g. another human wrote meanwhile).
 */
export function afterStop(msgs: Iterable<Message>, msgId: string, me: string, turnActive: boolean): 'wait' | 'edit' | EditBlock {
  if (turnActive) return 'wait';
  return editBlock(msgs, msgId, me, false) ?? 'edit';
}

/**
 * Save (Enter or the Save button): 'send' the message.edit; 'leave' the edit mode without a frame (text unchanged);
 * 'keep' the edit mode (empty text on a message without files, or a save already in flight).
 */
export function saveAction(e: Editing, hasFiles: boolean): 'send' | 'leave' | 'keep' {
  if (e.phase !== 'edit' || e.cid) return 'keep';
  const text = e.text.trim();
  if (text === e.orig.trim()) return 'leave';
  if (!text && !hasFiles) return 'keep';
  return 'send';
}
