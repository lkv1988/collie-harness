# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

**kevin-proxy** is a Claude Code plugin that automates the full "Kevin-style" feature development workflow: brainstorm → plan → plan review → gated implementation → rubric review. It enforces workflow integrity via hooks, quota safety, loop detection, and a rubric-based final review agent.

## Development Commands

```bash
# Run all unit tests (Node.js built-in runner, no install needed)
node --test tests/*.test.js

# Run a single test file
node --test tests/pre-tool-quota-guard.test.js

# Run E2E smoke tests (4 scenarios)
./tests/e2e/smoke.sh

# Install as a development plugin (Claude Code v2.1+ auto-discovers)
ln -s ~/git/kevin-proxy ~/.claude/plugins/installed/kevin-proxy

# Verify plugin is loaded inside Claude Code
/plugin list   # Should show kevin-proxy@0.1.0
```

No build step — pure Node.js, zero external dependencies.

## Architecture: 4 Layers

| Layer | What it does |
|-------|-------------|
| **0** | `acceptEdits` mode + escalation channel (`scripts/escalate.sh`) |
| **1** | 3 chain-link hooks that bridge workflow gaps Claude Code doesn't close natively |
| **2** | Rubric review gate (`agents/kevin-rubric-reviewer.md`): 12 red-lines + 10 questions + ELEPHANT anti-sycophancy |
| **3** | Self-driven harness (`commands/kevin-auto.md` + `skills/kevin-queue/`) with CronCreate task queue |

## Workflow Sequence (enforced by hooks)

```
/kevin-auto "task"
  → superpowers:brainstorming
  → superpowers:writing-plans   ← post-writing-plans-reviewer.js marks plan pending
  → plan-doc-reviewer           ← post-approved-exitplan-hint.js hints ExitPlanMode
  → ExitPlanMode                ← post-exitplan-gated-hint.js reminds gated-workflow
  → gated-workflow skill
  → kevin-rubric-reviewer (Opus)
  → PASS → <promise>Kevin: SHIP IT</promise>
     WARN/BLOCK → fix loop
```

## Hooks and Their Triggers

| Hook file | Event | Purpose |
|-----------|-------|---------|
| `notification-escalate.js` | Notification | Routes to `escalate.sh` |
| `pre-tool-quota-guard.js` | PreToolUse (all) | Blocks if rate-limited or budget >70% |
| `post-tool-quota-tracker.js` | PostToolUse (all) | Accumulates token usage, detects rate-limit errors |
| `post-writing-plans-reviewer.js` | PostToolUse Write/Edit + ExitPlanMode | Flags plan for review; warns if ExitPlanMode called without approval |
| `post-approved-exitplan-hint.js` | PostToolUse Agent | Detects `plan-doc-reviewer` Approved; hints to call ExitPlanMode |
| `post-exitplan-gated-hint.js` | PostToolUse ExitPlanMode | Reminds to call `gated-workflow` skill |
| `stop-steps-counter.js` | Stop | Escalates on same error ×3 or 5+ steps without file changes |

## State Files (runtime, not committed)

All runtime state lives under `~/.kevin-proxy/`:

```
~/.kevin-proxy/
  config/budget.json           # Token quota limits (daily/weekly caps)
  state/quota.json             # Live token usage + rate-limit timestamps
  state/{sessionId}/
    last-plan.json             # Plan review status per session
    counter.json               # Step count + error hash tracking
  state/scheduled_tasks.lock   # Concurrency lock for kevin-queue
  escalations.log              # All escalation events
  queue/*.md                   # Unattended tasks for kevin-queue skill
```

## Key Design Constraints

- **Rubric red-lines** (BLOCK): 12 hard violations in `agents/kevin-rubric-reviewer.md`. Any single red-line = automatic BLOCK.
- **Quota guard** blocks at 70% of `daily_token_cap` (reserves 30% buffer). Rate-limit cool-down = 1 hour.
- **Loop trap**: 3 identical error hashes in a row → WARN escalation; 5 steps without file changes → WARN escalation.
- **Task queue** (`kevin-queue`) runs at `concurrency=1` — never two kevin sessions simultaneously.
- **ELEPHANT check** in rubric reviewer: 8-point sycophancy self-check; must answer all 8 before issuing PASS.

## Required First-Time Setup

```bash
# 1. Set acceptEdits mode in ~/.claude/settings.json
#    "permissions": { "defaultMode": "acceptEdits" }

# 2. Create budget config
mkdir -p ~/.kevin-proxy/config
cat > ~/.kevin-proxy/config/budget.json << 'EOF'
{ "daily_token_cap": 1000000, "weekly_token_cap": 5000000, "confirm_before_autoloop": true }
EOF

# 3. (Optional) Custom escalation handler
export KEVIN_ESCALATE_CMD="your-notification-command"
```
