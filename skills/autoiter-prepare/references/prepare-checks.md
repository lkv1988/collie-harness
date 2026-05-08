# prepare-checks.md — Detailed Check Specifications

Reference for `collie:autoiter-prepare`. Each section defines exact commands, timeouts, and pass/fail criteria for the 5 checks (Check 3 has 3 sub-checks).

---

## §1 Check 1 — Trigger Dry-Run

**Goal**: Confirm the trigger command can execute successfully before committing N iterations to it.

**Timeout**: 300 seconds (5 minutes). Hard kill with SIGKILL after timeout; record as FAIL.

**Invocation strategy by `trigger.kind`**:

| `trigger.kind` | Dry-run strategy |
|----------------|-----------------|
| `shell` | Append `--dry-run` flag if the command accepts it (detect by running `<cmd> --help 2>&1 \| grep -q dry.run`). If `--dry-run` not supported, run with `HEAD=1` or equivalent iteration-limit env var (e.g., `MAX_ITER=1 <cmd>`). If neither works, run the full command but cap via `timeout 300 bash -c '<invocation>'`. |
| `replay` | Run against a 1-sample subset: `<invocation> --samples 1` or `--limit 1`. Fall back to full run with 5-minute timeout. |
| `dataset` | Run against first partition/shard only. Look for `--shard 0/N` or `--split train[:1%]` style flags. Fall back to 5-minute timeout. |

**Execution**: Run inside `worktree_path` as the working directory:
```bash
cd <worktree_path>
timeout 300 bash -c '<dry_run_invocation>' > /tmp/autoiter-prepare-dryrun.stdout 2> /tmp/autoiter-prepare-dryrun.stderr
EXIT_CODE=$?
```

**Pass criteria**:
- Exit code 0, OR
- Exit code matches `trigger.expected_output` if it specifies an expected non-zero code (e.g., test suite with known failures)

**Fail criteria**:
- Exit code non-zero (unless declared expected)
- Timeout (300s exceeded) — record as FAIL with "TIMEOUT" evidence
- Command not found — record as FAIL with "COMMAND_NOT_FOUND" evidence

**Evidence to capture**:
- On PASS: exit code + first 20 lines of stdout
- On FAIL: exit code + last 30 lines of stderr + first 10 lines of stdout

---

## §2 Check 2 — Scalar Extraction Validation

**Goal**: Confirm the `scalar_extraction` expression can extract a usable value from the trigger's stdout before starting iterations.

**Input**: stdout captured in `/tmp/autoiter-prepare-dryrun.stdout` from Check 1.

**Prerequisite**: If Check 1 FAILED, Check 2 is marked SKIP (cannot extract from empty/error output). Record evidence: "skipped — dry-run output unavailable".

**Extraction by `success_criterion.type`**:

| Type | Extraction method | Pass criteria |
|------|-------------------|---------------|
| `all_green` | Run `scalar_extraction` regex/grep against stdout | Must match at least one line; extracted value must be `green`, `pass`, `ok`, `0 failures`, or equivalent affirmative |
| `scalar_threshold` | Run `scalar_extraction` (grep/regex/jq) against stdout | Must extract a single numeric value (integer or float); value need not meet threshold yet |
| `convergence_delta` | Same as `scalar_threshold` | Must extract a numeric value |
| `custom` | Run `scalar_extraction` expression as shell command: `echo "<stdout>" \| <scalar_extraction>` | Must return non-empty, non-error output |

**Execution**:
```bash
# For grep-style scalar_extraction:
SCALAR=$(cat /tmp/autoiter-prepare-dryrun.stdout | grep -E '<scalar_extraction_pattern>' | tail -1)

# For jq-style:
SCALAR=$(cat /tmp/autoiter-prepare-dryrun.stdout | jq '<scalar_extraction_expr>' 2>/dev/null)

# For shell command:
SCALAR=$(cat /tmp/autoiter-prepare-dryrun.stdout | <scalar_extraction_cmd> 2>/dev/null)
```

**Evidence to capture**:
- On PASS: extracted value + first 5 lines of raw output that matched
- On FAIL: attempted expression + what was captured (empty, error, wrong type) + relevant lines of stdout that were searched

---

## §3a Check 3a — Monitor Tool Detection

**Goal**: Determine whether the built-in `Monitor` tool is available in this Claude Code session. Affects how the main autoiter SKILL observes subprocess output.

**Method**:
```
ToolSearch select:Monitor
```

**Pass criteria**: ToolSearch returns a schema/definition for `Monitor` (tool is available and callable).

**Fallback (not a FAIL)**: If Monitor is NOT found, this sub-check is still PASS — but record `mode: fallback` in the report. The main autoiter SKILL will use `Read`-tail polling instead. FAIL only if both Monitor is unavailable AND the `raw.log` write path is also unreachable (see §3c).

**Evidence to capture**:
- Monitor available: `"Monitor tool found — streaming mode available"`
- Monitor unavailable: `"Monitor tool not found — autoiter will use Read-tail fallback (ScheduleWakeup polling every 60s)"`

---

## §3b Check 3b — Subprocess Kill Signal

**Goal**: Verify that background subprocesses can be terminated (SIGTERM/SIGKILL). Required for timeout enforcement and graceful abort in the main autoiter SKILL.

**Method**:
1. Start a background Bash process: `Bash(command="sleep 30", run_in_background=true)` — capture the background task ID or PID from the response.
2. Within 3 seconds, send kill: `Bash(command="kill <PID> 2>/dev/null || true; echo $?")`
3. Verify the process is no longer running: `Bash(command="kill -0 <PID> 2>/dev/null && echo running || echo stopped")`

**Pass criteria**: Kill command returns exit 0, and subsequent `kill -0` check reports `stopped`.

**Fail criteria**: Process still running after kill attempt, or kill command itself errors unexpectedly.

**Timeout**: Entire sub-check must complete in 10 seconds.

**Evidence to capture**:
- On PASS: PID used + kill exit code + "process stopped" confirmation
- On FAIL: PID + kill output + `kill -0` check output

---

## §3c Check 3c — Log Write Path Reachable

**Goal**: Confirm the directory where `raw.log` will be written during iterations is accessible and writable.

**Dependency**: Runs after Check 4 (directory creation). If Check 4 PASSED, the path exists; this sub-check just verifies write permission.

**Method**:
```bash
touch ~/.collie/autoiter/<project_id>/<run_id>/iter-0/raw.log.probe && \
rm ~/.collie/autoiter/<project_id>/<run_id>/iter-0/raw.log.probe && \
echo "writable"
```

**Pass criteria**: `touch` and `rm` both succeed.

**Fail criteria**: Permission denied, path not found (Check 4 must have also failed), or disk full.

**Evidence to capture**:
- On PASS: `"iter-0/ log path writable at <full path>"`
- On FAIL: error output from `touch`

---

## §4 Check 4 — Persistent Directory Writable

**Goal**: Confirm the runtime state directory for this run exists and is writable before Stage 1 starts writing `state.json`, `iter-N/` subdirectories, etc.

**Method**:
```bash
mkdir -p ~/.collie/autoiter/<project_id>/<run_id>/iter-0/ && \
touch ~/.collie/autoiter/<project_id>/<run_id>/iter-0/.probe && \
rm ~/.collie/autoiter/<project_id>/<run_id>/iter-0/.probe && \
echo "ok"
```

**Pass criteria**: All three commands succeed (`mkdir -p`, `touch`, `rm`).

**Fail criteria**:
- `mkdir -p` fails: permission denied on `~/.collie/` or parent path issue
- `touch` fails: directory created but not writable (unlikely but possible with ACLs)
- Disk full

**Evidence to capture**:
- On PASS: `"directory created and writable: <full path>"`
- On FAIL: which command failed + full error output + `df -h ~/.collie/ 2>/dev/null` output (disk space diagnostic)

---

## Overall PASS/FAIL Logic

```
overall = PASS
  if Check1==PASS
  AND Check2==PASS (or SKIP with Check1==FAIL noted)
  AND (Check3a==PASS or fallback_mode)
  AND Check3b==PASS
  AND Check3c==PASS
  AND Check4==PASS

overall = FAIL otherwise
```

Any single check or sub-check failure sets `overall: FAIL`.

Check 2 SKIP (due to Check 1 FAIL) does not count as a separate failure — Check 1's FAIL is already the reported failure.

---

## Execution Order

1. Check 4 (directory creation) — run first so Check 3c can use the created path
2. Check 1 (trigger dry-run) — may take up to 5 minutes
3. Check 2 (scalar extraction) — depends on Check 1 stdout
4. Check 3a (Monitor detection) — independent, fast
5. Check 3b (kill signal) — independent, fast
6. Check 3c (log write path) — depends on Check 4

Total estimated wall time: ~5 minutes (dominated by Check 1 dry-run timeout worst case).
