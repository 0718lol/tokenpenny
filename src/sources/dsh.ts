import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import type { UsageEvent } from '../types.js';

const execFileAsync = promisify(execFile);

/** DSH durable sessions are JSONL, optionally zstd-compressed. */
export function defaultDataDir(): string {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}
export async function isDetected(dataDir: string = defaultDataDir()): Promise<boolean> {
  try { await fs.access(dataDir); return true; } catch { return false; }
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function object(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' ? value as Record<string, any> : null;
}

export function parseLine(line: string, fileName = 'dsh-session'): UsageEvent | null {
  let event: any;
  try { event = JSON.parse(line); } catch { return null; }
  if (event?.type !== 'assistant/message') return null;
  const data = object(event.data);
  const message = object(data?.message);
  const usage = object(data?.usage) ?? object(message?.usage);
  if (!usage) return null;
  const input = count(usage.inputTokens);
  const output = count(usage.outputTokens);
  const cached = count(usage.cacheReadTokens) ?? 0;
  const cacheWrite = count(usage.cacheWriteTokens) ?? 0;
  if (input === null || output === null || input + output + cached + cacheWrite === 0) return null;
  const timestamp = typeof event.time === 'number' ? new Date(event.time).toISOString() :
    typeof event.timestamp === 'string' ? event.timestamp : '';
  if (!timestamp) return null;
  const source = object(message?.source);
  const requestContext = object(message?.path);
  return { source: 'dsh', sessionId: typeof data?.sessionId === 'string' ? data.sessionId : fileName,
    messageId: typeof message?.id === 'string' ? message.id : null,
    projectPath: typeof requestContext?.cwd === 'string' ? requestContext.cwd : null,
    gitBranch: null, model: typeof source?.model === 'string' ? source.model : null, timestamp,
    inputTokens: input, outputTokens: output, cacheReadTokens: cached, cacheWriteTokens: cacheWrite };
}

async function files(dir: string): Promise<string[]> {
  const output: string[] = [];
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return output; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) output.push(...await files(full));
    else if (/\.jsonl(?:\.zst|\.zstd)?$/.test(entry.name)) output.push(full);
  }
  return output;
}

async function content(file: string): Promise<string> {
  if (!file.endsWith('.zst') && !file.endsWith('.zstd')) return fs.readFile(file, 'utf8');
  try {
    const result = await execFileAsync('zstd', ['-q', '-d', '--stdout', '--', file], { maxBuffer: 64 * 1024 * 1024 });
    return result.stdout;
  } catch (error) {
    throw new Error(`无法解压 ${path.basename(file)}：请安装 zstd`);
  }
}

export async function collectEvents(dataDir: string = defaultDataDir()): Promise<UsageEvent[]> {
  const events: UsageEvent[] = [];
  for (const file of await files(dataDir)) {
    const text = await content(file);
    const session = path.basename(file).replace(/\.jsonl(?:\.zst|\.zstd)?$/, '');
    for (const line of text.split('\n')) {
      const event = parseLine(line, session);
      if (event) events.push(event);
    }
  }
  return events;
}
