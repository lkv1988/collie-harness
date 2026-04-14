'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { STATE_HOME, quotaFile, budgetFile } = require('./_state');

const STATE_DIR = path.join(STATE_HOME, 'state');
const STATE_FILE = quotaFile();
const BUDGET_FILE = budgetFile();

const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
if (!pluginRoot) {
  process.stderr.write('[collie-harness/post-tool-quota-tracker] WARN: CLAUDE_PLUGIN_ROOT not set, skipping\n');
  process.exit(0);
}

const DEFAULT_QUOTA = {
  daily_input_tokens: 0,
  daily_output_tokens: 0,
  daily_cache_read_tokens: 0,
  weekly_input_tokens: 0,
  weekly_output_tokens: 0,
  daily_reset_at: null,
  weekly_reset_at: null,
  exhausted: false,
  rate_limited_at: null,
  rate_limit_cool_until: null,
  last_updated: null,
};

function readQuota() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (_) {
    // File doesn't exist — return defaults
    return Object.assign({}, DEFAULT_QUOTA);
  }
}

function writeQuota(quota) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(quota, null, 2), 'utf8');
}

function readBudget() {
  try {
    return JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf8'));
  } catch (_) {
    return null;
  }
}

function isRateLimitError(text) {
  if (typeof text !== 'string') return false;
  return /rate.?limit|429|usage.?limit|overloaded|quota/i.test(text);
}

function escalate(level, event, context) {
  try {
    const escalateSh = path.join(pluginRoot, 'scripts', 'escalate.sh');
    execFileSync(escalateSh, [level, event, JSON.stringify(context)], { stdio: ['ignore', 'ignore', 'inherit'] });
  } catch (_) {
    // best effort — escalate.sh failure must not crash the hook
  }
}

function resetIfNeeded(quota, now) {
  // Reset daily counters
  if (quota.daily_reset_at) {
    const resetAt = new Date(quota.daily_reset_at).getTime();
    if (now >= resetAt) {
      quota.daily_input_tokens = 0;
      quota.daily_output_tokens = 0;
      quota.daily_cache_read_tokens = 0;
      quota.exhausted = false;
      const nextReset = new Date(resetAt);
      nextReset.setDate(nextReset.getDate() + 1);
      quota.daily_reset_at = nextReset.toISOString();
    }
  } else {
    // Initialize daily reset to next midnight UTC+8 (approximated as tomorrow midnight UTC)
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    quota.daily_reset_at = tomorrow.toISOString();
  }

  // Reset weekly counters
  if (quota.weekly_reset_at) {
    const weekResetAt = new Date(quota.weekly_reset_at).getTime();
    if (now >= weekResetAt) {
      quota.weekly_input_tokens = 0;
      quota.weekly_output_tokens = 0;
      const nextWeekReset = new Date(weekResetAt);
      nextWeekReset.setDate(nextWeekReset.getDate() + 7);
      quota.weekly_reset_at = nextWeekReset.toISOString();
    }
  } else {
    // Initialize weekly reset to next Monday midnight
    const nextMonday = new Date(now);
    const day = nextMonday.getUTCDay(); // 0=Sun, 1=Mon...
    const daysUntilMonday = day === 0 ? 1 : (8 - day);
    nextMonday.setUTCDate(nextMonday.getUTCDate() + daysUntilMonday);
    nextMonday.setUTCHours(0, 0, 0, 0);
    quota.weekly_reset_at = nextMonday.toISOString();
  }

  return quota;
}

function main() {
  // Parse stdin
  let payload = {};
  try {
    const raw = fs.readFileSync(0, 'utf8');
    payload = JSON.parse(raw);
  } catch (e) {
    process.stderr.write('[collie-harness/post-tool-quota-tracker] Failed to parse stdin: ' + e.message + '\n');
    process.exit(0);
  }

  const now = Date.now();
  let quota = readQuota();
  quota = resetIfNeeded(quota, now);

  // Check for rate-limit errors
  const toolError = payload.tool_error || '';
  const toolResponse = payload.tool_response || '';
  const toolResponseStr = typeof toolResponse === 'string' ? toolResponse : JSON.stringify(toolResponse);

  const rateLimitDetected = isRateLimitError(toolError) || isRateLimitError(toolResponseStr);

  if (rateLimitDetected) {
    quota.rate_limited_at = new Date(now).toISOString();
    quota.rate_limit_cool_until = new Date(now + 3600000).toISOString(); // 1 hour
    quota.last_updated = new Date(now).toISOString();
    try {
      writeQuota(quota);
    } catch (e) {
      process.stderr.write('[collie-harness/post-tool-quota-tracker] Failed to write quota.json: ' + e.message + '\n');
    }
    escalate('CRITICAL', 'rate_limit_detected', {
      tool: payload.tool_name,
      session_id: payload.session_id,
    });
    process.stderr.write('[collie-harness] CRITICAL: rate limit detected, tool calls blocked for 1 hour\n');
    process.exit(0);
  }

  // Accumulate token usage
  const usage = payload.usage;
  if (usage && typeof usage === 'object') {
    const inputTokens = usage.input_tokens || 0;
    const outputTokens = usage.output_tokens || 0;
    const cacheReadTokens = usage.cache_read_input_tokens || 0;

    quota.daily_input_tokens = (quota.daily_input_tokens || 0) + inputTokens;
    quota.daily_output_tokens = (quota.daily_output_tokens || 0) + outputTokens;
    quota.daily_cache_read_tokens = (quota.daily_cache_read_tokens || 0) + cacheReadTokens;
    quota.weekly_input_tokens = (quota.weekly_input_tokens || 0) + inputTokens;
    quota.weekly_output_tokens = (quota.weekly_output_tokens || 0) + outputTokens;
  }

  quota.last_updated = new Date(now).toISOString();

  // Check daily cap exhaustion
  const budget = readBudget();
  if (budget && typeof budget.daily_token_cap === 'number' && budget.daily_token_cap > 0) {
    if (quota.daily_input_tokens > budget.daily_token_cap) {
      quota.exhausted = true;
      escalate('WARN', 'daily_budget_exhausted', {
        daily_input_tokens: quota.daily_input_tokens,
        daily_token_cap: budget.daily_token_cap,
        session_id: payload.session_id,
      });
      process.stderr.write('[collie-harness] WARN: daily token budget exhausted, quota.exhausted set to true\n');
    }
  }

  // Write updated quota
  try {
    writeQuota(quota);
  } catch (e) {
    process.stderr.write('[collie-harness/post-tool-quota-tracker] Failed to write quota.json: ' + e.message + '\n');
  }

  // Always exit 0 — this hook tracks, never blocks
  process.exit(0);
}

try {
  main();
} catch (e) {
  // Never crash — swallow all uncaught errors
  process.stderr.write('[collie-harness/post-tool-quota-tracker] Uncaught error: ' + e.message + '\n');
  process.exit(0);
}
