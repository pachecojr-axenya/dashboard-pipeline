'use strict';
/**
 * Reconstrucao point-in-time de deals via HubSpot propertiesWithHistory.
 * Fonte unica para backfills historicos. Nao le nem escreve Google Sheets.
 */

const { hubspotPost, fetchOwners, STAGE_MAP } = require('./hubspot');
const { PIPELINE_VENDAS, PIPELINE_BID, PIPELINE_LABELS, HEADERS } = require('./snapshot-format');

const HIST_PROPS = [
  'dealname', 'dealstage', 'pipeline', 'hubspot_owner_id', 'sdr',
  'produto', 'quantidade_de_colaboradores', 'vidas',
  'valor_da_fatura_do_plano_de_saude_atual', 'primeira_fatura',
  'arr_estimado', 'premio_mensal', 'modelo_de_remuneracao',
  'possui_agenciamento', 'possui_vitalicio', 'e_poc',
  'probabilidade_de_fechamento_', 'qual_quarter_de_fechamento',
  'data_prevista_para_receita', 'vigencia', 'vencimento_da_1o_fatura',
  'createdate', 'closedate',
  'hs_v2_date_entered_1144746905', 'hs_v2_date_entered_1288611084', 'hs_v2_date_entered_1144844314',
  'hs_is_closed_won', 'hs_is_closed_lost',
  'motivo_do_declinio_ou_perdido', 'motivo_de_declinio_perdido___descricao', 'a_reuniao_ocorreu_',
];

function valueAt(versions, cutoff) {
  if (!versions || !versions.length) return null;
  const sorted = versions.slice().sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  for (const v of sorted) if (v.timestamp <= cutoff) return v.value;
  return null;
}

async function fetchAllDealIds(token) {
  let all = [], after = 0, hasMore = true;
  while (hasMore) {
    const resp = await hubspotPost(token, '/crm/v3/objects/deals/search', {
      // Universo amplo: filtrar pelo pipeline ATUAL excluiria deals que estavam
      // em Vendas/Bid no cutoff e depois foram movidos para outro pipeline.
      filterGroups: [],
      properties: ['hs_object_id'], limit: 200, after,
    });
    all = all.concat((resp.results || []).map(r => r.id));
    hasMore = !!(resp.paging && resp.paging.next && resp.paging.next.after != null);
    after = hasMore ? resp.paging.next.after : 0;
  }
  return all;
}

async function fetchHistories(token, ids, onProgress) {
  const hist = {};
  for (let i = 0; i < ids.length; i += 25) {
    const batch = ids.slice(i, i + 25);
    const resp = await hubspotPost(token, '/crm/v3/objects/deals/batch/read', {
      properties: ['dealstage'], propertiesWithHistory: HIST_PROPS,
      inputs: batch.map(id => ({ id: String(id) })),
    });
    (resp.results || []).forEach(r => { hist[r.id] = r.propertiesWithHistory || {}; });
    if (onProgress) onProgress(i + batch.length, ids.length);
  }
  return hist;
}

function buildRows(ids, hist, ownerMap, cutoff, capturedLabel) {
  const v = x => (x == null ? '' : String(x));
  const rows = [];
  for (const id of ids) {
    const h = hist[id] || {};
    const at = prop => valueAt(h[prop], cutoff);
    const created = at('createdate');
    if (!created || created > cutoff) continue;
    const stageId = at('dealstage');
    if (!stageId) continue;
    const pipeId = at('pipeline');
    if (pipeId !== PIPELINE_VENDAS && pipeId !== PIPELINE_BID) continue;
    rows.push([
      id, v(at('dealname')), 'https://app.hubspot.com/contacts/44715285/deal/' + id,
      PIPELINE_LABELS[pipeId] || v(pipeId), v(STAGE_MAP[stageId] || stageId),
      v(ownerMap[at('hubspot_owner_id')] || at('hubspot_owner_id')),
      v(ownerMap[at('sdr')] || at('sdr')), v(at('produto')), v(at('vidas')),
      v(at('quantidade_de_colaboradores')), v(at('valor_da_fatura_do_plano_de_saude_atual')),
      v(at('primeira_fatura')), v(at('arr_estimado')), v(at('premio_mensal')),
      v(at('modelo_de_remuneracao')), v(at('possui_agenciamento')), v(at('possui_vitalicio')),
      v(at('e_poc')), v(at('probabilidade_de_fechamento_')), '',
      v(at('qual_quarter_de_fechamento')), v(at('data_prevista_para_receita')),
      v(at('vigencia')), v(at('vencimento_da_1o_fatura')), v(created), v(at('closedate')),
      v(at('hs_v2_date_entered_1144746905')), v(at('hs_v2_date_entered_1288611084')),
      v(at('hs_v2_date_entered_1144844314')), v(at('hs_is_closed_won')),
      v(at('hs_is_closed_lost')), v(at('motivo_do_declinio_ou_perdido')),
      v(at('motivo_de_declinio_perdido___descricao')), v(at('a_reuniao_ocorreu_')),
      '', capturedLabel,
    ]);
  }
  return rows;
}

function cutoffForDay(day) {
  const next = new Date(Date.parse(day + 'T00:00:00Z') + 86400000).toISOString().substring(0, 10);
  return next + 'T02:59:59.999Z'; // 23:59:59.999 BRT
}

function dateRange(from, to) {
  const out = [];
  for (let t = Date.parse(from + 'T00:00:00Z'), end = Date.parse(to + 'T00:00:00Z'); t <= end; t += 86400000) {
    out.push(new Date(t).toISOString().substring(0, 10));
  }
  return out;
}

async function loadHistory(token, onProgress) {
  const ids = await fetchAllDealIds(token);
  const [hist, ownerMap] = await Promise.all([
    fetchHistories(token, ids, onProgress),
    fetchOwners(token),
  ]);
  return { ids, hist, ownerMap };
}

module.exports = {
  HEADERS, HIST_PROPS, valueAt, fetchAllDealIds, fetchHistories,
  buildRows, cutoffForDay, dateRange, loadHistory,
};
