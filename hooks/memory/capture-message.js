#!/usr/bin/env node
/**
 * capture-message.js — UserPromptSubmit hook script
 *
 * Appends user message to session log. Every 20 messages (by log line count),
 * outputs JSON asking the agent to invoke the memory skill.
 *
 * Input  (stdin): { "prompt": "<user message>", "cwd": "...", ... }
 * Output (stdout): "" (count % 20 != 0) or JSON hookSpecificOutput (count % 20 == 0)
 *
 * Files:
 *   ~/.collie/memory/sessions/<session-id>.jsonl  — session log (single source of truth)
 *
 * Performance target: < 10ms for typical runs (sync IO only, no network/LLM).
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const SESSIONS_DIR = join(homedir(), '.collie/memory', 'sessions');
const THRESHOLD = 20;

function ensureSessionsDir() {
  mkdirSync(SESSIONS_DIR, { recursive: true });
}

/**
 * Derive the session ID for this run.
 *
 * Strategy:
 *   1. Use CLAUDE_CODE_SESSION_ID env var if available.
 *   2. Look for an existing .jsonl file from today and reuse its name.
 *   3. Otherwise generate a new timestamp-based session ID.
 */
function resolveSessionId() {
  const envId = process.env.CLAUDE_CODE_SESSION_ID;
  if (envId) {
    return envId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  }

  const today = new Date().toISOString().slice(0, 10);
  try {
    const files = readdirSync(SESSIONS_DIR);
    const todayFile = files.find(f => f.startsWith(today) && f.endsWith('.jsonl'));
    if (todayFile) {
      return todayFile.slice(0, -6);
    }
  } catch {
    // Directory may not exist yet
  }

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_` +
         `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

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
 * Count lines in a file. Returns 0 if file doesn't exist.
 */
function countLines(filePath) {
  try {
    const content = readFileSync(filePath, 'utf8');
    if (!content) return 0;
    return content.split('\n').filter(line => line.length > 0).length;
  } catch {
    return 0;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

const raw = readFileSync(0, 'utf8');

let input;
try {
  input = JSON.parse(raw);
} catch {
  process.exit(0);
}

const message = (typeof input.prompt === 'string' ? input.prompt : '') ||
                (typeof input.message === 'string' ? input.message : '') ||
                (typeof input.content === 'string' ? input.content : '');
const cwd = typeof input.cwd === 'string' ? input.cwd : (process.env.CLAUDE_PROJECT_DIR || process.cwd());

ensureSessionsDir();

const sessionId = resolveSessionId();
const sessionPath = join(SESSIONS_DIR, `${sessionId}.jsonl`);
appendSessionLog(sessionPath, message, cwd);

const lineCount = countLines(sessionPath);

if (lineCount > 0 && lineCount % THRESHOLD === 0) {
  const output = {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: [
        `[memory] You have exchanged ${lineCount} messages this session.`,
        `Session log: ${sessionPath}`,
        'Please invoke the memory skill now and evaluate recent messages against the decision tree.',
      ].join(' '),
    },
  };
  process.stdout.write(JSON.stringify(output) + '\n');
}
