import { execFileSync } from 'node:child_process';
import { accessSync } from 'node:fs';
import path from 'node:path';
import type { UsageEvent } from '../types.js';

/**
 * PR attribution, 100% offline.
 *
 * GitHub merge commits record both the PR number and its head branch:
 *   subject: "Merge pull request #42 from owner/feat/cool"
 *   body:    PR title on the first line
 * Scanning `git log --all` in the project repo builds a branch -> PR map,
 * so usage events on a branch can be rolled up per pull request without
 * ever calling the GitHub API.
 *
 * Known limitation: squash merges lose the branch name, so those PRs cannot
 * be tied back to branches from local data alone.
 */

export interface PRRef {
  number: number;
  title: string | null;
}

/**
 * Agent sessions record the directory they ran in, which is often a
 * subdirectory of the actual repo — walk up a few levels to find .git.
 */
function findGitRoot(start: string): string | null {
  let dir = start;
  for (let depth = 0; depth < 8; depth++) {
    try {
      accessSync(path.join(dir, '.git'));
      return dir;
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  }
  return null;
}

export function scanProjectPRs(projectPath: string): Map<string, PRRef> {
  const map = new Map<string, PRRef>();
  const root = findGitRoot(projectPath);
  if (!root) return map;

  let out: Buffer;
  try {
    out = execFileSync(
      'git',
      ['-C', root, 'log', '--all', '--max-count=20000', '--format=%s%x1f%b%x1e'],
      { timeout: 15000, maxBuffer: 64 * 1024 * 1024 },
    );
  } catch {
    return map;
  }

  const re = /^Merge pull request #(\d+) from (.+)$/;
  for (const record of out.toString('utf8').split('\x1e')) {
    const sep = record.indexOf('\x1f');
    if (sep === -1) continue;
    const subject = record.slice(0, sep).trim();
    const body = record.slice(sep + 1);
    const m = re.exec(subject);
    if (!m) continue;
    const number = Number(m[1]);
    const refspec = m[2].trim();
    // Same-repo merges read "from feat/cool"; fork merges "from owner/feat/cool".
    const candidates = [refspec];
    const slash = refspec.indexOf('/');
    if (slash !== -1) candidates.push(refspec.slice(slash + 1));
    // git log is newest-first, so the first hit per branch is the latest PR.
    const title = body.split('\n').map((s) => s.trim()).find(Boolean) ?? null;
    for (const branch of candidates) {
      if (!map.has(branch)) map.set(branch, { number, title });
    }
  }
  return map;
}

/**
 * Fill prNumber/prTitle on events using local git history, keyed per project
 * and scanned lazily. Events without a branch or a mapped PR pass through.
 */
export function enrichWithPRs(events: UsageEvent[]): UsageEvent[] {
  const cache = new Map<string, Map<string, PRRef>>();
  return events.map((e) => {
    if (!e.gitBranch || !e.projectPath) return e;
    let refs = cache.get(e.projectPath);
    if (!refs) {
      refs = scanProjectPRs(e.projectPath);
      cache.set(e.projectPath, refs);
    }
    const ref = refs.get(e.gitBranch);
    return ref ? { ...e, prNumber: ref.number, prTitle: ref.title } : e;
  });
}
