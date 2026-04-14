'use strict';

// DO NOT retry on rate limit. SDK silent retry is what burns the quota.
// This guard exists specifically to stop all tool calls cold when rate-limited.

const fs = require('fs');
const { quotaFile, budgetFile, escalationsLog } = require('./_state');

const STATE_FILE = quotaFile();
const BUDGET_FILE = budgetFile();

function block(reason) {
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: `⚠️ [kevin-harness] quota guard: ${reason}. Check ${STATE_FILE} and ${escalationsLog()}`,
  }) + '\n');
  process.exit(0);
}

function main() {
  // Parse stdin (payload not needed by guard — only quota.json and budget.json matter)
  try {
    fs.readFileSync(0, 'utf8'); // consume stdin
  } catch (e) {
    // stdin unavailable in some contexts; proceed with checks
  }

  // Read quota.json — if not found, no protection yet, allow
  let quota = null;
  try {
    quota = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (e) {
    process.stderr.write('[kevin-harness/pre-tool-quota-guard] WARNING: quota.json not found, no quota protection active\n');
    process.exit(0);
  }

  const now = Date.now();

  // Reset daily counters if daily_reset_at has passed
  if (quota.daily_reset_at) {
    const resetAt = new Date(quota.daily_reset_at).getTime();
    if (now >= resetAt) {
      quota.daily_input_tokens = 0;
      quota.daily_output_tokens = 0;
      quota.daily_cache_read_tokens = 0;
      quota.exhausted = false;
      // Next reset is tomorrow at same time
      const nextReset = new Date(resetAt);
      nextReset.setDate(nextReset.getDate() + 1);
      quota.daily_reset_at = nextReset.toISOString();
      // Write updated quota back
      try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(quota, null, 2), 'utf8');
      } catch (_) {
        // best effort
      }
    }
  }

  // Check rate_limit_cool_until
  if (quota.rate_limit_cool_until) {
    const coolUntil = new Date(quota.rate_limit_cool_until).getTime();
    if (now < coolUntil) {
      const minutesLeft = Math.ceil((coolUntil - now) / 60000);
      block(`rate limit cooling down, approximately ${minutesLeft} minute(s) remaining (cool_until: ${quota.rate_limit_cool_until})`);
    }
  }

  // Check exhausted flag
  if (quota.exhausted === true) {
    block('daily token quota exhausted (exhausted=true)');
  }

  // Read budget.json — if not found, allow but hint
  let budget = null;
  try {
    budget = JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf8'));
  } catch (e) {
    process.stdout.write(JSON.stringify({
      additionalContext: '[kevin-harness] WARNING: budget.json not found, cannot perform budget check. Please create ~/.kevin-harness/config/budget.json, reference schema: {"daily_token_cap": 1000000, "weekly_token_cap": 5000000, "confirm_before_autoloop": true}',
    }) + '\n');
    process.exit(0);
  }

  const dailyCap = budget.daily_token_cap;
  if (typeof dailyCap === 'number' && dailyCap > 0) {
    const dailyInputUsed = quota.daily_input_tokens || 0;
    // Block at 70% to keep 30% buffer for interactive use
    if (dailyInputUsed > dailyCap * 0.7) {
      const pct = ((dailyInputUsed / dailyCap) * 100).toFixed(1);
      block(`daily input token usage has reached ${pct}% (${dailyInputUsed}/${dailyCap}), reserving 30% buffer for interactive use`);
    }
  }

  // All checks passed — allow
  process.exit(0);
}

main();
