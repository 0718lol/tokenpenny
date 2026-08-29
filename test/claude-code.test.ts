import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectEvents } from '../src/sources/claude-code.js';
import { aggregate } from '../src/core/aggregate.js';
import { eventCost, priceFor } from '../src/core/pricing.js';
import { renderReport } from '../src/core/format.js';
import type { UsageEvent } from '../src/types.js';

const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'claude-code',
);

function dedupe(events: UsageEvent[]): UsageEvent[] {
  const seen = new Set<string>();
  return events.filter((e) => {
    if (!e.messageId) return true;
    if (seen.has(e.messageId)) return false;
    seen.add(e.messageId);
    return true;
  });
}

test('parses assistant usage lines, skips everything else', async () => {
  const events = await collectEvents(FIXTURE_DIR);
  assert.equal(events.length, 4); // 3 unique + 1 streamed duplicate

  const first = events.find((e) => e.messageId === 'msg_011ABC1')!;
  assert.equal(first.model, 'claude-sonnet-4-5-20250929');
  assert.equal(first.inputTokens, 100);
  assert.equal(first.outputTokens, 50);
  assert.equal(first.cacheReadTokens, 30);
  assert.equal(first.cacheWriteTokens, 20);
  assert.equal(first.projectPath, '/Users/dev/proj-alpha');
  assert.equal(first.gitBranch, 'main');
});

test('dedupes streamed duplicates by message id', async () => {
  const events = dedupe(await collectEvents(FIXTURE_DIR));
  assert.equal(events.length, 3);
});

test('prices known models and flags unknown ones', async () => {
  const events = dedupe(await collectEvents(FIXTURE_DIR));

  const sonnet = events.find((e) => e.messageId === 'msg_011ABC1')!;
  // 100/1M*3 + 50/1M*15 + 30/1M*0.3 + 20/1M*3.75
  assert.ok(Math.abs(eventCost(sonnet)! - 0.001134) < 1e-9);

  const gpt = events.find((e) => e.messageId === 'msg_011ABC2')!;
  assert.ok(Math.abs(eventCost(gpt)! - 0.0125) < 1e-9);

  const kimi = events.find((e) => e.messageId === 'msg_011ABC3')!;
  assert.equal(eventCost(kimi), null);
  assert.equal(priceFor('kimi-k3'), null);
});

test('aggregates by day and by project', async () => {
  const events = dedupe(await collectEvents(FIXTURE_DIR));

  const byDay = aggregate(events, 'day', null);
  assert.equal(byDay.totals.requests, 3);
  assert.ok(Math.abs(byDay.totals.costUSD - 0.013634) < 1e-9);
  assert.equal(byDay.totals.unknownModelRequests, 1);
  assert.deepEqual(byDay.unknownModels, ['kimi-k3']);
  assert.equal(byDay.groups[0].key, '2026-08-02'); // most expensive day first
  assert.ok(Math.abs(byDay.groups[0].costUSD - 0.0125) < 1e-9);

  const byProject = aggregate(events, 'project', null);
  assert.equal(byProject.groups[0].key, 'proj-alpha');
  assert.equal(byProject.groups[0].requests, 2);
});

test('respects the --since boundary', async () => {
  const events = dedupe(await collectEvents(FIXTURE_DIR));
  const agg = aggregate(events, 'day', '2026-08-02T00:00:00Z');
  assert.equal(agg.totals.requests, 2);
});

test('renderReport produces a readable table', async () => {
  const events = dedupe(await collectEvents(FIXTURE_DIR));
  const out = renderReport(aggregate(events, 'model', null));
  assert.match(out, /TOTAL/);
  assert.match(out, /\$0\.01/);
  assert.match(out, /unpriced models \(kimi-k3\)/);
});
