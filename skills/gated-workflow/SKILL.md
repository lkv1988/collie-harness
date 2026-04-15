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

阅读计划文档，用 `TaskCreate` 建立整个实施阶段的 todo list。**List 不怕长，怕的是遗漏。**

### 行号记录（与建 list 同步完成）

Read 工具的输出带行号。阅读 plan 时，对每个有代码改动的 task，直接记下其在 plan 文件里的行号范围（如 `lines 45-103`）。记录格式：

```
task1: lines 45-103
task2: lines 104-158
task3: lines 159-201
```

⚠️ 这些行号对应 `$PLAN_SOURCE`，`cp` 归档后 `$ARCHIVE_PATH` 内容完全一致，行号直接适用。Step 3 dispatch 时用于 subagent 精确读取，主 session 只需记几个数字，不需要重新提取内容。

### 依赖分析（建 list 前必做）

识别 task 间的依赖关系：
- 有外部依赖的 task 标注 `[blocked-by: task X]`
- **无 blocked-by 的 task 属于同一并行批次**，在 Step 3 一次性并发 dispatch

### TodoList 结构模板

每个有代码改动的 task 拆成两条，批次编号直接写入描述：

- `[task0]` 归档计划文档
- 对计划中每个有代码改动的 task：
  - `[task N] <任务描述> [batch-X]`（有外部依赖时追加 `[blocked-by: task M]`）
  - `[task N-CR] code review for task N [batch-Y, blocked-by: task N]`
- `[test-verify]` 运行单元测试，确保 0 失败
- `[doc-refresh]` 对照实现结果核对 README / CLAUDE.md / spec，补更新遗漏
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
[test-verify] 运行单元测试
[doc-refresh] 对照实现结果核对 README / CLAUDE.md / spec，补更新遗漏
[finish] finishing-a-development-branch
```

每完成一条立即标记，不得批量滞后更新。TodoList 是实施阶段的唯一进度看板。

---

## Step 2：归档计划文档（task0）

执行阶段 session context 里带有 plan 内容，但 planmode 原始文件路径不会自动传递。plan 文件的前两行嵌有元数据（由 `/collie-harness:auto` Step 2 写入，hook 在 ExitPlanMode 前已验证存在）：

```
<!-- plan-source: /absolute/path/to/plan/file.md -->
<!-- plan-topic: my-feature-slug -->
```

**归档流程**：

1. 从 session context 的 plan 内容中提取前两行，读出 `$PLAN_SOURCE`（原始文件路径）和 `$PLAN_TOPIC`（feature slug）
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

⛔ **同一批次（相同 batch 编号）的所有 task 必须在一次 `dispatching-parallel-agents` 调用中并发 dispatch，不得退化为串行逐条执行。**

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

---

## Step 5：测试全通（GATE 5.9）

⛔ **进入收尾前的强制检查，不得跳过。**

- 运行完整单元测试套件，确保 **0 失败**
- 集成测试／E2E：除非用户明确要求，否则可跳过
- 有失败用例 → 必须修复，不得注释掉或跳过

---

## Step 5.5：文档对齐（GATE 5.95）

⛔ **收尾前必须完成的文档核对，不得跳过。**

按以下顺序逐项核对：

1. **README.md** — 如果本次改动影响了 README 中描述的命令 / 工作流 / 配置 / 架构，必须同步更新
2. **CLAUDE.md** — 如果本次改动影响了 CLAUDE.md 中描述的约束 / hook / state 文件 / 红线，必须同步更新
3. **docs/\*-spec.md** — 如果实现过程中发现的新认知与 spec 有偏差，或学到了新 pitfall，必须回写到对应 spec
4. **docs/plans/** — 本次计划文档已在 Step 2 归档，无需重复

如果 plan 阶段已规划好对应的 doc 更新任务（通过 plan-doc-reviewer 和 collie-harness:review 的审查），这一步通常只是快速确认。
如果没有规划，说明 plan 阶段双 reviewer 漏检，这一步就是安全网——必须补上再进入 Step 6。

豁免情况：本次改动仅限于内部逻辑（无 user-facing 命令 / workflow / 配置 / 约束变更），且未新增 agent / skill / hook，可在 TodoList 里把 `[doc-refresh]` 直接标记为 N/A 并注明理由。

---

## Step 6：收尾（GATE 6）

调用 `superpowers:finishing-a-development-branch`（合并 / PR / 清理 worktree）。
