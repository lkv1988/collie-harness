#!/usr/bin/env bash
# pre-compact.sh — PreCompact hook wrapper for memory-palace
#
# Outputs a JSON payload that injects context into the agent before
# Claude Code compacts the conversation context window.
#
# The agent is instructed to:
#   1. invoke the memory-palace skill
#   2. read the current session log
#   3. run the decision tree and write any memories worth keeping
#
# The session log is NOT deleted here — the session continues after compact.
#
# Output format (Claude Code):
#   { "systemMessage": "..." }

set -euo pipefail

SESSIONS_DIR="${HOME}/.memory-palace/sessions"

# Find the most recent session log (newest .jsonl, excluding hidden files)
SESSION_LOG=""
if [ -d "$SESSIONS_DIR" ]; then
  SESSION_LOG=$(find "$SESSIONS_DIR" -maxdepth 1 -name "*.jsonl" ! -name ".*" \
    -newer "$SESSIONS_DIR" 2>/dev/null | sort | tail -1 || true)
  if [ -z "$SESSION_LOG" ]; then
    # Fallback: just pick the newest file
    SESSION_LOG=$(ls -t "$SESSIONS_DIR"/*.jsonl 2>/dev/null | head -1 || true)
  fi
fi

if [ -n "$SESSION_LOG" ]; then
  LOG_LINE="Session log: ${SESSION_LOG}"
else
  LOG_LINE="Session log: not yet created for this session"
fi

INVOKE_PROMPT="MEMORY-PALACE PRE-COMPACT: Before the context window is compacted, invoke the memory-palace skill now. Read the session log at: ${SESSION_LOG:-~/.memory-palace/sessions/<current-session>.jsonl}. Run the decision tree on all messages. Write any memories that pass the filter. Do NOT delete the session log — the session will continue after compaction."

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

printf '{"systemMessage":"%s"}\n' "$ESCAPED"
