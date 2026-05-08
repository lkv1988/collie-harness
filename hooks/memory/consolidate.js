#!/usr/bin/env node
/**
 * consolidate.js — Stop hook script for promotion and merging of memory files.
 *
 * Usage:
 *   node consolidate.js [--cwd <path>]
 *
 * Operates on both user/ and projects/<project>/ scopes:
 *
 * Promote (short/ → long/):
 *   - access_count >= 3 in frontmatter
 *   - AND created vs last_accessed differ by >= 1 day (cross-session heuristic)
 *   → move file from short/ to long/, add entry to INDEX.md
 *
 * Merge (within long/):
 *   - Compare summaries pairwise; if two share 50%+ of words → merge candidates
 *   → keep file with higher access_count, append the other's content, delete the
 *     other, remove its entry from INDEX.md
 *
 * Output: JSON to stdout  { "promoted": [...], "merged": [...] }
 *
 * ESM, zero dependencies.
 */

import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { resolveProject } from './resolve-project.js';

const PALACE_ROOT = path.join(homedir(), '.collie/memory');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        args[name] = next;
        i++;
      } else {
        args[name] = true;
      }
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Frontmatter helpers (reuse same pattern as load-index.js / bump-access.js)
// ---------------------------------------------------------------------------

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
    if (key) result[key] = value;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function daysBetween(dateA, dateB) {
  const a = new Date(dateA);
  const b = new Date(dateB);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
  return Math.abs(Math.floor((b - a) / (1000 * 60 * 60 * 24)));
}

// ---------------------------------------------------------------------------
// File system helpers
// ---------------------------------------------------------------------------

function listMdFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.md'));
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// INDEX.md helpers
// ---------------------------------------------------------------------------

function readIndex(indexPath) {
  if (!fs.existsSync(indexPath)) return '# Memory Index\n\n';
  return fs.readFileSync(indexPath, 'utf8');
}

/**
 * Add a line `- [<summary>](<filename>)` to INDEX.md.
 * Appends before any trailing blank lines to keep the file tidy.
 */
function indexAddEntry(indexPath, filename, summary) {
  let content = readIndex(indexPath);
  const entry = summary
    ? `- [${summary}](${filename})`
    : `- [${filename}](${filename})`;
  if (!content.endsWith('\n')) content += '\n';
  content += entry + '\n';
  fs.writeFileSync(indexPath, content, 'utf8');
}

/**
 * Remove the line referencing `filename` from INDEX.md.
 * Matches both `[...](filename)` and `[[filename]]` patterns.
 */
function indexRemoveEntry(indexPath, filename) {
  if (!fs.existsSync(indexPath)) return;
  const content = fs.readFileSync(indexPath, 'utf8');
  const nameNoExt = filename.replace(/\.md$/, '');
  const lines = content.split('\n').filter(line => {
    // markdown link: (filename.md) or (nameNoExt)
    if (line.includes(`(${filename})`)) return false;
    if (line.includes(`(${nameNoExt})`)) return false;
    // wikilink: [[filename]] or [[nameNoExt]]
    if (line.includes(`[[${filename}]]`)) return false;
    if (line.includes(`[[${nameNoExt}]]`)) return false;
    return true;
  });
  fs.writeFileSync(indexPath, lines.join('\n'), 'utf8');
}

// ---------------------------------------------------------------------------
// Similarity helper
// ---------------------------------------------------------------------------

/**
 * Word-level Jaccard similarity between two strings (case-insensitive).
 * Returns a value in [0, 1].
 */
function wordSimilarity(a, b) {
  if (!a || !b) return 0;
  const wordsOf = str =>
    new Set(
      str
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
    );
  const setA = wordsOf(a);
  const setB = wordsOf(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const w of setA) {
    if (setB.has(w)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return intersection / union;
}

// ---------------------------------------------------------------------------
// Promote: short/ → long/
// ---------------------------------------------------------------------------

/**
 * Process one scope (user or project).
 * Returns array of promoted filenames (relative to shortDir).
 */
function promoteScope(shortDir, longDir, indexPath) {
  ensureDir(longDir);
  const promoted = [];

  const files = listMdFiles(shortDir);
  for (const filename of files) {
    const srcPath = path.join(shortDir, filename);
    let content;
    try {
      content = fs.readFileSync(srcPath, 'utf8');
    } catch {
      continue;
    }

    const fm = parseFrontmatter(content);

    const accessCount = parseInt(fm.access_count ?? '0', 10) || 0;
    if (accessCount < 3) continue;

    const created = fm.created || '';
    const lastAccessed = fm.last_accessed || '';
    const ageDays = daysBetween(created, lastAccessed);
    if (ageDays < 1) continue;

    try {
      const finalDest = uniqueDest(longDir, filename);
      fs.renameSync(srcPath, finalDest);
      const finalFilename = path.basename(finalDest);
      indexAddEntry(indexPath, finalFilename, fm.summary || '');
      promoted.push(filename);
    } catch {
      // skip on any error — never crash
    }
  }

  return promoted;
}

function uniqueDest(dir, filename) {
  const candidate = path.join(dir, filename);
  if (!fs.existsSync(candidate)) return candidate;
  const ext = path.extname(filename);
  const base = filename.slice(0, filename.length - ext.length);
  for (let n = 2; ; n++) {
    const alt = path.join(dir, `${base}_${n}${ext}`);
    if (!fs.existsSync(alt)) return alt;
  }
}

// ---------------------------------------------------------------------------
// Merge: within long/
// ---------------------------------------------------------------------------

/**
 * Process one scope's long/ directory.
 * Returns array of { kept, deleted } merge records.
 */
function mergeScope(longDir, indexPath) {
  const merged = [];
  const files = listMdFiles(longDir);

  // Build metadata array
  const entries = [];
  for (const filename of files) {
    const filePath = path.join(longDir, filename);
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    const fm = parseFrontmatter(content);
    entries.push({
      filename,
      filePath,
      content,
      summary: fm.summary || '',
      accessCount: parseInt(fm.access_count ?? '0', 10) || 0,
    });
  }

  // Track which filenames have been deleted during this run
  const deleted = new Set();

  for (let i = 0; i < entries.length; i++) {
    if (deleted.has(entries[i].filename)) continue;

    for (let j = i + 1; j < entries.length; j++) {
      if (deleted.has(entries[j].filename)) continue;

      const sim = wordSimilarity(entries[i].summary, entries[j].summary);
      if (sim < 0.5) continue;

      // Merge candidates — keep higher access_count
      const [keep, drop] =
        entries[i].accessCount >= entries[j].accessCount
          ? [entries[i], entries[j]]
          : [entries[j], entries[i]];

      // Append dropped file's content to kept file
      const separator = `\n\n---\n<!-- merged from: ${drop.filename} -->\n\n`;
      const newContent = keep.content.trimEnd() + separator + drop.content;
      try {
        fs.writeFileSync(keep.filePath, newContent, 'utf8');
        fs.unlinkSync(drop.filePath);
        indexRemoveEntry(indexPath, drop.filename);
        deleted.add(drop.filename);
        merged.push({ kept: keep.filename, deleted: drop.filename });
      } catch {
        // skip — don't crash
      }
    }
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv);
  const cwd = args.cwd || process.cwd();
  const project = resolveProject(cwd);

  const scopes = [
    {
      shortDir: path.join(PALACE_ROOT, 'user', 'short'),
      longDir: path.join(PALACE_ROOT, 'user', 'long'),
      indexPath: path.join(PALACE_ROOT, 'user', 'INDEX.md'),
    },
    {
      shortDir: path.join(PALACE_ROOT, 'projects', project, 'short'),
      longDir: path.join(PALACE_ROOT, 'projects', project, 'long'),
      indexPath: path.join(PALACE_ROOT, 'projects', project, 'INDEX.md'),
    },
  ];

  const result = { promoted: [], merged: [] };

  for (const scope of scopes) {
    // Promote first so newly promoted files can also be merged
    const promotedFiles = promoteScope(scope.shortDir, scope.longDir, scope.indexPath);
    result.promoted.push(...promotedFiles);

    const mergedRecords = mergeScope(scope.longDir, scope.indexPath);
    result.merged.push(...mergedRecords);
  }

  process.stdout.write(JSON.stringify(result) + '\n');
}

main();
