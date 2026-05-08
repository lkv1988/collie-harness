# collie

Collie 风格自主开发 agent harness — 作为 Claude Code plugin 分发。

brainstorm → plan → 双 reviewer 审查 → gated 实施 → rubric 代码审查，每一步都有 hook 护栏强制执行。

## 安装

### 前置依赖

collie 依赖以下两个 plugin，必须先装好：

```bash
# brainstorming / writing-plans / flow 流程支撑
/plugin install superpowers@claude-plugins-official
# /collie:auto 自驱循环机制
/plugin install ralph-loop@claude-plugins-official
```

确认已加载：`/plugin list` 应同时显示 `superpowers` 和 `ralph-loop`。

### 添加 marketplace

```bash
claude plugin marketplace add lkv1988/collie-harness
```

### 安装插件

```bash
claude plugin install collie@collie-marketplace
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

Plugin 内置 stub，只写日志到 `~/.collie/escalations.log`。

### Autoiter 终态通知（可选）

```bash
export COLLIE_AUTOITER_NOTIFY_CMD="osascript -e 'display notification ...'"
# 或 Slack webhook、email 等
# Payload 通过以下环境变量传入：
#   COLLIE_AUTOITER_EVENT        # 事件类型（autoiter_done / blocker_unrecoverable / deadlock / escalated / budget_exhausted）
#   COLLIE_AUTOITER_RUN_ID       # 当前 runId
#   COLLIE_AUTOITER_STATUS_FILE  # status.md 文件路径
# 未设则仅 stdout 输出，无外推
```

## 使用

```bash
# 单次任务
/collie:auto "给 foo 模块加一个 retry 机制"

# 限制最大迭代次数
/collie:auto "重构 auth 模块" --max-iterations 30

# 排队无人值守任务
```

任务完成的唯一信号是 `<promise>Collie: SHIP IT</promise>`——这只在 `collie:review` (Mode=code) 返回 PASS 后才会输出。

## 工作流

```
/collie:auto "task"
  → ⓪ Research & Reuse               ← 内部 spec 优先，再搜网 / registry / 文档，优先复用
  → superpowers:brainstorming
  → superpowers:writing-plans         ← hook 标记 plan 待双审
  → PARALLEL:
      collie:plan-doc-reviewer (结构审查) ← hook 记录 plan_doc_reviewer.approved
      collie:review (Collie rubric) ← hook 记录 collie_reviewer.approved
  → (双方都通过后)
  → ExitPlanMode                      ← hook 提示调用 collie:flow
  → collie:flow skill（内含 [collie-final-review] pre-merge gate） → <promise>Collie: SHIP IT</promise>
```

hook 的 warn 不是报错，是护栏：跳过任意一步都会被拦截提示。

### Autoiter 循环 (`/collie:autoiter`)

**定位**：长时运行 × 指标驱动 × 强防过拟合的自迭代修复闭环。

**用法**：
```
/collie:autoiter "<task>" [--max-iterations N] [--budget-tokens M] [--mode interactive|queued]
```

**与 `/auto` 的差异**：

| 维度 | `/auto` | `/autoiter` |
|------|---------|---------|
| 触发 | 用户输入任务 | 用户输入任务 + Discovery 探测 trigger |
| 循环结构 | 单次线性 | N 轮迭代（默认 5）|
| 停止条件 | SHIP IT | 质量阈值 / iteration cap / 收敛 / budget / escalate |
| 典型场景 | 新功能开发 | 长期测试打磨、指标优化、批量 bug 修复 |
| worktree 清理 | 自动 merge + 清理 | 保留（用户自行决定 merge）|

**两条 workflow 是平行独立关系，不嵌套。**

**Completion signal**：`<promise>Collie: AUTOITER DONE</promise>`（迭代结束但不自动 merge，worktree 保留等用户审阅）

任何 plan 必须包含 Impact Assessment 章节，列明直接影响模块（Directly affected）、下游调用方 / 依赖 / 测试（Downstream consumers）、反向影响（Reverse impact）。由 `collie:plan-doc-reviewer` 强制。豁免：单文件 < 20 行的 trivial 改动可标注 `None — trivial change, no cross-module impact`。

任何 plan 若改动用户可见行为 / 架构约束 / 已有文档内容，必须包含显式的文档更新任务（README / CLAUDE.md / docs/\*-spec.md / `.claude/skills/*/SKILL.md`（若改动涉及项目级 SOP/操作清单））。由 `collie:plan-doc-reviewer` 的 Doc Maintenance 检查、`collie:review` Red line #12，以及 `flow` Step 5.5 共同强制。

brainstorming 阶段强制完成 E2E Assessment：探测目标项目 e2e 基建，评估可行性，若无基建则推荐建设方案。flow 根据 Assessment 结论条件性创建 `[e2e-setup]` / `[e2e-verify]` 任务，并通过 haiku subagent 交叉核对 plan-todo 对齐。`collie:review` Q5 在 code mode 时验证 e2e 承诺兑现。

## 架构

### 4 层设计

| Layer | 作用 |
|-------|------|
| **0** | `acceptEdits` 模式 + escalation 通道（`scripts/escalate.sh`） |
| **1** | hook 链强制双 reviewer 握手（plan-doc-reviewer + review 双方通过才允许 ExitPlanMode） |
| **2** | `skills/review/` — Collie 13 红线 + 6 问题 + ELEPHANT 的唯一真源；plan 阶段和 code 阶段都直接调用 |
| **3** | `/collie:auto` slash command（ralph-loop 封装）+ CronCreate 任务队列 |

### Hooks

| Hook 文件 | 事件 | 作用 |
|-----------|------|------|
| `post-writing-plans-reviewer.js` | PostToolUse Write/Edit + ExitPlanMode | 创建双 reviewer 状态；验证 plan metadata（plan-source + plan-topic + plan-executor）；**硬拦截** ExitPlanMode，直到 metadata 完整且双方都通过 |
| `post-approved-exitplan-hint.js` | PostToolUse Agent/Skill | 检测 plan-doc-reviewer Approved 或 review PASS；更新状态；提示下一步 |
| `post-exitplan-gated-hint.js` | PostToolUse ExitPlanMode | 提醒调用 `collie:flow`（双审通过后才生效，否则静默） |
| `stop-steps-counter.js` | Stop | 相同错误连续 ×3 或 5 步无文件变动时 WARN 上报；触发后自动重置计数 |
| `memory/load-index.js` | SessionStart | 清理过期记忆、同步 INDEX、加载 user/project 记忆索引到 context |
| `memory/capture-message.js` | UserPromptSubmit | 追加消息到 session log + 计数器，每 20 条触发记忆评估 |
| `memory/bump-access.js` | PostToolUse(Read) | 被读取的 `~/.collie/memory/` 文件自动 bump access_count |
| `memory/pre-compact.sh` | PreCompact | 提示 agent 在 compact 前跑 decision tree 保存记忆 |
| `memory/session-stop.sh` | Stop | 提示 agent 跑 decision tree + consolidation；后台运行 consolidate.js 兜底 |

### 文件结构

```
collie/
├── .claude-plugin/plugin.json
├── agents/
│   └── plan-doc-reviewer.md          # 结构审查 agent（collie:plan-doc-reviewer）
├── commands/
│   ├── auto.md                       # /collie:auto slash command
│   ├── autoiter.md                       # /collie:autoiter slash command
├── skills/
│   ├── flow/SKILL.md       # 实施阶段门禁流程
│   ├── review/                       # Collie rubric 唯一真源
│   │   ├── SKILL.md
│   │   └── references/
│   │       ├── rubric-red-lines.md  # 13 红线 + 6 问题 + Reflexion
│   │       ├── elephant-check.md    # ELEPHANT 8 维反谄媚
│   │       └── collie-voice.md      # Collie 声音句库
│   └── memory/                      # 认知科学记忆系统
│       ├── SKILL.md                 # decision tree + lifecycle
│       └── references/meta-rules.md
├── hooks/
│   ├── hooks.json                    # auto-loaded by Claude Code v2.1+
│   ├── post-writing-plans-reviewer.js
│   ├── post-approved-exitplan-hint.js
│   ├── post-exitplan-gated-hint.js
│   ├── stop-steps-counter.js
│   └── memory/                       # memory hook 脚本
│       ├── load-index.js            # SessionStart: cleanup + load INDEX
│       ├── capture-message.js       # UserPromptSubmit: session log + counter
│       ├── bump-access.js           # PostToolUse(Read): access reinforcement
│       ├── consolidate.js           # promote short→long, merge duplicates
│       ├── write-memory.js          # CLI: write memory file
│       ├── search-memory.js         # CLI: search for dedup
│       ├── resolve-project.js       # cwd → project slug
│       ├── pre-compact.sh           # PreCompact wrapper
│       └── session-stop.sh          # Stop wrapper
└── scripts/escalate.sh
```

### 运行时状态文件

```
~/.collie/
  state/{sessionId}/
    last-plan.json             # 每 session 的 plan 审查状态
    counter.json               # 步数 + 错误 hash 追踪
  state/scheduled_tasks.lock   # collie:queue 并发锁
  escalations.log              # 所有 escalation 事件
  queue/*.md                   # 待执行的无人值守任务
  autoiter/{project-id}/current-run   # 活跃 runId 指针（project-scoped）
  autoiter/{project-id}/{runId}/
    run-spec.md       # Stage 0 锁定的契约
    state.json        # 跨 iter 机器可读状态
    status.md         # 当前状态一句话（overwrite）
    user-log.md       # 叙事时间线（append-only）
    prepare-report.md # Stage 0.5 体检结果
    iter-N/           # 每轮迭代产物
```

## 验证

```bash
# 检查 plugin 已加载
/plugin list

# 测试 escalation 通道
${CLAUDE_PLUGIN_ROOT}/scripts/escalate.sh TEST "hello" '{"test":true}'
tail ~/.collie/escalations.log

# 运行单元测试
cd ~/git/collie && node --test tests/*.test.js
```

## 本地开发

```bash
# 加载本地版本（session 级，不影响已安装版本）
claude --plugin-dir ~/git/collie

# 运行单元测试
node --test tests/*.test.js

# 运行 E2E smoke 测试
./tests/e2e/smoke.sh

# 验证 plugin 结构
claude plugin validate ~/git/collie
```
