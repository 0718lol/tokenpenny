import type { GroupBy } from '../types.js';
import { aggregate, parseSince } from '../core/aggregate.js';
import { renderReport } from '../core/format.js';
import { loadEvents } from '../sources/index.js';

const GROUP_BY: GroupBy[] = ['project', 'day', 'model', 'session', 'source'];

export interface ReportOptions {
  since?: string;
  by?: string;
  top?: string;
  json?: boolean;
}

export async function report(options: ReportOptions): Promise<void> {
  const since = parseSince(options.since ?? '30d');
  const by = (options.by ?? 'project') as GroupBy;
  if (!GROUP_BY.includes(by)) {
    throw new Error(`Invalid --by value: "${by}" (choose from ${GROUP_BY.join(', ')})`);
  }

  const events = await loadEvents();
  if (events.length === 0) {
    console.log('No usage events found. Detected no readable agent session logs.');
    return;
  }

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
