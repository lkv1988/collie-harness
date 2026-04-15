---
description: "Launch Collie-style fully automated feature development loop (brainstorm → plan → reviewer → gated-workflow → rubric review)"
argument-hint: "task description [--max-iterations N]"
---

# Collie Auto

Run the complete development workflow Collie-style in fully automated, unattended mode.

## Completion Promise

This command uses ralph-loop. Completion signal: `<promise>Collie: SHIP IT</promise>`

**The completion signal can only be output when ALL of the following conditions are met:**
1. collie-harness:reviewer returns `**Status:** PASS`
2. All code has been committed & pushed
3. worktree has been cleaned up

**Absolutely no false completion reporting allowed** (ralph-loop note: ONLY when statement is TRUE - do not lie to exit!)

## Mandatory Sequence (no skipping allowed; skipping = red line)

```
① superpowers:brainstorming → design alignment
② superpowers:writing-plans → generate implementation plan
③ PARALLEL: Agent(subagent_type="collie-harness:plan-doc-reviewer", model="opus")
           AND Skill("collie-harness:review") with Mode=plan, Target=<plan-doc-path>
   → validate plan structure AND Collie-style rubric
   (both must return approval before step ④)
④ ExitPlanMode → exit planning mode
⑤ collie-harness:gated-workflow skill → complete implementation pipeline
⑥ Agent(subagent_type="collie-harness:reviewer", model="opus") → final review
⑦ If collie-harness:reviewer Status=PASS → output completion signal
   If WARN/BLOCK → fix and return to step ⑤
```

## Task Prompt

When starting, inject this as the working prompt (substitute $ARGUMENTS with the actual arguments):

> Your task: $ARGUMENTS
>
> Execute strictly in the following order (no skipping allowed; skipping = BLOCK red line):
>
> Step 1: Call `superpowers:brainstorming` skill to complete design brainstorming
> Step 2: Call `superpowers:writing-plans` skill to write implementation plan
> Step 3: In parallel, dispatch BOTH reviewers:
>   a) `Agent(subagent_type="collie-harness:plan-doc-reviewer", model="opus")` — structural plan validation
>   b) `Skill("collie-harness:review")` with `Mode=plan`, `Target=<path to the plan file just written>` — Collie-style rubric review
>   **Both reviewers must return approval before step 4. Do not call ExitPlanMode until both approve.**
> Step 4: ExitPlanMode
> Step 5: Call `collie-harness:gated-workflow` skill to implement
> Step 6: Call `Agent(subagent_type="collie-harness:reviewer", model="opus")` for final review
>
> Only when collie-harness:reviewer returns `**Status:** PASS`, output:
> `<promise>Collie: SHIP IT</promise>`
>
> If collie-harness:reviewer returns WARN or BLOCK, you must fix the issues and restart from step ⑤, review again, until PASS is achieved.

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
/auto "add hello.js that prints 'collie mode'"
/auto "refactor auth module to use JWT" --max-iterations 30
```
