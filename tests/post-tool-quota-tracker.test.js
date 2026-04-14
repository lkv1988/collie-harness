'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOK = path.resolve(__dirname, '../hooks/post-tool-quota-tracker.js');
const ESCALATE_LOG = path.join(os.tmpdir(), 'escalate-calls-quota.log');

let tmpHome;
let tmpRoot;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-test-quota-'));
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-root-quota-'));

  fs.mkdirSync(path.join(tmpHome, '.kevin-proxy', 'state'), { recursive: true });
  fs.mkdirSync(path.join(tmpHome, '.kevin-proxy', 'config'), { recursive: true });

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

function quotaFile() {
  return path.join(tmpHome, '.kevin-proxy', 'state', 'quota.json');
}

function runHook(payload) {
  return spawnSync('node', [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: tmpHome,
      CLAUDE_PLUGIN_ROOT: tmpRoot,
      MOCK_SESSION_ID: 'test-session-123',
    },
  });
}

test('post-tool-quota-tracker: rate limit error → quota.json has rate_limited_at and rate_limit_cool_until, escalate called', () => {
  const payload = {
    tool_name: 'Bash',
    session_id: 'test-session-123',
    tool_error: 'rate limit exceeded, please try again later',
  };

  const result = runHook(payload);
  assert.strictEqual(result.status, 0, `Hook failed: ${result.stderr}`);

  assert.ok(fs.existsSync(quotaFile()), 'quota.json should be written');
  const quota = JSON.parse(fs.readFileSync(quotaFile(), 'utf8'));
  assert.ok(quota.rate_limited_at, 'rate_limited_at should be set');
  assert.ok(quota.rate_limit_cool_until, 'rate_limit_cool_until should be set');

  // cool_until should be in the future (1 hour from now)
  const coolUntil = new Date(quota.rate_limit_cool_until).getTime();
  assert.ok(coolUntil > Date.now(), 'rate_limit_cool_until should be in the future');

  // Escalate should have been called
  assert.ok(fs.existsSync(ESCALATE_LOG), 'escalate.sh should have been called');
  const log = fs.readFileSync(ESCALATE_LOG, 'utf8');
  assert.ok(log.includes('rate_limit_detected'), 'escalate should be called with rate_limit_detected');
});

test('post-tool-quota-tracker: usage tokens → quota.json daily_input_tokens incremented', () => {
  // Start with existing quota
  fs.writeFileSync(quotaFile(), JSON.stringify({
    daily_input_tokens: 500,
    daily_output_tokens: 100,
    daily_cache_read_tokens: 0,
    weekly_input_tokens: 1000,
    weekly_output_tokens: 200,
    exhausted: false,
    rate_limited_at: null,
    rate_limit_cool_until: null,
    daily_reset_at: new Date(Date.now() + 86400000).toISOString(),
    weekly_reset_at: new Date(Date.now() + 604800000).toISOString(),
    last_updated: null,
  }), 'utf8');

  const payload = {
    tool_name: 'Bash',
    session_id: 'test-session-123',
    usage: {
      input_tokens: 1000,
      output_tokens: 200,
    },
  };

  const result = runHook(payload);
  assert.strictEqual(result.status, 0, `Hook failed: ${result.stderr}`);

  const quota = JSON.parse(fs.readFileSync(quotaFile(), 'utf8'));
  assert.strictEqual(quota.daily_input_tokens, 1500, 'daily_input_tokens should be 500 + 1000 = 1500');
  assert.strictEqual(quota.daily_output_tokens, 300, 'daily_output_tokens should be 100 + 200 = 300');
});

test('post-tool-quota-tracker: no usage field → quota.json unchanged except last_updated, exits 0', () => {
  const initialQuota = {
    daily_input_tokens: 100,
    daily_output_tokens: 50,
    daily_cache_read_tokens: 0,
    weekly_input_tokens: 200,
    weekly_output_tokens: 100,
    exhausted: false,
    rate_limited_at: null,
    rate_limit_cool_until: null,
    daily_reset_at: new Date(Date.now() + 86400000).toISOString(),
    weekly_reset_at: new Date(Date.now() + 604800000).toISOString(),
    last_updated: null,
  };
  fs.writeFileSync(quotaFile(), JSON.stringify(initialQuota), 'utf8');

  const payload = {
    tool_name: 'Bash',
    session_id: 'test-session-123',
    // No usage field
  };

  const result = runHook(payload);
  assert.strictEqual(result.status, 0, `Hook failed: ${result.stderr}`);

  const quota = JSON.parse(fs.readFileSync(quotaFile(), 'utf8'));
  // Token counts should be unchanged
  assert.strictEqual(quota.daily_input_tokens, 100, 'daily_input_tokens should be unchanged');
  assert.strictEqual(quota.daily_output_tokens, 50, 'daily_output_tokens should be unchanged');
  // last_updated should be set
  assert.ok(quota.last_updated, 'last_updated should be set');
});
