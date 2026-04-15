# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

**collie-harness** is a Claude Code plugin that automates the full "Collie-style" feature development workflow: brainstorm → plan → plan review → gated implementation → rubric review. It enforces workflow integrity via hooks, quota safety, loop detection, and a rubric-based final review agent.

## Development Commands

```bash
# Run all unit tests (Node.js built-in runner, no install needed)
node --test tests/*.test.js

# Run a single test file
node --test tests/pre-tool-quota-guard.test.js

# Run E2E smoke tests (4 scenarios)
./tests/e2e/smoke.sh

# Install as a development plugin (Claude Code v2.1+ auto-discovers)
ln -s ~/git/collie-harness ~/.claude/plugins/installed/collie-harness

# Verify plugin is loaded inside Claude Code
/plugin list   # Should show collie-harness@0.1.0
```

No build step — pure Node.js, zero external dependencies.

## Architecture: 4 Layers

| Layer | What it does |
|-------|-------------|
| **0** | `acceptEdits` mode + escalation channel (`scripts/escalate.sh`) |
| **1** | Chain-link hooks enforcing dual-reviewer handshake (plan-doc-reviewer + collie-reviewer) before ExitPlanMode |
| **2** | `skills/collie-reviewer/` — single source of truth for Collie's 12 red-lines + 10 questions + Reflexion + ELEPHANT. `agents/collie-rubric-reviewer.md` is a thin shell delegating to this skill. |
| **3** | Self-driven harness (`commands/collie-auto.md` + `skills/collie-queue/`) with CronCreate task queue |

## Workflow Sequence (enforced by hooks)

```
/collie-auto "task"
  → superpowers:brainstorming
  → superpowers:writing-plans   ← post-writing-plans-reviewer.js marks plan pending (both reviewers)
  → PARALLEL:
      plan-doc-reviewer (structural)   ← post-approved-exitplan-hint.js marks plan_doc_reviewer.approved
      collie-reviewer (Collie rubric)  ← post-approved-exitplan-hint.js marks collie_reviewer.approved
  → (only when BOTH approved)
  → ExitPlanMode                ← post-exitplan-gated-hint.js reminds gated-workflow
  → gated-workflow skill
  → collie-rubric-reviewer (thin shell → collie-reviewer skill, code mode)
  → PASS → <promise>Collie: SHIP IT</promise>
     WARN/BLOCK → fix loop
```

## Hooks and Their Triggers

| Hook file | Event | Purpose |
|-----------|-------|---------|
| `notification-escalate.js` | Notification | Routes to `escalate.sh` |
| `pre-tool-quota-guard.js` | PreToolUse (all) | Blocks if rate-limited or budget >70% |
| `post-tool-quota-tracker.js` | PostToolUse (all) | Accumulates token usage, detects rate-limit errors |
| `post-writing-plans-reviewer.js` | PostToolUse Write/Edit + ExitPlanMode | Creates dual-reviewer state; **hard-blocks** (`decision:'block'`) ExitPlanMode if called before BOTH reviewers approve |
| `post-approved-exitplan-hint.js` | PostToolUse Agent + PostToolUse Skill | Detects plan-doc-reviewer Approved OR collie-reviewer PASS; updates per-reviewer state; hints next step |
| `post-exitplan-gated-hint.js` | PostToolUse ExitPlanMode | Reminds to call `gated-workflow` skill — **only when both reviewers approved**; silent otherwise |
| `stop-steps-counter.js` | Stop | Blocks on same error ×3 or 5+ steps without file changes; **resets counters after block** to prevent permanent lockout |

## State Files (runtime, not committed)

All runtime state lives under `~/.collie-harness/`:

```
~/.collie-harness/
  config/budget.json           # Token quota limits (daily/weekly caps)
  state/quota.json             # Live token usage + rate-limit timestamps
  state/{sessionId}/
    last-plan.json             # Plan review status per session
    counter.json               # Step count + error hash tracking
  state/scheduled_tasks.lock   # Concurrency lock for collie-queue
  escalations.log              # All escalation events
  queue/*.md                   # Unattended tasks for collie-queue skill
```

## Key Design Constraints

- **Rubric red-lines** (BLOCK): 12 hard violations in `skills/collie-reviewer/references/rubric-red-lines.md` (single source of truth). Any single red-line = automatic BLOCK.
- **Dual reviewer at plan stage**: `plan-doc-reviewer` (structural) AND `collie-reviewer` (Collie rubric) must both approve before ExitPlanMode. Enforced by `post-writing-plans-reviewer.js` + `post-approved-exitplan-hint.js`.
- **Quota guard** blocks at 70% of `daily_token_cap` (reserves 30% buffer). Rate-limit cool-down = 1 hour.
- **Loop trap**: 3 identical error hashes in a row → WARN escalation; 5 steps without file changes → WARN escalation.
- **Task queue** (`collie-queue`) runs at `concurrency=1` — never two collie sessions simultaneously.
- **ELEPHANT check** in rubric reviewer: 8-point sycophancy self-check; must answer all 8 before issuing PASS.

## Required First-Time Setup

```bash
# 1. Set acceptEdits mode in ~/.claude/settings.json
#    "permissions": { "defaultMode": "acceptEdits" }

# 2. Create budget config
mkdir -p ~/.collie-harness/config
cat > ~/.collie-harness/config/budget.json << 'EOF'
{ "daily_token_cap": 1000000, "weekly_token_cap": 5000000, "confirm_before_autoloop": true }
EOF

# 3. (Optional) Custom escalation handler
export COLLIE_ESCALATE_CMD="your-notification-command"

# 3b. (Optional) Override state directory location
export COLLIE_HARNESS_HOME="~/.my-harness"  # defaults to ~/.collie-harness
```
