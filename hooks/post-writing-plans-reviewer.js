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
  process.stderr.write('[kevin-proxy/post-writing-plans-reviewer] Failed to parse stdin: ' + e.message + '\n');
  process.exit(0);
}

const toolName = payload.tool_name || '';
const toolInput = payload.tool_input || {};
const sessionId = payload.session_id || 'unknown';

// --- Helpers ---
const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
if (!pluginRoot) {
  process.stderr.write('[kevin-proxy/post-writing-plans-reviewer] WARN: CLAUDE_PLUGIN_ROOT not set, skipping\n');
  process.exit(0);
}
const escalateScript = path.join(pluginRoot, 'scripts', 'escalate.sh');

const stateDir = path.join(os.homedir(), '.kevin-proxy', 'state', sessionId);
const lastPlanFile = path.join(stateDir, 'last-plan.json');

/**
 * Returns true if the given file path matches any plan file pattern.
 */
function isPlanFile(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  // Ends in -plan.md
  if (/-plan\.md$/.test(filePath)) return true;
  // Inside a plans/ directory
  if (/plans\/.*\.md$/.test(filePath)) return true;
  return false;
}

/**
 * Extract candidate file paths from a Write/Edit/MultiEdit tool_input.
 */
function extractFilePaths(input) {
  const paths = [];
  // Write and Edit: top-level file_path
  if (input.file_path) paths.push(input.file_path);
  // MultiEdit: array of edits, each may have file_path
  if (Array.isArray(input.edits)) {
    for (const edit of input.edits) {
      if (edit && edit.file_path) paths.push(edit.file_path);
    }
  }
  return paths;
}

// --- Handler: Write / Edit / MultiEdit ---
if (toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit') {
  try {
    const filePaths = extractFilePaths(toolInput);
    const matched = filePaths.find(isPlanFile);

    if (matched) {
      fs.mkdirSync(stateDir, { recursive: true });
      const state = {
        path: matched,
        reviewed: false,
        approved: false,
        written_at: new Date().toISOString(),
      };
      fs.writeFileSync(lastPlanFile, JSON.stringify(state, null, 2), 'utf8');
    }
    // If no match, exit silently
  } catch (e) {
    process.stderr.write('[kevin-proxy/post-writing-plans-reviewer] Error in Write/Edit handler: ' + e.message + '\n');
  }
  process.exit(0);
}

// --- Handler: ExitPlanMode ---
if (toolName === 'ExitPlanMode') {
  try {
    let needsWarn = true;

    if (fs.existsSync(lastPlanFile)) {
      try {
        const state = JSON.parse(fs.readFileSync(lastPlanFile, 'utf8'));
        if (state.reviewed === true) {
          needsWarn = false;
        }
      } catch (e) {
        process.stderr.write('[kevin-proxy/post-writing-plans-reviewer] Could not parse last-plan.json: ' + e.message + '\n');
      }
    }

    if (needsWarn) {
      process.stderr.write('[kevin-proxy] WARN: plan file not reviewed by plan-doc-reviewer before ExitPlanMode\n');

      // Call escalate.sh (best-effort)
      try {
        execFileSync(escalateScript, [
          'WARN',
          'plan-not-reviewed-before-exit-plan-mode',
          JSON.stringify({ session_id: sessionId }),
        ], { stdio: 'inherit' });
      } catch (e) {
        process.stderr.write('[kevin-proxy/post-writing-plans-reviewer] escalate.sh failed: ' + e.message + '\n');
      }

      // Soft WARN: inject additionalContext (not a block)
      const output = {
        additionalContext: '⚠️ [kevin-proxy] plan file has NOT been reviewed by plan-doc-reviewer! You MUST run Agent(subagent_type=\'plan-doc-reviewer\', model=\'opus\') first, wait for Approved, then call ExitPlanMode. Calling ExitPlanMode without approval is a workflow violation.',
      };
      process.stdout.write(JSON.stringify(output) + '\n');
    }
  } catch (e) {
    process.stderr.write('[kevin-proxy/post-writing-plans-reviewer] Error in ExitPlanMode handler: ' + e.message + '\n');
  }
  process.exit(0);
}

// All other tools: exit silently
process.exit(0);
