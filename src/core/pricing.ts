/**
 * List prices in USD per 1M tokens. Prefix-matched against model names,
 * so "claude-sonnet-4-5-20250929" matches "claude-sonnet-4".
 * Verified against vendor pricing pages at scaffold time — re-check before release.
 * Unknown models are counted but priced at 0 rather than guessed.
 */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

const PRICES: Array<{ match: RegExp; price: ModelPrice }> = [
  { match: /^claude-opus-4/, price: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 } },
  { match: /^claude-sonnet-4/, price: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
  { match: /^claude-haiku-4/, price: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 } },
  { match: /^claude-3-5-haiku/, price: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 } },
  { match: /^gpt-5/, price: { input: 1.25, output: 10, cacheRead: 0.125 } },
  { match: /^gpt-4\.1/, price: { input: 2, output: 8, cacheRead: 0.5 } },
  { match: /^deepseek-chat/, price: { input: 0.28, output: 0.42, cacheRead: 0.028 } },
  { match: /^deepseek-reasoner/, price: { input: 0.55, output: 2.19, cacheRead: 0.055 } },
  { match: /^gemini-2\.5-flash/, price: { input: 0.3, output: 2.5 } },
  { match: /^gemini-2\.5-pro/, price: { input: 1.25, output: 10 } },
];

export function priceFor(model: string | null): ModelPrice | null {
  if (!model) return null;
  const entry = PRICES.find((p) => p.match.test(model));
  return entry ? entry.price : null;
}

/** Cost of one event in USD, or null when the model has no price entry. */
export function eventCost(e: {
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}): number | null {
  const price = priceFor(e.model);
  if (!price) return null;
  const m = 1e6;
  return (
    (e.inputTokens * price.input +
      e.outputTokens * price.output +
      e.cacheReadTokens * (price.cacheRead ?? 0) +
      e.cacheWriteTokens * (price.cacheWrite ?? 0)) /
    m
  );
}
