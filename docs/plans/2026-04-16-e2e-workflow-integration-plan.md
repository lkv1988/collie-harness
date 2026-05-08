<!-- plan-source: /Users/kevin/.claude/plans/resilient-imagining-koala.md -->
<!-- plan-topic: e2e-workflow-integration -->

# E2E Workflow Integration Design

## Context

collie 是一个 Claude Code 插件，驱动用户项目的完整开发工作流。当前工作流在测试方面存在三个缺陷：

1. **E2E 被默认跳过**：gated-workflow Step 5 明确写着"集成测试／E2E：除非用户明确要求，否则可跳过"，导致 agent 几乎从不主动做 e2e 测试
2. **Plan-Todo 未对齐**：gated-workflow Step 1 建立 TodoList 时没有交叉核对机制，plan 中承诺的 task 可能在实施阶段被悄悄遗漏
3. **Reviewer 无法追溯 e2e 承诺**：review rubric 不检查"plan 中说了要做 e2e，最终是否兑现"

本次改动目标：让 e2e 成为工作流的一等公民——在设计阶段评估可行性，在实施阶段执行，在审查阶段验证。

## Problem Statement

用户反馈：
- 希望在设计阶段就考虑目标项目是否有 e2e 基建，若无则推荐建设
- 此次需求的功能应利用 e2e 做集成测试，而不只是通过 mock
- 若确定 e2e 可行，则在执行阶段的 todolist 中必须列出 e2e 测试任务
- 最终 reviewer 应检查 plan 中提到的 e2e 是否真的做了
- plan 中的所有 task 在实施阶段必须有对应的 todolist 条目

## Design Overview

Approach A：扩展现有门禁，不新增独立 gate / red line / review question。在 brainstorming、gated-workflow、review、plan-doc-reviewer 四个节点注入 e2e 相关要求。

### §1 brainstorming 阶段 — E2E Assessment

**改动文件**：`commands/auto.md`（brainstorming 约束传递段）

在 auto.md 传递给 brainstorming/writing-plans 的约束中，新增 E2E Assessment 要求。

#### 1.1 E2E 基建探测

Agent 在目标项目中执行以下探测：

**已知 pattern 扫描**（启发列表，非穷举）：
- Web/Node：`playwright.config.*`、`cypress.config.*`、`cypress/`、`e2e/`、`tests/e2e/`、`__tests__/e2e/`、`*.spec.ts`（Playwright 命名惯例）
- Python：`pytest.ini` / `pyproject.toml` 中的 `[tool.pytest]` + `markers: e2e`、`conftest.py` 中的 e2e fixture、`tests/e2e/`
- Go：`*_integration_test.go`、`testcontainers` 依赖
- 通用：CI 配置（`.github/workflows/`、`.gitlab-ci.yml`）中的 e2e/integration 步骤、`docker-compose.test.yml`、`Makefile` 中的 test target

**开放探索**：除已知 pattern 外，agent 应自行探索：
- README / CONTRIBUTING 中的测试说明
- `package.json` / `Makefile` / `Taskfile.yml` 中的 test 相关命令
- 项目中任何可能的 e2e / 集成测试基建

#### 1.2 项目类型 → E2E 策略映射

| 项目类型 | E2E 含义 | 典型工具 |
|---------|---------|---------|
| Web app | 浏览器级 e2e，模拟用户操作 | Playwright, Cypress |
| API/Backend | HTTP 请求级 e2e，真实数据库 | supertest, httptest, pytest + requests |
| CLI tool | 命令执行级 e2e，验证完整输出 | shell script, bats, node --test |
| Library/SDK | 集成调用级 e2e，真实环境 | 框架自带 test runner + 真实依赖 |
| 纯算法/Utility | 通常无法做 e2e，unit test 足矣 | 不适用 |

#### 1.3 Assessment 输出（写入 plan 的 "E2E Assessment" 章节）

1. **现有基建**：有/无，具体框架和配置文件路径
2. **若无基建 → 建设方案**：推荐框架、配置、须问用户确认
3. **本次需求的 e2e 策略**：哪些 critical path 需要 e2e 覆盖
4. **结论**：`e2e_feasible: true/false`，若 false 须给出理由

E2E Assessment 中"不可行"的合理理由（非穷举）：
- 纯内部算法/数据结构，无外部依赖、无 side effect
- 改动仅限 type definition / interface，无运行时行为
- 项目处于极早期（无 dependency、无入口点），e2e 基建投入产出比过低

### §2 gated-workflow — TodoList + 交叉核对 + Gate 改措辞

**改动文件**：`skills/gated-workflow/SKILL.md`

#### 2a. TodoList 结构模板扩展

在现有 `[test-verify]` 前面增加条件性 e2e 任务槽位：

```
[task0] 归档计划文档
[task N] 实现功能 X [batch-X]
[task N-CR] code review task N [batch-Y, blocked-by: task N]
[e2e-setup] 建立 e2e 基建（条件：plan 标注"需新建 e2e 基建"时创建）
[e2e-verify] 运行 e2e / 集成测试，验证 critical path（条件：plan E2E Assessment 结论为 feasible 时创建）
[test-verify] 运行单元测试，确保 0 失败
[doc-refresh] 对照实现结果核对 README / CLAUDE.md / spec
[finish] finishing-a-development-branch
```

`[e2e-setup]` 和 `[e2e-verify]` 是条件性的：由 plan 的 E2E Assessment 结论驱动。plan 标注 `e2e_feasible: false` 且理由充分时，不创建这两条。

#### 2b. Plan-Todo 交叉核对（Step 1 末尾新增）

在 Step 1 "建立完整 TodoList" 之后，增加交叉核对步骤：

> **交叉核对**：dispatch 一个 haiku subagent，给它 `$ARCHIVE_PATH`（plan 归档路径）和当前 TodoList 快照，让它逐条对比 plan 中的 task 与 TodoList 条目，输出差异报告。
>
> 主 session 收到差异报告后：
> - 遗漏 → 立即补上
> - 有意合并 → 必须给出具体解释（"plan task X 的工作已包含在 [task Y] 中，因为 …"），模糊解释不接受
> - 无差异 → 继续

#### 2c. Step 5 (GATE 5.9) 措辞变更

原文：
> 集成测试／E2E：除非用户明确要求，否则可跳过

改为：
> 集成测试／E2E：按 plan E2E Assessment 的结论执行。plan 确认 `e2e_feasible: true` 的，必须运行且通过；plan 标注 `e2e_feasible: false` 且理由充分的，可跳过。

### §3 Review 机制 — 扩展已有检查项

#### 3a. Review Q5 扩展

**改动文件**：`skills/review/references/rubric-red-lines.md`

现有 Q5：
> Gate omissions — subagent / tdd / parallel / todolist / collie:plan-doc-reviewer — any gate skipped?

扩展为：
> Gate omissions — subagent / tdd / parallel / todolist / e2e (if plan confirmed feasible) / plan-todo alignment / collie:plan-doc-reviewer — any gate skipped?

Code mode 时 Q5 额外检查：
1. **Plan-Todo 对齐**：plan 中的每个 task 是否在 TodoList 中有对应条目（或有记录在案的合理解释）
2. **E2E 承诺兑现**：plan 的 E2E Assessment 若结论为 `e2e_feasible: true`，最终是否有 `[e2e-verify]` / `[e2e-setup]` 任务且执行通过

#### 3b. plan-doc-reviewer 新增检查行

**改动文件**：`agents/plan-doc-reviewer.md`

在 "What to Check" 表格中增加：

| E2E Assessment | 若本次需求涉及用户可见功能或 API 变更，plan 是否包含 E2E Assessment 章节？若评估结论为"可行"，是否有对应的 e2e 测试任务？若结论为"不可行"，理由是否充分（纯算法/无 side effect/极早期项目等）？ |

Block-worthy：
- 涉及用户可见功能但完全没有 E2E Assessment 章节
- E2E Assessment 结论为"可行"但没有对应的测试任务

Do NOT flag：
- 纯内部重构 / 不改变用户可见行为的改动不需要 E2E Assessment
- E2E Assessment 结论为"不可行"且理由合理

### §4 文档同步

**改动文件**：`CLAUDE.md`、`README.md`

- CLAUDE.md "Workflow Sequence"：TodoList 结构模板描述更新，反映 `[e2e-setup]` / `[e2e-verify]` 条件槽位
- CLAUDE.md 或 README 中若有 Step 5 描述的引用，同步更新措辞
- README 工作流章节同步

## E2E 概念说明（供 agent 理解传递给用户）

### E2E vs Unit vs Integration

业内共识（Testing Trophy / Testing Pyramid）：

- **Unit test**：验证单个函数/方法，隔离执行，通常使用 mock。快速、廉价、覆盖面窄。占测试 70-80%。
- **Integration test**：验证多个组件交互，部分使用真实依赖。中等速度、中等覆盖面。占测试 15-20%。
- **E2E test**：验证完整用户路径（UI → API → DB → 返回），使用真实环境。最慢、最贵、覆盖面最广。占测试 5-10%。

关键原则：**E2E 只覆盖 critical user journey**，不覆盖所有路径。其他路径用 unit + integration 覆盖。

### E2E vs Headless

两者不在同一维度：

- **E2E** = 测试的范围（完整用户路径）
- **Headless** = 浏览器的运行模式（无窗口后台运行）

E2E 测试可以用 headless 浏览器跑（CI 环境常见），也可以用 headed 浏览器跑（调试时）。E2E 不一定需要浏览器（CLI 的 e2e = 跑命令；API 的 e2e = 发 HTTP 请求）。

### E2E 可行性决策树

```
项目有用户可见功能或 API？
├─ 否 → e2e_feasible: false（纯算法/utility，unit test 足够）
└─ 是 → 项目已有 e2e 基建？
    ├─ 是 → 使用已有基建，设计本次需求的 e2e test case
    └─ 否 → 推荐建设方案，问用户确认
        ├─ 用户同意 → 在 plan 中加 [e2e-setup] 任务
        └─ 用户拒绝 → 记录决策，unit/integration test 替代
```

## References

- [Microsoft Engineering Playbook — E2E Testing](https://microsoft.github.io/code-with-engineering-playbook/automated-testing/e2e-testing/)
- [Kent C. Dodds — Testing Trophy](https://kentcdodds.com/blog/static-vs-unit-vs-integration-vs-e2e-tests)
- [Bunnyshell — E2E Best Practices 2026](https://www.bunnyshell.com/blog/best-practices-for-end-to-end-testing-in-2025/)

## Files to Modify

| # | File | Change |
|---|------|--------|
| 1 | `commands/auto.md` | brainstorming 约束增加 E2E Assessment 要求 |
| 2 | `skills/gated-workflow/SKILL.md` | (a) TodoList 模板增加条件性 e2e 槽位 (b) Step 1 增加 haiku subagent 交叉核对 (c) Step 5 改措辞 |
| 3 | `skills/review/references/rubric-red-lines.md` | Q5 扩展覆盖 e2e + plan-todo 对齐 |
| 4 | `agents/plan-doc-reviewer.md` | "What to Check" 增加 E2E Assessment 行 |
| 5 | `CLAUDE.md` | 同步 Workflow Sequence + TodoList 描述 |
| 6 | `README.md` | 同步工作流描述（如有） |

## What NOT Changed

- 不新增独立 gate / red line / review question
- 不改 hooks（e2e 是内容层面要求，不是流程控制）
- 不改 `skills/review/SKILL.md` 本体（只改 references/rubric-red-lines.md）

---

# E2E Workflow Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 e2e 测试成为 collie 工作流的一等公民——在设计阶段评估可行性，在实施阶段执行，在审查阶段验证。同时修复 plan-todo 对齐缺失问题。

**Architecture:** 扩展现有 4 个节点（auto.md、gated-workflow、review rubric、plan-doc-reviewer）的 markdown 指令文本，不新增 gate / red line / review question。

**Tech Stack:** Markdown（纯指令文本编辑，无 JS 代码变更）

---

### Task 1: auto.md — 添加 E2E Assessment 约束

**Files:**
- Modify: `commands/auto.md:107-118`

- [ ] **Step 1: 在 brainstorming 约束段末尾添加 E2E Assessment 要求**

在 `commands/auto.md` 的 brainstorming constraints 段（当前以 `Do NOT call writing-plans separately` 结尾）后面，插入以下内容：

```markdown
>     - **E2E Assessment（必做）**：brainstorming 的设计阶段必须包含 E2E 可行性评估，结论写入 plan 的 "E2E Assessment" 章节：
>       1. **探测目标项目 e2e 基建**：
>          - 已知 pattern 扫描（启发列表）：`playwright.config.*`、`cypress.config.*`、`cypress/`、`e2e/`、`tests/e2e/`、`__tests__/e2e/`、`*.spec.ts`、`pytest.ini` + `markers: e2e`、`conftest.py` e2e fixture、`*_integration_test.go`、`testcontainers`、CI 配置中的 e2e 步骤、`docker-compose.test.yml`
>          - 开放探索：README/CONTRIBUTING 测试说明、`package.json`/`Makefile`/`Taskfile.yml` 中的 test 命令、其他可能的 e2e 基建
>       2. **项目类型 → e2e 策略映射**：Web app → 浏览器 e2e（Playwright）；API → HTTP 级 e2e；CLI → 命令执行级 e2e；Library → 集成调用级 e2e；纯算法 → 通常不需要 e2e
>       3. **Assessment 输出**：(a) 现有基建有/无及具体内容 (b) 若无 → 推荐建设方案，须问用户确认 (c) 本次需求的 e2e 策略：哪些 critical path 需覆盖 (d) 结论 `e2e_feasible: true/false`，false 须给出理由
>       4. **E2E ≠ 浏览器测试**：e2e 是测试范围（完整用户路径），headless 是浏览器运行模式，两者不冲突。不是所有 e2e 都需要浏览器。
```

插入位置：在 `>   - Do NOT call writing-plans separately — brainstorming triggers it at its final step.` 这行之后、`> <HARD-GATE>` 之前。

- [ ] **Step 2: 验证格式正确**

Read `commands/auto.md` 确认新增内容与现有缩进、引用格式一致。

- [ ] **Step 3: Commit**

```bash
git add commands/auto.md
git commit -m "feat: auto.md brainstorming 约束增加 E2E Assessment 要求

Refs: docs/plans/<实际 $ARCHIVE_PATH 文件名>"
```

（注：所有 commit 的 `Refs:` 行均使用 gated-workflow Step 2 产生的 `$ARCHIVE_PATH` 文件名，格式为 `docs/plans/2026-04-16-e2e-workflow-integration-plan.md`。下同。）

---

### Task 2: gated-workflow — TodoList 模板 + 交叉核对 + Step 5

**Files:**
- Modify: `skills/gated-workflow/SKILL.md:44-68` (TodoList 模板)
- Modify: `skills/gated-workflow/SKILL.md:70` (Step 1 末尾新增交叉核对)
- Modify: `skills/gated-workflow/SKILL.md:174-181` (Step 5 措辞)

- [ ] **Step 1: 扩展 TodoList 结构模板**

在 `skills/gated-workflow/SKILL.md` 的 TodoList 结构模板中，在 `[test-verify]` 行前插入两条条件性 e2e 任务：

当前（line 52-53）：
```
- `[test-verify]` 运行单元测试，确保 0 失败
- `[doc-refresh]` 对照实现结果核对 README / CLAUDE.md / spec，补更新遗漏
```

改为：
```
- `[e2e-setup]` 建立 e2e 基建（条件：仅当 plan E2E Assessment 标注"需新建 e2e 基建"时创建）
- `[e2e-verify]` 运行 e2e / 集成测试，验证 critical path（条件：仅当 plan E2E Assessment 结论为 `e2e_feasible: true` 时创建）
- `[test-verify]` 运行单元测试，确保 0 失败
- `[doc-refresh]` 对照实现结果核对 README / CLAUDE.md / spec，补更新遗漏
```

同步更新示例块（line 57-68），在 `[test-verify]` 前加上：
```
[e2e-setup] 建立 e2e 基建（条件性）
[e2e-verify] 运行 e2e / 集成测试（条件性）
```

- [ ] **Step 2: Step 1 末尾添加交叉核对段落**

在 Step 1 的最后一行（`每完成一条立即标记，不得批量滞后更新。TodoList 是实施阶段的唯一进度看板。`）之后、`---` 分割线之前，插入：

````markdown
### Plan-Todo 交叉核对（建 list 后立即执行）

⛔ **TodoList 建完后必须执行交叉核对，不得跳过。**

Dispatch 一个 haiku subagent，prompt 自包含：

```
Plan archive: <$ARCHIVE_PATH>
TodoList snapshot: <当前所有 TaskCreate 条目的 subject 列表>

请逐条对比 plan 中的每个 task 与 TodoList 条目，输出差异报告：
- 匹配：plan task X → [task Y]
- 遗漏：plan task X → 无对应 TodoList 条目
- 多余：[task Z] → plan 中无对应 task（可接受，如 [task0]、[test-verify] 等流程性任务）

只报差异，无差异则输出"全部匹配"。
```

主 session 收到差异报告后：
- 遗漏 → 立即用 TaskCreate 补上
- 有意合并 → 必须给出具体解释（"plan task X 的工作已包含在 [task Y] 中，因为 …"），模糊解释不接受
- 无差异 → 继续
````

- [ ] **Step 3: 修改 Step 5 (GATE 5.9) 措辞**

在 `skills/gated-workflow/SKILL.md` 的 Step 5 段落中，替换：

当前（line 179）：
```
- 集成测试／E2E：除非用户明确要求，否则可跳过
```

改为：
```
- 集成测试／E2E：按 plan E2E Assessment 的结论执行。plan 确认 `e2e_feasible: true` 的，必须运行且通过；plan 标注 `e2e_feasible: false` 且理由充分的，可跳过
```

- [ ] **Step 4: 验证格式一致性**

Read 修改后的 `skills/gated-workflow/SKILL.md`，确认 TodoList 模板、交叉核对段落、Step 5 的格式与周围内容一致。

- [ ] **Step 5: Commit**

```bash
git add skills/gated-workflow/SKILL.md
git commit -m "feat: gated-workflow 增加 e2e 条件任务槽位 + plan-todo 交叉核对 + Step 5 措辞

TodoList 模板新增 [e2e-setup] / [e2e-verify] 条件槽位。
Step 1 末尾新增 haiku subagent 交叉核对步骤。
Step 5 从"可跳过"改为"按 plan 结论执行"。

Refs: docs/plans/<实际 $ARCHIVE_PATH 文件名>"
```

---

### Task 3: review rubric — Q5 扩展

**Files:**
- Modify: `skills/review/references/rubric-red-lines.md:41`

- [ ] **Step 1: 扩展 Q5**

在 `skills/review/references/rubric-red-lines.md` 中，替换 Q5：

当前（line 41）：
```
5. **Gate omissions** — subagent / tdd / parallel / todolist / collie:plan-doc-reviewer — any gate skipped?
```

改为：
```
5. **Gate omissions** — subagent / tdd / parallel / todolist / e2e (if plan confirmed feasible) / plan-todo alignment / collie:plan-doc-reviewer — any gate skipped? Code mode 额外检查：(a) plan 中每个 task 是否在 TodoList 中有对应条目（或有记录在案的合理解释）；(b) plan E2E Assessment 若结论为 `e2e_feasible: true`，最终是否有 `[e2e-verify]` 任务且执行通过。
```

- [ ] **Step 2: 验证格式**

Read 修改后的文件，确认 Q5 格式与其他 question 一致。

- [ ] **Step 3: Commit**

```bash
git add skills/review/references/rubric-red-lines.md
git commit -m "feat: review Q5 扩展覆盖 e2e 承诺兑现 + plan-todo 对齐检查

Refs: docs/plans/<实际 $ARCHIVE_PATH 文件名>"
```

---

### Task 4: plan-doc-reviewer — 新增 E2E Assessment 检查

**Files:**
- Modify: `agents/plan-doc-reviewer.md:22-29` (What to Check 表格)
- Modify: `agents/plan-doc-reviewer.md:35-43` (Block-worthy 列表)
- Modify: `agents/plan-doc-reviewer.md:45-51` (Do NOT flag 列表)

- [ ] **Step 1: "What to Check" 表格新增 E2E Assessment 行**

在 `agents/plan-doc-reviewer.md` 的 "What to Check" 表格末尾（`Spec Consultation` 行之后），追加：

```markdown
| E2E Assessment | 若本次需求涉及用户可见功能或 API 变更，plan 是否包含 E2E Assessment 章节？若评估结论为"可行"，是否有对应的 e2e 测试任务？若结论为"不可行"，理由是否充分？ |
```

- [ ] **Step 2: Block-worthy 列表新增 E2E 项**

在 Block-worthy 列表（`Plan 中存在 Commit step` 行之后），追加：

```markdown
- 涉及用户可见功能或 API 变更但完全没有 E2E Assessment 章节
- E2E Assessment 结论为"可行"但计划中没有对应的 e2e 测试任务
```

- [ ] **Step 3: Do NOT flag 列表新增 E2E 豁免**

在 Do NOT flag 列表末尾追加：

```markdown
- 纯内部重构 / 不改变用户可见行为的改动不需要 E2E Assessment
- E2E Assessment 结论为"不可行"且理由合理（纯算法/无 side effect/极早期项目等）
```

- [ ] **Step 4: Commit**

```bash
git add agents/plan-doc-reviewer.md
git commit -m "feat: plan-doc-reviewer 新增 E2E Assessment 检查行

Refs: docs/plans/<实际 $ARCHIVE_PATH 文件名>"
```

---

### Task 5: CLAUDE.md — 同步更新

**Files:**
- Modify: `CLAUDE.md:81-88` (Key Design Constraints)

- [ ] **Step 1: Key Design Constraints 新增 E2E enforcement bullet**

在 `CLAUDE.md` 的 "Key Design Constraints" 段落中，在 `Doc maintenance enforcement` 行之后追加：

```markdown
- **E2E enforcement**：brainstorming 阶段必须完成 E2E Assessment（探测基建 + 可行性结论）；gated-workflow TodoList 根据 Assessment 结论创建条件性 `[e2e-setup]` / `[e2e-verify]` 任务；Step 1 建 list 后 haiku subagent 交叉核对 plan-todo 对齐；`collie:review` Q5 + `plan-doc-reviewer` E2E Assessment 行共同强制。
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md 新增 E2E enforcement 约束描述

Refs: docs/plans/<实际 $ARCHIVE_PATH 文件名>"
```

---

### Task 6: README.md — 同步更新

**Files:**
- Modify: `README.md:89`

- [ ] **Step 1: 工作流段落追加 E2E 说明**

在 `README.md` 的工作流段落中，在 doc maintenance 段落（line 89）之后追加：

```markdown

brainstorming 阶段强制完成 E2E Assessment：探测目标项目 e2e 基建，评估可行性，若无基建则推荐建设方案。gated-workflow 根据 Assessment 结论条件性创建 `[e2e-setup]` / `[e2e-verify]` 任务，并通过 haiku subagent 交叉核对 plan-todo 对齐。`collie:review` Q5 在 code mode 时验证 e2e 承诺兑现。
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README 新增 E2E Assessment 工作流说明

Refs: docs/plans/<实际 $ARCHIVE_PATH 文件名>"
```

---

## Verification

所有 task 完成后运行：

```bash
# 1. 单元测试不受影响（本次无 JS 代码变更）
node --test tests/*.test.js

# 2. Plugin 结构验证
claude plugin validate ~/git/collie

# 3. 文档一致性检查
grep -n 'e2e' commands/auto.md skills/gated-workflow/SKILL.md skills/review/references/rubric-red-lines.md agents/plan-doc-reviewer.md CLAUDE.md README.md
```
