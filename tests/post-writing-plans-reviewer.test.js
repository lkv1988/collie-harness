'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOK = path.resolve(__dirname, '../hooks/post-writing-plans-reviewer.js');
const SESSION_ID = 'test-session-123';

let tmpHome;
let tmpRoot;

function setupMockPlugin() {
  const scriptsDir = path.join(tmpRoot, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  const escalateSh = path.join(scriptsDir, 'escalate.sh');
  fs.writeFileSync(escalateSh, `#!/bin/bash\nexit 0\n`, 'utf8');
  fs.chmodSync(escalateSh, 0o755);
}

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-test-wpr-'));
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-root-wpr-'));
  setupMockPlugin();
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function stateDir() {
  return path.join(tmpHome, '.kevin-proxy', 'state', SESSION_ID);
}

function lastPlanFile() {
  return path.join(stateDir(), 'last-plan.json');
}

function runHook(payload) {
  return spawnSync('node', [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: tmpHome,
      CLAUDE_PLUGIN_ROOT: tmpRoot,
      MOCK_SESSION_ID: SESSION_ID,
    },
  });
}

test('post-writing-plans-reviewer: Write to plan file → last-plan.json written with reviewed:false', () => {
  const payload = {
    tool_name: 'Write',
    session_id: SESSION_ID,
    tool_input: {
      file_path: 'docs/plans/2026-04-14-kevin-proxy-plan.md',
      content: '# Plan',
    },
  };

  const result = runHook(payload);
  assert.strictEqual(result.status, 0, `Hook failed: ${result.stderr}`);
  assert.ok(fs.existsSync(lastPlanFile()), 'last-plan.json should have been written');
  const state = JSON.parse(fs.readFileSync(lastPlanFile(), 'utf8'));
  assert.strictEqual(state.reviewed, false, 'reviewed should be false');
  assert.ok(state.path.includes('plans'), 'path should reference the plan file');
});

test('post-writing-plans-reviewer: Write to non-plan file → no last-plan.json written', () => {
  const payload = {
    tool_name: 'Write',
    session_id: SESSION_ID,
    tool_input: {
      file_path: 'src/index.ts',
      content: 'export default {}',
    },
  };

  const result = runHook(payload);
  assert.strictEqual(result.status, 0, `Hook failed: ${result.stderr}`);
  assert.ok(!fs.existsSync(lastPlanFile()), 'last-plan.json should NOT be written for non-plan files');
});

test('post-writing-plans-reviewer: ExitPlanMode with unreviewed plan → stdout contains additionalContext WARN', () => {
  // Pre-create a last-plan.json with reviewed:false
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(lastPlanFile(), JSON.stringify({
    path: 'docs/plans/2026-04-14-kevin-proxy-plan.md',
    reviewed: false,
    approved: false,
    written_at: new Date().toISOString(),
  }), 'utf8');

  const payload = {
    tool_name: 'ExitPlanMode',
    session_id: SESSION_ID,
  };

  const result = runHook(payload);
  assert.strictEqual(result.status, 0, `Hook failed: ${result.stderr}`);
  assert.ok(result.stdout.trim().length > 0, 'stdout should not be empty for unreviewed plan');
  const out = JSON.parse(result.stdout.trim());
  assert.ok(out.additionalContext, 'output should have additionalContext field');
  assert.ok(
    out.additionalContext.includes('plan-doc-reviewer') || out.additionalContext.includes('plan'),
    'additionalContext should mention plan-doc-reviewer'
  );
});

test('post-writing-plans-reviewer: ExitPlanMode with reviewed plan → stdout empty, exits 0', () => {
  // Pre-create a last-plan.json with reviewed:true
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(lastPlanFile(), JSON.stringify({
    path: 'docs/plans/2026-04-14-kevin-proxy-plan.md',
    reviewed: true,
    approved: true,
    written_at: new Date().toISOString(),
  }), 'utf8');

  const payload = {
    tool_name: 'ExitPlanMode',
    session_id: SESSION_ID,
  };

  const result = runHook(payload);
  assert.strictEqual(result.status, 0, `Hook failed: ${result.stderr}`);
  assert.strictEqual(result.stdout.trim(), '', 'stdout should be empty when plan is already reviewed');
});
