// Applets menu (docs/design-applets.md): the launch form's state, DOM-free so node can test it. The form is rendered by
// briefling from the applet's schema; the hub checks the same rules again (protocol/applets.ts valuesIn), and the same
// pure helper says which fields and options show (appletVisible).
import { acceptOk, appletVisible, valuesIn, type Applet, type AppletValue } from '../../protocol/applets.ts';

/** The form of one launch: typed values per field (a list: its items, empty ones included while typing); in a form in
 * steps, the step shown (index in `steps`; `steps.length` = the summary before Launch). */
export interface AppletForm { id: string; values: Record<string, AppletValue>; step: number }
export type FileState = { status: 'up' | 'ok' | 'err'; ref?: { id: string }; name?: string } | undefined;

export const appletForm = (a: Applet): AppletForm => ({ id: a.id, values: {}, step: 0 });
/** A field's placeholder as shown: a bare value (« 50 », « 52,8 », « 39/44 ») read as one already typed, so it gets the
 * `eg` prefix (« ex. »); a sentence, or one already starting with « ex » / « e.g. », is left as written. Display only:
 * the applet's schema keeps the placeholder untouched. */
export function placeholderShown(p: string | undefined, eg: string): string | undefined {
  const v = p?.trim();
  if (!v) return p;
  if (/^(ex\b|e\.g\.)/i.test(v) || /\s/.test(v) || v.length > 16) return p;
  return `${eg} ${v}`;
}
/** An applet's tint: a hue from its name (stable), in steps of 30° (the tile's CSS classes, the pinned app's icon). */
export function appletHue(name: string): number {
  let hue = 0; for (const ch of name) hue = (hue * 31 + ch.codePointAt(0)!) % 360;
  return Math.floor(hue / 30) * 30;
}
/** Draft key of a file field (the composer's attachment store is keyed by draft). */
export const fileKey = (applet: string, field: string) => `applet:${applet}:${field}`;

/** What the form shows now: fields and options (a file being uploaded counts as there). */
export const formVisible = (a: Applet, f: AppletForm, file: (field: string) => FileState) =>
  appletVisible(a.fields, f.values, Object.fromEntries(a.fields.filter(x => x.kind === 'file' && file(x.id)).map(x => [x.id, true])));

/**
 * What stops the launch: a file of a shown field still uploading, failed or of a type the field does not take
 * (`uploading` / `file` / `type`), else the first faulty shown field (required and empty, too long, not an option,
 * not a number in range, not a date), else null; with the frame's `values` and `files` (hidden fields left out).
 */
export function formState(a: Applet, f: AppletForm, file: (field: string) => FileState):
  { stop: 'uploading' | 'file' | 'type' | 'field'; field?: string } | { values: Record<string, AppletValue>; files: Record<string, string> } {
  const { shown } = formVisible(a, f, file);
  const files: Record<string, string> = {};
  for (const x of a.fields.filter(x => x.kind === 'file' && shown.has(x.id))) {
    const s = file(x.id);
    if (s?.status === 'up') return { stop: 'uploading', field: x.id };
    if (s?.status === 'err') return { stop: 'file', field: x.id };
    if (s && s.name !== undefined && !acceptOk(x.accept, s.name)) return { stop: 'type', field: x.id };
    if (s?.status === 'ok' && s.ref) files[x.id] = s.ref.id;
  }
  // only the shown fields go out: a hidden field's value stays in the form (shown again, it comes back) but not in the frame
  const values = Object.fromEntries(Object.entries(f.values).filter(([k]) => shown.has(k)));
  const v = valuesIn(a, values, files, x => typeof x === 'string' && x.length > 0);
  if ('bad' in v) return { stop: 'field', field: v.bad };
  return v;
}

// ---- form in steps (`a.steps`): pure navigation, the view only renders `f.step`
type Stop = { stop: 'uploading' | 'file' | 'type' | 'field'; field?: string };
/** The steps that show now: those with at least one shown field (a step whose fields are all hidden is skipped). */
export function stepsShown(a: Applet, f: AppletForm, file: (field: string) => FileState): number[] {
  const { shown } = formVisible(a, f, file);
  return (a.steps ?? []).flatMap((s, i) => s.fields.some(id => shown.has(id)) ? [i] : []);
}
/** What stops leaving step `f.step` forward: the first faulty shown field of the steps up to it (the later steps can
 * not change them: a condition only looks at an earlier field), else null. */
export function stepStop(a: Applet, f: AppletForm, file: (field: string) => FileState): Stop | null {
  const upto = new Set((a.steps ?? []).slice(0, f.step + 1).flatMap(s => s.fields));
  const part = { ...a, fields: a.fields.filter(x => upto.has(x.id)) };
  const s = formState(part, { ...f, values: Object.fromEntries(Object.entries(f.values).filter(([k]) => upto.has(k))) }, file);
  return 'stop' in s ? s : null;
}
/** Next: the next step that shows, or the summary (`steps.length`) after the last; refused while the step has a fault. */
export function stepNext(a: Applet, f: AppletForm, file: (field: string) => FileState): AppletForm | Stop {
  const stop = stepStop(a, f, file);
  if (stop) return stop;
  return { ...f, step: stepsShown(a, f, file).find(i => i > f.step) ?? (a.steps?.length ?? 0) };
}
/** Previous: the step that shows before this one (from the summary: the last one), or null on the first. */
export function stepPrev(a: Applet, f: AppletForm, file: (field: string) => FileState): AppletForm | null {
  const i = stepsShown(a, f, file).filter(i => i < f.step).at(-1);
  return i === undefined ? null : { ...f, step: i };
}

/**
 * « Relaunch »: the form prefilled with a run's values, for the fields the applet still has with a value of their kind
 * (the applet may have changed since). Files are never carried over: an attachment belongs to one message, so the
 * person picks them again.
 */
export function prefill(a: Applet, values: Record<string, AppletValue>): AppletForm {
  const out: Record<string, AppletValue> = {};
  for (const x of a.fields) {
    const v = values[x.id];
    if (v === undefined || x.kind === 'file') continue;
    const ok = x.kind === 'checkbox' ? typeof v === 'boolean'
      : x.kind === 'multiselect' || x.kind === 'list' ? Array.isArray(v) && v.every(s => typeof s === 'string') : typeof v === 'string';
    if (ok) out[x.id] = v;
  }
  return { id: a.id, values: out, step: 0 };
}
