<!-- plan-source: <fix-plan.md absolute path> -->
<!-- plan-topic: autoiter-iter-N-fixes -->
<!-- plan-executor: collie:flow -->

> **For agentic workers:** MUST invoke Skill('collie:flow') to implement this plan.

# Fix Plan: Iteration N

> Stage 5.0 — Fill this template from `iter-N/fixes/FIX-*.md`.
> Only FIXes with `fix_confidence ≥ 3` AND non-empty `root_cause` +
> `reproduction_test` (G8 + G2 gates) are eligible.

---

## Field Mapping (FIX-{nnn}.md → plan sections)

| FIX field | Plan section |
|-----------|-------------|
| `FIX.id` | Task id |
| `FIX.root_cause` | Task Why |
| `FIX.fix_outline` | Task How |
| `FIX.reproduction_test` | Task Verify |
| `FIX.dependencies` | DAG depends-on |

---

## Task Execution DAG

| Task | Batch | Depends on | Key files |
|------|-------|------------|-----------|
| FIX-001 | 1 | — | `src/foo.js`, `lib/bar.js` |
| FIX-002 | 1 | — | `src/baz.js` |
| FIX-003 | 2 | FIX-001 | `src/foo.js` |

> Fill from FIX-*.md. Assign batch numbers so independent tasks share a batch
> (parallel execution). Tasks with `dependencies:` must be in a later batch
> than their dependencies.

---

## Task Details

> One section per eligible FIX. Copy from FIX-{nnn}.md fields.

### Task FIX-001

**Why** (root_cause):
> Paste FIX.root_cause here verbatim.

**How** (fix_outline):
> Paste FIX.fix_outline here verbatim.

**Verify** (reproduction_test):
```
Paste FIX.reproduction_test here verbatim.
```

---

## Impact Assessment

### Directly Affected

> Aggregate all files appearing in FIX-*.md `fix_outline` fields.
> List by module/package with a one-line description of what changes.

- `src/foo.js` — fix null-dereference in parser loop (FIX-001)
- `lib/bar.js` — add missing bounds check (FIX-001)

### Downstream Consumers

> List modules, services, or users that import / depend on the directly
> affected files. If none are known, write "None identified."

### Reverse Impact

> Describe how this iteration's changes could affect shared state, caches,
> persistent files, or cross-session behavior.
> If no shared-state impact: write "None — iter-local change"

---

## E2E Assessment

> Inherit from `run-spec.md` trigger and success_criterion.
> Do not re-derive — copy the conclusion from run-spec.

- trigger: `<run-spec.trigger.invocation>`
- e2e_applicable: true | false
- conclusion: >
    <Copied from run-spec or Stage 0.5 prepare-report. If e2e_applicable=false,
    state why (e.g., "unit-test only project, no integration harness").>
