---
description: "Launch Collie-style fully automated feature development loop (brainstorm → plan → review → gated-workflow → rubric review)"
argument-hint: "task description [--max-iterations N]"
---

# Collie Auto

Run the complete development workflow Collie-style in fully automated, unattended mode.

## Completion Promise

This command uses ralph-loop. Completion signal: `<promise>Collie: SHIP IT</promise>`

**The completion signal can only be output when ALL of the following conditions are met:**
1. collie-harness:review (Mode=code) returns `**Status:** PASS`
2. All code has been committed & pushed
3. worktree has been cleaned up

**Absolutely no false completion reporting allowed** (ralph-loop note: ONLY when statement is TRUE - do not lie to exit!)

## Anti-Patterns (skipping any = BLOCK red line)

**"R&R is unnecessary — brainstorming already explores the codebase"**
R&R covers external search (GitHub, registries, docs, specs). Brainstorming covers internal codebase exploration. They are complementary. Both are required.

**"I'll call writing-plans separately after brainstorming"**
`superpowers:brainstorming` invokes `writing-plans` at its final step. Calling writing-plans again will overwrite the plan. Do NOT call it separately.

**"The plan looks good enough — I'll skip one reviewer to save time"**
The hook will block ExitPlanMode anyway. Both `collie-harness:plan-doc-reviewer` AND `collie-harness:review` (Mode=plan) must return approval. There are no shortcuts.

## Mandatory Sequence (no skipping allowed; skipping = red line)

```
⓪ Create planning TaskList via TaskCreate (4 items: [research], [plan-review], [collie-review], [exit])
① Research & Reuse → internal specs first, then external (GitHub, docs, registries)
② superpowers:brainstorming → design alignment + writing-plans (triggered by brainstorming)
③ PARALLEL: Agent(collie-harness:plan-doc-reviewer) AND Skill(collie-harness:review Mode=plan)
   → both must approve before ④
④ ExitPlanMode → TaskUpdate all planning tasks completed, close planning TaskList
⑤ collie-harness:gated-workflow skill → complete implementation pipeline
⑥ Skill(collie-harness:review Mode=code) → final review
⑦ PASS → output completion signal / WARN/BLOCK → fix and return to ⑤
```

## Task Prompt

When starting, inject this as the working prompt (substitute $ARGUMENTS with the actual arguments):

> Your task: $ARGUMENTS
>
> Execute in the following order. Skipping any step = BLOCK red line.
>
> **Before anything else:** Use TaskCreate to create these 4 planning tasks (use TaskUpdate to mark each completed as you finish it):
> - [research] Research & Reuse (findings cited in plan)
> - [plan-review] Structural plan review (collie-harness:plan-doc-reviewer)
> - [collie-review] Collie rubric review (collie-harness:review Mode=plan)
> - [exit] ExitPlanMode + close planning tasks
>
> **Research & Reuse** — before designing anything, check existing work in this order:
>   - **Internal specs first**: scan `docs/*-spec.md` and `docs/superpowers/specs/` for relevant existing specs; read them in full if found and cite them in the plan
>   - Web search (Google / Exa / GitHub) for how others have solved the same problem
>   - Check package registries (npm / PyPI / crates.io / etc.) for battle-tested libraries
>   - Use Context7 MCP to look up current docs for any relevant library or framework
>   - Prefer adopting or wrapping a proven solution over writing net-new code
>   - Document what you found (or ruled out) in one short paragraph **in the plan** before proceeding
>   - Mark [research] completed.
>
> <HARD-GATE>
> Do NOT call superpowers:brainstorming until Research & Reuse is complete with findings documented.
> </HARD-GATE>
>
> **Brainstorming** — call `superpowers:brainstorming` skill.
>   - brainstorming 会自己在 TaskList 中追加 9 条自己的 checklist 任务，作为本阶段的进度看板；我们的列表中不单独持有 [brainstorm] 条目
>   - Before calling: note these constraints for when brainstorming internally invokes writing-plans:
>     - **Plan location**: write to the path specified in the planmode system prompt. Do NOT write to `docs/superpowers/plans/` or `docs/superpowers/specs/`.
>     - **The plan file MUST start with these two metadata lines** (before the `# [Feature Name] Implementation Plan` heading):
>       ```
>       <!-- plan-source: /absolute/path/to/this/plan/file.md -->
>       <!-- plan-topic: my-feature-slug -->
>       ```
>       `plan-topic` = kebab-case slug of the feature name (e.g. `binary-safe-prompts`).
>     - Record this path as `$PLAN_PATH`. These two lines are the only mechanism that survives the "clear context and execute" boundary — gated-workflow depends on them.
>   - Do NOT call writing-plans separately — brainstorming triggers it at its final step.
>
> <HARD-GATE>
> Do NOT dispatch reviewers until brainstorming is fully complete and $PLAN_PATH is recorded.
> </HARD-GATE>
>
> **Dual review** — in parallel, dispatch BOTH reviewers:
>   a) `Agent(subagent_type="collie-harness:plan-doc-reviewer", model="opus")` — structural plan validation
>   b) `Skill("collie-harness:review")` with `Mode=plan`, `Target=$PLAN_PATH` — Collie-style rubric review
>   - Both must return approval before calling ExitPlanMode.
>   - Mark [plan-review] and [collie-review] completed once both approve.
>
> <HARD-GATE>
> Do NOT call ExitPlanMode until BOTH reviewers return approval.
> </HARD-GATE>
>
> **ExitPlanMode** — after returning from planmode, use TaskUpdate to mark all planning tasks ([research], [plan-review], [collie-review], [exit]) as completed. brainstorming 的 9 条子任务由 brainstorming skill 自身负责标记完成，无需我们管理。This closes the planning TaskList before gated-workflow appends the implementation tasks.
>
> **Implementation** — call `collie-harness:gated-workflow` skill.
>
> **Final review** — call `Skill("collie-harness:review")` with `Mode=code`, `Target=<current worktree diff>`, `Context="Plan: $ARCHIVE_PATH (from gated-workflow [task0])"`.
>
> Only when collie-harness:review returns `**Status:** PASS`, output:
> `<promise>Collie: SHIP IT</promise>`
>
> If collie-harness:review returns WARN or BLOCK, fix the issues and repeat from **Implementation**, until PASS is achieved.

## Intelligent Exit Policy

The following conditions automatically trigger escalation (detected by stop-steps-counter hook):

- Same error appears consecutively 3 times → escalate WARN "loop_on_same_error"
- 5 consecutive steps with no file changes → escalate WARN "no_progress"
- Reaches `--max-iterations` (default 20) → escalate WARN "max_iterations"

These are automatically detected by the `stop-steps-counter.js` hook with no manual handling needed.

## Arguments

- `$ARGUMENTS`: task description (required)
- `--max-iterations N`: maximum number of iterations, default 20

## Usage Example

```
/collie-harness:auto "add hello.js that prints 'collie mode'"
/collie-harness:auto "refactor auth module to use JWT" --max-iterations 30
```
