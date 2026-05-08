# Memory Palace 合并到 Collie-Harness 计划

## 背景

memory-palace 是一个基于认知科学元规则的 AI agent 记忆系统，已在独立 repo (`~/git/memory-palace`) 中完成 v0.1.0 实现。包含 7 个 JS 脚本、5 个 hook、1 个 SKILL.md 决策树、16 个通过的测试。

用户决定将其合并到 collie-harness plugin 中，而非作为独立 plugin 维护。原因：当前只 for Claude Code，避免维护两个 plugin 的开销。未来如需多 agent 适配再拆出。

## 源码位置

- memory-palace 源：`~/git/memory-palace/`
- collie-harness 源：`~/git/collie-harness/`
- collie 安装位置：`~/.claude/plugins/cache/collie-marketplace/collie-harness/0.3.0/`

## 合并内容

### 1. 脚本 → `hooks/memory/`

从 `~/git/memory-palace/scripts/` 复制 7 个脚本到 `hooks/memory/`：

| 脚本 | 用途 |
|------|------|
| resolve-project.js | cwd → 项目目录名 |
| capture-message.js | UserPromptSubmit：append session log + 计数 |
| load-index.js | SessionStart：清理 + 加载 INDEX |
| bump-access.js | PostToolUse(Read)：访问计数 |
| write-memory.js | agent 调用：写入记忆文件 |
| search-memory.js | agent 调用：搜索已有记忆去重 |
| consolidate.js | Stop：升格 + 合并 |

从 `~/git/memory-palace/hooks/` 复制 2 个 shell 脚本：

| 脚本 | 用途 |
|------|------|
| pre-compact.sh | PreCompact：输出 invoke 提示 |
| session-stop.sh | Stop：输出 invoke 提示 + 调 consolidate |

**注意**：脚本中的相对 import 路径需要调整（`./resolve-project.js` → 可能需要改为 `./memory/resolve-project.js` 或保持不变取决于 cwd）。

### 2. SKILL.md → `skills/memory-palace/`

```
skills/memory-palace/
├── SKILL.md
└── references/
    └── meta-rules.md
```

SKILL.md 是决策树的 source of truth，hook 触发时 agent 通过 `invoke memory-palace skill` 加载它。

### 3. hooks.json 追加

在 collie 现有的 hooks.json 中追加 4 个新事件（Stop 已有，追加一个 hook）：

```jsonc
{
  "SessionStart": [{
    "matcher": "*",
    "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/memory/load-index.js\"" }]
  }],
  "UserPromptSubmit": [{
    "matcher": "*",
    "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/memory/capture-message.js\"" }]
  }],
  "PostToolUse": [
    // ... 现有的 Write|Edit|MultiEdit matcher 不动 ...
    {
      "matcher": "Read",
      "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/memory/bump-access.js\"" }]
    }
  ],
  "PreCompact": [{
    "matcher": "*",
    "hooks": [{ "type": "command", "command": "\"${CLAUDE_PLUGIN_ROOT}/hooks/memory/pre-compact.sh\"" }]
  }],
  "Stop": [
    // ... 现有的 stop-steps-counter.js 不动 ...
    {
      "matcher": "*",
      "hooks": [{ "type": "command", "command": "\"${CLAUDE_PLUGIN_ROOT}/hooks/memory/session-stop.sh\"" }]
    }
  ]
}
```

### 4. 测试 → `tests/memory/`

从 `~/git/memory-palace/test/` 复制：

| 文件 | 内容 |
|------|------|
| resolve-project.test.js | 路径转换 5 case |
| capture-message.test.js | 消息捕获 5 case |
| bump-access.test.js | 访问计数 5 case |
| integration.test.js | 完整生命周期 7 step |
| decision-tree-results.md | 决策树 9 case 验证结果 |

测试中的脚本路径需要调整为 `hooks/memory/` 前缀。

### 5. 清理

- 删除 `~/.claude/skills/memory-palace` symlink（skill 现在由 plugin 提供）
- `~/git/memory-palace/` 保留作为设计文档和研究笔记的归档（或归档后删除）
- 删除旧 `/Users/kevin/git/skills/skills/memory-palace/`

### 6. 版本

collie-harness 版本从 0.3.0 → 0.4.0（新增 memory-palace 功能模块）。

## 风险

- **脚本路径调整**：所有脚本内部的 `import './resolve-project.js'` 在 `hooks/memory/` 目录下保持有效（同目录），但 shell 脚本中的相对路径引用需要核查
- **hooks.json 合并冲突**：新增事件（SessionStart、UserPromptSubmit、PreCompact）不与现有 hook 冲突；PostToolUse 和 Stop 追加 matcher 需确认不影响现有行为
- **UserPromptSubmit 性能**：capture-message.js 阻塞每条消息，必须 < 10ms

## 执行顺序

1. collie-harness 中创建 worktree
2. 复制文件（cp，不用 Write）
3. 调整脚本路径
4. 合并 hooks.json
5. 跑测试
6. 清理旧 symlink
7. skillhub upsert 发布 collie-harness 0.4.0
