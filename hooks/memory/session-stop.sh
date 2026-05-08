#!/usr/bin/env bash
# session-stop.sh — Stop hook wrapper for memory-palace
#
# Outputs a JSON payload that injects context into the agent at the end
# of each response turn (Stop event).
#
# The agent is instructed to:
#   1. invoke the memory-palace skill
#   2. read the session log
#   3. run the decision tree and write memories
#   4. run consolidation (promote short→long, merge duplicates)
#   5. delete the session log
#
# Additionally, this script runs consolidate.js asynchronously after the
# agent has had a chance to process memories.
#
# Output format (Claude Code):
#   { "stopReason": "...", "systemMessage": "..." }

set -euo pipefail

SESSIONS_DIR="${HOME}/.memory-palace/sessions"

# Resolve plugin root: prefer CLAUDE_PLUGIN_ROOT env, fall back to script directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-${SCRIPT_DIR}/../..}"

CONSOLIDATE_SCRIPT="${PLUGIN_ROOT}/hooks/memory/consolidate.js"

# Find the most recent session log
SESSION_LOG=""
if [ -d "$SESSIONS_DIR" ]; then
  SESSION_LOG=$(ls -t "$SESSIONS_DIR"/*.jsonl 2>/dev/null | head -1 || true)
fi

if [ -n "$SESSION_LOG" ]; then
  LOG_LINE="${SESSION_LOG}"
else
  LOG_LINE="~/.memory-palace/sessions/<current-session>.jsonl"
fi

INVOKE_PROMPT="MEMORY-PALACE SESSION STOP: The session is ending. Invoke the memory-palace skill now. Read the session log at: ${LOG_LINE}. Run the full decision tree on all messages. Write any memories that pass the filter. Then run the consolidation step: promote short-term memories with access_count >= 3 to long-term, and merge overlapping long-term memories. Finally, delete the session log file at: ${LOG_LINE}."

# Escape for JSON embedding
escape_for_json() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  printf '%s' "$s"
}

ESCAPED=$(escape_for_json "$INVOKE_PROMPT")

# Output via top-level stopReason + systemMessage (Stop event doesn't support hookSpecificOutput)
printf '{"stopReason":"memory-palace session stop","systemMessage":"%s"}\n' "$ESCAPED"

# Also run consolidate.js in the background so structural maintenance happens
# even if the agent skips it. This is a best-effort safety net.
if [ -f "$CONSOLIDATE_SCRIPT" ]; then
  node "$CONSOLIDATE_SCRIPT" >/dev/null 2>&1 &
fi
