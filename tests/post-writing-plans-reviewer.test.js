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
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'co-test-wpr-'));
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'co-root-wpr-'));
  setupMockPlugin();
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function stateDir() {
  return path.join(tmpHome, '.collie', 'state', SESSION_ID);
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
      file_path: 'docs/plans/2026-04-14-collie-plan.md',
      content: '# Plan',
    },
  };

  const result = runHook(payload);
  assert.strictEqual(result.status, 0, `Hook failed: ${result.stderr}`);
  assert.ok(fs.existsSync(lastPlanFile()), 'last-plan.json should have been written');
  const state = JSON.parse(fs.readFileSync(lastPlanFile(), 'utf8'));
  assert.deepStrictEqual(state.plan_doc_reviewer, { approved: false, approved_at: null });
  assert.deepStrictEqual(state.collie_reviewer, { approved: false, approved_at: null });
  assert.strictEqual(state.reviewed, undefined, 'legacy reviewed field must not exist');
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

test('post-writing-plans-reviewer: ExitPlanMode with unreviewed plan → stdout contains decision:block', () => {
  // Pre-create a last-plan.json with both reviewers pending
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(lastPlanFile(), JSON.stringify({
    path: 'docs/plans/2026-04-14-collie-plan.md',
    written_at: new Date().toISOString(),
    plan_doc_reviewer: { approved: false, approved_at: null },
    collie_reviewer:   { approved: false, approved_at: null },
  }), 'utf8');

  const payload = {
    tool_name: 'ExitPlanMode',
    session_id: SESSION_ID,
  };

  const result = runHook(payload);
  assert.strictEqual(result.status, 0, `Hook failed: ${result.stderr}`);
  assert.ok(result.stdout.trim().length > 0, 'stdout should not be empty for unreviewed plan');
  const out = JSON.parse(result.stdout.trim());
  assert.strictEqual(out.decision, 'block', 'output should have decision:block');
  assert.ok(out.reason, 'output should have reason field');
  assert.ok(
    out.reason.includes('plan-doc-reviewer') &&
    out.reason.includes('collie:review'),
    'reason should mention both reviewers in missing list'
  );
});

test('post-writing-plans-reviewer: ExitPlanMode with reviewed plan → stdout empty, exits 0', () => {
  // Pre-create a last-plan.json with both reviewers approved + actual plan file with metadata
  const planPath = path.join(tmpRoot, 'docs', 'plans', '2026-04-14-collie-plan.md');
  fs.mkdirSync(path.dirname(planPath), { recursive: true });
  fs.writeFileSync(planPath, `<!-- plan-source: ${planPath} -->\n<!-- plan-topic: collie -->\n<!-- plan-executor: collie:flow -->\n# Collie Harness Implementation Plan\n`, 'utf8');
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(lastPlanFile(), JSON.stringify({
    path: planPath,
    written_at: new Date().toISOString(),
    plan_doc_reviewer: { approved: true, approved_at: '2026-04-14T00:00:00Z' },
    collie_reviewer:   { approved: true, approved_at: '2026-04-14T00:00:00Z' },
  }), 'utf8');

  const payload = {
    tool_name: 'ExitPlanMode',
    session_id: SESSION_ID,
  };

  const result = runHook(payload);
  assert.strictEqual(result.status, 0, `Hook failed: ${result.stderr}`);
  assert.strictEqual(result.stdout.trim(), '', 'stdout should be empty when plan is already reviewed');
});

test('post-writing-plans-reviewer: Write creates dual-reviewer schema (no legacy fields)', () => {
  const payload = {
    tool_name: 'Write',
    session_id: SESSION_ID,
    tool_input: { file_path: 'docs/plans/2026-04-14-foo-plan.md', content: '# Plan' },
  };
  const result = runHook(payload);
  assert.strictEqual(result.status, 0);
  const state = JSON.parse(fs.readFileSync(lastPlanFile(), 'utf8'));
  assert.deepStrictEqual(state.plan_doc_reviewer, { approved: false, approved_at: null });
  assert.deepStrictEqual(state.collie_reviewer, { approved: false, approved_at: null });
  assert.strictEqual(state.reviewed, undefined, 'legacy reviewed field must not exist');
  assert.strictEqual(state.approved, undefined, 'legacy approved field must not exist');
});

test('post-writing-plans-reviewer: ExitPlanMode WARN when both reviewers pending', () => {
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(lastPlanFile(), JSON.stringify({
    path: 'docs/plans/foo-plan.md',
    written_at: new Date().toISOString(),
    plan_doc_reviewer: { approved: false, approved_at: null },
    collie_reviewer:   { approved: false, approved_at: null },
  }), 'utf8');
  const result = runHook({ tool_name: 'ExitPlanMode', session_id: SESSION_ID });
  assert.strictEqual(result.status, 0);
  const out = JSON.parse(result.stdout.trim());
  assert.strictEqual(out.decision, 'block', 'decision should be block');
  assert.ok(out.reason.includes('plan-doc-reviewer'), 'reason should include plan-doc-reviewer');
  assert.ok(out.reason.includes('collie:review'), 'reason should include collie:review');
});

test('post-writing-plans-reviewer: ExitPlanMode WARN when only plan-doc-reviewer approved', () => {
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(lastPlanFile(), JSON.stringify({
    path: 'docs/plans/foo-plan.md',
    written_at: new Date().toISOString(),
    plan_doc_reviewer: { approved: true, approved_at: '2026-04-14T00:00:00Z' },
    collie_reviewer:   { approved: false, approved_at: null },
  }), 'utf8');
  const result = runHook({ tool_name: 'ExitPlanMode', session_id: SESSION_ID });
  assert.strictEqual(result.status, 0);
  const out = JSON.parse(result.stdout.trim());
  assert.strictEqual(out.decision, 'block', 'decision should be block');
  assert.ok(out.reason.includes('collie:review'), 'reason should include collie:review');
  // The missing list (before 批准) should only mention collie:review, not plan-doc-reviewer
  const missingMatch7 = out.reason.match(/尚未被 ([^批]+)批准/);
  assert.ok(missingMatch7, 'reason should contain missing list pattern');
  assert.ok(!missingMatch7[1].includes('plan-doc-reviewer'), 'missing list should NOT include already-approved plan-doc-reviewer');
});

test('post-writing-plans-reviewer: ExitPlanMode WARN when only collie:review approved', () => {
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(lastPlanFile(), JSON.stringify({
    path: 'docs/plans/foo-plan.md',
    written_at: new Date().toISOString(),
    plan_doc_reviewer: { approved: false, approved_at: null },
    collie_reviewer:   { approved: true, approved_at: '2026-04-14T00:00:00Z' },
  }), 'utf8');
  const result = runHook({ tool_name: 'ExitPlanMode', session_id: SESSION_ID });
  assert.strictEqual(result.status, 0);
  const out = JSON.parse(result.stdout.trim());
  assert.strictEqual(out.decision, 'block', 'decision should be block');
  assert.ok(out.reason.includes('plan-doc-reviewer'), 'reason should include plan-doc-reviewer');
  // The missing list (before 批准) should only mention plan-doc-reviewer, not collie:review
  const missingMatch8 = out.reason.match(/尚未被 ([^批]+)批准/);
  assert.ok(missingMatch8, 'reason should contain missing list pattern');
  assert.ok(!missingMatch8[1].includes('collie:review'), 'missing list should NOT include already-approved collie:review');
});

test('post-writing-plans-reviewer: ExitPlanMode silent when both reviewers approved', () => {
  const planPath = path.join(tmpRoot, 'docs', 'plans', 'foo-plan.md');
  fs.mkdirSync(path.dirname(planPath), { recursive: true });
  fs.writeFileSync(planPath, `<!-- plan-source: ${planPath} -->\n<!-- plan-topic: foo -->\n<!-- plan-executor: collie:flow -->\n# Foo Implementation Plan\n`, 'utf8');
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(lastPlanFile(), JSON.stringify({
    path: planPath,
    written_at: new Date().toISOString(),
    plan_doc_reviewer: { approved: true, approved_at: '2026-04-14T00:00:00Z' },
    collie_reviewer:   { approved: true, approved_at: '2026-04-14T00:00:00Z' },
  }), 'utf8');
  const result = runHook({ tool_name: 'ExitPlanMode', session_id: SESSION_ID });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout.trim(), '', 'stdout must be empty when both reviewers approved');
});

test('post-writing-plans-reviewer: ExitPlanMode BLOCK when plan-executor missing', () => {
  const planPath = path.join(tmpRoot, 'docs', 'plans', 'no-executor-plan.md');
  fs.mkdirSync(path.dirname(planPath), { recursive: true });
  fs.writeFileSync(planPath,
    `<!-- plan-source: ${planPath} -->\n<!-- plan-topic: no-executor -->\n# No Executor Plan\n`, 'utf8');
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(lastPlanFile(), JSON.stringify({
    path: planPath,
    written_at: new Date().toISOString(),
    plan_doc_reviewer: { approved: true, approved_at: '2026-04-16T00:00:00Z' },
    collie_reviewer:   { approved: true, approved_at: '2026-04-16T00:00:00Z' },
  }), 'utf8');
  const result = runHook({ tool_name: 'ExitPlanMode', session_id: SESSION_ID });
  assert.strictEqual(result.status, 0);
  const out = JSON.parse(result.stdout.trim());
  assert.strictEqual(out.decision, 'block', 'should block when plan-executor missing');
  assert.ok(out.reason.includes('plan-executor'), 'reason should mention plan-executor');
});

test('post-writing-plans-reviewer: ExitPlanMode passes with all three metadata lines', () => {
  const planPath = path.join(tmpRoot, 'docs', 'plans', 'full-meta-plan.md');
  fs.mkdirSync(path.dirname(planPath), { recursive: true });
  fs.writeFileSync(planPath,
    `<!-- plan-source: ${planPath} -->\n<!-- plan-topic: full-meta -->\n<!-- plan-executor: collie:flow -->\n# Full Meta Plan\n`, 'utf8');
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(lastPlanFile(), JSON.stringify({
    path: planPath,
    written_at: new Date().toISOString(),
    plan_doc_reviewer: { approved: true, approved_at: '2026-04-16T00:00:00Z' },
    collie_reviewer:   { approved: true, approved_at: '2026-04-16T00:00:00Z' },
  }), 'utf8');
  const result = runHook({ tool_name: 'ExitPlanMode', session_id: SESSION_ID });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout.trim(), '', 'should pass silently with all 3 metadata');
});
