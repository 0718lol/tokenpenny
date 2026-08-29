import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { UsageEvent } from '../types.js';

/**
 * DeepSeek Harness (DSH) source — detection only for now.
 *
 * Session artifacts are a four-layer format (verified against the community
 * handbook, rc.8, source 141eb6f:
 * https://sandbaseai.github.io/deepseek-harness-handbook/deepseek-harness-session-log-format.html):
 *   1. artifact: .jsonl.zstd or plaintext .jsonl under the configured root
 *   2. frames: header frame + checksummed append frames, concatenated
 *   3. rows: ordinary events plus three packed storage-row types
 *      (text-chunks / reasoning-chunks / tool-call-chunks, seq0-based)
 *   4. logical events: packed rows expand to many assistant/chunk events
 *
 * TODO(v0.5+): decode via the shipped `decodeStorageRecord` codec rather than
 * guessing — the handbook explicitly warns against reimplementing prerelease
 * formats. Needs: a zstd decoder dep (e.g. fzstd), frame/checksum parsing,
 * packed-row delta expansion, and — critically — real artifacts to test
 * against, plus confirmation whether token usage is even recorded in session
 * events. Until then this source only reports detection.
 */

export function defaultDataDir(): string {
  if (process.env.DSH_HOME) return process.env.DSH_HOME;
  return path.join(os.homedir(), '.dsh');
}

export async function isDetected(dataDir: string = defaultDataDir()): Promise<boolean> {
  try {
    await fs.access(dataDir);
    return true;
  } catch {
    return false;
  }
}

export async function collectEvents(_dataDir: string = defaultDataDir()): Promise<UsageEvent[]> {
  return [];
}
