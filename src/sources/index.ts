import { promises as fs } from 'node:fs';
import type { SourceInfo, UsageEvent } from '../types.js';
import * as claudeCode from './claude-code.js';
import * as codex from './codex.js';
import * as dsh from './dsh.js';
import * as opencode from './opencode.js';
import * as geminiCli from './gemini-cli.js';

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
  status: SourceInfo['status'];
  collectEvents(): Promise<UsageEvent[]>;
}

export class SourceLoadError extends Error {
  readonly failures: string[];

  constructor(failures: string[]) {
    super(`Unable to produce a complete usage report. ${failures.join('; ')}`);
    this.name = 'SourceLoadError';
    this.failures = failures;
  }
}

export const SOURCES: AgentSource[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    dataDir: claudeCode.defaultDataDir,
    status: 'supported',
    isDetected: () => pathExists(claudeCode.defaultDataDir()),
    collectEvents: () => claudeCode.collectEvents(),
  },
  {
    id: 'codex',
    name: 'Codex (OpenAI)',
    dataDir: codex.defaultDataDir,
    status: 'supported',
    isDetected: () => codex.isDetected(),
    collectEvents: () => codex.collectEvents(),
  },
  {
    id: 'dsh',
    name: 'DeepSeek Harness',
    dataDir: dsh.defaultDataDir,
    status: 'detection-only',
    isDetected: () => dsh.isDetected(),
    collectEvents: () => dsh.collectEvents(),
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    dataDir: opencode.defaultDataDir,
    status: 'detection-only',
    isDetected: () => opencode.isDetected(),
    collectEvents: () => opencode.collectEvents(),
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    dataDir: geminiCli.defaultDataDir,
    status: 'detection-only',
    isDetected: () => geminiCli.isDetected(),
    collectEvents: () => geminiCli.collectEvents(),
  },
];

export async function detectSources(): Promise<SourceInfo[]> {
  return Promise.all(
    SOURCES.map(async (s) => ({
      id: s.id,
      name: s.name,
      dataDir: s.dataDir(),
      detected: await s.isDetected(),
      status: s.status,
    })),
  );
}

/** Collect events from all detected sources, deduped by provider message id. */
export async function loadEvents(): Promise<UsageEvent[]> {
  const all: UsageEvent[] = [];
  const failures: string[] = [];
  for (const source of SOURCES) {
    if (!(await source.isDetected())) continue;
    try {
      all.push(...(await source.collectEvents()));
    } catch (err) {
      failures.push(`${source.id}: ${(err as Error).message}`);
    }
  }

  if (failures.length > 0) {
    throw new SourceLoadError(failures);
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
