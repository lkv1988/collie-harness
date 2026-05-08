# 移除 `[brainstorm]` 冗余 TaskList 条目

## Context

上一次改动引入了规划阶段 TodoList（5 条描述性 ID）：

```
[research]       — Research & Reuse
[brainstorm]     — Brainstorming (superpowers:brainstorming)
[plan-review]    — plan-doc-reviewer
[collie-review]  — collie:review Mode=plan
[exit]           — ExitPlanMode
```

但 `superpowers:brainstorming` 本身会在主 session 建 9 条自己的 task（Explore project context、Ask clarifying questions 等）。这意味着 `[brainstorm]` 阶段执行时，TaskList 会同时包含：

- 我们的 `[brainstorm]`（1 条高层占位）
- brainstorming 的 9 条细粒度子任务

**`[brainstorm]` 与 brainstorming 内部任务是字面重复**——brainstorming 的 9 条本身就是这个阶段的完整看板，我们不需要再包一层高层条目。

其他 4 条（`[research]`、`[plan-review]`、`[collie-review]`、`[exit]`）经过审计确认：

| 条目 | 对应组件 | 组件是否自建 task |
|------|---------|-------------------|
| `[research]` | 无对应 sub-skill，纯粹我们负责 | N/A |
| `[plan-review]` | collie:plan-doc-reviewer（agent） | 不建（且 subagent 任务与父 session 隔离） |
| `[collie-review]` | collie:review（Mode=plan） | 不建 |
| `[exit]` | ExitPlanMode（built-in tool） | 不建 |

所以**只需删除 `[brainstorm]` 一条**，其他保留。

## Goal

让规划阶段 TodoList 只追踪**外部 sub-skill 不负责的**环节，避免字面重复。规划阶段 TaskList 从 5 条减到 4 条。

## Changes

### 1. `commands/auto.md`

**Task Prompt — TaskCreate 列表**：从 5 条减到 4 条，移除 `[brainstorm]`

**Task Prompt — Brainstorming 叙述段落**：保留（模型仍需知道调用哪个 skill），但补一句说明
- brainstorming 会自己在 TaskList 中追加 9 条自己的 checklist 任务，作为本阶段的进度看板；我们的列表中不单独持有 [brainstorm] 条目

**Task Prompt — ExitPlanMode 清理指令**：去掉 `[brainstorm]`

**Mandatory Sequence**：把 ⓪ 的计数从 5 改 4，列出具体 4 个 ID

### 2. `hooks/post-exitplan-gated-hint.js`

additionalContext 清理指令同步：去掉 `[brainstorm]`，加注 brainstorming 子任务自管

### 3. `skills/gated-workflow/SKILL.md`

Step 1 的注释同步：去掉 `[brainstorm]`

### 4. `.claude-plugin/plugin.json`

版本号 bump：`0.1.3` → `0.1.4`

## Critical Files

| 文件 | 改动范围 |
|------|---------|
| `commands/auto.md` | Task Prompt TaskCreate 列表、Brainstorming 叙述、ExitPlanMode 清理指令、Mandatory Sequence ⓪ |
| `hooks/post-exitplan-gated-hint.js` | additionalContext 字符串 |
| `skills/gated-workflow/SKILL.md` | Step 1 注释 |
| `.claude-plugin/plugin.json` | version 字段 |

## Non-goals

- 不改 brainstorming 自身的行为
- 不改其他 4 条的 ID 或顺序
- 不对 gated-workflow 阶段的 TaskList 做任何改动
- 不新增 hook 或 gate

## Verification

1. TaskCreate 列表只剩 4 条
2. Mandatory Sequence ⓪ 写的是 "4 items"
3. ExitPlanMode 清理指令只枚举 4 个 ID
4. Brainstorming 叙述段落里有说明 brainstorming 会自建 9 条子任务
5. `grep -rn '\[brainstorm\]' commands/ hooks/ skills/` → 0 matches
6. `node --test tests/*.test.js` → all pass
7. `claude plugin validate ~/git/collie` → ✔ Validation passed
