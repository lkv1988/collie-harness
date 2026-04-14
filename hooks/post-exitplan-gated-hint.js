'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

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

  const stateDir = path.join(os.homedir(), '.kevin-proxy', 'state', sessionId);
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, 'phase.json'),
      JSON.stringify({ phase: 'post-exit-plan', at: new Date().toISOString() })
    );
  } catch (_) {
    // best-effort
  }

  process.stdout.write(JSON.stringify({
    additionalContext: '✅ [kevin-proxy] ExitPlanMode 完成 — 下一步必须调用 gated-workflow skill（~/.claude/skills/gated-workflow/SKILL.md）。跳过 = 红线。'
  }));

  process.exit(0);
});
