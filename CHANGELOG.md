# Changelog

All notable changes to collie-harness are documented here.

---

## [0.1.0] — 2026-04-15

Initial public release.

### Architecture

Four-layer design enforcing the full Collie-style development workflow:

| Layer | What it does |
|-------|-------------|
| **0** | `acceptEdits` mode + escalation channel (`scripts/escalate.sh`) |
| **1** | Hook chain enforcing dual-reviewer handshake (`collie-harness:plan-doc-reviewer` + `collie-harness:review`) before ExitPlanMode |
| **2** | `skills/review/` — single source of truth for Collie's 12 red-lines + 10 questions + Reflexion + ELEPHANT. `agents/reviewer.md` delegates here. |
| **3** | Self-driven harness (`/auto` command via ralph-loop + CronCreate task queue) |

### Public Surface

| Entry point | Type | Purpose |
|-------------|------|---------|
| `/auto` | slash command | Full Collie workflow loop (brainstorm → plan → review → implement → rubric) |
| `/queue` | slash command | Scan `~/.collie-harness/queue/*.md` and schedule pending tasks |
| `collie-harness:review` | Skill | Collie rubric reviewer (12 red-lines + ELEPHANT check) |
| `collie-harness:queue` | Skill | CronCreate-based task queue engine |
| `collie-harness:gated-workflow` | Skill | Post-planmode implementation pipeline with quality gates |
| `collie-harness:reviewer` | Agent | Thin shell delegating to `collie-harness:review` skill (code mode) |
| `collie-harness:plan-doc-reviewer` | Agent | Structural plan document reviewer |

### Tests

- 37 unit tests (Node.js built-in test runner, zero external dependencies)
- E2E smoke tests (4 scenarios)

### Prerequisites

- [superpowers](https://github.com/superpowers-ai/superpowers) plugin
- [ralph-loop](https://github.com/ralph-loop/ralph-loop) plugin
