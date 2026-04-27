# Changelog

All notable changes to collie-harness are documented here.

---

## 0.2.4 — 2026-04-27

### Fixed
- **0.2.3 加载失败**：`.claude-plugin/plugin.json` 的 `dependencies` 用裸名 `"ralph-loop"` / `"superpowers"`，会被 Claude Code 解析为 `<name>@<own-marketplace>` = `ralph-loop@collie-marketplace`，但本 marketplace 只发布了 `collie-harness` 一个插件，安装后 `✘ failed to load`。改为带 marketplace 限定符的对象数组（`{name, marketplace: "claude-plugins-official"}`），并在 `marketplace.json` 显式声明 `allowCrossMarketplaceDependenciesOn: ["claude-plugins-official"]`（跨 marketplace 依赖默认禁止，必须放行）。

### Changed
- **`/collie-harness:auto` 显式 EnterPlanMode**：原先隐式假设用户已在 plan mode 才能正确运行（writing-plans 需要 planmode plan file 路径，dual reviewer 与 ExitPlanMode hook 都在 planmode 内）。现在新增 `Step ⓪ EnterPlanMode` 作为 Mandatory Sequence 第一步，配 `<HARD-GATE>` 禁止在进入 plan mode 之前执行 TaskCreate / Research / brainstorming 等任何后续动作。已在 plan mode 时跳过即可。原 ⓪~⑥ 顺延为 ①~⑦，DOT 流程图同步更新。

Refs: 0.2.3 release plugin-load failure; user request to make plan-mode entry explicit.

---

## 0.2.3 — 2026-04-26

### Added
- **`/collie-harness:loop` slash command**：自迭代闭环（run → observe → triage → fix → rerun），对标 Karpathy autoresearch。复用 ralph-loop 作为外层循环驱动（与 `/auto` 一致），不新建 Stop hook。
- **`skills/loop/SKILL.md`** 主 orchestrator（§3.5 跨 session 状态机 + Stage 0-6 完整编排 + dot 状态机图）。Completion signal `<promise>Collie: LOOP DONE</promise>`（迭代结束 + worktree 保留，与 `/auto` 的 `Collie: SHIP IT` 区分）。
- **`skills/loop-prepare/SKILL.md`** 独立前置体检 SKILL（trigger dry-run / scalar extraction / observability / 持久化目录验证）。
- **`skills/loop/lib/jaccard.js`** G7 重复任务检测 helper（token-set Jaccard，零依赖纯 Node.js）。
- **5 份 references**：`overfit-guards.md`（G1-G8 防过拟合硬约束）、`stop-criterion.md`（5 停止条件 + rollback 矩阵）、`discovery-prompt.md`、`iter-prompt.md`、`fix-plan-template.md`。
- **`hooks/_state.js`** 新增 `projectId / loopDir / iterDir / currentRunFile` helpers（project-scoped 路径推导）。
- **`hooks/post-writing-plans-reviewer.js`** 新增 `plan-kind: loop-stage0` 旁路：跳过 auto 双 reviewer 门禁，只校验 3 条 metadata + 4 enum 字段（auto 路径零回归）。
- **`skills/queue/SKILL.md`** task schema 扩展 `command` 字段，支持 `/collie-harness:loop` 与 `/collie-harness:auto` 分派。
- **Overfit Guards G1-G8**：硬性约束防 patch overfitting；G8 = Triage（confidence≤2 → DEFERRED）+ Deep Verify（fix_confidence≤2 → DEFERRED）双层 confidence gate。
- **可选环境变量 `COLLIE_LOOP_NOTIFY_CMD`**：终态事件外部通知（macOS 通知 / Slack / 邮件 / 自定义 shell）。
- **31 个新单测**（`tests/loop.test.js`）+ **`e2e-05-loop-shim`** smoke 场景。

### Changed
- **CLAUDE.md / README.md** 同步：新增 Loop Workflow 章节（与 Workflow Sequence 平行独立、不嵌套）+ Loop state files subtree + Key Design Constraints 追加 G1-G8 / ralph-loop 复用 / sentinel 语义 / 嵌套禁止 / Stage 3 auto-recovery 硬原则。
- **`.claude-plugin/plugin.json`**：依赖清单显式列出 `ralph-loop` + `superpowers`。

### Why
长跑工程质量打磨场景（"跑长测试 → 观察 → 校验 → 批量修复 → 重跑"）不适合 `/auto` 的一次性线性闭环。新增 `/loop` 提供多轮迭代收敛能力，硬性防过拟合（来自 APR 文献：自验证退化、patch overfitting、测试改写作弊），且跨 session 状态机保证 ralph-loop 重启后能精确恢复。

Refs: docs/plans/2026-04-24-loop-command-plan.md

---

## 0.2.2 — 2026-04-21

### Changed
- **Red line #12** 扩到覆盖"未沉淀到项目级 skill"；`rubric-red-lines.md` 新增 spec vs 项目级 skill 分界说明（声明式契约 vs 过程式 SOP）及判断启发
- **Step 5.5 `[doc-refresh]`** 审视范围包含 `.claude/skills/*/SKILL.md`；新增/更新项目级 skill 强制走 `Skill('skill-creator')`，禁止 free-form prose 写入
- **R&R R0/R1** 扫描范围同时覆盖 `docs/*-spec.md` + `.claude/skills/*/SKILL.md`（单 Explore agent，无额外成本）
- **plan-doc-reviewer Doc Maintenance** 检查同时覆盖项目级 skill 更新任务；SOP 标准化类 plan 未含 skill 创建任务 = BLOCK
- **CLAUDE.md + README.md** 同步更新 Doc Maintenance 覆盖范围（Step 5.5 安全网捕获）

### Excluded (explicit non-scope)
- 用户级 skill（`~/.claude/skills/`）本 harness 不干预
- 自进化 / 记忆 / evolution-log / promote 自动化 —— 留待真实失败证据推动

---

## 0.2.1 — 2026-04-20

### Removed
- **Notification hook**：删除 `hooks/notification-escalate.js`、其测试文件，以及 `hooks.json` 中的 `Notification` hook block。macOS 桌面弹窗（`terminal-notifier` / `osascript`）同步从 `scripts/escalate.sh` 移除。escalation 日志写入和 `COLLIE_ESCALATE_CMD` 自定义 handler 保留不变。

---

## 0.2.0 — 2026-04-20

### Removed
- **rubric Q7 "Mock vs real call"**：合并入新 Q4 "Real verification"。两者检查同一属性（mocked critical paths），Red-line #2 已独立覆盖。
- **rubric Q8 "Spec distillation"**：与 Red-line #12 + `:30-32` 同 reviewer 同时刻同属性（doc-sync），无独立 BLOCK 记录。
- **rubric Q9 "No reinventing"**：与 Red-line #9 + `:26-28` 同 reviewer 同时刻同属性。
- **rubric Q10 "Sycophancy check"**：Red-line #6 + ELEPHANT E/P/N/T 4 维已全面覆盖。
- **rubric Q11 "Surgical scope"**：与 Red-line #13 + `:34-40` 同 reviewer 同时刻同属性，Karpathy Principle 2/3 复述。

### Changed
- **rubric 问题数 11 → 6**；全仓库计数引用同步（CLAUDE.md / README.md / skills/review/SKILL.md / skills/review/references/collie-voice.md / skills/gated-workflow/SKILL.md）。
- **Review 输出格式压缩**：`skills/review/SKILL.md` Review System Prompt 改为"只列 FAIL + PASS 汇总计数"。全 PASS 场景下 review 文本量下降 ≈ 50%。内部仍严谨评审所有 6 问，只是输出折叠。
- **auto.md:150 澄清**：`Approval delegation, NOT discussion suppression`——明确 auto 模式下 AskUserQuestion 与用户讨论不被 skip，仅 brainstorming 的 Step 5/8 正式 approval 门交给 dual-reviewer。

### Added
- `docs/less-is-more-principles.md`：harness 的减法哲学 single source of truth。含 7 原则、Addition Policy（新增项准入条件）、Subtraction Tracker（删除登记）、Future Candidates（缺证据的未来候选）。

### Contract (unchanged)
- Hook PASS-detection regex `/##\s*Collie Reviewer[\s\S]*?\*\*Status:\*\*\s*PASS\b/` 继续匹配新输出格式。
- 13 red-lines + ELEPHANT 8 维未改动。

### Why
本次 release 自审发现 rubric 五处冗余（Q4+Q7 互为重复 + Q8/Q9/Q10/Q11 被上游 red-line / ELEPHANT 覆盖），触发 Karpathy surgical-scope 原则（Red-line #13）的自我审视。现以证据驱动方式消除，叠加输出格式压缩，用户可感知的 review 扫读负担下降约 50%。减法原则沉淀到 `docs/less-is-more-principles.md` 防止未来复发。

Refs: docs/plans/2026-04-20-less-is-more-harness-distillation-plan.md

---

## [0.1.9] — 2026-04-20

### Added

- `agents/plan-doc-reviewer.md`: 新增 **Impact Assessment** 强制检查 — What to Check 表格、Block-worthy issues、Do NOT flag 豁免、触发条件 + grep 反查校验流程。触发条件：跨 2+ 模块 / public API 变更 / 共享 utilities 修改；单文件 < 20 行 trivial 改动可豁免。
- `skills/gated-workflow/SKILL.md`: TodoList 模板新增 `[collie-final-review]` 节点（`[doc-refresh]` 后、`[finish]` 前）；新增 **Step 5.7 最终 rubric 审查 GATE** — 定义调用方式、PASS/WARN/BLOCK 语义、就地修复循环（连续 3 轮 BLOCK → escalate）、与 per-task CR 的区别。`[finish]` 前置条件显式依赖 Step 5.7 PASS。
- `skills/review/references/rubric-red-lines.md`: 新增 **Red line #13 Speculative scope** — 加任务未要求的 feature / flexibility / 抽象 / 顺手改无关代码 = BLOCK（引自 Karpathy CLAUDE.md Principle 2）。新增 **Q11 Surgical scope** — 每行 diff / plan 条目必须可追溯到任务目标（Karpathy Principle 3）。更新 Plan-mode focus（追加 #13）、Code-mode focus（all 13）。

### Changed

- `commands/auto.md`: 删除 Step ⑥（collie:review Mode=code 独立步骤）；Mandatory Sequence 从 ⑦ 步简化为 ⑥ 步；Completion Promise 改为"gated-workflow 返回成功"；Brainstorming 约束新增 Impact Assessment（必做）5 子项；Anti-Patterns 新增 2 条。
- `skills/review/SKILL.md`: description 字段同步指向 `[collie-final-review] Step 5.7`；4 处计数 12→13 / 10→11；Review System Prompt 输出模板新增 Q11 行。
- `skills/review/references/collie-voice.md`: 计数同步 12 red lines + 10 questions → 13 + 11。
- `CLAUDE.md`: Workflow Sequence 代码块改为 gated-workflow 内含 `[collie-final-review]`；Layer 2 描述更新；Key Design Constraints 新增 3 条（Impact Assessment 强制 + Pre-merge rubric gate + Surgical scope red line）；2 处计数同步。
- `README.md`: 工作流代码块同步；新增 Impact Assessment 强制说明段落；2 处计数同步。
- `docs/auto-state-machine-detailed.md`: 状态机图插入 Step 5.7 `[collie-final-review]` 节点（在 Step 5.5 和 Step 6 之间），删除原 Step ⑥ 节点。

### Fixed

- **Worktree 清理时序 bug**：原 `auto.md` Step ⑥ 在 `[finish]`（`finishing-a-development-branch`）之后调用 `collie:review Mode=code`，但 `[finish]` 已执行 `git worktree remove`，导致 Target 不存在。新流程将 rubric review 前移至 `[collie-final-review]` Step 5.7，在 worktree 清理前完成。

---

## [0.1.8] — 2026-04-19

### Changed

- `commands/auto.md`: RR 阶段重构为三步结构（R0 Analyze & Classify → R1 Parallel Fan-out → R2 Synthesis）。主 agent inline 先评估任务复杂度，再一次性并发派发 subagent：简单任务 → Explore haiku + 1 web search；复杂任务 → Explore sonnet + ≥2 web search（不同角度）。内部 spec scan 标注必做不可省略。

---

## [0.1.7] — 2026-04-16

### Fixed

- `skills/review/SKILL.md` Step 3: 新增要求——每个 FAIL 问题必须穷举所有违例实例，不得在发现 2-3 个后停止报告。根因：collie:review 是无状态的，每轮只报告部分问题，导致修复→重审→再发现→再修复的无限循环（实测 7 轮）。穷举报告使单次修复可以清除同一问题的所有实例，实现一轮收敛。

---

## [0.1.6] — 2026-04-16

### Fixed

- `commands/auto.md`: 跳过 brainstorming 的 human approval gates（Step 5 "User approves design?" 和 Step 8 "User reviews written spec?"）——在 auto 模式下这两步会阻塞未干预运行；collie 双 reviewer 已承担审批职责
- `commands/auto.md`: 双 reviewer 任一返回 WARN/BLOCK 后，修复计划必须重跑**双方**（不得只重跑失败方）；HARD-GATE 增加"in the same review round"约束
- `commands/auto.md`: 补上 Skip brainstorming 约束行缺失的 `>` blockquote 前缀（格式 bug）
- `skills/gated-workflow/SKILL.md`: dispatch prompt 新增要求——所有 git commit 的 message body 必须包含 `Refs: <plan 归档相对路径>`，确保任意 commit 可回溯到对应 plan

### Changed

- `skills/gated-workflow/SKILL.md`: 移除条件分发逻辑（≥2 并行 / =1 直接），统一使用 `dispatching-parallel-agents`，减少认知分支

### Docs

- `CHANGELOG.md`: 补全 v0.1.1 / v0.1.4 / v0.1.5 历史版本记录
- `.claude/skills/publish/SKILL.md`: 新增 Step 2.5，要求发布前更新 CHANGELOG

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
