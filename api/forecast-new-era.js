'use strict';
/**
 * GET /api/forecast-new-era
 * Deals do pipeline New Era (933315963) — frente de atendimento a corretoras,
 * separada do pipe Vendas/Bid. Fase 1 (pedido do dono, 2026-09-17): só
 * listagem, sem cálculo de receita/probabilidade — isso é iterado depois.
 *
 * Isolado de propósito de `forecast-table.js`/`lib/semantic.js`: aquela
 * camada é a fonte única de receita (Regra primária nº 3) para Vendas+Bid,
 * e o New Era ainda está em descoberta (etapas podem mudar). Por isso os
 * nomes de etapa vêm AO VIVO do HubSpot (GET /crm/v3/pipelines/deals/{id}),
 * não hardcoded — evita editar código toda vez que uma etapa for
 * criada/renomeada durante o pivot.
 */

const { setCORSHeaders, requireAuth, getHubspotToken, methodCheck } = require('./_helpers');

const PIPELINE_ID = '933315963';
const PROPERTIES = ['dealname', 'dealstage', 'pipeline', 'hubspot_owner_id', 'createdate', 'hs_object_id'];

// Retry em 429/5xx com backoff (mesmo padrão de forecast-table.js).
async function _hsFetchRetry(url, options, maxRetries = 3) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, options);
    if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
      const ra = parseFloat(res.headers.get('retry-after'));
      const wait = !isNaN(ra) ? Math.min(ra * 1000, 10000) : (1000 * Math.pow(2, attempt) + Math.random() * 300);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    return res;
  }
}

async function hubspotGet(token, url) {
  const res = await _hsFetchRetry(`https://api.hubapi.com${url}`, {
    headers: { 'Authorization': `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  if (res.status >= 400) throw new Error(`HubSpot API error (HTTP ${res.status}) em ${url}`);
  return res.json();
}

async function hubspotPost(token, endpoint, body) {
  const res = await _hsFetchRetry(`https://api.hubapi.com${endpoint}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (res.status === 429) throw new Error('HubSpot rate limit exceeded. Aguarde alguns minutos.');
  if (res.status === 401 || res.status === 403) throw new Error('HubSpot: autenticação falhou.');
  if (res.status >= 400) throw new Error(`HubSpot API error (HTTP ${res.status})`);
  const json = await res.json();
  if (json.status === 'error') throw new Error(json.message || 'HubSpot API error');
  return json;
}

async function fetchPipelineStages(token) {
  const map = {};
  try {
    const r = await hubspotGet(token, `/crm/v3/pipelines/deals/${PIPELINE_ID}`);
    (r.stages || []).forEach(s => { map[s.id] = s.label; });
  } catch (e) {
    console.error('[forecast-new-era] falha ao buscar etapas do pipeline:', e.message);
  }
  return map;
}

async function fetchOwners(token) {
  const map = {};
  for (const archived of ['false', 'true']) {
    let after, hasMore = true;
    while (hasMore) {
      const url = '/crm/v3/owners?limit=200&archived=' + archived + (after ? '&after=' + after : '');
      const r = await hubspotGet(token, url);
      (r.results || []).forEach(o => {
        const name = `${o.firstName || ''} ${o.lastName || ''}`.trim() || o.email || String(o.id);
        if (!map[o.id]) map[o.id] = name;
      });
      hasMore = r.paging?.next?.after != null;
      after = r.paging?.next?.after;
    }
  }
  return map;
}

async function fetchDeals(token) {
  let all = [], after = 0, hasMore = true;
  while (hasMore) {
    const body = {
      filterGroups: [{ filters: [{ propertyName: 'pipeline', operator: 'EQ', value: PIPELINE_ID }] }],
      properties: PROPERTIES,
      limit: 200,
      after,
    };
    const resp = await hubspotPost(token, '/crm/v3/objects/deals/search', body);
    all = all.concat(resp.results || []);
    hasMore = resp.paging?.next?.after != null;
    after = resp.paging?.next?.after || 0;
  }
  return all;
}

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['GET'])) return;

  const user = requireAuth(req, res);
  if (!user) return;

  let token;
  try { token = getHubspotToken(); } catch (e) {
    return res.status(503).json({ success: false, error: e.message });
  }

  try {
    const [rawDeals, ownerMap, stageMap] = await Promise.all([
      fetchDeals(token), fetchOwners(token), fetchPipelineStages(token),
    ]);

    const now = Date.now();
    const deals = rawDeals.map(r => {
      const p = r.properties || {};
      const id = String(r.id || p.hs_object_id || '');
      const createdate = p.createdate || null;
      let diasNoPipe = null;
      if (createdate) {
        const created = new Date(createdate).getTime();
        if (!isNaN(created)) diasNoPipe = Math.floor((now - created) / 86400000);
      }
      return {
        id,
        dealname: p.dealname || '(sem nome)',
        etapa: stageMap[p.dealstage] || p.dealstage || '-',
        executivo: ownerMap[p.hubspot_owner_id] || '-',
        dias_no_pipe: diasNoPipe,
        createdate,
      };
    }).sort((a, b) => (b.dias_no_pipe || 0) - (a.dias_no_pipe || 0));

    res.status(200).json({
      success: true,
      pipeline_id: PIPELINE_ID,
      count: deals.length,
      deals,
    });
  } catch (e) {
    console.error('[forecast-new-era] erro:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
};
