#!/usr/bin/env node
/**
 * search-memory.js
 * Search for similar memories across user/project memory directories.
 *
 * Usage:
 *   node search-memory.js --scope <user|project|both> --query "<keywords>" [--cwd <path>]
 *
 * Output: JSON array of matches sorted by score desc, limited to top 5.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { resolveProject } from './resolve-project.js';

const BASE = join(homedir(), '.memory-palace');

/**
 * Parse CLI args into a plain object.
 */
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      args[key] = value;
    }
  }
  return args;
}

/**
 * Extract the `summary` field from YAML-style frontmatter.
 * Returns empty string if none found.
 */
function extractSummary(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return '';
  const frontmatter = match[1];
  const summaryMatch = frontmatter.match(/^summary\s*:\s*(.+)$/m);
  return summaryMatch ? summaryMatch[1].trim() : '';
}

/**
 * Read all .md files in a directory (non-recursively).
 * Returns [] if directory doesn't exist.
 */
function readMdFiles(dir) {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter(f => f.endsWith('.md'))
      .map(f => join(dir, f));
  } catch {
    return [];
  }
}

/**
 * Score a file against query keywords.
 * score = number of distinct keywords found (case-insensitive) in summary+content.
 */
function scoreFile(filePath, keywords) {
  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  const summary = extractSummary(content);
  const haystack = (summary + '\n' + content).toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (haystack.includes(kw.toLowerCase())) score++;
  }
  if (score === 0) return null;
  return { path: filePath, summary, score };
}

/**
 * Collect directories to search based on scope.
 */
function resolveDirs(scope, cwd) {
  const userDirs = [
    join(BASE, 'user', 'short'),
    join(BASE, 'user', 'long'),
  ];
  const project = resolveProject(cwd);
  const projectDirs = [
    join(BASE, 'projects', project, 'short'),
    join(BASE, 'projects', project, 'long'),
  ];
  if (scope === 'user') return userDirs;
  if (scope === 'project') return projectDirs;
  return [...userDirs, ...projectDirs];
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const scope = args.scope || 'both';
  const query = typeof args.query === 'string' ? args.query : '';
  const cwd = typeof args.cwd === 'string' ? args.cwd : undefined;

  if (!['user', 'project', 'both'].includes(scope)) {
    process.stderr.write(`Invalid --scope "${scope}". Must be user, project, or both.\n`);
    process.exit(1);
  }

  if (!query) {
    process.stdout.write('[]\n');
    return;
  }

  const keywords = query.trim().split(/\s+/).filter(Boolean);
  if (keywords.length === 0) {
    process.stdout.write('[]\n');
    return;
  }

  const dirs = resolveDirs(scope, cwd);
  const files = dirs.flatMap(dir => readMdFiles(dir));

  const matches = files
    .map(f => scoreFile(f, keywords))
    .filter(Boolean);

  matches.sort((a, b) => b.score - a.score);
  const top5 = matches.slice(0, 5);

  process.stdout.write(JSON.stringify(top5, null, 2) + '\n');
}

main();
