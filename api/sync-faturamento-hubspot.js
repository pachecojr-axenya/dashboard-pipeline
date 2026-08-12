'use strict';
/**
 * GET|POST /api/sync-faturamento-hubspot
 *
 * Fase 3 da integração apólice↔HubSpot (2026-08-12): mantém o store de faturamento
 * manual (`forecast:faturamento_manual`, o mesmo de /api/faturamento-manual) em dia
 * com os valores REAIS do HubSpot, sem precisar de ninguém rodando a sincronização
 * na mão. Substitui a rodada manual feita por curl na entrega inicial da Fase 1/2.
 *
 * Para cada deal em Ganho/Implantação (Vendas + Bid):
 *   1. Busca apólice(s) associada(s) — assoc deals→2-28940735 (Fase 1, typeId 375).
 *      Sem apólice associada → pula; deal continua no fluxo manual/régua de sempre.
 *   2. Busca tickets do pipeline de Faturamento associados a cada apólice.
 *   3. Agrega `valor_da_fatura` por mês de competência (createdate do ticket →
 *      "YYYY-MM"), somando entre apólices quando o deal tem mais de uma.
 *   4. Grava `months`/`monthsMeta` no store (merge — nunca apaga mês digitado à mão
 *      que não veio do HubSpot) e força `manual: true`, EXCETO se um humano já
 *      colocou `manual: false` explicitamente no editor (override absoluto do
 *      painel Ganho — não é pisado por esta sincronização automática).
 *
 * Roda diariamente via Vercel Cron (vercel.json, mesmo CRON_SECRET do /api/snapshot).
 * Também pode ser chamado manualmente (usuário autenticado) e, com `?dealId=`,
 * limitado a um único deal — útil pra testar sem varrer todos.
 */
const { setCORSHeaders, getHubspotToken } = require('./_helpers');
const { verifyRequest } = require('../lib/auth');
const { hubspotGet, hubspotPost } = require('../lib/hubspot');
const kv = require('../lib/kv');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APOLICE_OBJECT = '2-28940735';
const KV_KEY = 'forecast:faturamento_manual';
const TMP_FILE = path.join(os.tmpdir(), 'faturamento-manual.json');

// Etapas Ganho/Implantação, Vendas + Bid — STATUS_LOG.md "HubSpot — IDs críticos".
const GANHO_IMPLANTACAO_STAGES = ['1144844314', '1288611084', '1353387280', '1353457025'];

async function readAll() {
  if (kv.isConfigured()) {
    try { const v = await kv.getJSON(KV_KEY); if (v && typeof v === 'object') return v; } catch (e) { /* cai p/ fallback */ }
  }
  try {
    const j = JSON.parse(fs.readFileSync(TMP_FILE, 'utf8'));
    if (j && typeof j === 'object') return j;
  } catch (e) { /* sem arquivo */ }
  return {};
}

async function writeAll(obj) {
  if (kv.isConfigured()) {
    try { await kv.setJSON(KV_KEY, obj); return; } catch (e) { /* cai p/ /tmp */ }
  }
  fs.writeFileSync(TMP_FILE, JSON.stringify(obj), 'utf8');
}

async function fetchGanhoDealIds(token, onlyDealId) {
  if (onlyDealId) return [String(onlyDealId)];
  const ids = [];
  let after;
  for (;;) {
    const body = {
      filterGroups: [{ filters: [{ propertyName: 'dealstage', operator: 'IN', values: GANHO_IMPLANTACAO_STAGES }] }],
      properties: ['dealname'],
      limit: 100,
    };
    if (after) body.after = after;
    const resp = await hubspotPost(token, '/crm/v3/objects/deals/search', body);
    (resp.results || []).forEach(r => ids.push(String(r.id)));
    after = resp.paging && resp.paging.next && resp.paging.next.after;
    if (!after) break;
  }
  return ids;
}

async function fetchDealApolices(token, dealId) {
  const r = await hubspotGet(token, `/crm/v4/objects/deals/${dealId}/associations/${APOLICE_OBJECT}`);
  return [...new Set((r.results || []).map(x => String(x.toObjectId || x.id)).filter(Boolean))];
}

async function fetchApoliceTickets(token, apoliceId) {
  const r = await hubspotGet(token, `/crm/v4/objects/${APOLICE_OBJECT}/${apoliceId}/associations/tickets`);
  return [...new Set((r.results || []).map(x => String(x.toObjectId || x.id)).filter(Boolean))];
}

// Sincroniza UM deal. Retorna { dealId, apolices, updated, skippedManualFalse } —
// nunca lança; erros vão pro campo `error` do retorno (um deal com problema não pode
// derrubar a sincronização dos outros).
async function syncDeal(token, dealId, store) {
  try {
    const apoliceIds = await fetchDealApolices(token, dealId);
    if (!apoliceIds.length) return { dealId, apolices: 0 };

    const ticketIdsByApolice = {};
    await Promise.all(apoliceIds.map(async (apId) => {
      ticketIdsByApolice[apId] = await fetchApoliceTickets(token, apId);
    }));
    const allTicketIds = [...new Set(Object.values(ticketIdsByApolice).flat())];
    if (!allTicketIds.length) return { dealId, apolices: apoliceIds.length, tickets: 0 };

    const ticketBatch = await hubspotPost(token, '/crm/v3/objects/tickets/batch/read', {
      properties: ['createdate', 'valor_da_fatura'],
      inputs: allTicketIds.map(id => ({ id }))
    });

    // Agrega por mês de competência (createdate do ticket), somando entre apólices.
    const monthTotals = {};
    const monthTickets = {};
    (ticketBatch.results || []).forEach(r => {
      const p = r.properties || {};
      if (p.valor_da_fatura == null || p.valor_da_fatura === '' || !p.createdate) return;
      const n = Number(p.valor_da_fatura);
      if (!isFinite(n) || n < 0) return;
      const mes = p.createdate.substring(0, 7);
      monthTotals[mes] = (monthTotals[mes] || 0) + n;
      (monthTickets[mes] = monthTickets[mes] || []).push(r.id);
    });
    if (!Object.keys(monthTotals).length) return { dealId, apolices: apoliceIds.length, tickets: allTicketIds.length, monthsFound: 0 };

    const entry = (store[dealId] && typeof store[dealId] === 'object') ? store[dealId] : {};
    if (entry.manual === false) return { dealId, apolices: apoliceIds.length, skippedManualFalse: true };

    const months = { ...(entry.months || {}) };
    const monthsMeta = { ...(entry.monthsMeta || {}) };
    Object.keys(monthTotals).forEach(mes => {
      months[mes] = monthTotals[mes];
      monthsMeta[mes] = { source: 'hubspot', ticketIds: monthTickets[mes] };
    });

    store[dealId] = {
      ...entry,
      manual: true,
      months,
      monthsMeta,
      meta: {
        em: new Date().toISOString(),
        por: 'sync-faturamento-hubspot (automático)',
        anterior: { manual: ('manual' in entry) ? entry.manual : null, months: entry.months ? { ...entry.months } : null },
      },
    };
    return { dealId, apolices: apoliceIds.length, tickets: allTicketIds.length, monthsFound: Object.keys(monthTotals).length, updated: true };
  } catch (e) {
    return { dealId, error: e.message };
  }
}

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  const cronSecret  = process.env.CRON_SECRET;
  const authHeader  = req.headers['authorization'] || '';
  const isCron      = !!cronSecret && authHeader === `Bearer ${cronSecret}`;
  const userSession = verifyRequest(req);
  const isUser      = !!userSession;
  const isDevBypass = process.env.LOCAL_DEV_BYPASS === 'true';
  if (!isCron && !isUser && !isDevBypass) {
    return res.status(401).json({ success: false, error: 'Não autorizado' });
  }

  let token;
  try { token = getHubspotToken(); }
  catch (e) { return res.status(503).json({ success: false, error: e.message }); }

  try {
    const onlyDealId = (req.query && req.query.dealId) ? String(req.query.dealId) : null;
    const dealIds = await fetchGanhoDealIds(token, onlyDealId);
    const store = await readAll();

    const results = await Promise.all(dealIds.map(id => syncDeal(token, id, store)));

    await writeAll(store);

    const report = {
      dealsChecked: results.length,
      dealsWithApolice: results.filter(r => r.apolices > 0).length,
      dealsUpdated: results.filter(r => r.updated).length,
      dealsSkippedManualFalse: results.filter(r => r.skippedManualFalse).length,
      errors: results.filter(r => r.error).map(r => ({ dealId: r.dealId, error: r.error })),
      details: results,
    };
    return res.status(200).json({ success: true, report });
  } catch (e) {
    console.error('[sync-faturamento-hubspot] error:', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
};
