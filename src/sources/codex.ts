import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { UsageEvent } from '../types.js';

/**
 * Codex (OpenAI) source — detection only for now.
 *
 * TODO(W1): parse session rollouts under ~/.codex/sessions/YYYY/MM/DD/*.jsonl.
 * The rollout format stores token_count events per turn; map them to
 * UsageEvent with source "codex". Empty by default so the registry stays
 * honest about what is implemented.
 */

export function defaultDataDir(): string {
  return path.join(os.homedir(), '.codex', 'sessions');
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
