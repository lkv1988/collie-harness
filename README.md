# kevin-harness

Kevin 风格自主开发 agent harness — 作为 Claude Code plugin 分发。

## 功能

- **Layer 0**: `acceptEdits` 模式 + escalation 通道
- **Layer 1**: 3 个断链修复 hook（writing-plans → plan-doc-reviewer → ExitPlanMode → gated-workflow）
- **Layer 2**: `kevin-rubric-reviewer` agent（opus, rubric 式审美门，反附和）
- **Layer 3**: `/kevin-auto` slash command（ralph-loop 封装）+ CronCreate 任务队列

## 安装

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

### Escalation 通道（可选）

```bash
export KEVIN_ESCALATE_CMD=~/bin/my-escalate.sh
```

Plugin 内置 stub，只写日志到 `~/.kevin-harness/escalations.log`。

### Quota 预算（必填，首次运行前）

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
