import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectEvents } from '../src/sources/codex.js';
import { aggregate } from '../src/core/aggregate.js';
import { setPriceSnapshot } from '../src/core/pricing.js';

// Isolate from the vendored snapshot so cost expectations stay stable across
// monthly LiteLLM refreshes (each test file runs in its own process).
setPriceSnapshot({ 'gpt-5.6-sol': { input: 1.25, output: 10, cacheRead: 0.125 } });

const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'codex',
);

test('parses per-turn token_count events with input/cache split', async () => {
  const events = await collectEvents(FIXTURE_DIR);
  assert.equal(events.length, 3); // one per token_count line

  const first = events[0];
  // fixture last_token_usage: input 10000 (incl. 4000 cached), output 200
  assert.equal(first.inputTokens, 6000); // 10000 - 4000
  assert.equal(first.cacheReadTokens, 4000);
  assert.equal(first.outputTokens, 200);
  assert.equal(first.model, 'gpt-5.6-sol');
  assert.equal(first.projectPath, '/Users/dev/proj-alpha');
  assert.equal(first.sessionId, '019f0000-0000-7000-8000-0000000000aa');
  assert.equal(first.source, 'codex');
});

test('applies mid-session model switches', async () => {
  const events = await collectEvents(FIXTURE_DIR);
  assert.equal(events[1].model, 'gpt-5.6-sol');
  assert.equal(events[2].model, 'codex-auto-review');
});

test('aggregates codex events and flags unpriced models', async () => {
  const events = await collectEvents(FIXTURE_DIR);
  const agg = aggregate(events, 'model', null);

  // gpt-5.6-sol priced via ^gpt-5 prefix:
  //   turn 1: (6000*1.25 + 200*10 + 4000*0.125)/1M = 0.0100
  //   turn 2: (2000*1.25 + 300*10 + 8000*0.125)/1M = 0.0065
  assert.equal(agg.totals.requests, 3);
  assert.ok(Math.abs(agg.totals.costUSD - 0.0165) < 1e-9);
  assert.equal(agg.totals.unknownModelRequests, 1);
  assert.deepEqual(agg.unknownModels, ['codex-auto-review']);
  assert.equal(agg.groups[0].key, 'gpt-5.6-sol');
  assert.ok(Math.abs(agg.groups[0].costUSD - 0.0165) < 1e-9);
});
