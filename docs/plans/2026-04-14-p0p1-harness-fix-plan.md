# collie P0/P1 Harness Fix — 实施计划

## Context

### 为什么要做

对 collie 用 agent-harness-construction skill（opus subagent）做了 4 维度 review，发现 3 个 P0 和 1 个 P1 问题直接影响 harness 的核心承诺：

| 问题 | 位置 | 影响维度 | 后果 |
|------|------|---------|------|
| **ExitPlanMode 未批只发 `additionalContext` 而不 block** | `hooks/post-writing-plans-reviewer.js:108-125` | Recovery | 所谓"强制双 reviewer 门禁"实际是 soft warning，模型可无视继续 ExitPlanMode |
| **`stop-steps-counter.js` 触发 block 后不清零 state** | `hooks/stop-steps-counter.js:204-220` | Recovery | 下次 Stop 读回持久化 counter，再次 block，agent **永久锁死** |
| **4 处 `execFileSync(escalate, ..., {stdio:'inherit'})`** | `post-tool-quota-tracker.js:62`、`stop-steps-counter.js:198`、`notification-escalate.js:31`、`post-writing-plans-reviewer.js:113` | Observation | escalate.sh 若打印任何 stdout 就会污染 hook JSON protocol 通道 → `JSON.parse` 失败，hook 静默断链（未爆 bug） |
| **`post-exitplan-gated-hint.js` 无条件输出 proceed 信号** | `hooks/post-exitplan-gated-hint.js:30-32` | Action Space | 和 post-writing-plans-reviewer 的 BLOCK 警告叠加 → 模型同时收到"你违规了"和"干得好继续下一步"的矛盾信号 |

### 改造目标

**修 4 个，不碰其他。** 其他 review 发现（观察协议重构、删除 collie-rubric-reviewer 瘦壳、references lazy-load、retry-after 解析、matcher 收窄）都是结构性改造，风险面更大，本次**明确不做**。

### 不做的事（明确排除）

- ❌ 统一 observation schema 改造（`status`/`summary`/`next_actions`/`artifacts`）— 侵入每个 hook，风险大
- ❌ 删除 `agents/collie-rubric-reviewer.md` — `/collie-auto` 和 stop-steps-counter 字符串引用这个名字，上次重构已锁定保留
- ❌ `skills/collie-reviewer/references/*.md` 改 lazy-load — QOL 优化，不是正确性问题
- ❌ `post-tool-quota-tracker.js` 从 retry-after 解析 rate-limit 冷却期 — 真实 payload shape 未知，需要先抓样本再说
- ❌ 收窄 `pre-tool-quota-guard` / `post-tool-quota-tracker` 的 `matcher: "*"` — tracker 的 `payload.usage` 语义跨 PostToolUse 事件未验证，贸然收窄可能漏计 token
- ❌ 工具名常量化（`_tool-names.js`）— 与 P1-A 无耦合，下次再做

---

## 决策锁定

| 项 | 决策 | 理由 |
|----|------|------|
| P0-1 ExitPlanMode 未批输出 | 改为 `{decision:'block', reason:..., additionalContext:...}` 并存 | `decision:'block'` 是硬门禁，`additionalContext` 仍提供操作指引（两个字段 Claude Code hook protocol 允许共存） |
| P0-2 stop-counter block 后的 state | 重置 `last_tool_errors=[]`、`same_error_count=0`、`no_progress_steps=0`，再调 `saveState`，再写 stdout、再 exit | 重置必须在 block 前持久化，否则下次 Stop 读回旧值 |
| P0-3 stdio 模式 | 全部改 `{stdio:['ignore','ignore','inherit']}` | 丢弃 escalate stdout（不污染 hook JSON 通道），保留 stderr 走向父进程（便于调试） |
| P1-A gated-hint 条件化 | 读 `last-plan.json`，双 reviewer 都 approved 才输出 proceed 提示；否则静默 | 消除与 P0-1 BLOCK 信号的叠加冲突 |
| 测试策略 | 每个修复都加至少一条 unit test；P0-3 的 stdio 改动纯参数替换，用 smoke 验收即可 | 测试 harness 已完备，加 case 成本低 |

---

## Wave 1：P0-1 — `post-writing-plans-reviewer.js` 硬 block 门禁

### 1.1 修改 `hooks/post-writing-plans-reviewer.js`

**改造后**（同时兼顾 P0-3 的 stdio 修复）：

```javascript
if (needsWarn) {
  const missingList = missing.join(' + ');
  process.stderr.write(`[collie] BLOCK: plan file not approved by ${missingList} before ExitPlanMode\n`);

  try {
    execFileSync(escalateScript, [
      'WARN',
      'plan-not-reviewed-before-exit-plan-mode',
      JSON.stringify({ session_id: sessionId, missing }),
    ], { stdio: ['ignore', 'ignore', 'inherit'] });
  } catch (e) {
    process.stderr.write('[collie/post-writing-plans-reviewer] escalate.sh failed: ' + e.message + '\n');
  }

  const output = {
    decision: 'block',
    reason: `⚠️ [collie] ExitPlanMode 被拦截：plan 尚未被 ${missingList} 批准。必须先并行调用 Agent(subagent_type='plan-doc-reviewer', model='opus') 和 Skill('collie-reviewer', Mode=plan)，双方都返回批准后才能 ExitPlanMode。`,
  };
  process.stdout.write(JSON.stringify(output) + '\n');
  process.exit(0);
}
```

### 1.2 更新 `tests/post-writing-plans-reviewer.test.js`

- `ExitPlanMode WARN when both reviewers pending` → 改为期待 `decision:'block'`
- `ExitPlanMode WARN when only plan-doc-reviewer approved` → 同上
- `ExitPlanMode WARN when only collie-reviewer approved` → 同上
- `ExitPlanMode silent when both approved` → 保持不变

---

## Wave 2：P0-2 — `stop-steps-counter.js` block 后重置

**改造**：在每个 block 发射前，把对应 counter 清零并再持久化一次。

```javascript
if (state.same_error_count >= 3) {
  callEscalate('WARN', 'loop_on_same_error', { ... });
  state.same_error_count = 0;
  state.last_tool_errors = [];
  saveState(state);
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: '⚠️ Same error detected 3 times in a row. Counters reset — investigate root cause (see escalations.log for error hash) before continuing.',
  }) + '\n');
  process.exit(0);
}

if (state.no_progress_steps >= 5) {
  callEscalate('WARN', 'no_progress', { no_progress_steps: state.no_progress_steps, session_id: sessionId });
  state.no_progress_steps = 0;
  saveState(state);
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: '⚠️ 5 consecutive steps with no file changes. Counter reset — check if the agent is stuck or needs a different approach.',
  }) + '\n');
  process.exit(0);
}
```

同时修 P0-3: `callEscalate` 内的 `{ stdio: 'inherit' }` → `{ stdio: ['ignore','ignore','inherit'] }`

### 2.2 新增测试 (`tests/stop-steps-counter.test.js`)

- `same_error_count 3 → block + counter reset`
- `no_progress_steps 5 → block + counter reset`
- `block after reset no longer blocks next turn`

---

## Wave 3：P0-3 — escalate.sh 调用 stdio 统一收窄

- `hooks/post-tool-quota-tracker.js:62`: `{ stdio: 'inherit' }` → `{ stdio: ['ignore','ignore','inherit'] }`
- `hooks/notification-escalate.js:31`: `{ stdio: 'inherit' }` → `{ stdio: ['ignore','ignore','inherit'] }`
- (`stop-steps-counter.js` 和 `post-writing-plans-reviewer.js` 各自在 Wave 1/2 顺带修完)

---

## Wave 4：P1-A — `post-exitplan-gated-hint.js` 条件化

读 `last-plan.json`，只在双 reviewer 都 approved 时才输出 proceed hint；否则静默。始终写 `phase.json`。

### 新增/更新测试

- `both approved → emit proceed hint`
- `only plan-doc approved → stay silent`
- `last-plan.json missing → stay silent`
- `phase.json still written regardless of approval state`

---

## Wave 5：验证

```bash
node --check hooks/post-writing-plans-reviewer.js
node --check hooks/stop-steps-counter.js
node --check hooks/post-tool-quota-tracker.js
node --check hooks/notification-escalate.js
node --check hooks/post-exitplan-gated-hint.js
node --test tests/*.test.js
./tests/e2e/smoke.sh
grep -rn "stdio: 'inherit'" hooks/
grep -rn "additionalContext.*plan file has NOT" hooks/
```

---

## Critical 文件清单

**修改**：
- `hooks/post-writing-plans-reviewer.js`（Wave 1 + P0-3 1/4）
- `hooks/stop-steps-counter.js`（Wave 2 + P0-3 2/4）
- `hooks/post-tool-quota-tracker.js`（P0-3 3/4）
- `hooks/notification-escalate.js`（P0-3 4/4）
- `hooks/post-exitplan-gated-hint.js`（Wave 4，整文件重写）
- `tests/post-writing-plans-reviewer.test.js`（3 个现有 case 改断言）
- `tests/stop-steps-counter.test.js`（新增 3 个 case）
- `tests/post-exitplan-gated-hint.test.js`（新增 4 个 case）
