---
name: gated-workflow
description: Post-planmode implementation workflow with quality gates. Use immediately after exiting planmode to execute an approved plan.
---

# Gated Workflow（严谨计划执行流）

退出 planmode 后立即执行本 skill。本 skill 包含从 worktree 隔离到合并分支的完整流程。

---

## Step 0：隔离工作区（GATE 3）

⛔ **必须先建 worktree，再做任何其他操作。**

调用 `superpowers:using-git-worktrees` 创建隔离分支（`.worktrees/` 目录），切换到 worktree 目录。

---

## Step 1：建立完整 TodoList

通过 plan-reader subagent 获取 plan 结构（见下方），然后用 `TaskCreate` 建立整个实施阶段的 todo list。**List 不怕长，怕的是遗漏。**

> 注：规划阶段（planmode 内）的 `[research]`、`[plan-review]`、`[collie-review]`、`[exit]` 此时应已全部标记为 completed（由 auto ExitPlanMode 步骤清理）。本步骤用 `TaskCreate` 在同一 TaskList 中追加实施阶段任务，不会也无需替换已完成的规划任务。

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

### TodoList 结构模板

每个有代码改动的 task 拆成两条，批次编号直接写入描述：

- `[task0]` 归档计划文档
- 对计划中每个有代码改动的 task：
  - `[task N] <任务描述> [batch-X]`（有外部依赖时追加 `[blocked-by: task M]`）
  - `[task N-CR] code review for task N [batch-Y, blocked-by: task N]`
- `[e2e-setup]` 建立 e2e 基建（条件：仅当 plan E2E Assessment 标注"需新建 e2e 基建"时创建）
- `[e2e-verify]` 运行 e2e / 集成测试，验证 critical path（条件：仅当 plan E2E Assessment 结论为 `e2e_feasible: true` 时创建）
- `[test-verify]` 运行单元测试，确保 0 失败
- `[doc-refresh]` 对照实现结果核对 README / CLAUDE.md / spec，补更新遗漏
- `[collie-final-review]` 最终 rubric 审查（worktree 清理前的 pre-merge gate，调用 collie:review Mode=code）
- `[finish]` finishing-a-development-branch

**示例**（3 个互相独立的 task）：
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
[collie-final-review] 最终 rubric 审查（collie:review Mode=code）
[finish] finishing-a-development-branch
```

每完成一条立即标记，不得批量滞后更新。TodoList 是实施阶段的唯一进度看板。

### Plan-Todo 交叉核对（建 list 后立即执行）

⛔ **TodoList 建完后必须执行交叉核对，不得跳过。**

Dispatch 一个 haiku subagent，prompt 自包含：

````
Plan archive: <$ARCHIVE_PATH>
TodoList snapshot: <当前所有 TaskCreate 条目的 subject 列表>

请逐条对比 plan 中的每个 task 与 TodoList 条目，输出差异报告：
- 匹配：plan task X → [task Y]
- 遗漏：plan task X → 无对应 TodoList 条目
- 多余：[task Z] → plan 中无对应 task（可接受，如 [task0]、[test-verify] 等流程性任务）

只报差异，无差异则输出"全部匹配"。
````

主 session 收到差异报告后：
- 遗漏 → 立即用 TaskCreate 补上
- 有意合并 → 必须给出具体解释（"plan task X 的工作已包含在 [task Y] 中，因为 …"），模糊解释不接受
- 无差异 → 继续

---

## Step 2：归档计划文档（task0）

执行阶段 session context 里带有 plan 内容，但 planmode 原始文件路径不会自动传递。plan 文件的前三行嵌有元数据（由 `/collie:auto` Step 2 写入，hook 在 ExitPlanMode 前已验证存在）：

```
<!-- plan-source: /absolute/path/to/plan/file.md -->
<!-- plan-topic: my-feature-slug -->
<!-- plan-executor: collie:gated-workflow -->
```

**归档流程**：

1. 从 session context 的 plan 内容中提取前三行，读出 `$PLAN_SOURCE`（原始文件路径）和 `$PLAN_TOPIC`（feature slug）（`$PLAN_EXECUTOR` 由 hook 验证，本 skill 无需读取）
2. 构造目标路径：`docs/plans/YYYY-MM-DD-$PLAN_TOPIC-plan.md`（记为 `$ARCHIVE_PATH`）
3. ⛔ 必须用 Bash `cp` 归档，禁止 Write/Edit（避免 LLM 改写内容）：

```bash
mkdir -p docs/plans
cp "$PLAN_SOURCE" "$ARCHIVE_PATH"
```

**Fallback**（元数据缺失或源文件不存在，理论上 hook 已拦截，但防御性处理）：
主 session 用 Write 工具把 plan 内容**原样**写入 `$ARCHIVE_PATH`，task0 备注原因。⛔ 禁止 dispatch subagent。

完成后立即将 task0 标记为 completed。

⚠️ **`$ARCHIVE_PATH` 在 Step 3 有两个用途**：
1. 主 session dispatch 实现 subagent 时，连同 Step 1 记录的该 task 行号范围一起传入；subagent 用 `Read(path, offset, limit)` 精确读取对应段落，作为 VBC 的 acceptance criteria 来源（主 session 不提取内容，零 context 膨胀）
2. CR subagent 需要全局视角，直接传入路径，按需读取

---

## Step 3：执行计划（GATE 4）

⛔ **所有实现工作必须卸载给 subagent，主 session 只做协调和审查，不在主 session 里写代码。**

按批次逐批执行：
1. 找出当前 batch 中所有 pending 且 `[blocked-by]` 已全部完成的 task
2. 调用 `superpowers:dispatching-parallel-agents`，一次性 dispatch 整批
3. 等本批全部完成后，进入下一批

⚠️ **强制注入到每个实现 subagent prompt 的三项参数**（缺一不可）：

- **Worktree 路径**：subagent 必须在该目录下工作，否则破坏 worktree 隔离
- **`$ARCHIVE_PATH`**（plan 归档绝对路径）：subagent 从该文件读取 plan 段落
- **Task 行号范围**（Step 1 记录的 `lines X-Y`）：subagent 用此范围精确定位，无需 grep

### Dispatch prompt 模板（每个实现 subagent）

```
Worktree: <绝对路径>
Plan archive: <$ARCHIVE_PATH 绝对路径>
Plan lines for this task: <lines X-Y>

Your task: [task N] <一句话概要>

在 worktree 目录下执行本 task。调用 superpowers:verification-before-completion 时，
"Re-read plan" 步骤必须先执行：
  Read(file=Plan archive, offset=X-1, limit=Y-X+1)
读取本 task 对应的 plan 原文段落，以其中的 acceptance criteria 逐条生成 checklist 并验证。
不得只验 prompt 里的任务概要描述。

所有 git commit 的 message body 必须包含：
  Refs: <$ARCHIVE_PATH 的相对路径，如 docs/plans/2026-04-16-my-feature-plan.md>
```

### CR subagent 的 prompt 模板

```
Worktree: <绝对路径>
Plan archive: <$ARCHIVE_PATH 绝对路径>
Review target: [task N] 的实现

请 Read Plan archive 中与 task N 相关的段落，对照实现做完整性和质量审查。
调用 superpowers:requesting-code-review。
```

CR subagent 需要全局视角（跨 task 一致性），直接传路径让它按需读取比 inline 更合适。

---

## Step 4：每条 Todo 的执行要求

### [task N]（实现 task）

subagent 内部按 TDD 流程执行，缺一不可：
1. 调用 `superpowers:test-driven-development` — 先写失败测试，再写最小实现使测试通过
2. 调用 `superpowers:verification-before-completion` — 提供新鲜的验证证据后才能声明完成
   - VBC 的 "Re-read plan" 步骤：用 prompt 里的 `Plan archive` 路径和 `Plan lines` 行号，执行 `Read(offset=X-1, limit=Y-X+1)` 读取本 task 对应 plan 段落，以其中 acceptance criteria 逐条生成 checklist 并验证
   - ⛔ 只验 prompt 里的任务概要描述 = 退化为 task-level 自证 = VBC 失效

### [task N-CR]（CR task）

⛔ **必须另起独立 subagent 执行。**
⛔ **禁止在实现该 task 的 subagent 内自我 review（自审盲区），禁止在主 session 执行。**

subagent 调用 `superpowers:requesting-code-review`。

收到 CR 反馈后，主 session 遵循 `superpowers:receiving-code-review` — 技术验证，不盲目同意。

**CR 发现需修复的问题时**（receiving-code-review 确认修复有效后）：

⛔ **禁止主 session 直接写代码修复。** 即使只改一行——了解"如何改"本身需要读取源码文件，会污染主 session 上下文。

必须 dispatch 新的修复 subagent，传入：
- CR issue 清单（引用 CR 原文）
- worktree 绝对路径
- `$ARCHIVE_PATH`（plan 归档路径，按需参考）
- 受影响的文件路径（CR 报告中通常已含）

修复 subagent 完成后，dispatch 新的 CR subagent 验证修复结果。
修复→验证循环直到 CR 通过或主 session 判断需要升级处理。

---

## Step 5：测试全通（GATE 5.9）

⛔ **进入收尾前的强制检查，不得跳过。**

- 运行完整单元测试套件，确保 **0 失败**
- 集成测试／E2E：按 plan E2E Assessment 的结论执行。plan 确认 `e2e_feasible: true` 的，必须运行且通过；plan 标注 `e2e_feasible: false` 且理由充分的，可跳过
- 有失败用例 → 必须修复，不得注释掉或跳过

---

## Step 5.5：文档对齐（GATE 5.95）

⛔ **收尾前必须完成的文档核对，不得跳过。**

按以下顺序逐项核对：

1. **README.md** — 如果本次改动影响了 README 中描述的命令 / 工作流 / 配置 / 架构，必须同步更新
2. **CLAUDE.md** — 如果本次改动影响了 CLAUDE.md 中描述的约束 / hook / state 文件 / 红线，必须同步更新
3. **docs/\*-spec.md** — 如果实现过程中发现的新认知与 spec 有偏差，或学到了新 pitfall，必须回写到对应 spec
4. **docs/plans/** — 本次计划文档已在 Step 2 归档，无需重复
5. **`.claude/skills/*/SKILL.md`** — 如果本次改动新增或更新了项目级 skill，必须同步更新对应 SKILL.md

**新增或更新项目级 skill 时的硬约束**：必须调用 `Skill('skill-creator')`（由 superpowers plugin 提供）生成或更新 `.claude/skills/<slug>/SKILL.md`。**禁止 free-form prose 写入**——这保证产出的 skill 遵守 frontmatter / Concise is Key / references 规范，能被其他 Claude session 正确发现和加载。

判断"是否需要新增/更新 skill"的启发见 `skills/review/references/rubric-red-lines.md` Red line #12 补充说明。

如果 plan 阶段已规划好对应的 doc 更新任务（通过 plan-doc-reviewer 和 collie:review 的审查），这一步通常只是快速确认。
如果没有规划，说明 plan 阶段双 reviewer 漏检，这一步就是安全网——必须补上再进入 Step 6。

豁免情况：本次改动仅限于内部逻辑（无 user-facing 命令 / workflow / 配置 / 约束变更），且未新增 agent / skill / hook，可在 TodoList 里把 `[doc-refresh]` 直接标记为 N/A 并注明理由。

---

## Step 5.7：最终 rubric 审查（GATE 5.7）

⛔ **worktree 清理前最后一道 rubric gate，不得跳过。**

### 调用方式

```
Skill("collie:review")
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
3. 修复 subagent 完成后，dispatch 新的 `Skill("collie:review")` with 同样 Mode/Target/Context
4. 修复 → 重审循环直到 PASS
5. 连续 3 轮仍 BLOCK → 升级（通过 `scripts/escalate.sh` 上报，等用户介入）

⛔ **禁止退出 gated-workflow 返回 auto.md 层修复**——TodoList 状态会丢失，CR 历史链断裂。

### 与 `[task N-CR]` 的区别

- `[task N-CR]`：per-task 粒度，使用 `superpowers:requesting-code-review`，关注**单个 task 的实现质量**
- `[collie-final-review]`：整体 rubric 粒度，使用 `collie:review` Mode=code，关注**所有改动聚合后的 13 红线 + 6 问题 + ELEPHANT**

两者互补，不重复。

---

## Step 6：收尾（GATE 6）

⛔ **仅在 Step 5.7（GATE 5.7）`[collie-final-review]` 返回 PASS 后进入。**

调用 `superpowers:finishing-a-development-branch`（合并 / PR / 清理 worktree）。
