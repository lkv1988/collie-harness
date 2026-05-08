#!/usr/bin/env bash
# session-stop.sh — Stop hook for memory-palace
#
# Stop hooks cannot inject prompts into Claude (no hookSpecificOutput support).
# This script only runs consolidate.js synchronously as the primary consolidation
# mechanism: promote short→long, merge long duplicates.
#
# Memory capture (decision tree) relies on:
#   - UserPromptSubmit hook (every 20 messages)
#   - PreCompact hook (before context compression)
# NOT on Stop — Stop only does structural maintenance.

set -euo pipefail

# Resolve plugin root: prefer CLAUDE_PLUGIN_ROOT env, fall back to script directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-${SCRIPT_DIR}/../..}"

CONSOLIDATE_SCRIPT="${PLUGIN_ROOT}/hooks/memory/consolidate.js"

if [ -f "$CONSOLIDATE_SCRIPT" ]; then
  node "$CONSOLIDATE_SCRIPT" 2>/dev/null || true
fi
