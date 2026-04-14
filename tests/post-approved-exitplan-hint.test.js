'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOK = path.resolve(__dirname, '../hooks/post-approved-exitplan-hint.js');
const SESSION_ID = 'test-session-123';

let tmpHome;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'kh-test-appr-'));
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function stateDir() {
  return path.join(tmpHome, '.kevin-harness', 'state', SESSION_ID);
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
      MOCK_SESSION_ID: SESSION_ID,
    },
  });
}

test('post-approved-exitplan-hint: Agent plan-doc-reviewer with Approved → last-plan.json written with reviewed:true, stdout has ExitPlanMode hint', () => {
  const payload = {
    tool_name: 'Agent',
    session_id: SESSION_ID,
    tool_input: {
      subagent_type: 'plan-doc-reviewer',
    },
    tool_response: {
      content: '## Review\n\n**Status:** Approved\n\nLooks good, well structured.',
    },
  };

  const result = runHook(payload);
  assert.strictEqual(result.status, 0, `Hook failed: ${result.stderr}`);

  // Check last-plan.json was written
  assert.ok(fs.existsSync(lastPlanFile()), 'last-plan.json should be written after approval');
  const state = JSON.parse(fs.readFileSync(lastPlanFile(), 'utf8'));
  assert.strictEqual(state.reviewed, true, 'reviewed should be true');
  assert.strictEqual(state.approved, true, 'approved should be true');

  // Check stdout has ExitPlanMode hint
  assert.ok(result.stdout.trim().length > 0, 'stdout should not be empty');
  const out = JSON.parse(result.stdout.trim());
  assert.ok(out.additionalContext, 'additionalContext should be present');
  assert.ok(
    out.additionalContext.includes('ExitPlanMode'),
    'additionalContext should mention ExitPlanMode'
  );
});

test('post-approved-exitplan-hint: Agent with non-plan-doc-reviewer subagent → exits 0, no last-plan.json', () => {
  const payload = {
    tool_name: 'Agent',
    session_id: SESSION_ID,
    tool_input: {
      subagent_type: 'code-reviewer',
    },
    tool_response: {
      content: '**Status:** Approved',
    },
  };

  const result = runHook(payload);
  assert.strictEqual(result.status, 0, `Hook failed: ${result.stderr}`);
  assert.ok(!fs.existsSync(lastPlanFile()), 'last-plan.json should NOT be written for non-plan-doc-reviewer');
  assert.strictEqual(result.stdout.trim(), '', 'stdout should be empty for non-plan-doc-reviewer');
});

test('post-approved-exitplan-hint: plan-doc-reviewer without Approved in response → exits 0, no state change', () => {
  const payload = {
    tool_name: 'Agent',
    session_id: SESSION_ID,
    tool_input: {
      subagent_type: 'plan-doc-reviewer',
    },
    tool_response: {
      content: '**Status:** Rejected\n\nNeeds more detail.',
    },
  };

  const result = runHook(payload);
  assert.strictEqual(result.status, 0, `Hook failed: ${result.stderr}`);
  assert.ok(!fs.existsSync(lastPlanFile()), 'last-plan.json should NOT be written when not approved');
  assert.strictEqual(result.stdout.trim(), '', 'stdout should be empty when not approved');
});
