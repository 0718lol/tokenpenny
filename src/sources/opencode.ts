import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { UsageEvent } from '../types.js';

/** OpenCode's current store is SQLite under the XDG data directory. */
export function defaultDataDir(): string {
  return path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share'), 'opencode');
}

export async function isDetected(dataDir: string = defaultDataDir()): Promise<boolean> {
  try { await fs.access(dataDir); return true; } catch { return false; }
}

function nonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function json(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'object' && value !== null) return value as Record<string, unknown>;
  if (typeof value !== 'string') return null;
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' ? parsed : null; } catch { return null; }
}

/** Uses node:sqlite when available (Node 22+); no native dependency is required. */
async function readDatabase(file: string): Promise<UsageEvent[]> {
  const dynamicImport = Function('return import("node:sqlite")') as () => Promise<{ DatabaseSync: new (file: string) => any }>;
  const { DatabaseSync } = await dynamicImport();
  const db = new DatabaseSync(file);
  try {
    const rows = db.prepare(`SELECT m.id, m.session_id, m.time_created, m.data, s.directory
      FROM message m JOIN session s ON s.id = m.session_id`).all() as Array<Record<string, unknown>>;
    return rows.flatMap((row) => {
      const data = json(row.data);
      if (!data || data.role !== 'assistant') return [];
      const tokens = json(data.tokens);
      if (!tokens) return [];
      const cache = json(tokens.cache) ?? {};
      const input = nonNegative(tokens.input);
      const output = nonNegative(tokens.output);
      const cached = nonNegative(cache.read) ?? 0;
      const cacheWrite = nonNegative(cache.write) ?? 0;
      if (input === null || output === null || input + output + cached + cacheWrite === 0) return [];
      const created = nonNegative(data.time && json(data.time)?.created) ?? nonNegative(row.time_created);
      if (created === null) return [];
      return [{ source: 'opencode', sessionId: typeof row.session_id === 'string' ? row.session_id : null, messageId: typeof row.id === 'string' ? row.id : null,
        projectPath: typeof data.path === 'object' && data.path !== null && typeof (data.path as any).cwd === 'string'
          ? (data.path as any).cwd : typeof row.directory === 'string' ? row.directory : null,
        gitBranch: null, model: typeof data.modelID === 'string' ? data.modelID : null,
        timestamp: new Date(created).toISOString(), inputTokens: input, outputTokens: output,
        cacheReadTokens: cached, cacheWriteTokens: cacheWrite } satisfies UsageEvent];
    });
  } finally { db.close(); }
}

export async function collectEvents(dataDir: string = defaultDataDir()): Promise<UsageEvent[]> {
  const entries = await fs.readdir(dataDir).catch(() => [] as string[]);
  const dbs = entries.filter((name) => /^opencode(?:-[\w.-]+)?\.db$/.test(name)).map((name) => path.join(dataDir, name));
  const events: UsageEvent[] = [];
  for (const db of dbs) events.push(...await readDatabase(db));
  return events;
}
