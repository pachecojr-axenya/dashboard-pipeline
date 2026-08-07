'use strict';
/**
 * POST /api/deal-activities
 * Body: { hsId: "123456", extras?: true, fonte?: "bq" | "api" }
 * Retorna atividades (notes, emails, calls, meetings) de um deal.
 *
 * MIGRADO para a fonte única (F5, 07/08/2026): lê `silver.fact_engagement`.
 * Mesmo motivo do company-activities — o toque nativo cobre todos os donos.
 * Ver aquele arquivo para o contrato de `fonte` e `extras`.
 */

const { fetchDealActivities } = require('../lib/hubspot');
const whq = require('../lib/hubspot-wh-queries');
const wh = require('../lib/hubspot-warehouse');
const { setCORSHeaders, requireAuth, getHubspotToken, methodCheck } = require('./_helpers');

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['POST'])) return;

  const user = requireAuth(req, res);
  if (!user) return;

  const { hsId, extras, fonte } = req.body || {};
  if (!hsId || typeof hsId !== 'string' || !/^\d+$/.test(hsId)) {
    return res.status(400).json({ success: false, error: 'ID de deal inválido' });
  }

  if (fonte !== 'api' && wh.isConfigured()) {
    try {
      const activities = await whq.activities('deal', hsId, { extras: extras === true });
      return res.status(200).json({ success: true, activities, fonte: 'bq' });
    } catch (e) {
      console.error('[deal-activities] armazém falhou, caindo para a API:', e.message);
    }
  }

  let token;
  try {
    token = getHubspotToken();
  } catch (e) {
    return res.status(503).json({ success: false, error: e.message });
  }

  try {
    const activities = await fetchDealActivities(token, hsId);
    return res.status(200).json({ success: true, activities, fonte: 'api' });
  } catch (e) {
    console.error('[deal-activities] Error:', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
}
