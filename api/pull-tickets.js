'use strict';
/**
 * POST /api/pull-tickets
 * Body: { fonte?: "bq" | "api" }
 * Puxa tickets do pipeline de cotação.
 *
 * MIGRADO para a fonte única (F5, 07/08/2026): `silver.dim_ticket` +
 * `fact_stage_entry` + `bridge_association` + `dim_company` + `dim_owner`.
 *
 * A migração é COMPLETA para este endpoint porque ele sempre foi só do Pipeline
 * de Cotação (847948895) — o único dos 19 pipelines de ticket que está no
 * armazém. Os outros 18 (109.013 tickets) NÃO estão; tela que precise deles
 * continua na API.
 *
 * Ganho concreto: era uma busca paginada + N/100 batches de associação + N/100
 * batches de empresa por request. Agora são 2 consultas.
 */

const { fetchCotacaoTickets, fetchOwners } = require('../lib/hubspot');
const whq = require('../lib/hubspot-wh-queries');
const wh = require('../lib/hubspot-warehouse');
const { setCORSHeaders, requireAuth, getHubspotToken, methodCheck } = require('./_helpers');

// Donos: o front usa o mapa id -> nome. Vem do armazém junto, sem chamada extra.
async function ownersFromWarehouse() {
  const { rows } = await wh.query(`
    SELECT owner_id, full_name
    FROM ${wh.t('silver', 'dim_owner')}
    WHERE is_current
  `);
  const map = {};
  rows.forEach((r) => {
    const id = wh.str(r.owner_id);
    if (id) map[id] = wh.str(r.full_name) || id;
  });
  return map;
}

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['POST'])) return;

  const user = requireAuth(req, res);
  if (!user) return;

  const fonte = (req.body || {}).fonte;

  if (fonte !== 'api' && wh.isConfigured()) {
    try {
      const [result, ownerMap] = await Promise.all([
        whq.cotacaoTickets(),
        ownersFromWarehouse(),
      ]);
      return res.status(200).json({
        success: true,
        fonte: 'bq',
        data: {
          tickets: result.tickets,
          owners: ownerMap,
          companyNames: result.companyNames,
          companyAssoc: result.companyAssoc,
          timestamp: new Date().toISOString(),
          pipeline: wh.COTACAO_PIPELINE_ID,
        },
      });
    } catch (e) {
      console.error('[pull-tickets] armazém falhou, caindo para a API:', e.message);
    }
  }

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
    return res.status(200).json({ success: true, data: cotData, fonte: 'api' });
  } catch (e) {
    console.error('[pull-tickets] Error:', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
}
