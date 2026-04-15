# kevin-proxy → kevin-harness: 分发与重命名计划

## Context

当前 `kevin-proxy` 插件只能通过本地 symlink 加载，无法让其他人 `/plugin install`。用户提出三个问题：
1. 如何分发给别人？→ 自建 marketplace.json，走 `/plugin marketplace add`
2. 要不要改名？→ **改成 `kevin-harness`**（保留 Kevin 品牌 + 修掉 proxy 歧义）
3. 现在做的有什么问题？→ 有 4 个 critical bug（含我上次 commit 引入的 schema 错误），加上分发需要的 marketplace.json

基于用户决策，本计划分**三个 commit** 完成：
- **Commit 1**（Wave 1）：修 4 个 critical bug，不改包名不动内容
- **Commit 2**（Wave 1.5）：**热路径文档英文化**（rubric/command/skill/hook hints）以降 token 消耗
- **Commit 3**（Wave 2）：`kevin-proxy` → `kevin-harness` 全面重命名 + 状态目录硬切 + 补 marketplace.json + 完善 plugin.json

分发受众是**朋友和中文圈子**，所以用户文档（README/CLAUDE.md）仍然保中文；但进入模型 context 的文档（rubric/skill/command/hook hints）改英文以省 token。

---

## 决策锁定

| 项 | 决策 | 理由 |
|----|------|------|
| 新包名 | `kevin-harness` | 保 Kevin brand + harness 比 proxy 准确 |
| 状态目录 | `~/.kevin-proxy/` → `~/.kevin-harness/` **硬切不迁移** | 0.x breaking，老用户 quota 重置可接受 |
| persona | `kevin-rubric-reviewer` 保留原名 | 是卖点，不改 |
| completion signal | `Kevin: SHIP IT` 保留 | ralph-loop sentinel，不改 |
| 环境变量 | `KEVIN_ESCALATE_CMD` 保留 | 用户可能已设置，不改 |
| 发布方式 | 自建 marketplace.json | 不提交官方 marketplace |
| 语言（用户文档） | 中文 | README、CLAUDE.md 等仍给中文圈子用 |
| 语言（模型文档） | **英文**（新增决策） | rubric/command/skill 等**热路径**文档改英文以省 token |

---

## Wave 1: Critical Bug Fix（单 commit）

### #1 修 CLAUDE.md budget schema（我上个 commit 引入的 bug）
- **文件**：`CLAUDE.md`
- **当前**（错）：
  ```json
  { "daily_cap": 500000, "weekly_cap": 2000000, "auto_confirm_threshold": 50000 }
  ```
- **改成**（对齐 `hooks/pre-tool-quota-guard.js:81,86`）：
  ```json
  { "daily_token_cap": 1000000, "weekly_token_cap": 5000000, "confirm_before_autoloop": true }
  ```
- **验证**：grep `daily_token_cap` 应同时出现在 README.md、CLAUDE.md、hook 代码里

### #2 修 hooks 硬编码 fallback install path
4 个文件都写了 `~/.claude/plugins/installed/kevin-proxy` 作为 `CLAUDE_PLUGIN_ROOT` 缺失时的 fallback。

**统一改法**：缺失 `CLAUDE_PLUGIN_ROOT` 时 `stderr.write` 一条警告然后 `process.exit(0)`（hook 正常放行，不做猜测）。

- `hooks/post-tool-quota-tracker.js`
- `hooks/notification-escalate.js`
- `hooks/post-writing-plans-reviewer.js`
- `hooks/stop-steps-counter.js`

### #3 修 smoke test 硬编码仓库路径
- **文件**：`tests/e2e/smoke.sh`
- **当前**：`PLUGIN_ROOT="${HOME}/git/kevin-proxy"`
- **改成**：`PLUGIN_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"`

### #4 清 kevin-queue SKILL.md 泄露的用户路径
- **文件**：`skills/kevin-queue/SKILL.md`
- **改成**：占位符 `/path/to/project-a`、`/path/to/project-b`

### Commit 1 验证
```bash
node --test tests/*.test.js                          # 7 个测试文件全绿
./tests/e2e/smoke.sh                                 # 4 个 scenario 全过
grep -rn "daily_token_cap" CLAUDE.md README.md hooks/   # 三份一致
grep -rn "~" skills/ README.md CLAUDE.md     # 无匹配
```

**Commit message**: `fix: 修复 budget schema 文档不一致、hooks fallback 路径和 smoke 测试路径`

---

## Wave 1.5: Token 优化 — 热路径文档英文化

### 动机
Claude 的 BPE tokenizer 对中文不友好：相同语义的中文比英文多吃 1.5-3 倍 token。凡是每次流程都会被加载到模型 context 的文档，改英文能显著省 token。

**粗估**：`agents/kevin-rubric-reviewer.md`（7345 字节中文 ≈ 3500-5000 tokens）→ 英文后约 1500-2000 tokens，**单次 rubric review 省 ~2000-3000 tokens**。

### 范围（必须改成英文）
- `agents/kevin-rubric-reviewer.md` — 整个 rubric（12 红线 + 10 问题 + ELEPHANT 自检）
- `commands/kevin-auto.md` — 每次 `/kevin-auto` 调用都 load
- `skills/kevin-queue/SKILL.md` — skill 激活时 load
- Hook 的 `additionalContext` / `block.reason` 字符串

### 品牌词保留
即使改英文，以下关键词**原样保留**：
- `Kevin-style`、`Kevin's rubric`、`Kevin's voice`、`Kevin: SHIP IT`
- `/kevin-auto`、`kevin-rubric-reviewer`、`kevin-queue`、`KEVIN_ESCALATE_CMD`

### 保留中文
- `README.md`、`CLAUDE.md`、LICENSE、docs/plans/*
- stderr 消息（不进 context）
- Code comments、commit messages、test 代码

**Commit message**: `refactor: 热路径文档（rubric/command/skill/hook hints）改英文以降 token 消耗`

---

## Wave 2: Rename + Distribution（单 commit）

### 2.1 全局重命名
`kevin-proxy` → `kevin-harness`（保留白名单：`/kevin-auto`、`kevin-rubric-reviewer`、`kevin-queue`、`KEVIN_ESCALATE_CMD`、`Kevin: SHIP IT`）

### 2.2 抽 `hooks/_state.js` 共享模块
```javascript
const STATE_HOME = process.env.KEVIN_HARNESS_HOME
  || path.join(os.homedir(), '.kevin-harness');
```
支持 `KEVIN_HARNESS_HOME` 环境变量 override。

### 2.3 新建 `.claude-plugin/marketplace.json`
自建 marketplace，使用 `<USER>` 占位符。

### 2.4 完善 `plugin.json`
补全 name、version、description、author、homepage、repository、license、keywords、agents/commands/skills 字段。

### 2.5 更新 README.md 安装说明
补 marketplace 安装方式（方式 A）和 symlink 方式（方式 B）。

### Commit 2 验证
```bash
node --test tests/*.test.js
./tests/e2e/smoke.sh
grep -rn "kevin-proxy" --include="*.js" --include="*.md" --include="*.json" --include="*.sh"
# 仅允许在 docs/plans/2026-04-14-kevin-proxy-plan.md 里存在
```

**Commit message**: `refactor: 重命名 kevin-proxy → kevin-harness 并补 marketplace.json`

---

## 不做的事（明确排除）

- ❌ 英文 README.md
- ❌ CI workflow (GitHub Actions)
- ❌ CONTRIBUTING.md / CODE_OF_CONDUCT.md / ISSUE_TEMPLATE
- ❌ Linux notify-send fallback
- ❌ LICENSE 作者规范化
- ❌ docs/plans/2026-04-14-kevin-proxy-plan.md 清理
- ❌ tests/fixtures/ 删除或填充
- ❌ 提交官方 marketplace PR
