#!/usr/bin/env bash
# kevin-proxy escalation dispatcher
# Supports user override via $KEVIN_ESCALATE_CMD environment variable.
#
# Usage: escalate.sh <LEVEL> <MESSAGE> [CONTEXT_JSON]
#   LEVEL:        INFO | WARN | CRITICAL
#   MESSAGE:      short description
#   CONTEXT_JSON: optional JSON context string
#
# To use a custom escalation channel:
#   export KEVIN_ESCALATE_CMD=~/bin/my-escalate.sh
#
set -euo pipefail

LEVEL="${1:-UNKNOWN}"
MSG="${2:-no-message}"
CONTEXT="${3:-}"

# Ensure log directory exists
LOG_DIR="${HOME}/.kevin-proxy"
mkdir -p "${LOG_DIR}"

# Structured log entry
TS=$(date -Iseconds)
LOG_ENTRY="${TS} [${LEVEL}] ${MSG}"
if [[ -n "${CONTEXT}" ]]; then
  LOG_ENTRY="${LOG_ENTRY} ${CONTEXT}"
fi
echo "${LOG_ENTRY}" >> "${LOG_DIR}/escalations.log"

# Delegate to user-configured escalation command if set and executable
if [[ -n "${KEVIN_ESCALATE_CMD:-}" && -x "${KEVIN_ESCALATE_CMD}" ]]; then
  "${KEVIN_ESCALATE_CMD}" "${LEVEL}" "${MSG}" "${CONTEXT}" || true
fi

# Desktop notification fallback (macOS terminal-notifier or osascript)
NOTIFY_TITLE="kevin-proxy [${LEVEL}]"
NOTIFY_BODY="${MSG}"

if command -v terminal-notifier >/dev/null 2>&1; then
  terminal-notifier -title "${NOTIFY_TITLE}" -message "${NOTIFY_BODY}" >/dev/null 2>&1 || true
elif command -v osascript >/dev/null 2>&1; then
  osascript -e "display notification \"${NOTIFY_BODY}\" with title \"${NOTIFY_TITLE}\"" >/dev/null 2>&1 || true
fi

# Always exit 0 — escalation must never block the hook chain
exit 0
