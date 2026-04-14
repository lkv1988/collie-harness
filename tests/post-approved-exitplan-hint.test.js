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
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'co-test-appr-'));
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function stateDir() {
  return path.join(tmpHome, '.collie-harness', 'state', SESSION_ID);
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
  assert.strictEqual(state.plan_doc_reviewer.approved, true, 'plan_doc_reviewer.approved should be true');
  assert.ok(state.plan_doc_reviewer.approved_at, 'plan_doc_reviewer.approved_at should be set');
  // legacy flat fields must NOT be written
  assert.strictEqual(state.reviewed, undefined, 'legacy reviewed field must not exist');
  assert.strictEqual(state.approved, undefined, 'legacy approved field must not exist');

  // Check stdout has ExitPlanMode hint or mentions next step
  assert.ok(result.stdout.trim().length > 0, 'stdout should not be empty');
  const out = JSON.parse(result.stdout.trim());
  assert.ok(out.additionalContext, 'additionalContext should be present');
  assert.ok(
    out.additionalContext.includes('ExitPlanMode') || out.additionalContext.includes('collie-reviewer'),
    'additionalContext should mention ExitPlanMode or next step'
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

test('post-approved-exitplan-hint: Skill collie-reviewer PASS updates collie_reviewer branch', () => {
  // Pre-seed state with plan_doc_reviewer already approved
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(lastPlanFile(), JSON.stringify({
    path: 'docs/plans/foo-plan.md',
    written_at: '2026-04-14T00:00:00Z',
    plan_doc_reviewer: { approved: false, approved_at: null },
    collie_reviewer:   { approved: false, approved_at: null },
  }), 'utf8');

  const payload = {
    tool_name: 'Skill',
    session_id: SESSION_ID,
    tool_input: { skill: 'collie-reviewer' },
    tool_response: {
      content: '## Collie Reviewer\n\n**Mode:** plan\n**Target:** docs/plans/foo-plan.md\n**Status:** PASS\n\n### Red line violations\n- None\n',
    },
  };

  const result = runHook(payload);
  assert.strictEqual(result.status, 0, `Hook failed: ${result.stderr}`);

  const state = JSON.parse(fs.readFileSync(lastPlanFile(), 'utf8'));
  assert.strictEqual(state.collie_reviewer.approved, true, 'collie_reviewer.approved should be true');
  assert.ok(state.collie_reviewer.approved_at, 'collie_reviewer.approved_at should be set');
  assert.strictEqual(state.plan_doc_reviewer.approved, false, 'plan_doc_reviewer.approved should remain false');

  const out = JSON.parse(result.stdout.trim());
  assert.ok(out.additionalContext.includes('plan-doc-reviewer'), 'hint should mention still-waiting plan-doc-reviewer');
});

test('post-approved-exitplan-hint: Skill collie-reviewer WARN does not update state', () => {
  const payload = {
    tool_name: 'Skill',
    session_id: SESSION_ID,
    tool_input: { skill: 'collie-reviewer' },
    tool_response: {
      content: '## Collie Reviewer\n\n**Status:** WARN\n\n### Issues\n- Some issue',
    },
  };

  const result = runHook(payload);
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout.trim(), '', 'stdout should be empty when status is not PASS');
  assert.ok(!fs.existsSync(lastPlanFile()), 'last-plan.json should NOT be written for non-PASS collie-reviewer');
});

test('post-approved-exitplan-hint: two-step plan-doc then collie PASS → both approved hint', () => {
  // First: plan-doc-reviewer approves
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(lastPlanFile(), JSON.stringify({
    path: 'docs/plans/foo-plan.md',
    written_at: '2026-04-14T00:00:00Z',
    plan_doc_reviewer: { approved: false, approved_at: null },
    collie_reviewer:   { approved: false, approved_at: null },
  }), 'utf8');

  runHook({
    tool_name: 'Agent',
    session_id: SESSION_ID,
    tool_input: { subagent_type: 'plan-doc-reviewer' },
    tool_response: { content: '**Status:** Approved\n\nLooks good.' },
  });

  // Second: collie-reviewer PASS
  const result2 = runHook({
    tool_name: 'Skill',
    session_id: SESSION_ID,
    tool_input: { skill: 'collie-reviewer' },
    tool_response: {
      content: '## Collie Reviewer\n\n**Status:** PASS\n\n### Red line violations\n- None\n',
    },
  });

  assert.strictEqual(result2.status, 0);
  const state = JSON.parse(fs.readFileSync(lastPlanFile(), 'utf8'));
  assert.strictEqual(state.plan_doc_reviewer.approved, true);
  assert.strictEqual(state.collie_reviewer.approved, true);

  const out = JSON.parse(result2.stdout.trim());
  assert.ok(out.additionalContext.includes('both'), 'hint should say "both" approved');
  assert.ok(out.additionalContext.includes('ExitPlanMode'), 'hint should tell to call ExitPlanMode');
});

test('post-approved-exitplan-hint: regex tolerant to extra whitespace in Status line', () => {
  const payload = {
    tool_name: 'Skill',
    session_id: SESSION_ID,
    tool_input: { skill: 'collie-reviewer' },
    tool_response: {
      // Double space between ** and PASS
      content: '## Collie Reviewer\n\n**Status:**  PASS\n\n### Red line violations\n- None\n',
    },
  };

  const result = runHook(payload);
  assert.strictEqual(result.status, 0);

  const out = JSON.parse(result.stdout.trim());
  assert.ok(out.additionalContext, 'double-space Status: PASS should still be recognized');
});
