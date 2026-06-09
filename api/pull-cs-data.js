'use strict';
/**
 * POST /api/pull-cs-data
 * Puxa dados de Customer Success (empresas + vigência de deals).
 */

const { pullCSData } = require('../lib/hubspot');
const { setCORSHeaders, requireAuth, getHubspotToken, methodCheck } = require('./_helpers');

let isPulling = false;

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['POST'])) return;

  const user = requireAuth(req, res);
  if (!user) return;

  if (isPulling) {
    return res.status(429).json({ success: false, error: 'Pull em andamento. Aguarde.' });
  }

  let token;
  try {
    token = getHubspotToken();
  } catch (e) {
    return res.status(503).json({ success: false, error: e.message });
  }

  isPulling = true;
  try {
    const data = await pullCSData(token);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    console.error('[pull-cs-data] Error:', e.message);
    return res.status(500).json({ success: false, error: e.message });
  } finally {
    isPulling = false;
  }
}
