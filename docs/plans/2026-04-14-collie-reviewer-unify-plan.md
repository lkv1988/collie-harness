# collie-reviewer 统一化改造 — 实施计划

## Context

### 为什么要做

当前 collie-harness 的 review 体系有**三个重叠的入口**，分工模糊并且存在 DRY 违反：

| 组件 | 类型 | 触发点 | 职责 | 问题 |
|------|------|--------|------|------|
| `plan-doc-reviewer`（superpowers 自带 agent） | Agent | planmode 内 ExitPlanMode 前 | 结构化/宽松的计划完整性校验（是否有步骤、文件路径、依赖分析等） | 单项职责干净，继续保留 |
| `collie-rubric-reviewer` | Agent | gated-workflow 末尾 | Collie 风格代码审（12 红线 + 10 问题 + ELEPHANT） | **Collie 风格 rubric 的 single source of truth**，但只在代码阶段跑 |
| `kevin-reviewer`（user skill，历史遗留） | Skill | 任意临时调用 | 早期 kevin 风格通用 review（待删） | **和 `collie-rubric-reviewer` 内容 70% 重叠，DRY 违反**；不在 plugin 内，无法通过 collie-harness 分发，Wave 4 删除 |

**最核心的盲区**：Collie 风格 rubric **只在代码完成后跑**。如果 plan 阶段就方向错了（根因判断错、subagent 模型选错、重复造轮子、未沉淀到 spec），要等几小时代码写完才被 `collie-rubric-reviewer` 拦下，而 superpowers 自带的 `plan-doc-reviewer` 风格太宽松，不会在此阶段挑战这些问题。

**改造目标**：

1. **`collie-reviewer` 升格为统一 skill**，作为 Collie 风格 rubric 的**唯一真源**（single source of truth），plugin 内的 `skills/collie-reviewer/` 里存放完整 rubric + references
2. **该 skill 可在两种模式下跑**：
   - **Plan mode**（计划审查）：在 `plan-doc-reviewer` 之后、`ExitPlanMode` 之前并行调用，审查 plan 文档是否踩 Collie 红线
   - **Code mode**（代码审查）：在 gated-workflow 末尾调用，审查代码改动
3. **`collie-rubric-reviewer` 退化为"瘦壳 agent"**：agent 定义只保留 frontmatter + 一句 "Call the `collie-reviewer` skill with code mode"，rubric 内容全部从 skill 读取
4. **`kevin-reviewer` user skill 删除**（迁移 reference 内容到 plugin 内）
5. **hook 状态机升级**：`last-plan.json` 从"一个 reviewer"扩展为"两个 reviewer 的握手状态"，只有**双方都通过**才允许 `ExitPlanMode` 不触发 WARN

### 改造不动的东西

- `plan-doc-reviewer` 的文件、内部逻辑、调用方式完全不变（它是 superpowers 自带的 agent，我们无权改）
- ralph-loop、`/collie-auto` 的完成信号 `<promise>Collie: SHIP IT</promise>`
- 其他 hooks（quota guard / tracker / stop-steps-counter / notification-escalate / post-exitplan-gated-hint）内部逻辑

### 品牌彻底化（无向后兼容）

用户明确要求 **"不需要向后兼容，品牌名字彻底修改"**。所有面向外部的 persona / 品牌词统一为 **Collie**：

- `KEVIN_ESCALATE_CMD` 已在当前代码中重命名为 `COLLIE_ESCALATE_CMD`（本计划不再保留"向后兼容"豁免）
- 新建的 rubric 文档对外使用 `Collie-style` / `Collie's rubric` / `Collie's 12 red lines` 的框架叙述
- 历史 Kevin 中文原话作为"原话样本"（label: `原话`）保留在文档里，作为 Collie 声音的范本，但不再以 "Kevin's" 为主语
- 文件名 `kevin-style.md` → `collie-voice.md`（无任何 kevin 前缀残留）

---

## 决策锁定

| 项 | 决策 | 理由 |
|----|------|------|
| 单一真源位置 | `skills/collie-reviewer/` 放 plugin 内 | plugin 分发必须自包含；不能指向 user skills |
| `collie-rubric-reviewer` 命运 | **保留**，退化为瘦壳 agent（~40 行） | `/collie-auto` 的 ralph-loop 叙述和 `stop-steps-counter` 已经硬编码这个 agent 名字；删除风险大 |
| `kevin-reviewer` user skill 命运 | **删除**（Wave 4 最后执行） | 完全被 plugin 内的 `collie-reviewer` skill 覆盖；留着就是 DRY 违反 |
| skill 内部怎么调 opus | `Agent(model="opus")` 子派发 | skill 本身在主 session 里运行，但 review 必须在独立 subagent 里做（隔离污染 + opus 推理） |
| Plan mode 检测 | skill 接收 Target 参数；路径含 `plan.md` 或在 `plans/` 目录下 → plan mode，否则 code mode | 简单、无歧义 |
| 双 reviewer 握手状态 | `last-plan.json` 扩展子对象 `plan_doc_reviewer` + `collie_reviewer` | 向后兼容 + 明确语义 |
| 并发策略 | Step ③ 并行派发两个 reviewer | 缩短总时长；两个 reviewer 互不依赖 |
| hook 检测 collie-reviewer PASS | `/##\s*Collie Reviewer[\s\S]*?\*\*Status:\*\*\s*PASS\b/` | 固定格式，regex 稳定；ELEPHANT FAIL → 不含这段 |
| `collie-reviewer` skill 的语言 | 英文 frontmatter / 主体，references 保留中文原话样本 | 热路径省 token + Collie 品牌统一 |
| 品牌词 | 全部 `Collie`（persona / rubric / voice），中文原话作为"原话样本"保留但不冠 Kevin 主语 | 用户要求彻底品牌化 |

---

## Wave 1：创建 `skills/collie-reviewer/`（4 个新文件）

### 1.1 `skills/collie-reviewer/SKILL.md`

### 1.2 `skills/collie-reviewer/references/rubric-red-lines.md`

### 1.3 `skills/collie-reviewer/references/elephant-check.md`

### 1.4 `skills/collie-reviewer/references/collie-voice.md`

---

## Wave 2：改造现有组件（4 个文件）

### 2.1 `agents/collie-rubric-reviewer.md`：瘦壳化

### 2.2 `commands/collie-auto.md`：步骤 ③ 改为并行派发

### 2.3 `hooks/post-writing-plans-reviewer.js`：新状态 schema + 双 reviewer 门禁

### 2.4 `hooks/post-approved-exitplan-hint.js`：双 reviewer 检测 + 分支提示

---

## Wave 3：测试 + 文档（4 个文件）

### 3.1 `tests/post-writing-plans-reviewer.test.js`

### 3.2 `tests/post-approved-exitplan-hint.test.js`

### 3.3 `hooks/hooks.json`

### 3.4 `CLAUDE.md`

---

## Wave 4：清理与烟测

### 4.1 删除老的 user skill: `~/.claude/skills/kevin-reviewer`

### 4.2 E2E 烟测: `./tests/e2e/smoke.sh`

### 4.3 覆盖面 grep 核查

---

## 依赖关系图

```
Wave 1 (4 new files, no code deps)
  └─> Wave 2 (modify 4 existing files; depends on skill existing)
        ├─ 2.1 agents/collie-rubric-reviewer.md   [independent]
        ├─ 2.2 commands/collie-auto.md            [independent]
        ├─ 2.3 post-writing-plans-reviewer.js     [independent]
        └─ 2.4 post-approved-exitplan-hint.js     [independent]
              └─> Wave 3 (tests + docs)
                    ├─ 3.1 tests/post-writing-plans-reviewer.test.js
                    ├─ 3.2 tests/post-approved-exitplan-hint.test.js
                    ├─ 3.3 hooks/hooks.json
                    └─ 3.4 CLAUDE.md
                          └─> Wave 4 (cleanup + smoke, sequential)
                                ├─ 4.1 rm -rf kevin-reviewer
                                ├─ 4.2 smoke.sh
                                └─ 4.3 grep audit
```

**可并行批次**：
- **Batch 1**：Wave 1 的 4 个新文件（完全独立）
- **Batch 2**：Wave 2 的 4 个文件改造（完全独立）+ 各自的 CR subagent
- **Batch 3**：Wave 3 的 4 个文件（独立）+ 各自的 CR subagent
- **Batch 4**：Wave 4（串行：rm → smoke → grep）
