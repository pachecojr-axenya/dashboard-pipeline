'use strict';
/**
 * GET /api/funnel-stages?since=2025-08-01&until=2026-06-30
 *
 * Retorna quantos deals únicos entraram em cada etapa dos pipelines
 * Vendas e Bid desde a data informada — base para conversão do funil.
 *
 * Resposta: { vendas: { stages, conversions }, bid: { stages, conversions }, ... }
 */

const { setCORSHeaders, requireAuth, getHubspotToken, methodCheck } = require('./_helpers');
const { hubspotPost } = require('../lib/hubspot');

const VENDAS_ID = '782758156';
const BID_ID    = '894130090';

const VENDAS_STAGE_MAP = {
  '1144746905': 'Reunião Agendada',
  '1144746906': 'Diagnóstico',
  '1144746908': 'Cotação',
  '1144746909': 'Consultoria',
  '1144746910': 'Negociação',
  '1317543716': 'Standby',
  '1288611084': 'Implantação',
  '1144844314': 'Ganho',
  '1144746911': 'Perdido',
};

const BID_STAGE_MAP = {
  '1363560722': 'Cotação',
  '1349620555': 'Proposta Enviada',
  '1349620556': 'Consultoria',
  '1353387279': 'Negociação',
  '1353387280': 'Ganho',
  '1353457025': 'Implantação',
  '1373066362': 'Standby',
};

const VENDAS_FUNNEL = ['Reunião Agendada','Diagnóstico','Cotação','Consultoria','Negociação','Implantação','Ganho'];
const VENDAS_EXTRA  = ['Stand by','Perdido'];

const BID_FUNNEL = ['Cotação','Proposta Enviada','Consultoria','Negociação','Implantação','Ganho'];
const BID_EXTRA  = ['Standby'];

function buildResult(funnelOrder, extraStages, stageSets, dealNames, stageDates) {
  const allStages = [...funnelOrder, ...extraStages];
  const stages = allStages.map(stage => ({
    stage,
    count: stageSets[stage] ? stageSets[stage].size : 0,
    deals: stageSets[stage]
      ? [...stageSets[stage]].map(id => ({ hs_id: id, name: dealNames[id] || '', entered_date: stageDates[stage]?.[id] || null }))
      : [],
  }));

  const conversions = [];
  for (let i = 0; i < funnelOrder.length - 1; i++) {
    const from = stages.find(s => s.stage === funnelOrder[i]);
    const to   = stages.find(s => s.stage === funnelOrder[i + 1]);
    if (!from || !to) continue;
    conversions.push({
      from:       from.stage,
      to:         to.stage,
      from_count: from.count,
      to_count:   to.count,
      rate:     from.count > 0 ? Math.round((to.count / from.count) * 10000) / 10000 : null,
      rate_pct: from.count > 0 ? Math.round((to.count / from.count) * 1000) / 10    : null,
    });
  }
  return { stages, conversions };
}

async function fetchAllDeals(token) {
  let all = [], after = 0, hasMore = true;
  while (hasMore) {
    const body = {
      filterGroups: [{ filters: [
        { propertyName: 'pipeline', operator: 'IN', values: [VENDAS_ID, BID_ID] },
      ]}],
      properties: ['dealname', 'pipeline', 'hs_object_id', 'createdate'],
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

  const since = req.query.since || '2025-08-01';
  const until = req.query.until || null;

  let token;
  try { token = getHubspotToken(); } catch (e) {
    return res.status(503).json({ success: false, error: e.message });
  }

  try {
    // 1. Busca todos os deals dos dois pipelines
    const rawDeals = await fetchAllDeals(token);
    const hsIds = rawDeals.map(r => r.properties.hs_object_id).filter(Boolean);

    const dealNames      = {};
    const dealPipeline   = {};
    const dealCreateDate = {};
    rawDeals.forEach(r => {
      const id = r.properties.hs_object_id;
      dealNames[id]      = (r.properties.dealname || '').trim();
      dealPipeline[id]   = r.properties.pipeline;
      dealCreateDate[id] = r.properties.createdate ? r.properties.createdate.substring(0, 10) : null;
    });

    // 2. Histórico de dealstage + owner em batches de 50
    const historyByDeal = {};
    const ownerChangesByDeal = {};
    for (let i = 0; i < hsIds.length; i += 50) {
      const batch = hsIds.slice(i, i + 50);
      try {
        const resp = await hubspotPost(token, '/crm/v3/objects/deals/batch/read', {
          properties: ['dealstage'],
          propertiesWithHistory: ['dealstage', 'hubspot_owner_id'],
          inputs: batch.map(id => ({ id: String(id) })),
        });
        (resp.results || []).forEach(r => {
          const hist = r.propertiesWithHistory?.dealstage;
          if (hist && hist.length > 0) {
            historyByDeal[r.id] = hist
              .slice()
              .sort((a, b) => a.timestamp < b.timestamp ? -1 : 1)
              .map(h => ({ stage_id: h.value, entered_date: h.timestamp.substring(0, 10) }));
          }
          const ownerHist = r.propertiesWithHistory?.hubspot_owner_id;
          ownerChangesByDeal[r.id] = ownerHist ? Math.max(0, ownerHist.length - 1) : 0;
        });
      } catch (e) {
        console.error('[funnel-stages] batch/read error:', e.message);
      }
    }

    // 2.5: Média de tempo REAL em cada etapa (stage_medians para N07)
    // Isolado em try-catch para não bloquear owner_changes se houver erro.
    let stageMedsByName = {};
    let _stageCtsOut = {};
    try {
      const _avgArr = arr => {
        if (!arr.length) return null;
        return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10;
      };
      const todayStr = new Date().toISOString().substring(0, 10);
      const _stageDurs = {};
      const _stageCts  = {};
      hsIds.forEach(id => {
        // Filtra por data de criação do deal (>= since), não por data de transição.
        // Assim N07 reflete apenas o ciclo de deals abertos no período, igual ao HubSpot.
        const cd = dealCreateDate[id];
        if (!cd || cd < since) return;
        if (until && cd > until) return;
        const pipe = dealPipeline[id];
        if (pipe !== VENDAS_ID) return;   // N07: apenas Pipeline de Vendas
        const stageMap = VENDAS_STAGE_MAP;
        const hist = historyByDeal[id] || [];
        if (!hist.length) return;
        for (let i = 0; i < hist.length; i++) {
          const stageName = stageMap[hist[i].stage_id];
          if (!stageName) continue;
          const exitDate = i + 1 < hist.length ? hist[i + 1].entered_date : todayStr;
          const days = Math.max(0, Math.round(
            (new Date(exitDate + 'T00:00:00') - new Date(hist[i].entered_date + 'T00:00:00')) / 86400000
          ));
          if (!_stageDurs[stageName]) _stageDurs[stageName] = [];
          _stageDurs[stageName].push(days);
        }
      });
      Object.keys(_stageDurs).forEach(s => {
        stageMedsByName[s] = _avgArr(_stageDurs[s]);
        _stageCtsOut[s] = _stageDurs[s].length;
      });
    } catch (e) {
      console.error('[funnel-stages] stage_medians error:', e.message);
      stageMedsByName = {};
      _stageCtsOut = {};
    }

    // 3. Contadores separados por pipeline
    const vendasSets = {};
    const bidSets    = {};
    const vendasDates = {};
    const bidDates = {};
    [...VENDAS_FUNNEL, ...VENDAS_EXTRA].forEach(s => { vendasSets[s] = new Set(); vendasDates[s] = {}; });
    [...BID_FUNNEL,    ...BID_EXTRA   ].forEach(s => { bidSets[s]    = new Set(); bidDates[s] = {}; });

    hsIds.forEach(id => {
      const pipe = dealPipeline[id];
      (historyByDeal[id] || []).forEach(entry => {
        if (entry.entered_date < since) return;
        if (until && entry.entered_date > until) return;
        if (pipe === VENDAS_ID) {
          const name = VENDAS_STAGE_MAP[entry.stage_id];
          if (name && vendasSets[name]) { vendasSets[name].add(id); if (!vendasDates[name][id] || entry.entered_date < vendasDates[name][id]) vendasDates[name][id] = entry.entered_date; }
        } else if (pipe === BID_ID) {
          const name = BID_STAGE_MAP[entry.stage_id];
          if (name && bidSets[name]) { bidSets[name].add(id); if (!bidDates[name][id] || entry.entered_date < bidDates[name][id]) bidDates[name][id] = entry.entered_date; }
        }
      });
    });

    const totalVendas = rawDeals.filter(r => r.properties.pipeline === VENDAS_ID).length;
    const totalBid    = rawDeals.filter(r => r.properties.pipeline === BID_ID).length;

    return res.status(200).json({
      success: true,
      since,
      until,
      total_deals:        rawDeals.length,
      total_vendas:       totalVendas,
      total_bid:          totalBid,
      total_with_history: Object.keys(historyByDeal).length,
      vendas: buildResult(VENDAS_FUNNEL, VENDAS_EXTRA, vendasSets, dealNames, vendasDates),
      bid:    buildResult(BID_FUNNEL,    BID_EXTRA,    bidSets,    dealNames, bidDates),
      owner_changes:  ownerChangesByDeal,
      stage_medians:  Object.keys(stageMedsByName).length ? stageMedsByName : null,
      stage_counts:   _stageCtsOut,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[funnel-stages]', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
};
