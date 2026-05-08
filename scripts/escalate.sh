#!/usr/bin/env bash
# collie escalation dispatcher
# Supports user override via $COLLIE_ESCALATE_CMD environment variable.
#
# Usage: escalate.sh <LEVEL> <MESSAGE> [CONTEXT_JSON]
#   LEVEL:        INFO | WARN | CRITICAL
#   MESSAGE:      short description
#   CONTEXT_JSON: optional JSON context string
#
# To use a custom escalation channel:
#   export COLLIE_ESCALATE_CMD=~/bin/my-escalate.sh
#
set -euo pipefail

LEVEL="${1:-UNKNOWN}"
MSG="${2:-no-message}"
CONTEXT="${3:-}"

# Ensure log directory exists
LOG_DIR="${COLLIE_HOME:-${HOME}/.collie}"
mkdir -p "${LOG_DIR}"

# Structured log entry
TS=$(date -Iseconds)
LOG_ENTRY="${TS} [${LEVEL}] ${MSG}"
if [[ -n "${CONTEXT}" ]]; then
  LOG_ENTRY="${LOG_ENTRY} ${CONTEXT}"
fi
echo "${LOG_ENTRY}" >> "${LOG_DIR}/escalations.log"

# Delegate to user-configured escalation command if set and executable
if [[ -n "${COLLIE_ESCALATE_CMD:-}" && -x "${COLLIE_ESCALATE_CMD}" ]]; then
  "${COLLIE_ESCALATE_CMD}" "${LEVEL}" "${MSG}" "${CONTEXT}" || true
fi

# Always exit 0 — escalation must never block the hook chain
exit 0
