#!/usr/bin/env node
/**
 * write-memory.js — write a memory file into the memory palace
 *
 * Usage:
 *   node write-memory.js --type <type> --scope <user|project> \
 *     --summary "<summary>" --content "<content>" [--cwd <path>]
 *
 * Valid types: feedback, user, project, reference
 */

import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { resolveProject } from './resolve-project.js';

const VALID_TYPES = ['feedback', 'user', 'project', 'reference'];

// ---------- CLI arg parsing ----------

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    if (key.startsWith('--')) {
      const name = key.slice(2);
      const val = argv[i + 1];
      if (val !== undefined && !val.startsWith('--')) {
        args[name] = val;
        i++;
      } else {
        args[name] = true;
      }
    }
  }
  return args;
}

// ---------- Validation ----------

function validate(args) {
  const errors = [];
  if (!args.type) errors.push('--type is required');
  else if (!VALID_TYPES.includes(args.type))
    errors.push(`--type must be one of: ${VALID_TYPES.join(', ')}`);
  if (!args.scope) errors.push('--scope is required');
  else if (!['user', 'project'].includes(args.scope))
    errors.push('--scope must be "user" or "project"');
  if (!args.summary) errors.push('--summary is required');
  if (!args.content) errors.push('--content is required');
  return errors;
}

// ---------- Target directory resolution ----------

function targetDir(scope, cwd) {
  const base = join(homedir(), '.memory-palace');
  if (scope === 'user') {
    return join(base, 'user', 'short');
  }
  // scope === 'project'
  const project = resolveProject(cwd || process.cwd());
  return join(base, 'projects', project, 'short');
}

// ---------- Filename generation ----------

/**
 * Extract first meaningful keyword from summary:
 * - lowercase, strip non-alphanumeric, max 20 chars
 */
function extractKeyword(summary) {
  const stopWords = new Set([
    'a', 'an', 'the', 'is', 'in', 'on', 'at', 'to', 'for',
    'of', 'and', 'or', 'but', 'with', 'this', 'that',
  ]);
  const words = summary
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean);
  const keyword = words.find(w => !stopWords.has(w)) || words[0] || 'memory';
  return keyword.slice(0, 20);
}

function today() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Returns a unique file path inside dir.
 * Base: YYYY-MM-DD_<keyword>.md
 * If taken: YYYY-MM-DD_<keyword>_2.md, _3.md, …
 */
async function uniqueFilePath(dir, keyword) {
  const date = today();
  const base = `${date}_${keyword}`;
  let candidate = join(dir, `${base}.md`);
  if (!(await fileExists(candidate))) return candidate;
  for (let n = 2; ; n++) {
    candidate = join(dir, `${base}_${n}.md`);
    if (!(await fileExists(candidate))) return candidate;
  }
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// ---------- Frontmatter building ----------

function buildFrontmatter(type, summary) {
  const date = today();
  return [
    '---',
    `type: ${type}`,
    `summary: ${summary}`,
    `created: ${date}`,
    `last_accessed: ${date}`,
    `access_count: 1`,
    '---',
  ].join('\n');
}

// ---------- Main ----------

async function main() {
  const args = parseArgs(process.argv);

  const errors = validate(args);
  if (errors.length) {
    for (const e of errors) process.stderr.write(`Error: ${e}\n`);
    process.exit(1);
  }

  const { type, scope, summary, content } = args;
  const cwd = args.cwd || undefined;

  const dir = targetDir(scope, cwd);

  await mkdir(dir, { recursive: true });

  const keyword = extractKeyword(summary);
  const filePath = await uniqueFilePath(dir, keyword);

  const fileContent = `${buildFrontmatter(type, summary)}\n${content}\n`;

  await writeFile(filePath, fileContent, 'utf8');

  process.stdout.write(filePath + '\n');
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
