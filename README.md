# kevin-harness

Kevin 风格自主开发 agent harness — 作为 Claude Code plugin 分发。

## 功能

- **Layer 0**: `acceptEdits` 模式 + escalation 通道
- **Layer 1**: 3 个断链修复 hook（writing-plans → plan-doc-reviewer → ExitPlanMode → gated-workflow）
- **Layer 2**: `kevin-rubric-reviewer` agent（opus, rubric 式审美门，反附和）
- **Layer 3**: `/kevin-auto` slash command（ralph-loop 封装）+ CronCreate 任务队列

## 使用

```bash
# 单次任务
/kevin-auto "给 foo 模块加一个 retry 机制"

# 限制最大迭代次数
/kevin-auto "重构 auth 模块" --max-iterations 30

# 排队无人值守任务
/kevin-queue
```

任务完成的唯一信号是 `<promise>Kevin: SHIP IT</promise>`——这只在 `kevin-rubric-reviewer` 返回 PASS 后才会输出。

## 工作流

```
/kevin-auto "task"
  → superpowers:brainstorming
  → superpowers:writing-plans   ← hook 标记 plan 待审
  → plan-doc-reviewer           ← hook 提示调用 ExitPlanMode
  → ExitPlanMode                ← hook 提示调用 gated-workflow
  → gated-workflow skill
  → kevin-rubric-reviewer (Opus)
  → PASS → <promise>Kevin: SHIP IT</promise>
     WARN/BLOCK → 修复后重跑 gated-workflow
```

hook 的 warn 不是报错，是护栏：跳过任意一步都会被拦截提示。

## 安装

### 前置依赖：superpowers

kevin-harness 的自动化流程（brainstorming、writing-plans、gated-workflow 等）完全依赖 superpowers plugin。**必须先装好 superpowers，再装 kevin-harness。**

```bash
/plugin install superpowers
```

确认已加载：`/plugin list` 应显示 `superpowers`。

### 方式 A：Marketplace 安装（推荐，需要先发到 GitHub）
```bash
/plugin marketplace add <USER>/kevin-harness
/plugin install kevin-harness@kevin-marketplace
```

### 方式 B：本地开发 symlink
```bash
ln -s ~/git/kevin-harness ~/.claude/plugins/installed/kevin-harness
```

重启 Claude Code，运行 `/plugin list` 确认 `kevin-harness@0.1.0` 出现。

## 配置

### acceptEdits 模式（必填）

在 `~/.claude/settings.json` 加入：

```json
"permissions": { "defaultMode": "acceptEdits" }
```

没有这个配置，Layer 0 的自动执行不会生效。

### Escalation 通道（可选）

```bash
export KEVIN_ESCALATE_CMD=~/bin/my-escalate.sh
```

Plugin 内置 stub，只写日志到 `~/.kevin-harness/escalations.log`。

### Quota 预算（必填，首次运行前）

默认状态目录是 `~/.kevin-harness/`，可通过 `KEVIN_HARNESS_HOME` 环境变量覆盖。

创建 `~/.kevin-harness/config/budget.json`：

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
tail ~/.kevin-harness/escalations.log

# 运行单元测试
cd ~/git/kevin-harness && node --test tests/*.test.js
```

## 文件结构

```
~/git/kevin-harness/
├── .claude-plugin/plugin.json
├── agents/kevin-rubric-reviewer.md   # opus rubric reviewer
├── commands/kevin-auto.md            # /kevin-auto slash command
├── skills/kevin-queue/SKILL.md       # CronCreate task queue
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
