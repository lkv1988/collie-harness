import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPT = new URL('../../hooks/memory/capture-message.js', import.meta.url).pathname;

function makeTempHome() {
  const home = mkdtempSync(join(tmpdir(), 'mp-test-'));
  const sessionsDir = join(home, '.collie/memory', 'sessions');
  mkdirSync(sessionsDir, { recursive: true });
  return { home, sessionsDir };
}

function runScript(input, home) {
  const result = spawnSync(process.execPath, [SCRIPT], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
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

// ── Test 2: Log line count drives trigger (no separate counter file) ────────

test('log-based counting: no .counter file created', () => {
  const { home, sessionsDir } = makeTempHome();

  for (let i = 0; i < 5; i++) {
    runScript({ prompt: `message ${i}`, cwd: '/tmp' }, home);
  }

  assert.ok(!existsSync(join(sessionsDir, '.counter')), '.counter file should not exist');

  const files = readdirSync(sessionsDir).filter(f => f.endsWith('.jsonl'));
  const lines = readFileSync(join(sessionsDir, files[0]), 'utf8').split('\n').filter(l => l.length > 0);
  assert.strictEqual(lines.length, 5, `Expected 5 log lines, got ${lines.length}`);
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

  const parsed = JSON.parse(lastResult.stdout.trim());
  assert.ok('hookSpecificOutput' in parsed, 'Expected hookSpecificOutput key in output');
  assert.strictEqual(parsed.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.ok('additionalContext' in parsed.hookSpecificOutput, 'Expected additionalContext in hookSpecificOutput');
});

// ── Test 4: No trigger at 19, trigger again at 40 ───────────────────────────

test('trigger cycle: silent at 19, triggers at 20 and 40', () => {
  const { home } = makeTempHome();

  let result;
  for (let i = 0; i < 19; i++) {
    result = runScript({ prompt: `msg ${i}`, cwd: '/tmp' }, home);
  }
  assert.strictEqual(result.stdout, '', 'Should be silent at message 19');

  result = runScript({ prompt: 'msg 19', cwd: '/tmp' }, home);
  assert.ok(result.stdout.includes('memory'), 'Should trigger at message 20');

  for (let i = 20; i < 39; i++) {
    result = runScript({ prompt: `msg ${i}`, cwd: '/tmp' }, home);
  }
  assert.strictEqual(result.stdout, '', 'Should be silent at message 39');

  result = runScript({ prompt: 'msg 39', cwd: '/tmp' }, home);
  assert.ok(result.stdout.includes('memory'), 'Should trigger again at message 40');
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
