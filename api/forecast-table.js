'use strict';
/**
 * GET /api/forecast-table
 * Retorna todos os deals ativos (Vendas + Bid) com campos normalizados
 * para o novo dashboard. Mesma lógica do dash-forecast.
 */

const { setCORSHeaders, requireAuth, getHubspotToken, methodCheck } = require('./_helpers');

const PIPELINE_ID   = '782758156'; // Vendas
const PIPELINE_2_ID = '894130090'; // Bid

const PIPELINE_LABELS = {
  [PIPELINE_ID]:   'Vendas',
  [PIPELINE_2_ID]: 'Bid',
};

const STAGE_MAP = {
  // Vendas
  '1144746905': 'Reunião Agendada',
  '1144746906': 'Diagnóstico',
  '1144746908': 'Cotação',
  '1144746909': 'Consultoria',
  '1144746910': 'Negociação',
  '1317543716': 'Stand by',
  '1288611084': 'Implantação',
  '1144844314': 'Ganho',
  '1144746911': 'Perdido',
  // Bid
  '1363560722': 'Cotação',
  '1349620551': 'Reunião Pré-RFP',
  '1349620555': 'Proposta Enviada',
  '1349620556': 'Consultoria',
  '1353387279': 'Negociação',
  '1353387280': 'Ganho',
  '1353457025': 'Implantação',
  '1373066362': 'Standby',
};

const ACTIVE_STAGE_IDS = [
  // Vendas - activos + Reunião Agendada + Stand by (sem Perdido)
  '1144746905', '1144746906', '1144746908', '1144746909', '1144746910', '1317543716', '1288611084', '1144844314',
  // Bid
  '1363560722', '1349620551', '1349620555', '1349620556', '1353387279', '1353387280', '1353457025', '1373066362',
];
// Etapas de Perdido — incluídas APENAS quando o cliente pede ?includeLost=true (ex.: CRO Dashboard).
// Os demais painéis chamam sem o parâmetro e continuam recebendo só os ativos.
const LOST_STAGE_IDS = ['1144746911']; // Vendas Perdido (Bid não tem etapa de perdido mapeada)

const STAGE_PROB = {
  'Cotação': 0.33, 'Proposta Enviada': 0.285, 'Consultoria': 0.611,
  'Negociação': 0.42, 'Implantação': 0.581, 'Ganho': 1.0,
  'Standby': 0.12, 'Stand by': 0.12, 'Diagnóstico': 0.06,
};

const PROPERTIES = [
  'dealname', 'dealstage', 'pipeline', 'hubspot_owner_id', 'sdr',
  'origem__originacao_', // origem/originação do deal (drill do modal no /forecast)
  'produto', 'quantidade_de_colaboradores', 'vidas',
  'valor_da_fatura_do_plano_de_saude_atual', 'primeira_fatura',
  'arr_estimado', 'modelo_de_remuneracao',
  'possui_agenciamento', 'possui_vitalicio',
  'probabilidade_de_fechamento_', 'hs_deal_stage_probability',
  'qual_quarter_de_fechamento', 'data_prevista_para_receita',
  'hs_is_closed_won', 'hs_is_closed_lost', 'hs_object_id',
  'createdate', 'closedate',
  // Datas de entrada de etapa (variante v2, populada neste portal — a v1 hs_date_entered_* vem vazia).
  // Usadas pelo P01 (Receita Ganha): data em que o deal entrou em Ganho (Vendas), com fallback p/ Implantação (Vendas).
  'hs_v2_date_entered_1144844314', // Vendas | Ganho
  'hs_v2_date_entered_1288611084', // Vendas | Implantação
  'motivo_do_declinio_ou_perdido',
  'motivo_de_declinio_perdido___descricao', // texto aberto | justificativa do declínio (drill A15 do painel AE)
  'a_reuniao_ocorreu_',
  // Campos adicionais (preenchidos no portal, confirmados via /api/forecast-table):
  'premio_mensal',        // prêmio mensal real (vs proxy ARR/12) | ~224 deals
  'notes_last_updated',   // data da última atividade/nota | ~1144 deals
  'vigencia',             // data de vigência | usado na coluna "Vigência" do forecast novo
  'vencimento_da_1o_fatura', // data de vencimento da 1ª fatura | gate do faturamento manual (painel Ganho)
  // N08 | fórmula calculada no HubSpot: time_between(entrada em Reunião Agendada, entrada em
  // Diagnóstico), em MILISSEGUNDOS. Só existe para deals que JÁ chegaram a Diagnóstico.
  'cumulative_time_negocio_criado_ate_diagnostico_formula',
];

// Tempo médio por etapa (AE Deal Velocity): entrada/saída v2 de cada etapa do pipeline Vendas.
// stage_days[etapa] = (saída || hoje) - entrada, em dias. Usado pela tabela A19 do painel AE.
const STAGE_DUR = [
  ['Reunião Agendada', '1144746905'],
  ['Diagnóstico',      '1144746906'],
  ['Cotação',          '1144746908'],
  ['Consultoria',      '1144746909'],
  ['Negociação',       '1144746910'],
  ['Implantação',      '1288611084'],
];
STAGE_DUR.forEach(function(pair){ PROPERTIES.push('hs_v2_date_entered_' + pair[1], 'hs_v2_date_exited_' + pair[1]); });

// Trilha de etapas (modal do /forecast): data de entrada em TODAS as etapas por onde o deal
// passou, dos dois pipelines. Usa a variante v2 (a v1 hs_date_entered_* vem vazia neste portal).
const ALL_STAGE_IDS = Object.keys(STAGE_MAP);
ALL_STAGE_IDS.forEach(function(id){ PROPERTIES.push('hs_v2_date_entered_' + id); });
function computeStageEntered(p) {
  const out = {};
  ALL_STAGE_IDS.forEach(function(id){
    const v = p['hs_v2_date_entered_' + id];
    if (!v) return;
    const name = STAGE_MAP[id];
    if (!name) return;
    const dt = String(v).substring(0, 10);
    // Cotação/Consultoria/etc. existem nos dois pipelines com ids distintos; um deal só tem
    // valor no id do seu pipeline. Se houver dois, mantém a entrada MAIS ANTIGA.
    if (!out[name] || dt < out[name]) out[name] = dt;
  });
  return out;
}
function computeStageDays(p) {
  const now = Date.now();
  const out = {};
  STAGE_DUR.forEach(function(pair) {
    const ent = p['hs_v2_date_entered_' + pair[1]];
    if (!ent) return;
    const start = Date.parse(ent);
    if (isNaN(start)) return;
    const exRaw = p['hs_v2_date_exited_' + pair[1]];
    const end = exRaw ? Date.parse(exRaw) : now;
    if (isNaN(end)) return;
    let days = Math.round((end - start) / 86400000);
    if (days < 0) days = 0;
    out[pair[0]] = days;
  });
  return out;
}

// S06 (Completude): campos do HubSpot avaliados, com rótulo amigável. Avalia os valores
// CRUS (sem fallback) — por isso a completude é calculada no servidor, não derivada de arr/prob/quarter já mesclados.
const S06_FIELDS = [
  ['quantidade_de_colaboradores', 'Colaboradores'],
  ['vidas',                       'Vidas'],
  ['primeira_fatura',             '1ª Fatura'],
  ['arr_estimado',                'ARR Estimado'],
  ['modelo_de_remuneracao',       'Modelo de Remuneração'],
  ['possui_agenciamento',         'Possui Agenciamento'],
  ['possui_vitalicio',            'Possui Vitalício'],
  ['probabilidade_de_fechamento_','Probabilidade'],
  ['qual_quarter_de_fechamento',  'Quarter'],
  ['data_prevista_para_receita',  'Data Prevista Receita'],
];

function isFilled(v) {
  if (v === undefined || v === null) return false;
  const s = String(v).trim().toLowerCase();
  return s !== '' && s !== 'null' && s !== 'undefined';
}

// Retorna os rótulos dos campos S06 ausentes neste deal (campos crus).
function s06Missing(p) {
  const miss = [];
  for (const [key, label] of S06_FIELDS) {
    let filled;
    if (key === 'possui_agenciamento' || key === 'possui_vitalicio') {
      filled = normalizeBool(p[key]) !== null;          // só Sim/Não explícito conta como preenchido
    } else {
      filled = isFilled(p[key]);                        // demais campos: basta não estar vazio
    }
    if (!filled) miss.push(label);
  }
  return miss;
}

function normalizeProb(val) {
  const n = parseFloat(val);
  if (isNaN(n) || n < 0) return null;
  return n > 1 ? n / 100 : n;
}

function normalizeBool(val) {
  const v = (val || '').toString().trim().toLowerCase();
  if (v === 'true' || v === 'sim' || v === 'yes') return true;
  if (v === 'false' || v === 'não' || v === 'nao' || v === 'no') return false;
  return null;
}

function quarterEmpty(q) {
  if (!q) return true;
  const s = String(q).trim().toLowerCase();
  if (s === 'false' || s === 'true' || s === 'sem informação' || s === 'sem informacao') return true;
  return !/\d{4}/.test(s);
}

function getQuarterFromDate(dateStr) {
  if (!dateStr) return null;
  const m = dateStr.trim().match(/^(\d{4})-(\d{2})-\d{2}/);
  if (m) {
    const q = Math.floor((parseInt(m[2]) - 1) / 3) + 1;
    return `Q${q} ${m[1]}`;
  }
  const d = new Date(dateStr);
  if (!isNaN(d)) return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
  return null;
}

async function hubspotPost(token, endpoint, body) {
  const res = await fetch(`https://api.hubapi.com${endpoint}`, {
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

async function hubspotGet(token, url) {
  const res = await fetch(`https://api.hubapi.com${url}`, {
    headers: { 'Authorization': `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  if (res.status >= 400) throw new Error(`HubSpot API error (HTTP ${res.status})`);
  return res.json();
}

async function fetchOwners(token) {
  const map = {};
  // Inclui owners ARQUIVADOS (usuários desativados): ~13% dos BDRs (campo sdr) apontavam para
  // owners que o endpoint padrão não retorna, e apareciam como id cru na UI. archived=true resolve.
  for (const archived of ['false', 'true']) {
    let after, hasMore = true;
    while (hasMore) {
      const url = '/crm/v3/owners?limit=200&archived=' + archived + (after ? '&after=' + after : '');
      const r = await hubspotGet(token, url);
      (r.results || []).forEach(o => {
        const name = `${o.firstName || ''} ${o.lastName || ''}`.trim() || o.email || String(o.id);
        if (!map[o.id]) map[o.id] = name;   // owner ativo tem precedência sobre arquivado de mesmo id
      });
      hasMore = r.paging?.next?.after != null;
      after = r.paging?.next?.after;
    }
  }
  return map;
}

async function fetchDeals(token, includeLost) {
  // Grupo 1: ativos (por stage). Grupo 2 (só com includeLost): TODOS os closed-lost dos
  // dois pipelines via hs_is_closed_lost — pega o Perdido do BID, que não tem stage id
  // mapeado em LOST_STAGE_IDS (filterGroups são OR entre si). P09 (Vidas Perdidas) e as
  // taxas de conversão passam a contar perdidos de Vendas + Bid.
  const filterGroups = [
    { filters: [
      { propertyName: 'pipeline',  operator: 'IN', values: [PIPELINE_ID, PIPELINE_2_ID] },
      { propertyName: 'dealstage', operator: 'IN', values: ACTIVE_STAGE_IDS },
    ]},
  ];
  if (includeLost) {
    filterGroups.push({ filters: [
      { propertyName: 'pipeline',          operator: 'IN', values: [PIPELINE_ID, PIPELINE_2_ID] },
      { propertyName: 'hs_is_closed_lost', operator: 'EQ', value: 'true' },
    ]});
  }
  let all = [], after = 0, hasMore = true;
  while (hasMore) {
    const body = {
      filterGroups,
      properties: [...new Set(PROPERTIES)],
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

  const includeLost = !!(req.query && String(req.query.includeLost) === 'true');

  try {
    const [rawDeals, ownerMap] = await Promise.all([fetchDeals(token, includeLost), fetchOwners(token)]);

    const deals = rawDeals
      .filter(r => includeLost || r.properties.hs_is_closed_lost !== 'true')
      .map(r => {
        const p = r.properties;
        // closed-lost → 'Perdido' mesmo quando o stage id do BID não está mapeado.
        const stageName = p.hs_is_closed_lost === 'true'
          ? 'Perdido'
          : (STAGE_MAP[p.dealstage] || p.dealstage || '-');

        const prob = (() => {
          const custom = normalizeProb(p.probabilidade_de_fechamento_);
          if (custom !== null) return custom;
          return normalizeProb(p.hs_deal_stage_probability);
        })();

        const arr = (() => {
          const a = parseFloat(p.arr_estimado);
          if (!isNaN(a) && a > 0) return a;
          const pf = parseFloat(p.primeira_fatura);
          if (!isNaN(pf) && pf > 0) return pf * 12;
          return null;
        })();

        const dateStr = p.data_prevista_para_receita
          ? p.data_prevista_para_receita.substring(0, 10) : null;

        let quarter = p.qual_quarter_de_fechamento || null;
        if (quarterEmpty(quarter)) quarter = getQuarterFromDate(dateStr) || null;

        const camposFaltantes = s06Missing(p);

        return {
          hs_id: p.hs_object_id,
          dealname: (p.dealname || '')
            .replace(/ - Novo\(a\) Deal$/i, '')
            .replace(/ - New Deal$/i, '')
            .trim(),
          pipeline: PIPELINE_LABELS[p.pipeline] || p.pipeline || '-',
          stage: stageName,
          ae: ownerMap[p.hubspot_owner_id] || '-',
          sdr: (function(){ var s = p.sdr || null; return s ? (ownerMap[s] || s) : null; })(),
          produto: p.produto || null,
          colaboradores: p.quantidade_de_colaboradores ? parseInt(p.quantidade_de_colaboradores) : null,
          vidas: p.vidas ? parseInt(p.vidas) : null,
          fatura_atual: p.valor_da_fatura_do_plano_de_saude_atual
            ? parseFloat(p.valor_da_fatura_do_plano_de_saude_atual) : null,
          primeira_fatura: p.primeira_fatura ? parseFloat(p.primeira_fatura) : null,
          arr_estimado: arr,
          modelo_remuneracao: p.modelo_de_remuneracao || null,
          possui_agenciamento: normalizeBool(p.possui_agenciamento),
          possui_vitalicio: normalizeBool(p.possui_vitalicio),
          probabilidade: prob,
          quarter,
          data_prevista_para_receita: dateStr,
          close_date: p.closedate ? p.closedate.substring(0, 10) : null,
          data_ganho: p.hs_v2_date_entered_1144844314 ? p.hs_v2_date_entered_1144844314.substring(0, 10) : null,
          data_implantacao: p.hs_v2_date_entered_1288611084 ? p.hs_v2_date_entered_1288611084.substring(0, 10) : null,
          // Data de entrada na etapa Reunião Agendada (Vendas). É o evento real de "BDR marcou reunião",
          // usado pelo painel BDR no lugar de createdate (que é distorcido por importações em massa).
          data_reuniao_agendada: p.hs_v2_date_entered_1144746905 ? p.hs_v2_date_entered_1144746905.substring(0, 10) : null,
          reuniao_ocorreu: p.a_reuniao_ocorreu_ || null,
          // N08 | ms → dias (1 decimal). null = ainda não chegou a Diagnóstico.
          tempo_ate_diag_dias: (function(){ var v = parseFloat(p.cumulative_time_negocio_criado_ate_diagnostico_formula); return (!isNaN(v) && v >= 0) ? Math.round(v / 86400000 * 10) / 10 : null; })(),
          premio_mensal: p.premio_mensal ? parseFloat(p.premio_mensal) : null,
          vigencia: p.vigencia ? p.vigencia.substring(0, 10) : null,
          vencimento_primeira_fatura: p.vencimento_da_1o_fatura ? p.vencimento_da_1o_fatura.substring(0, 10) : null,
          ultima_atividade: p.notes_last_updated ? p.notes_last_updated.substring(0, 10) : null,
          dias_sem_atividade: p.notes_last_updated
            ? Math.floor((Date.now() - new Date(p.notes_last_updated).getTime()) / 86400000)
            : null,
          campos_faltantes: camposFaltantes,
          dados_completos: camposFaltantes.length === 0,
          lost_reason: p.motivo_do_declinio_ou_perdido || null,
          lost_reason_desc: p.motivo_de_declinio_perdido___descricao || null,
          createdate: p.createdate ? p.createdate.substring(0, 10) : null,
          dias_no_pipe: p.createdate
            ? Math.floor((Date.now() - new Date(p.createdate).getTime()) / 86400000)
            : null,
          stage_days: computeStageDays(p),
          origem: p.origem__originacao_ || null,
          stage_entered: computeStageEntered(p),
        };
      });

    return res.status(200).json({
      success: true,
      deals,
      total: deals.length,
      pipelines: { vendas: deals.filter(d => d.pipeline === 'Vendas').length, bid: deals.filter(d => d.pipeline === 'Bid').length },
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[forecast-table]', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
};
