import type { Aggregates, GroupBy } from '../types.js';

export function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

export function fmtTokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

export function fmtUSD(n: number): string {
  return `$${n.toFixed(2)}`;
}

function pad(s: string, width: number, right = false): string {
  return right ? s.padStart(width) : s.padEnd(width);
}

/** Render a plain-text table. `rightAlign` lists column indexes padded right. */
export function table(headers: string[], rows: string[][], rightAlign: number[] = []): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)),
  );
  const line = (cells: string[]) =>
    cells.map((c, i) => pad(c, widths[i], rightAlign.includes(i))).join('  ');
  const out = [line(headers), widths.map((w) => '-'.repeat(w)).join('  ')];
  for (const r of rows) out.push(line(r));
  return out.join('\n');
}

const HEADERS: Record<GroupBy, string[]> = {
  project: ['Project', 'Reqs', 'Input', 'Output', 'Cache R', 'Cache W', 'Cost'],
  day: ['Day', 'Reqs', 'Input', 'Output', 'Cache R', 'Cache W', 'Cost'],
  model: ['Model', 'Reqs', 'Input', 'Output', 'Cache R', 'Cache W', 'Cost'],
  source: ['Source', 'Reqs', 'Input', 'Output', 'Cache R', 'Cache W', 'Cost'],
  session: ['Session', 'Reqs', 'Input', 'Output', 'Cache R', 'Cache W', 'Cost'],
  branch: ['Branch', 'Reqs', 'Input', 'Output', 'Cache R', 'Cache W', 'Cost'],
};

export function renderReport(agg: Aggregates): string {
  const headers = HEADERS[agg.groupBy];
  const rows = agg.groups.map((g) => [
    g.key,
    fmtInt(g.requests),
    fmtTokens(g.inputTokens),
    fmtTokens(g.outputTokens),
    fmtTokens(g.cacheReadTokens),
    fmtTokens(g.cacheWriteTokens),
    fmtUSD(g.costUSD),
  ]);
  rows.push([
    'TOTAL',
    fmtInt(agg.totals.requests),
    fmtTokens(agg.totals.inputTokens),
    fmtTokens(agg.totals.outputTokens),
    fmtTokens(agg.totals.cacheReadTokens),
    fmtTokens(agg.totals.cacheWriteTokens),
    fmtUSD(agg.totals.costUSD),
  ]);

  const lines: string[] = [table(headers, rows, [1, 2, 3, 4, 5, 6])];
  if (agg.unknownModels.length > 0) {
    lines.push('');
    lines.push(
      `? ${agg.totals.unknownModelRequests} requests on unpriced models (${agg.unknownModels.join(', ')}) — counted, costed at $0`,
    );
  }
  return lines.join('\n');
}
