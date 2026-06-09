'use strict';
/**
 * POST /api/deal-activities
 * Body: { hsId: "123456" }
 * Retorna atividades (notes, emails, calls, meetings) de um deal.
 */

const { fetchDealActivities } = require('../lib/hubspot');
const { setCORSHeaders, requireAuth, getHubspotToken, methodCheck } = require('./_helpers');

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['POST'])) return;

  const user = requireAuth(req, res);
  if (!user) return;

  const { hsId } = req.body || {};
  if (!hsId || typeof hsId !== 'string' || !/^\d+$/.test(hsId)) {
    return res.status(400).json({ success: false, error: 'ID de deal inválido' });
  }

  let token;
  try {
    token = getHubspotToken();
  } catch (e) {
    return res.status(503).json({ success: false, error: e.message });
  }

  try {
    const activities = await fetchDealActivities(token, hsId);
    return res.status(200).json({ success: true, activities });
  } catch (e) {
    console.error('[deal-activities] Error:', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
}
