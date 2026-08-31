import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectSources, loadEvents, SOURCES, SourceLoadError } from '../src/sources/index.js';

/**
 * Detection reads os.homedir(), which follows $HOME on POSIX — point it at a
 * throwaway dir so the test never depends on the real machine's setup.
 */

test('registers five supported agents', () => {
  assert.deepEqual(
    SOURCES.map((s) => s.id),
    ['claude-code', 'codex', 'dsh', 'opencode', 'gemini-cli'],
  );
});

test('labels detection-only sources so reports do not imply parser support', () => {
  assert.deepEqual(
    SOURCES.map((source) => [source.id, source.status]),
    [
      ['claude-code', 'supported'],
      ['codex', 'supported'],
      ['dsh', 'detection-only'],
      ['opencode', 'detection-only'],
      ['gemini-cli', 'detection-only'],
    ],
  );
});

test('raises a structured error when a detected source cannot be read', async () => {
  const source = SOURCES[0];
  const originalDetected = source.isDetected;
  const originalCollect = source.collectEvents;
  source.isDetected = async () => true;
  source.collectEvents = async () => { throw new Error('fixture read failed'); };
  try {
    await assert.rejects(loadEvents(), (error) => {
      assert.ok(error instanceof SourceLoadError);
      assert.deepEqual(error.failures, ['claude-code: fixture read failed']);
      return true;
    });
  } finally {
    source.isDetected = originalDetected;
    source.collectEvents = originalCollect;
  }
});

test('detects nothing when HOME is empty', async () => {
  const empty = mkdtempSync(path.join(os.tmpdir(), 'tokenpenny-home-'));
  const prev = process.env.HOME;
  process.env.HOME = empty;
  try {
    const infos = await detectSources();
    assert.deepEqual(infos.map((i) => i.detected), [false, false, false, false, false]);
  } finally {
    process.env.HOME = prev;
    rmSync(empty, { recursive: true, force: true });
  }
});

test('detects each agent by its data dir', async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'tokenpenny-home-'));
  const prev = process.env.HOME;
  process.env.HOME = home;
  try {
    for (const rel of [
      '.claude/projects',
      '.codex/sessions',
      '.dsh',
      path.join('.local', 'share', 'opencode'),
      path.join('.gemini', 'tmp'),
    ]) {
      mkdirSync(path.join(home, rel), { recursive: true });
    }
    const infos = await detectSources();
    assert.deepEqual(infos.map((i) => i.detected), [true, true, true, true, true]);
    assert.equal(infos.find((i) => i.id === 'opencode')!.dataDir, path.join(home, '.local', 'share', 'opencode'));
  } finally {
    process.env.HOME = prev;
    rmSync(home, { recursive: true, force: true });
  }
});
