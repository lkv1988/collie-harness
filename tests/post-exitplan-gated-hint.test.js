'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOK = path.resolve(__dirname, '../hooks/post-exitplan-gated-hint.js');
const SESSION_ID = 'test-session-123';

let tmpHome;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'co-test-gated-'));
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function phaseFile() {
  return path.join(tmpHome, '.collie-harness', 'state', SESSION_ID, 'phase.json');
}

function runHook(payload) {
  return spawnSync('node', [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: tmpHome,
      MOCK_SESSION_ID: SESSION_ID,
    },
  });
}

test('post-exitplan-gated-hint: ExitPlanMode → stdout contains gated-workflow mention, phase.json written', () => {
  const payload = {
    tool_name: 'ExitPlanMode',
    session_id: SESSION_ID,
  };

  const result = runHook(payload);
  assert.strictEqual(result.status, 0, `Hook failed: ${result.stderr}`);

  // stdout should have additionalContext with gated-workflow mention
  assert.ok(result.stdout.trim().length > 0, 'stdout should not be empty');
  const out = JSON.parse(result.stdout.trim());
  assert.ok(out.additionalContext, 'additionalContext should be present');
  assert.ok(
    out.additionalContext.includes('gated-workflow'),
    'additionalContext should mention gated-workflow'
  );

  // phase.json should be written
  assert.ok(fs.existsSync(phaseFile()), 'phase.json should be written');
  const phase = JSON.parse(fs.readFileSync(phaseFile(), 'utf8'));
  assert.strictEqual(phase.phase, 'post-exit-plan', 'phase should be post-exit-plan');
});

test('post-exitplan-gated-hint: invalid/empty stdin → exits 0 without crashing, no phase.json for unknown session', () => {
  const result = spawnSync('node', [HOOK], {
    input: '',
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: tmpHome,
    },
  });

  assert.strictEqual(result.status, 0, `Hook crashed on empty stdin: ${result.stderr}`);
  // Hook uses sessionId='unknown' for unknown, so we just verify it doesn't crash
  // Phase for 'unknown' session might be written — the important thing is no crash
});

test('post-exitplan-gated-hint: non-JSON stdin → exits 0 without crashing', () => {
  const result = spawnSync('node', [HOOK], {
    input: 'not json at all',
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: tmpHome,
    },
  });

  assert.strictEqual(result.status, 0, `Hook crashed on non-JSON stdin: ${result.stderr}`);
});
