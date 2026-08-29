import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { UsageEvent } from '../types.js';

/**
 * Gemini CLI (google-gemini/gemini-cli) source — detection only for now.
 *
 * Session data is expected under ~/.gemini/tmp/<project-hash>/ (checkpoint
 * chats plus logs), but the exact files that record per-turn token usage
 * have not been verified against real artifacts — this machine has the
 * ~/.gemini config but no session data.
 *
 * TODO(v0.5+): verify the on-disk format against the gemini-cli source
 * (checkpoint/SessionBrowser serialization and OTEL telemetry paths), decide
 * whether per-turn usage is recoverable locally at all, then implement and
 * test against real session files.
 */

export function defaultDataDir(): string {
  return path.join(os.homedir(), '.gemini', 'tmp');
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
