// Audio recorder of the composer (MediaRecorder). Its own file since the modules refactor: main.ts' composer reads
// `rec` (recording here or not, its start) and calls `recStart` / `recStop`.
import type { UiKit } from './modules.ts';
import { baseMime, recMime, recName, fmtDur, REC_MAX_MS, REC_BITS } from './audio.ts';

/** The part of main.ts' app state the recorder writes. */
export interface RecorderShared { err: string }
export interface RecorderDeps {
  /** Adds files to the pending attachments of a draft (same path as a dropped file). */
  addFiles(key: string, space: string, list: File[]): void;
  /** A send that waited for the recording goes now. */
  sendReady(): void;
}

export function recorder(k: UiKit, S: RecorderShared, d: RecorderDeps) {
  const { t, render } = k;
  const { addFiles, sendReady } = d;
  // ---------------------------------------------------------------- audio: recorder
  // MediaRecorder (native, no dependency). The recording belongs to one composer (draft key); Stop turns it into a
  // pending attachment of that draft (same upload path as a dropped file), Cancel drops it. The microphone is released
  // as soon as the recording ends. Auto stop at REC_MAX_MS.
  const rec = { key: '', space: '', mr: null as MediaRecorder | null, stream: null as MediaStream | null, chunks: [] as Blob[], start: 0, timer: 0, cancel: false };
  async function recStart(key: string, space: string) {
    if (rec.mr) return;
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { S.err = t('rec_denied'); render(); return; }
    const want = recMime(m => MediaRecorder.isTypeSupported(m));
    let mr: MediaRecorder;
    try { mr = new MediaRecorder(stream, { ...(want ? { mimeType: want } : {}), audioBitsPerSecond: REC_BITS }); }
    catch { for (const tr of stream.getTracks()) tr.stop(); S.err = t('rec_unsupported'); render(); return; }
    Object.assign(rec, { key, space, mr, stream, chunks: [], start: Date.now(), cancel: false });
    mr.ondataavailable = (e: BlobEvent) => { if (e.data.size) rec.chunks.push(e.data); };
    mr.onstop = () => {
      const type = baseMime(mr.mimeType || want) || 'audio/webm', chunks = rec.chunks, keep = !rec.cancel;
      for (const tr of rec.stream?.getTracks() ?? []) tr.stop();
      clearInterval(rec.timer);
      Object.assign(rec, { key: '', space: '', mr: null, stream: null, chunks: [], timer: 0 });
      if (keep && chunks.length) addFiles(key, space, [new File(chunks, recName(new Date(), type), { type })]); else { sendReady(); render(); }
    };
    mr.start(1000);
    rec.timer = window.setInterval(() => {
      const ms = Date.now() - rec.start;
      for (const el of document.querySelectorAll('.rec-time')) el.textContent = fmtDur(ms / 1000);
      if (ms >= REC_MAX_MS) recStop(false);
    }, 250);
    render();
  }
  function recStop(cancel: boolean) { if (rec.mr && rec.mr.state !== 'inactive') { rec.cancel = cancel; rec.mr.stop(); } }
  return { rec, recStart, recStop };
}
