<!-- plan-source: /Users/kevin/.claude/plans/snappy-inventing-charm.md -->
<!-- plan-topic: rename-loop-to-autoiter -->
<!-- plan-executor: collie:gated-workflow -->

# Rename `loop` to `autoiter` + Define Orchestrator Contract — Implementation Plan

> **For agentic workers:** MUST invoke Skill('collie:gated-workflow') to implement this plan.

## Context

**问题 1**：`/collie:loop` 与 Claude Code 内置全局 `loop` skill（Run a prompt or slash command on a recurring interval — `/loop 5m /foo`）重名。当前会话的 system reminder 中 `loop` 已被列入可调用的全局 skill 列表。用户在不带 `collie:` 前缀键入 `/loop` 时，路由二义；命名冲突已成事实而非潜在风险。

**问题 2**：`skills/loop/SKILL.md` 在 Stage 2-6 的执行段没有"主 session 仅做协调"的硬性约束。R&R 验证：
- Stage 3.2 fix 应用：明文"Apply fix in worktree"（line 329），暗示主 agent 直接落盘
- Stage 5.0 fix-plan：`references/iter-prompt.md` line 221 显式 "performed by the main loop agent, not a subagent"
- Stage 5.2 G6 audit：标题即 "INLINE, after Stage 5.1 returns"
- Stage 5.3 rerun + scalar parse：bash inline 直接执行
- Stage 6 rollback：`git revert --no-commit` inline

对比金标准 `skills/gated-workflow/SKILL.md` Step 3 / 5.7 / Plan-Reader subagent，三处都有 ⛔ 明文禁止主 session 写代码 / 读 plan / 自审。loop SKILL 缺这种 contract 形成执行漂移。

**预期结果**：
1. 命令重命名为 `/collie:autoiter`，全部 ~40 处引用同步迁移，无遗漏；hook regex + fixture test 原子改动
2. `skills/autoiter/SKILL.md` 新增 Section 0「Orchestrator Contract」+ 5 处 stage 的 dispatch 提示，约束主 session 行为
3. CHANGELOG 标注 0.3.0 entry（dogfood 项目，无外部用户迁移负担），环境变量 + 状态目录 + plan-kind 全硬切

---

## Research & Reuse

**Internal specs scanned**：
- `CLAUDE.md`（项目级 SOP）— Loop Workflow 章节、5 个环境变量约束、嵌套禁止规则
- `README.md` — 第 98-119 行 Loop 章节、第 156 行目录树、第 186-188 行状态路径
- `commands/loop.md` — 51 行 thin shim
- `skills/loop/SKILL.md` — 主 orchestrator（611+ 行，11 个 stage）
- `skills/loop-prepare/SKILL.md` — 前置体检
- `skills/loop/references/{overfit-guards,stop-criterion,iter-prompt,discovery-prompt,fix-plan-template}.md`
- `skills/loop/lib/jaccard.js`
- `skills/queue/SKILL.md` — task schema `command` enum
- `hooks/_state.js` — **唯一 JS 路径源**（`loopDir`/`currentRunFile`/`iterDir`，三个常量化函数）
- `hooks/post-writing-plans-reviewer.js` — `plan-kind: loop-stage0` regex 旁路（line 109+）
- `hooks/hooks.json` description 含 generic "loop detection"（指 stop-hook 陷阱，**非本次范围**）
- `tests/loop.test.js` — 31 个测试，含 3 个 hook bypass fixture 测试
- `tests/e2e/smoke.sh` — scenario 5 `e2e-05-loop-shim`
- `.claude-plugin/plugin.json` — manifest（目录化注册，目录改名即生效）
- `.claude-plugin/marketplace.json` — description 含 generic "loop detection"
- `CHANGELOG.md` — 0.2.3 引入 loop，0.2.4 是当前版本

**Reused patterns**（避免重复发明）：
- ⛔ 主 session 禁止语言：移植 `skills/gated-workflow/SKILL.md` Step 3 / 5.7 / Plan-Reader 的 contract 风格（已是项目内金标准）
- 自包含 prompt 模板：复用 `commands/auto.md` R1 fan-out 与 dual reviewer dispatch 的 Agent prompt 写法
- 路径集中点：保留 `hooks/_state.js` 三函数封装，仅改路径段常量字符串 `'loop'` → `'autoiter'`
- 元数据 hook 校验：保留 `post-writing-plans-reviewer.js` regex 框架，仅替换 enum 字面量

**External**：本次为内部 rename + skill 内容更新，无外部库依赖；用户全局 `CLAUDE.md` 的"Subagent 派发策略"章节是 orchestrator contract 的源约束（已读取）。

---

## Design Spec

### Section 1 — Rename Mapping（统一字面量映射表）

| 维度 | 旧值 | 新值 | 影响文件数 |
|------|------|------|----------|
| Slash 命令 | `/collie:loop` | `/collie:autoiter` | ~25 处文档引用 |
| 主 Skill 名 | `collie:loop` | `collie:autoiter` | SKILL.md frontmatter 1 处 + 引用 ~10 处 |
| 子 Skill 名 | `collie:loop-prepare` | `collie:autoiter-prepare` | SKILL.md frontmatter 1 处 + 引用 ~3 处 |
| 命令文件路径 | `commands/loop.md` | `commands/autoiter.md` | git mv |
| 主 Skill 目录 | `skills/loop/`（含 SKILL.md + lib/ + references/） | `skills/autoiter/` | git mv |
| 子 Skill 目录 | `skills/loop-prepare/` | `skills/autoiter-prepare/` | git mv |
| 状态目录段 | `~/.collie/loop/{project-id}/` | `~/.collie/autoiter/{project-id}/` | `_state.js` 1 处常量 |
| 状态函数名（保持不变）| `loopDir / currentRunFile / iterDir` | **保留旧名**（避免 churn 影响 stop-hook 等通用调用方）| — |
| Worktree 前缀 | `.worktrees/loop-{runId}` | `.worktrees/autoiter-{runId}` | SKILL.md ~3 处 |
| 环境变量 ×5 | `COLLIE_LOOP_{ACTIVE,NOTIFY_CMD,EVENT,RUN_ID,STATUS_FILE}` | `COLLIE_AUTOITER_{ACTIVE,NOTIFY_CMD,EVENT,RUN_ID,STATUS_FILE}` | **硬切**，无 fallback |
| Hook plan-kind | `loop-stage0` | `autoiter-stage0` | hook regex 1 处 + fixture test 3 处（原子 commit）|
| Hook plan-executor | `collie:loop` | `collie:autoiter` | hook regex 1 处 + fixture test 2 处 |
| Sentinel 字符串 | `Collie: LOOP DONE` | `Collie: AUTOITER DONE` | commands/autoiter.md + SKILL.md ~2 处 |
| `plan-topic` 内嵌默认值 | `loop-iter-N-fixes` | `autoiter-iter-N-fixes` | references/fix-plan-template.md 1 处 |
| 章节标题 / 散文术语 | "Loop Workflow", "/loop 循环" 等 | "Autoiter Workflow", "/autoiter 循环" 等 | CLAUDE.md / README.md / CHANGELOG.md |
| Queue schema enum | `command: /collie:loop` | `command: /collie:autoiter` | skills/queue/SKILL.md ~5 处 |

**保留不动的 "loop" 字串**（语义无关或外部依赖）：
- `loop_on_same_error` — stop-hook 通用 escalation event code（跨 auto/autoiter 共用，不属本次范围）
- `ralph-loop` — 外部插件依赖名
- `hooks.json` description "loop detection" — 指 stop-hook 的步数陷阱检测（与命令名无关）
- `marketplace.json` description "loop detection" — 同上
- `iter-N/` 目录段 — iteration 通用术语，与命名空间无冲突
- `docs/plans/2026-04-24-loop-command-plan.md` — 历史快照，不触碰
- `tests/stop-steps-counter.test.js` 中含 `loop_on_same_error` 字串的测试 — 通用 escalation code 测试

---

### Section 2 — Orchestrator Contract（新增 Section 0 + 5 处 stage 裁定提醒）

#### 2.1 SKILL 顶部新增 Section 0

放在 `skills/autoiter/SKILL.md` 的 `# collie:autoiter — Main Loop Orchestrator` 标题之下，**§3.5 Entry State Machine 之前**，作为所有 stage 的元约束。文本（最终落地以此为准）：

```markdown
## Section 0 — Orchestrator Contract（必读，约束所有 stage）

⛔ **主 session 是协调器，不是执行器。**

### 主 session 禁止做的事

- ❌ 读项目源代码（src 文件）
- ❌ grep / find / 全文搜索项目代码（除单点 hash/scalar 提取）
- ❌ 写实现代码 / 修复代码
- ❌ 解析 > 50 行日志
- ❌ inline 执行 git revert / git reset --hard 实质操作

### 主 session 必须做的事

- ✅ 决策（基于 subagent 输出）
- ✅ dispatch 子 agent + 状态文件读写
- ✅ 写 status.md / progress.md / fix-plan.md（汇总 subagent 输出）
- ✅ 触发外部命令（trigger / rerun bash 启动）但不解析 stdout

### 主 session 例外项（明文允许 inline）

仅以下 5 类操作允许 inline，逻辑上是单点动作：

1. Stage 2 `nohup bash` 启动 trigger（单行命令）
2. Stage 5.0 写 `fix-plan.md`（仅汇总 4b deep-verify 输出，禁止读源码）
3. Stage 5.2 `git diff HEAD~1..HEAD --name-only`（单行 git，结果不解析）
4. 状态文件 IO（`~/.collie/autoiter/...` 下的 status / progress / state）
5. iter 边界的目录创建（`mkdir -p iter-N/`）

### Subagent 派发裁定基准（主 agent 自主裁定，不在 plan 硬编码）

每次需要执行操作时，主 agent 按以下基准**自主裁定** inline vs dispatch + model：

**裁定步骤**：
1. 此步是"决策"还是"执行"？决策 inline，执行 dispatch
2. 输入是否会污染主 agent 上下文（log / source code / 大返回）？是 → dispatch
3. 选 model：参考用户 `~/.claude/CLAUDE.md` 中的"Agent 模型选择速查"+"Subagent 派发策略"两节

**Agent 模型选择速查**（节选自用户 CLAUDE.md）：
- `Explore` → haiku（文件搜索、代码分析、只读探索）
- `general-purpose 轻量` → haiku（文档生成、简单分析）
- `general-purpose 标准` → sonnet（代码实现、中等复杂度）
- `general-purpose 复杂` → opus（架构决策、复杂重构）
- `code-reviewer` → sonnet
- `Plan` → opus（架构设计、规划）

**典型应用例子**（参考，非强制；具体 stage 由主 agent 实时裁定）：
- 应用 fix patch 到 worktree → 实现型 → dispatch sonnet
- 解析 raw.log 提 scalar → 文档/分析型 → dispatch haiku
- 写 fix-plan.md 综合 → 决策型 → inline（受 §例外项 #2 约束）
- 跑 git revert + verify hash → 执行型 → dispatch haiku
- Triage / Deep Verify → 复杂推理型 → dispatch opus（这是历史不变式，contract test 强制）

### 历史不变式（contract test 强制保留）

- Stage 4a/4b（Triage / Deep Verify）必须保持 opus subagent，不可降为 inline 或更低 model
- Stage 5.0 fix-plan 必须保持 inline 但受 §例外项 #2 约束

任何其他 stage 的 inline / dispatch + model 选择由主 agent 实时裁定，plan 不硬编码。
```

#### 2.2 Per-stage 裁定提醒（5 处插入点，不硬编码 model）

每个 stage 段落开头加一句 inline 提醒，引导主 agent 按 §Section 0 裁定基准实时选择 inline / dispatch + model；**plan 不规定具体每个 stage 用什么 model**（除 Stage 4 / 5.0 两个不变式）。

| Stage | 修改 |
|-------|------|
| **3.2 Auto-recovery 阶梯** | 段落开头加：`⚠️ 本 stage 内每次执行操作前请按 §Section 0 裁定基准选择 inline / dispatch + model。fix 应用属"执行"型，参考速查表选 sonnet。` |
| **5.0 Fix Plan** | 段落开头加：`⚠️ 本 stage 是 §Section 0 例外项 #2（受约束 inline）。仅汇总 4b deep-verify 输出到 fix-plan.md，禁止读源码。如需补充信息 → 按裁定基准 dispatch。` |
| **5.2 G6 Diff Audit** | 段落开头加：`⚠️ git diff --name-only 是 §Section 0 例外项 #3（inline 取文件清单不解析内容）。审计 diff 内容属"执行+分析"型，按裁定基准 dispatch。` |
| **5.3 Rerun + scalar** | 段落开头加：`⚠️ 启动 rerun bash 是 §Section 0 例外项 #1（inline）。raw.log 解析 / scalar 提取属"执行+分析"型，按裁定基准 dispatch。` |
| **6 Rollback** | 段落开头加：`⚠️ "是否 rollback"决策 inline；执行 rollback 命令属"执行"型 + 涉及 ❌ 第 5 条（inline git reset），必须按裁定基准 dispatch。` |

#### 2.3 Stage TaskList 锚定（防止主 agent 长上下文遗忘工作流）

**问题**：每次 iteration 跑 6 个 stage，主 agent 上下文窗口随 iter 累计变长（log / verify / dispatch result 不断进入），到 iter 3+ 后可能遗忘 SKILL §Iteration 中规定的 stage 顺序与各 stage 的 dispatch 约束。仅靠 SKILL 文本记忆不可靠。

**解决方案**：在每次 iteration 起始（Stage 1 Kickoff Step 1），由主 agent 调用 `TaskCreate` 建立本 iter 的 6 个 stage tasks，作为 iteration 内的进度锚点。每进入一个 stage，`TaskUpdate` 标 `in_progress`；stage 完成时标 `completed`。下一次 iter 开始时，先把上一 iter 的 6 个 tasks 标 `completed` 或 `deleted`（如已 completed 跳过），再建新一组。

**TaskList 形态（每次 iter 6 条）**：

```
[iter-N stage-1] Kickoff（git HEAD + baseline）
[iter-N stage-2] Run trigger（subprocess background + Monitor/tail）
[iter-N stage-3] Observe（ISSUE 收集 + auto-recovery 阶梯）
[iter-N stage-4] Triage + Deep Verify（4a opus + 4b per-issue parallel）
[iter-N stage-5] Fix Plan + gated-workflow + G6 audit + Rerun（5.0/5.1/5.2/5.3）
[iter-N stage-6] Rollback + Stop Check
```

设计权衡：
- **6 条而非 11 条**：把 4a/4b 合并为 stage-4，5.0/5.1/5.2/5.3 合并为 stage-5，避免每 iter 11 条 task 撑爆 list。stage-4 / stage-5 内部 sub-stage 由 SKILL 文本本身规定，不进 TaskList。
- **每 iter 重建**：避免 task list 跨 iter 累积（10 个 iter = 60 条 task）；上一 iter 的 6 条标 `completed` 即可，list 视图集中在当前 iter。
- **新增 `[discovery]` / `[lock]` / `[prepare]`** ：只在 §3.5 fresh-start 路径执行一次，不进 iter TaskList，由主 SKILL 自身在 Stage 0 时一次性 TaskCreate 即可。

**SKILL 内插入点**：在 `## Stage 1 — Kickoff (idempotent)` 段落 Step 1 之前，插入 `Step 0: TaskCreate 6 stage tasks for iter-N`（详见 Implementation Plan B3-T4 增加的 Step 6）。

**Self-anchoring 协议**：长 dispatch（subagent 返回 > 200 字符或耗时 > 30s）后，主 agent 必须先 `TaskList` 确认当前 `[iter-N stage-X]` anchor 与 SKILL 当前 stage 一致；不一致 → STOP + escalate `stage_anchor_drift`。Stage 切换时 `TaskUpdate` 切 completed/in_progress 后再进入下一 stage。

**工具说明**：`TaskCreate / TaskUpdate / TaskList` 是 Claude Code 主 agent 的 task 工具家族（与 system-reminder 中 `Here are the existing tasks` 同步），与 ralph-loop（Stop hook decision:block + reason replay → 同 session 跨 iter 保留 TaskList）配合工作。本 plan 编写期主 agent 实测可用。

#### 2.4 Section 0 + TaskList 落地的硬性强制（grep-based test）

新增 `tests/autoiter-orchestrator-contract.test.js`，5 项核心断言（专注守住 contract 骨架，不强制具体 model 选择）：

1. 断言 `skills/autoiter/SKILL.md` 包含 `## Section 0 — Orchestrator Contract` 标题
2. 断言 Section 0 含 "禁止" / "❌" / "⛔" 之一（防止改成软建议）
3. 断言 Section 0 含"裁定基准"或"派发策略"或"模型选择速查"关键字（确保裁定基准段未被删除）
4. 断言 `## Stage 1 — Kickoff` 段落含 `TaskCreate` 关键字（stage 锚定指令未被删除）
5. 断言 Stage 4 章节含 `opus` 关键字（历史不变式：Triage/Deep Verify 不可降级）

---

### Section 3 — Migration Strategy

#### 3.1 原子改动顺序（5 个批次，每批一个 commit）

**批次顺序刻意设计为：先骨架 mv → 再 JS 集中点 → 再 SKILL 内容 → 再文档 → 再 e2e。**任意批次单独 ship 都不会破坏发布前 `claude plugin validate` + `node --test`。

| 批次 | 内容 | 目的 |
|------|------|------|
| **B1: 文件 mv** | `git mv commands/loop.md commands/autoiter.md` + `git mv skills/loop skills/autoiter` + `git mv skills/loop-prepare skills/autoiter-prepare` | 让目录结构先就位；SKILL.md 内 `name:` 字段同 commit 改 |
| **B2: JS 集中点 + 测试 fixture 原子改动** | `_state.js` 路径段 `'loop'` → `'autoiter'`；`post-writing-plans-reviewer.js` regex + 字面量；`tests/loop.test.js` → `tests/autoiter.test.js` 含 fixture | 必须原子，否则 hook ↔ test 半致 |
| **B3: SKILL 内容重构** | `skills/autoiter/SKILL.md` 新增 Section 0 + 5 处 stage 裁定提醒；references/*.md（5 个）内部引用更新；lib/jaccard.js（无内容改，只是 mv 已在 B1） | 内容变更，与 B1/B2 独立 |
| **B4: 文档同步** | CLAUDE.md / README.md / CHANGELOG.md（新增 0.3.0 entry）；skills/queue/SKILL.md schema | 文档单独 commit，rollback 友好 |
| **B5: E2E + 新增 contract test** | `tests/e2e/smoke.sh` scenario 5 改 `e2e-05-autoiter-shim`；新增 `tests/autoiter-orchestrator-contract.test.js` | 测试扩展，独立 ship |

每批结束后必须 `node --test tests/*.test.js` 通过；最后一批结束后 `claude plugin validate` + `tests/e2e/smoke.sh` 通过。

#### 3.2 测试更新策略

- **mv + 字面量替换**：`tests/loop.test.js` → `tests/autoiter.test.js`；fixture 字符串全量替换 `loop-stage0` → `autoiter-stage0`、`collie:loop` → `collie:autoiter`、`COLLIE_LOOP_*` → `COLLIE_AUTOITER_*`
- **路径测试微调**：`tests/loop.test.js` 中 `loopDir` 测试断言路径包含 `'loop/myproject'` → 改为 `'autoiter/myproject'`；函数名保持 `loopDir` 不变（仅 path segment 改）
- **新增 contract test**：`tests/autoiter-orchestrator-contract.test.js`（详见 2.3）
- **e2e smoke**：scenario 5 改名 + grep 断言改为查找 `commands/autoiter.md` + `skills/autoiter/SKILL.md` 的 `name: collie:autoiter`
- **stop-steps-counter.test.js 不动**：`loop_on_same_error` 是通用 escalation code

#### 3.3 CHANGELOG entry

简短 0.3.0 entry（dogfood 项目，无外部用户迁移负担）：

```markdown
## 0.3.0 — YYYY-MM-DD

- **rename**：`/collie:loop` → `/collie:autoiter`；同步改 SKILL/状态目录/env var/hook plan-kind/queue enum。原因：与 Claude Code 内置全局 `loop` skill 命名冲突。
- **新增 Section 0 Orchestrator Contract**：约束 autoiter SKILL 主 session 行为（禁止读源码 / 写实现代码 / 解析长日志），引入主 agent 自主裁定基准（参考 user CLAUDE.md "Subagent 派发策略"）。
- **新增 Stage TaskList 锚定**：每 iter 起始 TaskCreate 6 条 stage anchor，长 dispatch 返回时 self-anchor 防遗忘。
- 新增 `tests/autoiter-orchestrator-contract.test.js` grep-based 强制（5 项核心断言）。
```

---

## Impact Assessment

### Directly affected（本次直接修改的文件）

**文件移动**：
- `commands/loop.md` → `commands/autoiter.md`
- `skills/loop/` 整目录 → `skills/autoiter/`（含 SKILL.md + lib/jaccard.js + references/{overfit-guards,stop-criterion,iter-prompt,discovery-prompt,fix-plan-template}.md）
- `skills/loop-prepare/` 整目录 → `skills/autoiter-prepare/`（含 SKILL.md + references/prepare-checks.md）
- `tests/loop.test.js` → `tests/autoiter.test.js`

**文件内容修改**：
- `hooks/_state.js`（路径段常量 1 行）
- `hooks/post-writing-plans-reviewer.js`（regex + 字面量 ~5 处）
- `skills/autoiter/SKILL.md`（mv 后内容大改：Section 0 新增 + 5 处 stage dispatch 提示 + Stage 1 Kickoff Step 0 TaskCreate 锚定指令）
- `skills/autoiter-prepare/SKILL.md`（mv 后内容微改：内部引用名）
- `skills/autoiter/references/*.md`（5 个文件内引用名更新）
- `skills/queue/SKILL.md`（command enum 字面量 ~5 处）
- `commands/autoiter.md`（thin shim 内容微改：skill name + sentinel）
- `tests/autoiter.test.js`（fixture 字面量 + 路径断言）
- `tests/e2e/smoke.sh`（scenario 5 改名 + 断言路径）
- `README.md`（Loop 章节标题 + 路径示意 + env var 表）
- `CLAUDE.md`（Loop Workflow 章节标题 + 4 处 hook 表行 + 5 处约束 bullet）
- `CHANGELOG.md`（新增 0.3.0 entry）
- `.claude-plugin/plugin.json`（version `0.2.4` → `0.3.0`）

**文件新增**：
- `tests/autoiter-orchestrator-contract.test.js`

### Downstream consumers（dogfood 项目，无外部用户迁移负担）

- **`superpowers` / `ralph-loop` 插件**：无依赖（autoiter 调用它们而非反向），无影响
- **`docs/plans/2026-04-24-loop-command-plan.md` 历史快照**：不动（历史 plan，不属本次范围）

### Reverse impact

- **CLAUDE.md / README.md** 中所有 Loop Workflow 章节标题、env var 表、目录树示意 → B4-T1/T2 同步改
- **`loop_on_same_error` stop-hook escalation code**：保留不变（与命令名无关）
- **`references/stop-criterion.md` / `overfit-guards.md`**：不需更新（与 TaskList 正交）；`iter-prompt.md` 追加 TaskCreate 提醒（B3-T6 Step 4）

---

## E2E Assessment

### 现有 e2e 基建（探测结果）

- **`tests/e2e/smoke.sh`**：5 个 scenario 的 bash 脚本，依赖 `jq` + `node`，验证插件文件结构、frontmatter 合法、hook 行为、状态路径构造
- **`node --test tests/*.test.js`**：Node.js 内置测试 runner，无依赖；当前 31 个 loop 相关测试 + ~30 个其他
- **CI**：本仓库无 CI 配置，依赖发布前 `tests/e2e/smoke.sh` 手动运行（CLAUDE.md 发布检查清单）
- **Webapp / browser**：无（Claude Code plugin，纯文件 + skill 注册）

### 项目类型 → e2e 策略映射

Claude Code plugin（无 server / 无 UI / 纯 markdown + JSON 注册 + JS hook）→ e2e 验证维度：
1. 命令/skill 文件存在 + frontmatter 合法
2. Skill name 字段与目录名一致
3. Hook 行为（plan-kind bypass + dual-reviewer enforcement）
4. 状态路径构造正确（`_state.js` 函数返回值）
5. 关键内容存在（grep 验证 Section 0 + per-stage contract）

### 本次需求的 e2e 策略

| 维度 | 验证方式 | 文件 |
|------|---------|------|
| 命令文件存在 + frontmatter | scenario 5 改 `e2e-05-autoiter-shim`，jq 校验 `commands/autoiter.md` frontmatter | `tests/e2e/smoke.sh` |
| Skill name 字段 | scenario 5 grep `skills/autoiter/SKILL.md` 含 `name: collie:autoiter` | `tests/e2e/smoke.sh` |
| Hook plan-kind bypass | 已有 3 个 fixture test 改 `autoiter-stage0` 即可继续覆盖 | `tests/autoiter.test.js`（重命名后）|
| 状态路径构造 | 已有 `_state.loopDir` 测试改 path 断言 `autoiter/...` | `tests/autoiter.test.js` |
| Section 0 存在 + 5 stage dispatch 提示 | **新增** grep-based 测试 | `tests/autoiter-orchestrator-contract.test.js` |
| CHANGELOG 0.3.0 entry 存在 | scenario 6（新增可选）grep `CHANGELOG.md` 第一节含 `## 0.3.0` 标题 | `tests/e2e/smoke.sh`（可选）|

### e2e_feasible：✅ true

理由：现有基建（`smoke.sh` + `node --test`）完全够用；新增 1 个 contract test 文件即可覆盖 orchestrator 落地强制；不需要 headless browser / Docker / testcontainers。

---

## Task Execution DAG

| Task | Batch | Depends on | Key files |
|------|-------|------------|-----------|
| B0-T0 元 grep：全仓 `COLLIE_LOOP_` / `\bloop\b` 残留扫描 → 校验 task 覆盖 | 0 | — | 全仓只读扫描，输出文件清单 |
| B1-T1 git mv 命令文件 | 1 | B0-T0 | `commands/loop.md` → `commands/autoiter.md` |
| B1-T2 git mv 主 skill 目录 | 1 | B1-T1 | `skills/loop/` → `skills/autoiter/` |
| B1-T3 git mv 子 skill 目录 | 1 | B1-T2 | `skills/loop-prepare/` → `skills/autoiter-prepare/` |
| B1-T4 git mv 测试文件 | 1 | B1-T3 | `tests/loop.test.js` → `tests/autoiter.test.js` |
| B1-T5 更新 SKILL.md `name:` frontmatter | 1 | B1-T4 | `skills/autoiter/SKILL.md`, `skills/autoiter-prepare/SKILL.md` |
| B1-T6 commit B1 | 1 | B1-T5 | git index |
| B2-T1 修改 `_state.js` 路径段 | 2 | B1-T6 | `hooks/_state.js` |
| B2-T2 修改 hook regex + 字面量 | 2 | B2-T1 | `hooks/post-writing-plans-reviewer.js` |
| B2-T3 同步更新 fixture 字面量 | 2 | B2-T2 | `tests/autoiter.test.js` |
| B2-T4 单测 verify | 2 | B2-T3 | `node --test tests/*.test.js` |
| B2-T5 commit B2 | 2 | B2-T4 | git index |
| B3-T1 RED：写 contract test | 3 | B2-T5 | `tests/autoiter-orchestrator-contract.test.js` 新增 |
| B3-T2 RED verify | 3 | B3-T1 | 测试应失败（Section 0 不存在）|
| B3-T3 GREEN：在 SKILL 加 Section 0 | 3 | B3-T2 | `skills/autoiter/SKILL.md` |
| B3-T4 GREEN：加 5 处 stage 裁定提醒 + Stage 1 Step 0 TaskCreate 锚定 | 3 | B3-T3 | `skills/autoiter/SKILL.md` |
| B3-T5 GREEN verify contract test | 3 | B3-T4 | `node --test tests/autoiter-orchestrator-contract.test.js` |
| B3-T6 更新 references/iter-prompt.md Stage 5.0 | 3 | B3-T4 | `skills/autoiter/references/iter-prompt.md` |
| B3-T7 更新 references/fix-plan-template.md plan-topic | 3 | B3-T4 | `skills/autoiter/references/fix-plan-template.md` |
| B3-T8 更新其他 references 引用名 | 3 | B3-T4 | `skills/autoiter/references/{overfit-guards,stop-criterion,discovery-prompt}.md`, `skills/autoiter-prepare/references/prepare-checks.md` |
| B3-T9 更新 commands/autoiter.md shim | 3 | B3-T4 | `commands/autoiter.md` |
| B3-T10 更新 queue/SKILL.md schema enum | 3 | B3-T4 | `skills/queue/SKILL.md` |
| B3-T11 全单测 verify | 3 | B3-T5,T6,T7,T8,T9,T10 | `node --test tests/*.test.js` |
| B3-T12 commit B3 | 3 | B3-T11 | git index |
| B4-T1 更新 CLAUDE.md | 4 | B3-T12 | `CLAUDE.md` |
| B4-T2 更新 README.md | 4 | B3-T12 | `README.md` |
| B4-T3 更新 CHANGELOG.md（0.3.0 entry）| 4 | B3-T12 | `CHANGELOG.md` |
| B4-T4 bump plugin.json version | 4 | B3-T12 | `.claude-plugin/plugin.json` |
| B4-T5 commit B4 | 4 | B4-T1,T2,T3,T4 | git index |
| B5-T1 更新 e2e smoke.sh scenario 5 | 5 | B4-T5 | `tests/e2e/smoke.sh` |
| B5-T2 完整 verify（plugin validate + 单测 + smoke）| 5 | B5-T1 | 全工程 |
| B5-T3 commit B5 | 5 | B5-T2 | git index |

**并行性**：Batch 4 内的 T1-T4 可并行 dispatch（4 个文件无相互依赖）；Batch 3 内的 T6-T10 可并行 dispatch（5 个独立文件）。其他批内任务严格顺序。

---

## Implementation Plan

### [B0-T0] 元 grep：全仓 `COLLIE_LOOP_` / 命令引用残留扫描 → 校验 task 覆盖

**Purpose**：实施开始前先全仓 grep 出所有 `COLLIE_LOOP_*` / `collie:loop` / `loop-stage0` / `Collie: LOOP DONE` / `.worktrees/loop-` / `Loop Workflow` / `loop-iter-N-fixes` 的真实分布，与已列任务覆盖的文件做 set-diff，确保举一反三防御。

**Files:**
- Read-only：全仓扫描

- [ ] **Step 1**: 全仓 grep（含 scripts/ 与所有 .sh / .md / .js / .json）

  ```bash
  cd /Users/kevin/git/collie
  grep -rln \
    -e 'COLLIE_LOOP_' \
    -e 'collie:loop\b' \
    -e 'collie:loop-prepare' \
    -e 'loop-stage0' \
    -e 'Collie: LOOP DONE' \
    -e '\.worktrees/loop-' \
    -e 'loop-iter-N-fixes' \
    -e 'Loop Workflow' \
    --include='*.md' --include='*.js' --include='*.json' --include='*.sh' \
    . 2>/dev/null \
    | grep -v 'node_modules\|\.git/\|docs/plans/2026-04-24-loop-command-plan\.md' \
    | sort -u
  ```

- [ ] **Step 2**: 与 plan 已列任务覆盖文件做 set-diff

  Plan 已列文件清单（来自 §Section 1 表 + §Implementation Plan 各 task 的 `Files:` 字段）：
  - `commands/loop.md`（B1-T1）
  - `skills/loop/SKILL.md`、`skills/loop/lib/*`、`skills/loop/references/*.md`（B1-T2）
  - `skills/loop-prepare/SKILL.md`、`skills/loop-prepare/references/*.md`（B1-T3）
  - `tests/loop.test.js`（B1-T4）
  - `hooks/_state.js`（B2-T1）
  - `hooks/post-writing-plans-reviewer.js`（B2-T2）
  - `skills/queue/SKILL.md`（B3-T10）
  - `CLAUDE.md`（B4-T1）
  - `README.md`（B4-T2）
  - `CHANGELOG.md`（B4-T3）
  - `.claude-plugin/plugin.json` + `marketplace.json`（B4-T4）
  - `tests/e2e/smoke.sh`（B5-T1）

  对 Step 1 输出的每个文件，检查是否在已列清单中：
  - **在清单中** → 已有 task 覆盖，无需新增
  - **不在清单中** → 必须做以下二选一：
    - (a) 新增 [Bx-Tx] task 处理该文件，并补 [blocked-by] 依赖
    - (b) 显式 justify 为 "out of scope"（在 plan 文件追加一段说明）

- [ ] **Step 3**: 已知预期覆盖文件清单（实测）

  当前实测 Step 1 输出应该包含：
  - 上述清单全部
  - **不应包含** `scripts/escalate.sh`（实测当前不含 `COLLIE_LOOP_*`，无需覆盖）
  - **不应包含** `hooks/hooks.json`（描述含 generic "loop detection" 不属本次范围）

  若 Step 1 输出包含不在已列清单且不在已知豁免清单的文件 → STOP，更新 plan 后再继续。

- [ ] **Step 4**: 输出 baseline 清单到 `~/.collie/state/snappy-inventing-charm/baseline-loop-grep.txt`

  ```bash
  mkdir -p ~/.collie/state/snappy-inventing-charm/
  # 复用 Step 1 的 grep 命令，输出到 baseline 文件
  grep -rln \
    -e 'COLLIE_LOOP_' \
    -e 'collie:loop\b' \
    -e 'collie:loop-prepare' \
    -e 'loop-stage0' \
    -e 'Collie: LOOP DONE' \
    -e '\.worktrees/loop-' \
    -e 'loop-iter-N-fixes' \
    -e 'Loop Workflow' \
    --include='*.md' --include='*.js' --include='*.json' --include='*.sh' \
    . 2>/dev/null \
    | grep -v 'node_modules\|\.git/\|docs/plans/2026-04-24-loop-command-plan\.md' \
    | sort -u \
    > ~/.collie/state/snappy-inventing-charm/baseline-loop-grep.txt
  wc -l ~/.collie/state/snappy-inventing-charm/baseline-loop-grep.txt
  ```

  Expected：行数 > 0。该 baseline 在 B5-T2 Step 4 final grep 中作为 reference（确保所有 baseline 文件最终残留均归零）。

[blocked-by]: 无

---



### [B1-T1] git mv 命令文件

**Files:**
- Modify: `commands/loop.md` → `commands/autoiter.md`

- [ ] **Step 1**: 执行 mv

  ```bash
  git mv commands/loop.md commands/autoiter.md
  ```

- [ ] **Step 2**: Verify

  ```bash
  ls commands/autoiter.md && ! ls commands/loop.md 2>/dev/null
  git status --short | grep -E '^R.*commands/(loop|autoiter)\.md$'
  ```

  Expected：第一行返回 `commands/autoiter.md`；第二行 `git status` 显示 `R  commands/loop.md -> commands/autoiter.md`。

[blocked-by]: B0-T0

---

### [B1-T2] git mv 主 skill 目录

**Files:**
- Modify: `skills/loop/` → `skills/autoiter/`（含 SKILL.md / lib/jaccard.js / references/*.md）

- [ ] **Step 1**: 执行整目录 mv

  ```bash
  git mv skills/loop skills/autoiter
  ```

- [ ] **Step 2**: Verify

  ```bash
  ls skills/autoiter/SKILL.md skills/autoiter/lib/jaccard.js
  ls skills/autoiter/references/{overfit-guards,stop-criterion,iter-prompt,discovery-prompt,fix-plan-template}.md
  ! ls skills/loop 2>/dev/null
  ```

  Expected：所有新路径存在，旧 `skills/loop/` 不存在。

[blocked-by]: B1-T1

---

### [B1-T3] git mv 子 skill 目录

**Files:**
- Modify: `skills/loop-prepare/` → `skills/autoiter-prepare/`

- [ ] **Step 1**: 执行 mv

  ```bash
  git mv skills/loop-prepare skills/autoiter-prepare
  ```

- [ ] **Step 2**: Verify

  ```bash
  ls skills/autoiter-prepare/SKILL.md skills/autoiter-prepare/references/prepare-checks.md
  ! ls skills/loop-prepare 2>/dev/null
  ```

[blocked-by]: B1-T2

---

### [B1-T4] git mv 测试文件

**Files:**
- Modify: `tests/loop.test.js` → `tests/autoiter.test.js`

- [ ] **Step 1**: 执行 mv

  ```bash
  git mv tests/loop.test.js tests/autoiter.test.js
  ```

- [ ] **Step 2**: Verify

  ```bash
  ls tests/autoiter.test.js && ! ls tests/loop.test.js 2>/dev/null
  ```

[blocked-by]: B1-T3

---

### [B1-T5] 更新 SKILL.md `name:` frontmatter（仅 frontmatter，内容大改在 B3）

**Files:**
- Modify: `skills/autoiter/SKILL.md` 第 2 行 frontmatter
- Modify: `skills/autoiter-prepare/SKILL.md` 第 2 行 frontmatter

- [ ] **Step 1**: 修改主 SKILL frontmatter

  ```diff
  - name: collie:loop
  + name: collie:autoiter
  ```

- [ ] **Step 2**: 修改子 SKILL frontmatter

  ```diff
  - name: collie:loop-prepare
  + name: collie:autoiter-prepare
  ```

- [ ] **Step 3**: Verify

  ```bash
  grep -E '^name:' skills/autoiter/SKILL.md skills/autoiter-prepare/SKILL.md
  ```

  Expected：

  ```
  skills/autoiter/SKILL.md:name: collie:autoiter
  skills/autoiter-prepare/SKILL.md:name: collie:autoiter-prepare
  ```

[blocked-by]: B1-T4

---

### [B1-T6] commit B1

- [ ] **Step 1**: 单测 sanity check（B1 后内容仍指向 loop，hook + fixture 不变，应仍 pass）

  ```bash
  node --test tests/*.test.js 2>&1 | tail -5
  ```

  Expected：全 pass（fixture `'loop-stage0'` 与 hook regex `/loop-stage0/` 仍匹配）。

- [ ] **Step 2**: commit

  ```bash
  git add -A
  git commit -m "refactor: rename loop → autoiter (B1: git mv 文件骨架 + frontmatter)

  - git mv commands/loop.md → commands/autoiter.md
  - git mv skills/loop/ → skills/autoiter/
  - git mv skills/loop-prepare/ → skills/autoiter-prepare/
  - git mv tests/loop.test.js → tests/autoiter.test.js
  - 更新 SKILL.md frontmatter name 字段

  解决 /loop 与 Claude Code 内置 loop skill 命名冲突。本 commit 仅文件骨架，内部引用 + hook regex 在后续批次原子改动。"
  ```

[blocked-by]: B1-T5

---

### [B2-T1] 修改 `_state.js` 路径段

**Files:**
- Modify: `hooks/_state.js` 第 19 / 23 / 27 行（三个 `path.join(STATE_HOME, 'loop', ...)` 调用）

- [ ] **Step 1**: 替换三处字面量 `'loop'` → `'autoiter'`

  ```bash
  sed -i.bak "s|path.join(STATE_HOME, 'loop'|path.join(STATE_HOME, 'autoiter'|g" hooks/_state.js
  rm hooks/_state.js.bak
  ```

  Note: 函数名 `loopDir / currentRunFile / iterDir` 保留不变（避免影响 stop-hook 等通用调用方）。

- [ ] **Step 2**: Verify

  ```bash
  grep -n "'loop'" hooks/_state.js
  grep -n "'autoiter'" hooks/_state.js | wc -l
  ```

  Expected：第一行无输出；第二行返回 `2`（`loopDir` 用一次，`currentRunFile` 用一次；`iterDir` 通过 `loopDir` 间接复用）。

  实际验证：

  ```bash
  node -e "
    const s = require('./hooks/_state.js');
    console.log(s.loopDir('myproj', 'run1'));
    console.log(s.currentRunFile('myproj'));
    console.log(s.iterDir('myproj', 'run1', 0));
  "
  ```

  Expected：三行输出均含 `autoiter/myproj` 子串，无 `loop/myproj`。

[blocked-by]: B1-T6

---

### [B2-T2] 修改 hook regex + 字面量

**Files:**
- Modify: `hooks/post-writing-plans-reviewer.js` 第 109 / 113 / 117 / 132 / 138 行

- [ ] **Step 1**: 替换 plan-executor regex

  ```diff
  - const hasPlanExecutor = first5Lines.some(l => /<!--\s*plan-executor:\s*collie:loop\s*-->/.test(l));
  + const hasPlanExecutor = first5Lines.some(l => /<!--\s*plan-executor:\s*collie:autoiter\s*-->/.test(l));
  ```

- [ ] **Step 2**: 替换 missing 提示字面量

  ```diff
  -    !hasPlanExecutor && 'plan-executor: collie:loop',
  +    !hasPlanExecutor && 'plan-executor: collie:autoiter',
  ```

- [ ] **Step 3**: 替换 plan-kind regex（在 plan-kind: loop-stage0 检查处，约 line 94 附近）

  ```bash
  grep -n 'loop-stage0' hooks/post-writing-plans-reviewer.js
  ```

  对每一处，替换 `loop-stage0` → `autoiter-stage0`：

  ```bash
  sed -i.bak 's|loop-stage0|autoiter-stage0|g' hooks/post-writing-plans-reviewer.js
  rm hooks/post-writing-plans-reviewer.js.bak
  ```

- [ ] **Step 4**: Verify

  ```bash
  grep -n 'loop-stage0\|collie:loop' hooks/post-writing-plans-reviewer.js
  ```

  Expected：无输出（两个旧字面量都已替换）。

[blocked-by]: B2-T1

---

### [B2-T3] 同步更新 fixture 字面量

**Files:**
- Modify: `tests/autoiter.test.js`

- [ ] **Step 1**: 全文替换

  ```bash
  sed -i.bak \
    -e 's|loop-stage0|autoiter-stage0|g' \
    -e 's|collie:loop|collie:autoiter|g' \
    -e "s|'loop/|'autoiter/|g" \
    -e 's|"loop/|"autoiter/|g' \
    -e 's|loop/myproject|autoiter/myproject|g' \
    -e 's|loop/testproject|autoiter/testproject|g' \
    tests/autoiter.test.js
  rm tests/autoiter.test.js.bak
  ```

- [ ] **Step 2**: 检查环境变量字面量（`COLLIE_LOOP_*`）— 当前 fixture 不包含但保险起见 grep

  ```bash
  grep -n 'COLLIE_LOOP\|loop-stage0\|collie:loop' tests/autoiter.test.js
  ```

  Expected：无输出。

  **手工 verify**：检查 fixture 中 `loop` 单词的使用是否全部替换（`loopDir` 函数名调用 **保留**，因为函数名未改）：

  ```bash
  grep -n '\bloop\b' tests/autoiter.test.js
  ```

  Expected：仅出现在 `s.loopDir(` / `_state.loopDir(` / `loopDir:` describe 块标题等"函数名"上下文，不出现在路径字面量或 fixture 字符串中。

[blocked-by]: B2-T2

---

### [B2-T4] 单测 verify

- [ ] **Step 1**: 跑全部单测

  ```bash
  node --test tests/*.test.js 2>&1 | tail -10
  ```

  Expected：所有 tests pass，包括 hook bypass 三个 fixture 测试。

  **若失败**：检查失败的 fixture 字符串/regex 是否还有遗漏；不要修改 hook 或 fixture 之外的文件。

[blocked-by]: B2-T3

---

### [B2-T5] commit B2

- [ ] **Step 1**: commit

  ```bash
  git add hooks/_state.js hooks/post-writing-plans-reviewer.js tests/autoiter.test.js
  git commit -m "refactor: rename loop → autoiter (B2: 原子改 hook + fixture)

  - hooks/_state.js: 路径段 'loop' → 'autoiter'（3 处）；函数名 loopDir/currentRunFile/iterDir 保留
  - hooks/post-writing-plans-reviewer.js: regex 'loop-stage0' / 'collie:loop' 同步改 'autoiter-stage0' / 'collie:autoiter'
  - tests/autoiter.test.js: fixture 字面量 + 路径断言原子同步

  原子性：hook regex + fixture 字面量必须在同一 commit 切换，否则 node --test 立刻断裂。"
  ```

[blocked-by]: B2-T4

---

### [B3-T1] RED：新增 contract test 文件

**Files:**
- Create: `tests/autoiter-orchestrator-contract.test.js`

- [ ] **Step 1**: 创建文件，内容如下（5 项核心断言：守 contract 骨架，不硬编码 model）

  ```javascript
  // tests/autoiter-orchestrator-contract.test.js
  // Grep-based 强制：防止 Section 0 + 裁定基准 + Stage 1 锚定 + Stage 4 不变式被重构误删
  // 设计原则：只守 contract 骨架，不规定具体 stage 用什么 model（model 选择由主 agent 实时裁定）

  const test = require('node:test');
  const assert = require('node:assert');
  const fs = require('node:fs');
  const path = require('node:path');

  const SKILL_PATH = path.join(__dirname, '..', 'skills', 'autoiter', 'SKILL.md');

  test('Section 0 Orchestrator Contract 标题存在', () => {
    const content = fs.readFileSync(SKILL_PATH, 'utf8');
    assert.ok(
      /^## Section 0 — Orchestrator Contract/m.test(content),
      'Section 0 标题缺失'
    );
  });

  test('Section 0 含禁止标记（⛔ / ❌ / 禁止）', () => {
    const content = fs.readFileSync(SKILL_PATH, 'utf8');
    const section0Match = content.match(/## Section 0[\s\S]*?(?=^## )/m);
    assert.ok(section0Match, 'Section 0 不存在');
    assert.ok(
      /⛔|❌|禁止/.test(section0Match[0]),
      'Section 0 缺少禁止标记（防止改成软建议）'
    );
  });

  test('Section 0 含裁定基准引用（确保主 agent 能实时裁定 inline / dispatch + model）', () => {
    const content = fs.readFileSync(SKILL_PATH, 'utf8');
    const section0Match = content.match(/## Section 0[\s\S]*?(?=^## )/m);
    assert.ok(section0Match, 'Section 0 不存在');
    assert.ok(
      /裁定基准|派发策略|模型选择速查/.test(section0Match[0]),
      'Section 0 缺少裁定基准段 — 主 agent 失去实时裁定参考'
    );
  });

  test('Stage 1 Kickoff 含 TaskCreate 锚定指令', () => {
    const content = fs.readFileSync(SKILL_PATH, 'utf8');
    const kickoffMatch = content.match(/## Stage 1 — Kickoff[\s\S]{0,1500}?(?=^## Stage 2)/m);
    assert.ok(kickoffMatch, 'Stage 1 — Kickoff 章节未找到');
    assert.ok(
      /TaskCreate/.test(kickoffMatch[0]),
      'Stage 1 Kickoff 缺少 TaskCreate — stage TaskList 锚定可能被删'
    );
  });

  test('Stage 4 章节含 opus 关键字（历史不变式：Triage / Deep Verify 不可降级）', () => {
    const content = fs.readFileSync(SKILL_PATH, 'utf8');
    const stage4Match = content.match(/## Stage 4[ab]?[\s\S]{0,3000}?(?=^## Stage 5)/m);
    assert.ok(stage4Match, 'Stage 4 章节未找到');
    assert.ok(
      /opus/i.test(stage4Match[0]),
      'Stage 4 缺少 opus — Triage/Deep Verify 可能被误改为 inline 绕过 Section 0'
    );
  });
  ```

[blocked-by]: B2-T5

---

### [B3-T2] RED verify

- [ ] **Step 1**: 跑新测试，期望失败（Section 0 尚不存在）

  ```bash
  node --test tests/autoiter-orchestrator-contract.test.js 2>&1 | tail -10
  ```

  Expected：至少 1 个 fail（Section 0 标题不存在），打印 `Section 0 标题缺失 — orchestrator contract 不能被删除`。

  **若意外 pass**：说明 Section 0 已经被某个 commit 加入；这是 plan 与现状脱节，停下来核查。

[blocked-by]: B3-T1

---

### [B3-T3] GREEN：在 SKILL 加 Section 0

**Files:**
- Modify: `skills/autoiter/SKILL.md`

- [ ] **Step 1**: 找到 `# collie:autoiter — Main Loop Orchestrator` 标题（约 line 11）的下一行 `## §3.5 Entry State Machine` 之前的位置（约 line 94 之前），插入 Section 0 整段。

  Section 0 完整文本块见本 plan 文件 §Design Spec → §Section 2.1（"SKILL 顶部新增 Section 0" 代码块），整段复制到此处。

  操作：

  ```bash
  # 找到 §3.5 标题位置
  grep -n '^## §3.5' skills/autoiter/SKILL.md
  ```

  在该行之前插入 Section 0 整段（从 `## Section 0 — Orchestrator Contract（必读，约束所有 stage）` 开始到结束的 `任何其他 stage 的 inline / dispatch + model 选择由主 agent 实时裁定，plan 不硬编码。`）。

- [ ] **Step 2**: Verify

  ```bash
  grep -n '^## Section 0' skills/autoiter/SKILL.md
  grep -c '⛔' skills/autoiter/SKILL.md
  ```

  Expected：第一行返回行号；第二行 ≥ 1。

[blocked-by]: B3-T2

---

### [B3-T4] GREEN：加 5 处 stage 裁定提醒 + Stage 1 Step 0 TaskCreate 锚定

**Files:**
- Modify: `skills/autoiter/SKILL.md`

- [ ] **Step 1**: 在 5 个 stage 段落开头各加一句 inline 裁定提醒（参见本 plan §Section 2.2 表格的 5 行模板，每行只是 ⚠️ 引导文本，不指定具体 model）

  ```bash
  grep -n '^## Stage 3 \|^## Stage 5\.0\|^## Stage 5\.2\|^## Stage 5\.3\|^## Stage 6 ' skills/autoiter/SKILL.md
  ```

  对每个匹配位置，在标题之后插入 §2.2 表格对应行的 ⚠️ 提醒句（5 句，按 Stage 3.2 / 5.0 / 5.2 / 5.3 / 6 顺序）。

- [ ] **Step 2**: 在 `## Stage 1 — Kickoff` 段落插入 Step 0「TaskCreate stage 锚定 + Self-anchor 协议」

  ```bash
  grep -n '^## Stage 1 — Kickoff' skills/autoiter/SKILL.md
  ```

  在该行之后、原 Step 1 之前插入下列整段：

  ```markdown
  ### Step 0 — TaskCreate stage 锚定（每 iter 起始必做）

  ⛔ 每次进入 Stage 1（iteration 起始）必须先做这一步，再做原 Step 1。

  1. 上一 iter 的 `[iter-{N-1} stage-*]` 任务先标 completed（正常结束）或 deleted（被 rollback）
  2. `TaskCreate` 6 次建立本 iter 锚点：
     - `[iter-N stage-1] Kickoff（git HEAD + baseline）`
     - `[iter-N stage-2] Run trigger（subprocess background + Monitor/tail）`
     - `[iter-N stage-3] Observe（ISSUE 收集 + auto-recovery 阶梯）`
     - `[iter-N stage-4] Triage + Deep Verify（4a/4b opus）`
     - `[iter-N stage-5] Fix Plan + gated-workflow + G6 audit + Rerun（5.0/5.1/5.2/5.3）`
     - `[iter-N stage-6] Rollback + Stop Check`

     `N` 从 state.json 读取
  3. `TaskUpdate [iter-N stage-1] in_progress`，进入原 Step 1
  4. **Self-anchor**：长 dispatch（subagent 返回 > 200 字符或耗时 > 30s）后，主 agent 必须先 `TaskList` 确认当前 anchor 与 SKILL 当前 stage 一致；漂移 → STOP + escalate `stage_anchor_drift`。Stage 切换时 `TaskUpdate` 切 completed/in_progress 后再进入下一 stage。
  ```

- [ ] **Step 3**: Verify

  ```bash
  # 5 个 stage 各有 ⚠️ 提醒
  for s in 'Stage 3 ' 'Stage 5\.0' 'Stage 5\.2' 'Stage 5\.3' 'Stage 6 '; do
    sed -n "/^## $s/,/^## /p" skills/autoiter/SKILL.md | grep -F '⚠️' >/dev/null || echo "MISSING ⚠️ in $s"
  done

  # Stage 1 含 TaskCreate
  sed -n '/^## Stage 1 — Kickoff/,/^## Stage 2/p' skills/autoiter/SKILL.md | grep -c 'TaskCreate'
  ```

  Expected：第一段无 `MISSING` 输出；第二行 ≥ 1。

[blocked-by]: B3-T3

---

### [B3-T5] GREEN verify contract test

- [ ] **Step 1**: 跑 contract test

  ```bash
  node --test tests/autoiter-orchestrator-contract.test.js 2>&1 | tail -15
  ```

  Expected：所有 5 个测试 pass（Section 0 标题 / 禁止标记 / 裁定基准引用 / Stage 1 TaskCreate / Stage 4 opus 不变式）。

[blocked-by]: B3-T4

---

### [B3-T6] 更新 references/iter-prompt.md Stage 5.0 注释

**Files:**
- Modify: `skills/autoiter/references/iter-prompt.md` 第 10 行 + 第 221 行

- [ ] **Step 1**: 修改 line 10

  ```diff
  - The main loop agent (not a subagent) performs Stage 3 observation inline.
  + The main autoiter agent performs Stage 3 observation inline (orchestrator contract: 仅启动 + 状态记录；超过 50 行 raw.log 解析需 dispatch).
  ```

- [ ] **Step 2**: 修改 line 221

  ```diff
  - Stage 5.0 is performed by the main loop agent, not a subagent.
  + Stage 5.0 is performed by the main autoiter agent inline, but strictly limited to summarizing 4b deep-verify subagent outputs into fix-plan.md. ⛔ Reading source code, grep, or running anything beyond verify is forbidden in this stage.
  ```

- [ ] **Step 3**: 全文替换其他 `loop` → `autoiter` 引用名（不动通用术语 "loop" 如 "feedback loop"）

  ```bash
  sed -i.bak \
    -e 's|collie:loop|collie:autoiter|g' \
    -e 's|main loop agent|main autoiter agent|g' \
    -e 's|the loop SKILL|the autoiter SKILL|g' \
    skills/autoiter/references/iter-prompt.md
  rm skills/autoiter/references/iter-prompt.md.bak
  ```

- [ ] **Step 4**: 在 `iter-prompt.md` 顶部（第一行 markdown 标题之前的导言区）追加一行 TaskCreate 提醒

  ```bash
  grep -n '^# ' skills/autoiter/references/iter-prompt.md | head -1
  ```

  在第一个一级标题（`#`）之前插入：

  ```markdown
  > **Each iteration MUST start with TaskCreate of 6 stage anchors** (see SKILL.md `## Stage 1 — Kickoff` Step 0). After every long dispatch (subagent return), self-anchor by reading the current `[iter-N stage-X]` task before continuing — see SKILL.md Step 0.4 self-anchoring 协议.
  ```

  设计理由：iter-prompt.md 是 ralph-loop 每次 restart 时主 agent 优先 read 的 prompt 文件，必须在它顶部写明 TaskList 锚定要求，避免主 agent 仅看到 iter-prompt.md 而错过 SKILL.md Stage 1 的 Step 0 指令。

- [ ] **Step 5**: Verify 提醒到位

  ```bash
  head -5 skills/autoiter/references/iter-prompt.md | grep -E 'TaskCreate|stage anchors|self-anchor'
  ```

  Expected：≥ 1 行命中。

[blocked-by]: B3-T4

---

### [B3-T7] 更新 references/fix-plan-template.md plan-topic

**Files:**
- Modify: `skills/autoiter/references/fix-plan-template.md` 第 2 行

- [ ] **Step 1**: 替换 plan-topic

  ```diff
  - <!-- plan-topic: loop-iter-N-fixes -->
  + <!-- plan-topic: autoiter-iter-N-fixes -->
  ```

- [ ] **Step 2**: 同步全文 `collie:loop` → `collie:autoiter`

  ```bash
  sed -i.bak 's|collie:loop|collie:autoiter|g' skills/autoiter/references/fix-plan-template.md
  rm skills/autoiter/references/fix-plan-template.md.bak
  ```

[blocked-by]: B3-T4

---

### [B3-T8] 更新其他 references 引用名

**Files:**
- Modify: `skills/autoiter/references/overfit-guards.md` line 3
- Modify: `skills/autoiter/references/stop-criterion.md` line 3 + line 77
- Modify: `skills/autoiter/references/discovery-prompt.md` line 5
- Modify: `skills/autoiter-prepare/references/prepare-checks.md` line 3

- [ ] **Step 1**: 批量替换

  ```bash
  for f in \
    skills/autoiter/references/overfit-guards.md \
    skills/autoiter/references/stop-criterion.md \
    skills/autoiter/references/discovery-prompt.md \
    skills/autoiter-prepare/references/prepare-checks.md ; do
    sed -i.bak \
      -e 's|collie:loop-prepare|collie:autoiter-prepare|g' \
      -e 's|collie:loop|collie:autoiter|g' \
      -e 's|COLLIE_LOOP_NOTIFY_CMD|COLLIE_AUTOITER_NOTIFY_CMD|g' \
      -e 's|COLLIE_LOOP_EVENT|COLLIE_AUTOITER_EVENT|g' \
      "$f"
    rm "$f.bak"
  done
  ```

- [ ] **Step 2**: Verify 无残留

  ```bash
  grep -rn 'collie:loop\|COLLIE_LOOP' skills/autoiter*/references/
  ```

  Expected：无输出。

- [ ] **Step 3**: 同步更新子 SKILL（`skills/autoiter-prepare/SKILL.md`）的 description 字段（若包含 `collie:loop` 引用）

  ```bash
  grep -n 'collie:loop' skills/autoiter-prepare/SKILL.md
  sed -i.bak \
    -e 's|collie:loop-prepare|collie:autoiter-prepare|g' \
    -e 's|collie:loop|collie:autoiter|g' \
    -e 's|the loop command|the autoiter command|g' \
    -e 's|main loop SKILL|main autoiter SKILL|g' \
    skills/autoiter-prepare/SKILL.md
  rm skills/autoiter-prepare/SKILL.md.bak
  ```

[blocked-by]: B3-T4

---

### [B3-T9] 更新 commands/autoiter.md shim

**Files:**
- Modify: `commands/autoiter.md`

- [ ] **Step 1**: 替换 skill 名 + sentinel + 内嵌引用

  ```bash
  sed -i.bak \
    -e "s|Skill('collie:loop')|Skill('collie:autoiter')|g" \
    -e 's|collie:loop|collie:autoiter|g' \
    -e 's|Collie: LOOP DONE|Collie: AUTOITER DONE|g' \
    -e 's|~/.collie/loop/|~/.collie/autoiter/|g' \
    commands/autoiter.md
  rm commands/autoiter.md.bak
  ```

- [ ] **Step 2**: 同步 sentinel 在主 SKILL（`skills/autoiter/SKILL.md`）中的所有出现

  ```bash
  sed -i.bak 's|Collie: LOOP DONE|Collie: AUTOITER DONE|g' skills/autoiter/SKILL.md
  rm skills/autoiter/SKILL.md.bak
  ```

- [ ] **Step 3**: 同步 worktree 前缀 `.worktrees/loop-` → `.worktrees/autoiter-`

  ```bash
  grep -rn '\.worktrees/loop-' skills/autoiter*/
  sed -i.bak 's|\.worktrees/loop-|.worktrees/autoiter-|g' skills/autoiter/SKILL.md skills/autoiter-prepare/SKILL.md
  rm skills/autoiter/SKILL.md.bak skills/autoiter-prepare/SKILL.md.bak
  ```

- [ ] **Step 4**: 同步 5 个环境变量 `COLLIE_LOOP_*` → `COLLIE_AUTOITER_*`

  ```bash
  for f in skills/autoiter/SKILL.md skills/autoiter-prepare/SKILL.md commands/autoiter.md skills/autoiter/references/*.md; do
    sed -i.bak \
      -e 's|COLLIE_LOOP_ACTIVE|COLLIE_AUTOITER_ACTIVE|g' \
      -e 's|COLLIE_LOOP_NOTIFY_CMD|COLLIE_AUTOITER_NOTIFY_CMD|g' \
      -e 's|COLLIE_LOOP_EVENT|COLLIE_AUTOITER_EVENT|g' \
      -e 's|COLLIE_LOOP_RUN_ID|COLLIE_AUTOITER_RUN_ID|g' \
      -e 's|COLLIE_LOOP_STATUS_FILE|COLLIE_AUTOITER_STATUS_FILE|g' \
      "$f"
    rm "$f.bak"
  done
  ```

- [ ] **Step 5**: Verify 无残留

  ```bash
  grep -rn 'collie:loop\|COLLIE_LOOP\|Collie: LOOP DONE\|\.worktrees/loop-' \
    commands/ skills/autoiter*/ 2>/dev/null
  ```

  Expected：无输出。

[blocked-by]: B3-T4

---

### [B3-T10] 更新 queue/SKILL.md schema enum

**Files:**
- Modify: `skills/queue/SKILL.md` 第 28 / 50 / 129 / 130 / 144 行

- [ ] **Step 1**: 替换字面量

  ```bash
  sed -i.bak 's|/collie:loop|/collie:autoiter|g' skills/queue/SKILL.md
  rm skills/queue/SKILL.md.bak
  ```

- [ ] **Step 2**: Verify

  ```bash
  grep -n 'collie:loop\b' skills/queue/SKILL.md
  ```

  Expected：无输出。

[blocked-by]: B3-T4

---

### [B3-T11] 全单测 verify

- [ ] **Step 1**: 跑全部单测

  ```bash
  node --test tests/*.test.js 2>&1 | tail -15
  ```

  Expected：所有 tests pass，包括 contract test 5 个新测试 + 31 个原 loop 测试 + 其他。

- [ ] **Step 2**: 跑残留 grep（防止有遗漏字面量）

  ```bash
  grep -rn 'collie:loop\b\|COLLIE_LOOP_\|Collie: LOOP DONE\|loop-stage0' \
    commands/ skills/autoiter*/ skills/queue/ hooks/ tests/autoiter*.test.js 2>/dev/null \
    | grep -v 'feedback loop\|event loop\|loop_on_same_error\|loopDir\|currentRunFile\|iterDir'
  ```

  Expected：无输出（残留都是函数名 / 通用 loop 术语）。

[blocked-by]: B3-T5, B3-T6, B3-T7, B3-T8, B3-T9, B3-T10

---

### [B3-T12] commit B3

- [ ] **Step 1**: commit

  ```bash
  git add -A
  git commit -m "refactor: rename loop → autoiter (B3: SKILL 内容 + Orchestrator Contract)

  - skills/autoiter/SKILL.md: 新增 Section 0 — Orchestrator Contract（⛔ 主 session 不写代码/读源码/解析长日志）
  - 5 处 stage 裁定提醒（Stage 3.2 / 5.0 / 5.2 / 5.3 / 6；不硬编码 model，主 agent 实时裁定）
  - skills/autoiter/references/*.md: 引用名同步 + iter-prompt.md Stage 5.0 注释强化约束
  - skills/autoiter-prepare/SKILL.md: description + 引用名同步
  - commands/autoiter.md: skill 名 + sentinel 'Collie: AUTOITER DONE' + env var
  - skills/queue/SKILL.md: command enum 同步
  - .worktrees/autoiter-{runId} 前缀同步
  - 5 个环境变量 COLLIE_LOOP_* → COLLIE_AUTOITER_* 全文同步
  - 新增 tests/autoiter-orchestrator-contract.test.js grep-based 强制（防止 Section 0 + dispatch 提示被重构误删）"
  ```

[blocked-by]: B3-T11

---

### [B4-T1] 更新 CLAUDE.md（可与 B4-T2/T3/T4 并行）

**Files:**
- Modify: `CLAUDE.md` 第 54 / 57 / 79 / 96-97 / 116-118 / 134-135 行

- [ ] **Step 1**: 章节标题 + 散文术语替换

  ```bash
  sed -i.bak \
    -e 's|## Loop Workflow（`/collie:loop`|## Autoiter Workflow（`/collie:autoiter`|g' \
    -e 's|/collie:loop|/collie:autoiter|g' \
    -e 's|`collie:loop-prepare`|`collie:autoiter-prepare`|g' \
    -e 's|`collie:loop`|`collie:autoiter`|g' \
    -e 's|loop-stage0|autoiter-stage0|g' \
    -e 's|`/loop` 使用|`/autoiter` 使用|g' \
    -e 's|`/loop` 与 `/auto`|`/autoiter` 与 `/auto`|g' \
    -e 's|Loop vs\. /auto sentinel|Autoiter vs\. /auto sentinel|g' \
    -e 's|Collie: LOOP DONE|Collie: AUTOITER DONE|g' \
    -e 's|COLLIE_LOOP_ACTIVE|COLLIE_AUTOITER_ACTIVE|g' \
    -e 's|COLLIE_LOOP_NOTIFY_CMD|COLLIE_AUTOITER_NOTIFY_CMD|g' \
    -e 's|COLLIE_LOOP_EVENT|COLLIE_AUTOITER_EVENT|g' \
    -e 's|COLLIE_LOOP_RUN_ID|COLLIE_AUTOITER_RUN_ID|g' \
    -e 's|COLLIE_LOOP_STATUS_FILE|COLLIE_AUTOITER_STATUS_FILE|g' \
    -e 's|loop/{project-id}/|autoiter/{project-id}/|g' \
    -e 's|`/loop`|`/autoiter`|g' \
    CLAUDE.md
  rm CLAUDE.md.bak
  ```

- [ ] **Step 2**: 检查 hook 表行 79 描述 — `plan-kind: loop-stage0` 旁路 → `plan-kind: autoiter-stage0` 旁路。该行已经被上面 `loop-stage0` 替换覆盖。

- [ ] **Step 3**: 检查"ralph-loop 复用"行（line 116）— 这是外部插件名，不动；但描述句中 `/loop` 的提及需改为 `/autoiter`。已被 `\`/loop\` 使用` 替换覆盖。

- [ ] **Step 4**: Verify

  ```bash
  grep -n 'collie:loop\b\|COLLIE_LOOP_\|Loop Workflow\|Collie: LOOP DONE' CLAUDE.md
  ```

  Expected：无输出（除可能的 `loop_on_same_error` 通用 escalation code）。

  ```bash
  grep -n 'loop_on_same_error' CLAUDE.md
  ```

  若出现，确认上下文是否需要补一句"此 code 与 autoiter 命令名无对应关系"以避免歧义（按 Impact Assessment Reverse impact 项要求）。

[blocked-by]: B3-T12

---

### [B4-T2] 更新 README.md（可与 B4-T1/T3/T4 并行）

**Files:**
- Modify: `README.md` 第 57-62 / 98 / 104 / 109 / 117-119 / 156 / 186-188 行

- [ ] **Step 1**: 全文替换

  ```bash
  sed -i.bak \
    -e 's|/collie:loop|/collie:autoiter|g' \
    -e 's|`collie:loop`|`collie:autoiter`|g' \
    -e 's|### Loop 循环|### Autoiter 循环|g' \
    -e 's|`/loop`|`/autoiter`|g' \
    -e 's|loop\.md|autoiter.md|g' \
    -e 's|loop/{project-id}/|autoiter/{project-id}/|g' \
    -e 's|Collie: LOOP DONE|Collie: AUTOITER DONE|g' \
    -e 's|COLLIE_LOOP_ACTIVE|COLLIE_AUTOITER_ACTIVE|g' \
    -e 's|COLLIE_LOOP_NOTIFY_CMD|COLLIE_AUTOITER_NOTIFY_CMD|g' \
    -e 's|COLLIE_LOOP_EVENT|COLLIE_AUTOITER_EVENT|g' \
    -e 's|COLLIE_LOOP_RUN_ID|COLLIE_AUTOITER_RUN_ID|g' \
    -e 's|COLLIE_LOOP_STATUS_FILE|COLLIE_AUTOITER_STATUS_FILE|g' \
    README.md
  rm README.md.bak
  ```

- [ ] **Step 2**: Verify

  ```bash
  grep -n 'collie:loop\b\|COLLIE_LOOP\|`/loop`\|Loop 循环\|loop/{project-id}\|loop\.md' README.md
  ```

  Expected：无输出。

[blocked-by]: B3-T12

---

### [B4-T3] 更新 CHANGELOG.md（0.3.0 entry，可与 B4-T1/T2/T4 并行）

**Files:**
- Modify: `CHANGELOG.md`（在第一个 `---` 之前新增 0.3.0 段）

- [ ] **Step 1**: 在 `## 0.2.4 — 2026-04-27` 之前插入 0.3.0 段。完整文本块见本 plan §Design Spec → §Section 3.3「CHANGELOG entry」整段（4 条 bullet：rename / Section 0 / Stage TaskList 锚定 / contract test）。

  日期填本次实施的实际日期（YYYY-MM-DD 格式，由实施 agent 在 commit 时确定）。

- [ ] **Step 2**: Verify

  ```bash
  head -20 CHANGELOG.md | grep -E '^## 0\.3\.0'
  grep -E '^- \*\*rename\*\*' CHANGELOG.md | head -1
  ```

  Expected：第一行 hit 0.3.0 标题；第二行 hit `- **rename**` bullet（4 条 bullet 中第 1 条）。

[blocked-by]: B3-T12

---

### [B4-T4] bump plugin.json version（可与 B4-T1/T2/T3 并行）

**Files:**
- Modify: `.claude-plugin/plugin.json` `version` 字段

- [ ] **Step 1**: 替换

  ```bash
  sed -i.bak 's|"version": "0.2.4"|"version": "0.3.0"|' .claude-plugin/plugin.json
  rm .claude-plugin/plugin.json.bak
  ```

- [ ] **Step 2**: Verify

  ```bash
  grep '"version"' .claude-plugin/plugin.json
  ```

  Expected：`"version": "0.3.0",`

- [ ] **Step 3**: 全维度检查 `marketplace.json`（version + 命令引用 + 描述残留）

  marketplace.json 是发布到 marketplace 的入口元数据，必须与 plugin.json 同步且不能含 stale 命令引用。

  ```bash
  # 全维度 grep：version + loop 命令引用 + 描述中的命令名
  grep -nE '0\.2\.4|"version"|/collie:loop\b|`/loop`|loop command|collie:loop\b' .claude-plugin/marketplace.json || echo "no hits"
  ```

  对每一类命中，强制实施 agent 显式决策处理：

  **a) version 字段（如有 `"version": "0.2.4"`）**：必须同步改 `0.3.0`

  ```bash
  sed -i.bak 's|"version": "0.2.4"|"version": "0.3.0"|' .claude-plugin/marketplace.json && rm .claude-plugin/marketplace.json.bak
  ```

  **b) 命令名引用（如 `/collie:loop` / `\`/loop\``）**：必须替换为 autoiter 等价物

  ```bash
  sed -i.bak \
    -e 's|/collie:loop|/collie:autoiter|g' \
    -e 's|`/loop`|`/autoiter`|g' \
    .claude-plugin/marketplace.json && rm .claude-plugin/marketplace.json.bak
  ```

  **c) 通用 "loop detection" / "loop 检测" 描述句**：保留不动（指 stop-hook 步数陷阱，与命令名无关；本 plan §Section 1 表已明示）

  **d) 历史变更日志或 changelog 引用 0.2.x 版本**：保留不动（历史快照）

- [ ] **Step 4**: Verify 修复完整性

  ```bash
  # 必须无 0.2.4 残留
  grep -n '0\.2\.4' .claude-plugin/marketplace.json && echo "FAIL: 0.2.4 still present" || echo "OK: version bumped"

  # 必须无 collie:loop（不带 -prepare 后缀）残留
  grep -nE 'collie:loop\b' .claude-plugin/marketplace.json && echo "FAIL: stale command ref" || echo "OK: no stale command ref"
  ```

  Expected：两行均输出 `OK:` 前缀。

[blocked-by]: B3-T12

---

### [B4-T5] commit B4

- [ ] **Step 1**: commit

  ```bash
  git add CLAUDE.md README.md CHANGELOG.md .claude-plugin/plugin.json .claude-plugin/marketplace.json
  git commit -m "docs: rename loop → autoiter (B4: 文档同步 + 0.3.0)

  - CLAUDE.md: Loop Workflow → Autoiter Workflow 章节标题 + 散文 + 5 个约束 bullet + hook 表行
  - README.md: ### Loop 循环 → ### Autoiter 循环 + 命令语法 + 状态目录树 + 5 个 env var 表
  - CHANGELOG.md: 新增简短 0.3.0 entry（rename / Section 0 / Stage TaskList 锚定 / contract test）
  - .claude-plugin/plugin.json: 0.2.4 → 0.3.0
  - 保留 loop_on_same_error / ralph-loop / hooks.json description 'loop detection' 不动（通用术语 / 外部依赖）"
  ```

[blocked-by]: B4-T1, B4-T2, B4-T3, B4-T4

---

### [B5-T1] 更新 e2e smoke.sh scenario 5

**Files:**
- Modify: `tests/e2e/smoke.sh` 第 108-154 行（scenario 5）

- [ ] **Step 1**: 改 scenario 名 + 文件路径断言

  ```bash
  sed -i.bak \
    -e 's|e2e-05-loop-shim|e2e-05-autoiter-shim|g' \
    -e 's|commands/loop\.md|commands/autoiter.md|g' \
    -e 's|skills/loop/SKILL\.md|skills/autoiter/SKILL.md|g' \
    -e 's|skills/loop-prepare/SKILL\.md|skills/autoiter-prepare/SKILL.md|g' \
    -e 's|collie:loop-prepare|collie:autoiter-prepare|g' \
    -e 's|collie:loop|collie:autoiter|g' \
    tests/e2e/smoke.sh
  rm tests/e2e/smoke.sh.bak
  ```

- [ ] **Step 2**: 检查 `_state.loopDir` 调用断言（line 142-152）— 函数名 `loopDir` 保留；返回值断言改为含 `autoiter` 字段

  ```bash
  grep -n 'loopDir\|loop/' tests/e2e/smoke.sh
  ```

  对返回值字符串断言中的 `loop/` → `autoiter/`：

  ```bash
  sed -i.bak 's|"loop/|"autoiter/|g; s|/loop/|/autoiter/|g' tests/e2e/smoke.sh
  rm tests/e2e/smoke.sh.bak
  ```

  注意：保留 `_state.loopDir(` 函数调用本身（函数名未改）。

- [ ] **Step 3**: Verify scenario 名 + 路径断言

  ```bash
  grep -n 'e2e-05\|loop\.md\|loop/SKILL\|loop-prepare/SKILL\|"loop/' tests/e2e/smoke.sh
  ```

  Expected：仅 `e2e-05-autoiter-shim` 一行命中（其他历史 loop 引用全清）。

[blocked-by]: B4-T5

---

### [B5-T2] 完整 verify（plugin validate + 单测 + smoke）

- [ ] **Step 1**: plugin validate

  ```bash
  claude plugin validate ~/git/collie 2>&1 | tail -5
  ```

  Expected：`✔ Validation passed`

- [ ] **Step 2**: 全单测

  ```bash
  node --test tests/*.test.js 2>&1 | tail -10
  ```

  Expected：全 pass。

- [ ] **Step 3**: e2e smoke

  ```bash
  ./tests/e2e/smoke.sh 2>&1 | tail -20
  ```

  Expected：5/5 scenarios pass。

- [ ] **Step 4**: 残留全仓 grep（最终一道防线，字面量取自 §Section 1 重命名映射表全集）

  ```bash
  grep -rn \
    -e 'collie:loop\b' \
    -e 'collie:loop-prepare' \
    -e 'COLLIE_LOOP_' \
    -e 'Collie: LOOP DONE' \
    -e 'loop-stage0' \
    -e '\.worktrees/loop-' \
    -e 'loop-iter-N-fixes' \
    -e 'Loop Workflow' \
    -e '/collie:loop\b' \
    --include='*.md' --include='*.js' --include='*.json' --include='*.sh' \
    . 2>/dev/null \
    | grep -v 'docs/plans/2026-04-24-loop-command-plan\.md\|node_modules\|\.git/\|loop_on_same_error\|ralph-loop\|loop detection\|"loopDir"\|loopDir(\|currentRunFile\|iterDir'
  ```

  Expected：无输出（仅历史 plan / node_modules / 通用术语 / 函数名应该被排除）。

  **保留豁免清单**（grep -v 排除项）：
  - `docs/plans/2026-04-24-loop-command-plan.md` — 历史快照
  - `node_modules/` / `.git/` — 工程外
  - `loop_on_same_error` — stop-hook 通用 escalation event code（跨 auto/autoiter）
  - `ralph-loop` — 外部插件名
  - `loop detection` — hooks.json/marketplace.json 中的 generic 描述（指 stop-hook 步数陷阱）
  - `loopDir(` / `currentRunFile` / `iterDir` — 函数名保留不变（避免影响通用调用方）

  **Diff vs B0-T0 baseline**：

  ```bash
  # 把上面 Step 4 的 grep 实际输出写入临时文件，再与 baseline 对照
  grep -rln \
    -e 'collie:loop\b' \
    -e 'collie:loop-prepare' \
    -e 'COLLIE_LOOP_' \
    -e 'Collie: LOOP DONE' \
    -e 'loop-stage0' \
    -e '\.worktrees/loop-' \
    -e 'loop-iter-N-fixes' \
    -e 'Loop Workflow' \
    --include='*.md' --include='*.js' --include='*.json' --include='*.sh' \
    . 2>/dev/null \
    | grep -v 'docs/plans/2026-04-24-loop-command-plan\.md\|node_modules\|\.git/\|loop_on_same_error\|ralph-loop\|loop detection\|"loopDir"\|loopDir(\|currentRunFile\|iterDir' \
    | sort -u > /tmp/autoiter-final-grep.txt

  # baseline 中的所有文件应已不在 final 中（差集应等于 baseline 全集）
  comm -12 /tmp/autoiter-final-grep.txt ~/.collie/state/snappy-inventing-charm/baseline-loop-grep.txt
  ```

  Expected：`comm -12`（取交集）输出为空 — 即 baseline 中的所有文件均已被 B1-B5 处理掉，没有任何一个仍含 loop 字面量。

- [ ] **Step 5**: 实施 agent 注意事项（gated-workflow 内置 gate 显式提醒）

  本 plan 元数据 `<!-- plan-executor: collie:gated-workflow -->` 已声明 `gated-workflow` 是执行 skill。`gated-workflow` 自带 `[collie-final-review]` 节点（Step 5.7，在 `[doc-refresh]` 之后、`[finish]` 之前），调用 `Skill('collie:review')` Mode=code 做 pre-merge rubric gate。

  **本 plan 不重复定义此 gate**（避免与 SKILL 冲突），但实施 agent 必须**严格执行**：
  - `[collie-final-review]` 返回 `**Status:** PASS` 是合并前**唯一**放行条件
  - 任何 WARN/BLOCK 必须在该节点就地修复后重跑 review，不可跳过 [finish]
  - 该 gate 的具体行为见 `skills/gated-workflow/SKILL.md` Step 5.7 + CLAUDE.md "Pre-merge rubric gate" 段落


[blocked-by]: B5-T1


### [B5-T3] commit B5

- [ ] **Step 1**: commit

  ```bash
  git add tests/e2e/smoke.sh
  git commit -m "test: rename loop → autoiter (B5: e2e smoke scenario 5 + 全工程 verify)

  - tests/e2e/smoke.sh: e2e-05-loop-shim → e2e-05-autoiter-shim
  - 路径断言从 loop/SKILL.md → autoiter/SKILL.md, loop-prepare → autoiter-prepare
  - 函数调用 _state.loopDir(...) 保留（函数名未改）
  - 返回值字符串断言改为含 autoiter/ 段

  Verify clean：claude plugin validate ✔ + node --test 全 pass + smoke 5/5 + 残留 grep 仅历史 plan/通用术语。"
  ```

- [ ] **Step 2**: push（由 gated-workflow [finish] 阶段决策，不在此 commit）

[blocked-by]: B5-T2
