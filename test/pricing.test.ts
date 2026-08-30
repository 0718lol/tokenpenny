import test from 'node:test';
import assert from 'node:assert/strict';
import { priceFor, setPriceSnapshot } from '../src/core/pricing.js';

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

test('unmatched models stay unpriced — never guessed', () => {
  assert.equal(priceFor('totally-made-up-model-xyz'), null);
  assert.equal(priceFor(null), null);
});
