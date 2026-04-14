'use strict';

const fs = require('fs');
const path = require('path');
const { stateDir } = require('./_state');

let payload = {};
try {
  payload = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch (_) {
  process.exit(0);
}

const sessionId = payload.session_id || 'unknown';
const sessionStateDir = stateDir(sessionId);

// Write phase.json — always, regardless of approval state (breadcrumb for downstream)
try {
  fs.mkdirSync(sessionStateDir, { recursive: true });
  fs.writeFileSync(
    path.join(sessionStateDir, 'phase.json'),
    JSON.stringify({ phase: 'post-exit-plan', at: new Date().toISOString() })
  );
} catch (_) {}

// Only emit proceed hint if plan was fully approved.
// If not, post-writing-plans-reviewer.js has already emitted a BLOCK —
// emitting a proceed hint here would send the model contradictory signals.
let bothApproved = false;
try {
  const state = JSON.parse(fs.readFileSync(path.join(sessionStateDir, 'last-plan.json'), 'utf8'));
  const planDocOk = state.plan_doc_reviewer && state.plan_doc_reviewer.approved === true;
  const collieOk  = state.collie_reviewer  && state.collie_reviewer.approved === true;
  bothApproved = planDocOk && collieOk;
} catch (e) {
  if (e.code !== 'ENOENT') {
    process.stderr.write('[collie-harness/post-exitplan-gated-hint] Could not parse last-plan.json: ' + e.message + '\n');
  }
  // last-plan.json missing or unreadable → treat as not approved, stay silent
}

if (bothApproved) {
  process.stdout.write(JSON.stringify({
    additionalContext: '✅ [collie-harness] ExitPlanMode done — next step: must call gated-workflow skill (~/.claude/skills/gated-workflow/SKILL.md). Skipping = red-line violation.',
  }));
}

process.exit(0);
