import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { UsageEvent } from '../types.js';

/**
 * Parser for Codex (OpenAI) session rollouts under ~/.codex/sessions/.
 * Files are laid out as YYYY/MM/DD/rollout-<timestamp>-<uuid>.jsonl and each
 * file is one thread (main or subagent, both carry their own usage).
 *
 * Line types used here:
 * - session_meta: once per file, gives session id and cwd
 * - turn_context: once per turn, gives the active model and cwd
 * - event_msg with payload.type "token_count": billable usage
 *
 * info.total_token_usage is cumulative per thread, so per-turn usage comes
 * from info.last_token_usage. Codex counts cached tokens INSIDE input_tokens
 * (unlike Claude Code), so the two are split apart to normalize into
 * UsageEvent, where inputTokens excludes cache.
 *
 * Known limitation: resumed threads may replay history into a new rollout
 * file, which can double-count turns from before the resume. Not yet deduped.
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

interface RolloutState {
  sessionId: string | null;
  cwd: string | null;
  model: string | null;
}

export function parseLine(line: string, state: RolloutState, source = 'codex'): UsageEvent | null {
  let d: RolloutLine;
  try {
    d = JSON.parse(line) as RolloutLine;
  } catch {
    return null;
  }

  if (d.type === 'session_meta') {
    state.sessionId = d.payload?.session_id ?? d.payload?.id ?? null;
    if (d.payload?.cwd) state.cwd = d.payload.cwd;
    return null;
  }

  if (d.type === 'turn_context') {
    if (d.payload?.model) state.model = d.payload.model;
    if (d.payload?.cwd) state.cwd = d.payload.cwd;
    return null;
  }

  if (d.type === 'event_msg' && d.payload?.type === 'token_count') {
    const u = d.payload.info?.last_token_usage;
    if (!u) return null;
    const cached = u.cached_input_tokens ?? 0;
    const e: UsageEvent = {
      source,
      sessionId: state.sessionId,
      messageId: null, // token_count events carry no id; dedupe does not apply
      projectPath: state.cwd,
      gitBranch: null, // Codex rollouts do not record a branch
      model: state.model,
      timestamp: typeof d.timestamp === 'string' ? d.timestamp : '',
      inputTokens: Math.max(0, (u.input_tokens ?? 0) - cached),
      outputTokens: u.output_tokens ?? 0,
      cacheReadTokens: cached,
      cacheWriteTokens: u.cache_write_input_tokens ?? 0,
    };
    const sum = e.inputTokens + e.outputTokens + e.cacheReadTokens + e.cacheWriteTokens;
    return sum > 0 && e.timestamp ? e : null;
  }

  return null;
}

interface RolloutLine {
  type?: string;
  timestamp?: string;
  payload?: {
    type?: string;
    session_id?: string;
    id?: string;
    cwd?: string;
    model?: string;
    info?: {
      last_token_usage?: {
        input_tokens?: number;
        cached_input_tokens?: number;
        cache_write_input_tokens?: number;
        output_tokens?: number;
      };
    };
  };
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
    const state: RolloutState = { sessionId: null, cwd: null, model: null };
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      const e = parseLine(line, state);
      if (e) events.push(e);
    }
  }
  return events;
}
