# Changelog

All notable changes to collie-harness are documented here.

---

## [0.1.5] — 2026-04-16

### Added — E2E Workflow Integration

- `commands/auto.md`: brainstorming 约束新增强制 **E2E Assessment**（探测目标项目 e2e 基建、评估可行性、给出结论）
- `skills/gated-workflow/SKILL.md`: Step 1 TodoList 新增条件性 `[e2e-setup]` / `[e2e-verify]` 任务槽位（根据 brainstorming Assessment 结论决定是否建立），并在建立 TodoList 后用 haiku subagent 交叉核对 plan-todo 对齐
- `agents/plan-doc-reviewer.md`: 新增 **E2E Assessment** 检查行，要求 brainstorming 结论在 plan 中有明确记录
- `skills/review/SKILL.md` Q5: 扩展覆盖 e2e 承诺兑现（code mode）和 plan-todo 对齐核对

### Fixed — Workflow Execution Fixes

规划→执行衔接处 7 个缺陷修复：

- `commands/auto.md`: 新增 6 项 superpowers 覆写约束
  - plan 文件须有三条 metadata（`plan-source` + `plan-topic` + `plan-executor: collie-harness:gated-workflow`）
  - plan header "For agentic workers" 行覆写为正向指令，指向 `collie-harness:gated-workflow`
  - plan 须包含 Task Execution DAG 表（供 plan-reader subagent 使用）
  - 跳过 writing-plans 内置 Plan Review Loop（collie-harness Step ③ 双审已覆盖）
  - 跳过 writing-plans Execution Handoff（由 auto.md → gated-workflow 控制）
  - design doc + plan 合并写入 planmode plan file，不分别写入两个目录
- `skills/gated-workflow/SKILL.md`:
  - Step 1: 主 session 不再直接 Read plan 文件；改为 dispatch haiku plan-reader subagent（提取 DAG + 行号 + 文件冲突检查，输出 JSON）
  - Step 2: metadata 引用从"前两行"改为"前三行"，示例块补入 `plan-executor` 行
  - Step 3: 条件分发——batch ≥ 2 调用 `dispatching-parallel-agents`；batch = 1 直接 Agent tool dispatch
  - Step 4: CR 后若需修复，⛔ 禁止主 session 直接写代码，必须 dispatch 修复 subagent → 再 dispatch CR subagent 验证，循环至通过
- `hooks/post-writing-plans-reviewer.js`: ExitPlanMode handler 新增 `plan-executor` 第三行 metadata 校验；缺失时加入 missing 列表 → hard-block
- `tests/post-writing-plans-reviewer.test.js`: 新增 2 个测试用例（executor 缺失 → block；三行全有 → 静默通过）；已有 2 个 mock plan 补入第三行 metadata（32/32 pass）

### Docs

- `docs/auto-state-machine-detailed.md`: GW1 节点补入 plan-reader subagent；GW3 节点标注条件分发逻辑；GW4 节点补入 fix subagent → re-CR 循环

---

## [0.1.4] — 2026-04-16

### Breaking

- **移除 `collie-harness:reviewer` agent**（原为 thin shell，逻辑全在 `collie-harness:review` skill）。
  - 迁移：`Agent(subagent_type="collie-harness:reviewer")` → `Skill("collie-harness:review")` + `Mode=code`、`Target=<worktree diff>`
  - `plugin.json` 的 `agents` 数组从 2 项减为 1 项

### Added

- `agents/plan-doc-reviewer.md`: 新增 **Doc Maintenance** 检查和 **Spec Consultation** 检查
  - Doc Maintenance：plan 改动会导致 README / CLAUDE.md / docs/*-spec.md 过时时，必须包含对应文档更新任务，否则 block
  - Spec Consultation：有明显相关 spec 但 plan 完全未引用时 block
- `skills/gated-workflow/SKILL.md`: 新增 **Step 5.5 文档对齐（GATE 5.95）**，作为收尾前的文档核对安全网；TodoList 模板新增 `[doc-refresh]` 条目
- `skills/gated-workflow/SKILL.md`: 实现 subagent 对照 plan 验收的**行号方案**——读取 plan 时记录每个 task 的行号范围，dispatch subagent 时传入，subagent 用 `Read(offset, limit)` 精确读取对应段落做 VBC
- `agents/plan-doc-reviewer.md`: 新增 **commit Refs 检查**，验证 plan 中引用的 commit 是否实际存在
- Planning TodoList 调整：规划阶段从 5 条简化为 4 条，移除冗余的 `[brainstorm]` 条目，新增 `TaskCreate TodoList` 步骤并在 ExitPlanMode 后显式清理
- State machine docs: 拆分为 simple / detailed 两版，auto.md 内嵌简版流程图

### Changed

- `skills/review/references/rubric-red-lines.md`:
  - Red line #12 `Applies in` 从 `code` 扩展为 `plan + code`
  - Q8 **Spec distillation** 更新为双 mode 描述（plan: doc update tasks；code: write back to spec）
  - Q9 **No reinventing** 扩展覆盖 spec 复用
- `commands/auto.md`: Step ⓪ Research & Reuse 将"Internal specs first"置顶

---

## [0.1.1] — 2026-04-15

### Fixed

- plan 文件前两行写入 `plan-source` / `plan-topic` 元数据（由 writing-plans / auto.md 步骤注入）
- `hooks/post-writing-plans-reviewer.js`: ExitPlanMode 时验证前两行 metadata 存在，缺失则 hard-block
- `skills/gated-workflow/SKILL.md` Step 2: 从 plan 内容前两行提取 `$PLAN_SOURCE`，用 `cp` 归档（不再依赖外部路径传递）

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
| `/collie-harness:auto` | slash command | Full Collie workflow loop (brainstorm → plan → review → implement → rubric) |
| `/collie-harness:queue` | slash command | Scan `~/.collie-harness/queue/*.md` and schedule pending tasks |
| `collie-harness:review` | Skill | Collie rubric reviewer (12 red-lines + ELEPHANT check) |
| `collie-harness:queue` | Skill | CronCreate-based task queue engine |
| `collie-harness:gated-workflow` | Skill | Post-planmode implementation pipeline with quality gates |
| `collie-harness:plan-doc-reviewer` | Agent | Structural plan document reviewer |

### Tests

- Unit tests (Node.js built-in test runner, zero external dependencies)
- E2E smoke tests (4 scenarios)

### Prerequisites

- [superpowers](https://github.com/superpowers-ai/superpowers) plugin
- [ralph-loop](https://github.com/ralph-loop/ralph-loop) plugin
