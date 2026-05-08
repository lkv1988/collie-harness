#!/usr/bin/env node
/**
 * capture-message.js — UserPromptSubmit hook script
 *
 * Reads user message from stdin (Claude Code UserPromptSubmit hook JSON),
 * appends it to a session log, increments a counter, and when the counter
 * reaches 20 outputs a JSON additionalContext asking the agent to invoke
 * the memory skill.
 *
 * Input  (stdin): { "prompt": "<user message>", "cwd": "...", ... }
 * Output (stdout): "" (count < 20) or JSON additionalContext (count ≥ 20)
 *
 * Files:
 *   ~/.collie/memory/sessions/<session-id>.jsonl  — session log (JSONL)
 *   ~/.collie/memory/sessions/.counter            — persisted message counter
 *
 * Performance target: < 10ms for typical runs (sync IO only, no network/LLM).
 */

import { readFileSync, writeFileSync, mkdirSync, openSync, readSync, ftruncateSync, writeSync, closeSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const SESSIONS_DIR = join(homedir(), '.collie/memory', 'sessions');
const COUNTER_FILE = join(SESSIONS_DIR, '.counter');
const THRESHOLD = 20;

/**
 * Ensure the sessions directory exists.
 */
function ensureSessionsDir() {
  mkdirSync(SESSIONS_DIR, { recursive: true });
}

/**
 * Derive the session ID for this run.
 *
 * Strategy:
 *   1. Use CLAUDE_CODE_SESSION_ID env var if available (stable across messages
 *      in the same session).
 *   2. If no env var, look for an existing .jsonl file from today (YYYY-MM-DD
 *      prefix) and reuse its name.
 *   3. Otherwise generate a new timestamp-based session ID.
 *
 * @returns {string} session ID like "2026-05-07_14-32-00"
 */
function resolveSessionId() {
  // Prefer env var — provides a stable cross-message session identity
  const envId = process.env.CLAUDE_CODE_SESSION_ID;
  if (envId) {
    // Sanitise to filesystem-safe characters; keep UUID chars + hyphens
    return envId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  }

  // Fall back to date-based reuse: look for today's session file
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  try {
    const files = readdirSync(SESSIONS_DIR);
    const todayFile = files.find(f => f.startsWith(today) && f.endsWith('.jsonl'));
    if (todayFile) {
      return todayFile.slice(0, -6); // strip ".jsonl"
    }
  } catch {
    // Directory may not exist yet — that's fine
  }

  // Generate a new timestamp-based session ID
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_` +
         `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

/**
 * Append a JSON line to the session log file.
 *
 * @param {string} sessionPath  Full path to the .jsonl file
 * @param {string} message      User message text
 * @param {string} cwd          Working directory from hook input
 */
function appendSessionLog(sessionPath, message, cwd) {
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    role: 'user',
    message,
    cwd,
  }) + '\n';
  writeFileSync(sessionPath, entry, { flag: 'a', encoding: 'utf8' });
}

/**
 * Read and increment the persisted counter.
 * Uses low-level fd operations to reduce (but not eliminate) the race window
 * when multiple hook processes run concurrently.
 *
 * @returns {{ newCount: number }} the updated count after increment
 */
function incrementCounter() {
  let count = 1;
  let fd;
  try {
    fd = openSync(COUNTER_FILE, 'a+');
    const buf = Buffer.alloc(32);
    const bytesRead = readSync(fd, buf, 0, 32, 0);
    if (bytesRead > 0) {
      const parsed = parseInt(buf.toString('utf8', 0, bytesRead).trim(), 10);
      count = Number.isFinite(parsed) && parsed > 0 && parsed < 1_000_000
        ? parsed + 1
        : 1;
    }
    ftruncateSync(fd, 0);
    writeSync(fd, String(count), 0);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return { newCount: count };
}

/**
 * Reset the counter to 0.
 */
function resetCounter() {
  writeFileSync(COUNTER_FILE, '0', { encoding: 'utf8' });
}

// ── Main ─────────────────────────────────────────────────────────────────────

const raw = readFileSync(0, 'utf8');

let input;
try {
  input = JSON.parse(raw);
} catch {
  // Unparseable input — silently pass through with no output
  process.exit(0);
}

// Extract fields from the UserPromptSubmit hook JSON
// Claude Code passes { prompt, cwd, ... }; be defensive about field names.
const message = (typeof input.prompt === 'string' ? input.prompt : '') ||
                (typeof input.message === 'string' ? input.message : '') ||
                (typeof input.content === 'string' ? input.content : '');
const cwd = typeof input.cwd === 'string' ? input.cwd : (process.env.CLAUDE_PROJECT_DIR || process.cwd());

// Ensure ~/.collie/memory/sessions/ exists
ensureSessionsDir();

// Resolve session and append to log
const sessionId = resolveSessionId();
const sessionPath = join(SESSIONS_DIR, `${sessionId}.jsonl`);
appendSessionLog(sessionPath, message, cwd);

// Increment counter and check threshold
const { newCount } = incrementCounter();

if (newCount >= THRESHOLD) {
  resetCounter();
  // Output additionalContext to ask the agent to run the memory skill
  const output = {
    additionalContext: [
      `[memory] You have exchanged ${newCount} messages this session.`,
      `Session log: ${sessionPath}`,
      'Please invoke the memory skill now and evaluate recent messages against the decision tree.',
    ].join(' '),
  };
  process.stdout.write(JSON.stringify(output) + '\n');
}
// count < THRESHOLD: output nothing (empty stdout)
