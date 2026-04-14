'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOK = path.resolve(__dirname, '../hooks/pre-tool-quota-guard.js');

let tmpHome;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'co-test-guard-'));
  // Create necessary directories
  fs.mkdirSync(path.join(tmpHome, '.collie-harness', 'state'), { recursive: true });
  fs.mkdirSync(path.join(tmpHome, '.collie-harness', 'config'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function quotaFile() {
  return path.join(tmpHome, '.collie-harness', 'state', 'quota.json');
}

function budgetFile() {
  return path.join(tmpHome, '.collie-harness', 'config', 'budget.json');
}

function runHook(payload = {}) {
  return spawnSync('node', [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: tmpHome,
    },
  });
}

test('pre-tool-quota-guard: rate_limit_cool_until in future → stdout contains decision:block', () => {
  const futureTime = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now
  fs.writeFileSync(quotaFile(), JSON.stringify({
    rate_limit_cool_until: futureTime,
    exhausted: false,
    daily_input_tokens: 0,
    daily_output_tokens: 0,
    daily_cache_read_tokens: 0,
    daily_reset_at: new Date(Date.now() + 86400000).toISOString(),
  }), 'utf8');

  const result = runHook({ tool_name: 'Write' });
  assert.strictEqual(result.status, 0, `Hook failed: ${result.stderr}`);

  const stdout = result.stdout.trim();
  assert.ok(stdout.length > 0, 'stdout should not be empty when rate limited');
  const out = JSON.parse(stdout);
  assert.strictEqual(out.decision, 'block', 'decision should be block when rate limited');
});

test('pre-tool-quota-guard: exhausted:true → stdout contains decision:block', () => {
  fs.writeFileSync(quotaFile(), JSON.stringify({
    exhausted: true,
    rate_limit_cool_until: null,
    daily_input_tokens: 1000000,
    daily_output_tokens: 0,
    daily_cache_read_tokens: 0,
    daily_reset_at: new Date(Date.now() + 86400000).toISOString(),
  }), 'utf8');
  fs.writeFileSync(budgetFile(), JSON.stringify({
    daily_token_cap: 1000000,
  }), 'utf8');

  const result = runHook({ tool_name: 'Write' });
  assert.strictEqual(result.status, 0, `Hook failed: ${result.stderr}`);

  const stdout = result.stdout.trim();
  assert.ok(stdout.length > 0, 'stdout should not be empty when exhausted');
  const out = JSON.parse(stdout);
  assert.strictEqual(out.decision, 'block', 'decision should be block when exhausted');
});

test('pre-tool-quota-guard: healthy quota with high cap → exits 0, no block', () => {
  fs.writeFileSync(quotaFile(), JSON.stringify({
    exhausted: false,
    rate_limit_cool_until: null,
    daily_input_tokens: 100,
    daily_output_tokens: 50,
    daily_cache_read_tokens: 0,
    daily_reset_at: new Date(Date.now() + 86400000).toISOString(),
  }), 'utf8');
  fs.writeFileSync(budgetFile(), JSON.stringify({
    daily_token_cap: 1000000,
  }), 'utf8');

  const result = runHook({ tool_name: 'Write' });
  assert.strictEqual(result.status, 0, `Hook failed: ${result.stderr}`);
  assert.strictEqual(result.stdout.trim(), '', 'stdout should be empty when quota is healthy');
});

test('pre-tool-quota-guard: missing quota.json → exits 0 (no protection, allow)', () => {
  // Do NOT write quota.json — it should not exist

  const result = runHook({ tool_name: 'Write' });
  assert.strictEqual(result.status, 0, `Hook failed: ${result.stderr}`);
  // Should exit 0 when no quota file exists (no protection)
  // stdout may be empty or have a warning — just check no block decision
  const stdout = result.stdout.trim();
  if (stdout.length > 0) {
    const out = JSON.parse(stdout);
    assert.notStrictEqual(out.decision, 'block', 'should not block when quota.json is missing');
  }
});
