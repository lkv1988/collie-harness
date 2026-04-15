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
[finish] finishing-a-development-branch
```

每完成一条立即标记，不得批量滞后更新。TodoList 是实施阶段的唯一进度看板。

---

## Step 2：归档计划文档（task0）

**按以下优先级确定权威来源**：
1. planmode system message 中明确指定的计划文件路径
2. user message 中 inline 写入的计划内容

**执行流程**：

首先检查目标路径 `docs/plans/YYYY-MM-DD-<topic>-plan.md` 是否已存在：
- **已存在且内容与当前计划一致** → 直接视为完成，跳过
- **已存在但内容不一致** → 以权威来源覆盖（见下方）
- **不存在** → 从权威来源写入（见下方）

**从权威来源写入**：

若权威来源是文件（planmode 指定路径）：
→ ⛔ 必须用 Bash `cp` 命令，禁止用 Write/Edit 工具（避免 LLM 在写入时改写内容）：
```bash
cp "<来源路径>" "docs/plans/YYYY-MM-DD-<topic>-plan.md"
```
注意：路径必须加双引号，防止空格导致命令错误。

若权威来源是 user message inline 内容：
→ 主 session 直接用 Write 工具将内容原样写入目标路径。
⛔ 禁止 dispatch subagent 做此操作（主 session 已持有完整内容，subagent 有改写风险）。

完成后立即将 task0 标记为 completed。

---

## Step 3：执行计划（GATE 4）

⛔ **同一批次（相同 batch 编号）的所有 task 必须在一次 `dispatching-parallel-agents` 调用中并发 dispatch，不得退化为串行逐条执行。**

⛔ **所有实现工作必须卸载给 subagent，主 session 只做协调和审查，不在主 session 里写代码。**

按批次逐批执行：
1. 找出当前 batch 中所有 pending 且 `[blocked-by]` 已全部完成的 task
2. 调用 `superpowers:dispatching-parallel-agents`，一次性 dispatch 整批
3. 等本批全部完成后，进入下一批

⚠️ **Worktree 路径传递**：每个 subagent 的 prompt 中必须包含当前 worktree 的绝对路径，要求 subagent 在该目录下工作，否则会破坏 worktree 隔离。

---

## Step 4：每条 Todo 的执行要求

### [task N]（实现 task）

subagent 内部按 TDD 流程执行，缺一不可：
1. 调用 `superpowers:test-driven-development` — 先写失败测试，再写最小实现使测试通过
2. 调用 `superpowers:verification-before-completion` — 提供新鲜的验证证据后才能声明完成

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

## Step 6：收尾（GATE 6）

调用 `superpowers:finishing-a-development-branch`（合并 / PR / 清理 worktree）。
