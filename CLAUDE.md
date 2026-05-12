# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

**collie** is a Claude Code plugin that automates the full "Collie-style" feature development workflow: brainstorm → plan → plan review → gated implementation → rubric review. It enforces workflow integrity via hooks, quota safety, loop detection, and a rubric-based final review agent.

## Development Commands

```bash
# Run all unit tests (Node.js built-in runner, no install needed)
node --test tests/*.test.js

# Run a single test file
node --test tests/stop-steps-counter.test.js

# Run E2E smoke tests (4 scenarios)
./tests/e2e/smoke.sh

# Load as a development plugin (session-only)
claude --plugin-dir ~/git/collie

# Verify plugin is loaded inside Claude Code
/plugin list
```

No build step — pure Node.js, zero external dependencies.

## Architecture: 4 Layers

| Layer | What it does |
|-------|-------------|
| **0** | `acceptEdits` mode + escalation channel (`scripts/escalate.sh`) |
| **1** | Chain-link hooks enforcing dual-reviewer handshake (collie:plan-doc-reviewer + collie:review) before ExitPlanMode |
| **2** | `skills/review/` — single source of truth for Collie's 13 red-lines + 6 questions + Reflexion + ELEPHANT. Called directly at both plan stage (parallel with `plan-doc-reviewer`) and code stage (flow [collie-final-review] Step 5.7). |
| **3** | Self-driven harness (`commands/auto.md` + `commands/autoiter.md`) |

## Workflow Sequence (enforced by hooks)

```
/collie:auto "task"
  → ⓪ Research & Reuse         ← internal specs first, then web search / registry / docs + deferred scan
  → superpowers:brainstorming
  → superpowers:writing-plans   ← post-writing-plans-reviewer.js marks plan pending (both reviewers)
  → PARALLEL:
      collie:plan-doc-reviewer (structural) ← post-approved-exitplan-hint.js marks plan_doc_reviewer.approved
      collie:review (Collie rubric) ← post-approved-exitplan-hint.js marks collie_reviewer.approved
  → (only when BOTH approved)
  → ExitPlanMode                ← post-exitplan-gated-hint.js reminds flow
  → collie:flow skill（内含 [collie-final-review] pre-merge gate） → <promise>Collie: SHIP IT</promise>
```

## Autoiter Workflow（`/collie:autoiter`，与 Workflow Sequence 平行独立，不嵌套）

```
/collie:autoiter "task"
  → Stage 0: Discovery + Lock（planmode；plan-kind: autoiter-stage0 旁路双 reviewer 门禁）
  → Stage 0.5: autoiter-prepare 体检（trigger dry-run / scalar extract / observability）
  → 迭代 1..N:
      Stage 1: kickoff（git HEAD + baseline）
      Stage 2: Run trigger（subprocess background + Monitor/tail 观察）
      Stage 3: Observe（ISSUE 收集 + auto-recovery 阶梯）
      Stage 4a: Triage（opus, reverse suspicion）
      Stage 4b: Deep Verify（opus, adversarial, per-issue）
      Stage 5.0: Consolidated fix plan → fix-plan.md
      Stage 5.1: collie:flow（完整 TDD→review→simplify→regression→[collie-final-review]）
      Stage 5.2: G6 diff audit（inline）
      Stage 5.3: Rerun + scalar
      Stage 6: Rollback + 停止判断
  → <promise>Collie: AUTOITER DONE</promise>（worktree 保留，不自动 merge）
```

## Hooks and Their Triggers

| Hook file | Event | Purpose |
|-----------|-------|---------|
| `post-writing-plans-reviewer.js` | PostToolUse Write/Edit + ExitPlanMode | Creates dual-reviewer state; validates plan metadata (plan-source + plan-topic + plan-executor); **hard-blocks** (`decision:'block'`) ExitPlanMode if metadata missing or BOTH reviewers haven't approved |
| `post-writing-plans-reviewer.js` | `plan-kind: autoiter-stage0` 旁路 | 跳过 auto 双 reviewer 门禁，只校验 3 条 metadata + 4 enum 字段；`plan-kind` 为其他值时走既有路径 |
| `post-approved-exitplan-hint.js` | PostToolUse Agent + PostToolUse Skill | Detects collie:plan-doc-reviewer Approved OR collie:review PASS; updates per-reviewer state; hints next step |
| `post-exitplan-gated-hint.js` | PostToolUse ExitPlanMode | Reminds to call `collie:flow` skill — **only when both reviewers approved**; silent otherwise |
| `stop-steps-counter.js` | Stop | Blocks on same error ×3 or 5+ steps without file changes; **resets counters after block** to prevent permanent lockout |
| `memory/load-index.js` | SessionStart | Cleanup stale memories, sync INDEX, load user/project memory index into context |
| `memory/capture-message.js` | UserPromptSubmit | Append message to session log; every 20 lines → invoke memory skill |
| `memory/bump-access.js` | PostToolUse(Read) | Bump `last_accessed` + `access_count` on `~/.collie/memory/` files |
| `memory/pre-compact.sh` | PreCompact | Prompt agent to run decision tree before context compaction |
| `memory/session-stop.sh` | Stop | Prompt agent to run decision tree + consolidation; background consolidate.js as safety net |

## State Files (runtime, not committed)

All runtime state lives under `~/.collie/`:

```
~/.collie/
  state/{sessionId}/
    last-plan.json             # Plan review status per session
    counter.json               # Step count + error hash tracking
  escalations.log              # All escalation events
  autoiter/{project-id}/current-run     # runId 指针（project-scoped，EnterPlanMode 前写入）
  autoiter/{project-id}/{runId}/
    run-spec.md / prepare-report.md / state.json
    status.md（overwrite）/ user-log.md（append）/ progress.md
    worktree-path / iter-N/
```

## Key Design Constraints

- **Rubric red-lines** (BLOCK): 13 hard violations in `skills/review/references/rubric-red-lines.md` (single source of truth). Any single red-line = automatic BLOCK.
- **Dual reviewer at plan stage**: `collie:plan-doc-reviewer` (structural) AND `collie:review` (Collie rubric) must both approve before ExitPlanMode. Enforced by `post-writing-plans-reviewer.js` + `post-approved-exitplan-hint.js`.
- **Loop trap**: 3 identical error hashes in a row → WARN escalation; 5 steps without file changes → WARN escalation.
- **ELEPHANT check** in rubric reviewer: 8-point sycophancy self-check; must answer all 8 before issuing PASS.
- **Doc maintenance enforcement**：任何 plan 若改动用户可见行为 / 架构约束 / 已有文档内容，必须包含显式的文档更新任务（README / CLAUDE.md / docs/*-spec.md / `.claude/skills/*/SKILL.md`（若改动涉及项目级 SOP/操作清单））。由 `collie:plan-doc-reviewer` 的 Doc Maintenance 检查 + `collie:review` 的 Red line #12（文档同步检查）强制。`flow` Step 5.5 作为安全网。
- **E2E enforcement**：brainstorming 阶段必须完成 E2E Assessment（探测基建 + 可行性结论）；flow TodoList 根据 Assessment 结论创建条件性 `[e2e-setup]` / `[e2e-verify]` 任务；Step 1 建 list 后 haiku subagent 交叉核对 plan-todo 对齐；`collie:review` Q5 + `plan-doc-reviewer` E2E Assessment 行共同强制。
- **Impact Assessment 强制**：所有 plan 必须包含 Impact Assessment 章节（Directly affected + Downstream consumers + Reverse impact）。由 `collie:plan-doc-reviewer` 的 Impact Assessment 检查强制。豁免：单文件 < 20 行 trivial 改动。
- **Pre-merge rubric gate**：`collie:review` Mode=code 作为 `[collie-final-review]` 节点嵌入 `flow` TodoList 中 `[doc-refresh]` 之后、`[finish]` 之前（Step 5.7）。worktree 清理前必须通过 rubric gate，auto.md 无独立 Step ⑥。
- **Surgical scope red line**：Red line #13（Speculative scope）吸收 Karpathy CLAUDE.md Principle 2/3。加任务未要求的 feature / flexibility / 抽象 / 顺手改无关代码 = BLOCK；每行 diff 必须可追溯到任务目标。
- **Overfit Guards (G1-G8)**：硬性约束防过拟合；G8 = Triage（confidence≤2 → DEFERRED）+ Deep Verify（fix_confidence≤2 → DEFERRED）双层 confidence gate
- **ralph-loop 复用**：`/autoiter` 使用 ralph-loop 作为外层循环驱动（与 `/auto` 一致），不新建 Stop hook
- **Autoiter vs. /auto sentinel 语义**：`Collie: AUTOITER DONE` = 迭代结束 + worktree 保留（不自动 merge）；`Collie: SHIP IT` = merge 完成
- **嵌套禁止**：`/autoiter` 与 `/auto` 不得互相嵌套调用（COLLIE_AUTOITER_ACTIVE 环境变量防守）
- **Stage 3 auto-recovery 硬原则**：blocker 处理不等用户介入；能自愈则自愈（haiku→sonnet→opus 阶梯），不能则体面退场 + escalate
- **Plan size advisory**：plan-doc-reviewer 对超过 500 行的 plan 发 WARN（非 BLOCK）。建议拆分为 Phase 1 + deferred 文件。用户坚持时可继续。
- **Deferred scope lifecycle**：`docs/plans/<topic>-deferred.md` 存放被 defer 的 scope。格式：`<!-- deferred-from/topic/date -->` metadata + Origin / Items / Dependencies 三段。四阶段闭环：Create（brainstorming 拆分时写入）→ Discover（auto R0 扫描呈现）→ Follow-up（brainstorming 纳入 + plan metadata `consumed-deferred`）→ Close（flow Step 5.5 删除已消费的 deferred 文件）。

### Deferred File Convention

**文件位置**：`docs/plans/<topic>-deferred.md`（与 plan 同目录，git tracked）

**格式**：
```markdown
<!-- deferred-from: docs/plans/YYYY-MM-DD-xxx-plan.md -->
<!-- deferred-topic: xxx -->
<!-- deferred-date: YYYY-MM-DD -->

# <Topic> — Deferred Scope

## Origin
为什么被 defer（plan 超 500 行，按价值拆分）。

## Items
- Item 1: 做什么 + 为什么重要
- Item 2: ...

## Dependencies
Phase 1 的哪些交付是前置条件。
```

## Required First-Time Setup

```bash
# 1. Set acceptEdits mode in ~/.claude/settings.json
#    "permissions": { "defaultMode": "acceptEdits" }

# 2. (Optional) Custom escalation handler
export COLLIE_ESCALATE_CMD="your-notification-command"

# 2b. (Optional) Override state directory location
export COLLIE_HOME="~/.my-harness"  # defaults to ~/.collie

# 3. (Optional) Autoiter terminal-event notification
export COLLIE_AUTOITER_NOTIFY_CMD="osascript -e 'display notification ...'"  # or Slack/email/etc.
# Payload env vars: COLLIE_AUTOITER_EVENT, COLLIE_AUTOITER_RUN_ID, COLLIE_AUTOITER_STATUS_FILE
```

## Release Checklist

发布前必须同时满足以下所有条件：

### 入口对应表审计

每次 rename 重构后运行：
```bash
grep -n '/collie' README.md CLAUDE.md
ls commands/ skills/*/SKILL.md agents/*.md
```
`commands/` 每个 `.md` = 一个 slash 命令；`skills/` 每个 `SKILL.md` = 一个 Skill；`agents/` 每个 `.md` = 一个 Agent。任何 user-facing 名字与文件不对应 = 发布红线。

### 发布前必须通过

```bash
claude plugin validate ~/git/collie  # 期望 ✔ Validation passed
node --test tests/*.test.js                  # 期望 all pass
grep -rn '<USER>\|"kevin"' .claude-plugin/ README.md LICENSE  # 期望返空
git status --ignored | grep .claude/         # 期望命中
```

### Commit 规范

禁用 `git add -A`，每个逻辑变更拆一个 atomic commit，按具名文件 stage。

### 必须 dogfood

发布前调用 `superpowers:verification-before-completion` + `superpowers:requesting-code-review`。

### 依赖审计（每次新增 agent/skill 依赖时）

每个在 `commands/`、`hooks/`、`agents/`、`skills/` 中引用的 agent/skill 名必须属于：
- collie 自身定义（在 `agents/` 或 `skills/` 下有对应文件）
- README 前置依赖章节明确列出的外部 plugin（当前：superpowers + ralph-loop）

任何 `~/.claude/agents/` 或 `~/.claude/skills/` 绝对路径 = 发布红线（别人没有这个 home 目录）。

### 文档同步审计

发布前运行：

**手动对照**：打开 README.md 和 CLAUDE.md，逐一核查本次改动的 commands / hooks / agents / skills 对应描述是否已更新。

任何 commit 若修改了 `commands/` `hooks/` `agents/` `skills/` 下的文件，必须在同一 commit 或紧邻 commit 里同步更新 README / CLAUDE.md 中的对应描述。发布前至少手动对照一次 README 的"工作流"章节和 CLAUDE.md 的"Workflow Sequence"章节是否与实际代码一致。
