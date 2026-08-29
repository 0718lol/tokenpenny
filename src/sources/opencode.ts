import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { UsageEvent } from '../types.js';

/**
 * OpenCode (sst/opencode) source — detection only for now.
 *
 * Data root verified from packages/core/src/global.ts: XDG data dir + "opencode"
 * (macOS/Linux: ~/.local/share/opencode, honors $XDG_DATA_HOME).
 *
 * Storage has moved from the older JSON-per-message layout into an SQLite
 * database (see packages/core/src/database/migration/, e.g.
 * normalize_storage_paths.ts, session_message_projection_indexes.ts), with the
 * message schema exported from the @opencode-ai/schema package.
 *
 * TODO(v0.5+): confirm the .db filename and message/projection table shapes
 * from the migrations, then read usage (tokens/cost per assistant message)
 * via node:sqlite — noting it requires a runtime flag on Node 20/22, which
 * affects the engines range. Real .db files from an actual install are the
 * fastest way to implement and test this.
 */

export function defaultDataDir(): string {
  return path.join(
    process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share'),
    'opencode',
  );
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
