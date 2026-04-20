# Less Is More — Design Principles for collie-harness

**Distilled 2026-04-20** from internal R&R + external research (Anthropic, Karpathy, Dieter Rams, Unix philosophy, Maeda, Gall's Law, Microsoft Research, Cognition AI).

## Why this document exists

collie-harness 自身正在违反它 enforce 的 Red-line #13（Speculative scope）——rubric 里有证据充分的重复项而无 fire-rate 证据支撑其独立存在。本文档是"减法原则"的 single source of truth，防止未来继续单调加法。

## 7 Principles

### 1. Every red-line cites a real failure
新增 red-line / question / gate 前必须回答："上一个版本因为缺它而 fail 过吗？"答不出 → 拒绝。参考 Dieter Rams "as little design as possible" + Microsoft Research 15% finding（只有 15% 的 review 意见捕获真实缺陷）。

### 2. One gate per property, in the right layer
同一属性由多层 gate 检查 = 违反 Unix 单一职责 + 增加维护成本。如 doc-sync 由 Red-line #12 + Q8 + gated-workflow Step 5.5 三处 enforce → 选一层主宰，其他层引用。

### 3. Progressive disclosure beats context bloat
rubric 的详细条目应在 `references/` 下懒加载（Anthropic Agent Skills best practice）。SKILL.md 主体只保留入口，不内联完整 checklist。Review 输出同理：PASS 项折叠为 summary，只展开 FAIL。

### 4. Shared state > parallel agents
collie dual-reviewer 共读同一 plan 文件是正确姿势（Cognition: "Don't Build Multi-Agents" 的反例之一）。未来新增 reviewer 必须加入 `~/.collie-harness/state/` 共享状态，而非独立 fanout。

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
