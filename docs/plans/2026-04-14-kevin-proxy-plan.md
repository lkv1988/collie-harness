# Plan: Kevin Proxy — 接线而非重造（一次性完整交付）

## Context

**问题**：Kevin 是 Claude Code 交互的瓶颈——总在 review plan、盯流程合规、批设计、CR。他想让一个 opus agent 以他的风格自主跑完 brainstorm → plan → implement → review，只在卡住时通过 shell/webhook 通知他。

**原计划已推翻**：前版 plan 打算写 6 个新 hook + SessionStart 注入 kevin-profile.md 精华 + 12 条 memory 种子。三份并行调研（本地 + web）证明：**该功能 80% 已由 Claude Code 内建能力覆盖**，原计划是重造轮子。

### 调研关键事实（证据见 agent transcript）

| 需求 | 已有机制 | 证据 |
|---|---|---|
| brainstorm→plan→impl→review 硬连线 | `superpowers` SKILL.md 写死下一步跳转（brainstorming→writing-plans→subagent-driven-development→finishing-a-development-branch） | `~/.claude/plugins/cache/claude-plugins-official/superpowers/5.0.7/skills/brainstorming/SKILL.md` 行 22-32 |
| gated-workflow 7 步链路 | **已存在** user-scope skill（我原先不知道） | `~/.claude/skills/gated-workflow/SKILL.md` 全文 |
| 同会话自循环 | `ralph-loop` plugin（Stop hook + state file + promise） | `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/ralph-loop/hooks/stop-hook.sh:137-188` |
| 无人值守定时唤醒 | 内建 `CronCreate` + `<<autonomous-loop>>` sentinel | Claude Code 原生工具，CHANGELOG:391 |
| 模型自决节奏 | 内建 `ScheduleWakeup` + `<<autonomous-loop-dynamic>>` | 本 session 系统 prompt 已暴露 |
| 预授权免弹框 | `permissions.defaultMode: "acceptEdits"` | 内建 |
| Headless 嵌套 | `claude -p --allowedTools … --output-format stream-json` | `autonomous-loops/SKILL.md:50-105` |
| 并行 subagent team | `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` | `~/.claude/settings.json:5` 已开启 |
| `desktop-notify.js` 脚本 | 存在但 settings.json 未挂接 | `~/git/kevin-proxy/hooks/desktop-notify.js` |

### 3 个真正的结构性断链（全靠主 agent 记得，无 hook 强制）

1. **writing-plans → plan-doc-reviewer**：writing-plans SKILL.md 完全不提 plan-doc-reviewer。`plan-document-reviewer-prompt.md` 是孤儿文件。
2. **plan-doc-reviewer Approved → ExitPlanMode**：reviewer 只返回 Approved/Issues，无桥到退模式。
3. **ExitPlanMode → gated-workflow**：无 hook 衔接；完全靠主 agent 读 Kevin CLAUDE.md 里的文字约定。

### 业内证据对设计的修正

- **Persona 蒸馏只改 tone 不改判断质量**（有实锤数据）→ 放弃 SessionStart 注入 kevin-profile 精华方案
- **蒸馏的真正做法**：显式 checklist + anti-pattern + Reflexion 式"无代码行号引用不算结论"
- **Sycophancy 是 LLM 默认态**（SycEval 58%）→ 必须靠 grounding + checklist，单 regex 挡不住
- **Planner/Executor/Critic 三角 + deterministic steps counter** 是防自主 loop 死循环的业内标配
- **6 个 escalation 信号**：同错 3 次 / 超深 loop / N 步无进展 / confidence 低 / auth 错 / side-effect 操作

### Kevin 已确认的方向（AskUserQuestion 结果）

- **范围**：全量 E2E（ralph + cron 定时 + 全部接线，一次做完，没有后续 Phase）
- **kevin-profile 用法**：改成 rubric 式 checklist，不做 SessionStart 注入
- **Notification 触发点**：4 个全开——质量门失败、同错 3 次、ralph max-iter、Claude 内建 Notification

---

## Packaging & Distribution（打包与分发）

**结论**：不散在 `~/.claude/` 各目录，而是作为**一个独立的 Claude Code plugin** 组织源码，开发位置 `~/git/kevin-proxy/`，通过 plugin marketplace 或直接 `/plugin install` 分发给别人。

### Plugin 目录结构（开发源码 = git 仓库根）

```
~/git/kevin-proxy/
├── .claude-plugin/
│   └── plugin.json              # name/version/author/description/keywords + agents[]/commands[]/skills[]
├── README.md                    # 用途、装法、配置、验证
├── LICENSE
├── commands/
│   └── kevin-auto.md            # /kevin-auto slash command
├── agents/
│   └── kevin-rubric-reviewer.md # opus agent（改造自既有 ~/git/skills/skills/kevin-reviewer）
├── skills/
│   └── kevin-queue/
│       └── SKILL.md             # CronCreate 任务队列调度 skill
├── hooks/
│   ├── hooks.json               # v2.1+ 自动加载入口（plugin.json 不要重复声明 hooks 字段）
│   ├── notification-escalate.js
│   ├── post-writing-plans-reviewer.js
│   ├── post-approved-exitplan-hint.js
│   ├── post-exitplan-gated-hint.js
│   ├── stop-steps-counter.js
│   └── pre-tool-quota-guard.js
├── scripts/
│   └── escalate.sh              # 调用 ${KEVIN_ESCALATE_CMD} 或 fallback 到本 stub
└── tests/
    ├── fixtures/
    └── *.test.js
```

---

## 核心设计

**4 层接线图**：

```
┌─────────────────────────────────────────────────────┐
│ Layer 0 · 基础设施开关                              │
│  - acceptEdits 模式 / Notification hook / kevin-esc │
└──────────┬──────────────────────────────────────────┘
           │
┌──────────▼──────────────────────────────────────────┐
│ Layer 1 · 断链修复（3 个结构 gap）                  │
│  - writing-plans → plan-doc-reviewer 自动衔接       │
│  - plan-doc-reviewer Approved → ExitPlanMode 提示   │
│  - ExitPlanMode → gated-workflow 自动召唤           │
└──────────┬──────────────────────────────────────────┘
           │
┌──────────▼──────────────────────────────────────────┐
│ Layer 2 · Rubric 审美门                             │
│  - kevin-rubric-reviewer agent（opus, user memory） │
│  - 在 gated-workflow final-review 被强制召唤        │
│  - Reflexion grounding + ELEPHANT 反附和 + 12 红线  │
└──────────┬──────────────────────────────────────────┘
           │
┌──────────▼──────────────────────────────────────────┐
│ Layer 3 · 自主运行 harness                          │
│  - /kevin-auto slash command (ralph-loop 封装)      │
│  - steps counter + intelligent exit                 │
│  - CronCreate 任务队列（无人值守）                  │
└─────────────────────────────────────────────────────┘
```

---

## 任务分解

### Task 0 · 基础设施开关（acceptEdits + escalate stub + plugin skeleton）

- `~/git/kevin-proxy/` 新建 git 仓库
- `.claude-plugin/plugin.json`（不写 hooks 字段，v2.1+ 自动加载）
- `scripts/escalate.sh` stub（支持 `$KEVIN_ESCALATE_CMD` 覆盖）
- `~/.claude/plugins/installed/kevin-proxy` symlink
- `~/.claude/settings.json` `permissions.defaultMode = "acceptEdits"`

### Task 1 · Notification hook → escalate.sh

- `hooks/notification-escalate.js`
- 注册在 hooks.json Notification matcher "*"

### Task 2 · 3 个断链 hook

- `post-writing-plans-reviewer.js`（双 matcher：Write/Edit/MultiEdit + ExitPlanMode）
- `post-approved-exitplan-hint.js`（PostToolUse Agent）
- `post-exitplan-gated-hint.js`（PostToolUse ExitPlanMode）

### Task 3 · Steps counter hook

- `stop-steps-counter.js`（Stop hook）
- 同错 3 次 / 无进展 5 步 → escalate

### Task 4 · kevin-rubric-reviewer agent

- `agents/kevin-rubric-reviewer.md`
- opus model, user memory
- 12 红线 + 10 review 问题 + Reflexion + ELEPHANT

### Task 5 · /kevin-auto slash command

- `commands/kevin-auto.md`
- ralph-loop promise 格式兼容（`<promise>Kevin: SHIP IT</promise>`）
- 强制序列：brainstorm → plan → reviewer → exit → gated-workflow

### Task 6 · CronCreate 任务队列

- `skills/kevin-queue/SKILL.md`
- YAML task file 格式
- concurrency=1，daily budget check

### Task 7 · E2E smoke test

- `tests/e2e/smoke.sh`（4 用例）

### Task 9 · Quota Safety Budget

- `hooks/pre-tool-quota-guard.js`（PreToolUse BLOCK）
- `hooks/post-tool-quota-tracker.js`（PostToolUse 累加 tokens + rate-limit 捕获）
- `~/.kevin-proxy/config/budget.json` 用户填阈值

### Task 8 · 单元测试（依赖 Task 9）

- `tests/*.test.js`（7 个 hook 正反测试）

---

## 成功判据

1. `/plugin list` 含 `kevin-proxy@0.1.0`
2. `acceptEdits` 开启，敏感文件 deny 仍生效
3. `/kevin-auto "add hello.js"` 无人干预走完全链输出 promise
4. 注入附和 prompt → kevin-rubric-reviewer ELEPHANT FAIL
5. 制造 loop → steps counter 在 3/5 轮内 escalate
6. 4 个触发点在 `~/.kevin-proxy/escalations.log` 有证据
7. task queue: `scheduled_at=now+1min` → 10 分钟内 status=done
8. mock rate-limit → `rate_limit_cool_until` 写入 → tool call BLOCK
9. 所有 hook 单测全绿
10. plugin push 到 GitHub，第三方可 clone + symlink 生效
