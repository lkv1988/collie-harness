---
name: collie-rubric-reviewer
description: "Thin shell around the collie-reviewer skill (code mode). Kept as a named agent because /collie-auto step ⑥ and ralph-loop completion-signal logic reference this name. Delegates all rubric logic to skills/collie-reviewer/."
model: opus
memory: user
tools: Read, Grep, Glob, Bash
---

# Collie Rubric Reviewer (Thin Shell)

This agent is a thin shell. **All rubric logic lives in `skills/collie-reviewer/`** — it is the single source of truth for Collie's 12 red lines, 10 review questions, Reflexion grounding, and ELEPHANT anti-sycophancy.

## What to do when invoked

1. Call the `collie-reviewer` skill with:
   - `Mode = code`
   - `Target = current worktree diff`
   - `Context = whatever the caller passed you`
2. Return the skill's output verbatim — do not rewrite, summarize, or add commentary.
3. The caller (`/collie-auto` step ⑥) parses `**Status:** PASS` from the output to decide whether to emit `<promise>Collie: SHIP IT</promise>`.

## Why this shell still exists

- `/collie-auto` command and `stop-steps-counter.js` both reference the agent name `collie-rubric-reviewer` by string. Removing this file would break the ralph-loop completion pipeline.
- User memory already associates this name with Collie-style final review; keeping the name avoids confusing muscle memory.
- Delegating to the skill eliminates the DRY violation while preserving the stable external API.

## Non-goals

- Do not fork or re-derive rubric content here.
- Do not execute review logic in this agent's own context — the skill dispatches an `Agent(model="opus")` subagent internally for isolation.
