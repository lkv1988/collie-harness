# Collie Rubric — Red Lines (12 Hard Violations)

Any single red line → **BLOCK**. Do not downgrade to WARN.

## The 12 Red Lines

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
| 12 | New pitfall not distilled into spec | "把这个认知更新到 spec 中去，以后避免！！！" | code |

**Plan-mode focus**: #1, #4, #5, #6, #9, #10 are the most common plan-stage traps.
**Code-mode focus**: all 12 apply.

## The 10 Review Questions

Scan the Target item by item. Each question answered `PASS` / `FAIL` with `file:line` evidence.

1. **Root cause** — Is this actually the root cause? Evidence? Don't stop at symptoms.
2. **Generalize the fix** — Did this fix handle all occurrences? Similar bugs elsewhere?
3. **Worktree isolation** — Changes inside the right worktree/branch? No accidental master edits? *(skip in plan mode)*
4. **Real verification** — Verified for real, not via mocked critical paths? *(skip in plan mode)*
5. **Gate omissions** — subagent / tdd / parallel / todolist / plan-doc-reviewer — any gate skipped?
6. **Subagent model selection** — opus for research? haiku for bulk? Did main session do subagent work?
7. **Mock vs real call** — Any mocked path bypass what matters? *(skip in plan mode)*
8. **Spec distillation** — New insight written back to `docs/*-spec.md`?
9. **No reinventing** — Existing implementation to reuse?
10. **Sycophancy check** — Is this conclusion independent, or does it echo the user's framing?

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
