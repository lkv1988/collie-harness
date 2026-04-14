#!/usr/bin/env node
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

let payload = {};
try {
  const raw = fs.readFileSync(0, 'utf8');
  payload = JSON.parse(raw);
} catch (e) {
  process.stderr.write('[kevin-proxy/notification-escalate] Failed to parse stdin: ' + e.message + '\n');
}

const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.join(require('os').homedir(), '.claude', 'plugins', 'installed', 'kevin-proxy');
const escalate = path.join(pluginRoot, 'scripts', 'escalate.sh');

const level = 'INFO';
const msg = payload.message || payload.title || 'claude-notification';
const context = JSON.stringify({
  session_id: payload.session_id,
  hook_event_name: payload.hook_event_name,
  message: payload.message
});

try {
  execFileSync(escalate, [level, msg, context], { stdio: 'inherit' });
} catch (e) {
  process.stderr.write('[kevin-proxy/notification-escalate] escalate.sh failed: ' + e.message + '\n');
}

process.exit(0);
