'use strict';

const fs = require('fs');
const path = require('path');
const { stateDir } = require('./_state');
async function main() {
  // Read full stdin
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();

  if (!raw) {
    process.exit(0);
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (_) {
    process.exit(0);
  }

  // Only handle Agent tool
  if (payload.tool_name !== 'Agent') {
    process.exit(0);
  }

  // Only handle plan-doc-reviewer subagent
  const toolInput = payload.tool_input || {};
  if (toolInput.subagent_type !== 'plan-doc-reviewer') {
    process.exit(0);
  }

  // Extract response content — may be string or object
  let responseContent = '';
  const toolResponse = payload.tool_response;
  if (typeof toolResponse === 'string') {
    responseContent = toolResponse;
  } else if (toolResponse && typeof toolResponse === 'object') {
    if (typeof toolResponse.content === 'string') {
      responseContent = toolResponse.content;
    } else if (Array.isArray(toolResponse.content)) {
      // Handle content array (e.g. [{type: "text", text: "..."}])
      responseContent = toolResponse.content
        .map(block => (block && typeof block.text === 'string' ? block.text : ''))
        .join('\n');
    } else if (typeof toolResponse.output === 'string') {
      responseContent = toolResponse.output;
    } else {
      responseContent = JSON.stringify(toolResponse);
    }
  }

  // Check for Approved status
  if (!responseContent.includes('**Status:** Approved')) {
    process.exit(0);
  }

  // Approved — update state file
  const sessionId = payload.session_id || 'unknown';
  const sessionStateDir = stateDir(sessionId);

  try {
    fs.mkdirSync(sessionStateDir, { recursive: true });
  } catch (_) {
    // best effort
  }

  const stateFile = path.join(sessionStateDir, 'last-plan.json');
  let existing = {};
  try {
    existing = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch (_) {
    // file doesn't exist or is invalid — start fresh
  }

  const updated = Object.assign({}, existing, {
    reviewed: true,
    approved: true,
    approved_at: new Date().toISOString(),
  });

  try {
    fs.writeFileSync(stateFile, JSON.stringify(updated, null, 2), 'utf8');
  } catch (_) {
    // best effort
  }

  // Inject hint to call ExitPlanMode
  const out = {
    additionalContext:
      '✅ [collie-harness] plan-doc-reviewer Approved — next step: you MUST call ExitPlanMode now. Do not skip this step.',
  };
  process.stdout.write(JSON.stringify(out) + '\n');
  process.exit(0);
}

main().catch(() => process.exit(0));
