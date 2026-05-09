/**
 * integration.test.js — Full session lifecycle integration test
 *
 * Simulates the complete memory session lifecycle end-to-end:
 * SessionStart → capture messages → write memory → bump access → search → consolidate
 *
 * Uses a temp directory as HOME to isolate from real ~/.collie/memory/
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.resolve(__dirname, '../../hooks/memory');

function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Run a script with the given fakeHome as HOME env var.
 * stdin is optional JSON string.
 * Returns { stdout, stderr, status }.
 */
function run(scriptName, args = [], { fakeHome, stdinData = null } = {}) {
  const scriptPath = path.join(SCRIPTS, scriptName);
  const opts = {
    encoding: 'utf8',
    env: { ...process.env, HOME: fakeHome },
  };
  if (stdinData !== null) {
    opts.input = typeof stdinData === 'string' ? stdinData : JSON.stringify(stdinData);
  }
  try {
    const stdout = execFileSync(process.execPath, [scriptPath, ...args], opts);
    return { stdout, stderr: '', status: 0 };
  } catch (err) {
    return { stdout: err.stdout || '', stderr: err.stderr || '', status: err.status ?? 1 };
  }
}

// ---------------------------------------------------------------------------
// Main integration test — complete session lifecycle
// ---------------------------------------------------------------------------

test('complete session lifecycle', () => {
  // -------------------------------------------------------------------------
  // Step 1: Setup — temp HOME with empty ~/.collie/memory/ structure
  // -------------------------------------------------------------------------
  const fakeHome = mkdtempSync(path.join(tmpdir(), 'mp-integration-'));
  const palaceRoot = path.join(fakeHome, '.collie/memory');
  const TEST_PROJECT = 'test-project';

  // Create the directory structure
  mkdirSync(path.join(palaceRoot, 'user', 'short'), { recursive: true });
  mkdirSync(path.join(palaceRoot, 'user', 'long'), { recursive: true });
  mkdirSync(path.join(palaceRoot, 'projects', TEST_PROJECT, 'short'), { recursive: true });
  mkdirSync(path.join(palaceRoot, 'projects', TEST_PROJECT, 'long'), { recursive: true });
  mkdirSync(path.join(palaceRoot, 'sessions'), { recursive: true });

  assert.ok(existsSync(path.join(palaceRoot, 'user', 'short')), 'user/short created');
  assert.ok(existsSync(path.join(palaceRoot, 'user', 'long')), 'user/long created');
  assert.ok(
    existsSync(path.join(palaceRoot, 'projects', TEST_PROJECT, 'short')),
    'project/short created'
  );
  assert.ok(
    existsSync(path.join(palaceRoot, 'projects', TEST_PROJECT, 'long')),
    'project/long created'
  );

  // -------------------------------------------------------------------------
  // Step 2: SessionStart — run load-index.js
  // -------------------------------------------------------------------------
  // load-index.js uses process.cwd() to resolve project; pass cwd inside home
  // so resolveProject falls back to a predictable name (doesn't matter for this
  // test — we just need it to not crash and to create INDEX.md files).
  const { status: loadStatus } = run('load-index.js', [], {
    fakeHome,
    stdinData: null,
  });

  assert.equal(loadStatus, 0, 'load-index.js should exit 0');
  // INDEX.md files should now exist (created by syncIndex)
  assert.ok(
    existsSync(path.join(palaceRoot, 'user', 'INDEX.md')),
    'user/INDEX.md created by load-index'
  );

  // -------------------------------------------------------------------------
  // Step 3: Capture messages — run capture-message.js 3 times
  // -------------------------------------------------------------------------
  const messages = ['First message', 'Second message', 'Third message'];

  for (const msg of messages) {
    const { status } = run('capture-message.js', [], {
      fakeHome,
      stdinData: { prompt: msg, cwd: fakeHome },
    });
    assert.equal(status, 0, `capture-message.js should exit 0 for "${msg}"`);
  }

  // Verify session log has 3 entries
  const sessionsDir = path.join(palaceRoot, 'sessions');
  const sessionFiles = readdirSync(sessionsDir).filter(f => f.endsWith('.jsonl'));
  assert.ok(sessionFiles.length >= 1, 'at least one session JSONL file created');

  const sessionLog = readFileSync(path.join(sessionsDir, sessionFiles[0]), 'utf8');
  const sessionEntries = sessionLog.trim().split('\n').filter(Boolean);
  assert.equal(sessionEntries.length, 3, 'session log should have 3 entries');

  // Verify each entry is valid JSON with the correct role
  for (const line of sessionEntries) {
    const entry = JSON.parse(line);
    assert.equal(entry.role, 'user', 'each log entry should have role: user');
    assert.ok(typeof entry.message === 'string', 'each log entry should have a message');
    assert.ok(typeof entry.ts === 'string', 'each log entry should have a timestamp');
  }

  // Verify no separate counter file (log is the single source of truth)
  const counterFile = path.join(sessionsDir, '.counter');
  assert.ok(!existsSync(counterFile), '.counter file should not exist');

  // -------------------------------------------------------------------------
  // Step 4: Write a memory — run write-memory.js
  // -------------------------------------------------------------------------
  const { stdout: writeOut, status: writeStatus } = run(
    'write-memory.js',
    [
      '--type', 'user',
      '--scope', 'user',
      '--summary', 'test preference',
      '--content', 'User prefers dark mode',
    ],
    { fakeHome }
  );

  assert.equal(writeStatus, 0, 'write-memory.js should exit 0');

  const writtenPath = writeOut.trim();
  assert.ok(writtenPath.length > 0, 'write-memory.js should output the file path');
  assert.ok(existsSync(writtenPath), 'written memory file should exist');

  // Verify it's in user/short/
  assert.ok(
    writtenPath.includes(path.join(palaceRoot, 'user', 'short')),
    'written file should be in user/short/'
  );

  // Verify frontmatter content
  const writtenContent = readFileSync(writtenPath, 'utf8');
  assert.ok(writtenContent.includes('type: user'), 'written file should have type: user');
  assert.ok(writtenContent.includes('summary: test preference'), 'written file should have correct summary');
  assert.ok(writtenContent.includes('User prefers dark mode'), 'written file should contain the memory content');

  // -------------------------------------------------------------------------
  // Step 5: Bump access — run bump-access.js on a mock memory file
  // -------------------------------------------------------------------------
  const mockLongFile = path.join(palaceRoot, 'user', 'long', `${today()}_mock.md`);
  writeFileSync(
    mockLongFile,
    [
      '---',
      'type: user',
      'summary: mock long memory',
      `created: ${today()}`,
      `last_accessed: ${today()}`,
      'access_count: 1',
      '---',
      '',
      'Mock content for bump test.',
    ].join('\n'),
    'utf8'
  );

  const hookInput = { tool_input: { file_path: mockLongFile } };
  const { status: bumpStatus } = run('bump-access.js', [], {
    fakeHome,
    stdinData: hookInput,
  });

  assert.equal(bumpStatus, 0, 'bump-access.js should exit 0');

  const bumpedContent = readFileSync(mockLongFile, 'utf8');
  assert.ok(
    bumpedContent.includes('access_count: 2'),
    'access_count should be bumped from 1 to 2'
  );
  assert.ok(
    bumpedContent.includes(`last_accessed: ${today()}`),
    'last_accessed should be updated to today'
  );

  // -------------------------------------------------------------------------
  // Step 6: Search memory — run search-memory.js
  // -------------------------------------------------------------------------
  const { stdout: searchOut, status: searchStatus } = run(
    'search-memory.js',
    ['--scope', 'user', '--query', 'dark mode'],
    { fakeHome }
  );

  assert.equal(searchStatus, 0, 'search-memory.js should exit 0');

  const searchResults = JSON.parse(searchOut.trim());
  assert.ok(Array.isArray(searchResults), 'search results should be a JSON array');
  assert.ok(searchResults.length >= 1, 'search should return at least one result');

  // Verify the file from step 4 appears in results
  const foundFile = searchResults.find(r => r.path === writtenPath);
  assert.ok(foundFile, 'written memory file from step 4 should appear in search results');
  assert.ok(foundFile.score >= 1, 'found file should have a positive score');

  // -------------------------------------------------------------------------
  // Step 7: Consolidation — promote file from user/short/ to user/long/
  // -------------------------------------------------------------------------
  // Create a mock file with access_count=3 and created 2 days ago, last_accessed today
  const mockShortFile = path.join(palaceRoot, 'user', 'short', `${daysAgo(2)}_promote_me.md`);
  writeFileSync(
    mockShortFile,
    [
      '---',
      'type: user',
      'summary: consolidation test memory',
      `created: ${daysAgo(2)}`,
      `last_accessed: ${today()}`,
      'access_count: 3',
      '---',
      '',
      'This memory should be promoted to long-term storage.',
    ].join('\n'),
    'utf8'
  );

  const { stdout: consolidateOut, status: consolidateStatus } = run(
    'consolidate.js',
    [],
    { fakeHome }
  );

  assert.equal(consolidateStatus, 0, 'consolidate.js should exit 0');

  const consolidateResult = JSON.parse(consolidateOut.trim());
  assert.ok(
    Array.isArray(consolidateResult.promoted),
    'consolidate result should have promoted array'
  );
  assert.ok(
    Array.isArray(consolidateResult.merged),
    'consolidate result should have merged array'
  );

  // Verify the mock file was promoted (moved from short/ to long/)
  const mockShortFilename = path.basename(mockShortFile);
  assert.ok(
    consolidateResult.promoted.includes(mockShortFilename),
    `${mockShortFilename} should be in promoted list`
  );

  // Verify the file no longer exists in short/
  assert.ok(
    !existsSync(mockShortFile),
    'promoted file should no longer exist in user/short/'
  );

  // Verify the file now exists in long/
  const longDir = path.join(palaceRoot, 'user', 'long');
  const longFiles = readdirSync(longDir);
  const promotedInLong = longFiles.some(f => f.includes('promote_me'));
  assert.ok(promotedInLong, 'promoted file should now exist in user/long/');

  // Verify INDEX.md was updated with the promoted file
  const userIndexPath = path.join(palaceRoot, 'user', 'INDEX.md');
  assert.ok(existsSync(userIndexPath), 'user/INDEX.md should exist');
  const indexContent = readFileSync(userIndexPath, 'utf8');
  assert.ok(
    indexContent.includes('promote_me') || indexContent.includes('consolidation test memory'),
    'INDEX.md should reference the promoted file or its summary'
  );
});
