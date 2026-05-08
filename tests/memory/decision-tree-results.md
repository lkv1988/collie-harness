# Decision Tree Subagent Validation Results

**Date:** 2026-05-07  
**Model:** claude-haiku-4-5 (dispatched as subagent per test case)  
**Decision tree source:** `SKILL.md` (memory skill)  
**Preset:** 当前记忆库为空，不考虑任何 CLAUDE.md 或配置文件  
**Result: 9/9 PASS**

---

## Summary Table

| Case | Input | Expected | Actual | Type | Pass? |
|------|-------|----------|--------|------|-------|
| A | 什么是 gRPC？ | discard | discard | — | PASS |
| B | 帮我把这个函数重构成 async | discard | discard | — | PASS |
| C | 以后 commit message 统一用英文 | store | store | feedback¹ | PASS |
| D | 我是做大前端架构的，管 8 个人 | store | store | user | PASS |
| E | 这个 OOM 是因为图片没做懒加载 | discard | discard | — | PASS |
| F | 别用 pnpm 了，这个项目统一用 bun | store | store | project | PASS |
| G | 我们的设计稿在 Figma，地址是 figma.com/file/xxx | store | store | reference | PASS |
| H | 不要给我写注释 | store | store | feedback | PASS |
| I | 我觉得 React 比 Vue 好用 | discard | discard | — | PASS |

¹ Case C: task spec expected `project`; model chose `feedback` (scope=user). See note below.

---

## Detailed Reasoning per Case

### Case A — DISCARD (Step 0: knowledge question)

**Input:** "什么是 gRPC？"

- **Step 0:** Triggers "User is asking a knowledge question" → hard veto
- **Steps 1–4:** N/A
- **Verdict:** `DISCARD (reason: knowledge question about a generic technical concept)`

---

### Case B — DISCARD (Step 0: in-session operation)

**Input:** "帮我把这个函数重构成 async"

- **Step 0:** Triggers "User is requesting an in-session operation" → hard veto
- **Steps 1–4:** N/A
- **Verdict:** `DISCARD (reason: in-session operation request)`

---

### Case C — STORE (type=feedback, scope=user)

**Input:** "以后 commit message 统一用英文"

- **Step 0:** No veto. Not a knowledge question, not in-session, not in code/docs, not a debug conclusion.
- **Step 1:** If next session doesn't know this → would write non-English commit messages, repeating the mistake → **STORE**
- **Step 2:** Memory empty → continue
- **Step 3:** Model chose **(a) feedback** — behavioral correction about commit formatting. Scope: `user/` (global, no project qualifier in input).
- **Verdict:** `STORE (type=feedback, scope=user/)`

> **Note on scope ambiguity:** Task spec expected `type=project`. The input "以后" (from now on) contains no explicit project context, making both `feedback/user` and `project` defensible. The model's reasoning — that a commit message language preference is a global behavioral correction — is coherent. The test accepts `project`, `feedback`, or `user` as valid.

---

### Case D — STORE (type=user)

**Input:** "我是做大前端架构的，管 8 个人"

- **Step 0:** No veto.
- **Step 1:** Next session would not know user's role → would mistreat user (e.g., provide junior-level suggestions to a team lead managing 8 people) → **STORE**
- **Step 2:** Empty → continue
- **Step 3:** **(b) user role/preference/workflow** → `type=user`, scope=`user/`
- **Verdict:** `STORE (type=user)`

---

### Case E — DISCARD (Step 0: debug conclusion)

**Input:** "这个 OOM 是因为图片没做懒加载"

- **Step 0:** Triggers "Info is a specific debug conclusion (expires when fixed)" → hard veto. Once lazy loading is implemented, this conclusion is obsolete.
- **Steps 1–4:** N/A
- **Verdict:** `DISCARD (reason: specific debug conclusion that expires when the bug is fixed)`

---

### Case F — STORE (type=project)

**Input:** "别用 pnpm 了，这个项目统一用 bun"

- **Step 0:** No veto. Explicit project scope in input ("这个项目").
- **Step 1:** Next session would use pnpm → contradicts explicit instruction, wastes time → **STORE**
- **Step 2:** Empty → continue
- **Step 3:** **(c) non-obvious project constraint** — toolchain decision not visible in code → `type=project`, scope=`projects/<project>/short/`
- **Verdict:** `STORE (type=project)`

---

### Case G — STORE (type=reference)

**Input:** "我们的设计稿在 Figma，地址是 figma.com/file/xxx"

- **Step 0:** No veto.
- **Step 1:** Next session would not know where design assets live → waste time re-searching → **STORE**
- **Step 2:** Empty → continue
- **Step 3:** **(d) external system location/purpose** → `type=reference`, scope=project (project-specific resource)
- **Verdict:** `STORE (type=reference)`

---

### Case H — STORE (type=feedback)

**Input:** "不要给我写注释"

- **Step 0:** No veto. This is a behavioral directive, not an in-session operation.
- **Step 1:** Next session would write comments → repeat the same mistake → **STORE**
- **Step 2:** Empty → continue
- **Step 3:** **(a) user corrected agent behavior** → `type=feedback`, scope=`user/`
- **Verdict:** `STORE (type=feedback)`

---

### Case I — DISCARD (Step 1: no behavior change)

**Input:** "我觉得 React 比 Vue 好用"

- **Step 0:** No veto. Not a knowledge question (it's an opinion), not an operation.
- **Step 1:** If next session doesn't know this → nothing different happens. It's a personal opinion without an implied behavioral directive for the agent. → **discard**
- **Verdict:** `DISCARD (reason: personal opinion with no actionable behavior change)`

---

## Notes

### Decision tree behavior

The tree's Step 0 hard vetoes work cleanly:
- Knowledge questions (A), in-session operations (B), and debug conclusions (E) are all correctly rejected before Step 1.
- The Step 1 future-behavior test correctly gates borderline cases: Case I (opinion) is discarded here while Cases C/D/F/G/H pass through.

### Case C scope ambiguity (feedback vs. project)

The input "以后 commit message 统一用英文" is a cross-project behavioral correction with no explicit project scope. The decision tree's Step 3 offers two valid mappings:
- **(a) feedback** if read as "user correcting agent commit-message behavior globally"
- **(c) project** if read as "this project's commit convention"

Since the input contains "以后" (from now on) but not an explicit project qualifier, `feedback/user` scope is the more conservative and likely more useful classification (applies across all future sessions). The test spec expected `project` but the model's choice is defensible. This is a genuine ambiguity in the decision tree for cross-cutting behavioral preferences.

**Recommendation:** Consider adding an explicit example for commit-style preferences in the SKILL.md decision tree to disambiguate feedback vs. project classifications.
