import { aggregate, parseSince } from '../core/aggregate.js';
import { buildBlocks } from '../core/blocks.js';
import { fmtInt, fmtTokens, fmtUSD } from '../core/format.js';
import { detectSources, loadEvents } from '../sources/index.js';
import type { UsageEvent } from '../types.js';

const CLEAR = '\x1b[2J\x1b[H';
const FILLED = '■';
const EMPTY = '□';

export interface WatchOptions {
  interval?: string;
}

function weekKey(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'unknown';
  const day = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - day * 86_400_000).toISOString().slice(0, 10);
}

function bar(elapsedMs: number, totalMs: number, width = 20): string {
  const ratio = Math.min(1, Math.max(0, elapsedMs / totalMs));
  const filled = Math.round(ratio * width);
  return `[${FILLED.repeat(filled)}${EMPTY.repeat(width - filled)}]`;
}

function fmtDuration(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(mins / 60);
  return h > 0 ? `${h}h${String(mins % 60).padStart(2, '0')}m` : `${mins}m`;
}

async function renderOnce(detectedAgents: string, intervalSec: number): Promise<void> {
  const events = await loadEvents();
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);
  const todays: UsageEvent[] = events.filter((e) => e.timestamp.slice(0, 10) === todayKey);
  const todayAgg = aggregate(todays, 'model', null);
  const allAgg = aggregate(events, 'project', null);
  const thisWeekKey = weekKey(now.toISOString());
  const weekAgg = aggregate(events, 'week', null);
  const week = weekAgg.groups.find((g) => g.key === thisWeekKey);

  const blocks = buildBlocks(events);
  const last = blocks[blocks.length - 1];
  const isActive = !!last && last.end > now.toISOString();

  const lines: string[] = [];
  lines.push(`tokenpenny watch — every ${intervalSec}s · Ctrl+C to exit · agents: ${detectedAgents || 'none detected'}`);
  lines.push('');

  if (isActive && last) {
    const elapsed = now.getTime() - Date.parse(last.start);
    const total = Date.parse(last.end) - Date.parse(last.start);
    const rate = last.costUSD / Math.max(elapsed / 3_600_000, 0.05);
    lines.push(
      `Active block  started ${last.start.slice(11, 16)} UTC, ends ${last.end.slice(11, 16)} UTC`,
    );
    lines.push(
      `${bar(elapsed, total)}  ${fmtDuration(elapsed)} / 5h   ${fmtUSD(last.costUSD)} so far   ~${fmtUSD(rate)}/h   projected ${fmtUSD(rate * 5)}`,
    );
    lines.push('');
  } else {
    lines.push('No active 5h block right now.');
    lines.push('');
  }

  lines.push(
    `Today      ${fmtInt(todayAgg.totals.requests)} reqs  ${fmtTokens(todayAgg.totals.inputTokens)} in  ${fmtUSD(todayAgg.totals.costUSD)}`,
  );
  lines.push(
    `This week  ${fmtInt(week?.requests ?? 0)} reqs  ${fmtTokens(week?.inputTokens ?? 0)} in  ${fmtUSD(week?.costUSD ?? 0)}`,
  );
  lines.push(
    `All time   ${fmtInt(allAgg.totals.requests)} reqs  ${fmtTokens(allAgg.totals.inputTokens)} in  ${fmtUSD(allAgg.totals.costUSD)}`,
  );
  if (todayAgg.groups.length > 0) {
    lines.push('');
    lines.push('Top models today:');
    for (const g of todayAgg.groups.slice(0, 3)) {
      lines.push(`  ${g.key.padEnd(24)} ${fmtInt(g.requests)} reqs  ${fmtUSD(g.costUSD)}`);
    }
  }
  if (allAgg.unknownModels.length > 0) {
    lines.push('');
    lines.push(`? unpriced: ${allAgg.unknownModels.join(', ')}`);
  }

  process.stdout.write(CLEAR + lines.join('\n') + '\n');
}

export async function watch(options: WatchOptions = {}): Promise<void> {
  const intervalSec = Math.max(2, Number(options.interval ?? 5) || 5);
  const sources = await detectSources();
  const detectedAgents = sources.filter((s) => s.detected).map((s) => s.name).join(', ');

  // Parse the since flag once up front so bad values fail fast (unused beyond
  // validation today — the dashboard always shows today/week/all-time).
  parseSince('30d');

  await renderOnce(detectedAgents, intervalSec);
  if (!process.stdout.isTTY) return; // piped/CI: render once, no loop

  const timer = setInterval(() => {
    void renderOnce(detectedAgents, intervalSec);
  }, intervalSec * 1000);
  process.on('SIGINT', () => {
    clearInterval(timer);
    process.stdout.write('\ntokenpenny watch closed. May your blocks be cheap.\n');
    process.exit(0);
  });
}
