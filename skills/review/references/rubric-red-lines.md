# Collie Rubric — Red Lines (13 Hard Violations)

Any single red line → **BLOCK**. Do not downgrade to WARN.

## The 13 Red Lines

| # | Red-line behavior | Original quote (zh) | Applies in |
|---|-------------------|---------------------|------------|
| 1 | Fix surface symptoms, skip root cause | "一定体系化解决哦，不要拆东墙补西墙" | plan + code |
| 2 | Mock critical paths and claim tests pass | "光凭单独的单元测试其中的 mock 完全不够" | code |
| 3 | Accidentally modify files on master | "你怎么总在 master 修改 worktree 的 file 呢" | code |
| 4 | Main session does work that belongs to a subagent / no parallelism plan | "忘记了 superpowers 的 subagent driven 和 parallel？" | plan + code |
| 5 | Conclusions without evidence | "晒出你的证据！！！" | plan + code |
| 6 | Agree with user instead of thinking independently | "不要一味的附和我，要用于挑战，为了项目好！" | plan + code |
| 7 | Violate project conventions (CommonJS / spec / architecture) | "嗯？怎么又变成 ESM 了？我们不是 CommonJS 吗？" | code |
| 8 | LLM substitutes literal instruction (cp → write, etc.) | "我发现他总是不遵循 cp 的指令，而是自己调用 write" | plan + code |
| 9 | Reinvent the wheel | "直接改原来的 skill 不行吗？为啥要创建新的？" | plan + code |
| 10 | Implement before alignment | "别着急实施。确定没问题的话，再派 agent 出去" | plan |
| 11 | Wrong response language — Chinese required for descriptive content | "simple chinese response plz" | plan + code |
| 12 | New pitfall not distilled into spec | "把这个认知更新到 spec 中去，以后避免！！！" | plan + code |
| 13 | Speculative scope — 加任务未要求的 feature / flexibility / 抽象 / 顺手改无关代码 | "问啥做啥，多一行都是债" | plan + code |

**Plan-mode focus**: #1, #4, #5, #6, #9, #10, #12, #13 are the most common plan-stage traps.
**Code-mode focus**: all 13 apply.

### Red line #9 — 补充说明

**Plan mode 额外含义**：plan 动笔前必须先扫描 `docs/*-spec.md` 和 `docs/superpowers/specs/`，如有相关 spec 必须在 plan 的 Context 或 References 章节引用。未咨询已有 spec 而提出新方案 = Red line #9 plan-mode 触发。

### Red line #12 — 补充说明

**Plan mode 额外含义**：计划中必须包含对 README / CLAUDE.md / spec 的更新任务，如果改动会影响用户可见行为、架构约束或已有 spec。Code mode 含义保持不变：实现过程中发现的新认知必须回写到 `docs/*-spec.md`。

### Red line #13 — 补充说明

**Plan mode 额外含义**：plan 中每个 Task / 子 Step 必须可追溯到 Context 列出的问题。加了 Context 未出现的 feature / flexibility / 抽象 = Red line #13 plan-mode 触发。豁免：与设计决策同类的必要副作用（例如为新 gate 写 prose 指令）。

**Code mode 额外含义**：每行 diff 必须可追溯到 plan 的 Task。顺手改无关代码 / 注释 / 格式 / 未请求的抽象 = Red line #13 code-mode 触发。合法例外：CR 反馈导致的修改需在 commit message 注明 "per CR feedback"。

判断基线来自 Andrej Karpathy CLAUDE.md Principle 2（"Minimum code that solves the problem. Nothing speculative."）+ Principle 3（"Every changed line should trace directly to the user's request."）。

## The 11 Review Questions

Scan the Target item by item. Each question answered `PASS` / `FAIL` with `file:line` evidence.

1. **Root cause** — Is this actually the root cause? Evidence? Don't stop at symptoms.
2. **Generalize the fix** — Did this fix handle all occurrences? Similar bugs elsewhere?
3. **Worktree isolation** — Changes inside the right worktree/branch? No accidental master edits? *(skip in plan mode)*
4. **Real verification** — Verified for real, not via mocked critical paths? *(skip in plan mode)*
5. **Gate omissions** — subagent / tdd / parallel / todolist / e2e (if plan confirmed feasible) / plan-todo alignment / collie-harness:plan-doc-reviewer — any gate skipped? Code mode 额外检查：(a) plan 中每个 task 是否在 TodoList 中有对应条目（或有记录在案的合理解释）；(b) plan E2E Assessment 若结论为 `e2e_feasible: true`，最终是否有 `[e2e-verify]` 任务且执行通过。
6. **Subagent model selection** — opus for research? haiku for bulk? Did main session do subagent work?
7. **Mock vs real call** — Any mocked path bypass what matters? *(skip in plan mode)*
8. **Spec distillation** — Plan mode: plan includes doc update tasks (README / CLAUDE.md / spec) where applicable. Code mode: 枚举本次 diff 涉及的所有模块/文件，对每一项显式判断是否产生新认知或非显而易见的约束，并提供 `file:line` 证据：有新认知 → 引用写入 spec 的 `file:line`；无新认知 → 引用**已有 spec 中覆盖该行为的 `file:line`**（无法引用已有 spec = FAIL，必须写入 spec）。
9. **No reinventing** — Existing implementation **or spec** to reuse / reference? Plan mode specifically: did the plan consult `docs/*-spec.md` and `docs/superpowers/specs/` before proposing a new approach?
10. **Sycophancy check** — Is this conclusion independent, or does it echo the user's framing?
11. **Surgical scope** — plan mode: plan 内每条 task / 子 Step 是否可追溯到 Context？有无与原问题无关的 scope 扩张？code mode: diff 内每行是否可追溯到 plan task？有无顺手改了不相关代码 / 注释 / 格式？Applies to both plan and code.

## Reflexion Grounding Rules (mandatory)

Every conclusion **must** cite `file:line` evidence. If no line number, the conclusion is **invalid** → "no-evidence conclusion → Reflexion FAIL".

These phrases **without a specific file reference** are automatically invalid:

- "should be fine"
- "I think"
- "generally speaking"
- "industry standard"
- "looks okay"
- "probably"
- "我觉得"
- "应该没问题"

No evidence = invalid conclusion. Invalid conclusion = Reflexion FAIL. Reflexion FAIL → BLOCK.
