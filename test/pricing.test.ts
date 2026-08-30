import test from 'node:test';
import assert from 'node:assert/strict';
import { priceFor, eventCost, setPriceSnapshot, setPriceOverrides } from '../src/core/pricing.js';

test('vendored snapshot prices models the hand-curated table lacks', () => {
  const price = priceFor('gpt-5.6-sol'); // real entry in data/model-prices.json
  assert.ok(price, 'gpt-5.6-sol should be priced from the LiteLLM snapshot');
  assert.ok(price!.input > 0 && price!.output > 0);
});

test('hand-curated table still takes priority', () => {
  const price = priceFor('claude-sonnet-4-5');
  assert.deepEqual(price, { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 });
});

test('suffix matching strips provider prefixes with boundary checks', () => {
  const models = {
    'azure_ai/foo-1': { input: 3, output: 15, cacheRead: 0.3 },
    'bedrock/moonshotai.kimi-k2.5': { input: 1, output: 2 },
  };
  setPriceSnapshot(models);
  try {
    // exact key
    assert.deepEqual(priceFor('azure_ai/foo-1'), { input: 3, output: 15, cacheRead: 0.3 });
    // provider prefix stripped by '/'
    assert.deepEqual(priceFor('foo-1'), { input: 3, output: 15, cacheRead: 0.3 });
    // longest prefix wins, boundary '.' allowed: foo-1 prices foo-1.6
    assert.deepEqual(priceFor('foo-1.6'), { input: 3, output: 15, cacheRead: 0.3 });
    // boundary digit must NOT match: foo-1 never prices foo-12
    assert.equal(priceFor('foo-12'), null);
    // "vendor." namespace stripped after '/'
    assert.deepEqual(priceFor('kimi-k2.5'), { input: 1, output: 2 });
  } finally {
    setPriceSnapshot(null); // reload the committed snapshot for other tests
  }
});

test('version fragments are never indexed as suffixes', () => {
  // Regression: "openai/gpt-4.1" used to index "4.1" via the dot-strip rule,
  // so a model named "4.1-anything" would wrongly price as gpt-4.1.
  setPriceSnapshot({ 'openai/gpt-4.1': { input: 2, output: 8 } });
  try {
    assert.deepEqual(priceFor('gpt-4.1'), { input: 2, output: 8 });
    assert.deepEqual(priceFor('gpt-4.1-mini'), { input: 2, output: 8 }); // '-' boundary ok
    assert.equal(priceFor('4.1-mini'), null); // no version-fragment suffix
    assert.equal(priceFor('4.1'), null);
  } finally {
    setPriceSnapshot(null);
  }
});

test('user overrides from .tokenpenny.json win over every other layer', () => {
  setPriceOverrides({ 'my-proxy-model': { input: 99, output: 1 } });
  try {
    assert.deepEqual(priceFor('my-proxy-model'), { input: 99, output: 1 });
    // unpriced elsewhere, priced by override
    assert.ok(Math.abs(eventCost({
      model: 'my-proxy-model',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })! - 100) < 1e-9);
  } finally {
    setPriceOverrides(null);
  }
});

test('unmatched models stay unpriced — never guessed', () => {
  assert.equal(priceFor('totally-made-up-model-xyz'), null);
  assert.equal(priceFor(null), null);
});
