'use strict';

const fs = require('fs');
const path = require('path');
const { stateDir } = require('./_state');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  let sessionId = 'unknown';
  try {
    const payload = JSON.parse(input);
    sessionId = payload.session_id || 'unknown';
  } catch (_) {
    // ignore parse errors
  }

  const sessionStateDir = stateDir(sessionId);
  try {
    fs.mkdirSync(sessionStateDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionStateDir, 'phase.json'),
      JSON.stringify({ phase: 'post-exit-plan', at: new Date().toISOString() })
    );
  } catch (_) {
    // best-effort
  }

  process.stdout.write(JSON.stringify({
    additionalContext: '✅ [kevin-harness] ExitPlanMode done — next step: must call gated-workflow skill (~/.claude/skills/gated-workflow/SKILL.md). Skipping = red-line violation.'
  }));

  process.exit(0);
});
