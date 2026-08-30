import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBlocks } from '../src/core/blocks.js';
import { aggregate } from '../src/core/aggregate.js';
import { setPriceSnapshot } from '../src/core/pricing.js';
import type { UsageEvent } from '../src/types.js';

// Isolate from the vendored snapshot so cost expectations stay deterministic.
setPriceSnapshot({ 'claude-sonnet-4': { input: 3, output: 15 } });

function ev(ts: string, input = 1000, output = 1000, model = 'claude-sonnet-4'): UsageEvent {
  return {
    source: 'claude-code',
    sessionId: 's1',
    messageId: null,
    projectPath: '/x',
    gitBranch: null,
    model,
    timestamp: ts,
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}

test('buildBlocks splits events into 5-hour windows', () => {
  const blocks = buildBlocks([
    ev('2026-08-20T10:00:00Z'),
    ev('2026-08-20T12:00:00Z'), // same window (10:00+5h = 15:00)
    ev('2026-08-20T16:00:00Z'), // new block
    ev('2026-08-20T18:00:00Z'), // same as 16:00 block
  ]);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].start, '2026-08-20T10:00:00Z');
  assert.equal(blocks[0].end, '2026-08-20T15:00:00.000Z');
  assert.equal(blocks[0].requests, 2);
  assert.equal(blocks[1].start, '2026-08-20T16:00:00Z');
  assert.equal(blocks[1].requests, 2);
  // 2k in + 2k out per block: (2000*3 + 2000*15)/1M = 0.036
  assert.ok(Math.abs(blocks[0].costUSD - 0.036) < 1e-9);
  assert.deepEqual(blocks[0].models, ['claude-sonnet-4']);
});

test('buildBlocks flags unpriced models per block', () => {
  const blocks = buildBlocks([
    ev('2026-08-20T10:00:00Z', 1000, 1000, 'claude-sonnet-4'),
    ev('2026-08-20T10:10:00Z', 1000, 1000, 'mystery-model'),
  ]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].unknownModelRequests, 1);
  assert.deepEqual(blocks[0].models, ['claude-sonnet-4', 'mystery-model']);
});

test('buildBlocks ignores malformed timestamps', () => {
  const blocks = buildBlocks([ev(''), ev('not-a-date')]);
  assert.equal(blocks.length, 0);
});

test('week groups roll Monday-based, month groups roll calendar-based', () => {
  const events = [
    ev('2026-08-01T10:00:00Z'), // Saturday
    ev('2026-08-02T10:00:00Z'), // Sunday
  ];
  const byWeek = aggregate(events, 'week', null);
  // Both days fall in the week starting Monday 2026-07-27
  assert.equal(byWeek.groups.length, 1);
  assert.equal(byWeek.groups[0].key, '2026-07-27');

  const byMonth = aggregate(events, 'month', null);
  assert.equal(byMonth.groups.length, 1);
  assert.equal(byMonth.groups[0].key, '2026-08');
});

test('a week spanning a month boundary splits cleanly by dimension', () => {
  // 2026-07-27 (Mon) .. 2026-08-02 (Sun): one ISO week, two calendar months
  const events = [ev('2026-07-27T10:00:00Z'), ev('2026-08-01T10:00:00Z')];
  assert.equal(aggregate(events, 'week', null).groups.length, 1);
  assert.equal(aggregate(events, 'month', null).groups.length, 2);
});
