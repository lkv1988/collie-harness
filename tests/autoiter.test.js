'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// --- Module under test (path helpers, jaccard) ---
const STATE_JS = path.resolve(__dirname, '../hooks/_state.js');
const JACCARD_JS = path.resolve(__dirname, '../skills/autoiter/lib/jaccard.js');
const HOOK = path.resolve(__dirname, '../hooks/post-writing-plans-reviewer.js');
const FIX_PLAN_TEMPLATE = path.resolve(__dirname, '../skills/autoiter/references/fix-plan-template.md');
const SESSION_ID = 'test-loop-session-456';

// jaccard.js has no env dependency — require once
const { jaccard, bucketize } = require(JACCARD_JS);

// ---------------------------------------------------------------------------
// Group 1: _state.js path helpers
// ---------------------------------------------------------------------------

describe('_state.js path helpers', () => {
  // Helper: run a snippet via spawnSync with optional COLLIE_HARNESS_HOME
  function evalState(snippet, extraEnv = {}) {
    const script = `
      const s = require('${STATE_JS}');
      const result = (${snippet})(s);
      process.stdout.write(JSON.stringify({ value: result }));
    `;
    return spawnSync('node', ['-e', script], {
      encoding: 'utf8',
      env: { ...process.env, ...extraEnv },
    });
  }

  test('projectId: real repo cwd encodes to Users-kevin-git-collie-harness-worktrees-loop-command', () => {
    // Use the real repo cwd — git rev-parse is real
    const { projectId } = require(STATE_JS);
    const id = projectId(path.resolve(__dirname, '..'));
    // The worktree root is /Users/kevin/git/collie-harness/.worktrees/loop-command
    // After slug: Users-kevin-git-collie-harness-.worktrees-loop-command
    assert.ok(typeof id === 'string', 'projectId should return a string');
    assert.ok(id.length > 0, 'projectId should not be empty');
    // Must contain known path fragments
    assert.ok(id.includes('collie-harness') || id.includes('loop-command'),
      `projectId should contain repo name fragment, got: ${id}`);
    // Must not start with a dash
    assert.ok(!id.startsWith('-'), `projectId must not start with dash, got: ${id}`);
  });

  test('projectId: slug encoding replaces slashes with dashes and strips leading dash', () => {
    // Test the encoding logic by verifying the known path
    const { projectId } = require(STATE_JS);
    const id = projectId(path.resolve(__dirname, '..'));
    // Slash-separated path segments → dash-joined
    assert.ok(!id.includes('/'), 'projectId must not contain slashes');
  });

  test('loopDir default (no COLLIE_HARNESS_HOME): path contains ~/.collie-harness/autoiter/myproject/run1', () => {
    const result = evalState(s => s.loopDir('myproject', 'run1'));
    assert.strictEqual(result.status, 0, result.stderr);
    const { value } = JSON.parse(result.stdout);
    // path.join normalizes trailing '': no trailing separator guaranteed
    const expected = path.join(os.homedir(), '.collie-harness', 'autoiter', 'myproject', 'run1');
    assert.ok(value.startsWith(expected), `loopDir should start with ${expected}, got: ${value}`);
    assert.ok(value.includes(path.join('autoiter', 'myproject', 'run1')),
      `loopDir should include autoiter/myproject/run1, got: ${value}`);
  });

  test('loopDir with COLLIE_HARNESS_HOME=/tmp/x: path starts with /tmp/x/autoiter/', () => {
    const result = evalState(s => s.loopDir('myproject', 'run1'), { COLLIE_HARNESS_HOME: '/tmp/x' });
    assert.strictEqual(result.status, 0, result.stderr);
    const { value } = JSON.parse(result.stdout);
    assert.ok(value.startsWith('/tmp/x/autoiter/'), `loopDir should start with /tmp/x/autoiter/, got: ${value}`);
    assert.ok(value.includes('myproject'), `loopDir should include projectId, got: ${value}`);
    assert.ok(value.includes('run1'), `loopDir should include runId, got: ${value}`);
  });

  test('currentRunFile: path contains projectId fragment and ends with "current-run"', () => {
    const result = evalState(s => s.currentRunFile('testproject'));
    assert.strictEqual(result.status, 0, result.stderr);
    const { value } = JSON.parse(result.stdout);
    assert.ok(value.includes('testproject'), `currentRunFile should include projectId, got: ${value}`);
    assert.ok(value.endsWith('current-run'), `currentRunFile should end with "current-run", got: ${value}`);
  });

  test('currentRunFile: different projectIds produce different paths', () => {
    const r1 = evalState(s => s.currentRunFile('proj-a'));
    const r2 = evalState(s => s.currentRunFile('proj-b'));
    assert.strictEqual(r1.status, 0);
    assert.strictEqual(r2.status, 0);
    const v1 = JSON.parse(r1.stdout).value;
    const v2 = JSON.parse(r2.stdout).value;
    assert.notStrictEqual(v1, v2, 'different projectIds must yield different currentRunFile paths');
  });

  test('iterDir n=0: path contains iter-0 segment', () => {
    const result = evalState(s => s.iterDir('myproject', 'run1', 0));
    assert.strictEqual(result.status, 0, result.stderr);
    const { value } = JSON.parse(result.stdout);
    // path.join normalizes trailing '': path ends in 'iter-0' (no trailing sep guaranteed)
    const segment = path.join('run1', 'iter-0');
    assert.ok(value.includes(segment),
      `iterDir(0) should include "${segment}", got: ${value}`);
  });

  test('iterDir n=99: path contains iter-99 segment', () => {
    const result = evalState(s => s.iterDir('myproject', 'run1', 99));
    assert.strictEqual(result.status, 0, result.stderr);
    const { value } = JSON.parse(result.stdout);
    const segment = path.join('run1', 'iter-99');
    assert.ok(value.includes(segment),
      `iterDir(99) should include "${segment}", got: ${value}`);
  });
});

// ---------------------------------------------------------------------------
// Group 2: jaccard.js
// ---------------------------------------------------------------------------

describe('jaccard.js', () => {
  test('jaccard same string → 1.0', () => {
    assert.strictEqual(jaccard('hello world', 'hello world'), 1.0);
  });

  test('jaccard completely different strings → 0.0', () => {
    assert.strictEqual(jaccard('foo bar', 'baz qux'), 0.0);
  });

  test('jaccard partial overlap: "foo bar baz" vs "foo bar qux" → ~0.5', () => {
    // intersection={foo,bar}=2, union={foo,bar,baz,qux}=4 → 2/4=0.5
    assert.strictEqual(jaccard('foo bar baz', 'foo bar qux'), 0.5);
  });

  test('jaccard empty strings → 1.0 (both empty sets)', () => {
    assert.strictEqual(jaccard('', ''), 1.0);
  });

  test('bucketize(0.0) → 1', () => {
    assert.strictEqual(bucketize(0.0), 1);
  });

  test('bucketize(0.2) → 1 (inclusive upper boundary)', () => {
    assert.strictEqual(bucketize(0.2), 1);
  });

  test('bucketize(0.21) → 2', () => {
    assert.strictEqual(bucketize(0.21), 2);
  });

  test('bucketize(0.4) → 2 (inclusive upper boundary)', () => {
    assert.strictEqual(bucketize(0.4), 2);
  });

  test('bucketize(0.6) → 3 (inclusive upper boundary)', () => {
    assert.strictEqual(bucketize(0.6), 3);
  });

  test('bucketize(0.61) → 4', () => {
    assert.strictEqual(bucketize(0.61), 4);
  });

  test('bucketize(0.8) → 4 (inclusive upper boundary)', () => {
    assert.strictEqual(bucketize(0.8), 4);
  });

  test('bucketize(0.81) → 5', () => {
    assert.strictEqual(bucketize(0.81), 5);
  });

  test('bucketize(1.0) → 5', () => {
    assert.strictEqual(bucketize(1.0), 5);
  });
});

// ---------------------------------------------------------------------------
// Group 3: fix-plan-template.md structure
// ---------------------------------------------------------------------------

describe('fix-plan-template.md structure', () => {
  let content;
  // Read once before all tests in this group
  beforeEach(() => {
    if (!content) {
      content = fs.readFileSync(FIX_PLAN_TEMPLATE, 'utf8');
    }
  });

  test('contains <!-- plan-source: ... --> metadata comment', () => {
    assert.ok(/<!--\s*plan-source:/.test(content),
      'fix-plan-template.md must contain <!-- plan-source: ... -->');
  });

  test('contains <!-- plan-topic: ... --> metadata comment', () => {
    assert.ok(/<!--\s*plan-topic:/.test(content),
      'fix-plan-template.md must contain <!-- plan-topic: ... -->');
  });

  test('contains <!-- plan-executor: ... --> metadata comment', () => {
    assert.ok(/<!--\s*plan-executor:/.test(content),
      'fix-plan-template.md must contain <!-- plan-executor: ... -->');
  });

  test('contains "For agentic workers"', () => {
    assert.ok(content.includes('For agentic workers'),
      'fix-plan-template.md must contain "For agentic workers"');
  });

  test('contains "## Task Execution DAG" section', () => {
    assert.ok(content.includes('## Task Execution DAG'),
      'fix-plan-template.md must contain "## Task Execution DAG"');
  });

  test('contains "## Impact Assessment" section', () => {
    assert.ok(content.includes('## Impact Assessment'),
      'fix-plan-template.md must contain "## Impact Assessment"');
  });

  test('contains "## E2E Assessment" section', () => {
    assert.ok(content.includes('## E2E Assessment'),
      'fix-plan-template.md must contain "## E2E Assessment"');
  });
});

// ---------------------------------------------------------------------------
// Group 4: hook autoiter-stage0 bypass (via spawnSync)
// ---------------------------------------------------------------------------

describe('hook: autoiter-stage0 bypass in post-writing-plans-reviewer', () => {
  let tmpHome;
  let tmpRoot;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'co-test-loop-'));
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'co-root-loop-'));
    // Create a no-op escalate.sh
    const scriptsDir = path.join(tmpRoot, 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });
    const escalateSh = path.join(scriptsDir, 'escalate.sh');
    fs.writeFileSync(escalateSh, '#!/bin/bash\nexit 0\n', 'utf8');
    fs.chmodSync(escalateSh, 0o755);
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
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
        COLLIE_HARNESS_HOME: path.join(tmpHome, '.collie-harness'),
        CLAUDE_PLUGIN_ROOT: tmpRoot,
        MOCK_SESSION_ID: SESSION_ID,
      },
    });
  }

  /**
   * Create a valid autoiter-stage0 plan file at planPath with all required fields.
   * The hook uses /trigger[^\n]*kind:/ and /success_criterion[^\n]*type:/ regexes,
   * so both fields must appear on the same line as their prefix.
   */
  function writeValidLoopStage0Plan(planPath) {
    const content = [
      `<!-- plan-source: ${planPath} -->`,
      `<!-- plan-kind: autoiter-stage0 -->`,
      `<!-- plan-executor: collie-harness:autoiter -->`,
      ``,
      `# Loop Stage 0 Plan`,
      ``,
      `primary_goal: fix all test failures`,
      `trigger: {kind: manual}`,
      `success_criterion: {type: test-pass}`,
      `iter_rollback_policy: revert-on-failure`,
    ].join('\n');
    fs.mkdirSync(path.dirname(planPath), { recursive: true });
    fs.writeFileSync(planPath, content, 'utf8');
  }

  test('autoiter-stage0: valid plan with all 3 metadata + 4 enum fields → ExitPlanMode returns approve', () => {
    const planPath = path.join(tmpRoot, 'docs', 'plans', 'autoiter-stage0-plan.md');
    writeValidLoopStage0Plan(planPath);

    // Write last-plan.json (reviewers NOT approved — bypass should skip dual-reviewer check)
    fs.mkdirSync(stateDir(), { recursive: true });
    fs.writeFileSync(lastPlanFile(), JSON.stringify({
      path: planPath,
      written_at: new Date().toISOString(),
      plan_doc_reviewer: { approved: false, approved_at: null },
      collie_reviewer:   { approved: false, approved_at: null },
    }), 'utf8');

    const result = runHook({ tool_name: 'ExitPlanMode', session_id: SESSION_ID });
    assert.strictEqual(result.status, 0, `Hook failed: ${result.stderr}`);
    const stdout = result.stdout.trim();
    assert.ok(stdout.length > 0, 'stdout should not be empty for autoiter-stage0 approval');
    const out = JSON.parse(stdout);
    assert.notStrictEqual(out.decision, 'block',
      `autoiter-stage0 with valid plan should NOT block, got: ${JSON.stringify(out)}`);
    assert.strictEqual(out.decision, 'approve', `expected approve, got: ${JSON.stringify(out)}`);
  });

  test('autoiter-stage0: plan missing plan-source → returns block mentioning plan-source', () => {
    const planPath = path.join(tmpRoot, 'docs', 'plans', 'missing-source-plan.md');
    // Plan has plan-kind and plan-executor but NO plan-source
    const content = [
      `<!-- plan-kind: autoiter-stage0 -->`,
      `<!-- plan-executor: collie-harness:autoiter -->`,
      ``,
      `# Loop Stage 0 Plan`,
      `primary_goal: fix issues`,
      `trigger:`,
      `  kind: manual`,
      `success_criterion:`,
      `  type: test-pass`,
      `iter_rollback_policy: none`,
    ].join('\n');
    fs.mkdirSync(path.dirname(planPath), { recursive: true });
    fs.writeFileSync(planPath, content, 'utf8');

    fs.mkdirSync(stateDir(), { recursive: true });
    fs.writeFileSync(lastPlanFile(), JSON.stringify({
      path: planPath,
      written_at: new Date().toISOString(),
      plan_doc_reviewer: { approved: false, approved_at: null },
      collie_reviewer:   { approved: false, approved_at: null },
    }), 'utf8');

    const result = runHook({ tool_name: 'ExitPlanMode', session_id: SESSION_ID });
    assert.strictEqual(result.status, 0, `Hook failed: ${result.stderr}`);
    const out = JSON.parse(result.stdout.trim());
    assert.strictEqual(out.decision, 'block', 'should block when plan-source is missing');
    assert.ok(out.reason.includes('plan-source'),
      `reason should mention "plan-source", got: ${out.reason}`);
  });

  test('autoiter-stage0: non-autoiter-stage0 plan falls through to existing dual-reviewer logic (blocks when not approved)', () => {
    // A plan with no plan-kind → falls through to dual-reviewer logic → blocks (reviewers not approved)
    const planPath = path.join(tmpRoot, 'docs', 'plans', 'normal-plan.md');
    const content = [
      `<!-- plan-source: ${planPath} -->`,
      `<!-- plan-topic: normal-topic -->`,
      `<!-- plan-executor: collie-harness:gated-workflow -->`,
      ``,
      `# Normal Plan`,
    ].join('\n');
    fs.mkdirSync(path.dirname(planPath), { recursive: true });
    fs.writeFileSync(planPath, content, 'utf8');

    fs.mkdirSync(stateDir(), { recursive: true });
    fs.writeFileSync(lastPlanFile(), JSON.stringify({
      path: planPath,
      written_at: new Date().toISOString(),
      plan_doc_reviewer: { approved: false, approved_at: null },
      collie_reviewer:   { approved: false, approved_at: null },
    }), 'utf8');

    const result = runHook({ tool_name: 'ExitPlanMode', session_id: SESSION_ID });
    assert.strictEqual(result.status, 0, `Hook failed: ${result.stderr}`);
    const out = JSON.parse(result.stdout.trim());
    // The bypass must NOT engage — should hit normal dual-reviewer block
    assert.strictEqual(out.decision, 'block',
      'non-autoiter-stage0 plan with unapproved reviewers should block');
    // Should mention both reviewers (normal dual-reviewer block message)
    assert.ok(
      out.reason.includes('plan-doc-reviewer') || out.reason.includes('collie-harness:review'),
      `reason should mention reviewer(s), got: ${out.reason}`
    );
  });
});
