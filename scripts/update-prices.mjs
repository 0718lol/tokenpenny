#!/usr/bin/env node
/**
 * Refresh data/model-prices.json from LiteLLM's model pricing database.
 *
 * - Tries raw.githubusercontent.com first, falls back to the GitHub Contents
 *   API (works in sandboxed networks where raw is blocked).
 * - Trims the 2MB source to the four cost fields tokenpenny uses, converted
 *   from USD-per-token to USD-per-1M-tokens.
 * - The snapshot is committed, so the CLI stays 100% offline; CI re-runs this
 *   monthly and opens a PR when prices moved (see .github/workflows/).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'model-prices.json');

function fetchViaCurl() {
  return execFileSync('curl', ['-sfL', '-m', '60', SOURCE_URL], {
    maxBuffer: 32 * 1024 * 1024,
  });
}

function fetchViaGh() {
  // Raw media type: the Contents API's base64 `content` is null for files >1MB
  return execFileSync(
    'gh',
    ['api', '-H', 'Accept: application/vnd.github.raw', 'repos/BerriAI/litellm/contents/model_prices_and_context_window.json'],
    { maxBuffer: 32 * 1024 * 1024 },
  );
}

function fetchRaw() {
  for (const [name, fetcher] of [
    ['curl', fetchViaCurl],
    ['gh api', fetchViaGh],
  ]) {
    try {
      const buf = fetcher();
      if (buf.length > 1000) {
        JSON.parse(buf.toString('utf8')); // validate before trusting
        return buf;
      }
      console.error(`! ${name} returned unusable data (${buf.length} bytes)`);
    } catch (err) {
      console.error(`! ${name} failed: ${String(err.message ?? err).slice(0, 140)}`);
    }
  }
  throw new Error('could not fetch the LiteLLM pricing source');
}

function convert(raw) {
  const models = {};
  let count = 0;
  for (const [key, v] of Object.entries(raw)) {
    if (!v || typeof v !== 'object') continue;
    const { input, output, cacheRead, cacheWrite } = {
      input: v.input_cost_per_token != null ? v.input_cost_per_token * 1e6 : null,
      output: v.output_cost_per_token != null ? v.output_cost_per_token * 1e6 : null,
      cacheRead: v.cache_read_input_token_cost != null ? v.cache_read_input_token_cost * 1e6 : null,
      cacheWrite:
        v.cache_creation_input_token_cost != null ? v.cache_creation_input_token_cost * 1e6 : null,
    };
    if (input == null && output == null) continue; // embeddings/audio without token prices
    const entry = {};
    if (input != null) entry.input = round(input);
    if (output != null) entry.output = round(output);
    if (cacheRead != null) entry.cacheRead = round(cacheRead);
    if (cacheWrite != null) entry.cacheWrite = round(cacheWrite);
    models[key] = entry;
    count++;
  }
  return { count, models };
}

function round(n) {
  return Math.round(n * 1e9) / 1e9; // kill float noise from *1e6
}

const raw = JSON.parse(fetchRaw().toString('utf8'));
const { count, models } = convert(raw);
mkdirSync(path.dirname(OUT), { recursive: true });
const payload = {
  meta: {
    source: 'BerriAI/litellm model_prices_and_context_window.json',
    fetchedAt: new Date().toISOString(),
    entries: count,
  },
  models,
};
writeFileSync(OUT, JSON.stringify(payload));
console.log(`wrote ${OUT}: ${count} priced entries (from ${Object.keys(raw).length} raw)`);
