# Changelog

All notable changes to collie-harness are documented here.

---

## [Unreleased]

### Changed

- `agents/plan-doc-reviewer.md`: 增加 **Doc Maintenance** 检查（写侧）和 **Spec Consultation** 检查（读侧）
  - Doc Maintenance：若改动会导致 README / CLAUDE.md / docs/*-spec.md 中的描述过时，plan 必须包含对应文档更新任务，否则 block
  - Spec Consultation：`docs/*-spec.md` / `docs/superpowers/specs/` 下有明显相关 spec 但 plan 完全未引用，block
  - 新增"判断标准边界"章节，明确 Doc Maintenance 触发条件（4 项）和 Spec Consultation 触发流程（5 步）
- `skills/review/references/rubric-red-lines.md`:
  - Red line #12 `Applies in` 从 `code` 扩展为 `plan + code`；Plan-mode focus 行补入 `#12`
  - Red line #12 plan-mode 含义：plan 必须包含 README / CLAUDE.md / spec 更新任务（适用时）
  - Red line #9 plan-mode 含义：动笔前必须扫描 `docs/*-spec.md` 和 `docs/superpowers/specs/`，相关 spec 必须在 Context / References 中引用
  - Q8 **Spec distillation** 更新为双 mode 描述（plan: doc update tasks; code: write back to spec）
  - Q9 **No reinventing** 扩展覆盖 spec 复用（不只代码），并加入 plan-mode spec 检索要求
- `skills/gated-workflow/SKILL.md`:
  - TodoList 结构模板和示例代码块新增 `[doc-refresh]`（在 `[test-verify]` 之后，`[finish]` 之前）
  - 新增 **Step 5.5：文档对齐（GATE 5.95）**，插在 Step 5（代码质量洞察）和 Step 6（测试全通）之间，作为收尾前的文档核对安全网
- `commands/auto.md`:
  - Step ⓪ Mandatory Sequence 描述改为"check internal specs (`docs/*-spec.md`, `docs/superpowers/specs/`) first, then search externally"
  - Task Prompt Step 0 列表将"**Internal specs first**"置顶，作为 Research & Reuse 的第一动作
- `CLAUDE.md`:
  - Key Design Constraints 新增 **Doc maintenance enforcement**：plan 若改动用户可见行为 / 架构约束 / 已有文档内容，必须包含显式文档更新任务，由 plan-doc-reviewer + Red line #12 + Q8 共同强制，gated-workflow Step 5.5 作为安全网
  - Workflow Sequence 图注同步：`⓪ Research & Reuse` 改为"internal specs first"
  - Release Checklist 新增"**文档同步审计**"小节，要求发布前手动对照 README / CLAUDE.md 的 Workflow Sequence 章节与实际代码

---

## [0.1.0] — 2026-04-15

Initial public release.

### Architecture

Four-layer design enforcing the full Collie-style development workflow:

| Layer | What it does |
|-------|-------------|
| **0** | `acceptEdits` mode + escalation channel (`scripts/escalate.sh`) |
| **1** | Hook chain enforcing dual-reviewer handshake (`collie-harness:plan-doc-reviewer` + `collie-harness:review`) before ExitPlanMode |
| **2** | `skills/review/` — single source of truth for Collie's 12 red-lines + 10 questions + Reflexion + ELEPHANT. `agents/reviewer.md` delegates here. |
| **3** | Self-driven harness (`/auto` command via ralph-loop + CronCreate task queue) |

### Public Surface

| Entry point | Type | Purpose |
|-------------|------|---------|
| `/auto` | slash command | Full Collie workflow loop (brainstorm → plan → review → implement → rubric) |
| `/queue` | slash command | Scan `~/.collie-harness/queue/*.md` and schedule pending tasks |
| `collie-harness:review` | Skill | Collie rubric reviewer (12 red-lines + ELEPHANT check) |
| `collie-harness:queue` | Skill | CronCreate-based task queue engine |
| `collie-harness:gated-workflow` | Skill | Post-planmode implementation pipeline with quality gates |
| `collie-harness:reviewer` | Agent | Thin shell delegating to `collie-harness:review` skill (code mode) |
| `collie-harness:plan-doc-reviewer` | Agent | Structural plan document reviewer |

### Tests

- 37 unit tests (Node.js built-in test runner, zero external dependencies)
- E2E smoke tests (4 scenarios)

### Prerequisites

- [superpowers](https://github.com/superpowers-ai/superpowers) plugin
- [ralph-loop](https://github.com/ralph-loop/ralph-loop) plugin
