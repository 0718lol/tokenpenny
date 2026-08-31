#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { report } from './commands/report.js';
import { blocks } from './commands/blocks.js';
import { watch } from './commands/watch.js';
import { statusline } from './commands/statusline.js';
import { doctor } from './commands/doctor.js';
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
  .option('-b, --by <dimension>', 'group by: project, day, week, month, model, session, source, branch, pr', 'project')
  .option('-p, --project <name>', 'filter to one project (folder name or full path)')
  .option('-t, --top <n>', 'show only the top n rows')
  .option('--json', 'output JSON instead of a table')
  .action((opts) => report(opts));

program
  .command('blocks')
  .description('5-hour billing windows with active-block detection')
  .option('-s, --since <period>', 'time window: 7d, 30d, 90d, YYYY-MM-DD, or all', '30d')
  .option('-t, --top <n>', 'show only the n most recent blocks')
  .option('--json', 'output JSON instead of a table')
  .action((opts) => blocks(opts));

program
  .command('watch')
  .description('Live dashboard: active block, burn rate, today/week/all-time totals')
  .option('-i, --interval <seconds>', 'refresh interval in seconds (min 2)', '5')
  .action((opts) => watch(opts));

program
  .command('statusline')
  .description(
    'One-line summary for Claude Code statusLine — add "statusLine": {"type":"command","command":"npx tokenpenny statusline"} to ~/.claude/settings.json',
  )
  .action(() => statusline());

program
  .command('sources')
  .description('List supported agents and whether their local data was found')
  .action(async () => {
    const infos = await detectSources();
    const rows = infos.map((s) => [s.name, s.id, s.detected ? 'yes' : 'not found', s.status, s.dataDir]);
    console.log(table(['Agent', 'Id', 'Detected', 'Status', 'Data dir'], rows));
    console.log('');
    console.log(`Use 'tokenpenny doctor' to parse detected sources and diagnose unreadable files.`);
  });

program
  .command('doctor')
  .description('Check every detected source and report parser errors and event counts')
  .option('--json', 'output JSON instead of a table')
  .action((opts) => doctor(opts.json));

program.parseAsync();
