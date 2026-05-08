import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPT = new URL('../../hooks/memory/capture-message.js', import.meta.url).pathname;

/**
 * Create a temp HOME directory with the sessions subdir and return paths.
 */
function makeTempHome() {
  const home = mkdtempSync(join(tmpdir(), 'mp-test-'));
  const sessionsDir = join(home, '.collie/memory', 'sessions');
  mkdirSync(sessionsDir, { recursive: true });
  return { home, sessionsDir };
}

/**
 * Run capture-message.js with the given JSON input in a fresh temp HOME.
 * Returns { stdout, stderr, status, home, sessionsDir }.
 */
function runScript(input, home) {
  const result = spawnSync(process.execPath, [SCRIPT], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      // Clear session ID so the script derives one from the filesystem
      CLAUDE_CODE_SESSION_ID: 'test-session',
    },
  });
  return result;
}

// ── Test 1: Single message creates JSONL file ─────────────────────────────────

test('single message: creates JSONL file in sessions dir', () => {
  const { home, sessionsDir } = makeTempHome();

  const result = runScript({ prompt: 'hello world', cwd: '/tmp' }, home);

  assert.strictEqual(result.status, 0, `Script exited with ${result.status}; stderr: ${result.stderr}`);

  const files = readdirSync(sessionsDir).filter(f => f.endsWith('.jsonl'));
  assert.ok(files.length > 0, 'Expected at least one .jsonl file to be created');

  const content = readFileSync(join(sessionsDir, files[0]), 'utf8');
  const entry = JSON.parse(content.trim());
  assert.strictEqual(entry.role, 'user');
  assert.strictEqual(entry.message, 'hello world');
  assert.strictEqual(entry.cwd, '/tmp');
});

// ── Test 2: Counter increments across multiple messages ───────────────────────

test('counter increment: counter increases with each message', () => {
  const { home, sessionsDir } = makeTempHome();
  const counterFile = join(sessionsDir, '.counter');

  // Send 3 messages
  for (let i = 0; i < 3; i++) {
    const result = runScript({ prompt: `message ${i}`, cwd: '/tmp' }, home);
    assert.strictEqual(result.status, 0, `Run ${i} failed: ${result.stderr}`);
  }

  const counterVal = parseInt(readFileSync(counterFile, 'utf8').trim(), 10);
  assert.strictEqual(counterVal, 3, `Expected counter to be 3, got ${counterVal}`);
});

// ── Test 3: Threshold trigger on 20th message ─────────────────────────────────

test('threshold trigger: 20th message produces stdout with "memory"', () => {
  const { home } = makeTempHome();

  let lastResult;
  for (let i = 0; i < 20; i++) {
    lastResult = runScript({ prompt: `message ${i}`, cwd: '/tmp' }, home);
    assert.strictEqual(lastResult.status, 0, `Run ${i} failed: ${lastResult.stderr}`);
  }

  assert.ok(
    lastResult.stdout.includes('memory'),
    `Expected stdout to contain "memory", got: ${JSON.stringify(lastResult.stdout)}`
  );

  // Verify it's valid JSON
  const parsed = JSON.parse(lastResult.stdout.trim());
  assert.ok('additionalContext' in parsed, 'Expected additionalContext key in output');
});

// ── Test 4: Counter resets to 0 after threshold ───────────────────────────────

test('counter reset: counter is 0 after threshold trigger', () => {
  const { home, sessionsDir } = makeTempHome();
  const counterFile = join(sessionsDir, '.counter');

  for (let i = 0; i < 20; i++) {
    runScript({ prompt: `message ${i}`, cwd: '/tmp' }, home);
  }

  const counterVal = parseInt(readFileSync(counterFile, 'utf8').trim(), 10);
  assert.strictEqual(counterVal, 0, `Expected counter to be reset to 0, got ${counterVal}`);
});

// ── Test 5: Invalid JSON exits cleanly ────────────────────────────────────────

test('invalid JSON input: exits cleanly with code 0 and no stderr', () => {
  const { home } = makeTempHome();

  const result = spawnSync(process.execPath, [SCRIPT], {
    input: 'this is not json {{',
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      CLAUDE_CODE_SESSION_ID: 'test-session',
    },
  });

  assert.strictEqual(result.status, 0, `Expected exit code 0, got ${result.status}`);
  assert.strictEqual(result.stderr, '', `Expected no stderr, got: ${result.stderr}`);
});
