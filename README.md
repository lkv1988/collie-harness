# collie-harness

Collie 风格自主开发 agent harness — 作为 Claude Code plugin 分发。

## 功能

- **Layer 0**: `acceptEdits` 模式 + escalation 通道
- **Layer 1**: hook 链强制双 reviewer 握手（collie-harness:plan-doc-reviewer + collie-harness:review 双方通过才允许 ExitPlanMode）
- **Layer 2**: `skills/review/` — Collie 12 红线 + 10 问题 + ELEPHANT 的唯一真源；`collie-harness:reviewer` 退化为瘦壳 agent
- **Layer 3**: `/auto` slash command（ralph-loop 封装）+ CronCreate 任务队列

## 使用

```bash
# 单次任务
/auto "给 foo 模块加一个 retry 机制"

# 限制最大迭代次数
/auto "重构 auth 模块" --max-iterations 30

# 排队无人值守任务
/queue
```

任务完成的唯一信号是 `<promise>Collie: SHIP IT</promise>`——这只在 `collie-harness:reviewer` 返回 PASS 后才会输出。

## 工作流

```
/auto "task"
  → ⓪ Research & Reuse               ← 内部 spec 优先，再搜网 / registry / 文档，优先复用
  → superpowers:brainstorming
  → superpowers:writing-plans         ← hook 标记 plan 待双审
  → PARALLEL:
      collie-harness:plan-doc-reviewer (结构审查) ← hook 记录 plan_doc_reviewer.approved
      collie-harness:review (Collie rubric) ← hook 记录 collie_reviewer.approved
  → (双方都通过后)
  → ExitPlanMode                      ← hook 提示调用 collie-harness:gated-workflow
  → collie-harness:gated-workflow skill
  → collie-harness:reviewer (瘦壳 → collie-harness:review skill, code mode)
  → PASS → <promise>Collie: SHIP IT</promise>
     WARN/BLOCK → 修复后重跑 gated-workflow
```

hook 的 warn 不是报错，是护栏：跳过任意一步都会被拦截提示。

任何 plan 若改动用户可见行为 / 架构约束 / 已有文档内容，必须包含显式的文档更新任务（README / CLAUDE.md / docs/\*-spec.md）。由 `collie-harness:plan-doc-reviewer` 的 Doc Maintenance 检查、`collie-harness:review` Red line #12 + Q8，以及 `gated-workflow` Step 5.5 共同强制。

## 安装

### 前置依赖：superpowers

collie-harness 的自动化流程（brainstorming、writing-plans、gated-workflow 等）完全依赖 superpowers plugin。**必须先装好 superpowers，再装 collie-harness。**

```bash
/plugin install superpowers@claude-plugins-official
```

确认已加载：`/plugin list` 应显示 `superpowers`。

### 前置依赖：ralph-loop

`/auto` command 的自动循环机制依赖 ralph-loop plugin。**必须先装好 ralph-loop，再装 collie-harness。**

```bash
/plugin install ralph-loop@claude-plugins-official
```

确认已加载：`/plugin list` 应显示 `ralph-loop`。

### 方式 A：本地开发（session 级）
```bash
claude --plugin-dir ~/git/collie-harness
```

### 方式 B：Marketplace 安装（持久，需先发布到 GitHub）

push 到 GitHub 后：
```bash
claude plugin marketplace add KevinLiu/collie-harness
claude plugin install collie-harness@collie-marketplace
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
├── agents/
│   ├── plan-doc-reviewer.md          # 结构审查 agent（collie-harness:plan-doc-reviewer）
│   └── reviewer.md                   # 瘦壳，委托 collie-harness:review skill
├── commands/
│   ├── auto.md                       # /auto slash command
│   └── queue.md                      # /queue slash command
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
│   ├── stop-steps-counter.js
│   ├── pre-tool-quota-guard.js
│   └── post-tool-quota-tracker.js
└── scripts/escalate.sh
```
