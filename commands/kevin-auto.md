---
description: "启动 Kevin 风格的全自动 feature 开发 loop（brainstorm → plan → reviewer → gated-workflow → rubric review）"
argument-hint: "需求描述 [--max-iterations N]"
---

# Kevin Auto

以 Kevin 风格全自动跑完整个开发链路，无人值守。

## Completion Promise

本命令使用 ralph-loop。完成信号：`<promise>Kevin: SHIP IT</promise>`

**只有当以下条件全部满足时才能输出完成信号：**
1. kevin-rubric-reviewer 返回 `**Status:** PASS`
2. 所有代码已 commit & push
3. worktree 已清理

**绝对不允许谎报完成**（ralph-loop 的说明：ONLY when statement is TRUE - do not lie to exit!）

## Mandatory Sequence（不得跳步，跳步 = 红线）

```
① superpowers:brainstorming → 设计对齐
② superpowers:writing-plans → 生成实施计划
③ Agent(subagent_type="plan-doc-reviewer", model="opus") → 验证计划
④ ExitPlanMode → 退出规划模式
⑤ gated-workflow skill → 完整实施链路
⑥ Agent(subagent_type="kevin-rubric-reviewer", model="opus") → final review
⑦ 如果 kevin-rubric-reviewer Status=PASS → 输出完成信号
   如果 WARN/BLOCK → 修完再回到步骤 ⑤
```

## Task Prompt

When starting, inject this as the working prompt (substitute $ARGUMENTS with the actual arguments):

> 你的任务：$ARGUMENTS
>
> 严格按以下顺序执行（禁止跳步，跳步 = BLOCK 红线）：
>
> 第一步：调用 `superpowers:brainstorming` skill 完成设计脑暴
> 第二步：调用 `superpowers:writing-plans` skill 写实施计划
> 第三步：`Agent(subagent_type="plan-doc-reviewer", model="opus")` 验证计划
> 第四步：ExitPlanMode
> 第五步：调用 `gated-workflow` skill 实施
> 第六步：调用 `Agent(subagent_type="kevin-rubric-reviewer", model="opus")` final review
>
> 只有当 kevin-rubric-reviewer 返回 `**Status:** PASS` 时，才输出：
> `<promise>Kevin: SHIP IT</promise>`
>
> 如果 kevin-rubric-reviewer 返回 WARN 或 BLOCK，你必须修复问题后重新从第五步开始，再次 review，直到 PASS。

## Intelligent Exit Policy

以下情况自动触发 escalation（由 stop-steps-counter hook 检测）：

- 同一错误连续出现 3 次 → escalate WARN "loop_on_same_error"
- 连续 5 步无文件变更 → escalate WARN "no_progress"  
- 达到 `--max-iterations`（默认 20）→ escalate WARN "max_iterations"

这些由 `~/.kevin-proxy/hooks/stop-steps-counter.js` 自动检测，无需手动处理。

## Arguments

- `$ARGUMENTS`: 需求描述（必填）
- `--max-iterations N`: 最大迭代次数，默认 20

## Usage Example

```
/kevin-auto "add hello.js that prints 'kevin mode'"
/kevin-auto "refactor auth module to use JWT" --max-iterations 30
```
