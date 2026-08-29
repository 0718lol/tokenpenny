import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { UsageEvent } from '../types.js';

/**
 * Parser for Claude Code session transcripts under ~/.claude/projects/.
 * Every .jsonl file is scanned, including subagent transcripts inside
 * <session>/subagents/, which carry their own usage.
 *
 * Each line is a JSON event. Billable usage lives on `type: "assistant"`
 * lines under message.usage. Streamed continuations repeat the same
 * message.id, so duplicates are dropped by messageId.
 */

export function defaultDataDir(): string {
  return path.join(os.homedir(), '.claude', 'projects');
}

interface RawAssistantLine {
  type?: string;
  timestamp?: string;
  cwd?: string;
  gitBranch?: string;
  sessionId?: string;
  message?: {
    id?: string;
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
}

export function parseLine(line: string, source = 'claude-code'): UsageEvent | null {
  let d: RawAssistantLine;
  try {
    d = JSON.parse(line) as RawAssistantLine;
  } catch {
    return null;
  }
  if (d.type !== 'assistant' || !d.message || !d.message.usage) return null;
  const u = d.message.usage;
  const e: UsageEvent = {
    source,
    sessionId: d.sessionId ?? null,
    messageId: d.message.id ?? null,
    projectPath: d.cwd ?? null,
    gitBranch: d.gitBranch ?? null,
    model: d.message.model ?? null,
    timestamp: d.timestamp ?? '',
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  };
  // Skip lines with no billable tokens (API errors, empty pings).
  const sum = e.inputTokens + e.outputTokens + e.cacheReadTokens + e.cacheWriteTokens;
  return sum > 0 && e.timestamp ? e : null;
}

async function jsonlFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await jsonlFiles(full)));
    else if (entry.name.endsWith('.jsonl')) out.push(full);
  }
  return out;
}

export async function collectEvents(dataDir: string = defaultDataDir()): Promise<UsageEvent[]> {
  const files = await jsonlFiles(dataDir);
  const events: UsageEvent[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = await fs.readFile(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      const e = parseLine(line);
      if (e) events.push(e);
    }
  }
  return events;
}
