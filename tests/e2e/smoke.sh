#!/usr/bin/env bash
# E2E smoke test for collie hook chain.
# Invokes hooks directly with crafted payloads — no live Claude Code session needed.
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMPDIR_BASE=$(mktemp -d /tmp/co-smoke-XXXXXX)
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

  local log_file="${TMPDIR_BASE}/.collie/escalations.log"
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

  local state_file="${TMPDIR_BASE}/.collie/state/${session_id}/last-plan.json"
  if [[ -f "${state_file}" ]] && grep -q '"plan_doc_reviewer"' "${state_file}" && grep -q '"collie_reviewer"' "${state_file}"; then
    run_scenario "Plan reviewer hook creates last-plan.json with dual-reviewer schema" "pass"
  else
    run_scenario "Plan reviewer hook creates last-plan.json with dual-reviewer schema" "fail"
  fi
}

# ---------------------------------------------------------------------------
# Scenario 3: Loop trap detection — no_progress escalation fires
# ---------------------------------------------------------------------------
scenario3() {
  local session_id="smoke-loop-session"
  local state_dir="${TMPDIR_BASE}/.collie/state/${session_id}"
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

  local log_file="${TMPDIR_BASE}/.collie/escalations.log"
  if [[ -f "${log_file}" ]] && grep -q "no_progress" "${log_file}"; then
    run_scenario "Loop trap detection escalates no_progress" "pass"
  else
    run_scenario "Loop trap detection escalates no_progress" "fail"
  fi
}

# ---------------------------------------------------------------------------
# Scenario 4: Scenario 4 placeholder (reserved for future hook test)
# (intentionally absent — numbering jumps to 5 for loop-shim)
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Scenario 5: loop-shim — static artifact verification (no live claude)
# ---------------------------------------------------------------------------
scenario5() {
  local result="pass"

  # Check 1: commands/autoiter.md exists
  if [[ ! -f "${PLUGIN_ROOT}/commands/autoiter.md" ]]; then
    echo "  [e2e-05] MISS: commands/autoiter.md not found" >&2
    result="fail"
  fi

  # Check 2: commands/autoiter.md has valid frontmatter (--- delimiters + description: field)
  if ! grep -q '^---' "${PLUGIN_ROOT}/commands/autoiter.md" 2>/dev/null \
     || ! grep -q '^description:' "${PLUGIN_ROOT}/commands/autoiter.md" 2>/dev/null; then
    echo "  [e2e-05] MISS: commands/autoiter.md missing valid frontmatter" >&2
    result="fail"
  fi

  # Check 3: skills/autoiter/SKILL.md exists
  if [[ ! -f "${PLUGIN_ROOT}/skills/autoiter/SKILL.md" ]]; then
    echo "  [e2e-05] MISS: skills/autoiter/SKILL.md not found" >&2
    result="fail"
  fi

  # Check 4: skills/autoiter-prepare/SKILL.md exists and has valid frontmatter (--- + name: field)
  if [[ ! -f "${PLUGIN_ROOT}/skills/autoiter-prepare/SKILL.md" ]]; then
    echo "  [e2e-05] MISS: skills/autoiter-prepare/SKILL.md not found" >&2
    result="fail"
  elif ! grep -q '^---' "${PLUGIN_ROOT}/skills/autoiter-prepare/SKILL.md" 2>/dev/null \
       || ! grep -q '^name:' "${PLUGIN_ROOT}/skills/autoiter-prepare/SKILL.md" 2>/dev/null; then
    echo "  [e2e-05] MISS: skills/autoiter-prepare/SKILL.md missing valid frontmatter (name: field)" >&2
    result="fail"
  fi

  # Check 5: _state.loopDir returns a path containing the project-id fragment
  local loopdir_output
  loopdir_output=$(node -e "
    const s = require('${PLUGIN_ROOT}/hooks/_state.js');
    const pid = 'Users-kevin-git-collie';
    const result = s.loopDir(pid, 'smoke-test');
    if (!result.includes(pid)) process.exit(1);
    console.log('loopDir ok:', result);
  " 2>&1) || {
    echo "  [e2e-05] FAIL: _state.loopDir did not return expected path fragment. Output: ${loopdir_output}" >&2
    result="fail"
  }

  run_scenario "e2e-05-autoiter-shim" "${result}"
}

# ---------------------------------------------------------------------------
# Run all scenarios
# ---------------------------------------------------------------------------
echo "Running collie E2E smoke tests..."
echo ""

scenario1
scenario2
scenario3
scenario5

echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"
[[ "${FAIL}" -eq 0 ]] && exit 0 || exit 1
