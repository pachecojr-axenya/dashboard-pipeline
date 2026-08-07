'use strict';
/**
 * POST /api/company-activities
 * Body: { hsId: "123456", extras?: true, fonte?: "bq" | "api" }
 * Retorna atividades de uma empresa.
 *
 * MIGRADO para a fonte única (F5, 07/08/2026): lê `silver.fact_engagement`.
 * Ganho concreto: o toque nativo cobre TODOS os donos — a ponte anterior sobre o
 * medallion cobria 24% (15 de 62 donos), e uma empresa atendida por alguém fora
 * do roster aparecia sem atividade nenhuma, sem erro.
 *
 * `fonte=api` mantém a rota antiga viva para comparar as duas — é o que permite
 * migrar "um por vez, comparando", e não uma troca cega.
 * `extras=true` inclui WhatsApp/LinkedIn e tarefas, que a versão da API nunca
 * pediu. Fora do default porque muda o que o modal mostra.
 */

const { fetchCompanyActivities } = require('../lib/hubspot');
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
    return res.status(400).json({ success: false, error: 'ID de empresa inválido' });
  }

  const querBQ = fonte !== 'api' && wh.isConfigured();
  if (querBQ) {
    try {
      const activities = await whq.activities('company', hsId, { extras: extras === true });
      return res.status(200).json({ success: true, activities, fonte: 'bq' });
    } catch (e) {
      // Cai para a API ao vivo: nesse sentido o fallback deixa o dado MAIS fresco,
      // não mais velho. `fonte` na resposta diz quem respondeu — degradar em
      // silêncio é o que faz ninguém descobrir que o armazém está fora.
      console.error('[company-activities] armazém falhou, caindo para a API:', e.message);
    }
  }

  let token;
  try {
    token = getHubspotToken();
  } catch (e) {
    return res.status(503).json({ success: false, error: e.message });
  }

  try {
    const activities = await fetchCompanyActivities(token, hsId);
    return res.status(200).json({ success: true, activities, fonte: 'api' });
  } catch (e) {
    console.error('[company-activities] Error:', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
}
