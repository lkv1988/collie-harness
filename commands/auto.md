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

## Mandatory Sequence (no skipping allowed; skipping = red line)

```
⓪ Create planning-phase TodoList via TaskCreate (6 items: [step1]–[step4a]/[step4b]–[step5])
① Research & Reuse → check internal specs (docs/*-spec.md, docs/superpowers/specs/) first, then search externally (GitHub, docs, registries)
② superpowers:brainstorming → design alignment
③ superpowers:writing-plans → generate implementation plan
④ PARALLEL: Agent(subagent_type="collie-harness:plan-doc-reviewer", model="opus")
           AND Skill("collie-harness:review") with Mode=plan, Target=<plan-doc-path>
   → validate plan structure AND Collie-style rubric
   (both must return approval before step ⑤)
⑤ ExitPlanMode → mark all [step1]–[step5] completed, close planning TaskList
⑥ collie-harness:gated-workflow skill → complete implementation pipeline
⑦ Skill("collie-harness:review") with Mode=code, Target=<worktree diff>, Context="Plan: $ARCHIVE_PATH (from gated-workflow [task0])" → final review
⑧ If collie-harness:review Status=PASS → output completion signal
   If WARN/BLOCK → fix and return to step ⑥
```

## Task Prompt

When starting, inject this as the working prompt (substitute $ARGUMENTS with the actual arguments):

> Your task: $ARGUMENTS
>
> Execute strictly in the following order (no skipping allowed; skipping = BLOCK red line):
>
> Step 0: Use TaskCreate to create the following 6 planning-phase tasks (use TaskUpdate to mark each completed as you finish it):
> - [step1] Research & Reuse (findings cited in plan)
> - [step2] Brainstorming (superpowers:brainstorming)
> - [step3] Write implementation plan (superpowers:writing-plans)
> - [step4a] Plan-doc review (collie-harness:plan-doc-reviewer)
> - [step4b] Collie rubric review (collie-harness:review Mode=plan)
> - [step5] ExitPlanMode
>
> Step 1: Research & Reuse — before designing anything, check existing work in this order:
>   - **Internal specs first**: scan `docs/*-spec.md` and `docs/superpowers/specs/` for relevant existing specs; read them in full if found and cite them in the plan
>   - Web search (Google / Exa / GitHub) for how others have solved the same problem
>   - Check package registries (npm / PyPI / crates.io / etc.) for battle-tested libraries
>   - Use Context7 MCP to look up current docs for any relevant library or framework
>   - Prefer adopting or wrapping a proven solution over writing net-new code
>   - Document what you found (or ruled out) in one short paragraph **in the plan** before proceeding
> Step 2: Call `superpowers:brainstorming` skill to complete design brainstorming
> Step 3: Call `superpowers:writing-plans` skill to write the implementation plan.
>   - **User preference for plan location (overrides skill default per writing-plans line 19):** write to the path specified in the planmode system prompt. Do NOT write to `docs/superpowers/plans/` or `docs/superpowers/specs/`.
>   - **The plan file MUST start with these two metadata lines** (written as part of the initial Write, before the `# [Feature Name] Implementation Plan` heading):
>     ```
>     <!-- plan-source: /absolute/path/to/this/plan/file.md -->
>     <!-- plan-topic: my-feature-slug -->
>     ```
>     `plan-topic` = kebab-case slug of the feature name (e.g. `binary-safe-prompts`).
>   - Record this path as `$PLAN_PATH`. These two lines are the only mechanism that survives the "clear context and execute" boundary — gated-workflow depends on them.
> Step 4: In parallel, dispatch BOTH reviewers:
>   a) `Agent(subagent_type="collie-harness:plan-doc-reviewer", model="opus")` — structural plan validation
>   b) `Skill("collie-harness:review")` with `Mode=plan`, `Target=$PLAN_PATH` — Collie-style rubric review
>   **Both reviewers must return approval before step 5. Do not call ExitPlanMode until both approve.**
> Step 5: ExitPlanMode. After returning from planmode, use TaskUpdate to mark [step1]–[step5] (including [step4a]/[step4b]) all as completed. This closes the planning TaskList before gated-workflow appends the implementation tasks.
> Step 6: Call `collie-harness:gated-workflow` skill to implement.
> Step 7: Call `Skill("collie-harness:review")` with `Mode=code`, `Target=<current worktree diff>`, `Context="Plan: <$ARCHIVE_PATH — the path produced by gated-workflow [task0]>"` for final review
>
> Only when collie-harness:review returns `**Status:** PASS`, output:
> `<promise>Collie: SHIP IT</promise>`
>
> If collie-harness:review returns WARN or BLOCK, you must fix the issues and restart from step ⑥, review again, until PASS is achieved.

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
