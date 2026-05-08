<!-- plan-source: /Users/kevin/.claude/plans/harness-plugin-spec-cover-skill-vibecod-eventual-engelbart.md -->
<!-- plan-topic: spec-and-skill-symmetric-discipline -->
<!-- plan-executor: collie:gated-workflow -->

# Spec + 项目级 Skill 同等纪律 — Implementation Plan

> **For agentic workers:** MUST invoke Skill('collie:gated-workflow') to implement this plan.

## Context

collie 已对 **spec** 建立了"参考 + 提炼 + 更新"的完整纪律：
- **参考**：`commands/auto.md` R&R 的 R0 扫 `docs/*-spec.md`
- **提炼**：`skills/review/references/rubric-red-lines.md:20` Red line #12 拦截未沉淀的新认知
- **更新**：`skills/gated-workflow/SKILL.md` Step 5.5 `[doc-refresh]` 审视 spec 文档
- **结构把关**：`agents/plan-doc-reviewer.md` Doc Maintenance 检查 plan 是否包含 spec 更新任务

**当前缺口**：**项目级** skill（`.claude/skills/*/SKILL.md`——项目专属 SOP，跟项目 git 仓库走、跨开发者共享）没有被同等纳入。VibeCoding 场景里人只掌舵，本项目的"怎么做"知识（SOP / 操作清单）和"是什么"知识（契约 / 不变式）都需要机械化捕获；当前只覆盖了后者。

### 明确排除（避免膨胀，回应 less-is-more）

- **用户级 skill**（`~/.claude/skills/`）——跨项目复用的通用手法，**本 harness 不涉及**
- **自进化 / 记忆 / evolution-log / candidates.md / promote 脚本 / Mode=distill / AskUserQuestion gate / reuse-hints**——记忆并进化是独立大课题，目前无真实失败证据推动，暂不做（守 Addition Bar）
- **新建 spec 文件 / 新建 CLAUDE.md 章节**——本次纯 prose 扩写，不新建文件

### Addition Bar 达标证据

本次改动引用的历史失败：
- `docs/plans/2026-04-14-collie-reviewer-unify-plan.md:15` —— 自认"未沉淀到 spec"是盲区；skill 未被提及属于同一盲区的另一面
- `CHANGELOG.md:18,158` —— rubric Q8 "Spec distillation" 曾独立新增、后坍塌到 Red line #12，但 skill 同类问题始终未进入红线
- `merge c8f09e2` —— 上周 `less-is-more-harness-distillation` 分支专门做人工一次性 distill，印证机制缺失

---

## Design

### Spec vs 项目级 Skill 分界（写进 Red line #12 补充说明）

| | Spec（`docs/*-spec.md`） | 项目级 Skill（`.claude/skills/*/SKILL.md`） |
|---|---|---|
| 性质 | **声明式**：项目**契约 / 不变式**（is） | **过程式**：项目**SOP / 操作清单**（how） |
| 例子 | "article API rate-limit 基线 100/min"<br>"auth 使用 JWT sub claim 作为 user_id" | "本项目新增 API 接口的 5 步清单"<br>"本项目 release 触发流程" |
| 跨项目复用 | ❌ 项目专属 | ❌ 项目专属（依赖本项目路径/工具链/命名） |

**判断启发**：skill body 能否在另一项目直接跑通？
- 能 → 是**用户级** skill（`~/.claude/skills/`），本 harness 不收
- 不能 → 项目级 skill，进入 Red line #12 审视范围

### 4 个锚点 symmetric 扩写

在现有 4 个锚点上对称扩写 skill 纪律——不开新 skill / 新 agent / 新脚本 / 新 hook / 新正则 / 新状态文件 / 新 Mode / 新测试逻辑。

```
参考（R&R）        → scan list 多一条 .claude/skills/*/SKILL.md
提炼（Red line #12）→ red-line 措辞加 "or project-level skill" + 补充分界说明
更新（Step 5.5）   → 审视范围 + 强制走 Skill('skill-creator')
把关（plan-doc-reviewer）→ Doc Maintenance 检查覆盖 skill
```

### 关键约束：skill 新建/更新必须走 `/skill-creator`

meta-skill 位于 `~/.claude/skills/skill-creator/`（通过 `Skill('skill-creator')` 或 `/skill-creator` 调用），强制其 frontmatter / Concise is Key / references 结构约定。**禁止 prose 自由写入** `.claude/skills/<slug>/SKILL.md`——保证产出的 skill 可被任意 Claude session 正确发现和加载，不会因结构错乱失效。

---

## Impact Assessment

### Directly affected
- `commands/auto.md` —— R0 "Internal specs to scan" 行扩写
- `skills/review/references/rubric-red-lines.md` —— Red line #12 措辞 + 补充说明段
- `skills/gated-workflow/SKILL.md` —— Step 5.5 `[doc-refresh]` 范围 + skill-creator 强制引用
- `agents/plan-doc-reviewer.md` —— Doc Maintenance 检查清单
- `CHANGELOG.md` + `.claude-plugin/plugin.json` —— 版本 bump

### Downstream consumers
- `skills/review/SKILL.md` —— **无改动**（Red line #12 实体在 rubric-red-lines.md，review skill 通过 include 自动生效）
- `tests/*.test.js` + `tests/e2e/smoke.sh` —— **无改动**（纯 prose 扩写，无新代码路径）
- 下游用户项目 ——
  - 首次接入：项目若无 `.claude/skills/` 目录，R&R 扫描返空（grep/glob 容错），不报错
  - 持续使用：[doc-refresh] 若检出项目级 skill 候选，走 `/skill-creator` 创建；不强制每次 session 产出 skill——候选为零合法

### Reverse impact
- **无**状态文件 / hook / 正则 / 依赖变化
- 已有 session 不受影响——旧版本生成的 `docs/*-spec.md` 和 `.claude/skills/` 内容照常被扫

### Scope discipline（Red line #13）
本 plan 所有改动必须可追溯到 Design 4 个锚点之一 + 版本管理收尾。**显式不做**的清单见 Context 节"明确排除"。

---

## E2E Assessment

### 现有基建探测
- 测试：Node.js built-in runner (`node --test tests/*.test.js`) + `tests/e2e/smoke.sh` 4 scenarios
- 项目类型：Claude Code plugin（hooks + skills + md 文件 + 少量 JS 工具脚本），无浏览器 UI

### 策略映射
本次改动 = **纯 prose 扩写**，无新代码路径、无新 JS 逻辑、无新文件格式需要解析。
- **无需新增 e2e scenario**
- 现有 smoke.sh 4 scenarios 不会受影响（regex / hook 行为未变）

### Assessment 输出
- **现有基建**：有（smoke.sh），本次无需扩展
- **本次需求 e2e 策略**：手动 dogfood 一次 `/collie:auto "trivial task"`，观察 transcript 中 R&R 扫描记录与 [doc-refresh] 审视行为
- **e2e_feasible: true**（手动 dogfood 即可；无需自动化，因为纯 prose 改动）

---

## Task Execution DAG

| Task | Batch | Depends on | Key files |
|------|-------|------------|-----------|
| [task-1] R&R scan list 扩写（单 Explore agent，加 `.claude/skills/*/SKILL.md`） | B1 | — | `commands/auto.md` |
| [task-2] Red line #12 扩写 + spec/skill 分界补充说明段 | B1 | — | `skills/review/references/rubric-red-lines.md` |
| [task-3] Step 5.5 `[doc-refresh]` 扩写 + `Skill('skill-creator')` 强制引用 | B1 | — | `skills/gated-workflow/SKILL.md` |
| [task-4] plan-doc-reviewer Doc Maintenance 扩写（skill 一并检查） | B1 | — | `agents/plan-doc-reviewer.md` |
| [task-5] Dogfood + CHANGELOG + version bump `0.2.1 → 0.2.2` | B2 | task-1..4 | `CHANGELOG.md`, `.claude-plugin/plugin.json` |

**并行度**：B1 四任务全部独立，单条消息并行派发；B2 单任务最终收尾。

**无 TDD 需求**：本次改动是对现有 prose 的扩写，没有新代码逻辑；已有测试不会 break，也不需要为 prose 增删写新测试（会是噪音）。

---

## Tasks — detail

### B1

#### [task-1] R&R scan list 扩写

- 文件：`commands/auto.md`
- 当前 R0 "Internal specs to scan（**必做**）" 段落列出 `docs/*-spec.md` / `docs/superpowers/specs/` / `CLAUDE.md` / relevant `skills/*/SKILL.md`
- 改动：
  1. 段首标题从 "Internal specs to scan" 改为 "Internal **specs + project-level skills** to scan"
  2. 扫描路径清单追加一行：`.claude/skills/*/SKILL.md`（项目级 skill——项目专属 SOP；**不扫** `~/.claude/skills/`，那是用户级）
  3. 明示："R1 仍使用**同一个** Explore agent 完成 specs + skills 扫描，无需为 skills 拆单独 agent（grep/glob 成本不变）"
- 不改：complexity 分级逻辑 / R0/R1/R2 三段结构 / haiku vs sonnet 决策
- 验收：`grep -n '.claude/skills' commands/auto.md` 命中；`grep -n 'Internal specs.*to scan' commands/auto.md` 命中新标题

#### [task-2] Red line #12 扩写 + 分界说明

- 文件：`skills/review/references/rubric-red-lines.md`
- 改表格第 12 行的 "Red-line behavior" 列：
  - 旧：`New pitfall not distilled into spec`
  - 新：`New pitfall not distilled into spec **or project-level skill**`
- 在现有 "### Red line #12 — 补充说明" 段末追加（保留原 plan-mode 含义不动，新增一个小节）：
  ```md
  **Spec vs 项目级 Skill 分界**（两者都是项目专属；都要走"参考 + 提炼 + 更新"纪律）：

  | | Spec（`docs/*-spec.md`） | 项目级 Skill（`.claude/skills/*/SKILL.md`） |
  |---|---|---|
  | 性质 | 声明式：项目**契约 / 不变式**（is） | 过程式：项目**SOP / 操作清单**（how） |
  | 例 | rate-limit 基线值、auth claim 结构 | 本项目 migration 步骤、release 触发流程 |

  **判断启发**：skill body 能否在另一项目直接跑通？
  - 能 → 用户级 skill（`~/.claude/skills/`），**本 harness 不涉及**
  - 不能 → 项目级 skill，Red line #12 一并审视

  新建或更新项目级 skill 必须走 `Skill('skill-creator')`（详见 `skills/gated-workflow/SKILL.md` Step 5.5）。
  ```
- 验收：`grep -n 'project-level skill' rubric-red-lines.md` 命中；分界表和判断启发都存在

#### [task-3] Step 5.5 `[doc-refresh]` 扩写 + skill-creator 强制引用

- 文件：`skills/gated-workflow/SKILL.md`
- 当前 Step 5.5 审视 README / CLAUDE.md / `docs/*-spec.md` 是否需要更新
- 改动：
  1. 审视清单扩为：README / CLAUDE.md / `docs/*-spec.md` / **`.claude/skills/*/SKILL.md`**
  2. 追加明示段：
     ```md
     **新增或更新项目级 skill 时的硬约束**：必须调用 `Skill('skill-creator')`（meta-skill 位于 `~/.claude/skills/skill-creator/`）生成或更新 `.claude/skills/<slug>/SKILL.md`。**禁止 free-form prose 写入**——这保证产出的 skill 遵守 frontmatter / Concise is Key / references 规范，能被其他 Claude session 正确发现和加载。

     判断"是否需要新增/更新 skill"的启发见 `skills/review/references/rubric-red-lines.md` Red line #12 补充说明。
     ```
- 不改：Step 5.5 在 TodoList 中的位置、与前后 Step 的依赖、worktree 机制、escalation 行为
- 验收：`grep -n 'skill-creator' skills/gated-workflow/SKILL.md` 命中；`grep -n '.claude/skills' skills/gated-workflow/SKILL.md` 命中

#### [task-4] plan-doc-reviewer Doc Maintenance 扩写

- 文件：`agents/plan-doc-reviewer.md`
- 当前 Doc Maintenance 检查 plan 是否包含 README / CLAUDE.md / `docs/*-spec.md` 的更新任务（若改动影响用户可见行为 / 架构约束 / 已有 spec）
- 改动：
  1. 检查清单扩为同时覆盖 `.claude/skills/*/SKILL.md`：若 plan 的改动性质属于"本项目 SOP/操作流程的标准化"（新增标准步骤清单、发现重复性操作可模板化），plan 必须包含项目级 skill 的新建/更新任务，且该任务必须明示调用 `Skill('skill-creator')`
  2. 判断启发同 Red line #12 补充说明（引用路径，避免重复）
- 不改：其他 reviewer 检查项（Impact Assessment / E2E Assessment / Task DAG / TDD 等）
- 验收：`grep -n 'project-level skill\|.claude/skills' agents/plan-doc-reviewer.md` 命中

### B2

#### [task-5] Dogfood + 委托 `Skill('publish')` 完成 release

**分两步。第一步是本 plan 独有的 dogfood 验证，第二步直接调 publish skill——避免重造已有 release 流程（Red line #9）。**

**5a. Dogfood 验证**（本 plan 独有，publish 不覆盖）：
手动跑一次 `/collie:auto "trivial task"`（例如"在 README 末尾加一行 footer"），观察：
1. R&R transcript 体现 `.claude/skills/*/SKILL.md` 扫描（task-1 扩写生效证据）
2. [doc-refresh] Step 审视 skill 目录，哪怕无候选也要体现（task-3 扩写生效证据）
3. plan-doc-reviewer 运行时对 skill 候选有判断动作（task-4 扩写生效证据）
4. 无 regression：`node --test tests/*.test.js` 全绿；`./tests/e2e/smoke.sh` 4 scenarios 全过

**5b. 调用 `Skill('publish')` 完成 release**（位于 `~/.claude/plugins/.../skills/publish/SKILL.md`）：
publish skill 会按 Step 1–3 顺序自动完成：
- Step 1：plugin validate + unit tests + 内部引用扫描 + 入口对应表审计
- Step 2：读 `.claude-plugin/marketplace.json` 当前 version，判断 tag 冲突，必要时 bump `0.2.1 → 0.2.2`（patch——纯 prose 扩写，兼容）
- Step 2.5：写 `CHANGELOG.md` `## [0.2.2] - 2026-04-21` 节（内容清单见下，作为给 publish skill 的 context），atomic commit
- Step 3：`git tag v0.2.2 && git push origin master && git push origin v0.2.2`

**提供给 publish skill 的 CHANGELOG 内容（调用时粘进 context）：**
```md
### Changed
- Red line #12 扩到覆盖"未沉淀到项目级 skill"；rubric-red-lines.md 新增 spec vs 项目级 skill 分界说明
- Step 5.5 `[doc-refresh]` 审视范围包含 `.claude/skills/*/SKILL.md`；新增/更新 skill 强制走 `Skill('skill-creator')`
- R&R 的 R0/R1 扫描范围同时覆盖 `docs/*-spec.md` + `.claude/skills/*/SKILL.md`（单 Explore agent）
- plan-doc-reviewer Doc Maintenance 检查同时覆盖项目级 skill 更新任务

### Excluded (explicit non-scope)
- 用户级 skill（`~/.claude/skills/`）本 harness 不干预
- 自进化 / 记忆 / evolution-log / candidates.md / promote 自动化 —— 留待真实失败证据推动

Refs: `~/.claude/plans/harness-plugin-spec-cover-skill-vibecod-eventual-engelbart.md`
```

---

## Verification

### 自动化（CI-runnable）

```bash
node --test tests/*.test.js              # 期望 all pass（无 test 改动）
./tests/e2e/smoke.sh                     # 期望 4/4 pass
claude plugin validate ~/git/collie   # 期望 ✔

# 扩写锚点全命中
grep -n '.claude/skills' commands/auto.md
grep -n 'project-level skill' skills/review/references/rubric-red-lines.md
grep -n 'skill-creator' skills/gated-workflow/SKILL.md
grep -n '.claude/skills\|project-level skill' agents/plan-doc-reviewer.md

# 入口对应表
ls commands/ skills/*/SKILL.md agents/*.md   # 无新增 = 预期
```

### 手动 dogfood（task-5）

- 跑 `/collie:auto "在 README 末尾加一行 footer"` 完整走通
- 观察 R&R transcript 是否扫了 `.claude/skills/`
- 观察 Step 5.5 [doc-refresh] 是否提及对 skill 的审视
- 观察无 `.claude/skills/` 目录时是否报错（预期：不报错，grep/glob 返空）

### 发布前必须项（遵循 CLAUDE.md 发布清单）

- [ ] 入口对应表审计（无新增文件 → 对应表未变）
- [ ] `claude plugin validate` ✔
- [ ] `node --test tests/*.test.js` all pass
- [ ] `grep -rn '<USER>\|"kevin"' .claude-plugin/ README.md LICENSE` 返空
- [ ] Atomic commits；每个 task 一个 commit，禁用 `git add -A`
- [ ] 文档同步：本次不改 README / CLAUDE.md（本计划范围显式排除），无需对照
- [ ] dogfood `superpowers:verification-before-completion` + `superpowers:requesting-code-review`
