<!-- plan-source: /Users/kevin/.claude/plans/hazy-baking-sketch.md -->
<!-- plan-topic: plan-size-gate-deferred -->
<!-- plan-executor: collie:flow -->

# Plan Size Gate + Deferred Scope Lifecycle

> **For agentic workers:** MUST invoke Skill('collie:flow') to implement this plan.

## Context

Plan 过长（source2doc 项目有 1479 行的 plan）时，人类无法有效 review——SmartBear/Cisco 研究表明 code review 超 400 LOC 缺陷检出率骤降，技术文档持续注意力窗口约 30 分钟。source2doc 95 个 plan 的 Q3=562 行，中位数=281 行。

用户要求两个关联能力：
1. **Plan size gate**：plan-doc-reviewer 对 >500 行的 plan 发 WARN（不是 BLOCK），建议拆分。用户坚持可继续——这是最佳实践提醒，不是 iron law。
2. **Deferred scope lifecycle**：当 agent 拆分 plan 时，被 defer 的 scope 不能丢失。需要完整的 create → discover → follow-up → close 闭环。

已有参考：autoiter 的 `progress.md` DEFERRED pool（confidence gate），但仅限 autoiter 循环内，与 /auto 独立。

## Design

### Plan Size Gate

- **位置**：`agents/plan-doc-reviewer.md`（结构性校验，不放 red line——遵循 #14 单一数据源）
- **阈值**：500 行（source2doc 数据 Q3 附近，认知科学研究支持）
- **严格度**：WARN（advisory），不是 BLOCK。放在 "Do NOT flag these (advisory only)" 之上，作为新的中间层级
- **WARN 内容**：告知行数，建议按价值和依赖关系拆分，指引创建 deferred 文件

### Deferred File Convention

**文件位置**：`docs/plans/<topic>-deferred.md`（与 plan 同目录，git tracked）

**格式**：
```markdown
<!-- deferred-from: docs/plans/YYYY-MM-DD-xxx-plan.md -->
<!-- deferred-topic: xxx -->
<!-- deferred-date: YYYY-MM-DD -->

# <Topic> — Deferred Scope

## Origin
为什么被 defer（plan 超 500 行，按价值拆分）。

## Items
- Item 1: 做什么 + 为什么重要
- Item 2: ...

## Dependencies
Phase 1 的哪些交付是前置条件。
```

### Lifecycle 四阶段

| 阶段 | 触发点 | 执行者 | 行为 |
|------|--------|--------|------|
| **Create** | plan-doc-reviewer WARN on size（agent 决定拆分时） | brainstorming / writing-plans | agent 拆分 plan，写 `docs/plans/<topic>-deferred.md` |
| **Discover** | `/collie:auto` 新任务开始 | `commands/auto.md` R0 阶段 | 扫描 `docs/plans/*-deferred.md`，有则呈现给用户 |
| **Follow-up** | 用户选择纳入 | brainstorming | 纳入当前 scope，plan metadata 记录 `<!-- consumed-deferred: path -->` |
| **Close** | flow 交付完成 | flow Step 5.5 | 检查 plan 中 `consumed-deferred` metadata，删除对应 deferred 文件 |

### 不做的事

- 不加 red line（plan-doc-reviewer 单一数据源）
- 不加 hook（纯 prose 指令，agent 执行）
- 不加脚本（deferred 文件是普通 markdown，无需程序化处理）
- 不建 backlog 系统（一个 markdown 文件就够）

## Impact Assessment

### Directly affected
- `agents/plan-doc-reviewer.md` — 新增 Plan Size WARN 检查
- `commands/auto.md` — R0 加 deferred 扫描 + brainstorming 约束加 deferred 创建/consumed metadata
- `skills/flow/SKILL.md` — Step 5.5 加 consumed-deferred 清理
- `CLAUDE.md` — 更新 Key Design Constraints + Workflow Sequence
- `README.md` — 更新 Workflow 流程图（L71 补充 deferred scan）

### Downstream consumers
- `skills/review/SKILL.md` — 不改动。collie:review 不检查 plan size（plan-doc-reviewer 负责）
- `skills/review/references/rubric-red-lines.md` — 不改动（已有 #14 #15，plan size 不加 red line）
- `hooks/post-writing-plans-reviewer.js` — 不改动（只校验 metadata，不关心 plan size）
- `tests/*.test.js` — 现有测试不受影响（plan-doc-reviewer 是 agent prose，无代码逻辑）

### Reverse impact
- 无持久状态变更。deferred 文件是 git tracked markdown，无运行时状态依赖。

## E2E Assessment

- 现有 e2e 基建：`tests/e2e/smoke.sh`（4 scenarios）
- 本次改动全部是 prose 指令（agent/skill/command markdown），无可执行代码变更
- e2e_feasible: false — 纯 prose 改动无法通过自动化 e2e 验证；通过 review + dogfood 验证

---

## Implementation Plan

## Task Execution DAG

| Task | Batch | Depends on | Key files |
|------|-------|------------|-----------|
| Task 1 | A | — | `agents/plan-doc-reviewer.md` |
| Task 2 | A | — | `commands/auto.md` |
| Task 3 | A | — | `skills/flow/SKILL.md` |
| Task 4 | B | 1,2,3 | `CLAUDE.md`, `README.md` |

### Task 1：plan-doc-reviewer 新增 Plan Size WARN

**文件**：`agents/plan-doc-reviewer.md`

**改动 1a**：在 "What to Check" 表格（L22-31）末尾新增一行：

```
| Plan Size | plan 正文是否超过 500 行？超过则 WARN 建议拆分（非 BLOCK）。计算时排除 metadata comments（`<!-- ... -->`）和空行 |
```

**改动 1b**：在 "Do NOT flag these (advisory only)" 之前（L52 上方），新增 WARN 级别段落：

```markdown
**Warn-worthy issues (flag but do not block — advisory):**
- Plan 正文超过 500 行。建议按价值和依赖关系拆分为 ≤500 行的 Phase 1 + deferred 文件（`docs/plans/<topic>-deferred.md`）。用户坚持保留完整 plan 时可继续。
```

### Task 2：auto.md 加 deferred 发现 + 创建约束

**文件**：`commands/auto.md`

**改动 2a**：R0 阶段，在 "Libraries" bullet（L115）之后、"Then classify complexity"（L117）之前，新增 deferred 扫描作为 R0 research plan 的第 4 个 section：

```markdown
>   - **Deferred scope scan**：`ls docs/plans/*-deferred.md 2>/dev/null`。若存在 deferred 文件，在 R1 Explore agent 中一并读取；R2 Synthesis 中呈现给用户："发现以下 deferred scope，是否纳入本次任务？" 用户决定是否纳入。
```

**改动 2b**：brainstorming 约束区，在 E2E Assessment 最后一行（L177）之后、`<HARD-GATE>` 标签（L179）之前，新增：

```markdown
>     - **Deferred scope 创建**：若 plan-doc-reviewer 对 plan size 发出 WARN 且 agent 决定拆分，将被 defer 的 scope 写入 `docs/plans/<topic>-deferred.md`，格式见 CLAUDE.md "Deferred File Convention"。
>     - **Deferred scope 消费**：若本次 brainstorming 纳入了已有 deferred 文件的 scope，在 plan metadata 中追加 `<!-- consumed-deferred: docs/plans/xxx-deferred.md -->`（可多条）。
```

### Task 3：flow Step 5.5 加 deferred 清理

**文件**：`skills/flow/SKILL.md`

**改动 3a**：Step 5.5，在第 5 项（`.claude/skills/*/SKILL.md`，L251）之后、skill-creator 硬约束段落（L253）之前，新增第 6 项：

```markdown
6. **Deferred cleanup** — 检查 plan 文件（`$ARCHIVE_PATH`）中是否包含 `<!-- consumed-deferred: ... -->` metadata。若有，删除对应的 deferred 文件（`rm docs/plans/<topic>-deferred.md`）。这些 scope 已在本次 plan 中交付，deferred 文件完成使命。
```

### Task 4：CLAUDE.md + README.md 同步

**文件**：`CLAUDE.md`、`README.md`

**改动 4a**：`CLAUDE.md` "Key Design Constraints" 章节新增两条：

```markdown
- **Plan size advisory**：plan-doc-reviewer 对超过 500 行的 plan 发 WARN（非 BLOCK）。建议拆分为 Phase 1 + deferred 文件。用户坚持时可继续。
- **Deferred scope lifecycle**：`docs/plans/<topic>-deferred.md` 存放被 defer 的 scope。格式：`<!-- deferred-from/topic/date -->` metadata + Origin / Items / Dependencies 三段。四阶段闭环：Create（brainstorming 拆分时写入）→ Discover（auto R0 扫描呈现）→ Follow-up（brainstorming 纳入 + plan metadata `consumed-deferred`）→ Close（flow Step 5.5 删除已消费的 deferred 文件）。
```

**改动 4b**：`CLAUDE.md` "Workflow Sequence" 的 auto 流程注释中，在 `⓪ Research & Reuse` 行补充 `+ deferred scan`。

**改动 4c**：`README.md` "Workflow" `/collie:auto` 流程图（L70-81），在 `-> Research & Reuse` 行末补充 ` + deferred scope scan`。

**改动 4d**：`CLAUDE.md` "State Files" 章节——deferred 文件在 `docs/plans/` 下（git tracked），不在 `~/.collie/` 下，无需更新。

## Verification

1. `grep -n "Plan Size" agents/plan-doc-reviewer.md` — 确认新增 check category
2. `grep -n "Warn-worthy" agents/plan-doc-reviewer.md` — 确认新增 WARN 级别
3. `grep -n "deferred" commands/auto.md` — 确认 R0 扫描 + brainstorming 约束
4. `grep -n "consumed-deferred" skills/flow/SKILL.md` — 确认 Step 5.5 清理
5. `grep -n "Deferred scope lifecycle" CLAUDE.md` — 确认文档同步
6. `node --test tests/*.test.js` — 确认现有测试不受影响

## Implementation Notes

实施过程中发现的 plan 未显式覆盖的必要增量：

1. **plan-doc-reviewer output format 补充 Warnings 输出槽**：Task 1 新增了 Warn-worthy 校准级别，但 plan 未包含对应的 output format 模板修改。CR 反馈发现 agent 无法输出 WARN 级别发现（无指定输出槽），补充 `**Warnings (flag but do not block — advisory):**` 字段于 Issues 和 Recommendations 之间。Commit: `17e09ab`。

2. **CLAUDE.md Deferred File Convention 子章节**：Task 2 的 `auto.md:179` 引用了 `CLAUDE.md "Deferred File Convention"`，但 Task 4 的 4 个改动点（4a/4b/4c/4d）均未包含此子章节。doc-refresh 阶段补充，确保 auto.md 的交叉引用有效。Commit: `0034854`。
