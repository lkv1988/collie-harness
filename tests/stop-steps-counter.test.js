'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOK = path.resolve(__dirname, '../hooks/stop-steps-counter.js');
const SESSION_ID = 'test-session-123';
const ESCALATE_LOG = path.join(os.tmpdir(), 'escalate-calls-stop.log');

let tmpHome;
let tmpRoot;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'kh-test-stop-'));
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kh-root-stop-'));

  const scriptsDir = path.join(tmpRoot, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  const escalateSh = path.join(scriptsDir, 'escalate.sh');
  fs.writeFileSync(escalateSh, `#!/bin/bash\necho "$@" >> "${ESCALATE_LOG}"\nexit 0\n`, 'utf8');
  fs.chmodSync(escalateSh, 0o755);

  if (fs.existsSync(ESCALATE_LOG)) fs.unlinkSync(ESCALATE_LOG);
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  if (fs.existsSync(ESCALATE_LOG)) fs.unlinkSync(ESCALATE_LOG);
});

function stateDir() {
  return path.join(tmpHome, '.kevin-harness', 'state', SESSION_ID);
}

function makeTranscriptFile(lines) {
  const transcriptPath = path.join(tmpHome, 'transcript.jsonl');
  fs.writeFileSync(transcriptPath, lines.map(l => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  return transcriptPath;
}

function writeCounterState(state) {
  const dir = stateDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'counter.json'), JSON.stringify(state, null, 2), 'utf8');
}

function runHook(transcriptPath, extra = {}) {
  const payload = {
    session_id: SESSION_ID,
    transcript_path: transcriptPath,
    ...extra,
  };
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

test('stop-steps-counter: same error 3 times → escalate called with loop_on_same_error, stdout has block decision', () => {
  // The same error text repeated 3 times in transcript
  const errorText = 'Error: Cannot find module foo';
  const transcriptLines = [
    { role: 'tool', name: 'Bash', content: errorText },
    { role: 'tool', name: 'Bash', content: errorText },
    { role: 'tool', name: 'Bash', content: errorText },
  ];
  const transcriptPath = makeTranscriptFile(transcriptLines);

  // Pre-seed counter with same_error_count=2 so this run pushes it to 3
  writeCounterState({
    last_tool_errors: [],
    same_error_count: 2,
    no_progress_steps: 0,
    last_file_change_at: null,
    total_steps: 5,
  });

  const result = runHook(transcriptPath);
  assert.strictEqual(result.status, 0, `Hook failed: ${result.stderr}`);

  const stdout = result.stdout.trim();
  assert.ok(stdout.length > 0, 'stdout should not be empty');
  const out = JSON.parse(stdout);
  assert.strictEqual(out.decision, 'block', 'decision should be block');

  // Escalate should have been called
  assert.ok(fs.existsSync(ESCALATE_LOG), 'escalate.sh should have been called');
  const log = fs.readFileSync(ESCALATE_LOG, 'utf8');
  assert.ok(log.includes('loop_on_same_error'), 'escalate should be called with loop_on_same_error');
});

test('stop-steps-counter: 5+ tool results with no Write/Edit success → escalate called with no_progress, stdout has block decision', () => {
  // Transcript with 5 tool results, none are successful Write/Edit
  const transcriptLines = [
    { role: 'tool', name: 'Bash', content: 'some output' },
    { role: 'tool', name: 'Bash', content: 'some output' },
    { role: 'tool', name: 'Bash', content: 'some output' },
    { role: 'tool', name: 'Bash', content: 'some output' },
    { role: 'tool', name: 'Bash', content: 'some output' },
  ];
  const transcriptPath = makeTranscriptFile(transcriptLines);

  // Pre-seed counter with no_progress_steps=4 so this run pushes it to 5
  writeCounterState({
    last_tool_errors: [],
    same_error_count: 0,
    no_progress_steps: 4,
    last_file_change_at: null,
    total_steps: 10,
  });

  const result = runHook(transcriptPath);
  assert.strictEqual(result.status, 0, `Hook failed: ${result.stderr}`);

  const stdout = result.stdout.trim();
  assert.ok(stdout.length > 0, 'stdout should not be empty');
  const out = JSON.parse(stdout);
  assert.strictEqual(out.decision, 'block', 'decision should be block');

  // Escalate should have been called
  assert.ok(fs.existsSync(ESCALATE_LOG), 'escalate.sh should have been called');
  const log = fs.readFileSync(ESCALATE_LOG, 'utf8');
  assert.ok(log.includes('no_progress'), 'escalate should be called with no_progress');
});

test('stop-steps-counter: Write success in transcript → no escalation, exits 0 with no output', () => {
  // Transcript with a successful Write result
  const transcriptLines = [
    { role: 'tool', name: 'Write', content: 'File written successfully' },
    { role: 'tool', name: 'Bash', content: 'some output' },
  ];
  const transcriptPath = makeTranscriptFile(transcriptLines);

  // Even if counters are high, a file change resets no_progress_steps
  writeCounterState({
    last_tool_errors: [],
    same_error_count: 0,
    no_progress_steps: 10,
    last_file_change_at: null,
    total_steps: 10,
  });

  const result = runHook(transcriptPath);
  assert.strictEqual(result.status, 0, `Hook failed: ${result.stderr}`);
  assert.strictEqual(result.stdout.trim(), '', 'stdout should be empty when there is progress');
  assert.ok(!fs.existsSync(ESCALATE_LOG), 'escalate.sh should NOT have been called');
});
