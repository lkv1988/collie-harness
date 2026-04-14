---
name: kevin-queue
description: "CronCreate 任务队列调度 skill。扫描 ~/.kevin-proxy/queue/*.md 中的待执行任务，通过 CronCreate 工具调度 /kevin-auto 执行。支持定时任务、concurrency=1 保护、daily token budget 检查。"
---

# Kevin Queue Skill

无人值守任务调度器。把需求写进队列文件，设好时间，Claude 自动跑。

## Task File 格式

队列文件存放在 `~/.kevin-proxy/queue/` 目录，每个文件是一个任务。

### 文件格式（YAML frontmatter + 可选 body）

文件名格式：`task-<id>.md`（例如 `task-001.md`）

```yaml
---
id: task-001
prompt: "add hello.js that prints 'kevin mode'"
completion_promise: "Kevin: SHIP IT"
max_iterations: 20
scheduled_at: "2026-04-14T03:00:00+08:00"
status: pending
worktree: .worktrees/task-001
project_dir: /Users/kevin/git/corp/my-project
---

# Optional: additional context
Any additional context for the task goes here.
```

### Status 字段

- `pending`: 待执行
- `running`: 执行中（自动更新）
- `done`: 成功完成
- `failed`: 执行失败
- `escalated`: 触发了 escalation

## 使用方法

### 1. 创建任务文件

手动创建 `~/.kevin-proxy/queue/task-001.md`，填入任务信息。

### 2. 触发队列执行

调用本 skill 即可扫描并调度：

```
Use kevin-queue skill to check and schedule pending tasks
```

### 3. 查看执行状态

```bash
ls ~/.kevin-proxy/queue/
grep "^status:" ~/.kevin-proxy/queue/*.md
tail ~/.kevin-proxy/escalations.log
```

## 执行流程

本 skill 被调用时：

1. **扫描队列**：读取 `~/.kevin-proxy/queue/*.md`，找出 `status: pending` 且 `scheduled_at <= now` 的任务

2. **Concurrency 检查**（CRITICAL）：
   - 检查 `~/.kevin-proxy/state/scheduled_tasks.lock` 是否存在
   - 如果存在：说明有任务正在执行，跳过本次调度并输出提示
   - Lock 文件格式：`{ task_id, started_at, pid }`
   - 锁超时：如果 lock 文件超过 2 小时没更新，视为僵尸锁，删除后继续

3. **Budget 检查**：
   - 读取 `~/.kevin-proxy/state/quota.json`
   - 如果 `exhausted: true` → 停止调度，escalate WARN "quota_exhausted"
   - 如果 `daily_input_tokens > daily_token_cap * 0.7`（读 `~/.kevin-proxy/config/budget.json`）→ 停止调度，escalate WARN "budget_70pct"

4. **更新任务状态**：把第一个符合条件的任务 status 改为 `running`

5. **写 lock 文件**：`~/.kevin-proxy/state/scheduled_tasks.lock`

6. **使用 CronCreate 工具调度**：

```
CronCreate({
  prompt: "<<autonomous-loop>>",
  schedule: "in 1 minute",  // or based on scheduled_at
  description: "kevin-queue task: " + task.id
})
```

实际执行的 prompt 内容（注入到 <<autonomous-loop>> 中）：

> 执行 kevin-proxy 任务队列任务 {task_id}：
>
> 任务文件：{task_file_path}
> 提示词：{task.prompt}
> 目标目录：{task.project_dir}
>
> 执行步骤：
> 1. cd 到 {task.project_dir}
> 2. 运行 /kevin-auto "{task.prompt}" --max-iterations {task.max_iterations}
> 3. 完成后更新任务文件 status 为 "done"
> 4. 删除 ~/.kevin-proxy/state/scheduled_tasks.lock

7. **完成提示**：输出已调度的任务列表

## 护栏规则（硬约束）

- **Concurrency = 1**：同时只能有一个任务运行（lock 文件保护）
- **Allowlist**：只执行 `project_dir` 在 `~/.kevin-proxy/queue/allowlist.txt` 中列出的项目
  - 如果 allowlist.txt 不存在：提示 Kevin 需要创建 allowlist 后才能执行
  - allowlist.txt 格式：每行一个绝对路径
- **Budget 保护**：daily token > 70% → 停止（留 buffer 给日常交互）
- **Lock 超时**：僵尸锁（>2h）自动清除

## 首次使用前必须完成

1. 创建 `~/.kevin-proxy/config/budget.json`：
```json
{
  "daily_token_cap": 1000000,
  "weekly_token_cap": 5000000,
  "confirm_before_autoloop": true
}
```

2. 创建 `~/.kevin-proxy/queue/allowlist.txt`（每行一个项目路径）：
```
/Users/kevin/git/corp/my-project
/Users/kevin/git/corp/another-project
```

3. 测试 escalation 通道正常：
```bash
~/git/kevin-proxy/scripts/escalate.sh TEST "queue test" '{}'
```

## 故障排查

| 症状 | 检查 |
|------|------|
| 任务没有被调度 | `grep "^status:" ~/.kevin-proxy/queue/*.md` 确认是 pending |
| 卡在 running 很久 | 检查 lock 文件：`cat ~/.kevin-proxy/state/scheduled_tasks.lock` |
| escalation 没有触发 | `tail ~/.kevin-proxy/escalations.log` |
| budget 检查失败 | 确认 `~/.kevin-proxy/config/budget.json` 存在 |
