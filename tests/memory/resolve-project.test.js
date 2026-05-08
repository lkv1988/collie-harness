import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProject } from '../../hooks/memory/resolve-project.js';

test('normal path', () => {
  assert.equal(resolveProject('/Users/kevin/git/notes/obsidian'), '-Users-kevin-git-notes-obsidian');
});

test('path with spaces', () => {
  assert.equal(resolveProject('/tmp/my project'), '-tmp-my project');
});

test('root path', () => {
  assert.equal(resolveProject('/'), '-');
});

test('trailing slash', () => {
  assert.equal(resolveProject('/Users/kevin/git/x/'), '-Users-kevin-git-x');
});

test('no argument uses process.cwd()', () => {
  const result = resolveProject();
  assert.ok(result.startsWith('-'), `expected result to start with '-', got: ${result}`);
});
