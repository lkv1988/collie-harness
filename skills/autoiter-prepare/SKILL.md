---
name: collie:autoiter-prepare
description: "Pre-flight environment check SKILL for the collie autoiter command. Called by the main autoiter SKILL (collie:autoiter) in the §3.5 post-ExitPlanMode recovery path, after worktree creation, before Stage 1 iteration begins. Runs 5 checks: (1) trigger dry-run, (2) scalar extraction validation, (3) observability validation (Monitor/Read-tail + kill signal), (4) persistent directory writability. Outputs prepare-report.md with PASS/FAIL evidence. Returns failure signal to caller on any FAIL — does NOT fix issues. Supports skip_prepare bypass and is idempotent (skips all checks if prepare-report.md already exists). Do NOT invoke directly from user prompts; this is an internal skill invoked exclusively by collie:autoiter."
---

# autoiter-prepare — Pre-flight Environment Check

Called exclusively by `collie:autoiter` at Stage 0.5. Never invoked directly by the user.

**Hard scope limits** (do not exceed):
- Does NOT fix trigger issues (those are user material problems)
- Does NOT start iterations
- Does NOT touch the worktree contents (only reads run-spec.md from it)
- Returns a pass/fail signal; the main SKILL decides what to do on failure

## Inputs (passed by caller)

| Parameter | Description |
|-----------|-------------|
| `run_spec_path` | Absolute path to `~/.collie/autoiter/{project-id}/{runId}/run-spec.md` |
| `report_path` | Absolute path to `~/.collie/autoiter/{project-id}/{runId}/prepare-report.md` (output) |
| `project_id` | From `_state.projectId()` |
| `run_id` | Current runId |
| `worktree_path` | Absolute path to the autoiter worktree (trigger dry-run executes here) |

## Skip Path

Read the first 20 lines of `run_spec_path`. If `skip_prepare: true` is present:

1. Write `report_path`:
   ```
   # prepare-report.md
   status: skipped
   reason: user opted out (skip_prepare: true in run-spec.md)
   timestamp: <ISO-8601>
   ```
2. Return `{ skipped: true }` to caller immediately. Do not run any checks.

## Idempotency Path

Before running any check: if `report_path` already exists (session restart safety), read the `overall:` field from the existing file, then return `{ skipped: true, reason: "already ran", prior_status: "<PASS|FAIL>" }` immediately (substituting the actual value found). Do not overwrite or re-run.

## Check Execution

**Execution Order**: Execute checks in this order: **4 (dir writable) → 1 (dry-run) → 2 (scalar) → 3a (Monitor detect) → 3b (Read-tail fallback) → 3c (kill signal)**. Note: Check 3c must run after Check 4 because it verifies the raw.log write path created in Check 4.

Collect all results. Write `prepare-report.md` after all checks complete (one atomic write at the end, not incremental).

For detailed commands, timeouts, and pass/fail criteria for each check, read:
`skills/autoiter-prepare/references/prepare-checks.md`

### Check 1 — Trigger Dry-Run

Parse `trigger.invocation` and `trigger.kind` from `run_spec_path`.

Run the trigger in a dry-run / minimal-subset variant inside `worktree_path`. Timeout: 5 minutes. See `prepare-checks.md §1` for invocation strategy by `trigger.kind`.

Result: PASS if exit code 0 (or trigger's declared preparation success). FAIL otherwise — capture stderr as evidence.

### Check 2 — Scalar Extraction Validation

**Prerequisite**: if Check 1 FAILED, mark Check 2 as SKIP in prepare-report.md (evidence: 'skipped — dry-run output unavailable') and do not attempt extraction.

Using the stdout captured from Check 1, run the `trigger.scalar_extraction` expression against it.

- For `all_green` success criterion: confirm green/red status is extractable.
- For `scalar_threshold` / `convergence_delta`: confirm a numeric value is extractable.
- For `custom`: confirm the extraction expression returns non-empty output.

PASS if extraction succeeds and returns expected type. FAIL with evidence showing what was captured and what was attempted.

### Check 3 — Observability Validation

Three sub-checks, all must pass:

**3a. Monitor tool detection**: Run `ToolSearch select:Monitor`. If schema is returned → Monitor available. If not found → fallback mode; confirm Read-tail path is viable (the `raw.log` write path under `~/.collie/autoiter/{project_id}/{run_id}/iter-0/` is reachable).

**3b. Subprocess kill signal**: Start a background process (`Bash sleep 2 run_in_background=true`), capture its PID, then `kill <PID>` within 3 seconds. Confirm kill succeeds (exit 0 or process no longer exists).

**3c. Log write path reachable**: Confirm the `iter-0/` directory path (created in Check 4) is writable for log output. (Can defer this confirmation to after Check 4 runs.)

PASS if all three sub-checks pass. FAIL with which sub-check failed + evidence.

### Check 4 — Persistent Directory Writable

```bash
mkdir -p ~/.collie/autoiter/{project_id}/{run_id}/iter-0/
touch ~/.collie/autoiter/{project_id}/{run_id}/iter-0/.probe && rm ~/.collie/autoiter/{project_id}/{run_id}/iter-0/.probe
```

PASS if both commands succeed. FAIL with error output.

## Output: prepare-report.md

After all checks complete, write `report_path` in this format:

```markdown
# prepare-report.md
generated: <ISO-8601 timestamp>
run_id: <runId>
overall: PASS | FAIL

## Check 1 — Trigger Dry-Run: PASS | FAIL
evidence: <exit code, first 20 lines of stdout, or stderr on failure>

## Check 2 — Scalar Extraction: PASS | FAIL
evidence: <extracted value or extraction error>

## Check 3 — Observability: PASS | FAIL
  3a Monitor: available | fallback (Read-tail)
  3b Kill signal: PASS | FAIL — <evidence>
  3c Log path: PASS | FAIL — <evidence>

## Check 4 — Directory Writable: PASS | FAIL
evidence: <path created or error>
```

`overall: FAIL` if any single check is FAIL. `overall: PASS` only if all checks pass (Check 3 counts as 3 sub-checks — 3a, 3b, and 3c must each individually pass).

## Return Signal

After writing `prepare-report.md`, return to the calling SKILL:

- All checks passed: `{ status: "pass" }`
- Any check failed: `{ status: "fail", failed_checks: ["check1", "check3b"], report_path: "<path>" }`

**Do not attempt to fix failures.** The caller (main autoiter SKILL) decides:
- Interactive mode: `AskUserQuestion("Prepare failed on [X]. Fix your material and retry, or abort?")`
- Queued mode: `scripts/escalate.sh` + `state.json.status = "escalated"` → return
