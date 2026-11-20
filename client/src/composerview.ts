// Composer of a conversation: the @ autocompletion, the attachments (direct upload to S3, the audio recorder of
// client/src/recorder.ts), the files of a message, the drafts, Enter to send, and the edit of one's last message.
// Their own file since the modules refactor: main.ts keeps the socket, `render()` and the conversation views, which
// build their composer from what this returns. Built once at load, at the places the blocks had in main.ts, so the
// window listeners keep their order.
import type { FileRef, HubFrame, Message, Person, PublicThread } from '../../protocol/frames.ts';
import { INLINE_IMAGE_MIME, INLINE_VIDEO_MIME, maxFileBytes } from '../../protocol/frames.ts';
import { canTalk, type Presence } from '../../protocol/presence.ts';
import { isAudio, baseMime, fmtDur } from './audio.ts';
import { afterStop, editOf, isEditKey, onUp, saveAction, type Editing } from './edit.ts';
import { hasKey, lang } from './i18n.ts';
import { on, cur } from './patch.ts';
import { voiceAction, voiceAgent } from './preview.ts';
import { bump, mentionedIds, parseRecent, rankPeople, recentKey } from './recent.ts';
import { recorder } from './recorder.ts';
import { opensViewer } from './viewer.ts';
import { typersOf, typingFrame, typingWho, type Typing } from './typing.ts';
import type { UiKit } from './modules.ts';

/** The part of main.ts' app state the autocompletion and the attachments read or write. */
export interface AttachShared { me: string; err: string; people: Map<string, Person[]> }
export interface AttachDeps {
  rand(): string;
  avatarClass(a: Message['author']): string;
  face(src: string, name: string): Node;
  iconBtn(name: string, text: string, onclick: (e: Event) => void, extra?: Record<string, any>): HTMLElement;
  dlButton(f: FileRef): HTMLElement;
  videoEl(f: FileRef): HTMLElement;
  audioEl(f: FileRef): HTMLElement;
  openViewer(thread: string, fid: string): void;
  /** Re-sticks a tracked scroller that was at the bottom before a late growth; false if the scroller is not tracked. */
  keepAtEnd(el: Element): boolean;
}

export function attachmentsModule(k: UiKit, S: AttachShared, d: AttachDeps) {
  const { h, icon, t, render, send } = k;
  const { rand, avatarClass, face, iconBtn, dlButton, videoEl, audioEl, openViewer } = d;
  // @ autocompletion: humans and agents of the space, last mentioned first (client/src/recent.ts, per device).
  const recentOf = (space: string) => { try { return parseRecent(localStorage.getItem(recentKey(space))); } catch { return []; } };
  /** Called on send (not on pick): the people mentioned in the sent text move to the head of the space's list. */
  function noteMentions(space: string, text: string) {
    const ids = mentionedIds(text, (S.people.get(space) ?? []).filter(p => !p.gone));
    if (ids.length) try { localStorage.setItem(recentKey(space), JSON.stringify(bump(recentOf(space), ids))); } catch { /* storage full or off */ }
  }
  const MENTION_RE = /(^|\s)@([\p{L}\p{N}_-]*)$/u;
  let suggest: { space: string; idx: number } | null = null;
  function attachMentions(ta: HTMLTextAreaElement, space: string, box: HTMLElement) {
    // Handlers run against the live textarea and box (patch() keeps the old nodes, see patch.ts).
    const T = () => cur(ta), B = () => cur(box);
    const matches = () => {
      const ta = T();
      const q = MENTION_RE.exec(ta.value.slice(0, ta.selectionStart ?? 0));
      if (!q) return null;
      const list = rankPeople(S.people.get(space) ?? [], q[2], recentOf(space), S.me);
      return list.length ? { q: q[2], list } : null;
    };
    const draw = () => {
      const m = matches(), box = B();
      box.replaceChildren();
      if (!m) { suggest = null; box.hidden = true; return; }
      suggest = { space, idx: Math.min(suggest?.idx ?? 0, m.list.length - 1) };
      box.hidden = false;
      m.list.slice(0, 8).forEach((p, i) => box.append(h('div', {
        class: `sug ${i === suggest!.idx ? 'on' : ''}`,
        onmousedown: (e: Event) => { e.preventDefault(); pick(p); },
      }, h('span', { class: `avatar sm ${avatarClass({ kind: p.kind, id: p.id })}`, 'aria-hidden': 'true' }, face(p.avatar ?? '', p.name)),
        h('span', { class: 'sug-name' }, p.name), p.kind === 'agent' ? h('span', { class: 'sug-tag' }, t('sug_agent')) : null,
        p.role ? h('span', { class: 'sug-role' }, p.role) : null)));
    };
    const pick = (p: Person) => {
      const ta = T(), box = B();
      const caret = ta.selectionStart ?? ta.value.length;
      const before = ta.value.slice(0, caret).replace(/@[\p{L}\p{N}_-]*$/u, `@${p.name} `);
      ta.value = before + ta.value.slice(caret);
      ta.setSelectionRange(before.length, before.length);
      ta.dispatchEvent(new Event('input'));
      suggest = null; box.hidden = true;
    };
    on(ta, 'input', draw);
    on(ta, 'click', draw);
    on(ta, 'blur', () => { B().hidden = true; });
    on(ta, 'keydown', (e: KeyboardEvent) => {
      const box = B(), m = !box.hidden && matches();
      if (!m || !suggest) return;
      const n = Math.min(m.list.length, 8);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); suggest.idx = (suggest.idx + (e.key === 'ArrowDown' ? 1 : n - 1)) % n; draw(); }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); pick(m.list[suggest.idx]); }
      else if (e.key === 'Escape') { e.preventDefault(); box.hidden = true; suggest = null; }
    }, true);
    if (document.activeElement === T() || suggest) queueMicrotask(draw);
  }

  // ---------------------------------------------------------------- attachments
  const { rec, recStart, recStop } = recorder(k, S, { addFiles, sendReady });
  // Direct upload browser -> S3 with a form presigned by the hub (type and size enforced). The hub never sees the bytes.
  const MAX_COUNT = 10;
  type Pending = { cid: string; file: File; preview: string | null; status: 'up' | 'ok' | 'err'; err?: string; ref?: FileRef };
  const pendings = new Map<string, Pending[]>();   // per draft (same key as drafts)
  const byCid = new Map<string, { key: string; p: Pending }>();
  const fileUrls = new Map<string, { url: string; exp: number }>();
  const asked = new Set<string>();
  const fmtSize = (n: number) => n < 1024 ? t('size_b', { n }) : n < 1048576 ? t('size_kb', { n: Math.round(n / 1024) }) : t('size_mb', { n: (n / 1048576).toFixed(1) });
  const isImg = (mime: string) => INLINE_IMAGE_MIME.includes(mime);
  const isVideo = (mime: string) => INLINE_VIDEO_MIME.includes(mime);

  function addFiles(key: string, space: string, list: File[]) {
    const cur = pendings.get(key) ?? [];
    for (const file of list) {
      if (cur.length >= MAX_COUNT) { S.err = t('err_max_files', { n: MAX_COUNT }); break; }
      const p: Pending = { cid: rand().slice(0, 20), file, preview: isImg(file.type) ? URL.createObjectURL(file) : null, status: 'up' };
      const max = maxFileBytes(baseMime(file.type));
      if (file.size > max) { p.status = 'err'; p.err = t('att_too_large', { n: max / 1048576 }); }
      else if (!file.size) { p.status = 'err'; p.err = t('att_empty'); }
      else { byCid.set(p.cid, { key, p });
        if (!send({ type: 'upload', client_id: p.cid, space, name: file.name || 'image.png', mime: baseMime(file.type) || 'application/octet-stream', size: file.size })) { byCid.delete(p.cid); p.status = 'err'; p.err = t('att_failed'); } }
      cur.push(p);
    }
    pendings.set(key, cur);
    sendReady();
    render();
  }
  async function onUploadReady(f: Extract<HubFrame, { type: 'upload.ready' }>) {
    const e = byCid.get(f.client_id); if (!e) return;
    const body = new FormData();
    for (const [k, v] of Object.entries(f.post.fields)) body.append(k, v);
    body.append('file', e.p.file); // the file must be the last field of the S3 form
    try {
      const r = await fetch(f.post.url, { method: 'POST', body });
      if (!r.ok) throw new Error(String(r.status));
      e.p.status = 'ok'; e.p.ref = f.file;
    } catch { e.p.status = 'err'; e.p.err = t('att_failed'); }
    byCid.delete(f.client_id);
    sendReady();
    render();
  }
  function uploadFailed(cid: string, code: string) {
    const e = byCid.get(cid); if (!e) return false;
    const k = `err_${code}`;
    e.p.status = 'err'; e.p.err = hasKey(k) ? t(k) : code; byCid.delete(cid); sendReady(); return true;
  }
  /**
   * Text to send now: a message can be only an attachment. Send pressed while the draft records or uploads: the
   * recording stops and is attached, the draft waits in `sendWait` (Send button « Sending… ») and `sendReady` sends it
   * once every upload is done; '' meanwhile. A successful send clears the error line.
   */
  const sendWait = new Map<string, () => void>();   // draft key -> its send, run once the uploads are done
  const recording = (key: string) => rec.mr !== null && rec.key === key;
  const uploading = (key: string) => (pendings.get(key) ?? []).some(p => p.status === 'up');
  function msgText(ta: HTMLTextAreaElement, att: ReturnType<typeof attachments>, go: () => void) {
    if (sendWait.has(att.key)) return '';
    if (recording(att.key) || uploading(att.key)) { sendWait.set(att.key, go); S.err = ''; recStop(false); render(); return ''; }
    const text = ta.value.trim() || (att.payload().files ? ' ' : '');
    if (text) S.err = '';
    return text;
  }
  /** Runs the sends waiting on a recording or an upload; an upload that failed sends nothing (draft and chip stay). */
  function sendReady() {
    for (const [key, go] of sendWait) {
      if (recording(key) || uploading(key)) continue;
      sendWait.delete(key);
      if ((pendings.get(key) ?? []).some(p => p.status === 'err')) S.err = t('err_not_sent'); else go();
    }
  }
  function attachments(key: string, space: string, ta: HTMLTextAreaElement) {
    const list = () => pendings.get(key) ?? [];
    on(ta, 'paste', (e: ClipboardEvent) => {
      const fs = [...(e.clipboardData?.files ?? [])];
      if (fs.length) { e.preventDefault(); addFiles(key, space, fs); }
    });
    const input = h('input', { type: 'file', multiple: true, hidden: true, onchange: (e: Event) => { const el = e.target as HTMLInputElement; addFiles(key, space, [...(el.files ?? [])]); el.value = ''; } }) as HTMLInputElement;
    const remove = (p: Pending) => { if (p.preview) URL.revokeObjectURL(p.preview); byCid.delete(p.cid); pendings.set(key, list().filter(x => x !== p)); render(); };
    const chips = list().length ? h('div', { class: 'att-list' }, ...list().map(p => h('div', { class: `att ${p.status}`, title: p.err ?? p.file.name },
      p.preview ? h('img', { src: p.preview, alt: '' }) : h('span', { class: 'att-ico' }, icon(isAudio(baseMime(p.file.type)) ? 'audio' : 'file') as unknown as Node),
      h('span', { class: 'att-name' }, p.file.name || t('image')),
      h('span', { class: 'att-meta' }, p.status === 'up' ? t('att_uploading') : p.status === 'err' ? p.err! : fmtSize(p.file.size)),
      h('button', { class: 'att-x', title: t('remove'), 'aria-label': t('remove'), onclick: () => remove(p) }, '×')))) : null;
    const recHere = rec.mr !== null && rec.key === key;
    // Recording bar above the text: pulsing dot, elapsed time (ticked in place by the recorder), Cancel. Stop is the mic button.
    const recBar = recHere ? h('div', { class: 'rec-bar', role: 'status' }, h('span', { class: 'rec-dot' }), t('recording'),
      h('span', { class: 'rec-time' }, fmtDur((Date.now() - rec.start) / 1000)), h('span', { class: 'grow' }),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => recStop(true) }, t('rec_cancel'))) : null;
    const canRec = !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
    return {
      chips: recBar || chips ? h('div', {}, recBar, chips) : null,
      clip: h('span', { class: 'att-btns' }, input, iconBtn('paperclip', t('attach'), () => cur(input).click()),
        !canRec ? null : recHere ? iconBtn('stop', t('rec_stop'), () => recStop(false), { class: 'btn ic rec-on' })
          : iconBtn('mic', t('record'), () => recStart(key, space), rec.mr ? { disabled: true } : {})),
      key,
      drop: {
        ondragover: (e: DragEvent) => { e.preventDefault(); (e.currentTarget as HTMLElement).classList.add('dropping'); },
        ondragleave: (e: DragEvent) => (e.currentTarget as HTMLElement).classList.remove('dropping'),
        ondrop: (e: DragEvent) => { e.preventDefault(); (e.currentTarget as HTMLElement).classList.remove('dropping'); addFiles(key, space, [...(e.dataTransfer?.files ?? [])]); },
      },
      payload: (): { files?: string[] } => { const ids = list().filter(p => p.status === 'ok').map(p => p.ref!.id); return ids.length ? { files: ids } : {}; },
      clear: () => { for (const p of list()) if (p.preview) URL.revokeObjectURL(p.preview); pendings.delete(key); },
    };
  }
  /** Read URLs asked from the hub in batches, asked again before they expire (10 min on the S3 side). */
  let askTimer: number | undefined;
  function urlFor(fid: string): string | null {
    const u = fileUrls.get(fid);
    if (u && u.exp > Date.now()) return u.url;
    if (!asked.has(fid)) {
      asked.add(fid);
      clearTimeout(askTimer);
      askTimer = window.setTimeout(() => {
        const ids = [...asked]; asked.clear();
        for (let i = 0; i < ids.length; i += 50) send({ type: 'files', ids: ids.slice(i, i + 50) });
      }, 30);
    }
    return null;
  }
  /** An image that loads makes the thread or the Lounge feed longer: we stay stuck to the bottom if we were there,
   *  read from the state before the growth (any image height); a scroller not tracked keeps the 500 px heuristic. */
  const stickToBottom = (e: Event) => {
    const c = (e.target as HTMLElement).closest('.msgs, .feed-msgs');
    if (c && !d.keepAtEnd(c) && c.scrollHeight - c.scrollTop - c.clientHeight < 500) c.scrollTop = c.scrollHeight;
  };
  function filesEl(m: Message) {
    if (!m.files?.length) return null;
    const imgs = m.files.filter(f => isImg(f.mime)), vids = m.files.filter(f => isVideo(f.mime)), auds = m.files.filter(f => isAudio(f.mime));
    const docs = m.files.filter(f => !isImg(f.mime) && !isVideo(f.mime) && !isAudio(f.mime));
    return h('div', { class: 'files' },
      imgs.length ? h('div', { class: 'imgs' }, ...imgs.map(f => {
        const u = urlFor(f.id);
        return u ? h('div', { class: 'media', 'data-fid': f.id },
            h('a', { href: u, target: '_blank', rel: 'noopener noreferrer', title: f.name,
              // Plain click: in-app viewer; Cmd/Ctrl/Shift/middle click keep the link's new tab or window.
              onclick: (e: MouseEvent) => { if (opensViewer(e)) { e.preventDefault(); openViewer(m.thread, f.id); } } }, h('img', { src: u, alt: f.name, loading: 'lazy', onload: stickToBottom })), dlButton(f))
          : h('div', { class: 'img-ph' }, f.name);
      })) : null,
      ...vids.map(videoEl),
      ...auds.map(audioEl),
      ...docs.map(f => {
        const u = urlFor(f.id);
        return h(u ? 'a' : 'span', { class: 'doc', ...(u ? { href: u, rel: 'noopener noreferrer' } : {}) },
          h('span', { class: 'att-ico' }, icon('file') as unknown as Node), h('span', { class: 'att-name' }, f.name), h('span', { class: 'att-meta' }, fmtSize(f.size)));
      }));
  }
  return { noteMentions, attachMentions, pendings, fileUrls, fmtSize, addFiles, onUploadReady, uploadFailed, sendWait, msgText, attachments, urlFor, stickToBottom, filesEl };
}
/** A composer's attachments (`attachments()` above). */
export type Attachments = ReturnType<ReturnType<typeof attachmentsModule>['attachments']>;
/** The part of main.ts' app state the composer reads or writes. */
export interface ComposerShared {
  me: string; err: string; editing: Editing | null; trusted: Set<string>;
  threads: Map<string, PublicThread>; msgs: Map<string, Map<string, Message>>; presence: Map<string, Presence[]>;
  typing: Typing;
}
export interface ComposerDeps {
  rand(): string;
  cap(s: string): string;
  iconBtn(name: string, text: string, onclick: (e: Event) => void, extra?: Record<string, any>): HTMLElement;
  keyed<T extends Element | null>(el: T, k: string): T;
  costEl(f: PublicThread, where: 'crumb' | 'bar'): HTMLElement | null;
  openSecret(f: PublicThread): void;
  noteMentions(space: string, text: string): void;
  pendings: Map<string, unknown[]>;
  sendWait: Map<string, () => void>;
  /** Voice channel (client/src/previewview.ts). */
  pvOpen(): { voice?: unknown; thread: string } | null;
  openPreview(line: Message): void;
  askVoice(f: PublicThread): void;
  /** Another layer holds Esc and Enter: search palette, profile dialog, image viewer. */
  paletteOn(): boolean;
  profileOn(): boolean;
  viewerOn(): boolean;
}

export function composerModule(k: UiKit, S: ComposerShared, d: ComposerDeps) {
  const { h, icon, t, tn, render, errText, send } = k;
  // ---------------------------------------------------------------- « X is typing… » (client/src/typing.ts)
  const typingOn = new Map<string, number>(); // conversation → when my composer last sent « on »
  function typed(thread: string, text: string) {
    const fr = typingFrame(typingOn.get(thread), text, Date.now());
    if (!fr || !k.post({ type: 'typing.set', thread, ...(fr === 'off' ? { off: true } : {}) })) return;
    if (fr === 'on') typingOn.set(thread, Date.now()); else typingOn.delete(thread);
  }
  /** The line under the conversation, above its composer: the other members typing there (none: nothing). */
  function typingEl(f: PublicThread) {
    const ids = typersOf(S.typing, f.id, Date.now());
    if (!ids.length) return null;
    const names = ids.map(id => k.people(f.space).find(p => p.id === id)?.name ?? k.personName(id) ?? id.slice(0, 6));
    return h('div', { class: 'typing', 'data-k': `typing:${f.id}`, role: 'status', 'aria-live': 'polite' }, tn('typing', names.length, { who: typingWho(names, lang()) }));
  }
  const { rand, cap, iconBtn, keyed, costEl, openSecret, noteMentions, pendings, sendWait, pvOpen, openPreview, askVoice, paletteOn, profileOn, viewerOn } = d;
  // ---------------------------------------------------------------- edit the last message (↑ in the empty composer)
  /**
   * Composer of a conversation (thread or Lounge topic), with the edit of one's last message: ↑ in the empty field opens
   * it (rules in client/src/edit.ts and protocol/edit.ts). While editing, the field holds the edited text (never written
   * to the thread's draft) and Enter / Save sends `message.edit`; while the agent works, a confirm line above the composer
   * offers to stop it first, then waits for its turn end. Returned in `.foot` (display:contents) with the error line:
   * every child keyed, so a hint or the confirm line showing up above the composer keeps it (and its focus) in place.
   * Keys carry the conversation id: the Lounge feed and its open topic render a composer each in the same page, and
   * patch() looks keys up page-wide, so a shared key made morphdom reuse the wrong one and leave a second composer.
   */
  function editableComposer(f: PublicThread, ta: HTMLTextAreaElement, sug: HTMLElement, att: Attachments, post: () => void, grow: Node) {
    // Voice channel open on this conversation: its panel takes the composer's place (voiceDock), the messages stay visible.
    if (pvOpen()?.voice && pvOpen()!.thread === f.id) return h('div', { class: 'vc-host', 'data-k': `vc-host:${f.id}`, 'data-keep': '' });
    const ed = S.editing?.thread === f.id ? S.editing : null, agent = cap(f.owner);
    if (ed?.phase === 'edit') { ta.value = ed.text; on(ta, 'input', (e: Event) => { if (S.editing === ed) ed.text = (e.currentTarget as HTMLTextAreaElement).value; }); }
    else { bindDraft(ta, f.id); on(ta, 'input', (e: Event) => typed(f.id, (e.currentTarget as HTMLTextAreaElement).value)); }
    if (ed && ed.phase !== 'edit') ta.disabled = true; // confirm: Enter goes to « Stop and edit »; stopping: nothing to type yet
    const submit = () => { const e = S.editing?.thread === f.id ? S.editing : null; if (!e) { post(); typed(f.id, cur(ta).value); } else if (e.phase === 'edit') saveEdit(f, ta); else if (e.phase === 'confirm') confirmStop(f); };
    onEnterSend(ta, submit);
    on(ta, 'keydown', (e: KeyboardEvent) => {
      if (e.defaultPrevented) return; // handled by the @ suggestions
      if (e.key === 'Escape' && S.editing?.thread === f.id) { e.preventDefault(); cancelEdit(); return; }
      if (!isEditKey(e, cur(ta).value, !cur(sug).hidden, !!S.editing) || pendings.get(f.id)?.length) return;
      if (startEdit(f)) e.preventDefault();
    });
    const acts = (...kids: Node[]) => h('div', { class: 'ea-acts' }, h('button', { class: 'btn', onclick: cancelEdit }, t('cancel')), ...kids);
    const above = ed?.phase === 'confirm' ? h('div', { class: 'edit-ask', role: 'status' }, h('span', { class: 'ea-t' }, t('edit_ask', { agent })),
        acts(h('button', { class: 'btn pri', onclick: () => confirmStop(f) }, t('edit_stop'))))
      : ed?.phase === 'stopping' ? h('div', { class: 'edit-ask waiting', role: 'status' }, h('span', { class: 'pulse' }), h('span', { class: 'ea-t' }, t('edit_waiting', { agent })), acts())
        : null;
    const bar = ed?.phase === 'edit'
      ? h('div', { class: 'bar' }, h('span', { class: 'grow edit-lbl' }, icon('pencil', 13) as unknown as Node, h('b', {}, t('edit_label')), touchOnly() ? null : h('span', { class: 'edit-keys' }, t('edit_keys'))),
        h('button', { class: 'btn ghost', onclick: cancelEdit }, t('cancel')), h('button', { class: 'btn pri', onclick: submit }, t('save')))
      : h('div', { class: 'bar' }, att.clip, S.trusted.has(f.space) ? iconBtn('key', t('secret_btn', { agent }), () => openSecret(f), { 'data-k': `secret-btn:${f.id}` }) : null, grow, costEl(f, 'bar'), voiceBtn(f), sendBtn(f.id, submit, t('send')));
    return h('div', { class: 'foot' }, S.err ? h('div', { class: 'err', 'data-k': `err:${f.id}` }, S.err) : null, keyed(above, `ask:${f.id}`), typingEl(f),
      h('div', { class: `composer${ed?.phase === 'edit' ? ' editing' : ''}`, 'data-k': `composer:${f.id}`, 'data-th': f.id, ...(ed ? {} : att.drop) }, sug, ed ? null : att.chips, ta, bar));
  }
  /** An agent shares its voice in this conversation (a lead only, like the card's button): « Voice » switches the composer
   *  to the voice mode (voiceDock). The tap closes the keyboard first: the textarea leaves with it anyway. */
  function voiceBtn(f: PublicThread) {
    if (f.general) return null; // General: no agent turn there
    const act = voiceAction(S.msgs.get(f.id)?.values() ?? [], S.trusted.has(f.space), canTalk(voiceAgentOf(f), S.presence.get(f.space)));
    if (!act) return null;
    const agent = act === 'ask' ? voiceAgentOf(f) : act.line.preview!.agent;
    return h('button', { class: 'btn vc-go', type: 'button', 'data-k': `vc-go:${f.id}`, title: t('voice_mode_tip', { agent: cap(agent) }),
      onclick: () => { (document.activeElement as HTMLElement | null)?.blur(); if (act === 'ask') askVoice(f); else openPreview(act.line); } }, icon('mic', 14) as unknown as Node, t('voice_mode'));
  }
  /** The agent a « Voice » tap asks in this conversation (preview.ts voiceAgent, same rule as the hub). */
  const voiceAgentOf = (th: PublicThread) => voiceAgent(S.msgs.get(th.id)?.values() ?? [], th.owner, th.kind === 'topic');
  /** Send button of a composer; while its draft waits on a recording or an upload: disabled, spinner, « Sending… ».
   *  The press keeps the focus in the textarea (no `pointerdown`/`mousedown` default): on a phone, losing it closed the
   *  keyboard and resized the page between touch and click, so the click missed the moved button and nothing was sent
   *  (same remedy as ionic-team/ionic-plugin-keyboard#81 for a Send button). Once sent, the textarea is blurred on
   *  purpose: the keyboard closes after the post, never instead of it. */
  function sendBtn(key: string, go: () => void, text: string) {
    const hold = (e: Event) => e.preventDefault();
    const tap = () => { go(); const a = document.activeElement; if (a instanceof HTMLTextAreaElement) a.blur(); };
    if (!sendWait.has(key)) return h('button', { class: 'btn pri', onpointerdown: hold, onmousedown: hold, onclick: tap }, text);
    const svg = icon('run', 14); svg.setAttribute('class', 'spin');
    return h('button', { class: 'btn pri sending', disabled: true, 'aria-busy': 'true' }, svg as unknown as Node, t('sending'));
  }
  /** ↑ in the empty composer, or the pencil: open the edit of my last message (or the stop confirm), else say why. */
  function startEdit(f: PublicThread): boolean {
    const r = onUp(S.msgs.get(f.id)?.values() ?? [], S.me, f.state === 'run', S.trusted.has(f.space));
    if (!r) return false;
    if (r.kind === 'hint') { editHint(r.hint, cap(f.owner)); render(); }
    else if (r.kind === 'edit') openEdit(editOf(r.msg));
    else { S.err = ''; S.editing = { ...editOf(r.msg), phase: 'confirm' }; render(); setTimeout(() => (document.querySelector(`[data-th="${CSS.escape(f.id)}"]`)?.parentElement?.querySelector('.edit-ask .btn.pri') as HTMLElement | null)?.focus()); }
    return true;
  }
  /** Opens the edit mode: text in the composer, focused, caret at the end; the message scrolled into view if needed. */
  function openEdit(e: Editing) {
    S.err = ''; S.editing = e; render();
    setTimeout(() => {
      const ta = document.querySelector(`.composer[data-th="${CSS.escape(e.thread)}"] textarea`) as HTMLTextAreaElement | null;
      if (!ta || S.editing !== e) return;
      ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
      document.querySelector(`[data-k="m:${CSS.escape(e.msg)}"]`)?.scrollIntoView({ block: 'nearest' });
    });
  }
  /** Esc / Cancel: nothing sent, the composer goes back to the (empty) draft. A turn stopped for this edit stays stopped. */
  function cancelEdit() {
    if (!S.editing) return;
    const th = S.editing.thread;
    S.editing = null; render();
    setTimeout(() => (document.querySelector(`.composer[data-th="${CSS.escape(th)}"] textarea`) as HTMLTextAreaElement | null)?.focus());
  }
  function confirmStop(f: PublicThread) {
    const e = S.editing;
    if (e?.thread !== f.id || e.phase !== 'confirm') return;
    if (send({ type: 'turn.stop', thread: f.id })) e.phase = 'stopping';
    render();
  }
  /** While waiting for the stop (called by render()): open the edit once the turn is over, or say why it can't be. */
  function stepStop(e: Editing) {
    const f = S.threads.get(e.thread), msgs = S.msgs.get(e.thread);
    if (!f || !msgs) return;
    const r = afterStop(msgs.values(), e.msg, S.me, f.state === 'run');
    if (r === 'wait') return;
    const m = msgs.get(e.msg);
    if (r === 'edit' && m) { const next = editOf(m); S.editing = next; setTimeout(() => { if (S.editing === next) openEdit(next); }); }
    else { S.editing = null; editHint(r, cap(f.owner)); }
  }
  function saveEdit(f: PublicThread, ta: HTMLTextAreaElement) {
    const e = S.editing;
    if (e?.thread !== f.id) return;
    e.text = cur(ta).value;
    const a = saveAction(e, !!S.msgs.get(f.id)?.get(e.msg)?.files?.length);
    if (a === 'leave') { cancelEdit(); return; }
    if (a === 'keep') return;
    const cid = rand().slice(0, 20), text = e.text.trim() || ' '; // like a post: a message of files only carries ' '
    if (send({ type: 'message.edit', client_id: cid, thread: f.id, msg: e.msg, rev: e.rev, text })) { e.cid = cid; noteMentions(f.space, text); }
    render();
  }
  /** Why the edit can't be done (↑ refused, or the hub's refusal): a short hint in the error line, gone after a while. */
  function editHint(code: string, agent: string) {
    const k = `edit_${code}`, text = hasKey(k) ? t(k, { agent }) : errText(code);
    S.err = text;
    window.setTimeout(() => { if (S.err === text) { S.err = ''; render(); } }, 6000);
  }
  // Esc cancels the edit wherever the focus is (confirm and stopping disable the field); Enter confirms the stop.
  document.addEventListener('keydown', (e) => {
    const ed = S.editing;
    if (!ed || e.defaultPrevented || paletteOn() || profileOn() || viewerOn()) return;
    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
    else if (e.key === 'Enter' && ed.phase === 'confirm' && !(e.target as Element | null)?.closest?.('button, input, textarea, select, a')) {
      const f = S.threads.get(ed.thread); if (f) { e.preventDefault(); confirmStop(f); }
    }
  });
  // Like Slack: Enter sends, Shift+Enter goes to a new line. No send during an IME composition (dead keys, etc.).
  // The @ autocompletion intercepts Enter before (listens in the capture phase).
  // Touch screen without a mouse (phone keyboard, no Shift): Enter goes to a new line, the Send button sends (like Slack mobile).
  // Message fields: no browser AutoFill (iOS offered to fill a contact address or a login in the composer). A hint only,
  // Safari may still guess from the context.
  const NO_AUTOFILL = { autocomplete: 'off', name: 'message' };
  const touchOnly = () => matchMedia('(hover: none) and (pointer: coarse)').matches;
  function onEnterSend(ta: HTMLTextAreaElement, go: () => void) {
    on(ta, 'keydown', (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229 || touchOnly()) return;
      e.preventDefault(); go();
    });
  }
  const drafts = new Map<string, string>();   // input in progress per thread (kept when switching threads)
  function bindDraft(el: HTMLInputElement | HTMLTextAreaElement, key: string) {
    el.value = drafts.get(key) ?? '';
    el.dataset.draft = key;
    on(el, 'input', (e: Event) => drafts.set(key, (e.currentTarget as HTMLInputElement).value));
  }
  return { editableComposer, voiceAgentOf, sendBtn, startEdit, stepStop, editHint, NO_AUTOFILL, touchOnly, onEnterSend, drafts, bindDraft };
}
