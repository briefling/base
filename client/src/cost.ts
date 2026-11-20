// LLM spend of a thread (`PublicThread.usage`, summed by the hub): header label and its tooltip. DOM-free (tested).
import type { CostBucket, MetricsSplit, Usage } from '../../protocol/frames.ts';
import { translate, type Lang, type Key } from './i18n.ts';

const money = (l: Lang, n: number, digits: number) => new Intl.NumberFormat(l, { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol',
  minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
/** "$0.42" / "0,42 $": an amount in dollars, no decimals from 100 $, "<$0.01" below a cent. */
export const usdLabel = (usd: number, l: Lang) => usd > 0 && usd < 0.01 ? `<${money(l, 0.01, 2)}` : money(l, usd, usd >= 100 ? 0 : 2);

/** "~$0.42" / "~0,42 $": "~" unless billed by the provider, "+" when some calls could not be priced (lower bound). */
export function costLabel(u: Usage, l: Lang): string {
  return `${u.status === 'actual' ? '' : '~'}${usdLabel(u.usd, l)}${u.status === 'unknown' ? '+' : ''}`;
}

/** Status, then the token detail (one line each), for the `title` of the label. */
export function costTitle(u: Usage, l: Lang): string {
  const tr = (k: Key, p?: Record<string, string | number>) => translate(l, k, p);
  const n = (x: number) => new Intl.NumberFormat(l).format(x);
  const one = new Intl.PluralRules(l).select(u.calls) === 'one';
  return [tr(`cost_${u.status}` as Key), tr('cost_input', { n: n(u.input) }), tr('cost_output', { n: n(u.output), r: n(u.reasoning) }),
    tr('cost_cache_read', { n: n(u.cacheRead) }), tr('cost_cache_write', { n: n(u.cacheWrite) }),
    tr(one ? 'cost_calls_one' : 'cost_calls_other', { n: n(u.calls) })].join('\n');
}

/** One segment of « Where the tokens go »: `pct` = share of the dollars, rounded (0 shown as « <1 » by the view). */
export interface SplitRow { id: CostBucket; usd: number; calls: number; pct: number }
/** Segments by dollars spent, largest first, `unsplit` always last (it is not an activity); empty ones dropped. */
export function splitRows(split: MetricsSplit | undefined): SplitRow[] {
  const rows = (Object.entries(split ?? {}) as [CostBucket, { usd: number; calls: number }][])
    .filter(([, v]) => v.usd > 0 || v.calls > 0).map(([id, v]) => ({ id, usd: v.usd, calls: v.calls }));
  const sum = rows.reduce((s, r) => s + r.usd, 0);
  return rows.map(r => ({ ...r, pct: sum > 0 ? Math.round(100 * r.usd / sum) : 0 }))
    .sort((a, b) => (a.id === 'unsplit' ? 1 : 0) - (b.id === 'unsplit' ? 1 : 0) || b.usd - a.usd || (a.id < b.id ? -1 : 1));
}

/** Reasoning tokens as a share of the output tokens (rounded %); null when the provider reports none (Anthropic counts
 *  thinking in `output_tokens` without a detail, so it reads 0) or there is no output at all. */
export function reasoningShare(u: Usage | null | undefined): number | null {
  if (!u || u.output <= 0 || u.reasoning <= 0) return null;
  return Math.min(100, Math.round(100 * u.reasoning / u.output));
}
