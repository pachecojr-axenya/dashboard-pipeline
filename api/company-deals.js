'use strict';
/**
 * POST /api/company-deals
 * Body: { hsId: "123456", fonte?: "bq" | "api" }
 * Retorna todos os deals associados a uma empresa.
 *
 * MIGRADO para a fonte única (F5, 07/08/2026): `silver.dim_deal` +
 * `silver.bridge_association`. A ponte é SIMÉTRICA — a versão da API só via a
 * direção companies→deals que ela pedia, e associação gravada na direção oposta
 * ficava invisível.
 *
 * TRÊS CAMPOS NÃO VÊM do armazém (`vigencia`, `data_de_renovacao`,
 * `notes_last_updated`): não estão no `curated` do deal. Vêm null e a resposta
 * declara isso em `campos_ausentes`. `vigencia` e `notes_last_updated` SÃO usados
 * em telas (28 e 12 referências no front) — quem depende deles deve pedir
 * `fonte=api` até as propriedades entrarem no escopo do armazém, ou o campo vai
 * aparecer vazio para todo mundo.
 */

const { fetchCompanyDeals } = require('../lib/hubspot');
const whq = require('../lib/hubspot-wh-queries');
const wh = require('../lib/hubspot-warehouse');
const { setCORSHeaders, requireAuth, getHubspotToken, methodCheck } = require('./_helpers');

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['POST'])) return;

  const user = requireAuth(req, res);
  if (!user) return;

  const { hsId, fonte } = req.body || {};
  if (!hsId || typeof hsId !== 'string' || !/^\d+$/.test(hsId)) {
    return res.status(400).json({ success: false, error: 'ID de empresa inválido' });
  }

  if (fonte !== 'api' && wh.isConfigured()) {
    try {
      const deals = await whq.companyDeals(hsId);
      return res.status(200).json({
        success: true, deals, fonte: 'bq',
        campos_ausentes: whq.COMPANY_DEALS_MISSING,
      });
    } catch (e) {
      console.error('[company-deals] armazém falhou, caindo para a API:', e.message);
    }
  }

  let token;
  try {
    token = getHubspotToken();
  } catch (e) {
    return res.status(503).json({ success: false, error: e.message });
  }

  try {
    const deals = await fetchCompanyDeals(token, hsId);
    return res.status(200).json({ success: true, deals, fonte: 'api' });
  } catch (e) {
    console.error('[company-deals] Error:', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
}
