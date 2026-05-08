# Plan: 把文档维护纳入 collie 工作流

## Context

当前 collie 工作流对文档的处理**是断裂的**，且是**双向断裂**——写文档和读文档两侧都有缺口：

**写侧缺口**（plan / 实现 → 文档）：

1. **Plan 阶段**：`plan-doc-reviewer` 只检查计划的内部完整性和 spec 对齐，**不要求计划里包含文档更新任务**。哪怕一次改动明显会影响 README、CLAUDE.md 或已有 spec，计划也能在文档任务缺失的情况下获批。
2. **Rubric 不对称**：`skills/review/references/rubric-red-lines.md` 已经有 Red line #12（"New pitfall not distilled into spec"）和 Q8（Spec distillation），但 Red line #12 **只标注了 `code` mode**，plan 阶段的双 reviewer 不会据此拦截。
3. **Gated-workflow 的 TodoList 模板**没有文档更新环节，实现阶段只覆盖 task / CR / test-verify / finish。
4. **实现 → spec 的回溯**只靠 code mode 的 Red line #12 反应式捕获，没有作为显式步骤被强制。

**读侧缺口**（已有 spec → plan / 实现）：

5. **`commands/auto.md` Step 0 "Research & Reuse"** 只覆盖 web search / package registry / Context7，**不包括内部已有 spec 的检索**。动笔前没有机制提醒先去 `docs/*-spec.md` 和 `docs/superpowers/specs/` 查有没有现成的规范可参考。
6. **Rubric Red line #9 / Q9 "No reinventing"** 只覆盖代码/实现层面的复用，**不覆盖 spec 层面的复用**。plan 阶段 reviewer 不会检查"该 plan 是否咨询了相关已有 spec"。
7. **`plan-doc-reviewer` 没有 "Spec Consultation" 类目**。一个 plan 即使完全忽略已有 spec 的存在、和 spec 发生方向性偏离，只要内部一致，也能被 Approved。

**触发这次改动**：本会话讨论中用户明确两个关切——(a) plan 阶段没规划 doc 更新（写侧），(b) plan / 动作前没有机制提醒参考已有 spec（读侧）。正确的做法是把文档维护**前置到 plan 阶段强制规划 + 强制咨询**，而不是只靠事后兜底。Red line #12 / Q9 已部分覆盖写侧和读侧，只是分布不均、覆盖面不完整。

**目标结果**：

写侧：

- 任何改动用户可见行为 / 架构约束 / 已有 spec 的 plan，必须在 plan 阶段就包含对应的文档更新任务，否则被双 reviewer 拦截
- 实现阶段的 TodoList 模板显式体现这类任务（自然从 plan 继承）
- Rubric 在 plan 和 code 两种 mode 都能检查 spec 提炼是否落实

读侧：

- `commands/auto.md` Step 0 Research & Reuse 扩展"内部 spec 检索"作为第一动作
- Plan 动笔前必须先扫描 `docs/*-spec.md` 和 `docs/superpowers/specs/`，如有相关 spec 必须读完再动笔
- `plan-doc-reviewer` 新增 "Spec Consultation" 检查：plan 若未在 Context 或 References 章节引用相关已有 spec，且存在明显相关的 spec 未被咨询，block
- Rubric Q9 "No reinventing" 的描述扩展到同时覆盖代码复用和 spec 复用

范围：

- 文档限于 README / CLAUDE.md / docs/\*-spec.md / docs/superpowers/specs/\*.md（不延伸 AGENTS.md——本项目 only for Claude Code）

---

## 实施任务

### Task 1: 扩展 rubric Red line #12 到 plan mode + 扩展 Q9 覆盖 spec 复用

**文件**：`skills/review/references/rubric-red-lines.md`

**改动点**：

1. Red line #12 的 `Applies in` 列从 `code` 改为 `plan + code`
2. 该行的原引用保留，但在下方表格下面加一段说明，阐述两个 mode 的不同含义：
   - **Plan mode**：计划中必须包含对 README / CLAUDE.md / spec 的更新任务，如果改动会影响用户可见行为、架构约束或已有 spec
   - **Code mode**：实现过程中发现的新认知必须回写到 `docs/*-spec.md`（当前含义保留）
3. "Plan-mode focus" 行补上 #12：`#1, #4, #5, #6, #9, #10, #12`
4. Q8 "Spec distillation" 的描述更新为：
   > **Spec distillation** — Plan mode: plan includes doc update tasks (README / CLAUDE.md / spec) where applicable. Code mode: new insight written back to `docs/*-spec.md`.
5. **Q9 "No reinventing"** 的描述从只覆盖 implementation 扩展到同时覆盖 spec：
   > **No reinventing** — Existing implementation **or spec** to reuse / reference? Plan mode specifically: did the plan consult `docs/*-spec.md` and `docs/superpowers/specs/` before proposing a new approach?
6. Red line #9 "Reinvent the wheel" 的说明在表格下加一小段：
   > **Plan mode 额外含义**：plan 动笔前必须先扫描 `docs/*-spec.md` 和 `docs/superpowers/specs/`，如有相关 spec 必须在 plan 的 Context 或 References 章节引用。未咨询已有 spec 而提出新方案 = Red line #9 plan-mode 触发。

**验证**：`grep -n "#9\|#12\|Q8\|Q9\|Spec distillation\|No reinventing" skills/review/references/rubric-red-lines.md` 五处位置都应体现新含义。

---

### Task 2: `plan-doc-reviewer` 增加 Doc Maintenance + Spec Consultation 两个检查项

**文件**：`agents/plan-doc-reviewer.md`

**改动点**：

1. "What to Check" 表格新增两行：

   | Category | What to Look For |
   |----------|------------------|
   | Doc Maintenance | 若改动影响用户可见行为 / 架构约束 / 已有 spec，计划中是否包含对应的 README / CLAUDE.md / spec 更新任务 |
   | Spec Consultation | 动笔该 plan 前是否先扫描了 `docs/*-spec.md` 和 `docs/superpowers/specs/`；若存在相关 spec，plan 的 Context 或 References 章节是否明确引用 |

2. "Block-worthy issues" 列表新增两条：
   > - 改动涉及已有文档内容（README / CLAUDE.md / docs/\*-spec.md），但计划未包含任何文档更新任务
   > - `docs/` 下存在与本次改动直接相关的 spec 文件（例如同名主题 / 同名模块），但计划完全未引用且方案与 spec 有方向性偏离

3. "Do NOT flag these (advisory only)" 列表新增两条，避免过度触发：
   > - 纯内部重构 / 不改变用户可见行为 / 不影响任何已存在文档的改动——这类改动不需要文档任务
   > - 无相关已有 spec 时，不要因"没引用 spec"而 block（没有就是没有）

**判断标准的边界**（写进 agent 正文里，避免 reviewer 误伤）：

**Doc Maintenance 触发条件**（满足任一即需要文档更新任务）：
- 改动修改了 README 里已描述过的命令、工作流、配置项、架构
- 改动修改了 CLAUDE.md 里已描述过的约束、hook、state 文件、红线
- 改动与已有 `docs/*-spec.md` 的内容产生偏差（即代码为准 vs spec 为准的分歧）
- 改动引入了新的用户可见特性（新 command / slash / skill / agent）

豁免：纯内部重构、变量改名、测试补充、不影响任何已存在文档的 bug 修复、文档本身的改动。

**Spec Consultation 触发流程**（reviewer 实际执行）：
1. `ls docs/*-spec.md docs/superpowers/specs/*.md 2>/dev/null` 列出所有已有 spec
2. 根据主题关键词和改动涉及的模块/文件，判断哪些 spec 相关
3. 读取这些 spec 并对照 plan 是否引用 / 吸纳了其中的约束
4. 若 plan 完全未提及但 spec 明显相关 → block 并指名具体 spec 文件
5. 若确实无相关 spec → 不触发，不要强行找 spec

**验证**：重新读 `agents/plan-doc-reviewer.md` 确认四处（What to Check 两行 / Block-worthy 两条 / Advisory 两条 / 边界说明章节）都已更新。

---

### Task 3: `gated-workflow` TodoList 模板增加 `[doc-refresh]` 作为安全网

**文件**：`skills/gated-workflow/SKILL.md`

**背景**：即使 plan 阶段双 reviewer 强制了文档任务，执行阶段仍需要一个显式步骤，让 executor 对照实际实现结果做最终确认（防止实现偏离 plan 后文档被遗漏）。

**改动点**：

1. Step 1 "TodoList 结构模板" 里，在 `[test-verify]` 和 `[finish]` 之间插入：
   ```
   [doc-refresh] 对照实现结果核对 README / CLAUDE.md / spec，补更新遗漏
   ```

2. "示例" 代码块同步更新

3. 新增 "Step 5.5：文档对齐（GATE 5.95）" 章节（插在 Step 5 和 Step 6 之间）：

   ```markdown
   ## Step 5.5：文档对齐（GATE 5.95）

   ⛔ **收尾前必须完成的文档核对，不得跳过。**

   按以下顺序逐项核对：

   1. **README.md** — 如果本次改动影响了 README 中描述的命令 / 工作流 / 配置 / 架构，必须同步更新
   2. **CLAUDE.md** — 如果本次改动影响了 CLAUDE.md 中描述的约束 / hook / state 文件 / 红线，必须同步更新
   3. **docs/\*-spec.md** — 如果实现过程中发现的新认知与 spec 有偏差，或学到了新 pitfall，必须回写到对应 spec
   4. **docs/plans/** — 本次计划文档已在 Step 2 归档，无需重复

   如果 plan 阶段已规划好对应的 doc 更新任务（通过 plan-doc-reviewer 和 collie:review 的审查），这一步通常只是快速确认。
   如果没有规划，说明 plan 阶段双 reviewer 漏检，这一步就是安全网——必须补上再进入 Step 6。

   豁免情况：纯内部重构 / 不改变用户可见行为 / 不影响任何已存在文档的改动，可在 TodoList 里把 `[doc-refresh]` 直接标记为 N/A。
   ```

**验证**：重新读 `skills/gated-workflow/SKILL.md`，确认 Step 5.5 和 TodoList 模板同步更新，`[doc-refresh]` 在正确位置。

---

### Task 4: 更新 `CLAUDE.md`（collie 项目自己的）

**文件**：`CLAUDE.md`（仓库根目录）

**改动点**：

1. "Key Design Constraints" 章节新增一条：
   > - **文档维护强制**：任何 plan 若改动用户可见行为 / 架构约束 / 已有文档内容，必须包含显式的文档更新任务（README / CLAUDE.md / docs/\*-spec.md）。由 `collie:plan-doc-reviewer` 的 Doc Maintenance 检查 + `collie:review` 的 Red line #12（plan mode 扩展）共同强制。`gated-workflow` Step 5.5 作为安全网。

2. "Release Checklist" 新增一小节（在 "依赖审计" 之后）：
   ```markdown
   ### 文档同步审计

   发布前运行：
   ```bash
   grep -l "spec\|workflow\|slash command\|hook" README.md CLAUDE.md
   ```

   任何 commit 若修改了 `commands/` `hooks/` `agents/` `skills/` 下的文件，必须在同一 commit 或紧邻 commit 里同步更新 README / CLAUDE.md 中的对应描述。发布前至少手动对照一次 README 的"工作流"章节和 CLAUDE.md 的"Workflow Sequence"章节是否与实际代码一致。
   ```

**验证**：重新读 CLAUDE.md，确认两处都已补全。

---

### Task 5: `commands/auto.md` Step 0 扩展"内部 spec 检索"

**文件**：`commands/auto.md`

**背景**：当前 Step 0 Research & Reuse 只覆盖 web / registry / Context7，没有覆盖"内部已有 spec"。动笔 plan 前没有提醒先看 `docs/*-spec.md`。

**改动点**：

1. "Mandatory Sequence" 的 Step ⓪ 描述从
   > `⓪ Research & Reuse → search before building (GitHub, docs, registries)`
   
   改为
   > `⓪ Research & Reuse → check internal specs first, then search externally (GitHub, docs, registries)`

2. "Task Prompt" 的 Step 0 列表项调整顺序并新增内部 spec 一条：
   ```
   > Step 0: Research & Reuse — before designing anything, check existing work in this order:
   >   - Internal specs FIRST: scan `docs/*-spec.md` and `docs/superpowers/specs/` for relevant existing specs; read them in full if found and cite them in the plan
   >   - Web search (Google / Exa / GitHub) for how others have solved the same problem
   >   - Check package registries (npm / PyPI / crates.io / etc.) for battle-tested libraries
   >   - Use Context7 MCP to look up current docs for any relevant library or framework
   >   - Prefer adopting or wrapping a proven solution over writing net-new code
   >   - Document what you found (or ruled out) in one short paragraph before proceeding
   ```

**验证**：`grep -n "Step 0\|Research & Reuse\|Internal specs" commands/auto.md` 确认三处位置对齐。

---

### Task 6: 更新 CHANGELOG

**文件**：`CHANGELOG.md`

**改动点**：在最前面的 "Unreleased" 或下一版本条目里记录本次变更：

```markdown
### Changed
- `plan-doc-reviewer`: 增加 Doc Maintenance 检查（写侧）和 Spec Consultation 检查（读侧），plan 必须规划文档更新任务 + 动笔前咨询已有 spec
- `skills/review/references/rubric-red-lines.md`:
  - Red line #12 从 code-only 扩展到 plan + code；Q8 Spec distillation 描述同步更新
  - Red line #9 / Q9 "No reinventing" 扩展覆盖 spec 层面的复用，不只代码
- `skills/gated-workflow/SKILL.md`: TodoList 模板新增 `[doc-refresh]` 作为文档对齐安全网；新增 Step 5.5
- `commands/auto.md`: Step 0 Research & Reuse 扩展"内部 spec 检索"为第一动作
- `CLAUDE.md`: 新增"文档维护强制"设计约束 + "文档同步审计" Release Checklist
```

**验证**：`head -30 CHANGELOG.md` 确认条目写入。

---

## 关键文件清单

| 文件 | 动作 | 覆盖侧 |
|------|------|------|
| `skills/review/references/rubric-red-lines.md` | 改（Task 1） | 写侧 + 读侧 |
| `agents/plan-doc-reviewer.md` | 改（Task 2） | 写侧 + 读侧 |
| `skills/gated-workflow/SKILL.md` | 改（Task 3） | 写侧 |
| `CLAUDE.md` | 改（Task 4） | 写侧 |
| `commands/auto.md` | 改（Task 5） | 读侧 |
| `CHANGELOG.md` | 改（Task 6） | 记录 |

**不改的文件**（明确留白）：

- `agents/reviewer.md` — 是 thin shell，逻辑全在 `skills/review/`，不需要改
- `skills/queue/SKILL.md` — 不涉及文档维护
- 不新建 `AGENTS.md` — 本项目 only for Claude Code

---

## 任务依赖与并行度

- Task 1、2、3、4、5 彼此独立，可并行 dispatch
- Task 6（CHANGELOG）依赖 1-5 完成后写入最终描述
- gated-workflow 执行时可分为两个 batch：
  - batch-1：Task 1, 2, 3, 4, 5（并行 dispatch 给 subagent）
  - batch-2：Task 6（依赖 batch-1）
  - CR tasks 一批批跟随

---

## 验证

**端到端验证**（不写新的测试，用现有 smoke test + 手工检查）：

1. **静态检查**：
   ```bash
   node --test tests/*.test.js                # 期望全通过
   claude plugin validate ~/git/collie  # 期望 ✔ Validation passed
   ```

2. **Rubric 内部一致性**：
   ```bash
   grep -n "#12\|plan + code" skills/review/references/rubric-red-lines.md
   ```
   期望：Red line #12 的 Applies 列为 `plan + code`，Plan-mode focus 行包含 #12

3. **plan-doc-reviewer 完整性**：Read agent 文件，确认 What to Check、Block-worthy、Advisory 三处都有 Doc Maintenance 相关条目

4. **gated-workflow TodoList 模板一致性**：Read SKILL.md，确认模板、示例、Step 5.5 三处同步

5. **Dogfood 回路**：发布前按 CLAUDE.md 要求调用 `superpowers:verification-before-completion` + `superpowers:requesting-code-review`（不必现在做，但这次改动本身会增加下次 dogfood 的覆盖面）

6. **现场复盘**：本次 plan 和本次实施改动本身，是否符合新规则？
   - 本 plan 已包含 Task 4（更新 CLAUDE.md）和 Task 5（更新 CHANGELOG）→ ✓ 满足新规则
   - 如果漏掉这两个，就是这次改动自己违反了新增的 Doc Maintenance 检查——自洽性测试

---

## 范围边界（明确不做）

- **不修改外部 superpowers skill**：`writing-plans` / `brainstorming` / `finishing-a-development-branch` 都是外部 plugin，不能改。doc 维护靠 collie 自己的两个 reviewer + gated-workflow 在自己的边界内强制
- **不引入新的 hook**：现有 hook 机制已经足够（双 reviewer 握手），不需要新增 PostToolUse 检查文档内容
- **不写新的自动化检查工具**：文档是否"同步"是语义问题，不是机械检查能覆盖的；靠 reviewer 的判断力 + Release Checklist 的人工对照
- **不延伸到 AGENTS.md / GEMINI.md**：本项目只服务 Claude Code
