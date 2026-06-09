'use strict';
/**
 * POST /api/pull-hubspot
 * Puxa todos os deals do pipeline principal do HubSpot.
 * Operação pesada (~30-60s) — timeout do Vercel: 60s (Pro) ou 10s (Hobby).
 */

const { pullHubSpotData } = require('../lib/hubspot');
const { setCORSHeaders, requireAuth, getHubspotToken, methodCheck } = require('./_helpers');

// Mutex simples em memória (por instância serverless)
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
    const data = await pullHubSpotData(token);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    console.error('[pull-hubspot] Error:', e.message);
    return res.status(500).json({ success: false, error: e.message });
  } finally {
    isPulling = false;
  }
}
