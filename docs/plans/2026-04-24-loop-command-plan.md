<!-- plan-source: /Users/kevin/.claude/plans/auto-gated-workflow-plan-impl-auto-plan-virtual-puppy.md -->
<!-- plan-topic: loop-command -->
<!-- plan-executor: collie-harness:gated-workflow -->

# Loop Command Design & Implementation Plan

> **For agentic workers:** MUST invoke Skill('collie-harness:gated-workflow') to implement this plan.

## Context

用户希望新增一个 `/collie-harness:loop` slash command（与 `/collie-harness:auto` 同级），用来驱动"跑长测试 → 观察 → 校验 → 批量修复 → 重跑"的自迭代闭环，对标 Karpathy `autoresearch`（github.com/karpathy/autoresearch, Oct 2025）。

当前 `/collie-harness:auto` 走 **R&R → brainstorming → writing-plans → dual-review → gated-workflow → SHIP** 的一次性线性闭环，不适合"长期观察 + 多轮迭代收敛"这类工程质量打磨场景。新命令的核心差异：

1. **输入是 prompt（任务描述），不是预先配置好的脚本或数据集** — 触发器由主 agent + haiku Discovery 从项目中探测，由用户在 Stage 0 确认后锁定。
2. **有 primary_goal 二元区分** — `correctness`（让工程跑起来不崩）/ `optimization`（打磨指标）/ `both`（默认），影响停止条件和回退策略。
3. **每轮迭代都跑一次完整的 `gated-workflow`** — 复用现有 plan→TDD→review→simplify→regression→final-review 管线，不重新发明。
4. **强防过拟合** — 来自 APR 文献：自验证会退化、patch overfitting、测试改写作弊。本命令硬性约束：禁止动测试、要求 root cause + reproduction、独立 verifier、全量回归、每轮 diff 审计。
5. **硬性停止条件** — iteration cap（默认 5）+ 质量阈值 + 收敛 ε + budget + deadlock（`stop-steps-counter.js` 已实现）。

**预期产物**：单次调用能无人值守运行 1-N 轮，每轮产出 iter-N/ 目录下的完整观察/分诊/修复/验证审计，最终给出"达标 SHIP / 达到迭代上限 / 无法收敛升级"的明确结论。

---

# Design Specification

## §1 Command Layout & Naming

- **Command file**: `commands/loop.md`（thin shim ~30 行，模仿 `commands/queue.md`）
- **Skill**: `skills/loop/SKILL.md`（主 orchestrator ~350 行）
- **前置体检 Skill**: `skills/loop-prepare/SKILL.md`（独立 SKILL，由主 loop SKILL 在 Stage 0.5 调用——**不是**用户直达入口；详见 §4.5）
- **References**: `skills/loop/references/{overfit-guards.md, stop-criterion.md, discovery-prompt.md, iter-prompt.md, fix-plan-template.md}` 以及 `skills/loop-prepare/references/prepare-checks.md`
- **调用**: `/collie-harness:loop "<task>" [--max-iterations N] [--budget-tokens M] [--mode interactive|queued]`
  - 默认 `--max-iterations 5`（prior art 显示 gains concentrate in iterations 1-2）
  - 默认 `--budget-tokens` 无上限（仅在用户指定或 queued 模式下启用）
  - 默认 `--mode interactive`

## §2 Runtime State Layout

**project-id 推导**：`git rev-parse --show-toplevel` 输出，将 `/` 替换为 `-`，去掉开头的 `-`，与 Claude Code 的 projects 目录编码一致（例：`/Users/kevin/git/myproject` → `Users-kevin-git-myproject`）。由 `_state.js` 的 `projectId()` helper 统一实现，SKILL 不自行推导。

```
~/.collie-harness/loop/{project-id}/current-run   # 纯文本文件，内容为当前活跃 runId（EnterPlanMode 前写入；ExitPlanMode 触发 context-clear 后，SKILL 恢复时的第一锚点）；project-scoped：不同项目各自独立，互不干扰

~/.collie-harness/loop/{project-id}/{runId}/
  run-spec.md               # Stage 0 锁定的契约（task / trigger / success criterion / budget / guards / primary_goal / iter_rollback_policy）；带 plan-kind: loop-stage0 + plan-executor: collie-harness:loop metadata
  prepare-report.md         # Stage 0.5 loop-prepare 体检报告（trigger dry-run / scalar extract / observability 结果）
  state.json                # 跨 iter 机器可读状态（见下方 schema）
  progress.md               # 跨 iter 的 DEFERRED 池 + 每轮摘要（持久化 markdown，不清空）
  status.md                 # 当前状态一句话（SKILL 在每 stage/iter 边界 overwrite；用户 `cat` 即查，面向人）
  user-log.md               # 跨 iter 叙事时间线（append-only；人类可读汇报，面向人）
  worktree-path             # 纯文本文件，记录本 runId 绑定的 worktree 绝对路径（ExitPlanMode 后创建，sentinel 后保留）
  iter-N/
    kickoff.md              # git HEAD、baseline metric、本轮目标
    raw.log                 # 触发器 subprocess 的 stdout/stderr
    observations.md         # 主 agent 观察转录（结构化 Issue 列表）
    triage.md               # Stage 4a 分诊结果（Real / Discarded / Unclear / confidence 1-5）
    verdict.md              # Stage 4b 汇总（per-issue verdict + root cause + fix outline）
    fixes/FIX-{nnn}.md      # 每个 进入 Deep Verify 的 Issue 独立档案（含 fix_confidence）
    fix-plan.md             # Stage 5.0 合并后的统一修复计划（喂给 gated-workflow；仅 fix_confidence ≥3 入选）
    blocker-report.md       # 仅当 Stage 3 auto-recovery 失败时生成，汇总诊断阶梯 + 最终失败状态
    summary.md              # Stage 6 metric delta、convergence、decision
```

**runId**: `YYYYMMDD-HHMMSS-{shortSessionId}`，通过新加的 `_state.js` 导出的 `loopDir(projectId, runId)` 统一产出路径。

**state.json schema**（SKILL.md 在每 iter kickoff + summary 时写）：
```json
{
  "runId": "...",
  "iter": 3,
  "status": "running | iter_done | converged | budget_exhausted | escalated",
  "should_continue": true,
  "stop_reason": null,
  "last_scalar": 4,
  "baseline_scalar": 2,
  "promise_signal": "Collie: LOOP DONE"
}
```

**ralph-loop 复用说明**：本命令**复用 ralph-loop 作为外层循环驱动**（与 `/auto` 一致）。`/collie-harness:loop` 输出 completion signal `<promise>Collie: LOOP DONE</promise>`（与 `/auto` 的 `Collie: SHIP IT` 区分），ralph-loop Stop hook 在未见 promise 时 block 退出形成循环。**不新建 Stop hook**。state.json 仅作 SKILL 内部跨 iter 状态交接，不被 hook 读取。

## §3 Dual Mode

- **Interactive（默认）**：Stage 0 在真正的 Claude Code planmode 中运行（见 §4）——发起时调 `EnterPlanMode`，用户用 `ExitPlanMode` 锁定契约，SKILL 随后进 worktree 跑迭代。AskUserQuestion 用于**收集** trigger / criterion / primary_goal / 是否跳过 prepare；ExitPlanMode 是**锁定** sign-off。
- **Queued（via `/collie-harness:queue` 托管）**：无人值守模式跳过 planmode 交互。`{project-id}/current-run` 仅在 Discovery + prepare **都通过后**才写入（run-spec.md 必须在 current-run 之前写入，保证 §3.5 状态机读到 current-run 时 run-spec.md 已存在；与 interactive 模式写 current-run 在 EnterPlanMode 前不同，queued 无 planmode，不需要跨 session planmode 锚点，可以推迟到确认启动时）。Discovery 推断失败 / prepare 不过 → 直接 `scripts/escalate.sh` 升级，`current-run` 未写 → 下次调用走全新开始，无悬挂指针。
  - `skills/queue/SKILL.md` 的 task schema 新增 `command` 字段支持 `/collie-harness:loop`（详见 T5）。

## §3.5 SKILL 入口状态机（每次 ralph-loop 重启 session 时执行）

ralph-loop 在每次 Stop 事件后重启 session，重新调用 `commands/loop.md`，后者无条件调用 `Skill('collie-harness:loop')`。**SKILL 的第一件事就是判断当前处于哪个状态**——这是跨 session 持续性的核心。

```
SKILL 入口（最先执行，在所有状态机分支之前）：
  projectId = _state.projectId()   # git rev-parse --show-toplevel → 编码
  嵌套检查：若检测到从 /auto 或另一 /loop session 内调用 → fail-fast escalate（⛔ 禁止 rm current-run：current-run 属于外层 run 而非本次调用）

  # 以下状态机在嵌套检查通过后执行：
  if ~/.collie-harness/loop/{project-id}/current-run 不存在:
    → 全新开始：生成 runId，写 {project-id}/current-run，进 §4 Stage 0

  else:
    runId = cat {project-id}/current-run

    if ~/.collie-harness/loop/{project-id}/{runId}/run-spec.md 不存在:
      → 刚完成 Stage 0 / ExitPlanMode 已触发但 cp 尚未完成
        尝试恢复链：读 last-plan.json → 得 plan file 路径 → 读前 3 行取 plan-source
        if 恢复链失败（last-plan.json 缺失 / plan file 不可读 / plan-source 字段缺失）:
          → Stage 0 中途终止（用户 abort / prepare 失败）：rm {project-id}/current-run → 全新开始
        else:
          Bash cp "$PLAN_SOURCE" ~/.collie-harness/loop/{project-id}/{runId}/run-spec.md
          创建 worktree（若 worktree-path 不存在），写 worktree-path 文件
          if skip_prepare=false ∧ prepare-report.md 不存在:
            调 Skill('collie-harness:loop-prepare')（在 worktree 内执行，中间产物隔离主仓）
            PASS → 继续
            FAIL → interactive: AskUserQuestion; queued: 写 state.json.status="escalated" → return（§3.5 terminal 分支接管）
          初始化 state.json（iter=1, status="running"）
          进 §5 Stage 1（iter-1）

    else:
      读 state.json:
        status == "running"     → 从 Stage 1 kickoff 重跑当前 iter（幂等；kickoff.md 存在则跳过写）
        status == "iter_done"   → 进 §9 Stage 6 停止判断
        status in (converged | budget_exhausted | escalated):
          → rm ~/.collie-harness/loop/{project-id}/current-run（清理指针，下次调用可全新开始）
          → 输出 <promise>Collie: LOOP DONE</promise>
        state.json 缺失        → 同"run-spec.md 不存在"路径（兜底）
```

**为什么这个状态机能正常工作**：`{project-id}/current-run`（持久化到 EnterPlanMode 之前）、`last-plan.json`（hook 在 planmode 期间写入）、`run-spec.md`（cp 后存在）、`state.json`（Stage 1 kickoff 首次写入）这四个文件的存在与否，精确描述了 session 在哪个阶段被中断——SKILL 无需依赖任何 session context，只读磁盘。多个 project 各自持有独立的 `{project-id}/current-run` 指针，互不干扰。

**终态清理**：sentinel 发出前 rm `{project-id}/current-run`（顺序：先 rm 再 emit；crash-safe：若 rm 成功但 emit 前崩溃，下次调用走全新路径，不会死循环），确保下次调用 `/collie-harness:loop "new-task"` 走全新开始路径。

**Sentinel 发出点唯一性原则**：**所有 sentinel 都且只通过 §3.5 terminal 分支发出**。Stage 3.3 blocker 和 G7 deadlock 等非 §3.5 路径**不**在 inline 发 sentinel；它们只做两件事：写 `state.json.status="escalated"` + 完成 reporting（blocker-report.md / user-log.md / status.md / escalate.sh / notify），然后 return。ralph-loop 重启 session → §3.5 读到 status="escalated" → rm `{project-id}/current-run` → emit `<promise>Collie: LOOP DONE</promise>`。这确保 current-run 清理路径只有一处，不重复。

**Queued 模式**：同一入口逻辑。`{project-id}/current-run` 不存在时，queued mode 走 Stage 0 无 planmode 推断路径（§3）；存在时正常 resume。

## §4 Stage 0 — Discovery & Lock（在 planmode 中）

**决策**：Stage 0 使用真正的 Claude Code planmode。理由由三个 opus subagent 交叉 review 得出（2 对 1）：(a) planmode 本来就是"pre-execution approval gate"的平台原语，Stage 0 形态完全匹配；(b) read-only 约束是白送的安全网（Discovery subagent 不可能误触代码）；(c) 与 `/auto` 语义对称，用户心智统一。

**反方论据与反驳（落地以便独立审查）**：反对 opus 的核心 concern 是——planmode 对 unattended queued 模式不友好（EnterPlanMode 会阻塞等 AskUserQuestion，无 TTY 会死锁），同时 Discovery subagent 在 read-only 约束下只能读不能写 `~/.collie-harness/loop/{project-id}/{runId}/`，得绕 `/tmp` 暂存再在 ExitPlanMode 后搬运，复杂度额外。多数方反驳：(1) queued 死锁问题在 §3 已显式分流——queued 模式跳过 planmode 交互走 Discovery 推断+escalate（L138），不会真的卡死；(2) `/tmp` 暂存路径反而自然落在"planmode read-only"的防护面里，是 feature 不是 bug——Discovery 阶段本来就不该写最终契约文件，ExitPlanMode 后再 finalize 到 `~/.collie-harness/` 才是对的流；(3) 放弃 planmode 的隐性代价是要重新实现 pre-execution gate（比如自己做 AskUserQuestion × 5 循环 + 校验 + 锁定），这等于重造 planmode 的轮子，触发 Red line #9。

**SKILL 启动**（全新开始路径，§3.5 嵌套检查通过 + `current-run` 不存在时才执行此段）：
2. 调 `_state.projectId()` 得 projectId；生成 runId（`YYYYMMDD-HHMMSS-{shortSessionId}`）；写入 `~/.collie-harness/loop/{project-id}/current-run`（project-scoped 路径，plaintext）——**必须在 `EnterPlanMode` 之前完成**，这样 ralph-loop 重启 session 后 §3.5 状态机能检测到本次 run
3. 调 `EnterPlanMode` 进入 planmode
4. 在 planmode 下按 `/auto` 惯例，将 Stage 0 的 run-spec 内容写到 **planmode system prompt 指定的 plan file**（不尝试自定义路径，Claude Code planmode 的 plan file 路径不可被 SKILL 覆盖）

**Discovery subagent (haiku — Explore 类只读扫描)**：
- 读取 `CLAUDE.md`、`README.md`、`package.json`/`Makefile`/`pyproject.toml` 等；扫描 `tests/`、`benchmarks/`、`scripts/`；
- 输出候选 trigger 列表（排序打分 1-5），候选 success criterion type（`all_green` / `scalar_threshold` / `convergence_delta` / `custom`），以及 primary_goal 建议（`correctness` / `optimization` / `both`）。
- **模型选择**：haiku（Explore 类任务，遵循用户级 `CLAUDE.md` "Agent 模型选择速查"）。若实测输出不达标再升级 sonnet，`SKILL.md` 中记录判定依据；opus 仅留给 Triage (§6) + Deep Verify (§7) + Stage 3 blocker 升级阶梯顶端。

**Confirmation（AskUserQuestion）**（Interactive 模式下）：
- Q1: 选择 trigger（或输入自定义 shell 命令）
- Q2: 选择 success criterion type 与阈值
- Q3: 选择 primary_goal
- Q4: 选择 iter_rollback_policy（默认 `kind_aware`）
- Q5: 是否跳过 Stage 0.5 prepare 体检（默认 "No, run check"；选 "Yes, skip" 表示用户此前跑过相同物料、自愿盲跑并承担后果）

**run-spec.md（锁定契约，后续只读）**：
```yaml
# 顶部 plan 元数据（collie-harness hook 识别所需，见 T9；写到 planmode plan file，ExitPlanMode 后 cp 到 run-spec.md）
# plan-source: <planmode system prompt 指定的 plan file 绝对路径>
# plan-kind: loop-stage0
# plan-executor: collie-harness:loop
task: <用户 prompt 原文>
primary_goal: correctness | optimization | both
trigger:
  kind: shell | replay | dataset
  invocation: "<shell command or path>"
  expected_output: "stdout stream / junit xml / custom parser"
  scalar_extraction: "<grep/regex/jq path>"
success_criterion:
  type: all_green | scalar_threshold | convergence_delta | custom
  threshold: <value>
budget:
  max_iterations: 5
  max_tokens: <unlimited | N>
  max_wallclock_min: <unlimited | N>
overfit_guards: [G1..G8]   # 见 §10
iter_rollback_policy: kind_aware  # 见 §9
skip_prepare: false        # Q5 用户选择
```

**Stage 0 末尾**：AskUserQuestion Q1-Q5 全部收集完毕后，主 agent 直接调 `ExitPlanMode` —— **这是 Stage 0 唯一退出方式**。⚠️ loop-prepare（§4.5）**不在 planmode 内调用**：planmode 只允许写指定 plan file，loop-prepare 需要 Bash（trigger dry-run、mkdir）和 Write（prepare-report.md），两者均受限；prepare 移到 ExitPlanMode 之后、Stage 1 之前的 §3.5 恢复路径执行（见下方"ExitPlanMode 之后"）。ExitPlanMode 被 `post-writing-plans-reviewer.js` hook 识别 `plan-kind: loop-stage0` metadata（见 T9），跳过 auto 的双 reviewer 门禁（loop Stage 0 不产 multi-task plan，不需要双 reviewer；只校验三条 metadata 齐全 + 用户明示确认）。

**为什么跳过 `collie-harness:review` rubric 审查是安全的（与 /auto 的决策分界）**：
run-spec.md 锁定的字段（trigger.invocation / scalar_extraction / success_criterion / primary_goal / overfit_guards）是后续 N 轮迭代的全局契约，乍看需要 rubric 审查防止 G5 "无界 metric" 或 G2 "root cause 字段缺失"。但 Stage 0 的结构本身已把 rubric 关键项前置消化：
- **G5 具体 metric**：由 §4.5 `loop-prepare` 的 `Trigger dry-run` + `Scalar extraction 验证` 强制——如果 `scalar_extraction` 抽不出数值 / `all_green` 状态，prepare 直接 FAIL，根本走不到 Stage 1（prepare 在 §3.5 ExitPlanMode 之后、Stage 1 之前执行，FAIL → AskUserQuestion/escalate，阻断迭代启动）。这比 rubric 静态审查更强：执行性验证 > 文本审查。
- **primary_goal 误选**：success_criterion.type 是 enum（`all_green` / `scalar_threshold` / `convergence_delta` / `custom`），primary_goal 是 enum（`correctness` / `optimization` / `both`），AskUserQuestion（Q2/Q3）提供显式选项列表而非自由输入——rubric 层面能挑出的"无界描述"问题在 AskUserQuestion 层面已被 enum 约束消除。
- **G2 root cause / G1 禁改测试**：这些 guard 作用于 iter-N 内部的 FIX 阶段，run-spec.md 只是"声明启用 G1..G8"（L128），具体 FIX 会在 Stage 5.0 合入 fix-plan.md 后被 plan-doc-reviewer + gated-workflow 内部 [collie-final-review] 逐条审查。
- **边缘残留风险（trigger.invocation 选错 shell 命令、primary_goal 与任务意图不符）**：靠 §6 Triage G8 confidence gate + §9 rollback 矩阵在 iter-1 开跑后自我纠偏——花 1 轮时间容错，仍比 Stage 0 追加一道 rubric 审查的 friction 小。

**边界守则**：一旦未来 run-spec.md schema 扩展出**自由文本字段**（例如用户描述 fix 质量偏好的 prose），本决策失效，必须补回 rubric 审查。Schema 保持 enum + 可执行字段 = 跳过安全；扩展出自由文本 = 必审。T9 hook 的 `plan-kind: loop-stage0` 分支规格（见 T9）明确记录此豁免边界。

**ExitPlanMode 之后**：

ExitPlanMode 触发 Stop 事件 → ralph-loop 重启 session → `commands/loop.md` 重新调用 SKILL → **§3.5 状态机接管**：调 `_state.projectId()` 得 projectId，检测到 `{project-id}/current-run` 存在但 `{project-id}/{runId}/run-spec.md` 不存在 → 进入 post-planmode 恢复路径：

- ⛔ 必须用 Bash `cp` 归档，**禁止 Write/Edit**（避免 LLM 改写内容）：
  ```bash
  # 恢复链：last-plan.json → plan file 路径 → plan-source 元数据 → cp
  mkdir -p ~/.collie-harness/loop/{project-id}/{runId}
  cp "$PLAN_SOURCE" ~/.collie-harness/loop/{project-id}/{runId}/run-spec.md
  ```
- 创建 worktree（`git worktree add .worktrees/loop-{runId} -b loop/{runId}`），写 `worktree-path` 文件
- （若 `skip_prepare: false` 且 `prepare-report.md` 不存在）在 worktree 内调用 `Skill('collie-harness:loop-prepare')`（**必须在 worktree 内执行**，防止 trigger dry-run 的中间产物污染主仓；prepare-report.md 写入 `~/.collie-harness/loop/{project-id}/{runId}/`）：
  - PASS → 继续
  - FAIL → interactive：AskUserQuestion（"Prepare failed: [X]. Fix material and retry, or abort?"）；queued：escalate + `state.json.status="escalated"` → **return**（§3.5 terminal 分支接管）
  - 幂等：`prepare-report.md` 已存在（session 重启）→ 跳过 prepare，直接继续
- 初始化 `state.json`（iter=1, status="running"）
- 进入 Stage 1，所有后续迭代都在 worktree 里跑
- 主分支零污染

**Queued 模式**：跳过 planmode 交互（无人值守下 EnterPlanMode 会死锁等待 AskUserQuestion 回应）。若 Discovery 未能同时推断出 trigger + primary_goal → 直接 escalate，不启动迭代。loop-prepare 在 worktree 创建后调用（与 interactive 一致）；prepare FAIL → escalate，不启动迭代。

## §4.5 Stage 0.5 — loop-prepare 体检（独立 SKILL）

**动机**：不能让用户盯着跑几小时后才发现"trigger 根本跑不通 / 拿不到 scalar / Monitor 接不上"。prepare 在 Stage 1 开始前做一次前置验证。

**调用时机**：在 §3.5 post-ExitPlanMode 恢复路径中，**worktree 创建之后**调用（不在 planmode 内）。原因：(a) planmode 只允许写指定 plan file，Bash 和 Write 均受限；(b) trigger dry-run 可能产出中间文件，在 worktree 内跑可隔离主仓，防止污染。prepare-report.md 写入 `~/.collie-harness/loop/{project-id}/{runId}/`（状态目录），不写入 worktree。

**`skills/loop-prepare/SKILL.md` 职责**：
1. **Trigger dry-run**：按 `run-spec.trigger.invocation` 在 `--dry-run` / 限定 iteration 最小子集上跑一次，timeout ≤ 5 min；确认 exit code 0（或 trigger 明示的 "preparation success"）
2. **Scalar extraction 验证**：对 dry-run 的 stdout 执行 `run-spec.trigger.scalar_extraction`，确认能抽出数值；对 `all_green` 类型则确认能抽出 green/red 状态
3. **Observability 验证**：`ToolSearch select:Monitor` 探测 Monitor tool；若不可用，跑一次 Read-tail fallback 确认 `raw.log` 写入路径可达；subprocess 终止信号可正确处理（快速起一个 `sleep 2` 子进程 + kill 验证）
4. **持久化目录**：`~/.collie-harness/loop/{project-id}/{runId}/` 可写；`iter-0/` mkdir 成功
5. **输出 `prepare-report.md`**：每项 PASS/FAIL + evidence；任一 FAIL → 主 SKILL 收到信号后 AskUserQuestion："Prepare failed on [X]. Fix your material and retry, or abort?"（不自动修；这些是用户物料问题）

**跳过路径**：`run-spec.skip_prepare: true` → `loop-prepare` 直接返回 `skipped: true`，写 `prepare-report.md` 标注"user opted out"。用户自担后果（在 user-log.md 同步落地说明）。

**为什么单独 SKILL 不嵌在主 SKILL**：
- 关注点分离：主 loop 是迭代管线，prepare 是环境体检，职责不同
- 可独立测试：T6 可以单独拿 loop-prepare 做单测
- 未来可复用：别的长跑 skill（若有）可复用 prepare 流程

## §5 Stage 1-3 — Run & Monitor

- Stage 1 记录 `iter-N/kickoff.md`（`git rev-parse HEAD` + baseline metric）。
- Stage 2 后台启动 trigger subprocess（`Bash run_in_background=true`），带 **subprocess timeout**：默认 `min(max_wallclock_min / max_iterations, 30 min)`，可在 run-spec 覆盖。超时 → SIGTERM → 记录为阻塞事件走 3.3。
- Stage 2 观察机制（按可用性降级）：
  - **首选**：built-in `Monitor` tool（流式订阅，不烧 cache）。SKILL.md 启动时用 `ToolSearch select:Monitor` 探测可用性。
  - **Fallback**：不可用时改为定时 `Read` `raw.log` 增量（每 60s，借 `ScheduleWakeup` / `run_in_background` poll），主 agent 只 read tail N 行避免上下文膨胀。
  - 两条路径都在 SKILL.md 中写明；T2 references 的 `iter-prompt.md` 给出 prompt 片段。
- Stage 3 观察职责：
  - 3.1 进展正常 → 继续；异常 → 记录到 `observations.md`；
  - 3.2 非阻塞问题 → 写入 `observations.md` 结构化 Issue 条目（id / title / evidence / severity 1-5 / first_seen_ts）；
  - 3.3 阻塞性（进程崩溃、trigger 参数错 etc.）→ **自动 recovery 阶梯**，不等用户：
    1. `kill -TERM` 后台 subprocess（若超时未死 `kill -KILL`）
    2. 主 agent **初判 blocker 复杂度**：看 stack trace / error class / 上下文规模 → 决定起步模型
       - 简单（语法/参数/配置错）→ haiku 起
       - 中等（逻辑/依赖/环境错）→ sonnet 起
       - 复杂（并发/性能/架构错）→ opus 起
    3. 派诊断 subagent（按初判模型）→ 输出 root cause + fix 方案
    4. 执行 fix + 定点验证（小范围 rerun，不走完整 trigger）
    5. 若仍失败 → **升级模型**一级（haiku→sonnet→sonnet→opus→opus 为终点），最多 3 次尝试
    6. 全部失败 → 写 `iter-N/blocker-report.md`（含每级诊断 + fix diff + 失败原因）→ 追写 `user-log.md` 叙事版 → 写 `status.md` "blocked on iter-N" → 调 `scripts/escalate.sh` → 写 `state.json.status="escalated"` → **return**（不 inline 发 sentinel；§3.5 terminal 分支在 ralph-loop 重启后发 sentinel + rm current-run）
    
    **硬原则**：Stage 3 blocker 处理**不允许等待用户介入**。Unattended 场景下用户在几小时后回来，要做的只有两件事——"哦，原来这样"或"先看看别的"。SKILL 能自愈则自愈，不能则体面退场。

**`observations.md` schema**：
```markdown
## ISSUE-{nnn}
- title: <一句话>
- evidence: <日志片段 / 截图路径 / 指标>
- severity: 1-5
- first_seen_ts: <monotonic>
- blocking: true | false
```

## §6 Stage 4a — Triage（opus, single agent）

**独立 subagent，system prompt 带 "reverse suspicion" 指令**：
- 输入 `observations.md` + `run-spec.md` + `progress.md`（供跨 iter 去重）。
- 对每条 ISSUE 输出 `{verdict: Real | Discarded | Unclear, confidence: 1-5, rationale}`。
- 写入 `triage.md`。

**Confidence gate（G8）**：
- `confidence ≥ 3` 的 Real/Unclear → 进 Stage 4b Deep Verify
- `confidence ≤ 2` 的 Real/Unclear → **不进** Deep Verify，写入 `progress.md` DEFERRED 池，标注 `triage_low_confidence`，下一轮若再次出现则累加证据（跨 iter 可能升格到 ≥3 再处理）
- `Discarded` → 丢弃（不进 DEFERRED，避免噪声）
- Unclear 进 Stage 4b 时在 FIX-{nnn}.md 里标 `uncertainty_tag: triage_unclear`

**理由**：低信心问题强上 Deep Verify 浪费 opus token 且更容易产 overfit fix；沉淀到 DEFERRED 跨轮观察是更稳健的姿态。

**为什么 opus 而非 haiku**：triage 是"后续投入重要识别者"，选错会放大下游成本，值得花钱。

## §7 Stage 4b — Deep Verify（opus, per-issue parallel）

**每个进入 Deep Verify 的 ISSUE 派一个 subagent，system prompt 带 "adversarial" 指令**：
- 禁止对该 Issue 做 self-affirmation，必须尝试证伪一次；
- 必须输出 Root Cause + Reproduction Test + Fix Outline + Why This Addresses Root Cause；
- **必须输出 `fix_confidence: 1-5`**，反映 subagent 对 "本 fix 方案能真正解决 root cause" 的自我信心。低信心必须如实上报，禁止虚报。
- 写入 `fixes/FIX-{nnn}.md`：

```yaml
id: FIX-{nnn}
kind: correctness | optimization | mixed    # §9 回退分类用
severity: 1-5
fix_confidence: 1-5                          # subagent 对本 fix 方案的自我信心
root_cause: "<text>"
reproduction_test: |
  <new test case that reproduces the issue before fix>
fix_outline: "<what to change, where>"
why_root_cause: "<adversarial justification>"
dependencies: [FIX-xxx, ...]                 # 可选
uncertainty_tag: triage_unclear | none
```

**Confidence gate（G8 — 下游分支）**：
- `fix_confidence ≥ 3` → 进 Stage 5.0 合入 `fix-plan.md`
- `fix_confidence ≤ 2` → **果断放弃**，写入 `progress.md` DEFERRED 池，tag = `deep_verify_low_confidence`，附上 subagent 的 rationale。下一轮若同 issue 再次触达 ≥3 则可以进入修复流程。
- 理由：低信心下的"尽力解决"是 APR patch-overfitting 的主要来源，宁可不修也不要用没把握的方案污染代码。

**v1 不做 correlation pass**（多 FIX 间的合并/冲突交给 Stage 5.0 的主 agent consolidation 和 gated-workflow 的 DAG 处理）。

## §8 Stage 5 — Consolidated Fix Plan → gated-workflow

- **Stage 5.0（主 agent inline，template-fill 不是 creative-generation）**：按 `references/fix-plan-template.md`（见 T2）把所有 `fixes/FIX-*.md` 填充成 `fix-plan.md`：
  - 3 元数据行（plan-source 指向 fix-plan.md；plan-topic 形如 `loop-iter-N-fixes`；plan-executor = `collie-harness:gated-workflow`）
  - 模板固定字段映射：`FIX.id` → Task id；`FIX.root_cause` → Task Why；`FIX.fix_outline` → Task How；`FIX.reproduction_test` → Task Verify；`FIX.dependencies` → DAG depends-on
  - `## Task Execution DAG`（含 batch + depends-on，基于 FIX dependencies 展开）
  - `## Impact Assessment`（聚合所有 FIX 的受影响文件；Reverse impact 必填——"本轮修复可能影响的共享状态 / 缓存 / 跨 session 行为"，FIX 无相关项时写 `None — iter-local change`）
  - `## E2E Assessment`（继承 run-spec 的 trigger 作为 e2e 候选；结论沿用 run-spec）
- **Stage 5.1**：调用 `collie-harness:gated-workflow`，输入 fix-plan.md。内部完整跑 TDD→实现→review→simplify→regression→`[collie-final-review]`。
  - **G6 diff audit 执行位置**：由 `loop` SKILL 在 Stage 5.1 返回后、Stage 5.2 之前，inline 对 `git diff` vs. fix-plan.md 的 Task 列表做 line-level 追溯检查（**不**修改 `skills/review/`，避免污染共享 asset）。审计失败 → 写 `state.json.status="escalated"` + `scripts/escalate.sh` → **return**（§3.5 terminal 分支在 ralph-loop 重启后 rm current-run + emit sentinel）。
- **Stage 5.2（rerun）**：gated-workflow 返回 PASS 且 G6 通过后，重新跑 trigger，解析 scalar，写 `iter-N/summary.md`。

**为什么不在 Stage 5 做 per-FIX mini plan**：用户明确表示要"编排成一个大计划，像 auto 下那样"。gated-workflow 内部的 DAG 天然支持 per-task 并行/串行，批量与隔离在这里并不冲突。

## §9 Stage 6 — Rollback & Next Iter

**rollback 决策矩阵（primary_goal × scalar_delta × kind 三元组；硬约束：correctness FIX **永不**被整轮回退吞掉）**：

| primary_goal | scalar_delta | 动作 |
|--------------|--------------|------|
| `correctness` | 任意 | 从不整轮回退；correctness FIX 一律保留；optimization FIX 若 scalar 退化 → per-FIX revert |
| `optimization` | 退化 | per-FIX revert 所有 `kind=optimization` 的 FIX；`kind=correctness` 的 FIX 强制保留（否则下一轮必然再次崩） |
| `optimization` | 持平/改善 | 全部保留 |
| `both`（默认） | 退化 + 本轮 ≥50% 是 optimization | per-FIX revert optimization kind；correctness kind 保留 |
| `both` | 退化 + 本轮 ≥80% 是 correctness | 全部保留（崩溃修复优先级高于指标） |
| `both` | 退化 + 落在 50-80% 中间带（correctness 多数但未达 80%） | 默认等同 "≥50% optimization" 行：per-FIX revert optimization kind，correctness kind 保留（崩溃修复硬保留不可撤） |
| `both` | 持平/改善 | 全部保留 |

任何回退都追加写 `summary.md` 的 `rollback_log` 段，记录：每个被 revert 的 FIX id、原 commit、revert commit、原因。

**停止条件（hybrid OR）**：
- iteration cap 达到（默认 5）
- quality threshold 达成（`all_green` 或 scalar ≥ threshold）
- convergence：连续 K=2 iter 的 scalar delta 满足收敛。ε 取值：(a) scalar 为整数 1-5 分制 → ε=0（严格不变）；(b) scalar 为连续数值 → ε = 0.01 * |baseline|（baseline=0 时退化为绝对阈值 0.01）。整数优先，二者冲突时取整数判据。
- budget 耗尽
- deadlock：依赖 `stop-steps-counter.js` 触发的 same-error-×3 / no-progress-×5 → escalate

**不停止时**：清理 iter-N scratch（保留 summary / fixes / observations / triage / verdict），进入 iter-(N+1)，回到 Stage 1。

### Sentinel 语义（与 `/auto` 不同，**必须**对齐用户心智）

- `/auto` 的 `<promise>Collie: SHIP IT</promise>` = **merge 完成 + worktree 清理完成**（代码已落主分支）
- `/loop` 的 `<promise>Collie: LOOP DONE</promise>` = **迭代结束**（因达标/达上限/收敛/预算/升级任一），**不含 merge 动作**
- sentinel 触发后 SKILL **保留 worktree** 不做清理；`worktree-path` 文件仍保留
- 用户回来后 `cd` 到 worktree 查看 diff / summary / user-log，**自行决定** merge 还是 discard；merge 动作不由 loop 自动执行
- 理由：loop 可能跑了 N 轮且 scalar 没达标（仅因 iteration cap 触发），此时是否 merge 由人类判断；自动 merge 会把未达标的改动推进主分支，违反"长跑质量打磨"的初衷

## §10 Overfit Guards（8 条硬性约束）

这 8 条被 `plan-doc-reviewer` 与 `collie-harness:review` 共同强制，写入 `skills/loop/references/overfit-guards.md`：

1. **G1 禁止改动测试/fixture/assertion** — 除非 FIX 本身的 `kind: correctness` 且 reproduction_test 明确标注 "new test"；严禁放松已有断言。Regex 门：diff 中涉及 `tests/**` 且非 new file = BLOCK candidate。
2. **G2 Root Cause + Reproduction 必填** — FIX-{nnn}.md 缺任一字段 = Stage 5.0 拒绝合入 fix-plan。
3. **G3 独立 Verifier** — Stage 4a / 4b 的 subagent system prompt 必须与主 agent 不同（reverse suspicion / adversarial），且禁止引用主 agent 的 observations 原文超过 2 行（防 anchor）。
4. **G4 全量回归** — gated-workflow 的 `[regression]` 步骤必须跑全量 suite，不得按 changed-files 剪枝（SWE-bench 结论）。
5. **G5 具体 metric** — success_criterion 不接受 "better" / "improved" / "looks good" 这类无界描述；type=custom 必须给出可执行的 extraction command。
6. **G6 每轮 diff 审计** — `[collie-final-review]` 额外检查：本轮 diff 每行是否能追溯到某个 FIX 条目（Red line #13 Speculative scope）。
7. **G7 重复任务检测** — 若本轮 fix-plan.md 的 Task 列表与上一轮 **token-set Jaccard 相似度** ≥ 4/5（Jaccard ratio 分桶：0-0.2→1, 0.2-0.4→2, 0.4-0.6→3, 0.6-0.8→4, 0.8-1.0→5）且 scalar 已连续 2 轮无变化 → 自动 escalate "loop_no_progress"。**不引入任何 embedding / 网络依赖**，保持 collie-harness "zero external deps" 不变式（`CLAUDE.md:13`）。实现为 pure Node.js helper，单测覆盖。
8. **G8 Confidence gate（双层）** — Triage 阶段 `confidence ≤ 2` 的 Real/Unclear issue 不进 Deep Verify，写 DEFERRED 池标 `triage_low_confidence`（§6）；Deep Verify 阶段 `fix_confidence ≤ 2` 的 FIX 不进 fix-plan.md，写 DEFERRED 池标 `deep_verify_low_confidence`（§7）。理由：低信心强修是 APR patch-overfitting 主来源；宁可沉淀跨轮观察也不放行不稳方案。

## §11 Outer Loop — ralph-loop 复用（与 `/auto` 对齐）

**决策**：复用 `ralph-loop` 作为外层循环驱动，**不新建 Stop hook**。

- 与 `/auto`（`commands/auto.md:12` 已用 ralph-loop）完全一致的模式：命令内 Promise sentinel + ralph-loop 的 Stop hook 在未见 sentinel 时 block 退出形成循环。
- `loop` 的 completion signal：`<promise>Collie: LOOP DONE</promise>`（与 `/auto` 的 `Collie: SHIP IT` 区分）。
- **语义差异（见 §9 Sentinel 语义）**：`SHIP IT` = merge 完成；`LOOP DONE` = 迭代结束但**不自动 merge**，worktree 保留等用户审阅。
- 停止条件触发时，SKILL **不** inline 发 sentinel；只写 `state.json.status` 为终态值并 return。§3.5 terminal 分支在 ralph-loop 重启后统一发出 sentinel（含 rm current-run）：
  1. 达到 quality threshold → status="converged"
  2. 达到 `max_iterations` → status="budget_exhausted"
  3. budget 耗尽 → status="budget_exhausted"
  4. convergence ε 满足 → status="converged"
  5. escalate（无法自愈，含 Stage 3.3 blocker + G7 deadlock）→ status="escalated"
- ralph-loop 需要的"何时允许退出"就是 sentinel；collie-harness 已有的 `stop-steps-counter.js` 继续提供 deadlock escape（与 `/auto` 一致）。
- ralph-loop 的 `hide-from-slash-command-tool: true` **只影响 slash command tool 对 agent 的暴露**，不影响用户从 CLI 输入 `/collie-harness:loop` 正常启动——与 `/auto` 的使用方式相同，已在该命令上验证可用。
- 保留 `state.json` 作为 SKILL 内部跨 iter 的机器可读 checkpoint（见 §2 schema），**不被 hook 读取**，只由 SKILL 自己写/读。
- 本命令**不新增** `hooks/loop-stop.js`；T3 被删除（见下方 Implementation Plan DAG 调整）。

## §12 Scoring 规范

所有评分统一 1-5 整数：
- severity（issue / fix）
- confidence（triage verdict — §6 G8 upstream gate）
- fix_confidence（Deep Verify subagent 对自身 fix 方案的信心 — §7 G8 downstream gate）
- similarity（token-set Jaccard bucketize：0-0.2→1, 0.2-0.4→2, 0.4-0.6→3, 0.6-0.8→4, 0.8-1.0→5；**不使用 embedding**）
- trigger 候选 ranking

禁止 0.x 分制（与 collie-harness 全局规范一致）。

## §13 Doc Maintenance

本次改动命中项目级 SOP，必须同步：
- `README.md`：
  - 新增 `/collie-harness:loop` 用法章节 + 与 `/auto` 的定位差异对比表；明确两条 workflow 是**平行独立**关系，不嵌套
  - 新增依赖章节声明 `ralph-loop` + `superpowers` 复用（与 `.claude-plugin/plugin.json` 同步）
  - 新增环境变量 `COLLIE_LOOP_NOTIFY_CMD` 说明（见 §14）
- `CLAUDE.md`：
  - 在 "Workflow Sequence" **同级平行** 新增 "Loop" 章节（非嵌套，避免用户误以为每次 `/auto` 都要走 loop）
  - 在 "Hooks and Their Triggers" 表补 `post-writing-plans-reviewer.js` 的 `plan-kind: loop-stage0` 分支说明（T9）
  - 在 "State Files" 下补充 `loop/{project-id}/{runId}/` 路径、`state.json`、`status.md`、`user-log.md`、`prepare-report.md`
  - 在 "Key Design Constraints" 补 overfit-guard (G1-G8) + ralph-loop 复用 + sentinel 语义差异 + Stage 3 auto-recovery 硬原则
  - 在 "Required First-Time Setup" 补 `COLLIE_LOOP_NOTIFY_CMD` 可选环境变量
- `skills/queue/SKILL.md`：扩展 task 文件 schema 支持 loop 任务（详见 Implementation Plan T5）
- `skills/loop-prepare/SKILL.md`：新建，内容由 T0 生成（体检清单 + 失败处理）
- `.claude-plugin/plugin.json`：依赖清单同步更新（若 `ralph-loop`/`superpowers` 未列则追加；与 README 依赖章节对齐）

## §14 进展的观测、记录与汇报

长跑 loop 的用户体验核心在"即使人不在现场，也能随时 cat 一个文件就知道当前跑到哪"。本节定义三元框架，**所有 Stage 的 SKILL 实现必须严格按此落地**。

### 14.1 观测（Observation — events the SKILL watches during the run）

| 观测对象 | 机制 | 频率 / 触发 |
|---------|------|------------|
| trigger subprocess 的 stdout/stderr | Monitor tool（首选）/ Read-tail fallback（每 60s 读增量）| 持续 |
| subprocess 生命周期（exit code / signal / wall time） | Bash `run_in_background=true` 返回句柄轮询 | 每 60s |
| 非阻塞问题出现 | SKILL prompt 中指定的 "record this as ISSUE-{nnn}" 指令 | 即时 |
| 阻塞事件 | 主 agent 在 observations 中识别 `blocking: true` | 即时，立刻进 §5 3.3 auto-recovery 阶梯 |
| 进展 tick（每隔 N 分钟落一次 heartbeat） | `ScheduleWakeup` 或 iter boundary | 每 5 min 或 stage 变化 |

### 14.2 记录（Recording — artifacts persisted to disk）

每条都对应 §2 state layout 中的文件。分**机读**与**人读**两类：

**机读（SKILL 内部 state transfer）**：
- `state.json` — 当前 iter / status / should_continue / stop_reason / scalars（SKILL 在每 iter kickoff + summary 边界 overwrite）
- `iter-N/kickoff.md` — git HEAD + baseline metric
- `iter-N/observations.md` / `triage.md` / `verdict.md` / `fixes/FIX-*.md` / `fix-plan.md` / `summary.md`
- `iter-N/blocker-report.md`（仅 Stage 3 auto-recovery 失败时生成）

**人读（user-facing）**：
- `status.md` — **一句话当前状态**，SKILL 在每个 stage/iter 边界 **overwrite**。用户 `cat ~/.collie-harness/loop/{project-id}/{runId}/status.md` 立即知道"跑到哪了"。示例：`iter 3/5 · Stage 4b Deep Verify · 2 FIX in verification · scalar=4 (baseline=2, +2)`
- `user-log.md` — **叙事时间线**，每个 stage/iter 边界 **append**。面向人类可读，不求机器解析。示例 entry：
  ```
  ## iter-2 · 2026-04-23 14:32 UTC
  Triage 出 5 个 issue，3 个进 Deep Verify（2 个 confidence=4，1 个 confidence=3），
  2 个 confidence=1 落 DEFERRED 池。当前 scalar=4（上轮=3，+1）。
  ```
- `prepare-report.md` — Stage 0.5 体检结论，PASS/FAIL 逐项列出
- `progress.md` — 跨 iter 的 DEFERRED 池（低信心 issue + fix 的沉淀），**持久化不清空**

### 14.3 汇报（Reporting — channels through which the user learns status）

按"干扰程度由低到高"分三档，**默认全开**（低档用户零干扰，高档只在终态触发）：

| 档次 | 渠道 | 时机 | 内容 |
|------|------|------|------|
| 被动拉 | `cat status.md` / `cat user-log.md` / `cat progress.md` | 用户自己想起来 | 当前状态 / 叙事 / DEFERRED 池 |
| 主动推（低） | stdout 定期 tick（每个 stage 边界 print 一行） | stage 转换 | `[loop runId] iter-3 Stage 5.1 → gated-workflow dispatching...` |
| 主动推（高） | 外部 notification（可选 hook） | 终态事件：sentinel 触发 / escalate / prepare 失败 / stage 3 blocker 失败 | 调 `$COLLIE_LOOP_NOTIFY_CMD` 环境变量（若设置），payload 含 runId + 事件类型 + `user-log.md` 最后 N 行 |

**`COLLIE_LOOP_NOTIFY_CMD` 约定**（写入 README + CLAUDE.md "Required First-Time Setup"）：
- 空 / 未设 → 只走 stdout，不外推
- 设置为 shell 命令 → SKILL 以 `bash -c "$COLLIE_LOOP_NOTIFY_CMD"` 调用，通过 env 传递 `COLLIE_LOOP_EVENT` / `COLLIE_LOOP_RUN_ID` / `COLLIE_LOOP_STATUS_FILE`
- 用户可接成 `osascript -e 'display notification ...'` / Slack webhook / 邮件 / whatever

### 14.4 失败场景下的汇报完整性

- **Stage 0.5 prepare 失败** → `prepare-report.md` PASS/FAIL 详情 + `status.md` "prepare failed: <check>" + `user-log.md` 追叙 + 外部 notify "prepare_failed"
- **Stage 3 blocker auto-recovery 失败** → `blocker-report.md` 阶梯详情 + `status.md` "blocked on iter-N · ladder exhausted" + `user-log.md` 追叙 + `scripts/escalate.sh` + 外部 notify "blocker_unrecoverable" + 写 `state.json.status="escalated"` → **return**（不 inline 发 sentinel；§3.5 terminal 分支在 ralph-loop 重启后 rm current-run + emit sentinel）
- **G7 deadlock escalate** → `summary.md` 记录 Jaccard 值 + `status.md` "escalated: loop_no_progress" + `user-log.md` 追叙 + `scripts/escalate.sh` + 外部 notify "deadlock" + 写 `state.json.status="escalated"` → **return**（同上，§3.5 terminal 分支接管 sentinel 发出）
- **正常达标 / iter cap / convergence / budget** → `status.md` "DONE · <reason>" + `user-log.md` 最终 summary + 外部 notify "loop_done" + 写 `state.json.status="converged"（或 budget_exhausted）` → **return**（§3.5 terminal 分支接管 rm current-run + emit sentinel）

**硬原则**：无论退出路径如何，用户下次回到终端时一定能从以下任一入口知道发生了什么：
1. `cat ~/.collie-harness/loop/<project-id>/<latest-runId>/status.md`
2. `tail -30 ~/.collie-harness/loop/<project-id>/<latest-runId>/user-log.md`
3. 若配置了 `COLLIE_LOOP_NOTIFY_CMD` → 已经在 macOS 通知中心 / Slack / 邮件看到

## Impact Assessment

**Directly affected**：
- `commands/loop.md`（新增）
- `skills/loop/SKILL.md`（新增）+ `references/{overfit-guards.md, stop-criterion.md, discovery-prompt.md, iter-prompt.md, fix-plan-template.md}`（新增 5 份）
- `skills/loop/lib/jaccard.js`（新增，G7 helper，pure Node.js）
- `skills/loop-prepare/SKILL.md`（新增，独立前置体检 SKILL）+ `skills/loop-prepare/references/prepare-checks.md`（新增）
- 运行期 user-facing artifact 契约（由 loop SKILL 在 runtime 生成，不 checked-in 但是 §14 三元 observability 的核心载体）：`~/.collie-harness/loop/{project-id}/current-run`（project-scoped runId 指针，EnterPlanMode 前写入；ExitPlanMode 触发 context-clear 后的第一恢复锚点，配合 `last-plan.json` → plan file 路径链完成 cp 归档）、`~/.collie-harness/loop/{project-id}/{runId}/status.md`（overwrite 一句话状态）、`user-log.md`（append-only 叙事）、`prepare-report.md`（Stage 0.5 体检）
- `hooks/_state.js`（新增 `projectId()` + `loopDir(projectId, runId)` + `iterDir(projectId, runId, n)` + `currentRunFile(projectId)` 导出）
- `hooks/post-writing-plans-reviewer.js`（扩展 ~10 行：`plan-kind: loop-stage0` 旁路分支，跳过 auto 的双 reviewer 门禁，只校验三条 metadata + 用户明示 ExitPlanMode）
- `.claude-plugin/plugin.json`（依赖清单同步：确保 `ralph-loop` + `superpowers` 列出）
- `tests/loop.test.js`（新增单元测试）
- `tests/e2e/smoke.sh`（新增 `e2e-05-loop-shim` 场景，shim-verification 风格）
- `README.md`、`CLAUDE.md`（文档同步，含新增 `COLLIE_LOOP_NOTIFY_CMD` 环境变量说明）
- `skills/queue/SKILL.md`（task schema 扩展 + dispatch 分支；`allowlist.txt` 保持不变，其语义是 project_dir 白名单）

**Downstream consumers**：
- `collie-harness:gated-workflow`：被 Stage 5.1 调用，输入是标准 plan 文件格式；gated-workflow 自身**无改动**
- `collie-harness:review`（Mode=plan / Mode=code）：被 gated-workflow 内部复用，**无改动**（G6 diff audit 由 loop SKILL inline 执行，不修改共享 review skill）
- `scripts/escalate.sh`：queued discovery 失败 + G7 deadlock + blocking issue 调用，无改动
- `ralph-loop`：作为外层循环驱动复用（与 `/auto` 一致），**无改动**
- `stop-steps-counter.js`：与 loop 共存——counter 是 per-session state。loop 一个 session 跑多 iter 可能提前触发 counter block；SKILL 在 iter boundary 记录 checkpoint，若 counter 触发 block，SKILL 把当前 iter 标记 deadlock escalate 并退出（保守行为，已在 CLAUDE.md 注明）

**Reverse impact**：
- 新增 `~/.collie-harness/loop/{project-id}/current-run` project-scoped 指针文件（plaintext runId）；不同 project 各自独立，同一 project 同一时间只有一个活跃 run（单 project 并发靠 queue concurrency=1 约束；多 project 可并行跑各自的 loop，互不干扰）
- 新增 `~/.collie-harness/loop/{project-id}/{runId}/` 状态目录；老 session / `/auto` / `/queue` 零影响
- runId 目录持久化不自动清理——首次 release notes 声明人工清理策略（`rm -rf ~/.collie-harness/loop/<project-id>/<older-than-7d>`）；v1 不做自动 GC
- `CLAUDE.md` 新增 "Loop" 必须**显式标注**与 "Workflow Sequence"（`/auto` 流程）**平行独立、不嵌套**，避免用户误读
- ralph-loop completion-signal 是 per-command 字符串匹配——loop 用 `Collie: LOOP DONE` 与 `/auto` 的 `Collie: SHIP IT` 区分，不互扰
- 单一 Claude session 内**不允许嵌套**：从 `/auto` 内部触发 `/loop`（或反向）会导致 ralph-loop 状态冲突；SKILL 入口检查并拒绝嵌套（fail-fast escalate）
- `post-writing-plans-reviewer.js` 扩展后的 `plan-kind: loop-stage0` 分支是**新增旁路**，不修改 `plan-kind` 未设（默认 auto 路径）的既有行为；所有现存 `/auto` 计划文件继续走双 reviewer 门禁，零回归风险
- 新增可选环境变量 `COLLIE_LOOP_NOTIFY_CMD`：未设 → 行为与不存在该变量一致（完全零影响）；设了只影响 loop 的终态汇报，不波及 `/auto` / `/queue`
- sentinel 触发后 worktree 保留（与 `/auto` 自动清理 worktree 行为不同）——runId 目录里的 `worktree-path` 指向的 `.worktrees/loop-{runId}` 需用户手动 `git worktree remove` 或人工 merge 后清理；release notes 声明此约定

## E2E Assessment

**现有基建盘点**：
- `tests/e2e/smoke.sh`（4 个场景：plugin load / auto-shim / queue-shim / gated-workflow-shim）
- 无浏览器 e2e，collie-harness 本身是 CLI 插件
- 项目类型：Claude Code plugin → CLI 命令级 e2e

**本次 e2e 策略**：
- `e2e_feasible: partial`
- **自动化部分**：`e2e-05-loop-shim` — 采用与现有 `auto-shim / queue-shim / gated-workflow-shim` 完全一致的 shim-verification 风格：
  1. `/plugin list` 能看到 `/collie-harness:loop`
  2. command shim 能 parse 必填参数 `<task>` 与可选 `--max-iterations N`、`--mode queued`
  3. SKILL 入口 `skills/loop/SKILL.md` 存在
  4. **loop-prepare SKILL 入口** `skills/loop-prepare/SKILL.md` 存在且 frontmatter 合法
  5. `_state.projectId` + `_state.loopDir` + `_state.iterDir` + `_state.currentRunFile` helper 返回期望路径（含 project-id 片段）
  6. `post-writing-plans-reviewer.js` 的 `plan-kind: loop-stage0` 分支在 mock 的空 ExitPlanMode 事件下不会 block（hook 单元测试级，沿用现有 hook test 风格；具体归入 `tests/loop.test.js`，smoke.sh 只做路径存在性检查）
  **不** mock AskUserQuestion（shell 脚本无法做到），**不** 启动 subagent，**不** 跑完整 1-6 循环
- **人工 dogfood**：发布前在一个真实的小项目上跑一次完整 `/collie-harness:loop`，验证 Stage 0 → 1 轮完整迭代 → 停止条件触发；结果写入 release notes。

---

# Implementation Plan

> **For agentic workers:** MUST invoke Skill('collie-harness:gated-workflow') to implement this plan.

## Task Execution DAG

| Task | Batch | Depends on | Key files |
|------|-------|------------|-----------|
| T0 [prep-skill] 写 `skills/loop-prepare/SKILL.md`（独立前置体检 SKILL） | 1 | — | `skills/loop-prepare/SKILL.md`, `skills/loop-prepare/references/prepare-checks.md` |
| T1 [state-ext] 扩展 `_state.js` 加 `projectId` + `loopDir` + `iterDir` + `currentRunFile` | 1 | — | `hooks/_state.js` |
| T2 [refs] 写 5 份 references + 1 个 pure helper | 1 | — | `skills/loop/references/{overfit-guards.md, stop-criterion.md, discovery-prompt.md, iter-prompt.md, fix-plan-template.md}`, `skills/loop/lib/jaccard.js` |
| T9 [hook-ext] 扩展 `post-writing-plans-reviewer.js` 加 `plan-kind: loop-stage0` 旁路分支 | 1 | — | `hooks/post-writing-plans-reviewer.js` |
| T3 [skill] 写 `skills/loop/SKILL.md` | 2 | T0, T1, T2, T9 | `skills/loop/SKILL.md` |
| T4 [cmd] 写 `commands/loop.md` shim | 3 | T3 | `commands/loop.md` |
| T5 [queue-dispatch] 扩展 queue task schema + dispatch 分支 | 3 | T4 | `skills/queue/SKILL.md` |
| T6 [unit-tests] 单测 `_state.projectId/loopDir/iterDir/currentRunFile` + Jaccard helper + fix-plan-template 合法性 + hook `loop-stage0` 分支 | 3 | T1, T2, T9 | `tests/loop.test.js` |
| T7 [e2e] 新增 `e2e-05-loop-shim`（shim-verification 风格，含 loop-prepare 入口检查） | 3 | T0, T3, T4 | `tests/e2e/smoke.sh` |
| T8 [docs] README + CLAUDE.md 同步（含 `COLLIE_LOOP_NOTIFY_CMD`、G8、hook 扩展、loop-prepare） | 3 | T0, T3, T4, T9 | `README.md`, `CLAUDE.md`, `.claude-plugin/plugin.json` |

**移除的任务**：原 T3 [stop-hook] 已删除（§11 决策：复用 ralph-loop，不新建 Stop hook）。原 T6 [queue-allowlist] 改为 T5 [queue-dispatch]（allowlist 理解错误修正）。
**新增的任务**：T0 [prep-skill]（§4.5 独立 loop-prepare SKILL）、T9 [hook-ext]（§4 Stage 0 planmode 旁路所需的 hook 扩展）。

## Task Specs

### T0 [prep-skill] — `skills/loop-prepare/SKILL.md`（独立前置体检 SKILL）

**Why**：§4.5 要求将"trigger dry-run / scalar extract / Monitor/tail 可用性 / 持久化目录 writable"做成独立的关注点分离 SKILL。这样主 loop SKILL 专注迭代管线，prepare 专注环境体检；T6 可单独对 prepare 做单测；未来其他长跑 skill 可复用。

**How**：
- **必须**通过 `Skill('skill-creator')` scaffold 创建（项目级硬约束，与 T3 同）。scaffold frontmatter dependencies 声明：无（纯 Bash + Read + ToolSearch）
- 职责严格限定（不扩展）：
  1. Trigger dry-run（`Bash` 调 `run-spec.trigger.invocation` 的 dry-run / 最小子集变体，timeout ≤ 5 min）
  2. Scalar extraction 验证（对 dry-run 输出跑 `scalar_extraction`，确认能抽出值或 green/red 状态）
  3. Observability 验证（`ToolSearch select:Monitor` 探测 + Read-tail fallback + subprocess kill 信号验证）
  4. 持久化目录 writable（`~/.collie-harness/loop/{project-id}/{runId}/` + `iter-0/` mkdir 成功）
  5. 输出 `prepare-report.md`（每项 PASS/FAIL + evidence）
- **不做**：不修 trigger（用户物料问题），不启动迭代，不动 worktree
- 跳过路径：`run-spec.skip_prepare: true` → 立即返回 `skipped: true`，写 prepare-report.md 标注"user opted out"
- 失败路径：任一 check FAIL → 返回到主 loop SKILL，由主 SKILL 通过 AskUserQuestion 决定 abort/retry（queued 模式直接 escalate）
- `skills/loop-prepare/references/prepare-checks.md`：展开每项 check 的具体命令、timeout、pass/fail 判据

**Verify**：T6 单测 prepare-report.md 格式；T7 e2e 检查 SKILL 入口存在。

### T1 [state-ext] — `hooks/_state.js` 扩展

**Why**：复用 collie-harness 现有的路径与 sessionId 约定，不在业务代码里重复计算。

**How**：
- 在 `_state.js` 导出 `projectId(cwd?)` — 以 `cwd ?? process.cwd()` 为输入，调 `execSync('git rev-parse --show-toplevel')` 得项目根目录，将 `/` 替换为 `-`、去掉开头的 `-`，返回 slug（例：`Users-kevin-git-myproject`）；`cwd` 参数仅供单测覆写
- 导出 `loopDir(projectId, runId)` 返回 `${COLLIE_HARNESS_HOME}/loop/${projectId}/${runId}/`（遵循 `COLLIE_HARNESS_HOME` env 覆盖）
- 导出 `currentRunFile(projectId)` = `${COLLIE_HARNESS_HOME}/loop/${projectId}/current-run`
- 导出 helper `iterDir(projectId, runId, n)` = `loopDir(projectId, runId) + iter-${n}/`
- 纯 pure function，无副作用（不 mkdir；目录创建由 SKILL 在 Stage 0 首次写 run-spec.md 时 inline `fs.mkdirSync(..., { recursive: true })`）

**Verify**：T6 单测覆盖 `projectId()` 路径编码、`loopDir/iterDir/currentRunFile` 返回路径 × 环境变量切换。

### T2 [refs] — 5 份 references + 1 个 pure helper

**文件与内容**：
- `references/overfit-guards.md`：逐条展开 §10 的 G1-G8（含 G8 Triage + Deep Verify 双层 confidence gate），供 plan-doc-reviewer 和 collie-harness:review 引用
- `references/stop-criterion.md`：展开 §9 停止条件 + rollback 决策矩阵（primary_goal × scalar_delta × kind）伪代码
- `references/discovery-prompt.md`：Stage 0 Discovery subagent 的 haiku system prompt
- `references/iter-prompt.md`：Stage 1-6 各子 agent prompt（含 Monitor fallback 提示、reverse suspicion / adversarial 差异化 prompt）
- `references/fix-plan-template.md`：Stage 5.0 的 template 骨架——3 元数据行 + "For agentic workers" override + `## Task Execution DAG` 表头 + `## Impact Assessment` + `## E2E Assessment`；包含从 `FIX-{nnn}.md` 字段到 plan section 的 field-by-field 映射表。目的：让 Stage 5.0 从"creative generation"变成"template fill"，降低被 plan-doc-reviewer 拒的概率
- `lib/jaccard.js`：pure Node.js token-set Jaccard 相似度 helper，导出 `jaccard(strA, strB) → number` + `bucketize(ratio) → 1..5`。零依赖。

**Verify**：人工检查 prompt 质量；jaccard.js 被 T6 单测覆盖。

### T3 [skill] — `skills/loop/SKILL.md`

**How**：
- **必须**通过 `Skill('skill-creator')` scaffold 创建 —— 不得手写 SKILL.md 骨架。这是项目级硬约束（CLAUDE.md Red line #12 补充说明 + `skills/gated-workflow/SKILL.md` Step 5.5）。scaffold 产出的 frontmatter dependencies 声明：`collie-harness:gated-workflow`, `collie-harness:review`, `ralph-loop`, `superpowers:subagent-driven-development`
- **同步更新 `.claude-plugin/plugin.json`** 的 plugin-level 依赖清单：若 `ralph-loop` / `superpowers` 尚未列出则追加；`CLAUDE.md` Release Checklist 的"依赖审计"条目要求任何在 `commands/hooks/agents/skills/` 引用的外部 plugin 必须在 README 前置依赖章节明确列出。与 README 依赖章节同步更新（放在 T8 的 README 改动内）
- 主体按设计规范 §1-§13 展开，每 Stage 写明：输入/输出文件、subagent 调用参数（含显式 `model=`）、失败路径（escalate 或 retry）
- 嵌入 dot 流程图（与 `auto.md` 一致风格）
- Stage 5.1 返回后 inline 执行 G6 diff audit（对比 `git diff` 与 `fix-plan.md` Tasks）
- Stage 2 Monitor tool 可用性探测：`ToolSearch select:Monitor` → 不可用则走 Read-tail fallback（两条路径都在 SKILL 里明文给）
- SKILL 入口检查：拒绝从 `/auto` 或另一 `/loop` session 嵌套调用（fail-fast escalate）
- 输出 completion signal：`<promise>Collie: LOOP DONE</promise>`

**Verify**：人工检查 + T7 e2e 能加载 SKILL。

### T4 [cmd] — `commands/loop.md`

**How**：
- ~35 行 thin shim，仿 `commands/queue.md`（但需包含 Task Prompt 说明 resume 路径，因为 ralph-loop 每次重启 session 都会重读此文件）
- Frontmatter 声明使用 ralph-loop（与 `commands/auto.md` 一致）
- Argument parsing：`<task>` 必填；`--max-iterations`、`--budget-tokens`、`--mode` 可选
- **Task Prompt 核心**（ralph-loop 每次重启 session 后，模型读到这段指令并执行）：
  > 调用 `Skill('collie-harness:loop')`，传入 arguments。SKILL 内部的 §3.5 状态机会自动调用 `_state.projectId()` 推导当前项目 ID，检测 `~/.collie-harness/loop/{project-id}/current-run` 判断 fresh-start vs resume，无需命令文件做额外判断。
- arguments 原样透传给 SKILL

**Verify**：T7 e2e `plugin list` 能看到 `/collie-harness:loop`。

### T5 [queue-dispatch] — `skills/queue/SKILL.md`

**背景**：原 plan 误以为"加 allowlist"即可。实际 `skills/queue/SKILL.md:114-116` 的 `allowlist.txt` 是 project_dir 白名单，`skills/queue/SKILL.md:105` 的命令调用硬编码 `/auto "{task.prompt}"`。

**How**：
- 扩展 queue 的 task 文件 schema：新增 `command` 字段（默认 `/collie-harness:auto`，可选 `/collie-harness:loop`）
- Execute 步骤按 `task.command` 分派：`/auto` vs. `/loop`
- 更新 Task File Format 示例与注释；`allowlist.txt` 语义**不变**（仍为 project_dir）
- queued 模式下的 `/loop`：SKILL 入口检测到 `--mode queued` 且 Stage 0 Discovery 无法同时推断 trigger + primary_goal → 立即 escalate，不启动迭代（与 §3 设计一致）

**Verify**：人工验证 queue 能分派两种命令；T6 单测覆盖 task schema 解析（若实现了 helper）。

### T6 [unit-tests] — `tests/loop.test.js`

**Cases**：
1. `projectId(cwd)` 路径编码：`/Users/kevin/git/myproject` → `Users-kevin-git-myproject`；根目录 `/` → `root`（边界）
2. `loopDir(projectId, runId)`：默认 env 返回 `~/.collie-harness/loop/{projectId}/{runId}/`；`COLLIE_HARNESS_HOME=/tmp/x` 返回 `/tmp/x/loop/{projectId}/{runId}/`
3. `currentRunFile(projectId)`：返回路径含 projectId 片段，不同 projectId 返回不同路径
4. `iterDir(projectId, runId, n)`：拼接正确，n=0 / n=99 边界
5. `jaccard(a, b)`：同字符串 = 1.0，完全不同 = 0，部分重合点抽样若干
6. `bucketize`：五个分桶边界（0.2/0.4/0.6/0.8）精确映射 1-5
7. `fix-plan-template.md` 合法性：`Read` 模板文件，断包含 3 条 metadata 行占位 + "For agentic workers" + DAG 表头 + Impact Assessment + E2E Assessment 章节名

**Verify**：`node --test tests/loop.test.js` 全绿。

### T7 [e2e] — `tests/e2e/smoke.sh`

**Case `e2e-05-loop-shim`**（shim-verification 风格，对齐现有 4 场景）：
1. `claude --plugin-dir . --output-format=json --no-interactive -p "/plugin list"` 输出包含 `/collie-harness:loop`
2. command shim 文件 `commands/loop.md` 存在且有合法 frontmatter
3. SKILL 入口 `skills/loop/SKILL.md` 存在
4. node 单命令加载 `hooks/_state.js` 调用 `loopDir('proj', 'smoke-test')` 返回期望字符串（含 project-id 片段）

**不 mock AskUserQuestion，不启动 subagent，不跑完整 1-6 循环**（真正的长测试属于人工 dogfood）。

**Verify**：`./tests/e2e/smoke.sh` 5 场景全绿。

### T8 [docs] — 文档同步

**README.md**：
- 在 `工作流` 章节**平行**新增 `Loop 循环` 小节（不嵌套），含：
  - 一句话定位（长时运行 + 指标驱动 + 防过拟合）
  - 用法示例
  - 与 `/auto` 的差异对比表（触发 / 循环结构 / 停止条件 / 典型场景）
  - 显式声明"两条 workflow 是平行独立关系"
- `State Files` 补 `loop/{project-id}/{runId}/` + `state.json`

**CLAUDE.md**：
- 在 `Workflow Sequence` **平行同级** 新增 `Loop` 章节，列 Stage 0-6 摘要 + G1-G8 overfit guards（含 G8 双层 confidence gate）+ ralph-loop 复用声明
- `State Files` 补 `loop/{project-id}/{runId}/` 子树与 `state.json` schema 摘要
- `Key Design Constraints` 追加：overfit-guard 清单 + ralph-loop 复用 + Loop vs. `/auto` 嵌套禁止条款
- **不** 新增 Hook 条目（因为不新建 hook）

**Verify**：人工对照 + `plan-doc-reviewer` 的 Doc Maintenance 检查。

### T9 [hook-ext] — `hooks/post-writing-plans-reviewer.js` 扩展（`plan-kind: loop-stage0` 旁路）

**Why**：§4 Stage 0 在 Claude Code planmode 中运行；ExitPlanMode 时 hook 默认走 `/auto` 的双 reviewer 门禁，会 `decision:'block'` 阻止退出。loop Stage 0 的 run-spec.md **不是**多任务 plan，不需要 `collie-harness:plan-doc-reviewer` + `collie-harness:review`；只需校验三条 metadata 齐全 + 用户明示 ExitPlanMode 即可。

**豁免边界（与 §4 "为什么跳过 rubric 审查是安全的" 小节对齐）**：本旁路仅对 run-spec.md 这类 **enum-only + 可执行字段** 的 schema 生效；G5/G2/primary_goal 靠 §4.5 prepare 可执行性验证 + AskUserQuestion enum 约束前置消化。一旦 run-spec.md schema 未来扩展出自由文本字段，本旁路必须失效，改回双 reviewer 路径。T9 hook 实现须在 metadata 校验时记录 run-spec.md 的 schema version（或至少断言必填 enum 字段到位），为未来 schema 扩展留锚点。

**How**（~10-15 行改动，最小侵入）：

**Write 感知**：Stage 0 把 run-spec 内容写到 planmode system prompt 指定的 plan file（路径符合 `-plan.md` 后缀或 `plans/` 目录，与 `/auto` 写 plan 完全一致），现有 hook 的 Write/Edit 监听**自动**把这个路径登记到 `last-plan.json`——无需额外感知逻辑。

**ExitPlanMode bypass**：在 `post-writing-plans-reviewer.js` 的 ExitPlanMode 分支：
- 读 `last-plan.json` 里记录的 plan file，解析前几行的 `plan-kind:` metadata
- 若 `plan-kind == "loop-stage0"`：
  - 校验三条 metadata 齐全（`plan-source`、`plan-kind`、`plan-executor: collie-harness:loop`）
  - **断言关键 enum 字段齐全**（primary_goal / trigger.kind / success_criterion.type / iter_rollback_policy），作为豁免边界 sanity check；任一缺失 → block
  - 全部齐全 → 返回 approve，不触碰 auto 的 dual-reviewer state
  - 任一缺失 → 返回 `decision:'block'`，reason 指向缺失字段
- 若 `plan-kind` 未设或为其他值 → **走既有 auto 路径**（零回归）
- `plan-kind` 值域枚举：未设 / `loop-stage0`（未来扩展时在此加）

**不动** `post-approved-exitplan-hint.js` 与 `post-exitplan-gated-hint.js`（loop Stage 0 的 `plan-executor: collie-harness:loop`，gated-hint 只认 `collie-harness:gated-workflow`，自然沉默；后续 Stage 5.1 内部的 fix-plan.md 才是 `plan-executor: collie-harness:gated-workflow`，届时走 gated-hint 常规路径）

**Verify**：
- T6 单测覆盖：
  1. `plan-kind: loop-stage0` + 三条 metadata 齐全 → hook 返回 approve
  2. `plan-kind: loop-stage0` + 缺 `plan-source` → hook 返回 block
  3. `plan-kind` 未设（auto 路径）→ 走既有 dual-reviewer 逻辑（回归测试已有用例）
- T7 e2e：smoke 里只检查 hook 文件存在 + 语法合法（`node --check`）

## Verification (end-to-end)

实施完成后：
1. `claude plugin validate ~/git/collie-harness` 期望 PASS
2. `node --test tests/*.test.js` 全绿（含 `tests/loop.test.js` 新增 case：5 组原计划 + hook `loop-stage0` 旁路 3 组 = 共 8+ case）
3. `./tests/e2e/smoke.sh` 5 场景全绿（新增 `e2e-05-loop-shim`，含 loop-prepare SKILL 入口 + hook 语法检查）
4. `grep -n '/collie-harness' README.md CLAUDE.md` 与 `ls commands/ skills/*/SKILL.md` 入口对应（入口对应表审计；loop + loop-prepare 都要覆盖，`CLAUDE.md` Release Checklist 硬性条目）
5. **Stage 0 planmode 旁路验证**：手动构造 `plan-kind: loop-stage0` 的 run-spec.md，跑一次 ExitPlanMode，确认 hook 放行；再构造未设 `plan-kind` 的文件，确认走原双 reviewer 门禁（零回归）
6. **人工 dogfood**：在一个小项目跑一次完整 `/collie-harness:loop`，覆盖：Stage 0 Discovery+AskUserQuestion → Stage 0.5 prepare 通过 → ExitPlanMode → worktree → 1 轮完整迭代（含 Triage confidence gate + Deep Verify fix_confidence gate 各至少命中一次）→ 停止条件触发 → `<promise>Collie: LOOP DONE</promise>` → worktree 保留；同时验证 `status.md` / `user-log.md` 可读，`COLLIE_LOOP_NOTIFY_CMD`（若配）触发。记录到 release notes

## Release & Rollout

- 合并后 bump `0.2.3`（minor feature）
- CHANGELOG 记录：
  - 新增 `/collie-harness:loop` 命令与 skill（含独立 `loop-prepare` 前置体检 SKILL）
  - queue task schema 扩展（含 `command` dispatch 分支，`allowlist.txt` 语义不变）
  - `post-writing-plans-reviewer.js` 新增 `plan-kind: loop-stage0` 旁路（auto 路径零回归）
  - ralph-loop 依赖复用（与 `/auto` 一致）
  - 新增 overfit guards **G1-G8**（G8 = Triage + Deep Verify 双层 confidence gate）
  - 新增可选环境变量 `COLLIE_LOOP_NOTIFY_CMD`（终态事件外部通知）
  - sentinel 语义说明：`LOOP DONE` = 迭代结束但 worktree 保留，与 `/auto` 的 `SHIP IT`（merge 完成）不同
- 如有 regression（影响 `/auto` 或 `/queue`），rollback 本次 merge 即可，状态目录 `~/.collie-harness/loop/` 残留对老命令零影响
