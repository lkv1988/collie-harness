'use strict';

const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const STATE_HOME = process.env.COLLIE_HARNESS_HOME
  || path.join(os.homedir(), '.collie-harness');

function projectId(cwd) {
  const dir = cwd || process.cwd();
  const root = execSync('git rev-parse --show-toplevel', { cwd: dir }).toString().trim();
  if (root === '/') return 'root';
  const slug = root.replace(/\//g, '-').replace(/^-/, '');
  return slug;
}

function loopDir(projId, runId) {
  return path.join(STATE_HOME, 'loop', projId, runId, '');
}

function currentRunFile(projId) {
  return path.join(STATE_HOME, 'loop', projId, 'current-run');
}

function iterDir(projId, runId, n) {
  return path.join(loopDir(projId, runId), `iter-${n}`, '');
}

module.exports = {
  STATE_HOME,
  stateDir: (sessionId) => path.join(STATE_HOME, 'state', sessionId),
  quotaFile: () => path.join(STATE_HOME, 'state', 'quota.json'),
  budgetFile: () => path.join(STATE_HOME, 'config', 'budget.json'),
  escalationsLog: () => path.join(STATE_HOME, 'escalations.log'),
  queueDir: () => path.join(STATE_HOME, 'queue'),
  projectId,
  loopDir,
  currentRunFile,
  iterDir,
};
