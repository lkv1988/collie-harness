# collie-harness

Collie 风格自主开发 agent harness — 作为 Claude Code plugin 分发。

brainstorm → plan → 双 reviewer 审查 → gated 实施 → rubric 代码审查，每一步都有 hook 护栏强制执行。

## 安装

### 前置依赖

collie-harness 依赖以下两个 plugin，必须先装好：

```bash
# brainstorming / writing-plans / gated-workflow 流程支撑
/plugin install superpowers@claude-plugins-official
# /collie-harness:auto 自驱循环机制
/plugin install ralph-loop@claude-plugins-official
```

确认已加载：`/plugin list` 应同时显示 `superpowers` 和 `ralph-loop`。

### 安装 collie-harness

```bash
claude plugin install https://github.com/lkv1988/collie-harness
```

## 配置

### acceptEdits 模式（必填）

在 `~/.claude/settings.json` 加入：

```json
"permissions": { "defaultMode": "acceptEdits" }
```

没有这个配置，Layer 0 的自动执行不会生效。

### Escalation 通道（可选）

```bash
export COLLIE_ESCALATE_CMD=~/bin/my-escalate.sh
```

Plugin 内置 stub，只写日志到 `~/.collie-harness/escalations.log`。

## 使用

```bash
# 单次任务
/collie-harness:auto "给 foo 模块加一个 retry 机制"

# 限制最大迭代次数
/collie-harness:auto "重构 auth 模块" --max-iterations 30

# 排队无人值守任务
/collie-harness:queue
```

任务完成的唯一信号是 `<promise>Collie: SHIP IT</promise>`——这只在 `collie-harness:review` (Mode=code) 返回 PASS 后才会输出。

## 工作流

```
/collie-harness:auto "task"
  → ⓪ Research & Reuse               ← 内部 spec 优先，再搜网 / registry / 文档，优先复用
  → superpowers:brainstorming
  → superpowers:writing-plans         ← hook 标记 plan 待双审
  → PARALLEL:
      collie-harness:plan-doc-reviewer (结构审查) ← hook 记录 plan_doc_reviewer.approved
      collie-harness:review (Collie rubric) ← hook 记录 collie_reviewer.approved
  → (双方都通过后)
  → ExitPlanMode                      ← hook 提示调用 collie-harness:gated-workflow
  → collie-harness:gated-workflow skill
  → collie-harness:review skill (Mode=code, Target=worktree diff, Context=plan doc)
  → PASS → <promise>Collie: SHIP IT</promise>
     WARN/BLOCK → 修复后重跑 gated-workflow
```

hook 的 warn 不是报错，是护栏：跳过任意一步都会被拦截提示。

任何 plan 若改动用户可见行为 / 架构约束 / 已有文档内容，必须包含显式的文档更新任务（README / CLAUDE.md / docs/\*-spec.md）。由 `collie-harness:plan-doc-reviewer` 的 Doc Maintenance 检查、`collie-harness:review` Red line #12 + Q8，以及 `gated-workflow` Step 5.5 共同强制。

## 架构

### 4 层设计

| Layer | 作用 |
|-------|------|
| **0** | `acceptEdits` 模式 + escalation 通道（`scripts/escalate.sh`） |
| **1** | hook 链强制双 reviewer 握手（plan-doc-reviewer + review 双方通过才允许 ExitPlanMode） |
| **2** | `skills/review/` — Collie 12 红线 + 10 问题 + ELEPHANT 的唯一真源；plan 阶段和 code 阶段都直接调用 |
| **3** | `/collie-harness:auto` slash command（ralph-loop 封装）+ CronCreate 任务队列 |

### Hooks

| Hook 文件 | 事件 | 作用 |
|-----------|------|------|
| `notification-escalate.js` | Notification | 路由到 `escalate.sh` |
| `post-writing-plans-reviewer.js` | PostToolUse Write/Edit + ExitPlanMode | 创建双 reviewer 状态；**硬拦截** ExitPlanMode，直到双方都通过 |
| `post-approved-exitplan-hint.js` | PostToolUse Agent/Skill | 检测 plan-doc-reviewer Approved 或 review PASS；更新状态；提示下一步 |
| `post-exitplan-gated-hint.js` | PostToolUse ExitPlanMode | 提醒调用 `collie-harness:gated-workflow`（双审通过后才生效，否则静默） |
| `stop-steps-counter.js` | Stop | 相同错误连续 ×3 或 5 步无文件变动时 WARN 上报；触发后自动重置计数 |

### 文件结构

```
collie-harness/
├── .claude-plugin/plugin.json
├── agents/
│   └── plan-doc-reviewer.md          # 结构审查 agent（collie-harness:plan-doc-reviewer）
├── commands/
│   ├── auto.md                       # /collie-harness:auto slash command
│   └── queue.md                      # /collie-harness:queue slash command
├── skills/
│   ├── gated-workflow/SKILL.md       # 实施阶段门禁流程
│   ├── review/                       # Collie rubric 唯一真源
│   │   ├── SKILL.md
│   │   └── references/
│   │       ├── rubric-red-lines.md  # 12 红线 + 10 问题 + Reflexion
│   │       ├── elephant-check.md    # ELEPHANT 8 维反谄媚
│   │       └── collie-voice.md      # Collie 声音句库
│   └── queue/SKILL.md               # CronCreate task queue
├── hooks/
│   ├── hooks.json                    # auto-loaded by Claude Code v2.1+
│   ├── notification-escalate.js
│   ├── post-writing-plans-reviewer.js
│   ├── post-approved-exitplan-hint.js
│   ├── post-exitplan-gated-hint.js
│   └── stop-steps-counter.js
└── scripts/escalate.sh
```

### 运行时状态文件

```
~/.collie-harness/
  state/{sessionId}/
    last-plan.json             # 每 session 的 plan 审查状态
    counter.json               # 步数 + 错误 hash 追踪
  state/scheduled_tasks.lock   # collie-harness:queue 并发锁
  escalations.log              # 所有 escalation 事件
  queue/*.md                   # 待执行的无人值守任务
```

## 验证

```bash
# 检查 plugin 已加载
/plugin list

# 测试 escalation 通道
${CLAUDE_PLUGIN_ROOT}/scripts/escalate.sh TEST "hello" '{"test":true}'
tail ~/.collie-harness/escalations.log

# 运行单元测试
cd ~/git/collie-harness && node --test tests/*.test.js
```

## 本地开发

```bash
# 加载本地版本（session 级，不影响已安装版本）
claude --plugin-dir ~/git/collie-harness

# 运行单元测试
node --test tests/*.test.js

# 运行 E2E smoke 测试
./tests/e2e/smoke.sh

# 验证 plugin 结构
claude plugin validate ~/git/collie-harness
```
