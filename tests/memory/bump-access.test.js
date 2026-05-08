import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '../../hooks/memory/bump-access.js');

/**
 * Spawn bump-access.js with a fake HOME so MEMORY_ROOT is isolated.
 * Returns the child process result (throws on non-zero exit).
 */
function runScript(hookJson, fakeHome) {
  return execFileSync(process.execPath, [SCRIPT], {
    input: JSON.stringify(hookJson),
    env: { ...process.env, HOME: fakeHome },
    encoding: 'utf8',
  });
}

/**
 * Create a temp dir and a fake ~/.collie/memory/ inside it.
 * Returns { fakeHome, memoryRoot }.
 */
function createFakeHome() {
  const fakeHome = mkdtempSync(path.join(tmpdir(), 'mp-test-'));
  const memoryRoot = path.join(fakeHome, '.collie/memory');
  mkdirSync(memoryRoot, { recursive: true });
  return { fakeHome, memoryRoot };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Test 1: Path hit — bump access_count and last_accessed
// ---------------------------------------------------------------------------
test('path hit: bumps access_count and last_accessed', () => {
  const { fakeHome, memoryRoot } = createFakeHome();
  const filePath = path.join(memoryRoot, 'test-note.md');

  writeFileSync(filePath, [
    '---',
    'title: Test Note',
    'access_count: 1',
    'last_accessed: 2026-01-01',
    '---',
    '',
    'Body content here.',
  ].join('\n'), 'utf8');

  runScript({ tool_input: { file_path: filePath } }, fakeHome);

  const content = readFileSync(filePath, 'utf8');

  assert.ok(content.includes(`access_count: 2`), 'access_count should be 2');
  assert.ok(content.includes(`last_accessed: ${today()}`), `last_accessed should be ${today()}`);
});

// ---------------------------------------------------------------------------
// Test 2: Path miss — file outside ~/.collie/memory/ is not touched
// ---------------------------------------------------------------------------
test('path miss: file outside memory-palace is not modified', () => {
  const { fakeHome } = createFakeHome();

  // Create a file outside .collie/memory/
  const outsideDir = mkdtempSync(path.join(tmpdir(), 'mp-outside-'));
  const filePath = path.join(outsideDir, 'other-note.md');
  const original = [
    '---',
    'access_count: 5',
    'last_accessed: 2026-01-01',
    '---',
    'body',
  ].join('\n');

  writeFileSync(filePath, original, 'utf8');

  runScript({ tool_input: { file_path: filePath } }, fakeHome);

  const content = readFileSync(filePath, 'utf8');
  assert.equal(content, original, 'file outside memory-palace should be unchanged');
});

// ---------------------------------------------------------------------------
// Test 3: Missing frontmatter — script must not crash
// ---------------------------------------------------------------------------
test('missing frontmatter: script does not crash', () => {
  const { fakeHome, memoryRoot } = createFakeHome();
  const filePath = path.join(memoryRoot, 'no-frontmatter.md');

  writeFileSync(filePath, 'Just plain content, no frontmatter at all.\n', 'utf8');

  // Should complete without throwing
  assert.doesNotThrow(() => runScript({ tool_input: { file_path: filePath } }, fakeHome));
});

// ---------------------------------------------------------------------------
// Test 4: [review] tag removal — stripped from summary after bump
// ---------------------------------------------------------------------------
test('[review] tag removal: removed from summary field', () => {
  const { fakeHome, memoryRoot } = createFakeHome();
  const filePath = path.join(memoryRoot, 'review-note.md');

  writeFileSync(filePath, [
    '---',
    'title: Review Note',
    'summary: Some important note [review]',
    'access_count: 0',
    'last_accessed: 2026-01-01',
    '---',
    '',
    'Body text.',
  ].join('\n'), 'utf8');

  runScript({ tool_input: { file_path: filePath } }, fakeHome);

  const content = readFileSync(filePath, 'utf8');
  assert.ok(!content.includes('[review]'), 'summary should not contain [review] after bump');
  assert.ok(content.includes('summary: Some important note'), 'summary text should be preserved without [review]');
});

// ---------------------------------------------------------------------------
// Test 5: Content preservation — body after frontmatter is unchanged
// ---------------------------------------------------------------------------
test('content preservation: body text is unchanged after bump', () => {
  const { fakeHome, memoryRoot } = createFakeHome();
  const filePath = path.join(memoryRoot, 'body-check.md');

  const bodyText = '\n\n# Heading\n\nParagraph one.\n\nParagraph two with **bold**.\n';
  const frontmatter = '---\ntitle: Body Check\naccess_count: 3\nlast_accessed: 2026-03-15\n---';

  writeFileSync(filePath, frontmatter + bodyText, 'utf8');

  runScript({ tool_input: { file_path: filePath } }, fakeHome);

  const content = readFileSync(filePath, 'utf8');

  // Extract body: everything after the closing ---
  const closingDash = content.indexOf('\n---', 3);
  const body = content.slice(closingDash + 4);

  assert.equal(body, bodyText, 'body content should be identical after bump');
});
