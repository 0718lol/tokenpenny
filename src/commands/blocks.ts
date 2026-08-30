import { aggregate, parseSince } from '../core/aggregate.js';
import { buildBlocks, type UsageBlock } from '../core/blocks.js';
import { fmtInt, fmtTokens, fmtUSD, table } from '../core/format.js';
import { loadEvents } from '../sources/index.js';
import type { Totals } from '../types.js';

export interface BlocksOptions {
  since?: string;
  top?: string;
  json?: boolean;
}

export async function blocks(options: BlocksOptions): Promise<void> {
  const since = parseSince(options.since ?? '30d');
  const all = await loadEvents();
  if (all.length === 0) {
    console.log('No usage events found. Detected no readable agent session logs.');
    return;
  }
  const events = since ? all.filter((e) => e.timestamp >= since) : all;
  const built = buildBlocks(events);
  if (built.length === 0) {
    console.log('No usage events in the requested window.');
    return;
  }

  const now = Date.now();
  const active = built[built.length - 1].end > new Date(now).toISOString();

  let shown = built;
  if (options.top) {
    const n = Math.max(1, Number(options.top));
    shown = built.slice(-n); // most recent n blocks
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          since,
          windowHours: 5,
          activeLastBlock: active,
          blocks: built.map((b, i) => ({ ...b, active: i === built.length - 1 && active })),
        },
        null,
        2,
      ),
    );
    return;
  }

  const rows = shown.map((b) => [
    b.start.slice(0, 16).replace('T', ' '),
    b.end.slice(11, 16),
    fmtInt(b.requests),
    fmtTokens(b.inputTokens),
    fmtTokens(b.outputTokens),
    fmtTokens(b.cacheReadTokens),
    fmtTokens(b.cacheWriteTokens),
    fmtUSD(b.costUSD),
    b.models.slice(0, 2).join('+') + (b.models.length > 2 ? ` +${b.models.length - 2}` : ''),
  ]);
  console.log(
    table(
      ['Block start', 'Ends', 'Reqs', 'Input', 'Output', 'Cache R', 'Cache W', 'Cost', 'Models'],
      rows,
      [2, 3, 4, 5, 6, 7],
    ),
  );
  console.log('');
  const totals = totalsOf(built);
  console.log(
    `TOTAL ${fmtInt(totals.requests)} reqs, ${fmtTokens(totals.inputTokens)} in, ${fmtTokens(totals.outputTokens)} out, ${fmtUSD(totals.costUSD)}`,
  );
  if (active) {
    const last = built[built.length - 1];
    console.log(`* last block is ACTIVE until ${last.end.slice(11, 16)} UTC`);
  }
  if (totals.unknownModelRequests > 0) {
    console.log(
      `? ${fmtInt(totals.unknownModelRequests)} requests on unpriced models — counted, costed at $0`,
    );
  }
}

function totalsOf(blocks: UsageBlock[]): Totals {
  const t: Totals = {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUSD: 0,
    unknownModelRequests: 0,
  };
  for (const b of blocks) {
    t.requests += b.requests;
    t.inputTokens += b.inputTokens;
    t.outputTokens += b.outputTokens;
    t.cacheReadTokens += b.cacheReadTokens;
    t.cacheWriteTokens += b.cacheWriteTokens;
    t.costUSD += b.costUSD;
    t.unknownModelRequests += b.unknownModelRequests;
  }
  return t;
}
