#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { report } from './commands/report.js';
import { detectSources } from './sources/index.js';
import { fmtInt, table } from './core/format.js';

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

const program = new Command();

program
  .name('tokenpenny')
  .description('See where your AI coding agents\' tokens and dollars actually go.')
  .version(pkg.version);

program
  .command('report', { isDefault: true })
  .description('Aggregate token usage and cost across all detected agents (default)')
  .option('-s, --since <period>', 'time window: 7d, 30d, 90d, YYYY-MM-DD, or all', '30d')
  .option('-b, --by <dimension>', 'group by: project, day, model, session, source', 'project')
  .option('-t, --top <n>', 'show only the top n rows')
  .option('--json', 'output JSON instead of a table')
  .action((opts) => report(opts));

program
  .command('sources')
  .description('List supported agents and whether their local data was found')
  .action(async () => {
    const infos = await detectSources();
    const rows = infos.map((s) => [s.name, s.id, s.detected ? 'yes' : 'not found', s.dataDir]);
    console.log(table(['Agent', 'Id', 'Detected', 'Data dir'], rows));
    console.log('');
    console.log(`Parsed events will come from agents marked "yes". Total sources: ${fmtInt(infos.length)}`);
  });

program.parseAsync();
