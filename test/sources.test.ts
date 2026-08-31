import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectSources, loadEvents, SOURCES, SourceLoadError, type AgentSource } from '../src/sources/index.js';
import { inspectSources } from '../src/commands/doctor.js';
import { parseLine as parseDshLine } from '../src/sources/dsh.js';
import { collectEvents as collectGeminiEvents } from '../src/sources/gemini-cli.js';

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

test('labels all sources with a verified parser', () => {
  assert.deepEqual(
    SOURCES.map((source) => [source.id, source.status]),
    [
      ['claude-code', 'supported'],
      ['codex', 'supported'],
      ['dsh', 'supported'],
      ['opencode', 'supported'],
      ['gemini-cli', 'supported'],
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

test('parses DSH assistant usage from the durable event envelope', () => {
  const event = parseDshLine(JSON.stringify({
    type: 'assistant/message',
    time: 1_756_000_000_000,
    data: {
      message: { id: 'dsh-msg', source: { model: 'deepseek-chat' }, path: { cwd: '/tmp/project' } },
      usage: { inputTokens: 100, outputTokens: 40, cacheReadTokens: 20, cacheWriteTokens: 5 },
    },
  }), 'session-1');
  assert.deepEqual(event && {
    source: event.source, sessionId: event.sessionId, messageId: event.messageId,
    projectPath: event.projectPath, model: event.model, inputTokens: event.inputTokens,
    outputTokens: event.outputTokens, cacheReadTokens: event.cacheReadTokens, cacheWriteTokens: event.cacheWriteTokens,
  }, { source: 'dsh', sessionId: 'session-1', messageId: 'dsh-msg', projectPath: '/tmp/project', model: 'deepseek-chat', inputTokens: 100, outputTokens: 40, cacheReadTokens: 20, cacheWriteTokens: 5 });
});

test('parses Gemini CLI token summaries from recorded sessions', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tokenpenny-gemini-'));
  try {
    mkdirSync(path.join(root, 'project'), { recursive: true });
    writeFileSync(path.join(root, 'project', 'session-test.jsonl'), JSON.stringify({
      sessionId: 'gemini-session', directories: ['/tmp/gemini-project'], messages: [
        { id: 'user-1', type: 'user', timestamp: '2026-08-30T10:00:00.000Z', content: [{ text: 'hi' }] },
        { id: 'gemini-1', type: 'gemini', timestamp: '2026-08-30T10:00:01.000Z', model: 'gemini-2.5-pro', tokens: { input: 120, output: 30, cached: 50, total: 200 } },
      ],
    }) + '\n');
    const events = await collectGeminiEvents(root);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], { source: 'gemini-cli', sessionId: 'gemini-session', messageId: 'gemini-1', projectPath: '/tmp/gemini-project', gitBranch: null, model: 'gemini-2.5-pro', timestamp: '2026-08-30T10:00:01.000Z', inputTokens: 120, outputTokens: 30, cacheReadTokens: 50, cacheWriteTokens: 0 });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('doctor reports parsed event counts and source failures', async () => {
  const event = { source: 'fixture', sessionId: 's', messageId: 'm', projectPath: '/tmp/p', gitBranch: null, model: 'model', timestamp: '2026-08-30T00:00:00Z', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const sources: AgentSource[] = [
    { id: 'ok', name: 'OK', dataDir: () => '/ok', status: 'supported', isDetected: async () => true, collectEvents: async () => [event] },
    { id: 'broken', name: 'Broken', dataDir: () => '/broken', status: 'supported', isDetected: async () => true, collectEvents: async () => { throw new Error('corrupt log'); } },
  ];
  const result = await inspectSources(sources);
  assert.equal(result[0].events, 1);
  assert.equal(result[0].error, undefined);
  assert.equal(result[1].error, 'corrupt log');
});
