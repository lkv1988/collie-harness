'use strict';

const os = require('os');
const path = require('path');

const STATE_HOME = process.env.COLLIE_HARNESS_HOME
  || path.join(os.homedir(), '.collie-harness');

module.exports = {
  STATE_HOME,
  stateDir: (sessionId) => path.join(STATE_HOME, 'state', sessionId),
  quotaFile: () => path.join(STATE_HOME, 'state', 'quota.json'),
  budgetFile: () => path.join(STATE_HOME, 'config', 'budget.json'),
  escalationsLog: () => path.join(STATE_HOME, 'escalations.log'),
  queueDir: () => path.join(STATE_HOME, 'queue'),
};
