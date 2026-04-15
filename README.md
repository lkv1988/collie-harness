# collie-harness

Collie 风格自主开发 agent harness — 作为 Claude Code plugin 分发。

## 功能

- **Layer 0**: `acceptEdits` 模式 + escalation 通道
- **Layer 1**: hook 链强制双 reviewer 握手（plan-doc-reviewer + collie-reviewer 双方通过才允许 ExitPlanMode）
- **Layer 2**: `skills/collie-reviewer/` — Collie 12 红线 + 10 问题 + ELEPHANT 的唯一真源；`collie-rubric-reviewer` 退化为瘦壳 agent
- **Layer 3**: `/collie-auto` slash command（ralph-loop 封装）+ CronCreate 任务队列

## 使用

```bash
# 单次任务
/collie-auto "给 foo 模块加一个 retry 机制"

# 限制最大迭代次数
/collie-auto "重构 auth 模块" --max-iterations 30

# 排队无人值守任务
/collie-queue
```

任务完成的唯一信号是 `<promise>Collie: SHIP IT</promise>`——这只在 `collie-rubric-reviewer` 返回 PASS 后才会输出。

## 工作流

```
/collie-auto "task"
  → superpowers:brainstorming
  → superpowers:writing-plans      ← hook 标记 plan 待双审
  → PARALLEL:
      plan-doc-reviewer (结构审查)  ← hook 记录 plan_doc_reviewer.approved
      collie-reviewer (Collie rubric) ← hook 记录 collie_reviewer.approved
  → (双方都通过后)
  → ExitPlanMode                   ← hook 提示调用 gated-workflow
  → gated-workflow skill
  → collie-rubric-reviewer (瘦壳 → collie-reviewer skill, code mode)
  → PASS → <promise>Collie: SHIP IT</promise>
     WARN/BLOCK → 修复后重跑 gated-workflow
```

hook 的 warn 不是报错，是护栏：跳过任意一步都会被拦截提示。

## 安装

### 前置依赖：superpowers

collie-harness 的自动化流程（brainstorming、writing-plans、gated-workflow 等）完全依赖 superpowers plugin。**必须先装好 superpowers，再装 collie-harness。**

```bash
/plugin install superpowers@claude-plugins-official
```

确认已加载：`/plugin list` 应显示 `superpowers`。

### 方式 A：Marketplace 安装（推荐，需要先发到 GitHub）
```bash
/plugin marketplace add <USER>/collie-harness
/plugin install collie-harness@collie-marketplace
```

### 方式 B：本地开发 symlink
```bash
ln -s ~/git/collie-harness ~/.claude/plugins/installed/collie-harness
```

重启 Claude Code，运行 `/plugin list` 确认 `collie-harness@0.1.0` 出现。

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

### Quota 预算（必填，首次运行前）

默认状态目录是 `~/.collie-harness/`，可通过 `COLLIE_HARNESS_HOME` 环境变量覆盖。

创建 `~/.collie-harness/config/budget.json`：

```json
{
  "daily_token_cap": 1000000,
  "weekly_token_cap": 5000000,
  "confirm_before_autoloop": true
}
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

## 文件结构

```
~/git/collie-harness/
├── .claude-plugin/plugin.json
├── agents/collie-rubric-reviewer.md   # 瘦壳，委托 collie-reviewer skill
├── commands/collie-auto.md            # /collie-auto slash command
├── skills/
│   ├── collie-reviewer/               # Collie rubric 唯一真源
│   │   ├── SKILL.md
│   │   └── references/
│   │       ├── rubric-red-lines.md   # 12 红线 + 10 问题 + Reflexion
│   │       ├── elephant-check.md     # ELEPHANT 8 维反谄媚
│   │       └── collie-voice.md       # Collie 声音句库
│   └── collie-queue/SKILL.md         # CronCreate task queue
├── hooks/
│   ├── hooks.json                    # auto-loaded by Claude Code v2.1+
│   ├── notification-escalate.js
│   ├── post-writing-plans-reviewer.js
│   ├── post-approved-exitplan-hint.js
│   ├── post-exitplan-gated-hint.js
│   ├── stop-steps-counter.js
│   ├── pre-tool-quota-guard.js
│   └── post-tool-quota-tracker.js
└── scripts/escalate.sh
```
