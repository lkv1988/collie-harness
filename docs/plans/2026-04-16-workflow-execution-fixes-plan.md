<!-- plan-source: /Users/kevin/.claude/plans/purring-sniffing-teacup.md -->
<!-- plan-topic: workflow-execution-fixes -->
<!-- plan-executor: collie-harness:gated-workflow -->

# Workflow Execution Fixes — Plan

> **For agentic workers:** MUST invoke Skill('collie-harness:gated-workflow') to implement this plan.

## Research & Reuse Findings

**Internal specs**: None exist (`docs/*-spec.md` and `docs/superpowers/specs/` are empty).

**Confirmed root causes** (from pre-planmode investigation):

1. **Plan header 指向错误 executor**: `writing-plans` SKILL.md 的 Plan Document Header 模板写 `superpowers:subagent-driven-development` / `superpowers:executing-plans`。auto.md 的 runtime prompt 说 gated-workflow，但 /clear 后 runtime prompt 消失，plan 文件里的 header 成为唯一执行入口指令。最近的 plan 文件 (`2026-04-16-e2e-workflow-integration-plan.md:212`) 确认此 header 确实写入了文件。

2. **plan 无 DAG 信息**: `writing-plans` 和 `auto.md` 均未要求 plan 包含 task 依赖/并行批次信息。`gated-workflow` Step 1 让 agent 自行推断依赖——重复劳动且可能偏差。

3. **gated-workflow Step 1 不读 plan DAG**: 直接说"识别 task 间的依赖关系"，不优先检查 plan 里是否已有。

4. **CR fix 无 subagent 强制**: `gated-workflow` Step 4 的 CR 后处理只说"遵循 receiving-code-review"，该 skill 的 Step 6 是"IMPLEMENT: One item at a time"——默认让 receiver 直接实现。Step 3 的 ⛔ "所有实现工作必须卸载给 subagent" 没有覆盖到 CR fix 场景。

**新发现的冲突**:

5. **writing-plans Plan Review Loop 与 collie-harness 双审重复**: `writing-plans` 内置 `plan-document-reviewer` per-chunk 审查，collie-harness 在 auto.md Step ③ 另有 `plan-doc-reviewer` + `collie-harness:review` 双审。两轮审查用不同 rubric，但 agent 可能困惑。

6. **subagent-driven-development 禁止并行 dispatch vs gated-workflow 要求批次并行**: `subagent-driven-development` Red Flags 明确写 "Dispatch multiple implementation subagents in parallel (conflicts)"。如果 plan header 指向此 skill，agent 会退化为串行执行，与 gated-workflow 的批次并行设计直接矛盾。

**Hook 基建** (可复用):
- `post-writing-plans-reviewer.js` 已在 ExitPlanMode 时验证 `plan-source` + `plan-topic` metadata。加 `plan-executor` 验证是自然扩展，~10 行代码。
- `post-exitplan-gated-hint.js` 已写 `phase.json` breadcrumb 并在双审通过后提示 gated-workflow。

**外部方案**: 无可复用的开源方案。这是 collie-harness 自身 prompt 工程 + hook 逻辑的修正，纯内部改动。

---

## Design Spec: Workflow Execution Fixes

### Problem Statement

collie-harness 工作流在"规划→执行"衔接处有 3 个核心缺陷 + 3 个 superpowers 兼容性问题 + 1 个上下文浪费：

| # | 问题 | 根因 | 影响 |
|---|------|------|------|
| P1 | plan 文件 header 指向错误 executor | writing-plans 模板硬编码 subagent-driven-development | /clear 后 agent 用错 skill |
| P2a | plan 无 task DAG | writing-plans 和 auto.md 均未要求 | agent 自行推断依赖可能偏差 |
| P2b | gated-workflow 不读 plan DAG | Step 1 直接"识别依赖" | 即使 plan 有 DAG 也被忽略 |
| P3 | CR fix 无 subagent 强制 | Step 4 只说"遵循 receiving-code-review" | 主 session 直接改代码污染上下文 |
| P4 | writing-plans 内置 review 与 collie 双审重复 | 两套 review 流程叠加 | agent 困惑 |
| P5 | writing-plans execution handoff 指向错误 skill | 模板硬编码 subagent-driven-development | 执行入口混淆 |
| P6 | 主 agent 重读 plan 文件 | Step 1 用 Read 工具读 plan 获取行号 | 主 session 上下文膨胀 |
| P7 | design doc 和 plan 位置规则不明确 | auto.md 只覆写了 plan 位置，未覆写 design doc 位置 | agent 可能尝试写 docs/superpowers/specs/（planmode 下被 block 或位置错误） |

### Approach

不修改上游 superpowers skills。通过 auto.md 注入约束覆写 superpowers 默认行为，通过 gated-workflow 文本修正流程缺陷，通过 hook 验证 metadata 完整性。

### Fix Map

| Fix | 改哪里 | 改什么 |
|-----|--------|--------|
| F1a | `commands/auto.md` | 新增约束：plan 第三行 metadata `<!-- plan-executor: collie-harness:gated-workflow -->` |
| F1b | `commands/auto.md` | 新增约束：prose header 覆写为 `MUST invoke Skill('collie-harness:gated-workflow')` |
| F1c | `hooks/post-writing-plans-reviewer.js` | ExitPlanMode handler 验证第三行 plan-executor metadata |
| F2a | `commands/auto.md` | 新增约束：plan 须包含 Task Execution DAG 表（batch + depends-on + key-files） |
| F2b | `skills/gated-workflow/SKILL.md` Step 1 | 重构：dispatch haiku plan-reader subagent（读 plan + 提取 DAG + 行号 + 文件冲突检查），主 session 不再直接读 plan |
| F3 | `skills/gated-workflow/SKILL.md` Step 4 | 新增 ⛔：CR fix 必须 dispatch 新 subagent，禁止主 session 写代码 |
| F4 | `commands/auto.md` | 新增约束：跳过 writing-plans 内置 Plan Review Loop |
| F5 | `commands/auto.md` | 新增约束：跳过 writing-plans Execution Handoff |
| F6 | `skills/gated-workflow/SKILL.md` Step 3 | 条件分支：batch ≥ 2 用 dispatching-parallel-agents；batch = 1 直接 dispatch 单 subagent |
| F7 | `commands/auto.md` | 新增约束：design doc + plan 合并写入 planmode plan file（不分别写入 specs/ 和 plans/） |

### Files Changed

| File | Type | Est. diff |
|------|------|-----------|
| `commands/auto.md` | Markdown | +35 行（5 个约束段落） |
| `skills/gated-workflow/SKILL.md` | Markdown | +40 行改 / -15 行删（Step 1 重构 + Step 3 条件 + Step 4 ⛔） |
| `hooks/post-writing-plans-reviewer.js` | JS | +10 行（metadata 验证） |
| `tests/post-writing-plans-reviewer.test.js` | JS | +30 行（2 新 test case + 2 已有 test 更新） |
| `CLAUDE.md` | Markdown | ~2 行改（hook 描述更新） |
| `README.md` | Markdown | ~2 行改（hook 描述更新） |

### Detailed Design

#### F1: Plan Executor 三层保障

**Layer 1 — Metadata**（auto.md 新增约束）

plan 文件前三行：
```
<!-- plan-source: /absolute/path/to/plan/file.md -->
<!-- plan-topic: my-feature-slug -->
<!-- plan-executor: collie-harness:gated-workflow -->
```

**Layer 2 — Prose Header**（auto.md 新增约束）

writing-plans 的默认 plan header 中 "For agentic workers" 行替换为：
```
> **For agentic workers:** MUST invoke Skill('collie-harness:gated-workflow') to implement this plan.
```

仅说明使用什么，不加负面指令（不写"do not use ..."——后续流程中可能合理使用其他 superpowers skills）。

**Layer 3 — Hook 验证**（post-writing-plans-reviewer.js）

在 ExitPlanMode handler 中，继续检查 plan-source、plan-topic 之后，追加检查第三行以 `<!-- plan-executor:` 开头。缺失时加入 missing 列表，触发 block。

#### F2a: DAG 表要求

auto.md brainstorming constraints 新增要求 writing-plans 在 plan 文档的 task 列表前写入：

```markdown
## Task Execution DAG
| Task | Batch | Depends on | Key files |
|------|-------|------------|-----------|
| task1 | 1 | — | src/foo.js, src/bar.js |
| task2 | 1 | — | src/baz.js |
| task3 | 2 | task1, task2 | src/foo.js, tests/foo.test.js |
```

- `Key files`: 该 task 会创建或修改的文件（用于 F2b 文件冲突检查）
- plan author（writing-plans 阶段）负责产出此表
- DAG 表缺失不阻止 gated-workflow 执行，但 plan-reader subagent 会在报告中标记 warn

#### F2b: Plan-Reader Subagent（gated-workflow Step 1 重构）

**现状**：主 agent 用 Read 工具读 plan，自行推断依赖，手动记录行号。
**改后**：dispatch 一个 haiku subagent 做四件事：

```
输入：plan archive 绝对路径
输出：JSON 结构
{
  "tasks": [
    {
      "id": "task1",
      "subject": "...",
      "batch": 1,
      "depends_on": [],
      "key_files": ["src/foo.js"],
      "plan_lines": { "start": 45, "end": 103 }
    },
    ...
  ],
  "conflicts": [
    { "batch": 1, "tasks": ["task1", "task3"], "shared_files": ["src/foo.js"] }
  ],
  "warnings": ["DAG table missing — derived from task descriptions"]
}
```

主 session 拿到 JSON 后：
1. 用 `tasks` 数组创建 TaskCreate（含 batch 和 blocked-by 信息）
2. 若 `conflicts` 非空 → 评估是否需要重新分 batch（或确认 agent 承诺不改同一区域）
3. 若 `warnings` 非空 → 记录，继续执行

**主 session 不再调用 Read 读 plan 文件**，零 plan 内容进入主 context。

#### F3: CR Fix 必须 Dispatch Subagent

gated-workflow Step 4 末尾新增：

```
⛔ **CR 发现需要修复的问题时，禁止主 session 直接写代码修复。**
  即使只改一行——了解"如何改"本身需要读取源码文件，会污染主 session 上下文。

  必须 dispatch 新的修复 subagent，传入：
  - CR issue 清单（引用 CR 原文）
  - worktree 绝对路径
  - $ARCHIVE_PATH（plan 归档路径，按需参考）
  - 受影响的文件路径（CR 报告中通常已含）

  修复 subagent 完成后，dispatch 新的 CR subagent 验证修复结果。
  修复→验证循环直到 CR 通过或主 session 判断需要升级处理。
```

#### F4 + F5: Superpowers 兼容性约束

auto.md brainstorming constraints 新增两段：

**F4 — 跳过 writing-plans Plan Review Loop**：
```
writing-plans 内置的 Plan Review Loop（plan-document-reviewer per-chunk 审查）在 collie-harness 中跳过。
collie-harness 在 Step ③ 有更严格的双 reviewer 审查（plan-doc-reviewer + collie:review），不重复运行。
```

**F5 — 跳过 writing-plans Execution Handoff**：
```
writing-plans 的 Execution Handoff（"Ready to execute?" + skill 推荐）在 collie-harness 中跳过。
collie-harness 通过 auto.md → gated-workflow 控制执行流程。
Plan 写完后直接回到 auto.md Step ③ 的双 review。
```

#### F7: Design Doc + Plan 合并规则

auto.md brainstorming constraints 新增约束，与 F4/F5 放在同一段落：

```
**Design doc + Plan = 单一文件**：
brainstorming 的 design doc（通常在 brainstorming Step 6 写入 docs/superpowers/specs/）
和 writing-plans 的 implementation plan 都写入 planmode plan file，不分别写入两个位置。
文件结构：design spec 在前，implementation plan 在后，用 `---` 分隔。
```

这使已有的 de facto convention（如 `2026-04-16-e2e-workflow-integration-plan.md` 就是 design + plan 合并）成为 explicit rule。

#### F6: 条件 Dispatch 逻辑

gated-workflow Step 3 修改：

**现状**：`调用 superpowers:dispatching-parallel-agents，一次性 dispatch 整批`
**改后**：
```
按批次逐批执行：
1. 找出当前 batch 中所有 pending 且 blocked-by 已全部完成的 task
2. 根据 batch 大小选择 dispatch 方式：
   - batch 内 task ≥ 2：调用 superpowers:dispatching-parallel-agents，一次性并发 dispatch
   - batch 内 task = 1：直接 dispatch 单个 subagent（Agent tool），无需额外 skill
3. 等本批全部完成后，进入下一批
```

### What NOT Changed

- 不修改上游 superpowers skills（brainstorming / writing-plans / subagent-driven-development / executing-plans）
- 不新增 hook 文件
- 不改 `post-approved-exitplan-hint.js` / `post-exitplan-gated-hint.js`
- 不新增 red-line / review question
- brainstorming 的 design doc 位置由 F7 覆写到 planmode plan file（不再写入 `docs/superpowers/specs/`）

### Testing

1. `node --test tests/*.test.js` — 现有测试全部通过
2. `tests/post-writing-plans-reviewer.test.js` 新增：plan-executor metadata 缺失时应 block ExitPlanMode
3. E2E 验收：用 `/collie-harness:auto` 跑一个小任务，检查生成的 plan 文件包含三条 metadata + 正确的 prose header

---

# Workflow Execution Fixes Implementation Plan

> **For agentic workers:** MUST invoke Skill('collie-harness:gated-workflow') to implement this plan.

**Goal:** 修复 collie-harness 工作流在"规划→执行"衔接处的 7 个缺陷，确保 /clear 后 agent 使用正确的执行 skill、plan 包含 task DAG、CR fix 不污染主 session context。

**Architecture:** 改 3 个文件 + 1 个测试文件。auto.md 注入 superpowers 覆写约束，gated-workflow 重构 Step 1/3/4，hook 加 metadata 验证。

**Tech Stack:** Markdown (prompt text) + Node.js (hook + test)

---

## Task Execution DAG

| Task | Batch | Depends on | Key files |
|------|-------|------------|-----------|
| task1 | 1 | — | commands/auto.md |
| task2 | 1 | — | skills/gated-workflow/SKILL.md |
| task3 | 1 | — | hooks/post-writing-plans-reviewer.js, tests/post-writing-plans-reviewer.test.js |
| task5 | 2 | task1, task2, task3 | CLAUDE.md, README.md |

---

### Task 1: auto.md — 新增 superpowers 覆写约束 (F1a, F1b, F2a, F4, F5, F7)

**Files:**
- Modify: `commands/auto.md:109-118`（brainstorming constraints 段）

**Acceptance criteria:**
- plan 文件须有三条 metadata（plan-source, plan-topic, plan-executor）
- plan header "For agentic workers" 行指向 collie-harness:gated-workflow（正面指令，不加负面语句）
- plan 须包含 Task Execution DAG 表
- 明确跳过 writing-plans 内置 Plan Review Loop
- 明确跳过 writing-plans Execution Handoff
- design doc + plan 合并写入 planmode plan file

- [ ] **Step 1: 在 metadata 约束段落加入第三条 metadata**

在 `commands/auto.md` 的 brainstorming constraints（当前 line 111-117 的 metadata 段）中：
- 将 "two metadata lines" 改为 "three metadata lines"
- 在 `<!-- plan-topic: ... -->` 后加 `<!-- plan-executor: collie-harness:gated-workflow -->`
- 更新 "These two lines are the only mechanism" → "These three lines are the only mechanism"

- [ ] **Step 2: 新增 plan header 覆写约束**

在 metadata 约束段落之后（line 117 附近），插入：
```
>     - **Plan header override**: writing-plans 的默认 "For agentic workers" 行替换为：
>       ```
>       > **For agentic workers:** MUST invoke Skill('collie-harness:gated-workflow') to implement this plan.
>       ```
```

- [ ] **Step 3: 新增 DAG 表要求**

在 plan header override 之后，插入：
```
>     - **Task Execution DAG**: plan 的 task 列表前须包含 DAG 表，格式：
>       ```markdown
>       ## Task Execution DAG
>       | Task | Batch | Depends on | Key files |
>       |------|-------|------------|-----------|
>       ```
>       `Key files` 列出该 task 创建/修改的文件。gated-workflow 的 plan-reader subagent 依赖此表。
```

- [ ] **Step 4: 新增 superpowers 兼容性约束（F4 + F5 + F7）**

在 E2E Assessment 段落之前，或 brainstorming constraints 末尾，插入三段：
```
>     - **Skip writing-plans Plan Review Loop**: writing-plans 内置的 plan-document-reviewer per-chunk 审查在 collie-harness 中跳过。collie-harness 在 Step ③ 有更严格的双 reviewer 审查，不重复运行。
>     - **Skip writing-plans Execution Handoff**: writing-plans 的 "Ready to execute?" + skill 推荐在 collie-harness 中跳过。Plan 写完后直接回到 auto.md Step ③ 的双 review。
>     - **Design doc + Plan = 单一文件**: brainstorming 的 design doc 和 writing-plans 的 implementation plan 都写入 planmode plan file，不分别写入 `docs/superpowers/specs/` 或 `docs/superpowers/plans/`。文件结构：design spec 在前，implementation plan 在后，用 `---` 分隔。
```

- [ ] **Step 5: 验证**

Read commands/auto.md 全文，确认：
1. metadata 段落列出三条 metadata
2. plan header override 存在且措辞正面
3. DAG 表要求存在
4. 三条 superpowers 兼容性约束存在
5. 不与现有 E2E Assessment 段落冲突

---

### Task 2: gated-workflow/SKILL.md — Step 1/2/3/4 改造 (F2b, F3, F6)

**Files:**
- Modify: `skills/gated-workflow/SKILL.md:20-70`（Step 1）
- Modify: `skills/gated-workflow/SKILL.md:101-108`（Step 2 metadata ref）
- Modify: `skills/gated-workflow/SKILL.md:132-141`（Step 3 dispatch）
- Modify: `skills/gated-workflow/SKILL.md:190-197`（Step 4 CR fix）

**Acceptance criteria:**
- Step 1 不再让主 session 用 Read 工具读 plan，改为 dispatch haiku plan-reader subagent
- Step 2 的 metadata 引用从"前两行"改为"前三行"
- Step 3 按 batch 大小选择 dispatch 方式（≥ 2 并行，= 1 串行）
- Step 4 加 ⛔ 规则：CR fix 必须 dispatch 新 subagent

- [ ] **Step 1: 重构 Step 1 — 替换直接 Read 为 plan-reader subagent**

将 Step 1 的 "行号记录" 和 "依赖分析" 子段替换为 plan-reader subagent 设计：

```markdown
### Plan-Reader Subagent（替代主 session 直接 Read）

从 session context 中提取 plan-source metadata → `$PLAN_SOURCE`。然后 dispatch 一个 haiku subagent（不在主 session 读 plan 文件）：

**输入**：`$PLAN_SOURCE` 文件绝对路径
**任务**：Read plan 文件全文，提取：
1. Task Execution DAG 表（若存在）→ 直接用作 batch 分组和依赖基础
2. 若 DAG 表缺失 → 从 task 描述中推断依赖，在 warnings 中标记
3. 每个 task 的行号范围（`start`/`end` line numbers）
4. 文件冲突检查：同 batch 内各 task 的 Key files，若有重叠 → 加入 conflicts

**输出格式**（JSON）：
```json
{
  "plan_source": "/path/to/plan.md",
  "plan_topic": "my-feature",
  "tasks": [
    { "id": "task1", "subject": "...", "batch": 1, "depends_on": [], "key_files": ["src/foo.js"], "plan_lines": { "start": 45, "end": 103 } }
  ],
  "conflicts": [
    { "batch": 1, "tasks": ["task1", "task3"], "shared_files": ["src/foo.js"] }
  ],
  "warnings": []
}
```

主 session 拿到 JSON 后：
1. 用 `tasks` 数组创建 TaskCreate（含 batch 和 blocked-by 信息）
2. 若 `conflicts` 非空 → 评估：人工确认分 batch 或确认 task 不改同一区域
3. 若 `warnings` 非空 → 记录，继续
```

保留 TodoList 结构模板部分不变。

- [ ] **Step 2: 更新 Step 2 metadata 引用**

将 `skills/gated-workflow/SKILL.md` Step 2 中：
- "plan 文件的前两行嵌有元数据" → "plan 文件的前三行嵌有元数据"
- 在 metadata 示例 block 中加第三行 `<!-- plan-executor: collie-harness:gated-workflow -->`
- "从 session context 的 plan 内容中提取前两行" → "从 session context 的 plan 内容中提取前三行"

- [ ] **Step 3: 修改 Step 3 dispatch 逻辑（F6）**

将 Step 3 的 dispatch 段落从：
```
⛔ **同一批次...必须在一次 dispatching-parallel-agents 调用中并发 dispatch...**
按批次逐批执行：
1. 找出当前 batch 中所有 pending 且 [blocked-by] 已全部完成的 task
2. 调用 superpowers:dispatching-parallel-agents，一次性 dispatch 整批
3. 等本批全部完成后，进入下一批
```

改为：
```
⛔ **所有实现工作必须卸载给 subagent，主 session 只做协调和审查，不在主 session 里写代码。**

按批次逐批执行：
1. 找出当前 batch 中所有 pending 且 `[blocked-by]` 已全部完成的 task
2. 根据 batch 大小选择 dispatch 方式：
   - **batch 内 task ≥ 2**：调用 `superpowers:dispatching-parallel-agents`，一次性并发 dispatch 整批
   - **batch 内 task = 1**：直接 dispatch 单个 subagent（Agent tool），无需额外 skill
3. 等本批全部完成后，进入下一批
```

- [ ] **Step 4: 新增 Step 4 CR fix subagent 强制（F3）**

在 Step 4 的 `[task N-CR]` 段末尾（"收到 CR 反馈后，主 session 遵循 receiving-code-review" 之后），追加：

```markdown
**CR 发现需修复的问题时**（receiving-code-review 确认修复有效后）：

⛔ **禁止主 session 直接写代码修复。** 即使只改一行——了解"如何改"本身需要读取源码文件，会污染主 session 上下文。

必须 dispatch 新的修复 subagent，传入：
- CR issue 清单（引用 CR 原文）
- worktree 绝对路径
- `$ARCHIVE_PATH`（plan 归档路径，按需参考）
- 受影响的文件路径（CR 报告中通常已含）

修复 subagent 完成后，dispatch 新的 CR subagent 验证修复结果。
修复→验证循环直到 CR 通过或主 session 判断需要升级处理。
```

- [ ] **Step 5: 验证**

Read skills/gated-workflow/SKILL.md 全文，确认：
1. Step 1 不含 "阅读计划文档" 或 "Read 工具" 的直接读取指令
2. Step 1 包含 plan-reader subagent 的完整设计
3. Step 2 引用三条 metadata
4. Step 3 有条件分支（≥ 2 vs = 1）
5. Step 4 有 ⛔ CR fix subagent 强制
6. 整体内部一致性检查

---

### Task 3: hook + tests — plan-executor metadata 验证 (F1c)

**Files:**
- Modify: `hooks/post-writing-plans-reviewer.js:96-110`（ExitPlanMode handler metadata 检查段）
- Modify: `tests/post-writing-plans-reviewer.test.js`（新增 + 更新 test cases）

**Acceptance criteria:**
- ExitPlanMode 时除了检查 plan-source 和 plan-topic，还检查 plan-executor
- plan-executor 缺失时加入 missing list → block
- 所有已有 test case 中创建的 mock plan 文件包含三条 metadata

- [ ] **Step 1: 写失败测试 + 更新已有测试**

在 `tests/post-writing-plans-reviewer.test.js` 末尾添加两个新 test case：

```javascript
test('post-writing-plans-reviewer: ExitPlanMode BLOCK when plan-executor missing', () => {
  const planPath = path.join(tmpRoot, 'docs', 'plans', 'no-executor-plan.md');
  fs.mkdirSync(path.dirname(planPath), { recursive: true });
  fs.writeFileSync(planPath,
    `<!-- plan-source: ${planPath} -->\n<!-- plan-topic: no-executor -->\n# No Executor Plan\n`, 'utf8');
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(lastPlanFile(), JSON.stringify({
    path: planPath,
    written_at: new Date().toISOString(),
    plan_doc_reviewer: { approved: true, approved_at: '2026-04-16T00:00:00Z' },
    collie_reviewer:   { approved: true, approved_at: '2026-04-16T00:00:00Z' },
  }), 'utf8');
  const result = runHook({ tool_name: 'ExitPlanMode', session_id: SESSION_ID });
  assert.strictEqual(result.status, 0);
  const out = JSON.parse(result.stdout.trim());
  assert.strictEqual(out.decision, 'block', 'should block when plan-executor missing');
  assert.ok(out.reason.includes('plan-executor'), 'reason should mention plan-executor');
});

test('post-writing-plans-reviewer: ExitPlanMode passes with all three metadata lines', () => {
  const planPath = path.join(tmpRoot, 'docs', 'plans', 'full-meta-plan.md');
  fs.mkdirSync(path.dirname(planPath), { recursive: true });
  fs.writeFileSync(planPath,
    `<!-- plan-source: ${planPath} -->\n<!-- plan-topic: full-meta -->\n<!-- plan-executor: collie-harness:gated-workflow -->\n# Full Meta Plan\n`, 'utf8');
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(lastPlanFile(), JSON.stringify({
    path: planPath,
    written_at: new Date().toISOString(),
    plan_doc_reviewer: { approved: true, approved_at: '2026-04-16T00:00:00Z' },
    collie_reviewer:   { approved: true, approved_at: '2026-04-16T00:00:00Z' },
  }), 'utf8');
  const result = runHook({ tool_name: 'ExitPlanMode', session_id: SESSION_ID });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout.trim(), '', 'should pass silently with all 3 metadata');
});
```

**同时**更新已有 test case 中的 mock plan 文件，加入第三行 metadata：

- "ExitPlanMode with reviewed plan → stdout empty" test (line 119-140)：plan content 加入 `<!-- plan-executor: collie-harness:gated-workflow -->\n`
- "ExitPlanMode silent when both reviewers approved" test (line 211-225)：同上

- [ ] **Step 2: 运行测试确认新测试失败**

```bash
node --test tests/post-writing-plans-reviewer.test.js
```
Expected: "BLOCK when plan-executor missing" FAIL（当前 hook 不检查 plan-executor）。已有测试因 mock plan 已含三行 metadata 而继续 pass。

- [ ] **Step 3: 实现 plan-executor 验证**

在 `hooks/post-writing-plans-reviewer.js` 的 ExitPlanMode handler 中（约 line 98-110 的 metadata 检查段），在检查 `hasPlanSource` 和 `hasPlanTopic` 之后，添加第三个检查：

```javascript
const hasPlanExecutor = (lines[2] || '').startsWith('<!-- plan-executor:');
if (!hasPlanSource || !hasPlanTopic || !hasPlanExecutor) {
  const metaMissing = [
    !hasPlanSource && 'plan-source',
    !hasPlanTopic  && 'plan-topic',
    !hasPlanExecutor && 'plan-executor',
  ].filter(Boolean).join(' + ');
  missing.push(`plan metadata missing (${metaMissing}) — add all three lines at the top of the plan file per auto.md`);
```

注意：原代码的 error message 说 "add both lines"，需改为 "add all three lines"。

- [ ] **Step 4: 运行全部测试确认通过**

```bash
node --test tests/*.test.js
```
Expected: 0 failures（新增 + 已有测试全部通过）。

---

### Task 5: 文档同步更新 (doc-refresh)

**Files:**
- Modify: `CLAUDE.md:57-65`（Hooks and Their Triggers 表）
- Modify: `README.md:106-112`（Hook 文件表）

**Depends on:** Task 1, Task 2, Task 3

**Acceptance criteria:**
- CLAUDE.md 的 hook 表中 `post-writing-plans-reviewer.js` 描述包含 plan-executor metadata 验证
- README.md 的 hook 表中同步更新
- 无其他 stale 描述（metadata 从"两行"→"三行"如有提及需更新）

- [ ] **Step 1: 更新 CLAUDE.md hook 描述**

在 `CLAUDE.md:62`，将 `post-writing-plans-reviewer.js` 的 Purpose 从：
```
Creates dual-reviewer state; **hard-blocks** (`decision:'block'`) ExitPlanMode if called before BOTH reviewers approve
```
改为：
```
Creates dual-reviewer state; validates plan metadata (plan-source + plan-topic + plan-executor); **hard-blocks** (`decision:'block'`) ExitPlanMode if metadata missing or BOTH reviewers haven't approved
```

- [ ] **Step 2: 更新 README.md hook 描述**

在 `README.md:109`，将 `post-writing-plans-reviewer.js` 的描述从：
```
创建双 reviewer 状态；**硬拦截** ExitPlanMode，直到双方都通过
```
改为：
```
创建双 reviewer 状态；验证 plan metadata（plan-source + plan-topic + plan-executor）；**硬拦截** ExitPlanMode，直到 metadata 完整且双方都通过
```

- [ ] **Step 3: 验证文档一致性**

Read CLAUDE.md 和 README.md，确认：
1. hook 描述已更新
2. 没有其他提到 "两行 metadata" 的 stale 描述
3. 改动不影响其他段落的一致性

---

## Verification

完成所有 Task 后：

1. `node --test tests/*.test.js` — 0 failures
2. 手动 Read 验证 `commands/auto.md` 包含所有 6 个新约束
3. 手动 Read 验证 `skills/gated-workflow/SKILL.md` 的 Step 1/2/3/4 改动正确
4. 手动 Read 验证 `hooks/post-writing-plans-reviewer.js` 的 plan-executor 检查存在
5. 手动 Read 验证 `CLAUDE.md` 和 `README.md` 的 hook 描述已更新
