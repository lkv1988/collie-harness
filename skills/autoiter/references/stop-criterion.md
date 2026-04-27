# Stop Criterion & Rollback Decision Matrix

> Reference for `collie-harness:autoiter` Stage 6. Defines when to stop iterating
> and what to do with accumulated changes when scalar degrades.

---

## Stop Conditions (hybrid OR)

The loop terminates when **any** of the following conditions is true:

### SC1 — Iteration cap

```
iter >= run-spec.budget.max_iterations
```

Default: `max_iterations = 5`. Triggers `state.json.status = "budget_exhausted"`.

### SC2 — Quality threshold reached

```
success_criterion.type == "all_green"   AND scalar == "green"
success_criterion.type == "scalar_threshold"  AND scalar >= threshold
```

Triggers `state.json.status = "converged"`.

### SC3 — Convergence (K = 2 consecutive Δ ≤ ε)

Convergence is computed over the last K = 2 completed iterations.

**ε determination**:
- If scalar is an integer in range 1–5 (e.g., severity score, test-pass count
  on a 5-point rubric): **ε = 0** (strict equality — no change at all).
- If scalar is a continuous numeric value: **ε = 0.01 × |baseline_scalar|**;
  if `baseline_scalar == 0`, use absolute threshold ε = 0.01.
- If both rules could apply (ambiguous type), prefer the integer rule.

**Check**:
```
Δ_N   = |scalar_N   - scalar_{N-1}|
Δ_{N-1} = |scalar_{N-1} - scalar_{N-2}|
converged = (Δ_N ≤ ε) AND (Δ_{N-1} ≤ ε)
```

Triggers `state.json.status = "converged"`.

### SC4 — Budget exhausted (token / wallclock)

```
run-spec.budget.max_tokens   != unlimited  AND tokens_used >= max_tokens
run-spec.budget.max_wallclock_min != unlimited  AND elapsed_min >= max_wallclock_min
```

Triggers `state.json.status = "budget_exhausted"`.

### SC5 — Deadlock (stop-steps-counter.js)

`stop-steps-counter.js` fires when:
- Same error hash appears 3 consecutive times, OR
- 5 steps pass with no file changes

These map to the G7 / Stage 3 escalation path; SKILL writes
`state.json.status = "escalated"` before returning.

---

## What Happens After Stop

Regardless of stop reason:

1. Write final `iter-N/summary.md` (if not already written).
2. Overwrite `status.md` with one-line terminal state, e.g.:
   `DONE · converged after 3 iters · scalar=5 (baseline=2, +3)`
3. Append final entry to `user-log.md`.
4. If `COLLIE_AUTOITER_NOTIFY_CMD` is set, call it with `COLLIE_AUTOITER_EVENT=autoiter_done`
   (or `escalated` / `budget_exhausted` as appropriate).
5. Write terminal `state.json.status`.
6. **Return** — do NOT inline-emit sentinel. §3.5 terminal branch handles
   `rm current-run` + `<promise>Collie: AUTOITER DONE</promise>` after
   ralph-loop restarts the session.
7. **Preserve worktree** — do not auto-merge or auto-remove. User reviews
   `summary.md` and decides whether to merge.

---

## Rollback Decision Matrix

> Primary key: `primary_goal` (from run-spec) × `scalar_delta` × `kind` of FIX.
> Hard constraint: **correctness FIX is never reverted by a whole-iter rollback**.

The `kind` field comes from each `FIX-{nnn}.md`'s `kind:` value
(`correctness | optimization | mixed`).

`scalar_delta` = `scalar_N - scalar_{N-1}`:
- **Degrades**: `scalar_delta < 0` (for threshold types; for `all_green`,
  any green→red regression counts as degrade)
- **Flat / improves**: `scalar_delta >= 0`

### Matrix

| `primary_goal` | `scalar_delta` | Action |
|---|---|---|
| `correctness` | any | **Never** whole-iter rollback. Correctness FIX always kept. Optimization FIX: if scalar degrades, per-FIX revert optimization-kind only. |
| `optimization` | degrades | Per-FIX revert all `kind=optimization` FIX. `kind=correctness` FIX **forced keep** (removing them would cause the next iter to re-crash). |
| `optimization` | flat / improves | Keep all. |
| `both` | degrades + this iter ≥ 50% optimization FIX | Per-FIX revert optimization kind; correctness kind kept. |
| `both` | degrades + this iter ≥ 80% correctness FIX | Keep all (crash-fix priority outweighs metric regression). |
| `both` | degrades + 50%–80% correctness (middle band) | Default: same as "≥ 50% optimization" row — per-FIX revert optimization kind; correctness kind forced keep. |
| `both` | flat / improves | Keep all. |

**Per-FIX revert procedure**:
```bash
# for each FIX-{nnn} with kind=optimization being reverted:
git revert --no-commit <commit that introduced FIX-nnn changes>
# after all reverts:
git commit -m "chore: revert optimization FIX(es) due to scalar regression (iter-N)"
```

**Rollback log** (appended to `iter-N/summary.md`):
```markdown
## rollback_log
- FIX-002: reverted (kind=optimization, scalar regressed from 4 → 3)
  original_commit: abc1234
  revert_commit: def5678
  reason: scalar_delta=-1, primary_goal=both, correctness_ratio=0.33
```

---

## Pseudocode: Stage 6 Decision Flow

```
function stage6_stop_and_rollback(run_spec, state, iter_summary):
  scalar_delta = iter_summary.scalar - state.last_scalar

  # --- Rollback decision ---
  if scalar_delta < 0:
    goal = run_spec.primary_goal
    fixes = load_fixes(iter_summary.fix_plan)
    correctness_ratio = count(f for f in fixes if f.kind == "correctness") / len(fixes)

    if goal == "correctness":
      revert_kind = "optimization"          # never revert correctness
    elif goal == "optimization":
      revert_kind = "optimization"          # keep correctness hard-forced
    else:  # both
      if correctness_ratio >= 0.80:
        revert_kind = None                  # keep all
      else:
        revert_kind = "optimization"        # default middle + majority-opt

    if revert_kind:
      for fix in fixes where fix.kind == revert_kind:
        git_revert(fix)
      write_rollback_log(iter_summary, reverted_fixes)

  # --- Update state ---
  state.last_scalar = iter_summary.scalar
  state.iter += 1

  # --- Stop check (OR of SC1-SC5) ---
  if check_SC1(state, run_spec): return stop("budget_exhausted")
  if check_SC2(iter_summary, run_spec): return stop("converged")
  if check_SC3(state, run_spec): return stop("converged")
  if check_SC4(state, run_spec): return stop("budget_exhausted")
  # SC5 handled by stop-steps-counter.js externally

  # --- Continue ---
  write_state_json(state, status="running")
  proceed_to_next_iter()
```
