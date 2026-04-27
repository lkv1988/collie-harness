# Overfit Guards (G1–G8)

> Reference for `collie-harness:autoiter`. These 8 guards are enforced jointly by
> `collie-harness:plan-doc-reviewer` (structural) and `collie-harness:review`
> (Collie rubric) at every fix-plan review point, and by the autoiter SKILL's inline
> diff-audit (G6) after `gated-workflow` returns.

---

## G1 — No modifying tests / fixtures / assertions

**Rule**: Diffs touching `tests/**` that are NOT `new file` additions are BLOCK
candidates. The only exception is a FIX whose `kind: correctness` explicitly
includes a `reproduction_test` that introduces a **new** test file or appends a
**new** test case.

**Prohibited**:
- Relaxing existing assertions (e.g., `expect(x).toBe(4)` → `expect(x).toBeTruthy()`)
- Deleting or commenting-out existing test cases
- Modifying fixture data to make a failing test pass
- Changing test timeouts / retry counts to mask flakiness

**Regex gate** (applied by G6 diff-audit):
```
diff path matches tests/** AND diff contains ^-.*assert|^-.*expect|^-.*assertEquals
AND is NOT a new-file addition  →  BLOCK
```

---

## G2 — Root Cause + Reproduction required in every FIX

**Rule**: `FIX-{nnn}.md` must contain non-empty values for **both**:
- `root_cause:` — a text explanation of why the bug/regression exists, not
  just what it does
- `reproduction_test:` — a runnable test or command that demonstrates the
  issue **before** the fix is applied

**Stage 5.0 gate**: Any FIX missing either field is **rejected** from
`fix-plan.md`. The SKILL must log the rejection and move the FIX to the
DEFERRED pool with tag `g2_incomplete`.

**Prohibited**:
- `root_cause: "unclear"` or empty
- `reproduction_test:` pointing to an existing test that already passes (that
  is not a reproduction — it is a passing test)

---

## G3 — Independent Verifier

**Rule**: Stage 4a (Triage) and Stage 4b (Deep Verify) subagents must use
system prompts that differ from the main agent's context. Specifically:

1. The Triage subagent system prompt must contain the phrase **"reverse
   suspicion"** and must explicitly instruct the subagent to start by
   **looking for reasons why each issue is NOT real** before concluding it is.
2. The Deep Verify subagent system prompt must contain the phrase
   **"adversarial"** and must require the subagent to **attempt proof of
   falsification** before writing the fix outline.
3. Neither subagent may quote more than **2 lines** of verbatim text from the
   main agent's `observations.md` in its system prompt — to prevent the main
   agent's framing from anchoring the verifier's judgment.

**Rationale**: Self-verification degrades to self-affirmation (APR literature).
The "reverse suspicion" / "adversarial" split creates a genuine second opinion
rather than a rubber stamp.

---

## G4 — Full regression suite (no changed-files pruning)

**Rule**: The `[regression]` step inside `collie-harness:gated-workflow` must
run the **full** test suite. It may **not** use `--changed`, `--only-files`,
`--affected`, or any other mechanism that limits coverage to files touched by
this iteration's diff.

**Evidence from SWE-bench**: Changed-files pruning lets regressions in
unrelated modules pass silently — a common source of patch overfitting in
automated repair systems.

**Allowed**: Parallelism (`--workers N`), shard-based CI distribution, or
coverage-threshold gates — as long as every test file is executed.

---

## G5 — Concrete metric (no "better" / "improved")

**Rule**: `run-spec.md`'s `success_criterion` field must be machine-evaluable:

| `type` value | Requirement |
|---|---|
| `all_green` | `scalar_extraction` must identify a green/red signal parseable from `raw.log` |
| `scalar_threshold` | `threshold` must be a numeric value; `scalar_extraction` must return a number |
| `convergence_delta` | `threshold` must be a numeric ε; `scalar_extraction` must return a number |
| `custom` | `scalar_extraction` must be a **runnable shell command** that exits 0 and prints a number to stdout |

**Prohibited phrases in `success_criterion`**:
- "better", "improved", "looks good", "faster", "cleaner", "more stable"
- Any non-numeric threshold (e.g., `threshold: high`)

**autoiter-prepare enforcement**: Stage 0.5 executes `scalar_extraction` against
the dry-run output; if it returns a non-numeric value or exits non-zero,
prepare FAIL → autoiter does not start.

---

## G6 — Per-iteration diff audit

**Rule**: After `collie-harness:gated-workflow` returns (Stage 5.1), and
before Stage 5.2 rerun, the autoiter SKILL performs an **inline diff audit**:

For every line in `git diff HEAD~1..HEAD`, the SKILL verifies that the changed
file + change rationale is traceable to at least one entry in the current
iteration's `fix-plan.md` Task list.

**Enforcement**:
- A diff line is "traceable" if the file path appears in a Task's "Key files"
  column, or the change is a direct mechanical consequence of a listed fix
  (e.g., auto-generated file updated by a build step).
- Lines not traceable to any FIX entry → **BLOCK**; write
  `state.json.status="escalated"` + call `scripts/escalate.sh` + return
  (§3.5 terminal branch emits sentinel on next ralph-loop restart).

**Relation to Red line #13**: G6 implements the per-iter enforcement of
Speculative scope (Red line #13). Every line of diff must be justifiable by
a task goal.

---

## G7 — Duplicate task detection

**Rule**: At the start of Stage 5.0, before filling `fix-plan.md`, the SKILL
computes the **token-set Jaccard similarity** between the current iteration's
Task description set and the previous iteration's Task description set using
`skills/autoiter/lib/jaccard.js`.

**Scoring bucket** (integer 1–5, consistent with §12 scoring spec):
| Jaccard ratio | Bucket |
|---|---|
| 0.00–0.20 | 1 |
| 0.21–0.40 | 2 |
| 0.41–0.60 | 3 |
| 0.61–0.80 | 4 |
| 0.81–1.00 | 5 |

**Escalation condition** (AND of both):
1. Similarity bucket ≥ 4 (Jaccard ratio ≥ 0.61), **AND**
2. `scalar` has been 0-delta for **2 consecutive** completed iterations

When both conditions hold → escalate "loop_no_progress":
- Append to `summary.md` with Jaccard ratio + bucket value
- Write `state.json.status="escalated"`
- Call `scripts/escalate.sh "loop_no_progress" "$RUN_ID"`
- Return (§3.5 terminal branch handles sentinel + current-run cleanup)

**Zero-dependency invariant**: `jaccard.js` uses only built-in Node.js `Set`
operations and string methods. No npm packages, no network calls.

---

## G8 — Dual confidence gate

**Rule**: Two independent confidence gates throttle low-confidence work:

### Gate 1 — Triage (Stage 4a)

After Triage subagent produces verdicts:
- `confidence ≥ 3` AND verdict `Real` or `Unclear` → **proceed** to Stage 4b
  Deep Verify
- `confidence ≤ 2` AND verdict `Real` or `Unclear` → **DEFERRED** pool; tag =
  `triage_low_confidence`; do NOT pass to Deep Verify
- `Discarded` (any confidence) → silently dropped; not written to DEFERRED
  (avoids noise accumulation)

### Gate 2 — Deep Verify (Stage 4b)

After each Deep Verify subagent produces a FIX:
- `fix_confidence ≥ 3` → **proceed** to Stage 5.0 (eligible for fix-plan.md)
- `fix_confidence ≤ 2` → **DEFERRED** pool; tag = `deep_verify_low_confidence`;
  do NOT include in fix-plan.md

### DEFERRED pool cross-iteration behavior

Low-confidence issues written to `progress.md`'s DEFERRED pool accumulate
evidence across iterations. If the same issue re-surfaces in a later iteration
with corroborating evidence, the Triage / Deep Verify subagent may assign a
higher confidence, allowing it to graduate out of DEFERRED and enter the fix
pipeline.

**Rationale**: Low-confidence forced fixes are the primary source of APR
patch-overfitting. Deferral costs one iteration at most; a bad fix costs N
iterations of rollback and cleanup.
