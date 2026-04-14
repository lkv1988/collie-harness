#!/usr/bin/env bash
# E2E smoke test for kevin-proxy hook chain.
# Invokes hooks directly with crafted payloads — no live Claude Code session needed.
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMPDIR_BASE=$(mktemp -d /tmp/kp-smoke-XXXXXX)
export HOME="${TMPDIR_BASE}"
export CLAUDE_PLUGIN_ROOT="${PLUGIN_ROOT}"

PASS=0
FAIL=0

run_scenario() {
  local name="$1"
  local result="$2"  # "pass" or "fail"
  if [[ "${result}" == "pass" ]]; then
    echo "✅ PASS: ${name}"
    PASS=$((PASS + 1))
  else
    echo "❌ FAIL: ${name}"
    FAIL=$((FAIL + 1))
  fi
}

cleanup() {
  rm -rf "${TMPDIR_BASE}"
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Scenario 1: Escalation channel works (happy path infrastructure)
# ---------------------------------------------------------------------------
scenario1() {
  "${PLUGIN_ROOT}/scripts/escalate.sh" TEST "smoke-test" '{"test":true}' >/dev/null 2>&1

  local log_file="${TMPDIR_BASE}/.kevin-proxy/escalations.log"
  if [[ -f "${log_file}" ]] && grep -q "smoke-test" "${log_file}"; then
    run_scenario "Escalation channel writes log entry" "pass"
  else
    run_scenario "Escalation channel writes log entry" "fail"
  fi
}

# ---------------------------------------------------------------------------
# Scenario 2: Plan reviewer hook fires on plan file write
# ---------------------------------------------------------------------------
scenario2() {
  local session_id="smoke-test-session"
  local payload
  payload=$(printf '{"tool_name":"Write","tool_input":{"file_path":"docs/plans/test-plan.md"},"session_id":"%s"}' "${session_id}")

  echo "${payload}" \
    | HOME="${TMPDIR_BASE}" CLAUDE_PLUGIN_ROOT="${PLUGIN_ROOT}" \
      node "${PLUGIN_ROOT}/hooks/post-writing-plans-reviewer.js" >/dev/null 2>&1

  local state_file="${TMPDIR_BASE}/.kevin-proxy/state/${session_id}/last-plan.json"
  if [[ -f "${state_file}" ]] && grep -q '"reviewed": false' "${state_file}"; then
    run_scenario "Plan reviewer hook creates last-plan.json with reviewed:false" "pass"
  else
    run_scenario "Plan reviewer hook creates last-plan.json with reviewed:false" "fail"
  fi
}

# ---------------------------------------------------------------------------
# Scenario 3: Quota guard blocks when rate-limited
# ---------------------------------------------------------------------------
scenario3() {
  local state_dir="${TMPDIR_BASE}/.kevin-proxy/state"
  mkdir -p "${state_dir}"
  cat > "${state_dir}/quota.json" <<'EOF'
{"rate_limit_cool_until": "2099-01-01T00:00:00.000Z", "exhausted": false, "daily_input_tokens": 0, "daily_output_tokens": 0}
EOF

  local output
  output=$(echo '{}' \
    | HOME="${TMPDIR_BASE}" CLAUDE_PLUGIN_ROOT="${PLUGIN_ROOT}" \
      node "${PLUGIN_ROOT}/hooks/pre-tool-quota-guard.js" 2>/dev/null)

  if echo "${output}" | grep -qE '"decision"\s*:\s*"block"'; then
    run_scenario "Quota guard blocks when rate-limited" "pass"
  else
    run_scenario "Quota guard blocks when rate-limited" "fail"
  fi
}

# ---------------------------------------------------------------------------
# Scenario 4: Loop trap detection — no_progress escalation fires
# ---------------------------------------------------------------------------
scenario4() {
  local session_id="smoke-loop-session"
  local state_dir="${TMPDIR_BASE}/.kevin-proxy/state/${session_id}"
  mkdir -p "${state_dir}"

  # Pre-seed counter with no_progress_steps=4; hook will increment to 5 → escalate
  cat > "${state_dir}/counter.json" <<'EOF'
{"last_tool_errors":[],"same_error_count":0,"no_progress_steps":4,"last_file_change_at":null,"total_steps":0}
EOF

  # Create an empty transcript (no Write/Edit success entries) so hook sees no file change
  local transcript
  transcript=$(mktemp "${TMPDIR_BASE}/transcript-XXXXXX.jsonl")
  # One error entry so last5 has entries (triggering the no-file-change branch)
  printf '{"type":"tool_result","is_error":true,"content":[{"type":"text","text":"Error: something failed"}]}\n' \
    > "${transcript}"

  local payload
  payload=$(printf '{"session_id":"%s","transcript_path":"%s"}' "${session_id}" "${transcript}")

  echo "${payload}" \
    | HOME="${TMPDIR_BASE}" CLAUDE_PLUGIN_ROOT="${PLUGIN_ROOT}" \
      node "${PLUGIN_ROOT}/hooks/stop-steps-counter.js" >/dev/null 2>&1

  local log_file="${TMPDIR_BASE}/.kevin-proxy/escalations.log"
  if [[ -f "${log_file}" ]] && grep -q "no_progress" "${log_file}"; then
    run_scenario "Loop trap detection escalates no_progress" "pass"
  else
    run_scenario "Loop trap detection escalates no_progress" "fail"
  fi
}

# ---------------------------------------------------------------------------
# Run all scenarios
# ---------------------------------------------------------------------------
echo "Running kevin-proxy E2E smoke tests..."
echo ""

scenario1
scenario2
scenario3
scenario4

echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"
[[ "${FAIL}" -eq 0 ]] && exit 0 || exit 1
