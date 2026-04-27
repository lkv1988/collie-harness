---
name: collie-harness:queue
description: "CronCreate task queue scheduler skill. Scans tasks in ~/.collie-harness/queue/*.md, schedules /auto execution via CronCreate tool. Supports scheduled tasks, concurrency=1 protection, and daily token budget checks."
---

# Collie Queue Skill

Unattended task scheduler. Write requirements to queue files, set timing, and Claude runs automatically.

## Task File Format

Queue files are stored in `~/.collie-harness/queue/` directory, each file is one task.

### File Format (YAML frontmatter + optional body)

File naming: `task-<id>.md` (example: `task-001.md`)

```yaml
---
id: task-001
prompt: "add hello.js that prints 'collie mode'"
completion_promise: "Collie: SHIP IT"
max_iterations: 20
scheduled_at: "2026-04-14T03:00:00+08:00"
status: pending
worktree: .worktrees/task-001
project_dir: /path/to/project-a
command: /collie-harness:auto   # optional; default: /collie-harness:auto; valid: /collie-harness:auto | /collie-harness:autoiter
---

# Optional: additional context
Any additional context for the task goes here.
```

**Examples — both command variants:**

```yaml
# auto task (default, command field omitted):
---
id: task-001
prompt: "add dark mode toggle"
project_dir: /Users/me/myapp
status: pending
---

# loop task:
---
id: task-002
prompt: "get all unit tests passing"
command: /collie-harness:autoiter
project_dir: /Users/me/myapp
status: pending
---
```

### Status Field

- `pending`: waiting to execute
- `running`: currently executing (auto-updated)
- `done`: successfully completed
- `failed`: execution failed
- `escalated`: triggered an escalation

## Usage

### 1. Create Task File

Manually create `~/.collie-harness/queue/task-001.md` with task information.

### 2. Trigger Queue Execution

Call this skill to scan and schedule:

```
Use collie-harness:queue skill to check and schedule pending tasks
```

### 3. Check Execution Status

```bash
ls ~/.collie-harness/queue/
grep "^status:" ~/.collie-harness/queue/*.md
tail ~/.collie-harness/escalations.log
```

## Execution Flow

When this skill is invoked:

1. **Scan Queue**: Read `~/.collie-harness/queue/*.md`, find tasks with `status: pending` and `scheduled_at <= now`

2. **Concurrency Check** (CRITICAL):
   - Check if `~/.collie-harness/state/scheduled_tasks.lock` exists
   - If exists: a task is running, skip this scheduling and output notice
   - Lock file format: `{ task_id, started_at, pid }`
   - Lock timeout: if lock file is not updated for 2+ hours, treat as zombie lock, delete and continue

3. **Budget Check**:
   - Read `~/.collie-harness/state/quota.json`
   - If `exhausted: true` → stop scheduling, escalate WARN "quota_exhausted"
   - If `daily_input_tokens > daily_token_cap * 0.7` (read from `~/.collie-harness/config/budget.json`) → stop scheduling, escalate WARN "budget_70pct"

4. **Update Task Status**: Set first matching task status to `running`

5. **Write Lock File**: `~/.collie-harness/state/scheduled_tasks.lock`

6. **Schedule Using CronCreate Tool**:

```
CronCreate({
  prompt: "<<autonomous-loop>>",
  schedule: "in 1 minute",  // or based on scheduled_at
  description: "collie-harness:queue task: " + task.id
})
```

Actual prompt content injected into `<<autonomous-loop>>`:

> Execute collie-harness task queue task {task_id}:
>
> Task file: {task_file_path}
> Prompt: {task.prompt}
> Target directory: {task.project_dir}
> Command: {task.command || "/collie-harness:auto"}
>
> Execution steps:
> 1. cd to {task.project_dir}
> 2. Dispatch based on task.command (default: /collie-harness:auto):
>    - If task.command == "/collie-harness:autoiter":
>        Run /collie-harness:autoiter "{task.prompt}" --mode queued
>    - Otherwise (default):
>        Run /collie-harness:auto "{task.prompt}" --max-iterations {task.max_iterations}
> 3. After completion, update task file status to "done"
> 4. Delete ~/.collie-harness/state/scheduled_tasks.lock

7. **Completion Notice**: Output list of scheduled tasks

## Guardrails (Hard Constraints)

- **Concurrency = 1**: Only one task can run simultaneously (lock file protection)
- **Allowlist**: Only execute `project_dir` listed in `~/.collie-harness/queue/allowlist.txt`
  - If allowlist.txt does not exist: prompt user to create allowlist before execution
  - allowlist.txt format: one absolute path per line
  - Note: allowlist controls which **project directories** are permitted to run; it is NOT a command allowlist — both `/collie-harness:auto` and `/collie-harness:autoiter` are always permitted for any allowlisted project_dir
- **Budget Protection**: daily tokens > 70% → stop (reserves buffer for daily interaction)
- **Lock Timeout**: zombie locks (>2h) auto-cleared

## Required Setup Before First Use

1. Create `~/.collie-harness/config/budget.json`:
```json
{
  "daily_token_cap": 1000000,
  "weekly_token_cap": 5000000,
  "confirm_before_autoloop": true
}
```

2. Create `~/.collie-harness/queue/allowlist.txt` (one project path per line):
```
/path/to/project-a
/path/to/project-b
```

3. Test escalation channel is working:
```bash
~/git/collie-harness/scripts/escalate.sh TEST "queue test" '{}'
```

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Task not being scheduled | `grep "^status:" ~/.collie-harness/queue/*.md` verify it's pending |
| Stuck running for long | Check lock file: `cat ~/.collie-harness/state/scheduled_tasks.lock` |
| Escalation not triggered | `tail ~/.collie-harness/escalations.log` |
| Budget check fails | Verify `~/.collie-harness/config/budget.json` exists |
