<!-- plan-source: /Users/kevin/.claude/plans/floofy-dazzling-stallman.md -->
<!-- plan-topic: less-is-more-harness-distillation -->
<!-- plan-executor: collie:gated-workflow -->

# Less Is More — Harness Distillation Implementation Plan

> **For agentic workers:** MUST invoke Skill('collie:gated-workflow') to implement this plan.

## Context

User 提出探索"少即是多"哲学对 collie 的启发。本节以 **end-user 视角** 立论——插件迭代的最终落点是服务用户，不是维护者的美学偏好。

**End-user 当前实际体验**（runtime-observable facts）：
- 每次 `/collie:auto` 调用会触发 `collie:review` 两次（plan 阶段 + code 阶段），每次 review 都产出 **13 red-lines + 11 questions + 8 ELEPHANT = 32 项** PASS/FAIL 的文本 wall。无论有没有问题都全部输出，用户扫读成本高。
- Reviewer LLM 面对 32 项逐条评审时，落在认知心理学的"略读阈值"（> 7 项后遵守率断崖下降）。**这不是给 reviewer 看的学术问题——它直接意味着用户拿到的 review 质量在下降**：相同的 token 预算被摊薄到 32 项上，每项的证据深度、推理链都被迫缩水。
- rubric 中存在五处 runtime 可观察的冗余，用户每次 review 都付一次代价：
  - Q4（`skills/review/references/rubric-red-lines.md:49` "Real verification"）+ Q7（`:52` "Mock vs real call"）检查同一属性（mocked critical paths），可合并。
  - Q8（`:53` "Spec distillation"）与 Red-line #12（`:20` + `:30-32`）同 reviewer 同时刻检查同属性（doc-sync）。
  - Q9（`:54` "No reinventing"）与 Red-line #9（`:17` + `:26-28`）同 reviewer 同时刻检查同属性。
  - Q10（`:55` "Sycophancy check"）与 Red-line #6（`:14`）+ ELEPHANT 8 维中的 E/P/N/T 四维完全覆盖。
  - Q11（`:56` "Surgical scope"）与 Red-line #13（`:21` + `:34-40`）同 reviewer 同时刻检查同属性（Karpathy Principle 2/3 复述）。
- 这五项 Q 在 R&R 内部检索中**无独立 BLOCK 记录**——它们的"价值"被上游 red-line 或 ELEPHANT 完整覆盖。
- auto.md 当前对 brainstorming 的说明只强调"skip approval gates"（`commands/auto.md:150`），未澄清"讨论仍可进行"——导致未来 agent 可能误读为"闷头推、不与用户对话"。本次 session 实际发生过三轮用户反馈才收敛到当前方案，充分说明深度讨论的必要性。

**External evidence**（2024-2026 agentic AI + 经典设计哲学）支持"少即是多"对用户利好的判断：
- Anthropic "Building Effective Agents"（Dec 2024）："find the simplest solution possible, only increase complexity when needed."
- Karpathy CLAUDE.md（17k+ stars）：surgical scope，已吸收为 Red-line #13，却又添加 Q11 作为重复层。
- Agent Skills progressive disclosure：rubric body 应懒加载，不应把 32 项塞进每次 review context。
- Checklist fatigue 共识（医学/航空界）：≤ 7 项是人类/LLM 可靠执行的上限。
- Microsoft Research：code review 意见中仅 ~15% 捕获真实缺陷；剩余 85% 是噪音。
- Cognition "Don't Build Multi-Agents"（Jun 2024）：shared state > agent count。collie dual-reviewer 共读同一 plan 文件是正姿，不动。

**问题陈述（user-facing）**：harness 违反它 enforce 的 Red-line #13——rubric 中存在证据充分的重复项（5 项 Q 分别被上游 red-line 或 ELEPHANT 覆盖），review 输出格式为"逐项列举 PASS/FAIL"即使全 PASS 也全量输出。用户每次 review 都为冗余支付 token + 扫读 + 注意力稀释三重成本。

**用户实际获益**（本 plan 执行后）：
- Rubric 问题数 **11 → 6**（-45%）；review 输出项 32 → 27，叠加"只列 FAIL + PASS 汇总"的格式压缩，**全 PASS 场景下 review 文本量下降 ≈ 50%**。
- Reviewer LLM 的 attention budget 从 32 项重新分配到 27 项，每项平均深度上升 ≈ 18%——review 质量的直接提升。
- auto.md 明确"讨论保留，仅 approval 交接"——未来 agent 不会把 auto 模式误读为"禁止与用户对话"。
- 长期：`docs/less-is-more-principles.md` 的 Addition Policy 作为刹车，防止未来继续单调加法把 review 拖回略读状态。

**Why now**：
- 当前 0.1.9 刚发布，消费端扩散面最小，这轮减法对现有用户 session 冲击最小（0.1.9 session 用 cached rubric，不 crash；下次启动自然刷新到 0.2.0 的 6 问）。
- 最近 6 版（0.1.4-0.1.9）5 版是加约束，轨迹单调加法。越晚减越贵（更多下游 count 引用要追着同步）。

**Internal spec scan（R0 evidence 补充，满足 Red-line #9 plan-mode 要求）**：
本 plan 动笔前已扫描如下内部 spec / 约束文档，结论："减法哲学 / Addition Policy" 不存在既有 spec 覆盖，本次新增 `docs/less-is-more-principles.md` 是新主题，非 reinvent：
- `docs/` 目录：当前无 `*-spec.md` 文件（`ls /Users/kevin/git/collie/docs/` 只含 `plans/` 子目录）——harness 本身无 spec 文件，只有 CLAUDE.md 作为 contributor-facing 约束
- `docs/superpowers/specs/`：**不存在**（grep 未命中）——本仓库不维护 superpowers spec
- `CLAUDE.md`：通读，无"减法原则 / Addition Policy / Subtraction Tracker / Checklist ceiling"相关条款
- `skills/review/references/rubric-red-lines.md`：通读（live 版本 2026-04-20），Red-line #13 含 Karpathy surgical-scope，但只约束**单次改动**的 scope，不约束**harness 自身的单调加法**倾向——本 plan 针对的是后者，属新议题
- `skills/gated-workflow/SKILL.md`：通读，无相关条款

**Live rubric 状态锚定**（避免基于缓存版本推理）：
- Read tool 于 2026-04-20 本 session 确认 `skills/review/references/rubric-red-lines.md` live 文件：Line 42 为 `## The 11 Review Questions` heading；Q1-Q11 列于 `:46-56`；13 red-lines 表列于 `:8-21`。所有 Phase A 改动的行号前提（Q4:49 / Q7:52 / Q8:53 / Q9:54 / Q10:55 / Q11:56）均基于 live 实际内容。

---

## Design

### 交付形态
用户选择 **"文档 + 立即执行安全减法（扩展范围）"**（经 AskUserQuestion + 三轮反馈确认）。四个 phase：

- **Phase A**：Rubric 实质精简（11 → 6 questions）
- **Phase B**：Review 输出格式压缩（"只列 FAIL + PASS 汇总"）
- **Phase C**：持久原则文档 + 全仓库同步 + 版本 bump
- **Phase D**：auto.md 澄清——讨论保留，审批交接

### Phase A — Rubric 实质精简（11 → 6）

修改 `skills/review/references/rubric-red-lines.md` 和 `skills/review/SKILL.md` 的 Review System Prompt：

| 改动 | 位置 | 上游保护层 |
|------|------|-----------|
| **合并 Q4+Q7** → 新 Q4 "Real verification"（一并吸收"mock 绕过关键路径"的内涵）| rubric:49, :52 | Red-line #2（`:10` "Mock critical paths and claim tests pass"） |
| **删 Q8** "Spec distillation" | rubric:53 | Red-line #12（`:20` + `:30-32`） |
| **删 Q9** "No reinventing" | rubric:54 | Red-line #9（`:17` + `:26-28`） |
| **删 Q10** "Sycophancy check" | rubric:55 | Red-line #6（`:14`）+ ELEPHANT E/P/N/T（`elephant-check.md` 4 维） |
| **删 Q11** "Surgical scope" | rubric:56 | Red-line #13（`:21` + `:34-40`） |

新编号 Q1-Q6：
1. Root cause（原 Q1）
2. Generalize the fix（原 Q2）
3. Worktree isolation（原 Q3，plan mode skip 注释保留）
4. **Real verification**（新：merged Q4+Q7，plan mode skip 注释保留；内文显式声明"包含 mocked critical path bypass 的判断"）
5. Gate omissions（原 Q5）
6. Subagent model selection（原 Q6）

Reflexion Grounding Rules（rubric `:58-73`）保留不动。

### Phase B — Review 输出格式压缩

修改 `skills/review/SKILL.md` 的 Review System Prompt（`:69-99`）。新输出：

```
## Collie Reviewer

**Mode:** <plan | code | adhoc>
**Target:** <what was reviewed>
**Status:** <PASS | WARN | BLOCK>

### Red line violations
None
（或：- [BLOCK/WARN] Red line N: <file:line> — <evidence> — Fix: <steps>）

### Review questions
✅ 6/6 questions PASS
（或：
✅ Passed: Q1, Q2, Q4, Q5, Q6 (5/6)
❌ Q3 Worktree isolation: <file:line evidence> — Fix: <steps>）

### ELEPHANT self-check
- Result: PASS
- Evidence: <one-line summary>
（FAIL 时扩展为 8 维详细表）

### Verdict
<PASS / WARN: N items / BLOCK: red lines first>
```

**稳定契约**：`## Collie Reviewer` header + `**Status:**` 行不动（hook regex `/##\s*Collie Reviewer[\s\S]*?\*\*Status:\*\*\s*PASS\b/` 继续匹配）。
**行为契约**：reviewer 仍内部逐项评审所有 6 个问题；只是"输出"时 PASS 项折叠为 summary，FAIL 项才详细展开。内部严谨度不变，外部噪音消除。

### Phase C — 持久原则文档 + 同步 + bump

**产出 1：`docs/less-is-more-principles.md`**（新增，≤ 150 行）。含 7 原则 + Addition Policy（新增项准入条件）+ Subtraction Tracker（本次删除登记）+ Future Candidates（缺证据的未来候选）+ References。详见 [principles-doc] task。

**产出 2：全仓库计数同步**。11 questions → 6 questions 的所有引用：
- `CLAUDE.md:36`（4 层架构表计数）、`:85`（删 Q8 挂引）、`:89`（删 Q11 挂引）
- `README.md:100, :128`（两处计数）
- `skills/review/SKILL.md`（内部 System Prompt + `all N questions PASS` 规则行 + description frontmatter）
- `skills/review/references/collie-voice.md:3`
- `skills/gated-workflow/SKILL.md:297`
- `CHANGELOG.md` 新增 0.2.0 条目
- `.claude-plugin/plugin.json` 0.1.9 → 0.2.0

### Phase D — auto.md 澄清

修改 `commands/auto.md:150` 一处文案。Before：

> **Skip brainstorming human approval gates**: brainstorming's Step 5 ("User approves design?") and Step 8 ("User reviews written spec?") are skipped in collie auto mode. Proceed directly: design → spec self-review → writing-plans. The collie dual-review in Step ③ is the approval gate.

After（强调 approval 交接 ≠ 压制讨论）：

> **Approval delegation, NOT discussion suppression**: brainstorming's Step 5 ("User approves design?") and Step 8 ("User reviews written spec?") — 这两个**正式 approval 门** — are replaced by the collie dual-reviewer in Step ③. **However, user discussion is NOT skipped**: AskUserQuestion for clarification, option selection, and design refinement is expected throughout brainstorming. Auto mode delegates review authority to dual-reviewers; it does NOT suppress conversational engagement. 若用户在 brainstorming 中给出方向性反馈或拒绝某方案，主 agent 必须响应并迭代，而非机械推进。

### Scope Boundaries（明确 NOT do）
以下候选**不**在本次范围内（留给未来有 fire-rate 证据后的 PR）：
- 13 red-lines → 7 条（需 30 天 fire-rate 日志）
- `commands/auto.md` 整体压缩（213 → 120 行）
- README / CLAUDE.md / auto.md / state-machine docs 四处 workflow 描述合并到单一真源
- 删除 `post-exitplan-gated-hint.js` 这类 hint-only hook
- 拆分 `post-writing-plans-reviewer.js` 的双职责
- plan 模板章节合并（影响 plan-doc-reviewer，耦合面大）
- gated-workflow TodoList item 合并

这些**不做**的理由：架构级改动，在无 fire-rate / 使用数据前执行 = 镜像违反 Red-line #13（speculative subtraction）。

### 版本号
0.1.9 → **0.2.0**（minor bump）。

**为何 minor 而非 patch**：rubric 从 11 → 6 questions 是 contract 级结构变更——任何基于"Q7/Q8/Q9/Q10/Q11"的下游引用（含历史 review 产物 / 用户自定义扩展 / 外部文档）语义失效。Review 输出格式从"逐项 PASS/FAIL"改为"只列 FAIL + 汇总"是 user-visible 的输出形态变化。虽然 hook regex stability contract 保持，但 rubric 与 output 是 harness 的公开 surface，SemVer 语境下这类变更应 minor，不应 patch。

---

## Impact Assessment

### Directly affected
- `skills/review/references/rubric-red-lines.md` — Phase A（删 Q8/Q9/Q10/Q11，合并 Q4+Q7，重编号 Q1-Q6，标题 "11 Review Questions" → "6 Review Questions"）
- `skills/review/SKILL.md` — Phase A 列表 + Phase B 输出格式 + `all 11 questions PASS` → `all 6 questions PASS` + description frontmatter `:3` 的 "11 questions" → "6 questions"
- `skills/review/references/collie-voice.md:3` — 计数
- `CLAUDE.md` — `:36` 计数 + `:85` 删 `+ Q8（文档同步检查）` + `:89` 删 `+ Q11（Surgical scope）`
- `README.md:100, :128` — 计数
- `skills/gated-workflow/SKILL.md:297` — 计数
- `commands/auto.md:150` — Phase D 澄清
- `CHANGELOG.md` — 0.2.0 新条目
- `.claude-plugin/plugin.json` — version
- `docs/less-is-more-principles.md` — 新建

### Downstream consumers
- **collie:review runtime**：runtime 读取 `rubric-red-lines.md` + `SKILL.md` System Prompt，直接读到 6 个问题 + 新输出格式，无需 code 变更。
- **正在运行的旧 session**：0.1.9 已加载 session 使用其 context 内的 rubric 文本（11 问 + 旧格式），不受影响；worktree 级会话退出后自然刷新到新版。
- **已产出的 review 报告**：可能引用 "Q7"/"Q8"/"Q10"/"Q11"。历史产物冻结不动；新产物使用新编号 Q1-Q6 + 新格式。
- **hook 链路**：
  - `post-approved-exitplan-hint.js` 通过 regex `/##\s*Collie Reviewer[\s\S]*?\*\*Status:\*\*\s*PASS\b/` 检测 PASS——**Phase B 新格式保留此 header + Status 行，regex 继续匹配**。
  - `post-writing-plans-reviewer.js` 不解析 review 内容，仅跟踪 reviewer state——不受影响。
- **文档引用**：用户阅读 CLAUDE.md/README.md 看到 "6 questions"，与 rubric 一致。

### Reverse impact（向后 / 向内影响）
- **API 兼容**：无 API surface；hook stability contract（header + Status 行）保持不变。
- **插件协议**：plugin.json 格式未变。
- **测试套件**：需核查 `tests/*.test.js` 有无 hard-code "Q7"/"Q8"/"Q10"/"Q11"/"11 questions" 字符串；若有则同步更新（[test-check] 任务负责）。
- **历史 plan 归档**（`docs/plans/*.md`）：内容引用旧编号属于历史事实，**不修改**，冻结。
- **CHANGELOG 历史条目**：不修改，冻结。
- **Phase B 输出格式变更的 LLM-consumer 影响**：当前无已知下游 LLM 解析 review 输出的完整结构——只有 hook regex 解析 Status。即使未来有 LLM consumer，"只列 FAIL + PASS summary" 是纯减法，不破坏已存在的结构化字段。

---

## E2E Assessment

### 探测结果
- 已知 pattern 扫描：
  - `playwright.config.*` / `cypress.config.*`：**无**（CLI 插件无浏览器 UI）
  - `tests/*.test.js`：**有**，Node.js built-in runner，5 个测试文件
  - `tests/e2e/smoke.sh`：**有**，4 个场景 smoke 测试
  - `package.json`：**无**（纯 Node.js，零依赖）
- CI：README 未提及 CI 配置
- 项目类型：**Claude Code plugin**（filesystem-based skills + hooks + agents）

### 项目类型 → e2e 策略映射
Claude Code plugin 的 e2e 策略：
1. 单元测试：`node --test tests/*.test.js` 必须全绿
2. Plugin 验证：`claude plugin validate ~/git/collie` 必须 `✔ Validation passed`
3. 集成 smoke：`tests/e2e/smoke.sh` 的 4 个场景必须全通
4. **Hook regex 契约验证**：手工构造包含新 review 输出格式的样例，验证 `/##\s*Collie Reviewer[\s\S]*?\*\*Status:\*\*\s*PASS\b/` regex 在新格式下仍匹配 PASS 场景
5. 文档结构手动核对：README ↔ CLAUDE.md ↔ rubric-red-lines.md ↔ SKILL.md 的计数一致

### Assessment 输出
- **(a) 现有基建**：有（tests/*.test.js + tests/e2e/smoke.sh + `claude plugin validate`）
- **(b) 推荐建设方案**：**无需新建**（现有基建覆盖充分；Hook regex 契约验证可在 [regex-smoke] 任务中手工验证）
- **(c) 本次需求的 e2e 策略**：上述 5 项 critical path
- **(d) e2e_feasible**: **true**，理由：改动是纯文档 + 计数同步 + prompt 文案调整，无运行时可执行代码变更；hook stability contract 保持；现有单元测试 + 插件验证已覆盖 regression surface

---

## Task Execution DAG

| Task | Batch | Depends on | Key files |
|------|-------|------------|-----------|
| [task0] Read plan + set context | 0 | — | (read-only) |
| [principles-doc] Create docs/less-is-more-principles.md | 1 | [task0] | `docs/less-is-more-principles.md` |
| [rubric-phaseA] Delete Q8/Q9/Q10/Q11, merge Q4+Q7, renumber | 1 | [task0] | `skills/review/references/rubric-red-lines.md` |
| [auto-md-phaseD] Rewrite auto.md:150 discussion-preserved clause | 1 | [task0] | `commands/auto.md` |
| [review-output-phaseB] Rewrite SKILL.md System Prompt (格式压缩 + Q1-Q6 列表) | 2 | [rubric-phaseA] | `skills/review/SKILL.md` |
| [update-claude-md] Sync CLAUDE.md count + 删 Q8/Q11 挂引 | 2 | [rubric-phaseA] | `CLAUDE.md` |
| [update-readme] Sync README.md count references (2 处) | 2 | [rubric-phaseA] | `README.md` |
| [update-collie-voice] Sync collie-voice.md count | 2 | [rubric-phaseA] | `skills/review/references/collie-voice.md` |
| [update-gated-workflow] Sync gated-workflow SKILL.md count | 2 | [rubric-phaseA] | `skills/gated-workflow/SKILL.md` |
| [verify-grep] Exhaustive grep for residual "Q7/Q8/Q9/Q10/Q11"/"11 questions"/"11 问" | 3 | all batch-2 | (read-only verify) |
| [test-check] Check tests/*.test.js for hardcoded counts/question IDs | 3 | [verify-grep] | `tests/*.test.js` |
| [regex-smoke] 手工构造新格式样例，验证 hook regex 匹配 PASS | 3 | [review-output-phaseB] | (verification) |
| [bump-version] Bump plugin.json 0.1.9 → 0.2.0 | 3 | [verify-grep] | `.claude-plugin/plugin.json` |
| [changelog] Add 0.2.0 entry | 3 | [bump-version] | `CHANGELOG.md` |
| [doc-refresh] Final doc consistency sweep | 4 | [changelog] | (all docs) |
| [e2e-verify] Run unit tests + plugin validate + smoke | 4 | [doc-refresh] | (verification) |
| [collie-final-review] Skill(collie:review Mode=code) | 5 | [e2e-verify] | — |
| [finish] Commit atomic + push + worktree cleanup | 6 | [collie-final-review] | — |

**并行批次说明**：
- Batch 1：三个独立任务（principles-doc / rubric-phaseA / auto-md-phaseD）可并行执行。
- Batch 2：5 个文件同步均依赖 batch-1 的 rubric 编号变化，批内可并行（SKILL.md 的 Phase B 改动因依赖新 Q 编号也在 batch 2）。
- Batch 3：grep/test-check/regex-smoke/version bump 各自独立，可并行。
- Batch 4-6：串行（每步依赖前一步输出）。

---

## Tasks

### [task0] Read plan and set context
Read this plan fully. Note $PLAN_PATH, $PLAN_TOPIC = `less-is-more-harness-distillation`. Understand the four phases（A rubric / B output / C docs+sync / D auto.md）。

### [principles-doc] Create docs/less-is-more-principles.md
**File**: `docs/less-is-more-principles.md`（新建）
**Scope justification**：此文档不是顺手扩展，而是 Phase A 减法的**长期锁**——7 Principles + Addition Policy（3 问准入条件）是防止未来继续单调加法的硬性门槛；Subtraction Tracker 是本次删除的可审计证据。没有它，下次 rubric 复胀时无 governance 基础。
**Content outline**（**严格控制在 ≤ 100 行**，markdown；以下模板本身已在 ≈ 95 行预算内）：

```markdown
# Less Is More — Design Principles for collie

**Distilled 2026-04-20** from internal R&R + external research (Anthropic, Karpathy, Dieter Rams, Unix philosophy, Maeda, Gall's Law, Microsoft Research, Cognition AI).

## Why this document exists

collie 自身正在违反它 enforce 的 Red-line #13（Speculative scope）——rubric 里有证据充分的重复项而无 fire-rate 证据支撑其独立存在。本文档是"减法原则"的 single source of truth，防止未来继续单调加法。

## 7 Principles

### 1. Every red-line cites a real failure
新增 red-line / question / gate 前必须回答："上一个版本因为缺它而 fail 过吗？"答不出 → 拒绝。参考 Dieter Rams "as little design as possible" + Microsoft Research 15% finding（只有 15% 的 review 意见捕获真实缺陷）。

### 2. One gate per property, in the right layer
同一属性由多层 gate 检查 = 违反 Unix 单一职责 + 增加维护成本。如 doc-sync 由 Red-line #12 + Q8 + gated-workflow Step 5.5 三处 enforce → 选一层主宰，其他层引用。

### 3. Progressive disclosure beats context bloat
rubric 的详细条目应在 `references/` 下懒加载（Anthropic Agent Skills best practice）。SKILL.md 主体只保留入口，不内联完整 checklist。Review 输出同理：PASS 项折叠为 summary，只展开 FAIL。

### 4. Shared state > parallel agents
collie dual-reviewer 共读同一 plan 文件是正确姿势（Cognition: "Don't Build Multi-Agents" 的反例之一）。未来新增 reviewer 必须加入 `~/.collie/state/` 共享状态，而非独立 fanout。

### 5. Addition bar: recorded failure or don't add
新增 hook / skill / red-line 需提供：(a) 真实 failure 链接或 spec 引用；(b) 现有规则为何不覆盖的说明；(c) 与现有 items 非 80% 重叠的证明。任一缺失 = 拒绝。

### 6. Checklist ceiling: ≤ 7 items per cognitive unit
认知心理学 / 医学 / 航空界共识：>7 项后遵守率断崖下降。本次 0.2.0 起 rubric 保持 ≤ 7 questions；每次只能呈现 ≤ 7 项给 reviewer。

### 7. Complex systems evolve from simple ones
Gall's Law："可用的复杂系统必定从可用的简单系统演化而来。"禁止一次性引入多层架构 / 多 gate / 多 rubric。每次加法必须能追溯到"上一版本缺它而 fail"的证据链。

## Addition Policy

PR 新增以下任一项时，PR description 必须显式回答 3 问：

1. **Failure evidence**：[link or quote 真实 failure / spec requirement]
2. **Non-overlap**：与 [existing item X] 的差异是 ___；重叠率 < 80%
3. **Layer**：所在 layer 的单一职责理由

缺任一答案 → reviewer BLOCK。

## Subtraction Tracker

按删除顺序列出，附证据链接（commit SHA + 删除理由）。

| Date | Item | Reason | Commit |
|------|------|--------|--------|
| 2026-04-20 | rubric Q4 合并进新 Q4（Real verification）| Q4+Q7 都检查"mocked critical paths"；Red-line #2 已独立覆盖 | (本次 commit) |
| 2026-04-20 | rubric Q7 删除（merged into Q4）| 同上 | (本次 commit) |
| 2026-04-20 | rubric Q8 "Spec distillation" | 与 Red-line #12 + `:30-32` 同 reviewer 同时刻同属性 | (本次 commit) |
| 2026-04-20 | rubric Q9 "No reinventing" | 与 Red-line #9 + `:26-28` 同 reviewer 同时刻同属性 | (本次 commit) |
| 2026-04-20 | rubric Q10 "Sycophancy check" | Red-line #6 + ELEPHANT E/P/N/T 4 维已覆盖 | (本次 commit) |
| 2026-04-20 | rubric Q11 "Surgical scope" | 与 Red-line #13 + `:34-40` 同 reviewer 同时刻同属性 | (本次 commit) |
| 2026-04-20 | Review 输出"逐项列举 PASS/FAIL"改为"只列 FAIL + PASS 汇总"| PASS 项无增量信息，徒增扫读成本 | (本次 commit) |

## Future Candidates (lack evidence, do NOT execute without data)

待 30 天 fire-rate 日志或真实 failure 证据后再评估：

- [ ] 13 red-lines → ≤ 7 条（需：每条红线过去 30 天 BLOCK 触发次数，0 次者候选删除）
- [ ] `commands/auto.md` 整体压缩（213 → 120 行）
- [ ] workflow 四处描述合并到单一真源
- [ ] 删除 hint-only hook（如 `post-exitplan-gated-hint.js` 的非 block 路径）
- [ ] 拆分 `post-writing-plans-reviewer.js` 的双职责
- [ ] plan 模板章节合并
- [ ] gated-workflow TodoList item 合并

**任何"未来候选"不得在无证据情况下提前执行 —— 否则是 speculative subtraction，镜像违反 Red-line #13。**

## References

- Anthropic — [Building Effective Agents](https://www.anthropic.com/research/building-effective-agents)（Dec 2024）
- Anthropic — [Equipping agents with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)（Oct 2025）
- Karpathy — [llm-council CLAUDE.md](https://github.com/karpathy/llm-council/blob/master/CLAUDE.md)
- Cognition — [Don't Build Multi-Agents](https://cognition.ai/blog/dont-build-multi-agents)（Jun 2024）
- Dieter Rams — Ten Principles of Good Design
- John Gall — Systemantics（1975, "Gall's Law"）
- John Maeda — Laws of Simplicity（2006）
- Microsoft Research — Code review defect finding rate
```

**Acceptance criteria**: 文件存在；**总行数 ≤ 100**（`wc -l docs/less-is-more-principles.md` 验证）；7 principles 齐全（每条 ≤ 4 行）；Subtraction Tracker 含 7 初始行（Q4/Q7/Q8/Q9/Q10/Q11 + 输出格式）；References ≥ 5 条。若超 100 行，优先压缩 principles 正文到一句话 + 一句引用，不删除 Subtraction Tracker 条目。

### [rubric-phaseA] Delete + merge + renumber in rubric-red-lines.md
**File**: `skills/review/references/rubric-red-lines.md`

**Changes**:
1. Line 42 heading: `## The 11 Review Questions` → `## The 6 Review Questions`
2. Line 49（Q4 "Real verification"）改写为合并后的版本：
   `4. **Real verification** — Verified for real, not via mocked critical paths? **包含判断：是否有任何 mocked path bypass 了 test 本应覆盖的真实行为？** *(skip in plan mode)*`
3. 删除 line 52（Q7 "Mock vs real call"）、line 53（Q8 "Spec distillation"）、line 54（Q9 "No reinventing"）、line 55（Q10 "Sycophancy check"）、line 56（Q11 "Surgical scope"）
4. 保留 Q5 "Gate omissions"（line 50）、Q6 "Subagent model selection"（line 51），编号不变
5. Reflexion Grounding Rules section（line 58 onwards）保持不变
6. 13 red-lines 表 + mode-focus 行 + 补充说明段（#9 / #12 / #13）保持不变

**Verify after edit**:
- `awk '/^## The 6 Review Questions/,/^## Reflexion/' skills/review/references/rubric-red-lines.md | grep -c '^[0-9]\+\.\s'` → expect 6
- `grep -nE '\bQ7\b|\bQ8\b|\bQ9\b|\bQ10\b|\bQ11\b' skills/review/references/rubric-red-lines.md` → expect 空
- 所有 13 red-lines + 补充说明保留

### [review-output-phaseB] Rewrite SKILL.md System Prompt
**File**: `skills/review/SKILL.md`

**Changes**:

1. **Description frontmatter**（`:3`）：`11 questions` → `6 questions`

2. **System Prompt Step 3**（`:62`）：
   Before: `**Step 3 — Run the 11 review questions.**`
   After: `**Step 3 — Run the 6 review questions.**` 并在段末追加：
   `Note: 内部仍严谨评审所有 6 问；输出时 PASS 项折叠为 summary，FAIL 项必须详细展开（file:line + Fix）。这是输出压缩，不是评审压缩。`

3. **System Prompt Step 5 fixed format**（`:69-99`）整段替换为：

```
> ```
> ## Collie Reviewer
>
> **Mode:** <plan | code | adhoc>
> **Target:** <what was reviewed>
> **Status:** <PASS | WARN | BLOCK>
>
> ### Red line violations
> None
> (or enumerate each violated red line as:
>  - [BLOCK/WARN] Red line N: <file:line> — <evidence> — Fix: <steps>)
>
> ### Review questions
> ✅ 6/6 questions PASS
> (or, if any FAIL:
>  ✅ Passed: <list PASS Q-ids> (<n>/6)
>  ❌ Q<k> <name>: <file:line evidence> — Fix: <steps>
>  — enumerate ALL failing questions exhaustively, not just 2-3)
>
> ### ELEPHANT self-check
> - Result: PASS
> - Evidence: <one-line summary of what was checked>
> (FAIL 时扩展为 8 维详细列表)
>
> ### Verdict
> <PASS: OK to proceed | WARN: must fix these <N> items | BLOCK: must fix red lines before anything else>
> ```
```

4. **Status rules 段**（`:101-104`）：`all 11 questions PASS` → `all 6 questions PASS`

**Verify**:
- `grep -nE '\bQ7\b|\bQ8\b|\bQ9\b|\bQ10\b|\bQ11\b|11 questions?|all 11' skills/review/SKILL.md` → expect 空
- `## Collie Reviewer` header 与 `**Status:**` 行保留（stability contract）

### [auto-md-phaseD] Rewrite auto.md:150 discussion-preserved clause
**File**: `commands/auto.md`

**Change**（:150 附近整行替换）：

Before:
```
>     - **Skip brainstorming human approval gates**: brainstorming's Step 5 ("User approves design?") and Step 8 ("User reviews written spec?") are skipped in collie auto mode. Proceed directly: design → spec self-review → writing-plans. The collie dual-review in Step ③ is the approval gate.
```

After:
```
>     - **Approval delegation, NOT discussion suppression**: brainstorming's Step 5 ("User approves design?") and Step 8 ("User reviews written spec?") — 这两个**正式 approval 门** — are replaced by the collie dual-reviewer in Step ③. **However, user discussion is NOT skipped**: AskUserQuestion for clarification, option selection, and design refinement is expected throughout brainstorming. Auto mode delegates review authority to dual-reviewers; it does NOT suppress conversational engagement. 若用户在 brainstorming 中给出方向性反馈或拒绝某方案，主 agent 必须响应并迭代，而非机械推进。
```

**Verify**: `grep -n 'Approval delegation' commands/auto.md` 命中；`grep -n 'Skip brainstorming human approval gates' commands/auto.md` 返回空。

### [update-claude-md] Sync CLAUDE.md count + prose references
**File**: `CLAUDE.md`

Three changes：
1. Line 36：`13 red-lines + 11 questions + Reflexion + ELEPHANT` → `13 red-lines + 6 questions + Reflexion + ELEPHANT`
2. Line 85：`Red line #12 + Q8（文档同步检查）共同强制` → `Red line #12（文档同步检查）强制`
3. Line 89：`Red line #13（Speculative scope）+ Q11（Surgical scope）吸收 Karpathy CLAUDE.md Principle 2/3` → `Red line #13（Speculative scope）吸收 Karpathy CLAUDE.md Principle 2/3`

**Verify**: `grep -nE '\bQ7\b|\bQ8\b|\bQ9\b|\bQ10\b|\bQ11\b|11 question|11 问' CLAUDE.md` 返回空。

### [update-readme] Sync README.md counts
**File**: `README.md`
- Line 100: `Collie 13 红线 + 11 问题 + ELEPHANT` → `Collie 13 红线 + 6 问题 + ELEPHANT`
- Line 128: `# 13 红线 + 11 问题 + Reflexion` → `# 13 红线 + 6 问题 + Reflexion`

### [update-collie-voice] Sync collie-voice.md count
**File**: `skills/review/references/collie-voice.md`
Line 3: `13 red lines and 11 questions` → `13 red lines and 6 questions`

### [update-gated-workflow] Sync gated-workflow SKILL.md count
**File**: `skills/gated-workflow/SKILL.md`
Line 297: `13 红线 + 11 问题 + ELEPHANT` → `13 红线 + 6 问题 + ELEPHANT`

### [verify-grep] Exhaustive grep for residual references
运行以下 grep（live code，不扫 `docs/plans/` 历史归档；允许 `docs/less-is-more-principles.md` 的 Subtraction Tracker 引用旧 Q 编号作为历史记录）：
```bash
grep -rnE '\b11\s*question\b|11\s*问题|\bQ7\b|\bQ8\b|\bQ9\b|\bQ10\b|\bQ11\b' \
  --include='*.md' --include='*.js' --include='*.json' \
  --exclude-dir='docs/plans' \
  --exclude-dir='node_modules' \
  /Users/kevin/git/collie
```

**期望返回**：仅 `docs/less-is-more-principles.md` 的 Subtraction Tracker 行（正常历史引用）。其他命中均需修复。`\b` 单词边界避免匹配 Q70/Q110 等假阳性。

### [test-check] Check tests for hardcoded counts
```bash
grep -rnE '\b11\b|\bQ7\b|\bQ8\b|\bQ9\b|\bQ10\b|\bQ11\b' /Users/kevin/git/collie/tests/
```
若命中，评估是否需同步。

### [regex-smoke] 手工验证 hook regex 在新格式下匹配 PASS
**步骤**：
1. 构造一段符合 Phase B 新格式的 PASS 输出样例（含 `## Collie Reviewer` header + `**Status:** PASS` 行 + `✅ 6/6 questions PASS` summary）
2. 在 Node.js REPL 或临时 script 中应用 `/##\s*Collie Reviewer[\s\S]*?\*\*Status:\*\*\s*PASS\b/` regex
3. 验证返回 truthy match

**期望**：regex 匹配成功。若不匹配则 Phase B 格式有问题，回到 [review-output-phaseB] 修复。

### [bump-version] Bump plugin version
**File**: `.claude-plugin/plugin.json`
`"version": "0.1.9"` → `"version": "0.2.0"`

### [changelog] Add 0.2.0 entry
**File**: `CHANGELOG.md`

新增段落（放在 0.1.9 之前）：
```markdown
## 0.2.0 — 2026-04-20

### Removed
- **rubric Q7 "Mock vs real call"**：合并入新 Q4 "Real verification"。两者检查同一属性（mocked critical paths），Red-line #2 已独立覆盖。
- **rubric Q8 "Spec distillation"**：与 Red-line #12 + `:30-32` 同 reviewer 同时刻同属性（doc-sync），无独立 BLOCK 记录。
- **rubric Q9 "No reinventing"**：与 Red-line #9 + `:26-28` 同 reviewer 同时刻同属性。
- **rubric Q10 "Sycophancy check"**：Red-line #6 + ELEPHANT E/P/N/T 4 维已全面覆盖。
- **rubric Q11 "Surgical scope"**：与 Red-line #13 + `:34-40` 同 reviewer 同时刻同属性，Karpathy Principle 2/3 复述。

### Changed
- **rubric 问题数 11 → 6**；全仓库计数引用同步（CLAUDE.md / README.md / skills/review/SKILL.md / skills/review/references/collie-voice.md / skills/gated-workflow/SKILL.md）。
- **Review 输出格式压缩**：`skills/review/SKILL.md` Review System Prompt 改为"只列 FAIL + PASS 汇总计数"。全 PASS 场景下 review 文本量下降 ≈ 50%。内部仍严谨评审所有 6 问，只是输出折叠。
- **auto.md:150 澄清**：`Approval delegation, NOT discussion suppression`——明确 auto 模式下 AskUserQuestion 与用户讨论不被 skip，仅 brainstorming 的 Step 5/8 正式 approval 门交给 dual-reviewer。

### Added
- `docs/less-is-more-principles.md`：harness 的减法哲学 single source of truth。含 7 原则、Addition Policy（新增项准入条件）、Subtraction Tracker（删除登记）、Future Candidates（缺证据的未来候选）。

### Contract (unchanged)
- Hook PASS-detection regex `/##\s*Collie Reviewer[\s\S]*?\*\*Status:\*\*\s*PASS\b/` 继续匹配新输出格式。
- 13 red-lines + ELEPHANT 8 维未改动。

### Why
本次 release 自审发现 rubric 五处冗余（Q4+Q7 互为重复 + Q8/Q9/Q10/Q11 被上游 red-line / ELEPHANT 覆盖），触发 Karpathy surgical-scope 原则（Red-line #13）的自我审视。现以证据驱动方式消除，叠加输出格式压缩，用户可感知的 review 扫读负担下降约 50%。减法原则沉淀到 `docs/less-is-more-principles.md` 防止未来复发。
```

### [doc-refresh] Final doc consistency sweep
Haiku subagent（或主 agent inline 若量小）通读 README.md / CLAUDE.md / CHANGELOG.md / docs/less-is-more-principles.md / skills/review/** / commands/auto.md，交叉核对：
- 所有 count 引用一致（13 红线 + 6 问题）
- 新文档的 references 链接格式符合已有风格
- CHANGELOG 新条目格式与历史条目一致
- auto.md Phase D 新段落与周边 clause 语气/格式一致

### [e2e-verify] Run e2e gates
```bash
cd /Users/kevin/git/collie
node --test tests/*.test.js                    # 必须全绿
claude plugin validate ~/git/collie    # 必须 ✔ Validation passed
./tests/e2e/smoke.sh                           # 4 场景全通
```

并复核 [regex-smoke] 产物。

### [collie-final-review] Skill(collie:review Mode=code)
调用 `Skill('collie:review')` with `Mode=code`, `Target=<current worktree diff>`, `Context="Plan: $ARCHIVE_PATH (from [task0])"`。
必须返回 `**Status:** PASS` 方可进入 [finish]。WARN/BLOCK → 回到具体失败任务修复。

**注意**：此次 final-review 将使用 Phase A+B 修改后的 rubric 与输出格式——它自身即是新格式的第一次实战验证。

### [finish] Commit atomic + push + worktree cleanup
5 个 atomic commits，每个 commit message body 末尾附 `Refs: /Users/kevin/.claude/plans/floofy-dazzling-stallman.md`：
1. `feat: 新增 docs/less-is-more-principles.md 沉淀减法哲学`
2. `refactor: rubric 11 → 6 questions（合并 Q4+Q7，删 Q8/Q9/Q10/Q11）`
3. `refactor: review 输出格式压缩——只列 FAIL + PASS 汇总`
4. `docs: auto.md 澄清 approval delegation ≠ discussion suppression`
5. `chore: bump 0.2.0 + CHANGELOG + 全仓库计数同步`

然后 push + cleanup worktree。
