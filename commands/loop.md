---
description: "驱动跑长测试 → 观察 → 修复 → 重跑的自迭代闭环 (Karpathy autoresearch 风格)"
argument-hint: "<task> [--max-iterations N] [--budget-tokens M] [--mode interactive|queued]"
---

# Collie Loop

Run an iterative test → observe → fix → re-run loop in Collie-style.

## Completion Promise

This command uses ralph-loop. Completion signal: `<promise>Collie: LOOP DONE</promise>`

**The completion signal can only be output when the skill's state machine reaches a terminal state
(max iterations exhausted, goal achieved, or budget exceeded).**

**Absolutely no false completion reporting allowed** (ralph-loop note: ONLY when statement is TRUE - do not lie to exit!)

## Arguments

- `<task>` — required; the task description / goal for the iterative loop
- `--max-iterations N` — optional; maximum number of loop iterations, default 5
- `--budget-tokens M` — optional; token budget cap, default unlimited
- `--mode interactive|queued` — optional; default interactive

## Task Prompt

When starting, inject this as the working prompt (substitute $ARGUMENTS with the actual arguments):

> Your task: $ARGUMENTS
>
> Invoke Skill('collie-harness:loop') and pass all parsed arguments.
> The SKILL's §3.5 state machine will automatically call _state.projectId() to determine the current
> project ID, then check ~/.collie-harness/loop/{project-id}/current-run to decide between
> fresh-start and resume. No additional logic is needed in this command file.
>
> When the skill returns a terminal status, output: `<promise>Collie: LOOP DONE</promise>`
