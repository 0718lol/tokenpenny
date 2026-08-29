import { promises as fs } from 'node:fs';
import type { SourceInfo, UsageEvent } from '../types.js';
import * as claudeCode from './claude-code.js';
import * as codex from './codex.js';

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Every agent tokenpenny can read is registered here. Adding a new agent =
 * implementing this interface and pushing one entry — see README "Add an agent".
 */
export interface AgentSource {
  id: string;
  name: string;
  dataDir(): string;
  isDetected(): Promise<boolean>;
  collectEvents(): Promise<UsageEvent[]>;
}

export const SOURCES: AgentSource[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    dataDir: claudeCode.defaultDataDir,
    isDetected: () => pathExists(claudeCode.defaultDataDir()),
    collectEvents: () => claudeCode.collectEvents(),
  },
  {
    id: 'codex',
    name: 'Codex (OpenAI)',
    dataDir: codex.defaultDataDir,
    isDetected: () => codex.isDetected(),
    collectEvents: () => codex.collectEvents(),
  },
];

export async function detectSources(): Promise<SourceInfo[]> {
  return Promise.all(
    SOURCES.map(async (s) => ({
      id: s.id,
      name: s.name,
      dataDir: s.dataDir(),
      detected: await s.isDetected(),
    })),
  );
}

/** Collect events from all detected sources, deduped by provider message id. */
export async function loadEvents(): Promise<UsageEvent[]> {
  const all: UsageEvent[] = [];
  for (const source of SOURCES) {
    if (!(await source.isDetected())) continue;
    try {
      all.push(...(await source.collectEvents()));
    } catch (err) {
      console.error(`! failed to read ${source.id}: ${(err as Error).message}`);
    }
  }

  const seen = new Set<string>();
  return all.filter((e) => {
    if (!e.messageId) return true;
    const key = `${e.source}:${e.messageId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
