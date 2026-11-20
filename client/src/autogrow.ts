// Composer field that grows with its text, from its CSS `min-height` up to its `max-height`, then scrolls inside.
// Browsers with `field-sizing: content` (style.css) do it alone; the others (Firefox, older Safari) get the height
// set here on each input and after each render (a draft restored, the field emptied after a send).

/** Height of the field: the content height bounded by the CSS min and max (a max of 0 or NaN means none). */
export function fitHeight(content: number, min: number, max: number): number {
  const lo = Number.isFinite(min) ? min : 0;
  const hi = Number.isFinite(max) && max > 0 ? max : Infinity;
  return Math.max(lo, Math.min(Math.ceil(content), hi));
}

const native = typeof CSS !== 'undefined' && CSS.supports?.('field-sizing', 'content');

/** Fallback sizing of one field (no-op where the CSS does it). CSSOM property, allowed by the CSP. */
export function autogrow(ta: HTMLTextAreaElement) {
  if (native) return;
  const cs = getComputedStyle(ta);
  ta.style.height = 'auto';
  ta.style.height = `${fitHeight(ta.scrollHeight, parseFloat(cs.minHeight), parseFloat(cs.maxHeight))}px`;
}

export const growAll = (root: ParentNode) => { if (!native) for (const ta of root.querySelectorAll<HTMLTextAreaElement>('.composer textarea')) autogrow(ta); };

if (typeof document !== 'undefined' && !native) {
  document.addEventListener('input', e => { const ta = e.target as Element; if (ta instanceof HTMLTextAreaElement && ta.closest('.composer')) autogrow(ta); });
}
