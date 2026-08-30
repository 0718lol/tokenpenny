import type { UsageEvent } from '../types.js';
import { eventCost } from './pricing.js';

/**
 * 5-hour billing windows, the cadence Claude subscription quota runs on:
 * each block starts at the first event that does not fit into the previous
 * block's window. Block "end" is the nominal window end (start + 5h) — the
 * last block may still be open, which callers surface as "active".
 */
export interface UsageBlock {
  start: string;
  end: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUSD: number;
  unknownModelRequests: number;
  models: string[];
}

export function buildBlocks(events: UsageEvent[], windowHours = 5): UsageBlock[] {
  const windowMs = windowHours * 3_600_000;
  const sorted = events
    .filter((e) => e.timestamp && !isNaN(Date.parse(e.timestamp)))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const blocks: UsageBlock[] = [];
  let cur: UsageBlock | null = null;

  for (const e of sorted) {
    if (!cur || Date.parse(e.timestamp) >= Date.parse(cur.start) + windowMs) {
      cur = {
        start: e.timestamp,
        end: new Date(Date.parse(e.timestamp) + windowMs).toISOString(),
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUSD: 0,
        unknownModelRequests: 0,
        models: [],
      };
      blocks.push(cur);
    }
    const cost = eventCost(e);
    cur.requests++;
    cur.inputTokens += e.inputTokens;
    cur.outputTokens += e.outputTokens;
    cur.cacheReadTokens += e.cacheReadTokens;
    cur.cacheWriteTokens += e.cacheWriteTokens;
    cur.costUSD += cost ?? 0;
    if (cost === null) cur.unknownModelRequests++;
    if (e.model && !cur.models.includes(e.model)) cur.models.push(e.model);
  }
  return blocks;
}
