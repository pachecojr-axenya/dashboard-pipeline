'use strict';
/**
 * GET /api/forecast-table
 * Retorna todos os deals ativos (Vendas + Bid) com campos normalizados
 * para o novo dashboard. Mesma lógica do dash-forecast.
 */

const { setCORSHeaders, requireAuth, getHubspotToken, methodCheck } = require('./_helpers');
// Fase 2 do Dashboard 2.0: pipes/etapas vêm da camada semântica (fonte única).
const semantic = require('../lib/semantic');

const PIPELINE_ID   = semantic.PIPELINES.vendas;
const PIPELINE_2_ID = semantic.PIPELINES.bid;

const PIPELINE_LABELS = semantic.pipelineLabels();

const STAGE_MAP = semantic.stageMap();

// Ativos = mapeadas exceto Perdido (comportamento 1.0). A config global de
// etapas ativas (Fase 4b/ADR-007, KV via api/config-global) SOBREPÕE por etapa:
// etapas_ativas[id]=false tira a etapa do pipe ativo; true força inclusão.
// Sem config → lista base intacta (paridade). Cache de 60s por instância.
const ACTIVE_STAGE_IDS = semantic.activeStageIds();
const cfgStore = require('./config-global');
let _cfgCache = { at: 0, etapas: {} };
async function activeStageIdsEffective() {
  const now = Date.now();
  if (now - _cfgCache.at > 60000) {
    let etapas = {};
    try {
      etapas = cfgStore.effective(await cfgStore.readCfg()).etapas_ativas || {};
    } catch (e) { /* sem config → default */ }
    _cfgCache = { at: now, etapas };
  }
  const ov = _cfgCache.etapas;
  const base = ACTIVE_STAGE_IDS.filter(id => ov[id] !== false);
  Object.keys(ov).forEach(id => { if (ov[id] === true && !base.includes(id) && !LOST_STAGE_IDS.includes(id)) base.push(id); });
  return base;
}
// Etapas de Perdido — incluídas APENAS quando o cliente pede ?includeLost=true (ex.: CRO Dashboard).
// Os demais painéis chamam sem o parâmetro e continuam recebendo só os ativos.
// (Bid não tem etapa de perdido mapeada; closed-lost do Bid entra via hs_is_closed_lost.)
const LOST_STAGE_IDS = semantic.lostStageIds();

const PROPERTIES = [
  'dealname', 'dealstage', 'pipeline', 'hubspot_owner_id', 'sdr',
  'origem__originacao_', // origem/originação do deal (drill do modal no /forecast)
  'produto', 'quantidade_de_colaboradores', 'vidas',
  'valor_da_fatura_do_plano_de_saude_atual', 'primeira_fatura',
  'arr_estimado', 'modelo_de_remuneracao',
  // Período do contrato → nº de meses de fatura (TCV). Cadeia (decisão do dono 2026-07-15):
  // periodo_do_contrato___vg é a fonte primária; o campo legado fica de fallback enquanto
  // o novo é adotado no CRM (preenchimento 4×43 no pente-fino de 15/07).
  'periodo_do_contrato___vg',
  'contrato_atual_e_de_12__24_ou_36_meses_',
  'possui_agenciamento', 'possui_vitalicio',
  'e_poc', // booleano "É POC?" (Sim/Não) | coluna nos painéis de Forecast
  'probabilidade_de_fechamento_', 'hs_deal_stage_probability',
  'qual_quarter_de_fechamento', 'data_prevista_para_receita',
  'hs_is_closed_won', 'hs_is_closed_lost', 'hs_object_id',
  'createdate', 'closedate',
  // Datas de entrada de etapa (variante v2, populada neste portal — a v1 hs_date_entered_* vem vazia).
  // Usadas pelo P01 (Receita Ganha): data em que o deal entrou em Ganho (Vendas), com fallback p/ Implantação (Vendas).
  'hs_v2_date_entered_1144844314', // Vendas | Ganho
  'hs_v2_date_entered_1288611084', // Vendas | Implantação
  'hs_v2_date_entered_1144746911', // Vendas | Perdido
  'motivo_do_declinio_ou_perdido',
  'motivo_de_declinio_perdido___descricao', // texto aberto | justificativa do declínio (drill A15 do painel AE)
  'a_reuniao_ocorreu_',
  // Higiene de reuniões (card de Alerta no painel AE): data agendada da reunião com o executivo
  // e data do reagendamento. Diferente de data_reuniao_agendada (= entrada na ETAPA Reunião Agendada).
  'data_da_reuniao_com_executivo',
  'data_do_reagendamento_com_o_executivo',
  // Campos adicionais (preenchidos no portal, confirmados via /api/forecast-table):
  'premio_mensal',        // prêmio mensal real (vs proxy ARR/12) | ~224 deals
  'notes_last_updated',   // data da última atividade/nota | ~1144 deals
  'vigencia',             // data de vigência | usado na coluna "Vigência" do forecast novo
  'vencimento_da_1o_fatura', // data de vencimento da 1ª fatura | gate do faturamento manual (painel Ganho)
  // N08 | fórmula calculada no HubSpot: time_between(entrada em Reunião Agendada, entrada em
  // Diagnóstico), em MILISSEGUNDOS. Só existe para deals que JÁ chegaram a Diagnóstico.
  'cumulative_time_negocio_criado_ate_diagnostico_formula',
];

const CONTACT_PROPERTIES = [
  'jobtitle',
  'createdate',
  'hs_object_id',
];

const COMPANY_PROPERTIES = [
  'name',
  'domain',
  'industry',
  'numberofemployees',
  'hs_object_id',
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

// Quarter do portal → "Qx YYYY". As opções do radio qual_quarter_de_fechamento são
// "Q1".."Q4" (sem ano) e "Q1 2027".."Q4 2027"; decisão do dono (2026-07-15): todo
// Qx SEM ano significa 2026. Lixo histórico ('false'/'true'/'sem informação') → null.
const QUARTER_ANO_IMPLICITO = '2026';
function normalizeQuarter(q) {
  if (!q) return null;
  const m = String(q).trim().match(/^Q([1-4])(?:\s+(\d{4}))?$/i);
  return m ? `Q${m[1]} ${m[2] || QUARTER_ANO_IMPLICITO}` : null;
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

// Retry em 429/5xx com backoff (espelho do _hsFetchRetry de lib/hubspot.js; este
// arquivo mantém helpers HTTP próprios de propósito).
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

async function hubspotGet(token, url) {
  const res = await _hsFetchRetry(`https://api.hubapi.com${url}`, {
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
  const activeIds = await activeStageIdsEffective();
  const filterGroups = [
    { filters: [
      { propertyName: 'pipeline',  operator: 'IN', values: [PIPELINE_ID, PIPELINE_2_ID] },
      { propertyName: 'dealstage', operator: 'IN', values: activeIds },
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

function pickPrimaryAssociation(toList) {
  const list = Array.isArray(toList) ? toList : [];
  if (!list.length) return null;
  const primary = list.find(item => {
    const types = item.associationTypes || [];
    return types.some(t => String(t.label || '').toLowerCase() === 'primary');
  });
  return String((primary || list[0]).toObjectId || '');
}

async function fetchDealAssociationMap(token, dealIds, toType, errors) {
  const map = {};
  for (let i = 0; i < dealIds.length; i += 100) {
    const batch = dealIds.slice(i, i + 100);
    try {
      const resp = await hubspotPost(token, `/crm/v4/associations/deals/${toType}/batch/read`, {
        inputs: batch.map(id => ({ id: String(id) }))
      });
      (resp.results || []).forEach(r => {
        const dealId = String(r.from?.id || '');
        const assocId = pickPrimaryAssociation(r.to);
        if (dealId && assocId) map[dealId] = assocId;
      });
    } catch (e) {
      console.error(`[forecast-table] association ${toType} unavailable:`, e.message);
      if (errors) errors.push(`association:${toType}`);
    }
  }
  return map;
}

async function batchReadObjects(token, objectType, ids, properties, errors) {
  const uniqueIds = [...new Set((ids || []).filter(Boolean).map(String))];
  const map = {};
  for (let i = 0; i < uniqueIds.length; i += 100) {
    const chunk = uniqueIds.slice(i, i + 100);
    try {
      const resp = await hubspotPost(token, `/crm/v3/objects/${objectType}/batch/read`, {
        properties,
        inputs: chunk.map(id => ({ id: String(id) }))
      });
      (resp.results || []).forEach(r => { map[String(r.id)] = r.properties || {}; });
    } catch (e) {
      console.error(`[forecast-table] batch read ${objectType} unavailable:`, e.message);
      if (errors) errors.push(`batch:${objectType}`);
    }
  }
  return map;
}

async function fetchDealContext(token, rawDeals) {
  const errors = [];
  const dealIds = rawDeals.map(r => String(r.id || r.properties?.hs_object_id || '')).filter(Boolean);
  const [dealContact, dealCompany] = await Promise.all([
    fetchDealAssociationMap(token, dealIds, 'contacts', errors),
    fetchDealAssociationMap(token, dealIds, 'companies', errors),
  ]);
  const [contacts, companies] = await Promise.all([
    batchReadObjects(token, 'contacts', Object.values(dealContact), CONTACT_PROPERTIES, errors),
    batchReadObjects(token, 'companies', Object.values(dealCompany), COMPANY_PROPERTIES, errors),
  ]);
  const out = {};
  dealIds.forEach(dealId => {
    const contactId = dealContact[dealId];
    const companyId = dealCompany[dealId];
    out[dealId] = {
      contact_id: contactId || null,
      contact: contactId ? (contacts[contactId] || {}) : {},
      company_id: companyId || null,
      company: companyId ? (companies[companyId] || {}) : {},
    };
  });
  return { byDeal: out, errors, contacts: Object.keys(contacts).length, companies: Object.keys(companies).length };
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
  const includeContext = !!(req.query && (String(req.query.includeContext) === 'true' || String(req.query.includeAssociations) === 'true'));

  try {
    const [rawDeals, ownerMap] = await Promise.all([fetchDeals(token, includeLost), fetchOwners(token)]);
    const contextResult = includeContext ? await fetchDealContext(token, rawDeals) : { byDeal: {}, errors: [], contacts: 0, companies: 0 };
    const dealContext = contextResult.byDeal || {};

    const deals = rawDeals
      .filter(r => includeLost || r.properties.hs_is_closed_lost !== 'true')
      .map(r => {
        const p = r.properties;
        const ctx = dealContext[String(r.id || p.hs_object_id || '')] || {};
        const contact = ctx.contact || {};
        const company = ctx.company || {};
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

        // O campo do AE tem precedência; a data prevista só entra quando o campo está vazio/inválido.
        let quarter = normalizeQuarter(p.qual_quarter_de_fechamento);
        if (!quarter) quarter = getQuarterFromDate(dateStr) || null;

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
          periodo_contrato: p.periodo_do_contrato___vg || p.contrato_atual_e_de_12__24_ou_36_meses_ || null,
          possui_agenciamento: normalizeBool(p.possui_agenciamento),
          possui_vitalicio: normalizeBool(p.possui_vitalicio),
          is_poc: normalizeBool(p.e_poc),
          probabilidade: prob,
          quarter,
          data_prevista_para_receita: dateStr,
          close_date: p.closedate ? p.closedate.substring(0, 10) : null,
          data_ganho: p.hs_v2_date_entered_1144844314 ? p.hs_v2_date_entered_1144844314.substring(0, 10) : null,
          data_implantacao: p.hs_v2_date_entered_1288611084 ? p.hs_v2_date_entered_1288611084.substring(0, 10) : null,
          // Data de entrada na etapa Perdido (Vendas). Usada pelo painel BDR (R07/R08) para contar as
          // saídas por perda pela data de entrada na etapa, não por closedate. Só vem com ?includeLost=true.
          data_perdido: p.hs_v2_date_entered_1144746911 ? p.hs_v2_date_entered_1144746911.substring(0, 10) : null,
          // Data de entrada na etapa Reunião Agendada (Vendas). É o evento real de "BDR marcou reunião",
          // usado pelo painel BDR no lugar de createdate (que é distorcido por importações em massa).
          data_reuniao_agendada: p.hs_v2_date_entered_1144746905 ? p.hs_v2_date_entered_1144746905.substring(0, 10) : null,
          reuniao_ocorreu: p.a_reuniao_ocorreu_ || null,
          // Higiene de reuniões (card de Alerta | painel AE). data_reuniao_exec = data agendada com o
          // executivo; data_reagendamento_exec = data do reagendamento. Ambas yyyy-mm-dd via substring(0,10).
          data_reuniao_exec: p.data_da_reuniao_com_executivo ? p.data_da_reuniao_com_executivo.substring(0, 10) : null,
          data_reagendamento_exec: p.data_do_reagendamento_com_o_executivo ? p.data_do_reagendamento_com_o_executivo.substring(0, 10) : null,
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
          contact_id: ctx.contact_id || null,
          contact_jobtitle: contact.jobtitle || null,
          persona_source: contact.jobtitle ? 'contact.jobtitle' : null,
          company_id: ctx.company_id || null,
          company_name: company.name || null,
          company_industry: company.industry || null,
          company_domain: company.domain || null,
          company_employees: company.numberofemployees ? parseInt(company.numberofemployees) : null,
          company_segment: company.industry || null,
        };
      });

    return res.status(200).json({
      success: true,
      deals,
      total: deals.length,
      pipelines: { vendas: deals.filter(d => d.pipeline === 'Vendas').length, bid: deals.filter(d => d.pipeline === 'Bid').length },
      context: includeContext ? { requested: true, errors_count: contextResult.errors.length, contacts: contextResult.contacts, companies: contextResult.companies } : { requested: false },
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[forecast-table]', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
};
