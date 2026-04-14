#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

// --- Read stdin payload ---
let payload = {};
try {
  const raw = fs.readFileSync(0, 'utf8');
  payload = JSON.parse(raw);
} catch (e) {
  process.stderr.write('[kevin-proxy/stop-steps-counter] Failed to parse stdin: ' + e.message + '\n');
  process.exit(0);
}

const sessionId = payload.session_id || 'unknown';
const transcriptPath = payload.transcript_path || '';

// --- Paths ---
const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
if (!pluginRoot) {
  process.stderr.write('[kevin-proxy/stop-steps-counter] WARN: CLAUDE_PLUGIN_ROOT not set, skipping\n');
  process.exit(0);
}
const escalateScript = path.join(pluginRoot, 'scripts', 'escalate.sh');

const stateDir = path.join(os.homedir(), '.kevin-proxy', 'state', sessionId);
const counterFile = path.join(stateDir, 'counter.json');

// --- Simple hash: sum of char codes ---
function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h + str.charCodeAt(i)) & 0xffffffff;
  }
  return h.toString(16);
}

// --- Load or create counter state ---
function loadState() {
  try {
    if (fs.existsSync(counterFile)) {
      return JSON.parse(fs.readFileSync(counterFile, 'utf8'));
    }
  } catch (e) {
    process.stderr.write('[kevin-proxy/stop-steps-counter] Could not read counter.json: ' + e.message + '\n');
  }
  return {
    last_tool_errors: [],
    same_error_count: 0,
    no_progress_steps: 0,
    last_file_change_at: null,
    total_steps: 0,
  };
}

// --- Save counter state ---
function saveState(state) {
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(counterFile, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {
    process.stderr.write('[kevin-proxy/stop-steps-counter] Could not write counter.json: ' + e.message + '\n');
  }
}

// --- Parse transcript JSONL, return last N lines as parsed objects ---
function parseTranscriptTail(filePath, n) {
  const results = [];
  try {
    if (!filePath || !fs.existsSync(filePath)) return results;
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim().length > 0);
    const tail = lines.slice(-n);
    for (const line of tail) {
      try {
        results.push(JSON.parse(line));
      } catch (_) {
        // skip malformed lines
      }
    }
  } catch (e) {
    process.stderr.write('[kevin-proxy/stop-steps-counter] Transcript parse error: ' + e.message + '\n');
  }
  return results;
}

// --- Determine if a transcript entry is a tool result ---
// Returns: { isToolResult, toolName, isError, errorText, isFileChange }
function classifyEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return { isToolResult: false };
  }

  // Format A: { type: "tool_result", is_error: true/false, content: [...] }
  if (entry.type === 'tool_result') {
    const isError = entry.is_error === true;
    let errorText = '';
    if (isError) {
      const content = entry.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c && c.type === 'text' && c.text) {
            errorText = c.text.slice(0, 100);
            break;
          }
        }
      } else if (typeof content === 'string') {
        errorText = content.slice(0, 100);
      }
    }
    // tool_result doesn't carry tool name directly — mark as unknown
    return { isToolResult: true, toolName: null, isError, errorText, isFileChange: false };
  }

  // Format B: { role: "tool", name: "Write"|"Edit"|..., content: "..." }
  if (entry.role === 'tool' && entry.name) {
    const toolName = entry.name;
    const content = typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content || '');
    // Detect errors by content patterns
    const errorPatterns = ['Error:', 'ENOENT:', 'Cannot ', 'cannot ', 'failed:', 'Failed:'];
    const isError = errorPatterns.some(p => content.includes(p));
    const errorText = isError ? content.slice(0, 100) : '';
    const isFileChange = !isError && (toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit');
    return { isToolResult: true, toolName, isError, errorText, isFileChange };
  }

  // Format C: assistant message with tool_use blocks — skip (not a result)
  return { isToolResult: false };
}

// --- Main logic ---
const state = loadState();
const entries = parseTranscriptTail(transcriptPath, 20);

// Analyse recent tool results
const recentToolResults = [];
for (const entry of entries) {
  const cls = classifyEntry(entry);
  if (cls.isToolResult) {
    recentToolResults.push(cls);
  }
}

// Determine error hashes and file-change presence in last 5 tool results
const last5 = recentToolResults.slice(-5);

let foundFileChange = false;
const recentErrorHashes = [];

for (const r of last5) {
  if (r.isFileChange) {
    foundFileChange = true;
  }
}

// Collect error hashes from entire recent results (last 5) for same-error check
const last5Errors = last5.filter(r => r.isError && r.errorText);
for (const r of last5Errors) {
  recentErrorHashes.push(simpleHash(r.errorText));
}

// Update no_progress_steps
if (foundFileChange) {
  state.no_progress_steps = 0;
  state.last_file_change_at = new Date().toISOString();
} else if (last5.length > 0) {
  // Only increment if we actually saw tool activity in last 5
  state.no_progress_steps += 1;
}

// Update same_error tracking
// Append new error hashes to last_tool_errors (keep last 5 total)
for (const h of recentErrorHashes) {
  state.last_tool_errors.push(h);
}
if (state.last_tool_errors.length > 5) {
  state.last_tool_errors = state.last_tool_errors.slice(-5);
}

// Check if last 3 error hashes are identical (and non-empty)
const last3Errors = state.last_tool_errors.slice(-3);
if (last3Errors.length === 3 && last3Errors[0] === last3Errors[1] && last3Errors[1] === last3Errors[2]) {
  state.same_error_count += 1;
} else {
  state.same_error_count = 0;
}

state.total_steps += 1;
saveState(state);

// --- Escalation checks ---
function callEscalate(level, msg, context) {
  try {
    execFileSync(escalateScript, [level, msg, JSON.stringify(context)], { stdio: 'inherit' });
  } catch (e) {
    process.stderr.write('[kevin-proxy/stop-steps-counter] escalate.sh failed: ' + e.message + '\n');
  }
}

if (state.same_error_count >= 3) {
  callEscalate('WARN', 'loop_on_same_error', { same_error_count: state.same_error_count, session_id: sessionId });
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: '⚠️ 检测到同一错误连续出现3次，请检查根因后再继续',
  }) + '\n');
  process.exit(0);
}

if (state.no_progress_steps >= 5) {
  callEscalate('WARN', 'no_progress', { no_progress_steps: state.no_progress_steps, session_id: sessionId });
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: '⚠️ 连续5步没有文件变更，请检查是否卡住',
  }) + '\n');
  process.exit(0);
}

// No trigger — approve stop normally
process.exit(0);
