'use strict';
/**
 * POST /api/pull-tickets
 * Puxa tickets do pipeline de cotação.
 */

const { fetchCotacaoTickets, fetchOwners } = require('../lib/hubspot');
const { setCORSHeaders, requireAuth, getHubspotToken, methodCheck } = require('./_helpers');

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['POST'])) return;

  const user = requireAuth(req, res);
  if (!user) return;

  let token;
  try {
    token = getHubspotToken();
  } catch (e) {
    return res.status(503).json({ success: false, error: e.message });
  }

  try {
    const [result, ownerMap] = await Promise.all([
      fetchCotacaoTickets(token),
      fetchOwners(token)
    ]);
    const cotData = {
      tickets: result.tickets,
      owners: ownerMap,
      companyNames: result.companyNames,
      timestamp: new Date().toISOString()
    };
    return res.status(200).json({ success: true, data: cotData });
  } catch (e) {
    console.error('[pull-tickets] Error:', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
}
