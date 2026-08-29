import type { GroupBy } from '../types.js';
import { aggregate, filterProject, parseSince } from '../core/aggregate.js';
import { enrichWithPRs } from '../core/prs.js';
import { renderReport } from '../core/format.js';
import { loadEvents } from '../sources/index.js';

const GROUP_BY: GroupBy[] = ['project', 'day', 'model', 'session', 'source', 'branch', 'pr'];

export interface ReportOptions {
  since?: string;
  by?: string;
  top?: string;
  json?: boolean;
  project?: string;
}

export async function report(options: ReportOptions): Promise<void> {
  const since = parseSince(options.since ?? '30d');
  const by = (options.by ?? 'project') as GroupBy;
  if (!GROUP_BY.includes(by)) {
    throw new Error(`Invalid --by value: "${by}" (choose from ${GROUP_BY.join(', ')})`);
  }

  const all = await loadEvents();
  if (all.length === 0) {
    console.log('No usage events found. Detected no readable agent session logs.');
    return;
  }
  const base = options.project ? filterProject(all, options.project) : all;
  if (base.length === 0) {
    console.log(`No usage events found for project "${options.project}".`);
    return;
  }
  // PR attribution needs a git-log scan per project — only pay for it on --by pr.
  const events = by === 'pr' ? enrichWithPRs(base) : base;

  const agg = aggregate(events, by, since);
  if (options.top) {
    const n = Math.max(1, Number(options.top));
    agg.groups = agg.groups.slice(0, n);
  }

  if (options.json) {
    console.log(JSON.stringify(agg, null, 2));
  } else {
    console.log(renderReport(agg));
  }
}
