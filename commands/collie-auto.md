---
description: "Launch Collie-style fully automated feature development loop (brainstorm → plan → reviewer → gated-workflow → rubric review)"
argument-hint: "task description [--max-iterations N]"
---

# Collie Auto

Run the complete development workflow Collie-style in fully automated, unattended mode.

## Completion Promise

This command uses ralph-loop. Completion signal: `<promise>Collie: SHIP IT</promise>`

**The completion signal can only be output when ALL of the following conditions are met:**
1. collie-rubric-reviewer returns `**Status:** PASS`
2. All code has been committed & pushed
3. worktree has been cleaned up

**Absolutely no false completion reporting allowed** (ralph-loop note: ONLY when statement is TRUE - do not lie to exit!)

## Mandatory Sequence (no skipping allowed; skipping = red line)

```
① superpowers:brainstorming → design alignment
② superpowers:writing-plans → generate implementation plan
③ Agent(subagent_type="plan-doc-reviewer", model="opus") → validate plan
④ ExitPlanMode → exit planning mode
⑤ gated-workflow skill → complete implementation pipeline
⑥ Agent(subagent_type="collie-rubric-reviewer", model="opus") → final review
⑦ If collie-rubric-reviewer Status=PASS → output completion signal
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
> Step 3: `Agent(subagent_type="plan-doc-reviewer", model="opus")` to validate plan
> Step 4: ExitPlanMode
> Step 5: Call `gated-workflow` skill to implement
> Step 6: Call `Agent(subagent_type="collie-rubric-reviewer", model="opus")` for final review
>
> Only when collie-rubric-reviewer returns `**Status:** PASS`, output:
> `<promise>Collie: SHIP IT</promise>`
>
> If collie-rubric-reviewer returns WARN or BLOCK, you must fix the issues and restart from step ⑤, review again, until PASS is achieved.

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
/collie-auto "add hello.js that prints 'collie mode'"
/collie-auto "refactor auth module to use JWT" --max-iterations 30
```
