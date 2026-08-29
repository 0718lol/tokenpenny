import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { enrichWithPRs, scanProjectPRs } from '../src/core/prs.js';
import { aggregate } from '../src/core/aggregate.js';
import type { UsageEvent } from '../src/types.js';

let hasGit = true;
try {
  execSync('git --version', { stdio: 'pipe' });
} catch {
  hasGit = false;
}

/** Build a throwaway repo whose history holds a GitHub-style PR merge. */
function makeRepoWithPR(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tokenpenny-pr-'));
  const g = (cmd: string) => execSync(`git -C ${dir} ${cmd}`, { stdio: 'pipe' });
  execSync(`git init -q -b main ${dir}`, { stdio: 'pipe' });
  g('config user.email test@example.com');
  g('config user.name test');
  g('commit --allow-empty -m init');
  g('checkout -q -b feat/cool');
  g('commit --allow-empty -m work');
  g('checkout -q main');
  // GitHub's exact merge-commit shape: PR number in subject, title in body
  g('merge -q --no-ff feat/cool -m "Merge pull request #42 from someone/feat/cool" -m "Add the cool thing"');
  return dir;
}

test('scanProjectPRs maps branches to PR numbers and titles', { skip: !hasGit }, () => {
  const dir = makeRepoWithPR();
  try {
    const refs = scanProjectPRs(dir);
    const ref = refs.get('feat/cool');
    assert.ok(ref, 'feat/cool should map to a PR');
    assert.equal(ref!.number, 42);
    assert.equal(ref!.title, 'Add the cool thing');
    // Nonexistent repos and plain folders degrade to an empty map
    assert.equal(scanProjectPRs(path.join(os.tmpdir())).size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('enrichWithPRs + aggregate roll usage up per pull request', { skip: !hasGit }, () => {
  const dir = makeRepoWithPR();
  try {
    const events: UsageEvent[] = [
      {
        source: 'claude-code',
        sessionId: 's1',
        messageId: 'm1',
        projectPath: dir,
        gitBranch: 'feat/cool',
        model: 'claude-sonnet-4',
        timestamp: '2026-08-20T10:00:00Z',
        inputTokens: 1000,
        outputTokens: 1000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    ];
    const enriched = enrichWithPRs(events);
    assert.equal(enriched[0].prNumber, 42);
    assert.equal(enriched[0].prTitle, 'Add the cool thing');

    const agg = aggregate(enriched, 'pr', null);
    assert.equal(agg.groups[0].key, '#42 Add the cool thing');
    // sonnet: (1000*3 + 1000*15)/1M = 0.018
    assert.ok(Math.abs(agg.groups[0].costUSD - 0.018) < 1e-9);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('events without a mapped PR fall back honestly', { skip: !hasGit }, () => {
  const events: UsageEvent[] = [
    {
      source: 'claude-code',
      sessionId: 's1',
      messageId: 'm1',
      projectPath: os.tmpdir(), // exists but not a git repo
      gitBranch: 'some-branch',
      model: 'claude-sonnet-4',
      timestamp: '2026-08-20T10:00:00Z',
      inputTokens: 1,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    {
      source: 'codex',
      sessionId: 's2',
      messageId: null,
      projectPath: os.tmpdir(),
      gitBranch: null, // Codex records no branch
      model: 'gpt-5',
      timestamp: '2026-08-20T11:00:00Z',
      inputTokens: 1,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  ];
  const agg = aggregate(enrichWithPRs(events), 'pr', null);
  const keys = agg.groups.map((g) => g.key).sort();
  assert.deepEqual(keys, ['(no PR) some-branch', 'unknown']);
});
