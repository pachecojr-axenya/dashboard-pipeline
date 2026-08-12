'use strict';
/**
 * GET /api/deal-billing-tickets?dealId=<hs_id>
 *
 * Painel Ganho | modal de deal: lista os tickets de faturamento (HubSpot) do deal,
 * via a apólice associada (integração apólice↔HubSpot, 2026-08-12). Deal → Apólice
 * (assoc typeId 375, criada na Fase 1) → tickets do pipeline de Faturamento
 * (assoc reversa da 379). Deal sem apólice associada ainda → lista vazia, não é erro
 * (implantação recente, ou um dos ~18 deals do backlog de matching manual).
 *
 * Resposta: { success, apolices: [{id, operator_contract_number, operadora}],
 *             tickets: [{id, subject, createdate, mes, valorDaFatura,
 *                        statusFaturamento, apoliceId, operadora, hubspotUrl}] }
 */
const { setCORSHeaders, requireAuth, methodCheck, getHubspotToken } = require('./_helpers');
const { hubspotGet, hubspotPost } = require('../lib/hubspot');

const APOLICE_OBJECT = '2-28940735';
const PORTAL_ID = '44715285';

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['GET'])) return;

  const user = requireAuth(req, res);
  if (!user) return;

  const dealId = (req.query && req.query.dealId) ? String(req.query.dealId) : '';
  if (!dealId) {
    return res.status(400).json({ success: false, error: 'dealId é obrigatório' });
  }

  try {
    const token = getHubspotToken();

    const apAssoc = await hubspotGet(token, `/crm/v4/objects/deals/${dealId}/associations/${APOLICE_OBJECT}`);
    const apoliceIds = [...new Set((apAssoc.results || []).map(r => String(r.toObjectId || r.id)).filter(Boolean))];
    if (!apoliceIds.length) {
      return res.status(200).json({ success: true, apolices: [], tickets: [] });
    }

    const apoliceBatch = await hubspotPost(token, `/crm/v3/objects/${APOLICE_OBJECT}/batch/read`, {
      properties: ['operator_contract_number', 'operadora', 'ativo_ou_inativo'],
      inputs: apoliceIds.map(id => ({ id }))
    });
    const apolices = (apoliceBatch.results || []).map(r => ({ id: r.id, ...r.properties }));
    const apoliceById = {};
    apolices.forEach(a => { apoliceById[a.id] = a; });

    const ticketIdsByApolice = {};
    await Promise.all(apoliceIds.map(async (apId) => {
      const tAssoc = await hubspotGet(token, `/crm/v4/objects/${APOLICE_OBJECT}/${apId}/associations/tickets`);
      ticketIdsByApolice[apId] = (tAssoc.results || []).map(r => String(r.toObjectId || r.id)).filter(Boolean);
    }));

    const apoliceOfTicket = {};
    Object.entries(ticketIdsByApolice).forEach(([apId, ids]) => ids.forEach(id => { apoliceOfTicket[id] = apId; }));
    const allTicketIds = [...new Set(Object.values(ticketIdsByApolice).flat())];

    let tickets = [];
    if (allTicketIds.length) {
      const ticketBatch = await hubspotPost(token, '/crm/v3/objects/tickets/batch/read', {
        properties: ['subject', 'createdate', 'valor_da_fatura', 'hs_pipeline_stage', 'status_do_faturamento'],
        inputs: allTicketIds.map(id => ({ id }))
      });
      tickets = (ticketBatch.results || []).map(r => {
        const p = r.properties || {};
        const apId = apoliceOfTicket[r.id];
        const ap = apoliceById[apId];
        return {
          id: r.id,
          subject: p.subject || null,
          createdate: p.createdate ? p.createdate.substring(0, 10) : null,
          mes: p.createdate ? p.createdate.substring(0, 7) : null,
          valorDaFatura: p.valor_da_fatura != null && p.valor_da_fatura !== '' ? Number(p.valor_da_fatura) : null,
          statusFaturamento: p.status_do_faturamento || null,
          apoliceId: apId || null,
          operadora: ap ? ap.operadora : null,
          hubspotUrl: `https://app.hubspot.com/contacts/${PORTAL_ID}/ticket/${r.id}`,
        };
      });
      tickets.sort((a, b) => (b.createdate || '').localeCompare(a.createdate || ''));
    }

    return res.status(200).json({ success: true, apolices, tickets });
  } catch (e) {
    console.error('[deal-billing-tickets] error:', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
};
