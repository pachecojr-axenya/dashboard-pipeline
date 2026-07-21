'use strict';

const { setCORSHeaders, requireAuth, methodCheck } = require('./_helpers');
const { BDR_TEAM } = require('../lib/bdr-team');

function enabledFromEnv(value) {
  if (value == null || value === '') return false;
  return ['1', 'true', 'on', 'yes'].includes(String(value).trim().toLowerCase());
}

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['GET'])) return;
  const user = requireAuth(req, res);
  if (!user) return;
  return res.status(200).json({ success: true, enabled: enabledFromEnv(process.env.BDR_FLAG_WORKLOAD_V2), team: BDR_TEAM, source: 'BDR_FLAG_WORKLOAD_V2', defaultEnabledWhenUnset: false });
};

module.exports._test = { enabledFromEnv };
