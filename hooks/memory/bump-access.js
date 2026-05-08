#!/usr/bin/env node
/**
 * PostToolUse(Read) hook — bump last_accessed + access_count on memory files.
 *
 * Input  (stdin): JSON from Claude Code PostToolUse hook
 *   { tool_input: { file_path: "..." }, ... }
 * Output: nothing (side-effect only, never crashes)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

const MEMORY_ROOT = `${homedir()}/.collie/memory/`;

function today() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Parse frontmatter from file content.
 * Returns { meta: {key: value, ...}, body: string } or null if no valid frontmatter.
 */
function parseFrontmatter(content) {
  if (!content.startsWith('---')) return null;

  const secondDash = content.indexOf('\n---', 3);
  if (secondDash === -1) return null;

  const rawMeta = content.slice(3, secondDash).trim(); // between the two ---
  const body = content.slice(secondDash + 4); // everything after closing ---

  const meta = {};
  for (const line of rawMeta.split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key) meta[key] = value;
  }

  return { meta, body };
}

/**
 * Serialize meta + body back to a full file string.
 */
function serializeFrontmatter(meta, body) {
  const lines = Object.entries(meta).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join('\n')}\n---${body}`;
}

function run() {
  // Read hook JSON from stdin
  let raw;
  try {
    raw = readFileSync(0, 'utf8').trim();
  } catch {
    return; // no stdin → skip
  }

  if (!raw) return;

  let hook;
  try {
    hook = JSON.parse(raw);
  } catch {
    return; // malformed JSON → skip
  }

  // Extract file path (Claude Code passes tool_input.file_path for Read tool)
  const filePath = hook?.tool_input?.file_path;
  if (typeof filePath !== 'string' || !filePath) return;

  // Expand ~ and resolve absolute path
  let expanded = filePath.startsWith('~/')
    ? `${homedir()}/${filePath.slice(2)}`
    : filePath;
  expanded = path.resolve(expanded);

  // Only process files under ~/.collie/memory/
  if (!expanded.startsWith(MEMORY_ROOT)) return;

  // Read the file
  let content;
  try {
    content = readFileSync(expanded, 'utf8');
  } catch {
    return; // file gone or unreadable → skip
  }

  // Parse frontmatter
  const parsed = parseFrontmatter(content);
  if (!parsed) return; // no frontmatter → skip silently

  const { meta, body } = parsed;

  // Update fields
  meta['last_accessed'] = today();
  meta['access_count'] = String((parseInt(meta['access_count'] ?? '0', 10) || 0) + 1);
  if (meta['summary'] && meta['summary'].includes('[review]')) {
    meta['summary'] = meta['summary'].replace(' [review]', '').replace('[review] ', '').replace('[review]', '');
  }

  // Write back
  try {
    writeFileSync(expanded, serializeFrontmatter(meta, body), 'utf8');
  } catch {
    return; // write failed → skip silently
  }
}

run();
