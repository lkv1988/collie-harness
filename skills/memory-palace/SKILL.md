---
name: memory-palace
description: "Boids-inspired memory management for AI agents. Evaluates conversation content against a fixed decision tree to decide what to remember, where to store it, and when to consolidate. Activate on Stop hook and PreCompact hook for automatic memory capture. Also activate when the agent detects information during conversation that might change future behavior — user corrections, preferences, role info, project constraints, or external system references. Do NOT activate for knowledge questions, in-session operations, or debug conclusions."
---

# Memory Palace

7 local rules, emergent global memory. Inspired by Boids, grounded in cognitive science.

## Storage

### Directory structure

```
~/.memory-palace/                           ← agent-independent, all agents share
├── user/                                   ← user-level (cross-project)
│   ├── INDEX.md                            ← index of long/ only, ≤200 lines
│   ├── short/
│   └── long/
├── projects/
│   └── -Users-kevin-git-corp-lara/         ← project-level
│       ├── INDEX.md
│       ├── short/
│       └── long/
└── sessions/                               ← session logs (transient)
    └── 2026-05-07_14-32-00.jsonl
```

### Project naming convention

Absolute cwd path, every `/` replaced with `-`, including leading `-`:

```
/Users/kevin/git/notes/obsidian  →  -Users-kevin-git-notes-obsidian
/tmp/my project                  →  -tmp-my project
```

Spaces kept as-is (quote paths in scripts). Matches Claude Code's `~/.claude/projects/` convention.

### Scope rules

| type | scope | writes to |
|------|-------|-----------|
| feedback | user | `user/short/` |
| user | user | `user/short/` |
| project | project | `projects/<project>/short/` |
| reference | depends | project-specific → `projects/<project>/short/`, general → `user/short/` |

### Memory file format

```yaml
---
type: feedback | user | project | reference
summary: one line
created: YYYY-MM-DD
last_accessed: YYYY-MM-DD
access_count: 1
---
Content in your own words. Not a copy of user's message.
```

File naming: `YYYY-MM-DD_<keyword>.md`

INDEX.md only indexes `long/`. `short/` is invisible to the index.

## Hook Pipeline

Five hooks form a complete capture-and-consume pipeline. Capture is synchronous and fast; consumption is asynchronous and thorough.

### Overview

```
SessionStart         UserPromptSubmit      PostToolUse(Read)   PreCompact          Stop
(session begin)      (every message)       (after Read tool)   (before compress)   (session end)
     │                    │                      │                   │                  │
     ▼                    ▼                      ▼                   ▼                  ▼
cleanup stale        append message to     path in               read session log   read session log
short/ + long/       session log +         ~/.memory-palace/?    run decision tree  run decision tree
sync INDEX           count++               yes → bump            write memories     write memories
read INDEX files          │                last_accessed +        (keep log)         promote short→long
inject into context  count ≥ 20?           access_count                             merge long dups
                     ├─ no → done          no → skip                                delete log
                     └─ yes → inject
                              "evaluate
                               recent msgs"
                              reset counter
```

### Hook details

**1. SessionStart — load + cleanup**

Fires when the agent starts. The script (`load-index.js`) does:
1. Run `resolve-project.js` to compute the current project name from cwd
2. Scan `short/` (user + project): items untouched for 7 days → delete
3. Scan `long/` (user + project): items untouched for 60 days → mark `[review]`; `[review]` items untouched 30 more days → delete
4. Sync `INDEX.md` with `long/` directory (remove stale entries, add missing ones)
5. Read `~/.memory-palace/user/INDEX.md` and `~/.memory-palace/projects/<project>/INDEX.md`
6. Output both INDEX contents for injection into agent context

Agent starts every session knowing who the user is, what this project needs, and with stale memories already pruned.

**2. UserPromptSubmit — capture (blocking, < 10ms)**

Fires on every user message. The script (`capture-message.js`) does two things:
- Append user message to `~/.memory-palace/sessions/<session-id>.jsonl`
- Increment a counter

When counter reaches 20, output a one-line prompt that tells the agent to invoke the memory-palace skill and evaluate recent messages against the decision tree. Reset counter to 0.

No regex, no analysis, no LLM. Pure file append + counter check.

**3. PostToolUse (Read) — access reinforcement**

Fires after every `Read` tool call. The script (`bump-access.js`) does:
1. Check if the file path is under `~/.memory-palace/`
2. Yes → update `last_accessed = today` and `access_count++` in the file's frontmatter
3. No → no-op

This ensures memories that are actively referenced stay promoted and don't get pruned.

**4. PreCompact — mid-session consume (no delete)**

Fires before context compression. Output the session log path and `invoke memory-palace skill`. The agent:
- Loads this SKILL.md
- Reads the session log
- Runs the decision tree
- Writes any new memories

The session log is **not** deleted (session is still ongoing). Acts as insurance for long sessions where context compression would otherwise lose information.

**5. Stop — consume + consolidate + cleanup**

Fires when the session ends. Output the session log path and `invoke memory-palace skill`. The agent:
- Loads this SKILL.md
- Reads the session log
- Runs the decision tree → writes new memories to `short/`
- **Promote**: `short/` items with `access_count ≥ 3` across 2+ sessions → move to `long/`, add to `INDEX.md`
- **Merge**: `long/` items with overlapping content → combine into one
- Deletes the session log

This is the primary consumption and consolidation point. Even if the mid-conversation trigger (count ≥ 20) was missed or skipped, Stop catches everything.

### Why this works

The session log solves the compaction information loss problem. Even after multiple context compressions, the raw user messages are preserved in the log file. The agent evaluates against the complete record, not just what's left in context.

## Decision Tree

Run this on every candidate piece of information. No shortcuts.

```
STEP 0 — Hard veto (any hit → discard, stop)
  □ User is asking a knowledge question
  □ User is requesting an in-session operation
  □ Info is visible in code / git log / docs
  □ Info is a specific debug conclusion (expires when fixed)

STEP 1 — Future behavior test
  "If next session doesn't know this, what happens?"
  · Would repeat the same mistake → STORE
  · Would mistreat the user → STORE
  · Would waste time re-researching → STORE
  · Nothing different → discard, stop

STEP 2 — Dedup
  Search the target scope (user/ or projects/<project>/) for similar memory
  · Found → update existing (edit, don't create new), stop
  · Not found → continue

STEP 3 — Classify (pick one, determines write scope)
  a. User corrected agent behavior → feedback → user/
  b. User role / preference / workflow → user → user/
  c. Non-obvious project constraint → project → projects/<project>/
  d. External system location / purpose → reference → scope by content
  e. None of the above → discard, stop

STEP 4 — Write to short/
  Create file in the target scope's short/ directory.
```

## Consolidation

Consolidation is fully integrated into hooks — no cron, no manual steps required.

**SessionStart hook (cleanup):**
1. Prune `short/`: items untouched 7 days → delete
2. Prune `long/`: items untouched 60 days → mark `[review]`; `[review]` untouched 30 more days → delete
3. Sync `INDEX.md` ↔ `long/` directory consistency

**Stop hook (promote + merge):**
1. **Promote**: `short/` item with `access_count ≥ 3` across 2+ sessions → move to `long/`, add to `INDEX.md`
2. **Merge**: `long/` items with overlapping content → combine into one

The PostToolUse(Read) hook keeps `access_count` accurate so promotion thresholds are meaningful.

## Read & Update

### Read triggers

| When | What |
|------|------|
| Session start | Both INDEX files loaded via SessionStart hook |
| Mid-conversation | Read specific `long/` file when topic is relevant |
| Before writing | Search `short/` + `long/` in target scope for dedup (Step 2) |

On every read → `last_accessed` and `access_count` updated automatically by PostToolUse(Read) hook.

### Update (on access)

When referencing an existing memory and new context exists:
- Contradicts old content → rewrite
- Supplements old content → extend
- No new context → just bump timestamps (hook handles this automatically)

Always Edit existing file. Never create a duplicate.

## Multi-Agent Adaptation

This skill is agent-agnostic. The decision tree and lifecycle rules apply to any agent. Platform-specific differences are isolated to hooks and scripts.

### Hook configs per agent

| Agent | Hook config | Install location |
|-------|-------------|-----------------|
| Claude Code | `hooks/hooks.json` | `~/.claude/settings.json` |
| Cursor | `hooks/hooks-cursor.json` | Cursor config |
| Codeflicker | `hooks/hooks-codeflicker.json` | Codeflicker config |

### Scripts (deterministic logic only — no LLM judgment)

| Script | Purpose |
|--------|---------|
| `hooks/memory/resolve-project.js` | cwd → project directory name |
| `hooks/memory/capture-message.js` | Append to session log + counter (UserPromptSubmit) |
| `hooks/memory/load-index.js` | Cleanup stale memories + read INDEX files + output for injection (SessionStart) |
| `hooks/memory/bump-access.js` | Update `last_accessed` + `access_count` on Read tool use (PostToolUse) |
| `hooks/memory/write-memory.js` | Create memory file with frontmatter in correct scope |
| `hooks/memory/search-memory.js` | Grep `short/` + `long/` for dedup candidates |
| `hooks/memory/consolidate.js` | Promote short→long, merge long duplicates, prune stale, sync index |

### Tool name mapping

Skills reference tools by intent. Platform adapters map to actual tool names:

| Intent | Claude Code | Cursor | Codex |
|--------|-------------|--------|-------|
| Read file | `Read` | `read_file` | `read_file` |
| Write file | `Write` | `write_file` | `write_file` |
| Edit file | `Edit` | `edit_file` | `replace` |
| Search files | `Grep` / `Bash` | `grep_search` | `grep_search` |
