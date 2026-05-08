# Plan: 删除冗余的 `collie:reviewer` 瘦壳 agent

## Context

**为什么要做这件事**：`agents/reviewer.md` 是一个纯 pass-through 瘦壳，唯一逻辑是"调用 `collie:review` skill（Mode=code），原样返回输出"。它存在的历史理由是 `/auto` step ⑥ 和（被误认为的）`stop-steps-counter.js` 按名字字符串引用它。经 Explore 子 agent 全仓搜索确认:

- **`stop-steps-counter.js` 实际上不存在任何 `reviewer` 字串引用**——`agents/reviewer.md` L23 的自述是 **stale documentation**。
- 真正调用 agent 的唯一入口是 `commands/auto.md` step ⑥ 的 `Agent(subagent_type="collie:reviewer", model="opus")`。
- 其他所有 `reviewer` 相关引用（`CLAUDE.md` L36 / L52、`README.md` L9 / L25 / L40、`CHANGELOG.md` L58、`skills/review/SKILL.md` L3）都只是**描述这个瘦壳存在**的文档，删掉之后全部需要同步更新。

**收益**：

- 消除 3 层间接（`/auto` → `collie:reviewer` agent → `collie:review` skill → 内部 Agent opus subagent）中可以压掉的一层
- 消除 DRY 疑虑（目前瘦壳的存在容易让人误以为"rubric 逻辑在 agent 里"）
- 简化 plugin 外观：`plugin.json` agents 数组从 2 个减为 1 个
- 和 plan-mode 的做法对齐：plan 阶段 `collie:review` 已经是 Skill 直接并发调用，没有中间 agent shell，code 阶段应该保持一致

**正确做法**：step ⑥ 直接 `Skill("collie:review") with Mode=code, Target=<worktree diff>`，完全对齐 plan 阶段的调用方式。Skill 内部已经自己 dispatch `Agent(model="opus")` 做隔离（见 SKILL.md 描述），瘦壳 agent 没有增加任何隔离价值。

**破坏性变更说明**：`collie:reviewer` 是 0.1.0 发布时已经列入 Public Surface 的对外 API（见 `CHANGELOG.md` L58）。本次删除属于 breaking change，必须在 Unreleased 段显式记录 "Removed" 分类，并给出迁移指引："直接调用 Skill `collie:review` with Mode=code"。由于当前是 0.1.0 → 下一个小版本的过渡期、真实用户基数可假设为 ~0，且迁移是单行替换，可以直接删。

**范围边界**：

- ✅ 改：删除 agent 文件 + 6 个引用文件的文档同步
- ❌ 不改：`hooks/` 任何文件（确认无引用）、`tests/` 任何文件（确认无引用）、`docs/plans/` 历史文档（写入后不回溯）、`agents/plan-doc-reviewer.md`（不同 agent，保留）
- ❌ 不改 skill 内部逻辑：`skills/review/` 的规则、红线、rubric 全部保持原样，只改 frontmatter 描述里一句话

---

## 变更清单

### Task 1（必做）：删除 `agents/reviewer.md`

**文件**：`agents/reviewer.md`

**动作**：直接删除整个文件（31 行）。

**验证**：`ls agents/` 期望只剩 `plan-doc-reviewer.md`。

---

### Task 2（必做）：从 `plugin.json` 的 agents 数组移除条目

**文件**：`.claude-plugin/plugin.json`

**改动**：

```diff
-  "agents": ["./agents/reviewer.md", "./agents/plan-doc-reviewer.md"],
+  "agents": ["./agents/plan-doc-reviewer.md"],
```

---

### Task 3（必做）：`commands/auto.md` — 将 step ⑥ 改为直接调用 skill

**文件**：`commands/auto.md`

**必改 6 处**（全部把 `Agent(subagent_type="collie:reviewer", model="opus")` 换成 `Skill("collie:review") with Mode=code`）：

1. L15：`collie:reviewer returns` → `collie:review (Mode=code) returns`
2. L33：step ⑥ Agent call → Skill call
3. L34：`If collie:reviewer Status=PASS` → `If collie:review Status=PASS`
4. L61：Step 6 description
5. L63：completion signal condition
6. L66：WARN/BLOCK fix loop

---

### Task 4（必做）：`CLAUDE.md` — 更新架构表和 Workflow Sequence

**文件**：`CLAUDE.md`

**改动 A（L36）**：去掉 `agents/reviewer.md` thin shell 描述，改为"Called directly at both plan stage and code stage"。

**改动 B（L52）**：workflow 图中 `collie:reviewer (thin shell →...)` → `collie:review skill (Mode=code, Target=worktree diff)`。

---

### Task 5（必做）：`README.md` — 更新功能描述和工作流图

**文件**：`README.md`

**改动 A（L9）**：Layer 2 描述去掉 reviewer 瘦壳。

**改动 B（L25）**：completion signal 句子 reviewer → review(Mode=code)。

**改动 C（L40）**：workflow 图 reviewer 行 → review skill 行。

---

### Task 6（必做）：`skills/review/SKILL.md` — 更新 frontmatter 描述

**文件**：`skills/review/SKILL.md`

**改动（L3）**：`called at /auto step ⑥ via the collie:reviewer agent shell.` → `called directly at /auto step ⑥ after gated-workflow completes.`

---

### Task 7（必做）：`CHANGELOG.md` — 记录 breaking change

**文件**：`CHANGELOG.md`

**改动**：在 `## [Unreleased]` 后、`### Changed` 前插入 `### Removed` 分类，记录 breaking 移除 + 迁移路径。

---

## 关键文件清单

| 文件 | 动作 | 改动点 |
|------|------|--------|
| `agents/reviewer.md` | **删除** | 整个文件 |
| `.claude-plugin/plugin.json` | 改 | agents 数组移除一项 |
| `commands/auto.md` | 改 | 6 处 |
| `CLAUDE.md` | 改 | 2 处 |
| `README.md` | 改 | 3 处 |
| `skills/review/SKILL.md` | 改 | 1 处（L3 frontmatter） |
| `CHANGELOG.md` | 改 | Unreleased 段新增 `### Removed` |

**不改的文件**：`hooks/` 全部、`tests/` 全部、`docs/plans/` 历史文档、`agents/plan-doc-reviewer.md`

---

## 任务依赖与执行顺序

所有 7 个 task 彼此完全独立，可以全部并行 dispatch。

---

## 验证

```bash
# 插件 validation
claude plugin validate ~/git/collie   # 期望 ✔ Validation passed

# 全仓不再有 reviewer agent 引用
grep -rn "collie:reviewer" .           # 期望只命中 CHANGELOG.md（0.1.0 段 + Unreleased Removed 说明段）

# 单元测试
node --test tests/*.test.js                    # 期望全通过

# E2E smoke test
./tests/e2e/smoke.sh                           # 期望所有 scenarios 全通过
```

---

## 范围边界（明确不做）

- **不改 `skills/review/` 内部规则**：红线、rubric、ELEPHANT 全部保持原样
- **不引入新 hook**
- **不改 `stop-steps-counter.js`**：确认无引用
- **不回溯 `## [0.1.0]` changelog**：历史版本 immutable
- **不给 skill 起新别名**：当前 user 基数 ~0，保留兼容性增加 DRY 负担
