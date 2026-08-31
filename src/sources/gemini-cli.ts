import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { UsageEvent } from '../types.js';

/** Gemini CLI stores recorded conversations as JSONL under ~/.gemini/tmp. */
export function defaultDataDir(): string {
  const home = process.env.GEMINI_CLI_HOME ?? os.homedir();
  return path.join(home, '.gemini', 'tmp');
}

export async function isDetected(dataDir: string = defaultDataDir()): Promise<boolean> {
  try { await fs.access(dataDir); return true; } catch { return false; }
}

interface Tokens { input?: unknown; output?: unknown; cached?: unknown; tool?: unknown; total?: unknown; }
interface Message { id?: unknown; type?: unknown; timestamp?: unknown; model?: unknown; tokens?: Tokens | null; }
interface Conversation { sessionId?: unknown; directories?: unknown; messages?: unknown; }

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function parseConversation(value: unknown, source = 'gemini-cli'): UsageEvent[] {
  if (!value || typeof value !== 'object') return [];
  const conversation = value as Conversation;
  if (!Array.isArray(conversation.messages)) return [];
  const projectPath = Array.isArray(conversation.directories) && typeof conversation.directories[0] === 'string'
    ? conversation.directories[0] : null;
  const sessionId = typeof conversation.sessionId === 'string' ? conversation.sessionId : null;
  const events: UsageEvent[] = [];
  for (const item of conversation.messages) {
    if (!item || typeof item !== 'object') continue;
    const message = item as Message;
    if (message.type !== 'gemini' || !message.tokens) continue;
    const input = count(message.tokens.input);
    const output = count(message.tokens.output);
    const cached = count(message.tokens.cached) ?? 0;
    const tool = count(message.tokens.tool) ?? 0;
    const total = count(message.tokens.total);
    const timestamp = typeof message.timestamp === 'string' ? message.timestamp : '';
    if (input === null || output === null || !timestamp || (total ?? input + output + cached + tool) <= 0) continue;
    events.push({ source, sessionId, messageId: typeof message.id === 'string' ? message.id : null,
      projectPath, gitBranch: null, model: typeof message.model === 'string' ? message.model : null,
      timestamp, inputTokens: input, outputTokens: output, cacheReadTokens: cached, cacheWriteTokens: 0 });
  }
  return events;
}

async function files(dir: string): Promise<string[]> {
  const output: string[] = [];
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return output; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) output.push(...await files(full));
    else if (/^session-.*\.jsonl?$/.test(entry.name)) output.push(full);
  }
  return output;
}

export async function collectEvents(dataDir: string = defaultDataDir()): Promise<UsageEvent[]> {
  const events: UsageEvent[] = [];
  for (const file of await files(dataDir)) {
    let content: string;
    try { content = await fs.readFile(file, 'utf8'); } catch { continue; }
    const lines = content.split('\n').filter((line) => line.trim());
    try {
      const parsed = lines.length === 1 ? JSON.parse(lines[0]) : null;
      if (parsed) events.push(...parseConversation(parsed));
    } catch { /* malformed session files are ignored like other agent logs */ }
  }
  return events;
}
