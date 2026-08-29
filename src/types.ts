/** One billable API call, normalized across every agent source. */
export interface UsageEvent {
  /** Source id, e.g. "claude-code", "codex" */
  source: string;
  sessionId: string | null;
  /** Provider message id, used to dedupe streamed duplicates */
  messageId: string | null;
  projectPath: string | null;
  gitBranch: string | null;
  model: string | null;
  /** ISO 8601 timestamp */
  timestamp: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Filled by PR attribution (enrichWithPRs) — absent unless --by pr */
  prNumber?: number | null;
  prTitle?: string | null;
}

export interface Totals {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** USD; requests with an unknown model are counted but priced at 0 */
  costUSD: number;
  unknownModelRequests: number;
}

export type GroupBy = 'project' | 'day' | 'model' | 'session' | 'source' | 'branch' | 'pr';

export interface GroupRow extends Totals {
  key: string;
}

export interface Aggregates {
  groupBy: GroupBy;
  since: string | null;
  totals: Totals;
  groups: GroupRow[];
  /** Distinct model names seen without a price entry */
  unknownModels: string[];
}

export interface SourceInfo {
  id: string;
  name: string;
  dataDir: string;
  detected: boolean;
  eventCount?: number;
}
