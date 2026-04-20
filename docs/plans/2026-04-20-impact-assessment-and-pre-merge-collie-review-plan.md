<!-- plan-source: /Users/kevin/.claude/plans/stateless-yawning-feigenbaum.md -->
<!-- plan-topic: impact-assessment-and-pre-merge-collie-review -->
<!-- plan-executor: collie-harness:gated-workflow -->

# Design Spec: Impact Assessment + Pre-Merge Collie Review

## Context

在最近的对话中暴露了 collie-harness 的三个流程缺陷：

1. **Plan 阶段缺少 Impact Assessment 强制**：brainstorming 和 writing-plans 都没有要求列出 "这次改动会影响哪些模块 / 调用方 / 测试"。plan-doc-reviewer 只检查 Doc Maintenance（文档更新任务），但不检查代码/接口层面的 blast radius 枚举。结果是 plan 看起来完整，但实际落地时 reviewer 无法判断是否遗漏了下游影响。

2. **collie-harness:review Mode=code 时序 bug**：auto.md Step ⑥ 要求在 gated-workflow 完成后调用 `Skill("collie-harness:review")` with `Target=<current worktree diff>`。但 gated-workflow 的最后一步 `[finish]` 会调用 `finishing-a-development-branch`，该 skill 的 Step 5 在 Option 1（本地 merge）和 Option 2（Create PR）下都会 `git worktree remove` 掉当前 worktree。也就是说 code mode 的 rubric review 拿不到"current worktree diff"——worktree 已经不存在了。

3. **Rubric 缺少对 over-engineering / surgical scope 的红线**：参照 Andrej Karpathy 公开分享的 CLAUDE.md 四原则（Principle 2 Simplicity First + Principle 3 Surgical Changes），成熟 LLM coding 实践要求"Minimum code that solves the problem. Nothing speculative"以及"每行 diff 都应可追溯到用户请求"。当前 12 red lines 仅 #9（reinvent the wheel）接近该主题，但没有覆盖"加了没人要的 feature / flexibility / 抽象"或"顺手改无关代码"的情况。结果是执行者可以在不触发 rubric 的前提下引入合理看似但实际冗余的扩展。

三个问题都属于 workflow / rubric 层面的结构性缺陷，不是代码 bug，因此修复方案集中在 skill/command/agent 的 prose 指令和 TodoList 结构。

## Problem Analysis

### Problem 1 根因

对照 Google eng-practices 的 reviewer checklist（"Does this break callers?"、"Are tests adequate for the change surface?"），成熟工程实践要求 plan 阶段显式枚举两个环：**直接影响**（被修改的模块 / 文件 / API）与**下游影响**（调用方 / 依赖 / 测试）。当前 collie-harness 的 E2E Assessment 对测试做了类似要求，但没有对代码 blast radius 做等价要求。

### Problem 2 根因

auto.md Step ⑤（gated-workflow）内含 Step 6（`finishing-a-development-branch`），该 skill 在合并或创建 PR 后删除 worktree（参见 `~/.claude/skills/finishing-a-development-branch/SKILL.md` Step 5）。auto.md Step ⑥ 此时再尝试以 "current worktree diff" 为 Target 调用 rubric review，就踩到清理时序。

业界标准（Google eng-practices、GitLab、GitHub required status checks）：**质量门控必须在 merge 之前通过**。因此正确做法是把 code mode rubric review 前移到 `[finish]` 之前。

### Problem 3 根因

Karpathy CLAUDE.md Principle 2（"Minimum code that solves the problem. Nothing speculative."）与 Principle 3（"Touch only what you must. Every changed line should trace directly to the user's request."）是业界公认的 LLM coding discipline。collie-harness 作为 harness，其 rubric 就是给 LLM 的行为 spec——这两条既然有效且可落地，就应纳入 12 red lines + 10 questions 体系。未纳入 = harness 能力未封顶。

## Design Decisions

### 决策 1 — Impact Assessment 作为 plan 必填章节

与现有 E2E Assessment 同构（参见 `agents/plan-doc-reviewer.md:30` E2E Assessment 检查行、`commands/auto.md:150-156` E2E Assessment 必做约束）：

- **位置**：plan 文件顶部，与 E2E Assessment 并列
- **内容结构**：
  - `Directly affected`：本次直接修改的 module / file / public API / CLI / hook / skill / agent
  - `Downstream consumers`：调用方 / 依赖 / 单元测试 / E2E 脚本 / 文档引用（列举已知点，不要泛泛说 "may affect")
  - `Reverse impact`：非直接但受影响的点（缓存、持久状态、历史数据、外部 session）
- **强制方**：
  - `plan-doc-reviewer` "What to Check" 表格新增一行
  - `plan-doc-reviewer` "Block-worthy issues" 新增"缺 Impact Assessment"条目
  - `plan-doc-reviewer` "判断标准边界" 新增"Impact Assessment 触发条件"小节
  - `auto.md` Brainstorming 约束列表新增"Impact Assessment（必做）"
  - `auto.md` Anti-Patterns 新增一条
- **豁免**：单文件 < 20 行改动、纯文档改动、纯注释改动、trivial bug 修复 → 可标注 `None — trivial change, no cross-module impact`

### 决策 2 — collie-final-review 移入 gated-workflow TodoList

- **位置**：`[doc-refresh]` 之后、`[finish]` 之前，命名 `[collie-final-review]`
- **执行**：dispatch `Skill("collie-harness:review")` with `Mode=code`, `Target=<worktree diff>`, `Context="Plan: $ARCHIVE_PATH"`
- **Gate**：PASS 才进入 `[finish]`；WARN / BLOCK 就地 dispatch 修复 subagent，修复完毕后**重跑** collie-final-review，循环直到 PASS 或升级处理。**禁止退出 gated-workflow 回到 auto.md 层修复**（因为退出后再进入会丢 TodoList 状态）。
- **auto.md Step ⑥ 删除**：collie-review code stage 的唯一入口变成 gated-workflow 内部节点
- **Completion Promise 更新**：`collie-harness:gated-workflow 返回成功` = 包含 `[collie-final-review]` PASS，无需 auto.md 额外校验

备选方案对比：
- A: 保留 auto.md Step ⑥ 但把 Target 改成 `git diff main...<branch>`（branch 清理后 diff 仍可得）——语义绕，仍然脱离"审查→修复→再审查"闭环
- B: 每个 `[task N-CR]` 改成 collie-review 而非 requesting-code-review——per-task 粒度太细，失去整体 rubric 视角
- **C（采用）**: 保留 per-task `[task N-CR]`（使用 `superpowers:requesting-code-review`），再在 TodoList 末尾加入 `[collie-final-review]` 做整体 rubric gate

### 决策 3 — Red line #13（Speculative scope）+ Q11（Surgical scope）

- **Red line #13 Speculative scope**（plan + code）：加了任务未要求的 feature / flexibility / 抽象 / 顺手改无关代码 / 预留扩展点。单条违规即 BLOCK。
  - Collie voice quote：`"问啥做啥，多一行都是债"`
- **Q11 Surgical scope**（plan + code）：
  - plan mode：plan 内每条 task / 子 Step 是否可追溯到 Context 列出的问题？有无与原问题无关的 scope 扩张？
  - code mode：diff 内每行是否可追溯到 plan task？有无顺手改了不相关代码 / 注释 / 格式？
- **Plan-mode focus** 更新：`#1, #4, #5, #6, #9, #10, #12, #13`
- **Code-mode focus** 更新：`all 13 apply`
- **计数同步范围**（由本 plan 的 Impact Assessment 强制枚举）：
  - `skills/review/references/rubric-red-lines.md`（新增 #13 行 + Q11 行 + 更新 focus 行）
  - `skills/review/references/collie-voice.md`（line 3 "12 red lines and 10 questions"）
  - `skills/review/SKILL.md`（4 处：line 30 / 60 / 62 / 101，以及 fixed output format 里新增 Q11 行）
  - `skills/gated-workflow/SKILL.md`（Step 5.7 Body 中 "12 红线 + 10 问题"）
  - `CLAUDE.md`（line 36 / 83）
  - `README.md`（line 101 / 129）
- **豁免**：elephant-check.md 维度不变（ELEPHANT 专注反谄媚，与 scope 正交，不需加第 9 维度）。
- **备选方案对比**：
  - A: 只加 Q11，不加 #13 → over-engineering 只降级为 WARN，与 Karpathy "speculative = 债" 的 BLOCK 级态度不匹配
  - B: 把两条都写成 Q11 + Q12，不动 red lines → 严重性表达不足
  - **C（采用）**: Red line #13（BLOCK 级硬约束）+ Q11（逐行检查工具）双管齐下

## E2E Assessment

### 探测目标项目 e2e 基建

- 单元测试：`tests/*.test.js`（node --test）— 覆盖 hook 逻辑
- E2E smoke：`tests/e2e/smoke.sh` — 4 个场景（已在 CLAUDE.md 验证章节明示）
- 无 Playwright / Cypress / pytest — Node.js plugin 项目
- CLAUDE.md 发布红线："必须 dogfood" — 调用 `/collie-harness:auto` 真实验证

### 本次需求的 e2e 策略

本次变更**全部为 prose 指令**（markdown 内容：agents/*.md、skills/*/SKILL.md、commands/*.md、CLAUDE.md、README.md），无 JavaScript 代码逻辑改动：

- hook 逻辑未动 → 现有 `tests/*.test.js` 应保持全绿（作为 sanity check 运行）
- 新增的约束（Impact Assessment 章节、`[collie-final-review]` 节点）通过 prose 指令对 LLM 执行者生效，不是代码层面的 API
- 自动化 E2E 需要真实 `/collie-harness:auto` 环境 + 真实 LLM 调用 + 时间成本高

### 结论

**`e2e_feasible: false`** — 理由：改动为 prose 指令变更。验证路径是 CLAUDE.md 已强制的 dogfood，即本 plan 合并后下一次 `/collie-harness:auto` 调用自然会使用新流程。本轮执行时额外 dogfood（见下方 Execution Preamble）。

## Impact Assessment

### Directly affected

- `agents/plan-doc-reviewer.md` — 新增 Impact Assessment 检查行、block-worthy 条目、判断边界小节
- `skills/gated-workflow/SKILL.md` — TodoList 模板新增 `[collie-final-review]`、新增 Step 5.7 章节、Step 6 前置条件调整；Step 5.7 body 内 "12 红线 + 10 问题" 计数同步为 "13 红线 + 11 问题"
- `commands/auto.md` — Mandatory Sequence 删除 Step ⑥、digraph 更新、Completion Promise 更新、Task Prompt 删除 Final review 段、Brainstorming 约束新增 Impact Assessment、Anti-Patterns 新增一条
- `skills/review/SKILL.md` — (a) description 字段单行同步（将 `called directly at /auto step ⑥ after gated-workflow completes` 改为指向 `[collie-final-review]` Step 5.7 入口）；(b) 4 处计数引用同步（12 → 13 red lines，10 → 11 questions）；(c) Review System Prompt 的 fixed output format 新增 Q11 行。**Mode=code/plan/adhoc 语义、Status Detection Interface 正则均保持不动**
- `skills/review/references/rubric-red-lines.md` — 新增 Red line #13（Speculative scope）和 Q11（Surgical scope）；更新 Plan-mode / Code-mode focus 行；新增 #13 / Q11 补充说明段
- `skills/review/references/collie-voice.md` — line 3 "12 red lines and 10 questions" 计数同步；可选：在 voice sample 中追加 1-2 条针对 #13 的 Collie 口吻样本
- `CLAUDE.md` — Workflow Sequence 同步、Key Design Constraints 新增三条（Impact Assessment + Pre-merge rubric gate + Surgical scope red line）、line 36 / 83 计数同步
- `README.md` — 工作流代码块同步、强制说明段落新增 Impact Assessment、line 101 / 129 计数同步

### Downstream consumers

- `skills/review/references/elephant-check.md` — **不修改**。ELEPHANT 8 维度聚焦反谄媚，与 scope 正交
- `hooks/post-writing-plans-reviewer.js` — **不修改**。plan metadata 校验（plan-source + plan-topic + plan-executor）和双 reviewer state 追踪逻辑不变
- `hooks/post-approved-exitplan-hint.js` — **不修改**
- `hooks/post-exitplan-gated-hint.js` — **不修改**
- `hooks/stop-steps-counter.js` — **不修改**
- `tests/*.test.js` — **不修改**，作为 sanity check 必须全绿
- `tests/e2e/smoke.sh` — **不修改**，4 场景不覆盖本次 prose 变更
- `docs/*-spec.md` — 无对应 spec 文件，不需同步

### Reverse impact

- **历史 plan 文件**（`docs/plans/2026-04-14-*.md` 等）中 "12 红线 + 10 问题" 等表述 → **不 retro 更新**，历史档案冻结
- **历史 plan 文件缺 Impact Assessment** → 仅对新计划生效，历史不 retro
- **已有文档外部引用**（如 `skills/review/SKILL.md` description 里的 `"called directly at /auto step ⑥ after gated-workflow completes"`）→ task3 必须同步，否则描述与实际流程脱节
- **auto.md 是 slash command**，每次调用加载最新版本 → 无 session 缓存问题
- **gated-workflow plan-reader subagent（haiku）** 解析 Task DAG 表 → 表格式不变，不受影响
- **跨 session 并发**（`collie-harness:queue` 任务队列 concurrency=1）→ 不受影响
- **本 plan 自身**：本 plan 修改 gated-workflow / auto.md，执行时**旧版本 skill 已加载**，需要额外的 Execution Preamble（见下）来本轮 dogfood 新流程

---

# Impact Assessment + Pre-Merge Collie Review Implementation Plan

> **For agentic workers:** MUST invoke Skill('collie-harness:gated-workflow') to implement this plan.

**Goal:** (1) 在 plan 阶段强制 Impact Assessment 章节；(2) 将 collie-harness:review Mode=code 从 auto.md Step ⑥ 前移到 gated-workflow TodoList 的 `[collie-final-review]` 节点，修复 worktree 清理时序 bug；(3) 吸收 Karpathy CLAUDE.md Principle 2/3，补充 Red line #13（Speculative scope）+ Q11（Surgical scope）到 rubric 体系。

**Architecture:** 三个改动独立但互相配合。(1) `plan-doc-reviewer.md` + `auto.md` 新增 Impact Assessment 强制；(2) `gated-workflow/SKILL.md` 新增 `[collie-final-review]` TodoList 节点和 Step 5.7，`auto.md` 删除 Step ⑥；(3) `rubric-red-lines.md` 新增 #13 + Q11，计数同步到所有引用处。所有改动均为 markdown prose 指令，不涉及 JavaScript 代码修改。

**Tech Stack:** Markdown（agent / skill / command / README / CLAUDE.md），无新依赖，无代码层 API 变更。

**Subagent model for execution:** 所有 Task（task1–task6）均为纯 prose 编辑，gated-workflow dispatch 时使用 `general-purpose` subagent with `model="haiku"`（符合 user-level CLAUDE.md "Agent 模型选择速查"对轻量任务的规定）。每个 task 完成后配对的 `[task N-CR]` 使用 `superpowers:requesting-code-review`（该 skill 自选 model）。`[collie-final-review]` 节点使用 `collie-harness:review` skill（内部已 dispatch `model="opus"`）。

**Scope lock:** 本 plan 不再追加任何 rubric-adjacent 章节 / 维度 / 质询点。Rubric 扩张仅限于 task6 明确定义的 Red line #13 + Q11；ELEPHANT 8 维度、Reflexion 规则、Status Detection Interface 均冻结。后续若发现新 gap，须另起 plan。

---

## Execution Preamble（本轮特例：dogfood 本次修复）

本 plan 修改 `gated-workflow/SKILL.md` 和 `auto.md` 自身。当前执行 session 使用的 skill 在 dispatch 时已加载，中途改 markdown 不影响当前 session 的行为。为了**本轮就验证修复生效**，执行者必须在旧版 gated-workflow 的 TodoList 之上手动追加新节点：

1. gated-workflow Step 1 建立 TodoList 之后、建立完成立即执行的 "Plan-Todo 交叉核对" 之前，用 `TaskCreate` 追加:
   ```
   [collie-final-review] 最终 rubric 审查 — dogfood 本次 plan 的新流程
   ```
   设置 `addBlockedBy` 包含 `[doc-refresh]` 的 task id，并让 `[finish]` `addBlockedBy: [collie-final-review]`。

2. 执行到 `[collie-final-review]` 时：dispatch `Skill("collie-harness:review")` with `Mode=code`, `Target=<worktree 绝对路径>`, `Context="Plan: $ARCHIVE_PATH"`。PASS 才进入 `[finish]`；WARN / BLOCK 则就地 dispatch 修复 subagent，循环到 PASS。

3. `[finish]` 完成后，auto.md Step ⑥ 虽仍存在于当前 session 的 task prompt 中，但**跳过本次执行**。在最终回复中明确说明："本轮 dogfood 已在 `[collie-final-review]` 节点执行完 rubric review，auto.md Step ⑥ 跳过以避免 worktree 清理后 Target 失效。"

---

## Task Execution DAG

| Task | Batch | Depends on | Key files |
|------|-------|------------|-----------|
| task1 | 1 | - | agents/plan-doc-reviewer.md |
| task2 | 1 | - | skills/gated-workflow/SKILL.md |
| task6 | 1 | - | skills/review/references/rubric-red-lines.md, skills/review/references/collie-voice.md |
| task3 | 2 | task1, task2, task6 | commands/auto.md, skills/review/SKILL.md |
| task4 | 3 | task1, task2, task3, task6 | CLAUDE.md |
| task5 | 3 | task1, task2, task3, task6 | README.md |

Batch 1: task1, task2, task6 并行（三个独立文件集合，无冲突）。
Batch 2: task3 单独（依赖 task1 + task2 + task6 的设计决策已落定，`skills/review/SKILL.md` 的计数同步引用 task6 确立的 13/11 数字，避免措辞漂移）。
Batch 3: task4, task5 并行（两个独立文件，均依赖前两批完成以保证描述 + 计数一致）。

CR 任务：每个 taskN 完成后立即配对 taskN-CR，使用 `superpowers:requesting-code-review`。见 gated-workflow TodoList 结构模板。

---

## Tasks

### Task 1: plan-doc-reviewer 强制 Impact Assessment

**Files:**
- Modify: `agents/plan-doc-reviewer.md`

**改动范围定位**：
- 现状参见 `agents/plan-doc-reviewer.md:22-30`（What to Check 表）
- `agents/plan-doc-reviewer.md:36-46`（Block-worthy issues）
- `agents/plan-doc-reviewer.md:48-56`（Do NOT flag）
- `agents/plan-doc-reviewer.md:86-103`（判断标准边界 - 已有 Doc Maintenance + Spec Consultation）

- [ ] **Step 1：在 "What to Check" 表格末尾新增 Impact Assessment 行**

在 `agents/plan-doc-reviewer.md:30`（E2E Assessment 行）之后追加：

```markdown
| Impact Assessment | 若改动跨 2+ 模块 / 修改已有 public API / 删除或重命名公开接口 / 修改共享 utilities，plan 是否包含 "Impact Assessment" 章节，列出 (a) Directly affected（直接修改的 module/file/API/CLI/hook/skill/agent）(b) Downstream consumers（调用方/依赖/单元测试/E2E/文档引用）(c) Reverse impact（非直接但受影响的点） |
```

- [ ] **Step 2：在 "Block-worthy issues" 列表末尾新增两条**

在 `agents/plan-doc-reviewer.md:46`（E2E Assessment 结论为"可行"但无对应 e2e 测试任务）之后追加：

```markdown
- 涉及跨模块改动 / public API 变更 / 共享 utilities 修改但完全没有 Impact Assessment 章节
- Impact Assessment 的 Downstream consumers 列表显而易见遗漏了已知调用方（例如改动某 hook 但未列出引用它的 skill / command）
```

- [ ] **Step 3：在 "Do NOT flag these" 列表末尾新增一条**

在 `agents/plan-doc-reviewer.md:56`（E2E Assessment 结论为"不可行"且理由合理）之后追加：

```markdown
- 单文件 < 20 行改动 / 纯文档 / 纯注释 / trivial bug 修复——这类改动 Impact Assessment 可标注 `None — trivial change, no cross-module impact`
```

- [ ] **Step 4：在 "判断标准边界" 章节末尾新增 "Impact Assessment 触发条件" 小节**

在 `agents/plan-doc-reviewer.md:103`（Spec Consultation 触发流程的最后一条 "若确实无相关 spec"）之后追加：

````markdown

### Impact Assessment 触发条件（满足任一即需 Impact Assessment 章节）

- 改动跨 2+ 模块 / 目录
- 修改已有 public API / CLI 命令 / hook / skill / agent 定义
- 删除或重命名公开接口
- 修改共享 utilities / 基础库 / 配置文件
- 新增 / 删除 / 重命名用户可见命令或 slash command

豁免（可直接标注 `None — trivial change, no cross-module impact`）：
- 单文件 < 20 行的 trivial 改动
- 纯文档 / 纯注释改动
- 单行 bug 修复且无跨文件传导

### Impact Assessment 校验流程（reviewer 实际执行）

1. Read plan 的 "Impact Assessment" 章节（若不存在，先按触发条件判断是否需要）
2. 对 "Directly affected" 列出的每个文件/模块，grep 反向引用：
   - Bash: `grep -rn "<文件名 / 符号>" .` 检查是否有未列入 "Downstream consumers" 的引用点
3. 若发现显著遗漏 → block 并指名具体遗漏文件
4. 若 plan 作者已标注豁免 (`None — trivial change`)，验证改动确实 < 20 行 + 单文件 + 无跨文件传导，否则 block
````

- [ ] **Step 5：frontmatter / description 完整性核对**

确保文件头部 `name: "plan-doc-reviewer"`、`model: opus`、`color: cyan`、`description:` 未被破坏。description 字段不需改动（描述层级不涉及具体检查项）。

- [ ] **Step 6：Commit**

```bash
git add agents/plan-doc-reviewer.md
git commit -m "$(cat <<'EOF'
feat: plan-doc-reviewer 强制 Impact Assessment 章节

新增 What to Check 表格项、Block-worthy / Do NOT flag 条目、
判断边界小节与校验流程。触发条件为跨模块 / public API / 共享
utilities 改动；单文件 trivial 改动可豁免。

Refs: docs/plans/2026-04-20-impact-assessment-and-pre-merge-collie-review-plan.md
EOF
)"
```

---

### Task 2: gated-workflow 插入 [collie-final-review] 节点

**Files:**
- Modify: `skills/gated-workflow/SKILL.md`

**改动范围定位**：
- `skills/gated-workflow/SKILL.md:58-88`（TodoList 结构模板 + 示例）
- `skills/gated-workflow/SKILL.md:229-237`（Step 5：测试全通）
- `skills/gated-workflow/SKILL.md:239-254`（Step 5.5：文档对齐）
- `skills/gated-workflow/SKILL.md:257-259`（Step 6：收尾）

- [ ] **Step 1：TodoList 结构模板新增条目**

修改 `skills/gated-workflow/SKILL.md:58-70`（`### TodoList 结构模板` 到 `[finish] finishing-a-development-branch`），在 `[doc-refresh]` 行之后、`[finish]` 行之前插入：

```markdown
- `[collie-final-review]` 最终 rubric 审查（worktree 清理前的 pre-merge gate，调用 collie-harness:review Mode=code）
```

`[finish]` 行保持原样，但添加依赖：此条目应 `[blocked-by: collie-final-review]`。模板 prose 示例在原"示例（3 个互相独立的 task）"之后更新：

```
[task0] 归档计划文档
[task1] 实现功能 A [batch-1]
[task2] 实现功能 B [batch-1]
[task3] 实现功能 C [batch-1]
[task1-CR] code review task1 [batch-2, blocked-by: task1]
[task2-CR] code review task2 [batch-2, blocked-by: task2]
[task3-CR] code review task3 [batch-2, blocked-by: task3]
[e2e-setup] 建立 e2e 基建（条件性）
[e2e-verify] 运行 e2e / 集成测试（条件性）
[test-verify] 运行单元测试
[doc-refresh] 对照实现结果核对 README / CLAUDE.md / spec，补更新遗漏
[collie-final-review] 最终 rubric 审查（collie-harness:review Mode=code）
[finish] finishing-a-development-branch
```

- [ ] **Step 2：新增 Step 5.7 章节 "最终 rubric 审查（GATE 5.7）"**

在 `skills/gated-workflow/SKILL.md:255`（Step 5.5 结尾、Step 6 开头前）插入整段：

````markdown

---

## Step 5.7：最终 rubric 审查（GATE 5.7）

⛔ **worktree 清理前最后一道 rubric gate，不得跳过。**

### 调用方式

```
Skill("collie-harness:review")
  Mode=code
  Target=<当前 worktree 绝对路径 或 "worktree diff">
  Context="Plan: $ARCHIVE_PATH（from task0）"
```

### Gate 语义

- **PASS** → 进入 Step 6
- **WARN** → 必须修复 WARN 项后重跑，不得跳过
- **BLOCK** → 必须修复 BLOCK 项后重跑，不得跳过

### WARN / BLOCK 处理

⛔ **禁止主 session 直接写代码修复**，理由与 `[task N-CR]` 的 CR 处理一致（读源码会污染主 session 上下文）。

修复流程：
1. 从 rubric review 输出中提取所有 FAIL 问题（Red line 违规 + 逐条 question FAIL）
2. Dispatch 修复 subagent，传入：
   - FAIL 问题清单（引用 review 原文）
   - worktree 绝对路径
   - `$ARCHIVE_PATH`（plan 归档路径）
3. 修复 subagent 完成后，dispatch 新的 `Skill("collie-harness:review")` with 同样 Mode/Target/Context
4. 修复 → 重审循环直到 PASS
5. 连续 3 轮仍 BLOCK → 升级（通过 `scripts/escalate.sh` 上报，等用户介入）

⛔ **禁止退出 gated-workflow 返回 auto.md 层修复**——TodoList 状态会丢失，CR 历史链断裂。

### 与 `[task N-CR]` 的区别

- `[task N-CR]`：per-task 粒度，使用 `superpowers:requesting-code-review`，关注**单个 task 的实现质量**
- `[collie-final-review]`：整体 rubric 粒度，使用 `collie-harness:review` Mode=code，关注**所有改动聚合后的 13 红线 + 11 问题 + ELEPHANT**

两者互补，不重复。

````

- [ ] **Step 3：Step 6 开头新增前置条件**

修改 `skills/gated-workflow/SKILL.md:257-259`（Step 6 章节起始），在 `## Step 6：收尾（GATE 6）` 标题之后的第一行前插入：

```markdown
⛔ **仅在 Step 5.7（GATE 5.7）`[collie-final-review]` 返回 PASS 后进入。**

```

保留原有 `调用 superpowers:finishing-a-development-branch（合并 / PR / 清理 worktree）。` 行。

- [ ] **Step 4：Commit**

```bash
git add skills/gated-workflow/SKILL.md
git commit -m "$(cat <<'EOF'
feat: gated-workflow 新增 [collie-final-review] pre-merge gate

TodoList 模板在 [doc-refresh] 后、[finish] 前插入
[collie-final-review] 节点；新增 Step 5.7 章节定义 rubric
gate 语义、WARN/BLOCK 就地修复循环；Step 6 前置条件
显式依赖 Step 5.7 PASS。

修复 worktree 清理后 rubric review 取不到 diff 的时序 bug。

Refs: docs/plans/2026-04-20-impact-assessment-and-pre-merge-collie-review-plan.md
EOF
)"
```

---

### Task 3: auto.md 简化 + Impact Assessment 要求 + skills/review 描述同步

**Files:**
- Modify: `commands/auto.md`
- Modify: `skills/review/SKILL.md`

**改动范围定位（auto.md）**：
- `commands/auto.md:34-44`（Mandatory Sequence 代码块）
- `commands/auto.md:46-78`（digraph）
- `commands/auto.md:14-20`（Completion Promise）
- `commands/auto.md:22-30`（Anti-Patterns）
- `commands/auto.md:122-156`（Brainstorming 约束列表，含 E2E Assessment）
- `commands/auto.md:177-183`（Task Prompt "Final review" + "Only when ... output"）

**改动范围定位（review/SKILL.md）**：
- `skills/review/SKILL.md:3`（description 字段提到 "called directly at /auto step ⑥"）

- [ ] **Step 1：auto.md Mandatory Sequence 代码块更新**

修改 `commands/auto.md:34-44`：
- 删除 `⑥ Skill(collie-harness:review Mode=code) → final review`
- 修改 `⑦ PASS → output completion signal / WARN/BLOCK → fix and return to ⑤` 为 `⑥ gated-workflow 内部 [collie-final-review] PASS 后 → output completion signal`

最终形态：

```
⓪ Create planning TaskList via TaskCreate (4 items: [research], [plan-review], [collie-review], [exit])
① Research & Reuse → internal specs first, then external (GitHub, docs, registries)
② superpowers:brainstorming → design alignment + writing-plans (triggered by brainstorming)
③ PARALLEL: Agent(collie-harness:plan-doc-reviewer) AND Skill(collie-harness:review Mode=plan)
   → both must approve before ④
④ ExitPlanMode → TaskUpdate all planning tasks completed, close planning TaskList
⑤ collie-harness:gated-workflow skill → complete implementation pipeline
   （内含 [collie-final-review] = Skill(collie-harness:review Mode=code)，作为 [finish] 前的 pre-merge gate）
⑥ gated-workflow 返回成功 → output completion signal
```

- [ ] **Step 2：auto.md digraph 更新**

修改 `commands/auto.md:46-78`：
- 删除 `CR` 节点定义行
- 删除 `IMPL -> CR` 和 `CR -> SHIP` 和 `CR -> IMPL [label="WARN/BLOCK → fix"]` 边
- 新增 `IMPL -> SHIP [label="PASS (含 [collie-final-review])"]`
- 新增 `IMPL -> IMPL [label="WARN/BLOCK → 就地修复", style=dashed]`

保留所有其他节点（TASK, RR, BRAIN, REVIEW, EXIT, MONITOR, ESC）和它们的边。

- [ ] **Step 3：auto.md Completion Promise 更新**

修改 `commands/auto.md:14-20`，完成条件 1 从：

```
1. collie-harness:review (Mode=code) returns `**Status:** PASS`
```

改为：

```
1. collie-harness:gated-workflow returns successfully (含 [collie-final-review] 返回 `**Status:** PASS`)
```

条件 2、3 不变。

- [ ] **Step 4：auto.md Anti-Patterns 新增两条**

在 `commands/auto.md:30`（Anti-Patterns 最后一条 "The plan looks good enough ..."）之后追加：

```markdown

**"只有大改动才需要 Impact Assessment"**
任何 plan 都必须有 Impact Assessment 章节。小改动可标注 `None — trivial change, no cross-module impact`。完全缺失此章节 = plan-doc-reviewer BLOCK。

**"gated-workflow 跑完直接 SHIP，rubric review 不必要"**
gated-workflow 内部已含 `[collie-final-review]` pre-merge gate。试图省略 = Step 5.7 GATE 违规 = red line。
```

- [ ] **Step 5：auto.md Brainstorming 约束列表新增 Impact Assessment**

在 `commands/auto.md:150`（E2E Assessment（必做）条目）**之前**插入：

````markdown
>     - **Impact Assessment（必做）**：brainstorming 的设计阶段必须包含影响面评估，结论写入 plan 的 "Impact Assessment" 章节：
>       1. **Directly affected**：本次直接修改的 module / file / public API / CLI / hook / skill / agent（精确到文件路径）
>       2. **Downstream consumers**：调用方 / 依赖 / 单元测试 / E2E 脚本 / 文档引用（枚举已知点，grep / rg 反查）
>       3. **Reverse impact**：非直接但受影响的点（缓存、持久状态、历史数据、跨 session 状态）
>       4. **触发条件**：满足任一即需完整 Impact Assessment — 改动跨 2+ 模块、修改已有 public API / CLI / hook / skill / agent、删除或重命名公开接口、修改共享 utilities
>       5. **豁免**：单文件 < 20 行改动 / 纯文档 / 纯注释 / trivial bug 修复 → 可标注 `None — trivial change, no cross-module impact`

````

- [ ] **Step 6：auto.md Task Prompt "Final review" 段落删除**

修改 `commands/auto.md:177-183`：删除整段 "Final review — call Skill..." 直到 "until PASS is achieved."

将 "Implementation" 段后的内容改为：

```markdown
> **Completion** — 当 `collie-harness:gated-workflow` 返回成功（内部 `[collie-final-review]` 返回 `**Status:** PASS`），output:
> `<promise>Collie: SHIP IT</promise>`
>
> 若 gated-workflow 内部出现无法自愈的 WARN / BLOCK（连续 3 轮修复失败），通过 `scripts/escalate.sh` 升级。
```

- [ ] **Step 7：skills/review/SKILL.md description 字段同步**

修改 `skills/review/SKILL.md:3`：

将 `(2) Code mode — Target is a worktree diff or branch; called directly at /auto step ⑥ after gated-workflow completes.` 改为 `(2) Code mode — Target is a worktree diff or branch; called as gated-workflow TodoList item [collie-final-review] (Step 5.7) before worktree cleanup.`

其余 description 内容（plan mode、adhoc mode 描述）保持不变。

- [ ] **Step 8：skills/review/SKILL.md 计数同步**

依赖 task6 已确立 13 / 11 的最终数字。修改 4 处：

- `skills/review/SKILL.md:30`：`12 red lines + mode-specific notes` → `13 red lines + mode-specific notes`
- `skills/review/SKILL.md:60`：`Scan 12 red lines` → `Scan 13 red lines`；`Plan mode emphasizes #1, #4, #5, #6, #9, #10` → `Plan mode emphasizes #1, #4, #5, #6, #9, #10, #13`；`Code mode: all 12 apply` → `Code mode: all 13 apply`
- `skills/review/SKILL.md:62`：`Run the 10 review questions` → `Run the 11 review questions`
- `skills/review/SKILL.md:101`：`all 10 questions PASS` → `all 11 questions PASS`

- [ ] **Step 9：skills/review/SKILL.md fixed output format 新增 Q11 行**

定位 Review System Prompt 中 `### Review questions` 输出模板块（当前到 `Q10 Sycophancy check`）。在 `- Q10 Sycophancy check: [PASS/FAIL] — <evidence>` 行之后追加：

```
> - Q11 Surgical scope: [PASS/FAIL] — <evidence>
```

确保模板与 rubric-red-lines.md 定义的 11 条问题数一致。Status Detection Interface 正则（`## Collie Reviewer` + `**Status:** PASS`）保持不动——计数变化不影响正则匹配。

- [ ] **Step 10：Commit**

```bash
git add commands/auto.md skills/review/SKILL.md
git commit -m "$(cat <<'EOF'
refactor: auto.md 删除 Step ⑥，新增 Impact Assessment 必做约束

Mandatory Sequence 从 ⑦ 步简化为 ⑥ 步；digraph 合并 CR 节点
进 IMPL；Completion Promise 条件 1 改为 gated-workflow 返回
成功。新增 Impact Assessment 约束到 Brainstorming 列表，
Anti-Patterns 新增两条。skills/review/SKILL.md description
同步指向新的 [collie-final-review] 入口；4 处 12/10 计数
同步为 13/11；Review System Prompt 输出模板新增 Q11 行。

Refs: docs/plans/2026-04-20-impact-assessment-and-pre-merge-collie-review-plan.md
EOF
)"
```

---

### Task 4: CLAUDE.md 同步

**Files:**
- Modify: `CLAUDE.md`

**改动范围定位**：
- `CLAUDE.md`（Workflow Sequence 代码块——根据实际行号定位）
- `CLAUDE.md`（Key Design Constraints 章节）

- [ ] **Step 1：Workflow Sequence 代码块更新**

找到 "Workflow Sequence (enforced by hooks)" 章节的代码块。最小 delta：删除原有 3 行

```
→ collie-harness:review skill (Mode=code, Target=worktree diff)
→ PASS → <promise>Collie: SHIP IT</promise>
   WARN/BLOCK → fix loop
```

替换为 1 行：

```
→ collie-harness:gated-workflow skill（内含 [collie-final-review] pre-merge gate） → <promise>Collie: SHIP IT</promise>
```

不展开 gated-workflow 内部 task0/taskN/test-verify/doc-refresh 结构；该结构是 gated-workflow 的实现细节，CLAUDE.md 此处只记录外部可见流程边界。

- [ ] **Step 2：Key Design Constraints 新增三条**

在 "Key Design Constraints" 章节末尾追加：

```markdown
- **Impact Assessment 强制**：所有 plan 必须包含 Impact Assessment 章节（Directly affected + Downstream consumers + Reverse impact）。由 `collie-harness:plan-doc-reviewer` 的 Impact Assessment 检查强制。豁免：单文件 < 20 行 trivial 改动。
- **Pre-merge rubric gate**：`collie-harness:review` Mode=code 作为 `[collie-final-review]` 节点嵌入 `gated-workflow` TodoList 中 `[doc-refresh]` 之后、`[finish]` 之前（Step 5.7）。worktree 清理前必须通过 rubric gate，auto.md 无独立 Step ⑥。
- **Surgical scope red line**：Red line #13（Speculative scope）+ Q11（Surgical scope）吸收 Karpathy CLAUDE.md Principle 2/3。加任务未要求的 feature / flexibility / 抽象 / 顺手改无关代码 = BLOCK；每行 diff 必须可追溯到任务目标。
```

- [ ] **Step 3：计数同步（2 处）**

- `CLAUDE.md:36`（4-Layer 表格第 2 行 `skills/review/`）：`12 red-lines + 10 questions` → `13 red-lines + 11 questions`
- `CLAUDE.md:83`（Key Design Constraints 第 1 条 Rubric red-lines）：`12 hard violations in skills/review/references/rubric-red-lines.md` → `13 hard violations in skills/review/references/rubric-red-lines.md`

- [ ] **Step 4：Hooks and Their Triggers 表格核对**

核对该表内容未因前几项改动而失准（hook 逻辑未变，应保持原样）。

- [ ] **Step 5：Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: CLAUDE.md 同步 Impact Assessment / pre-merge gate / surgical scope 约束

Workflow Sequence 代码块改为 gated-workflow 内含
[collie-final-review] 新流程。Key Design Constraints 新增
三条：Impact Assessment 强制 + Pre-merge rubric gate +
Surgical scope red line。2 处 12/10 计数同步为 13/11。

Refs: docs/plans/2026-04-20-impact-assessment-and-pre-merge-collie-review-plan.md
EOF
)"
```

---

### Task 5: README.md 同步

**Files:**
- Modify: `README.md`

**改动范围定位**：
- `README.md:69-87`（工作流代码块 + 下方两段说明）
- `README.md:89`（文档维护强制）
- `README.md:91`（E2E Assessment 段落）

- [ ] **Step 1：工作流代码块更新**

修改 `README.md:82-85`，最小 delta：删除原有 3 行

```
→ collie-harness:review skill (Mode=code, Target=worktree diff, Context=plan doc)
→ PASS → <promise>Collie: SHIP IT</promise>
   WARN/BLOCK → 修复后重跑 gated-workflow
```

替换为 1 行：

```
→ collie-harness:gated-workflow skill（内含 [collie-final-review] pre-merge gate） → <promise>Collie: SHIP IT</promise>
```

不展开 gated-workflow 内部 TodoList 节点结构；该结构是 gated-workflow 实现细节，README 此处只记录外部可见流程边界。

- [ ] **Step 2：新增 Impact Assessment 强制说明段落**

在 `README.md:91`（E2E Assessment 段落）**之前**插入一段：

```markdown
任何 plan 必须包含 Impact Assessment 章节，列明直接影响模块（Directly affected）、下游调用方 / 依赖 / 测试（Downstream consumers）、反向影响（Reverse impact）。由 `collie-harness:plan-doc-reviewer` 强制。豁免：单文件 < 20 行的 trivial 改动可标注 `None — trivial change, no cross-module impact`。
```

保持原有的 "任何 plan 若改动用户可见行为..." 段（`README.md:89`）和 E2E Assessment 段（`README.md:91`）不动。

- [ ] **Step 3：计数同步（2 处）**

- `README.md:101`（4-Layer 表格第 2 行）：`Collie 12 红线 + 10 问题 + ELEPHANT 的唯一真源` → `Collie 13 红线 + 11 问题 + ELEPHANT 的唯一真源`
- `README.md:129`（目录树注释）：`# 12 红线 + 10 问题 + Reflexion` → `# 13 红线 + 11 问题 + Reflexion`

- [ ] **Step 4：核对使用说明**

`README.md:67` "任务完成的唯一信号是 ..." 该句仍准确（PASS 条件变为 gated-workflow 内部 [collie-final-review]，但外部可见信号不变）。无需修改。

- [ ] **Step 5：Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs: README 同步新流程、Impact Assessment 说明、计数

工作流代码块拆细 gated-workflow 内部节点，凸显
[collie-final-review] 为 pre-merge gate。新增
Impact Assessment 强制说明段落，和 E2E Assessment
段落并列。2 处 12/10 计数同步为 13/11。

Refs: docs/plans/2026-04-20-impact-assessment-and-pre-merge-collie-review-plan.md
EOF
)"
```

---

### Task 6: rubric-red-lines 新增 #13 + Q11；collie-voice 计数同步

**Files:**
- Modify: `skills/review/references/rubric-red-lines.md`
- Modify: `skills/review/references/collie-voice.md`

**改动范围定位（rubric-red-lines.md）**：
- `skills/review/references/rubric-red-lines.md:5-23`（12 Red Lines 表 + Plan-mode / Code-mode focus 行）
- `skills/review/references/rubric-red-lines.md:25-31`（Red line #9 / #12 补充说明）
- `skills/review/references/rubric-red-lines.md:33-46`（10 Review Questions）

**改动范围定位（collie-voice.md）**：
- `skills/review/references/collie-voice.md:3`（`Collie's review style applied to 12 red lines and 10 questions`）

- [ ] **Step 1：rubric-red-lines.md 新增 Red line #13 行**

在 `skills/review/references/rubric-red-lines.md:20`（`| 12 | New pitfall not distilled into spec | ... |`）之后追加表格行：

```markdown
| 13 | Speculative scope — 加任务未要求的 feature / flexibility / 抽象 / 顺手改无关代码 | "问啥做啥，多一行都是债" | plan + code |
```

- [ ] **Step 2：rubric-red-lines.md 更新 focus 行**

修改 `skills/review/references/rubric-red-lines.md:22-23`：

- `**Plan-mode focus**: #1, #4, #5, #6, #9, #10, #12 are the most common plan-stage traps.` → `**Plan-mode focus**: #1, #4, #5, #6, #9, #10, #12, #13 are the most common plan-stage traps.`
- `**Code-mode focus**: all 12 apply.` → `**Code-mode focus**: all 13 apply.`

- [ ] **Step 3：rubric-red-lines.md 新增 Red line #13 补充说明段**

在 `skills/review/references/rubric-red-lines.md:31`（Red line #12 补充说明段末尾）之后插入：

```markdown

### Red line #13 — 补充说明

**Plan mode 额外含义**：plan 中每个 Task / 子 Step 必须可追溯到 Context 列出的问题。加了 Context 未出现的 feature / flexibility / 抽象 = Red line #13 plan-mode 触发。豁免：与设计决策同类的必要副作用（例如为新 gate 写 prose 指令）。

**Code mode 额外含义**：每行 diff 必须可追溯到 plan 的 Task。顺手改无关代码 / 注释 / 格式 / 未请求的抽象 = Red line #13 code-mode 触发。合法例外：CR 反馈导致的修改需在 commit message 注明 "per CR feedback"。

判断基线来自 Andrej Karpathy CLAUDE.md Principle 2（"Minimum code that solves the problem. Nothing speculative."）+ Principle 3（"Every changed line should trace directly to the user's request."）。
```

- [ ] **Step 4：rubric-red-lines.md 新增 Q11 Surgical scope**

修改 `skills/review/references/rubric-red-lines.md:33`（`## The 10 Review Questions` 标题）→ `## The 11 Review Questions`。

在 Q10 行（`10. **Sycophancy check** — Is this conclusion independent, or does it echo the user's framing?`）之后追加：

```markdown
11. **Surgical scope** — plan mode: plan 内每条 task / 子 Step 是否可追溯到 Context？有无与原问题无关的 scope 扩张？code mode: diff 内每行是否可追溯到 plan task？有无顺手改了不相关代码 / 注释 / 格式？Applies to both plan and code.
```

- [ ] **Step 5：collie-voice.md 计数同步**

修改 `skills/review/references/collie-voice.md:3`：

`Collie's review style applied to 12 red lines and 10 questions.` → `Collie's review style applied to 13 red lines and 11 questions.`

⛔ 本 task 不追加 voice sample，维持 `collie-voice.md` 现有结构不变。计数同步是唯一改动。

- [ ] **Step 6：Commit**

```bash
git add skills/review/references/rubric-red-lines.md skills/review/references/collie-voice.md
git commit -m "$(cat <<'EOF'
feat: rubric 新增 Red line #13 + Q11 — 吸收 Karpathy Principle 2/3

Red line #13 Speculative scope：加任务未要求的 feature /
flexibility / 抽象 / 顺手改无关代码 = BLOCK。
Q11 Surgical scope：每行 diff / plan 条目必须可追溯到任务目标。
更新 Plan-mode focus（追加 #13）和 Code-mode focus（all 13）。
collie-voice.md 计数同步为 13 red lines + 11 questions。

Refs: docs/plans/2026-04-20-impact-assessment-and-pre-merge-collie-review-plan.md
EOF
)"
```

---

## 验证（End-to-End）

本 plan 的整体验证路径：

1. **单元测试**：`cd ~/git/collie-harness && node --test tests/*.test.js` — 期望全绿（hook 逻辑未动）
2. **Plugin 结构验证**：`claude plugin validate ~/git/collie-harness` — 期望 `✔ Validation passed`
3. **入口对应表审计**：`grep -n '/collie-harness' README.md CLAUDE.md` 与 `ls commands/ skills/*/SKILL.md agents/*.md` 对照 — 期望无漂移
4. **文档同步手动核对**：
   - `commands/auto.md` 的 Mandatory Sequence vs `CLAUDE.md` Workflow Sequence vs `README.md` 工作流代码块 → 三者必须一致
   - 新增 Impact Assessment 约束在 3 处均有陈述（auto.md Brainstorming 约束、plan-doc-reviewer、README）
   - **计数一致性审计**：`grep -rn '12 red\|12 红线\|12 hard\|10 question\|10 问题' skills/review skills/gated-workflow CLAUDE.md README.md` 期望返空（除历史 plan 文件 `docs/plans/*.md` 外——这些冻结不更新）
5. **Dogfood（本轮 Execution Preamble）**：
   - 执行 `[collie-final-review]` 时 dispatch `collie-harness:review` Mode=code，观察 Target=worktree diff 能正确解析（因为本轮 [finish] 尚未执行）
   - 手动验证 `[finish]` → worktree 被清理 → auto.md Step ⑥ 跳过的说明在最终回复中出现

如全部通过，输出 `<promise>Collie: SHIP IT</promise>`。
