# collie-harness 发布准备 - 实施计划 (v3，补内化外部依赖)

## Context

用户完成了 `collie-harness:xx` 命名重构和 37/37 单元测试通过，现在准备把这个 Claude Code plugin 发到 GitHub 作为 0.1.0 首发。

**v1 被 Collie reviewer BLOCK**，真实发现：
- **README:23 `/collie-harness:queue` 是 rename 重构漏同步**，不是 slash 语法笔误。根因：`skills/collie-queue/` 改名为 `skills/queue/` 后，user-facing 的 `/` 前缀命令在 `commands/` 目录下没有对应的 wrapper 文件（`commands/` 只有 `auto.md`）。v1 计划只改文案 = 过拟合。
- **验证标准把 skill / command / agent 混类**。这三类的激活机制不同，必须分开验证。
- **v1 完全绕开 collie-harness 自己的 gated-workflow / dual reviewer / verification**。讽刺：发布一个强制 workflow 的 plugin 却不 dogfood 它。

**v2 又被用户追问出一类新问题**：依赖外化审计。
- `plan-doc-reviewer` agent 和 `gated-workflow` skill 实际上都住在 user 级 `~/.claude/`，**不是任何 plugin 的一部分**。全新环境安装 collie-harness 后会找不到这两个依赖，workflow 跑不起来。
- `ralph-loop` 在 `commands/auto.md:12` 被使用，但 README 安装章节没列为前置依赖。
- `gated-workflow` 内部引用的 `simplify` skill 在任何地方都搜不到（`~/.claude/plugins/` 下无结果），是个悬空引用——内化时必须处理。

用户决策：
- `plan-doc-reviewer` agent + `gated-workflow` skill → **全部内化到 collie-harness**
- `ralph-loop` plugin → **README 补充安装说明**

已实测事实（避免 v1 的无证据结论）：
- `claude plugin validate ~/git/collie-harness` **存在且可用** — 本 session 早些时候试过，返回 `✔ Validation passed`
- `marketplace.json` 当前的 `"source": { "source": "url", "url": "..." }` schema **合法** — 同一次 validate 通过
- `~/.claude/agents/plan-doc-reviewer.md` 有效内容只在 1-74 行，75-208 行是 auto-generated memory scaffolding，内化必须删掉
- frontmatter 含 `memory: user` 字段，内化时去掉
- `~/.claude/skills/gated-workflow/SKILL.md` 全文 147 行，内部 `simplify` skill 引用是悬空的，内化时删掉 Step 5 整段

## 用户决策（已确认）

- GitHub handle: `KevinLiu`
- 发布策略: 应修项清完再发 0.1.0
- CHANGELOG.md: 创建，0.1.0 初始条目
- 依赖策略: plan-doc-reviewer + gated-workflow 内化；ralph-loop 写进 README 前置依赖

---

## 关键决策：命令入口

采用方案 A：补 `commands/queue.md` thin wrapper，保留 `/queue` 入口，UX 统一。

---

## 实施步骤

### Step 0：内化外部依赖

**0.1 内化 plan-doc-reviewer agent**

1. 新建 `agents/plan-doc-reviewer.md`（已完成）
2. 更新 `plugin.json` agents 数组加入 `./agents/plan-doc-reviewer.md`
3. 全限定名替换：`plan-doc-reviewer` → `collie-harness:plan-doc-reviewer`
   - `hooks/post-approved-exitplan-hint.js`
   - `hooks/post-writing-plans-reviewer.js`
   - `commands/auto.md`
   - `tests/post-approved-exitplan-hint.test.js`
   - `skills/review/references/rubric-red-lines.md` line 33
   - `CLAUDE.md` workflow 图
   - `README.md` workflow 图

**0.2 内化 gated-workflow skill**

4. 新建 `skills/gated-workflow/SKILL.md`（删掉 Step 5 simplify 整段 + [simplify] 行）
5. 全限定名替换：`gated-workflow` → `collie-harness:gated-workflow`
   - `hooks/post-exitplan-gated-hint.js`（同时去掉硬编码绝对路径）
   - `commands/auto.md`
   - `tests/post-exitplan-gated-hint.test.js`
   - `CLAUDE.md` workflow 图
   - `README.md` workflow 图

**0.3 README 补 ralph-loop 前置依赖**

6. README.md 在 superpowers 安装后追加 ralph-loop 安装段落

**0.4 内化完整性验证**

7. 运行验证命令确认无悬空引用 + tests 全通

### Step 1：修 rename 漏同步

8. 新建 `commands/queue.md` thin wrapper

### Step 2：.gitignore

9. `.gitignore` 加 `.claude/`

### Step 3：身份信息填充

10. `plugin.json`: homepage, repository, author, keywords, agents 数组
11. `marketplace.json`: owner.name, source.url
12. `README.md:65,67`: <USER> → KevinLiu
13. `LICENSE:3`: kevin → KevinLiu

### Step 4：CHANGELOG.md

14. 新建 `CHANGELOG.md`，0.1.0 首发条目

### Step 5-8：验证 + Dogfood + 提交 + Push

（由 gated-workflow 子步骤完成）

### Step 9：Spec 蒸馏

15. `CLAUDE.md` 末尾加 Release Checklist

---

## 最终验证 gate

1. `git status --short` → clean
2. `node --test tests/*.test.js` → all pass
3. `claude plugin validate ~/git/collie-harness` → ✔
4. `grep -rn '<USER>\|"kevin"' .claude-plugin/ README.md LICENSE CLAUDE.md` → 返空
5. `git status --ignored | grep .claude/` → 命中
6. 依赖内化校验全通
7. 新 session 运行时 6 入口验证通过
8. `superpowers:verification-before-completion` + `superpowers:requesting-code-review` 双通过
