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

  // Detect which reviewer completed: plan-doc-reviewer (Agent) or collie:review (Skill)
  const REVIEWER = {
    'collie:plan-doc-reviewer':   { ownKey: 'plan_doc_reviewer', otherKey: 'collie_reviewer',   otherName: 'collie:review (Mode=plan)' },
    'collie:review': { ownKey: 'collie_reviewer',   otherKey: 'plan_doc_reviewer', otherName: 'collie:plan-doc-reviewer' },
  };
  let source = null;
  const toolInput = payload.tool_input || {};
  if (payload.tool_name === 'Agent') {
    if (toolInput.subagent_type === 'collie:plan-doc-reviewer') source = 'collie:plan-doc-reviewer';
  }
  if (payload.tool_name === 'Skill') {
    const skillName = toolInput.skill || toolInput.skill_name || '';
    if (/collie:review/.test(skillName)) source = 'collie:review';
  }
  if (!source) process.exit(0);

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

  // Check for approval based on source
  let approved = false;
  if (source === 'collie:plan-doc-reviewer') {
    approved = responseContent.includes('**Status:** Approved');
  } else if (source === 'collie:review') {
    approved = /##\s*Collie Reviewer[\s\S]*?\*\*Status:\*\*\s*PASS\b/.test(responseContent);
  }
  if (!approved) process.exit(0);

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

  const { ownKey, otherKey, otherName } = REVIEWER[source];
  const now = new Date().toISOString();
  const updated = Object.assign({}, existing);
  updated[ownKey] = { approved: true, approved_at: now };

  try {
    fs.writeFileSync(stateFile, JSON.stringify(updated, null, 2), 'utf8');
  } catch (_) {
    // best effort
  }

  const otherDone = updated[otherKey] && updated[otherKey].approved === true;

  const hint = otherDone
    ? `✅ [collie] both collie:plan-doc-reviewer AND collie:review approved — next step: you MUST call ExitPlanMode now.`
    : `✅ [collie] ${source} approved — still waiting on ${otherName}. Dispatch it now (in parallel is fine), then call ExitPlanMode.`;

  const out = { additionalContext: hint };
  process.stdout.write(JSON.stringify(out) + '\n');
  process.exit(0);
}

main().catch(() => process.exit(0));
