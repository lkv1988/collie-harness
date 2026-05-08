#!/usr/bin/env node
/**
 * load-index.js — SessionStart hook script
 *
 * 1. Resolves the current project name via resolve-project.js
 * 2. Cleanup phase:
 *    a. short/: delete files where last_accessed > 7 days
 *    b. long/:  add [review] to summary if last_accessed > 60 days
 *    c. long/:  delete file if [review] in summary AND last_accessed > 90 days
 *    d. Sync INDEX.md with actual long/ directory
 * 3. Load phase: read user/INDEX.md + projects/<project>/INDEX.md, output to stdout
 *
 * ESM, zero dependencies.
 */

import fs from 'fs';
import path from 'path';
import { homedir } from 'node:os';
import { resolveProject } from './resolve-project.js';

const PALACE_ROOT = path.join(homedir(), '.collie/memory');
const SHORT_TTL_DAYS = 7;
const LONG_REVIEW_DAYS = 60;
const LONG_DELETE_DAYS = 90;

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function today() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function daysBetween(dateStr) {
  const then = new Date(dateStr);
  const now = new Date(today());
  if (isNaN(then.getTime())) return null;
  return Math.floor((now - then) / (1000 * 60 * 60 * 24));
}

// ---------------------------------------------------------------------------
// Frontmatter parsing (no YAML library — simple string parsing)
// ---------------------------------------------------------------------------

/**
 * Parse the first YAML frontmatter block from a markdown string.
 * Returns an object with string values for recognised keys.
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const block = match[1];
  const result = {};
  for (const line of block.split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    result[key] = value;
  }
  return result;
}

/**
 * Replace (or insert) a key-value pair inside an existing frontmatter block.
 * If the key is not present it is appended before the closing `---`.
 */
function updateFrontmatterField(content, key, newValue) {
  const fmMatch = content.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!fmMatch) return content;

  const [fullMatch, open, block, close] = fmMatch;
  const lines = block.split('\n');
  let found = false;
  const updated = lines.map(line => {
    const colon = line.indexOf(':');
    if (colon !== -1 && line.slice(0, colon).trim() === key) {
      found = true;
      return `${key}: ${newValue}`;
    }
    return line;
  });
  if (!found) updated.push(`${key}: ${newValue}`);
  const newFm = open + updated.join('\n') + close;
  return content.replace(fullMatch, newFm);
}

/**
 * Replace the `summary` value inside frontmatter.
 * Returns the modified content string.
 */
function setSummary(content, newSummary) {
  return updateFrontmatterField(content, 'summary', newSummary);
}

// ---------------------------------------------------------------------------
// File system helpers
// ---------------------------------------------------------------------------

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function listMdFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath).filter(f => f.endsWith('.md'));
}

// ---------------------------------------------------------------------------
// Cleanup helpers
// ---------------------------------------------------------------------------

/**
 * Cleanup short/ directory:
 *   - delete files where last_accessed is > SHORT_TTL_DAYS days ago
 */
function cleanShortDir(shortDir) {
  const files = listMdFiles(shortDir);
  for (const file of files) {
    const filePath = path.join(shortDir, file);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const fm = parseFrontmatter(content);
      if (!fm.last_accessed) continue;
      const age = daysBetween(fm.last_accessed);
      if (age !== null && age > SHORT_TTL_DAYS) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // skip unreadable files
    }
  }
}

/**
 * Cleanup long/ directory:
 *   - if last_accessed > LONG_REVIEW_DAYS: add [review] to summary if absent
 *   - if summary contains [review] AND last_accessed > LONG_DELETE_DAYS: delete
 */
function cleanLongDir(longDir) {
  const files = listMdFiles(longDir);
  for (const file of files) {
    const filePath = path.join(longDir, file);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const fm = parseFrontmatter(content);
      if (!fm.last_accessed) continue;

      const age = daysBetween(fm.last_accessed);
      if (age === null) continue;

      const summaryHasReview = (fm.summary || '').includes('[review]');

      // c. delete if [review] present AND age > LONG_DELETE_DAYS
      if (summaryHasReview && age > LONG_DELETE_DAYS) {
        fs.unlinkSync(filePath);
        continue;
      }

      // b. add [review] if age > LONG_REVIEW_DAYS and not already tagged
      if (age > LONG_REVIEW_DAYS && !summaryHasReview) {
        const currentSummary = fm.summary || '';
        const newSummary = currentSummary
          ? `${currentSummary} [review]`
          : '[review]';
        const updated = setSummary(content, newSummary);
        fs.writeFileSync(filePath, updated, 'utf8');
      }
    } catch {
      // skip unreadable files
    }
  }
}

// ---------------------------------------------------------------------------
// INDEX.md sync
// ---------------------------------------------------------------------------

/**
 * Parse INDEX.md entries — each non-blank, non-header line that references
 * a filename in the form `[[filename]]` or `- [[filename]]` or a bare
 * `filename.md` link.
 *
 * We track entries by the bare filename (no .md extension).
 *
 * Returns an array of { line: string, key: string } objects.
 */
function parseIndexEntries(indexContent) {
  const entries = [];
  for (const line of indexContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Match [[filename]] style wikilinks
    const wikiMatch = trimmed.match(/\[\[([^\]]+)\]\]/);
    if (wikiMatch) {
      entries.push({ line, key: wikiMatch[1].replace(/\.md$/, '') });
      continue;
    }

    // Match markdown links [text](filename.md) or bare .md references
    const mdMatch = trimmed.match(/\(([^)]+\.md)\)/);
    if (mdMatch) {
      entries.push({ line, key: mdMatch[1].replace(/\.md$/, '') });
      continue;
    }
  }
  return entries;
}

/**
 * Sync INDEX.md with the actual files in long/.
 *
 * - Add entries for files missing from INDEX.md
 * - Remove entries for files no longer present in long/
 *
 * Creates INDEX.md if it doesn't exist.
 */
function syncIndex(longDir, indexPath) {
  ensureDir(longDir);

  const existingFiles = new Set(
    listMdFiles(longDir).map(f => f.replace(/\.md$/, ''))
  );

  let indexContent = '';
  if (fs.existsSync(indexPath)) {
    indexContent = fs.readFileSync(indexPath, 'utf8');
  } else {
    indexContent = '# Memory Index\n\n';
  }

  const entries = parseIndexEntries(indexContent);
  const indexedKeys = new Set(entries.map(e => e.key));

  let changed = false;

  // Remove stale entries (file deleted from long/)
  const staleKeys = [...indexedKeys].filter(k => !existingFiles.has(k));
  if (staleKeys.length > 0) {
    changed = true;
    const staleSet = new Set(staleKeys);
    const lines = indexContent.split('\n').filter(line => {
      const wikiMatch = line.match(/\[\[([^\]]+)\]\]/);
      if (wikiMatch) {
        const key = wikiMatch[1].replace(/\.md$/, '');
        return !staleSet.has(key);
      }
      const mdMatch = line.match(/\(([^)]+\.md)\)/);
      if (mdMatch) {
        const key = mdMatch[1].replace(/\.md$/, '');
        return !staleSet.has(key);
      }
      return true;
    });
    indexContent = lines.join('\n');
  }

  // Add missing entries (file exists in long/ but not in INDEX.md)
  const missingKeys = [...existingFiles].filter(k => !indexedKeys.has(k));
  if (missingKeys.length > 0) {
    changed = true;
    // Ensure trailing newline before appending
    if (!indexContent.endsWith('\n')) indexContent += '\n';
    for (const key of missingKeys.sort()) {
      // Read the file to extract its summary for a richer INDEX entry
      const filePath = path.join(longDir, `${key}.md`);
      let summary = '';
      try {
        const fc = fs.readFileSync(filePath, 'utf8');
        const fm = parseFrontmatter(fc);
        summary = fm.summary || '';
      } catch {
        // ignore
      }
      const entry = summary
        ? `- [[${key}]] — ${summary}`
        : `- [[${key}]]`;
      indexContent += entry + '\n';
    }
  }

  if (changed || !fs.existsSync(indexPath)) {
    fs.writeFileSync(indexPath, indexContent, 'utf8');
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function runCleanup(scope) {
  const { shortDir, longDir, indexPath } = scope;

  ensureDir(shortDir);
  ensureDir(longDir);

  cleanShortDir(shortDir);
  cleanLongDir(longDir);
  syncIndex(longDir, indexPath);
}

function readIndexSafe(indexPath) {
  if (!fs.existsSync(indexPath)) return null;
  const content = fs.readFileSync(indexPath, 'utf8').trim();
  return content || null;
}

function main() {
  const cwd = process.cwd();
  const project = resolveProject(cwd);

  // Paths
  const userScope = {
    shortDir: path.join(PALACE_ROOT, 'user', 'short'),
    longDir: path.join(PALACE_ROOT, 'user', 'long'),
    indexPath: path.join(PALACE_ROOT, 'user', 'INDEX.md'),
    label: 'user',
  };

  const projectScope = {
    shortDir: path.join(PALACE_ROOT, 'projects', project, 'short'),
    longDir: path.join(PALACE_ROOT, 'projects', project, 'long'),
    indexPath: path.join(PALACE_ROOT, 'projects', project, 'INDEX.md'),
    label: `project:${project}`,
  };

  // Ensure root exists
  ensureDir(PALACE_ROOT);
  ensureDir(path.join(PALACE_ROOT, 'user'));
  ensureDir(path.join(PALACE_ROOT, 'projects', project));
  ensureDir(path.join(PALACE_ROOT, 'sessions'));

  // Phase 1: Cleanup
  runCleanup(userScope);
  runCleanup(projectScope);

  // Phase 2: Load — read INDEX.md files and output to stdout
  const userIndex = readIndexSafe(userScope.indexPath);
  const projectIndex = readIndexSafe(projectScope.indexPath);

  const parts = [];

  if (userIndex) {
    parts.push(`## User Memory Index\n\n${userIndex}`);
  }

  if (projectIndex) {
    parts.push(`## Project Memory Index (${project})\n\n${projectIndex}`);
  }

  if (parts.length > 0) {
    console.log(parts.join('\n\n---\n\n'));
  }
  // If both are empty/missing, output nothing — no-op for agent context injection
}

main();
