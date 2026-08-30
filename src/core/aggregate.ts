import type { Aggregates, GroupBy, GroupRow, Totals, UsageEvent } from '../types.js';
import { eventCost } from './pricing.js';

const EMPTY_TOTALS = (): Totals => ({
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUSD: 0,
  unknownModelRequests: 0,
});

export function groupKey(e: UsageEvent, groupBy: GroupBy): string {
  switch (groupBy) {
    case 'day':
      return e.timestamp.slice(0, 10) || 'unknown';
    case 'week': {
      const d = new Date(e.timestamp);
      if (isNaN(d.getTime())) return 'unknown';
      const day = (d.getUTCDay() + 6) % 7; // Monday = 0
      return new Date(d.getTime() - day * 86_400_000).toISOString().slice(0, 10);
    }
    case 'month':
      return e.timestamp.slice(0, 7) || 'unknown';
    case 'model':
      return e.model ?? 'unknown';
    case 'source':
      return e.source;
    case 'session':
      return e.sessionId ? e.sessionId.slice(0, 8) : 'unknown';
    case 'branch':
      return e.gitBranch ?? 'unknown';
    case 'pr': {
      if (e.prNumber) {
        return e.prTitle ? `#${e.prNumber} ${e.prTitle.slice(0, 40)}` : `#${e.prNumber}`;
      }
      if (e.gitBranch) return `(no PR) ${e.gitBranch}`;
      return 'unknown';
    }
    case 'project': {
      if (!e.projectPath) return 'unknown';
      return projectBasename(e.projectPath);
    }
  }
}

export function projectBasename(projectPath: string): string {
  const parts = projectPath.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? projectPath;
}

/** Keep only events from one project, matched by folder name or full path. */
export function filterProject(events: UsageEvent[], project: string): UsageEvent[] {
  return events.filter((e) => {
    if (!e.projectPath) return false;
    return projectBasename(e.projectPath) === project || e.projectPath === project;
  });
}

/**
 * Parse a --since value: "7d" / "30d" / "90d" or "YYYY-MM-DD".
 * Returns an ISO timestamp boundary, or null for "all time".
 */
export function parseSince(value: string | undefined): string | null {
  if (!value || value === 'all') return null;
  const rel = /^(\d+)d$/.exec(value);
  if (rel) {
    const ms = Date.now() - Number(rel[1]) * 24 * 60 * 60 * 1000;
    return new Date(ms).toISOString();
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.exec(value);
  if (date) return new Date(`${value}T00:00:00Z`).toISOString();
  throw new Error(`Invalid --since value: "${value}" (use e.g. 7d, 30d, or 2026-08-01)`);
}

export function aggregate(
  events: UsageEvent[],
  groupBy: GroupBy,
  since: string | null,
): Aggregates {
  const filtered = since ? events.filter((e) => e.timestamp >= since) : events;

  const totals = EMPTY_TOTALS();
  const groups = new Map<string, Totals>();
  const unknownModels = new Set<string>();

  for (const e of filtered) {
    const cost = eventCost(e);
    const buckets: Array<[Totals, number]> = [[totals, cost ?? 0]];
    const key = groupKey(e, groupBy);
    let g = groups.get(key);
    if (!g) {
      g = EMPTY_TOTALS();
      groups.set(key, g);
    }
    buckets.push([g, cost ?? 0]);

    for (const [t, c] of buckets) {
      t.requests++;
      t.inputTokens += e.inputTokens;
      t.outputTokens += e.outputTokens;
      t.cacheReadTokens += e.cacheReadTokens;
      t.cacheWriteTokens += e.cacheWriteTokens;
      t.costUSD += c;
    }
    if (cost === null) {
      totals.unknownModelRequests++;
      if (e.model) unknownModels.add(e.model);
    }
  }

  const rows: GroupRow[] = [...groups.entries()]
    .map(([key, t]) => ({ key, ...t }))
    .sort((a, b) => b.costUSD - a.costUSD || b.requests - a.requests);

  return {
    groupBy,
    since,
    totals,
    groups: rows,
    unknownModels: [...unknownModels].sort(),
  };
}
