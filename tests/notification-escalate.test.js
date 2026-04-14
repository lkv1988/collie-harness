'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOK = path.resolve(__dirname, '../hooks/notification-escalate.js');
const ESCALATE_LOG = path.join(os.tmpdir(), 'escalate-calls-notification.log');

let tmpRoot;

function setupMockPlugin() {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kh-test-notif-'));
  const scriptsDir = path.join(tmpRoot, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  const escalateSh = path.join(scriptsDir, 'escalate.sh');
  fs.writeFileSync(escalateSh, `#!/bin/bash\necho "$@" >> "${ESCALATE_LOG}"\nexit 0\n`, 'utf8');
  fs.chmodSync(escalateSh, 0o755);
  return tmpRoot;
}

function cleanup() {
  if (tmpRoot) {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    tmpRoot = null;
  }
  if (fs.existsSync(ESCALATE_LOG)) {
    fs.unlinkSync(ESCALATE_LOG);
  }
}

before(() => {
  setupMockPlugin();
});

after(() => {
  cleanup();
});

test('notification-escalate: valid Notification payload calls escalate.sh and exits 0', () => {
  if (fs.existsSync(ESCALATE_LOG)) fs.unlinkSync(ESCALATE_LOG);

  const payload = {
    hook_event_name: 'Notification',
    session_id: 'test-session-123',
    message: 'Build completed',
    title: 'CI',
  };

  const result = spawnSync('node', [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: tmpRoot,
      HOME: tmpRoot,
      MOCK_SESSION_ID: 'test-session-123',
    },
  });

  assert.strictEqual(result.status, 0, `Hook exited with non-zero: ${result.stderr}`);
  assert.ok(fs.existsSync(ESCALATE_LOG), 'escalate.sh should have been called, log file missing');
  const log = fs.readFileSync(ESCALATE_LOG, 'utf8');
  assert.ok(log.includes('INFO'), 'escalate.sh should have been called with INFO level');
  assert.ok(log.includes('Build completed'), 'escalate.sh log should contain message');
});

test('notification-escalate: invalid JSON stdin exits 0 without crashing', () => {
  if (fs.existsSync(ESCALATE_LOG)) fs.unlinkSync(ESCALATE_LOG);

  const result = spawnSync('node', [HOOK], {
    input: 'not valid json {{{{',
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: tmpRoot,
      HOME: tmpRoot,
    },
  });

  // Should not crash — exits 0
  assert.strictEqual(result.status, 0, `Hook crashed on invalid JSON: ${result.stderr}`);
});
