import { aggregate } from '../core/aggregate.js';
import { buildBlocks } from '../core/blocks.js';
import { fmtUSD } from '../core/format.js';
import { loadEvents } from '../sources/index.js';

/**
 * One-line summary for Claude Code's status line. Wire it up in
 * ~/.claude/settings.json:
 *   "statusLine": { "type": "command", "command": "npx tokenpenny statusline" }
 * Claude Code pipes session JSON to stdin; we deliberately don't need it —
 * everything shown comes from local usage data.
 */
export async function statusline(): Promise<void> {
  const events = await loadEvents();
  if (events.length === 0) {
    console.log('🪙 tokenpenny: no usage data found');
    return;
  }

  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);
  const today = aggregate(
    events.filter((e) => e.timestamp.slice(0, 10) === todayKey),
    'model',
    null,
  );
  const allTime = aggregate(events, 'project', null).totals;

  let blockPart = '';
  const blocks = buildBlocks(events);
  const last = blocks[blocks.length - 1];
  if (last && last.end > now.toISOString()) {
    const elapsedH = Math.max((now.getTime() - Date.parse(last.start)) / 3_600_000, 0.05);
    blockPart = ` · ⏱ ${fmtUSD(last.costUSD)} (~${fmtUSD(last.costUSD / elapsedH)}/h)`;
  }

  console.log(
    `🪙 ${fmtUSD(today.totals.costUSD)} today${blockPart} · Σ ${fmtUSD(allTime.costUSD)}`,
  );
}
