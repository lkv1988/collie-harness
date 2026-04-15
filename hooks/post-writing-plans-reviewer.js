#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { stateDir } = require('./_state');

// --- Read stdin payload ---
let payload = {};
try {
  const raw = fs.readFileSync(0, 'utf8');
  payload = JSON.parse(raw);
} catch (e) {
  process.stderr.write('[collie-harness/post-writing-plans-reviewer] Failed to parse stdin: ' + e.message + '\n');
  process.exit(0);
}

const toolName = payload.tool_name || '';
const toolInput = payload.tool_input || {};
const sessionId = payload.session_id || 'unknown';

// --- Helpers ---
const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
if (!pluginRoot) {
  process.stderr.write('[collie-harness/post-writing-plans-reviewer] WARN: CLAUDE_PLUGIN_ROOT not set, skipping\n');
  process.exit(0);
}
const escalateScript = path.join(pluginRoot, 'scripts', 'escalate.sh');

const sessionStateDir = stateDir(sessionId);
const lastPlanFile = path.join(sessionStateDir, 'last-plan.json');

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
      fs.mkdirSync(sessionStateDir, { recursive: true });
      const state = {
        path: matched,
        written_at: new Date().toISOString(),
        plan_doc_reviewer: { approved: false, approved_at: null },
        collie_reviewer:   { approved: false, approved_at: null },
      };
      fs.writeFileSync(lastPlanFile, JSON.stringify(state, null, 2), 'utf8');
    }
    // If no match, exit silently
  } catch (e) {
    process.stderr.write('[collie-harness/post-writing-plans-reviewer] Error in Write/Edit handler: ' + e.message + '\n');
  }
  process.exit(0);
}

// --- Handler: ExitPlanMode ---
if (toolName === 'ExitPlanMode') {
  try {
    let needsWarn = true;
    let missing = [];

    try {
      const state = JSON.parse(fs.readFileSync(lastPlanFile, 'utf8'));
      const planDocOk = state.plan_doc_reviewer && state.plan_doc_reviewer.approved === true;
      const collieOk  = state.collie_reviewer  && state.collie_reviewer.approved === true;
      if (planDocOk && collieOk) {
        // Also verify plan metadata lines exist (plan-source + plan-topic)
        try {
          const planContent = fs.readFileSync(state.path, 'utf8');
          const lines = planContent.split('\n');
          const hasPlanSource = (lines[0] || '').startsWith('<!-- plan-source:');
          const hasPlanTopic  = (lines[1] || '').startsWith('<!-- plan-topic:');
          if (!hasPlanSource || !hasPlanTopic) {
            const metaMissing = [
              !hasPlanSource && 'plan-source',
              !hasPlanTopic  && 'plan-topic',
            ].filter(Boolean).join(' + ');
            missing.push(`plan metadata missing (${metaMissing}) — add both lines at the top of the plan file per auto.md Step 2`);
          } else {
            needsWarn = false;
          }
        } catch (e) {
          missing.push('plan file unreadable: ' + e.message);
        }
      } else {
        if (!planDocOk) missing.push('collie-harness:plan-doc-reviewer');
        if (!collieOk)  missing.push('collie-harness:review');
      }
    } catch (e) {
      if (e.code !== 'ENOENT') {
        process.stderr.write('[collie-harness/post-writing-plans-reviewer] Could not parse last-plan.json: ' + e.message + '\n');
      }
      missing = ['collie-harness:plan-doc-reviewer', 'collie-harness:review'];
    }

    if (needsWarn) {
      const missingList = missing.join(' + ');
      process.stderr.write(`[collie-harness] BLOCK: plan file not approved by ${missingList} before ExitPlanMode\n`);

      try {
        execFileSync(escalateScript, [
          'WARN',
          'plan-not-reviewed-before-exit-plan-mode',
          JSON.stringify({ session_id: sessionId, missing }),
        ], { stdio: ['ignore', 'ignore', 'inherit'] });
      } catch (e) {
        process.stderr.write('[collie-harness/post-writing-plans-reviewer] escalate.sh failed: ' + e.message + '\n');
      }

      const output = {
        decision: 'block',
        reason: `⚠️ [collie-harness] ExitPlanMode 被拦截：plan 尚未被 ${missingList} 批准。必须先并行调用 Agent(subagent_type='collie-harness:plan-doc-reviewer', model='opus') 和 Skill('collie-harness:review', Mode=plan)，双方都返回批准后才能 ExitPlanMode。`,
      };
      process.stdout.write(JSON.stringify(output) + '\n');
      process.exit(0);
    }
  } catch (e) {
    process.stderr.write('[collie-harness/post-writing-plans-reviewer] Error in ExitPlanMode handler: ' + e.message + '\n');
  }
  process.exit(0);
}

// All other tools: exit silently
process.exit(0);
