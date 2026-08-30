import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * List prices in USD per 1M tokens.
 *
 * Two layers, first match wins:
 *   1. the hand-curated table below (models we verified ourselves)
 *   2. the vendored LiteLLM pricing snapshot (data/model-prices.json,
 *      refreshed monthly by CI — see scripts/update-prices.mjs)
 *
 * Snapshot keys carry provider prefixes (e.g. "azure_ai/grok-4"), so lookup
 * falls back to longest-prefix matching over a suffix index (key minus its
 * provider path), with a boundary check so "grok-4" never prices "grok-40".
 * Anything unmatched returns null — callers must surface that as "unpriced",
 * never guess.
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
];

interface SnapshotEntry {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

const SNAPSHOT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'data',
  'model-prices.json',
);

let exact: Map<string, SnapshotEntry> | null = null;
let suffixes: Map<string, SnapshotEntry> | null = null;
let memo = new Map<string, ModelPrice | null>();

/** Replace the snapshot in-memory; used by tests to stay deterministic. */
export function setPriceSnapshot(models: Record<string, SnapshotEntry> | null): void {
  exact = models ? new Map(Object.entries(models)) : null;
  suffixes = null;
  memo = new Map();
}

function loadSnapshot(): void {
  if (exact !== null) return;
  try {
    const parsed = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as {
      models?: Record<string, SnapshotEntry>;
    };
    setPriceSnapshot(parsed.models ?? {});
  } catch {
    setPriceSnapshot({}); // snapshot missing/unreadable: legacy table still applies
  }
}

function buildSuffixIndex(): Map<string, SnapshotEntry> {
  if (suffixes !== null) return suffixes;
  suffixes = new Map();
  for (const [key, entry] of exact ?? []) {
    const candidates = [key];
    const lastSlash = key.lastIndexOf('/');
    if (lastSlash !== -1) candidates.push(key.slice(lastSlash + 1));
    const base = candidates[candidates.length - 1];
    const firstDot = base.indexOf('.');
    if (firstDot !== -1) {
      const namespace = base.slice(0, firstDot);
      // Strip vendor namespaces ("moonshotai.kimi-k2.5" -> "kimi-k2.5") but
      // never version fragments ("gpt-5.6-sol" must not index "5.6-sol")
      if (!/\d/.test(namespace)) candidates.push(base.slice(firstDot + 1));
    }
    for (const c of candidates) {
      if (!suffixes.has(c)) suffixes.set(c, entry);
    }
  }
  return suffixes;
}

function fromSnapshot(model: string): ModelPrice | null {
  loadSnapshot();
  const cached = memo.get(model);
  if (cached !== undefined) return cached;

  let result: ModelPrice | null = null;
  const hit = (exact ?? new Map()).get(model);
  if (hit) {
    result = toModelPrice(hit);
  } else {
    let best: string | null = null;
    for (const candidate of buildSuffixIndex().keys()) {
      if (candidate.length < 3) continue;
      if (!model.startsWith(candidate)) continue;
      // Boundary check: "grok-4" may match "grok-4.6" but never "grok-40"
      const next = model.charAt(candidate.length);
      if (model.length > candidate.length && next !== '-' && next !== '.') continue;
      if (best === null || candidate.length > best.length) best = candidate;
    }
    if (best !== null) result = toModelPrice(buildSuffixIndex().get(best)!);
  }
  memo.set(model, result);
  return result;
}

function toModelPrice(e: SnapshotEntry): ModelPrice | null {
  if (e.input == null && e.output == null) return null;
  const price: ModelPrice = {
    input: e.input ?? 0,
    output: e.output ?? 0,
  };
  if (e.cacheRead != null) price.cacheRead = e.cacheRead;
  if (e.cacheWrite != null) price.cacheWrite = e.cacheWrite;
  return price;
}

export function priceFor(model: string | null): ModelPrice | null {
  if (!model) return null;
  const override = loadOverrides().get(model);
  if (override) return override;
  const entry = PRICES.find((p) => p.match.test(model));
  if (entry) return entry.price;
  return fromSnapshot(model);
}

/**
 * User-supplied price overrides, highest priority of all layers. Loaded from
 * ./.tokenpenny.json or ~/.tokenpenny.json (first one found wins):
 *   { "prices": { "my-proxy-model": { "input": 3, "output": 15 } } }
 * USD per 1M tokens. Lets users price proxies/internal aliases correctly.
 */
let overrides: Map<string, ModelPrice> | undefined;

function loadOverrides(): Map<string, ModelPrice> {
  if (overrides !== undefined) return overrides;
  overrides = new Map();
  for (const file of [path.join(process.cwd(), '.tokenpenny.json'), path.join(os.homedir(), '.tokenpenny.json')]) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
        prices?: Record<string, ModelPrice>;
      };
      for (const [model, price] of Object.entries(parsed.prices ?? {})) {
        if (!price || (price.input == null && price.output == null)) continue;
        overrides.set(model, {
          input: price.input ?? 0,
          output: price.output ?? 0,
          ...(price.cacheRead != null && { cacheRead: price.cacheRead }),
          ...(price.cacheWrite != null && { cacheWrite: price.cacheWrite }),
        });
      }
      break; // first existing config wins
    } catch {
      // missing or invalid — try the next location
    }
  }
  return overrides;
}

/** Test hook: replace overrides without touching the filesystem. */
export function setPriceOverrides(map: Record<string, ModelPrice> | null): void {
  overrides = map ? new Map(Object.entries(map)) : new Map();
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
