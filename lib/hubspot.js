'use strict';
/**
 * hubspot.js — Funções HubSpot extraídas do main.js Electron
 * Convertidas de https.request nativo para fetch (Node 18+)
 *
 * NUNCA hardcoda tokens — recebe token como parâmetro ou lê de process.env.HUBSPOT_TOKEN
 */

// ===== CONSTANTES =====
// Fase 2 do Dashboard 2.0: pipes/etapas vêm da camada semântica (fonte única).
const semantic = require('./semantic');

const HUBSPOT_PIPELINE = semantic.PIPELINES.vendas;  // Pipeline de Vendas
const BID_PIPELINE     = semantic.PIPELINES.bid;     // Pipeline BID

// Data mínima de criação de deals buscados — alinha com filtro do HubSpot (01/09/2025).
// Epoch ms: new Date('2025-09-01T00:00:00Z').getTime()
const DEALS_SINCE_MS = '1756684800000';

// NEEDS_ADJUSTMENT(C02): AE_NAMES e STAGE_MAP são hardcoded. Quando um AE entra/sai
// ou um stage muda no HubSpot, é preciso editar aqui e fazer deploy.
// Considerar: buscar dinamicamente do HubSpot ou mover para config file.

// Etapas Vendas (da camada semântica; nomes canônicos, 'Stand by' com espaço)
const VENDAS_STAGE_MAP = semantic.stageMap({ pipeline: 'vendas' });
// Etapas BID (IDs diferentes, nomes sobrepostos). Este consumidor nunca mapeou
// a Reunião Pré-RFP — exclusão histórica preservada (paridade Fase 2).
const BID_STAGE_MAP_LIB = semantic.stageMap({ pipeline: 'bid', exclude: ['1349620551'] });
// Mapa combinado para resolução de nomes (Vendas + BID)
const STAGE_MAP = Object.assign({}, VENDAS_STAGE_MAP, BID_STAGE_MAP_LIB);
// Apenas IDs Vendas para hs_date_entered_* (BID não rastreia essas props)
const STAGE_IDS = Object.keys(VENDAS_STAGE_MAP);

// NEEDS_ADJUSTMENT(C02): Lista estática de AEs. Editar manualmente quando alguém entra/sai.
// Ideal: buscar do HubSpot owners API filtrando por role, ou mover para config file.
const AE_NAMES = [
  'Mariana Assis', 'Peterson Venancio', 'Fernando Siqueira', 'Juliana Dalberto',
  'Rafael Leite', 'André Pontes', 'Andre Pontes', 'Fausto Haderspeck',
  'Guilherme Gabiatti', 'Fernando Henrique'
];

// ===== OWNER CACHE (em memória, por instância serverless) =====
// TODO(C08): Cache de 5 min por instância. Vercel pode ter múltiplas instâncias,
// cada uma com seu próprio cache. Owner novo pode não aparecer em todas as instâncias.
// Trade-off aceitável (owners mudam raramente), mas pode confundir durante onboarding.
let ownerCache = null;
let ownerCacheTime = 0;

// ===== HELPERS HTTP =====

// Retry com backoff em 429/5xx (Retry-After respeitado; até 3 retries, ~7s de espera
// acumulada no pior caso). Motivo (2026-07-10): o load da página dispara
// forecast-table + bdr-leads + list-attack na MESMA cota do private app compartilhado;
// um 429 transitório era fatal e derrubava o painel inteiro.
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
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000)
  });

  if (res.status === 429) throw new Error('HubSpot rate limit exceeded. Aguarde alguns minutos.');
  // 401 ≠ 403: 403 é falta de ESCOPO no private app (token válido), não token inválido.
  if (res.status === 401) throw new Error('HubSpot: autenticação falhou (401). Verifique o token.');
  if (res.status === 403) throw new Error('HubSpot: acesso negado (403) em ' + endpoint + ' | o token não tem os escopos necessários para esta chamada. Conceda os escopos no private app do portal.');
  if (res.status >= 400) throw new Error(`HubSpot API error (HTTP ${res.status})`);

  const json = await res.json();
  if (json.status === 'error' || json.message) throw new Error(json.message || 'HubSpot API error');
  return json;
}

async function hubspotGet(token, endpoint) {
  const res = await _hsFetchRetry(`https://api.hubapi.com${endpoint}`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` },
    signal: AbortSignal.timeout(30000)
  });

  if (res.status === 429) throw new Error('HubSpot rate limit exceeded.');
  if (res.status === 401) throw new Error('HubSpot: autenticação falhou (401). Verifique o token.');
  if (res.status === 403) throw new Error('HubSpot: acesso negado (403) em ' + endpoint + ' | o token não tem os escopos necessários para esta chamada. Conceda os escopos no private app do portal.');
  if (res.status >= 400) throw new Error(`HubSpot API error (HTTP ${res.status})`);

  return res.json();
}

// ===== OWNER UTILS =====

// NEEDS_ADJUSTMENT(C01): Mapeamento hardcoded de nomes com if/else chain.
// Problemas conhecidos:
//   - "Fernando Siqueira" e "Fernando Henrique" mapeiam para o mesmo nome
//   - Qualquer novo colaborador exige edição de código + deploy
// Ideal: extrair para owner-mapping.json ou resolver via HubSpot owner ID.
function cleanOwnerName(fullName) {
  if (!fullName || /^\d+$/.test(fullName)) return fullName;
  const lower = fullName.toLowerCase();
  if (lower.includes('mariana') && lower.includes('assis')) return 'Mariana Assis';
  if (lower.includes('peterson') && lower.includes('venancio')) return 'Peterson Venancio';
  // NEEDS_ADJUSTMENT(C01): Esta linha mapeia QUALQUER Fernando com "siqueira" OU "henrique"
  // para "Fernando Henrique". Se houver dois Fernandos distintos, ambos viram o mesmo nome.
  if (lower.includes('fernando') && (lower.includes('siqueira') || lower.includes('henrique'))) return 'Fernando Henrique';
  if (lower.includes('juliana') && lower.includes('dalberto')) return 'Juliana Dalberto';
  if (lower.includes('rafael') && lower.includes('leite')) return 'Rafael Leite';
  if ((lower.includes('andré') || lower.includes('andre')) && lower.includes('pontes')) return 'André Pontes';
  if (lower.includes('fausto') && lower.includes('haderspeck')) return 'Fausto Haderspeck';
  if (lower.includes('guilherme') && lower.includes('gabiatti')) return 'Guilherme Gabiatti';
  if (lower.includes('gabriele') && lower.includes('almeida')) return 'Gabriele Almeida';
  if (lower.includes('priscilla') && lower.includes('feliciello')) return 'Priscilla Feliciello';
  if (lower.includes('anderson')) return 'Anderson';
  if (lower.includes('gabriel') && !lower.includes('gabriele')) return 'Gabriel';
  if (lower.includes('beatriz')) return 'Beatriz';
  if (lower.includes('cíntia') || lower.includes('cintia')) return 'Cíntia';
  const parts = fullName.trim().split(/\s+/);
  return parts.length > 2 ? parts[0] + ' ' + parts[1] : fullName;
}

async function fetchOwners(token) {
  if (ownerCache && (Date.now() - ownerCacheTime) < 5 * 60 * 1000) {
    return ownerCache;
  }

  const map = {};
  let after;
  let hasMore = true;
  while (hasMore) {
    const url = '/crm/v3/owners?limit=200' + (after ? '&after=' + after : '');
    const response = await hubspotGet(token, url);
    (response.results || []).forEach(o => {
      const raw = `${o.firstName || ''} ${o.lastName || ''}`.trim() || o.email || o.id;
      map[o.id] = cleanOwnerName(raw);
    });
    hasMore = response.paging?.next?.after != null;
    after = response.paging?.next?.after;
  }

  ownerCache = map;
  ownerCacheTime = Date.now();
  return map;
}

// ===== DEALS =====

async function fetchAllDeals(token) {
  const stageEnteredProps = STAGE_IDS.map(id => `hs_date_entered_${id}`);
  const stageExitedProps = STAGE_IDS.map(id => `hs_date_exited_${id}`);
  const properties = [
    'dealname', 'dealstage', 'vidas', 'premio_mensal', 'valor_fatura_estimada', 'pipeline',
    'sdr', 'hubspot_owner_id', 'createdate', 'closedate',
    'motivo_do_declinio_ou_perdido',
    'a_reuniao_ocorreu_', 'notes_last_updated', 'ls_days_in_stage',
    'hs_object_id', 'hs_is_closed_won', 'hs_is_closed_lost',
    'tipo_de_negociacao', 'receita_vitalicio_estimada',
    'primeira_fatura', 'possui_agenciamento',
    'agenciamento', 'valor_agenciamento__primeiro_mes_',
    'valor_agenciamento__proximos_11_meses_',
    'modelo_de_remuneracao',
    'probabilidade_de_fechamento_', 'hs_deal_stage_probability',
    ...stageEnteredProps, ...stageExitedProps
  ];

  let allResults = [];
  let after = 0;
  let hasMore = true;

  while (hasMore) {
    const body = {
      filterGroups: [{ filters: [
        { propertyName: 'pipeline',   operator: 'IN',  values: [HUBSPOT_PIPELINE, BID_PIPELINE] },
        { propertyName: 'createdate', operator: 'GTE', value:  DEALS_SINCE_MS },
      ]}],
      properties,
      limit: 200,
      after
    };
    const response = await hubspotPost(token, '/crm/v3/objects/deals/search', body);
    allResults = allResults.concat(response.results || []);
    hasMore = response.paging?.next?.after != null;
    after = response.paging?.next?.after || 0;
  }

  return allResults;
}

async function pullHubSpotData(token) {
  const [rawDeals, ownerMap] = await Promise.all([
    fetchAllDeals(token),
    fetchOwners(token)
  ]);

  const vidasHistory = {};
  const premioHistory = {};
  const ownerChanges = {};
  const meetingStatusHistory = {};
  const stageHistoryByDeal = {}; // hs_id -> [{stage, stage_id, entered, entered_date, exited, exited_date}]
  const hsIds = rawDeals.map(r => r.properties.hs_object_id).filter(Boolean);

  // batch/read with propertiesWithHistory caps at 50 inputs per call.
  for (let batch = 0; batch < hsIds.length; batch += 50) {
    const batchIds = hsIds.slice(batch, batch + 50);
    try {
      const histResp = await hubspotPost(token, '/crm/v3/objects/deals/batch/read', {
        properties: ['vidas', 'premio_mensal', 'hubspot_owner_id', 'a_reuniao_ocorreu_', 'dealstage'],
        propertiesWithHistory: ['vidas', 'premio_mensal', 'hubspot_owner_id', 'a_reuniao_ocorreu_', 'dealstage'],
        inputs: batchIds.map(id => ({ id: String(id) }))
      });
      (histResp.results || []).forEach(r => {
        const vidasHist = r.propertiesWithHistory?.vidas;
        if (vidasHist && vidasHist.length > 0) {
          const sorted = vidasHist.slice().sort((a, b) => a.timestamp < b.timestamp ? -1 : 1);
          const firstFilled = sorted.find(h => h.value && parseInt(h.value) > 0);
          if (firstFilled) vidasHistory[r.id] = firstFilled.timestamp.substring(0, 10);
        }

        const premioHist = r.propertiesWithHistory?.premio_mensal;
        if (premioHist && premioHist.length > 0) {
          const sorted = premioHist.slice().sort((a, b) => a.timestamp < b.timestamp ? -1 : 1);
          const firstFilled = sorted.find(h => h.value && parseFloat(h.value) > 0);
          if (firstFilled) premioHistory[r.id] = firstFilled.timestamp.substring(0, 10);
        }

        const ownerHist = r.propertiesWithHistory?.hubspot_owner_id;
        if (ownerHist && ownerHist.length > 1) {
          const sorted = ownerHist.slice().sort((a, b) => a.timestamp < b.timestamp ? -1 : 1);
          const changes = [];
          for (let j = 1; j < sorted.length; j++) {
            changes.push({
              from: sorted[j - 1].value || null,
              to: sorted[j].value || null,
              date: sorted[j].timestamp.substring(0, 10)
            });
          }
          if (changes.length > 0) ownerChanges[r.id] = changes;
        }

        const meetingHist = r.propertiesWithHistory?.a_reuniao_ocorreu_;
        if (meetingHist && meetingHist.length > 0) {
          const sorted = meetingHist.slice().sort((a, b) => a.timestamp < b.timestamp ? -1 : 1);
          const firstSim = sorted.find(h => h.value === 'Sim');
          if (firstSim) meetingStatusHistory[r.id] = firstSim.timestamp.substring(0, 10);
        }

        // Build stage_history from dealstage property history — HubSpot's
        // hs_date_entered_<stageId> fields are not populated on this pipeline,
        // so this is the only source of truth for stage progression.
        const stageHist = r.propertiesWithHistory?.dealstage;
        if (stageHist && stageHist.length > 0) {
          const sorted = stageHist.slice().sort((a, b) => a.timestamp < b.timestamp ? -1 : 1);
          const events = sorted.map(h => ({
            stage_id: h.value,
            stage: STAGE_MAP[h.value] || h.value,
            entered: h.timestamp.substring(0, 19),
            entered_date: h.timestamp.substring(0, 10)
          }));
          for (let j = 0; j < events.length; j++) {
            const next = events[j + 1];
            events[j].exited = next ? next.entered : null;
            events[j].exited_date = next ? next.entered_date : null;
          }
          stageHistoryByDeal[r.id] = events;
        }
      });
    } catch (e) {
      console.error('Property history batch failed:', e.message);
    }
  }

  const deals = rawDeals.map((r, i) => {
    const p = r.properties;
    const stageId = p.dealstage;
    const stage = STAGE_MAP[stageId] || stageId;

    let status = 'open';
    if (p.hs_is_closed_won === 'true') status = 'won';
    else if (p.hs_is_closed_lost === 'true') status = 'lost';

    const ownerName = ownerMap[p.hubspot_owner_id] || p.hubspot_owner_id;
    const bdrRaw = p.sdr || null;
    const bdrName = bdrRaw && ownerMap[bdrRaw] ? ownerMap[bdrRaw] : bdrRaw;

    let name = (p.dealname || 'Unknown')
      .replace(/ - Novo\(a\) Deal$/i, '')
      .replace(/ - New Deal$/i, '')
      .trim();

    // Prefer the dealstage property-history (every transition, including into
    // Perdido). Fall back to hs_date_entered_<sid> only if dealstage history
    // was unavailable for this deal — that legacy path produces an empty list
    // on this pipeline since those props aren't tracked.
    let stageHistory = stageHistoryByDeal[p.hs_object_id];
    if (!stageHistory || stageHistory.length === 0) {
      stageHistory = [];
      for (const sid of STAGE_IDS) {
        const entered = p[`hs_date_entered_${sid}`];
        const exited = p[`hs_date_exited_${sid}`];
        if (entered) {
          stageHistory.push({
            stage: STAGE_MAP[sid] || sid,
            stage_id: sid,
            entered: entered.substring(0, 19),
            entered_date: entered.substring(0, 10),
            exited: exited ? exited.substring(0, 19) : null,
            exited_date: exited ? exited.substring(0, 10) : null
          });
        }
      }
      stageHistory.sort((a, b) => a.entered < b.entered ? -1 : 1);
    }

    return {
      id: i + 1,
      hs_id: p.hs_object_id,
      name,
      // NEEDS_ADJUSTMENT(C04): parseInt pode retornar NaN se vidas contém texto (ex: "N/A").
      // Ideal: const v = parseInt(p.vidas); vidas: isNaN(v) ? 0 : v
      vidas: p.vidas ? parseInt(p.vidas) : 0,
      // Revenue PM: prefer the HubSpot `Primeira Fatura` property (primeira_fatura).
      // Fall back to `valor_fatura_estimada` then `premio_mensal` for legacy deals
      // that haven't had the Primeira Fatura field filled yet.
      premio: (function(){
        var pf = parseFloat(p.primeira_fatura);
        if (!isNaN(pf) && pf > 0) return pf;
        var vfe = parseFloat(p.valor_fatura_estimada);
        if (!isNaN(vfe) && vfe > 0) return vfe;
        var pm = parseFloat(p.premio_mensal);
        return isNaN(pm) ? null : pm;
      })(),
      stage,
      status,
      // NEEDS_ADJUSTMENT(C03): Se campo `sdr` tem qualquer valor, deal é marcado como BDR-sourced.
      // Não valida se o SDR é realmente um BDR ativo. Pode contar deals incorretamente.
      source: bdrRaw ? 'bdr' : 'ae',
      bdr: bdrName,
      ae: ownerName,
      created: p.createdate ? p.createdate.substring(0, 7) : null,
      created_date: p.createdate ? p.createdate.substring(0, 10) : null,
      lost_reason: p.motivo_do_declinio_ou_perdido || null,
      last_activity: p.notes_last_updated ? p.notes_last_updated.substring(0, 10) : null,
      // NEEDS_ADJUSTMENT(C06): ls_days_in_stage é propriedade calculada do HubSpot com possível delay.
      // Para maior precisão, calcular server-side a partir de stage_history (hs_date_entered_*).
      days_in_stage: p.ls_days_in_stage ? parseInt(p.ls_days_in_stage) : null,
      meeting: p.a_reuniao_ocorreu_ || null,
      close_date: p.closedate ? p.closedate.substring(0, 10) : null,
      stage_history: stageHistory,
      vidas_filled_date: vidasHistory[p.hs_object_id] || null,
      premio_filled_date: premioHistory[p.hs_object_id] || null,
      owner_changes: ownerChanges[p.hs_object_id] || [],
      meeting_status_date: meetingStatusHistory[p.hs_object_id] || null,
      tipo_negociacao: p.tipo_de_negociacao || null,
      modelo_remuneracao: p.modelo_de_remuneracao || null,
      primeira_fatura_num: (function(){ var n = parseFloat(p.primeira_fatura); return isNaN(n) ? null : n; })(),
      // Closing probability (0-1). Prefer the AE-set custom field; fall back
      // to HubSpot's stage-default. AEs leave the custom field empty for many
      // deals — the stage default is always populated.
      prob_fechamento: (function(){
        var c = parseFloat(p.probabilidade_de_fechamento_);
        if (!isNaN(c) && c >= 0) return c;
        var s = parseFloat(p.hs_deal_stage_probability);
        return isNaN(s) ? null : s;
      })(),
      receita_vitalicio_estimada: p.receita_vitalicio_estimada ? parseFloat(p.receita_vitalicio_estimada) : null,
      // Agenciamento detection — AEs encode this inconsistently in HubSpot:
      //   - possui_agenciamento (boolean): set on only ~14% of won deals (2025-08+)
      //   - agenciamento (number): months-multiplier on Premio Mensal (3 = 3×PM,
      //     4 = 4×PM, 0.02 = 2%-style entry — not consistent, so treat any > 0
      //     as a positive signal but DON'T trust the magnitude as the multiplier
      //   - valor_agenciamento__proximos_11_meses_: HubSpot calculation_equation
      //     field that fires only when monthly agenciamento > 0 — most reliable
      //     single signal (set on 7/7 won deals in Pipeline de Vendas - 2025).
      // We OR these so any positive evidence flips possui_agenciamento to true.
      possui_agenciamento: (function(){
        var b = (p.possui_agenciamento || '').toString().trim().toLowerCase();
        if (b === 'sim' || b === 'yes' || b === 'true') return true;
        var ag = parseFloat(p.agenciamento);
        if (!isNaN(ag) && ag > 0) return true;
        var v1 = parseFloat(p.valor_agenciamento__primeiro_mes_);
        if (!isNaN(v1) && v1 > 0) return true;
        var v11 = parseFloat(p.valor_agenciamento__proximos_11_meses_);
        if (!isNaN(v11) && v11 > 0) return true;
        if (b === 'não' || b === 'nao' || b === 'no' || b === 'false') return false;
        return null;
      })()
    };
  });

  return { deals, total: deals.length, timestamp: new Date().toISOString() };
}

// ===== CS DATA =====

// NEEDS_ADJUSTMENT(C07): Filtra empresas CS apenas por `kam_responsavel HAS_PROPERTY`.
// Empresas inativas ou prospects com KAM preenchido aparecem no dashboard CS.
// Ideal: adicionar filtro por ativo_ou_inativo_ = "Ativo" e/ou lifecyclestage = "customer".
async function fetchCSCompanies(token) {
  const properties = [
    'name', 'kam_responsavel', 'vigencia_do_contrato_atual', 'aniversario_apolice_1', 'vidas', 'premio_mensal',
    'contrato_atual', 'segmento', 'hs_csm_sentiment', 'taxa_de_agenciamento',
    'hubspot_owner_id', 'maturidade_em_saude', 'foco_estrategico_sugerido',
    'annualrevenue', 'vitalicio_ou_comissionamento', 'hs_lastmodifieddate',
    'num_associated_deals', 'num_associated_contacts', 'ativo_ou_inativo_',
    'analista_ops_responsavel', 'lifecyclestage', 'company_data_inicio_cliente',
    'data_de_inativacao', 'beneficio_axenya', 'operadora_atual',
    'empresa_totalmente_migrada_implantada_', 'company_estado',
    'notes_last_updated', 'notes_last_contacted', 'num_contacted_notes',
    'hs_last_sales_activity_timestamp', 'hs_last_logged_call_date',
    'hs_last_booked_meeting_date', 'engagements_last_meeting_booked',
    'hs_num_open_deals', 'recent_deal_close_date', 'hs_last_open_task_date',
    'hs_object_id', 'domain'
  ];

  let allResults = [];
  let after = 0;
  let hasMore = true;

  while (hasMore) {
    const body = {
      filterGroups: [{ filters: [{ propertyName: 'kam_responsavel', operator: 'HAS_PROPERTY' }] }],
      properties,
      sorts: [{ propertyName: 'name', direction: 'ASCENDING' }],
      limit: 200,
      after
    };
    const response = await hubspotPost(token, '/crm/v3/objects/companies/search', body);
    allResults = allResults.concat((response.results || []).map(r => r.properties));
    hasMore = response.paging?.next?.after != null;
    after = response.paging?.next?.after || 0;
  }

  return allResults;
}

async function fetchVigenciaDeals(token) {
  const properties = [
    'dealname', 'dealstage', 'pipeline', 'amount', 'vidas', 'premio_mensal',
    'hubspot_owner_id', 'closedate', 'createdate', 'vigencia', 'data_de_renovacao',
    'agenciamento', 'valor_agenciamento__proximos_11_meses_',
    'contrato_atual_e_de_12__24_ou_36_meses_', 'mes_do_aniversario_do_contrato___saude',
    'comissao', 'hs_is_closed_won', 'hs_is_closed_lost', 'base_de_vidas___vg',
    'hs_lastmodifieddate', 'notes_last_updated', 'hs_object_id'
  ];

  let allResults = [];
  let after = 0;
  let hasMore = true;

  while (hasMore) {
    const body = {
      filterGroups: [{ filters: [
        { propertyName: 'vigencia', operator: 'HAS_PROPERTY' },
        { propertyName: 'pipeline', operator: 'NEQ', value: HUBSPOT_PIPELINE }
      ] }],
      properties,
      sorts: [{ propertyName: 'vigencia', direction: 'ASCENDING' }],
      limit: 200,
      after
    };
    const response = await hubspotPost(token, '/crm/v3/objects/deals/search', body);
    allResults = allResults.concat((response.results || []).map(r => r.properties));
    hasMore = response.paging?.next?.after != null;
    after = response.paging?.next?.after || 0;
  }

  return allResults;
}

async function pullCSData(token) {
  const [companies, vigenciaDeals, ownerMap] = await Promise.all([
    fetchCSCompanies(token),
    fetchVigenciaDeals(token),
    fetchOwners(token)
  ]);

  const companyIds = companies.map(c => c.hs_object_id).filter(Boolean);
  const companyDealMap = {};

  for (let i = 0; i < companyIds.length; i += 100) {
    const batch = companyIds.slice(i, i + 100);
    try {
      const assocResp = await hubspotPost(token, '/crm/v4/associations/companies/deals/batch/read', {
        inputs: batch.map(id => ({ id: String(id) }))
      });
      (assocResp.results || []).forEach(r => {
        const companyId = r.from?.id;
        const dealIds = (r.to || []).map(t => t.toObjectId);
        if (companyId && dealIds.length > 0) companyDealMap[companyId] = dealIds;
      });
    } catch (e) {
      console.error('[CS] Failed to fetch company-deal associations batch:', e.message);
    }
  }

  const allDealIds = [...new Set(Object.values(companyDealMap).flat())];
  const dealPropsMap = {};
  const dealProperties = [
    'dealname', 'dealstage', 'pipeline', 'amount', 'vidas', 'premio_mensal',
    'hubspot_owner_id', 'closedate', 'createdate', 'vigencia', 'data_de_renovacao',
    'hs_is_closed_won', 'hs_is_closed_lost', 'hs_object_id',
    'sdr', 'notes_last_updated', 'hs_lastmodifieddate',
    'notes_last_contacted', 'num_contacted_notes',
    'hs_last_sales_activity_timestamp'
  ];

  for (let i = 0; i < allDealIds.length; i += 100) {
    const chunk = allDealIds.slice(i, i + 100);
    try {
      const batchResp = await hubspotPost(token, '/crm/v3/objects/deals/batch/read', {
        properties: dealProperties,
        inputs: chunk.map(id => ({ id: String(id) }))
      });
      (batchResp.results || []).forEach(r => {
        const p = r.properties || {};
        p.ownerName = ownerMap[p.hubspot_owner_id] || p.hubspot_owner_id || '-';
        dealPropsMap[p.hs_object_id || r.id] = p;
      });
    } catch (e) {
      console.error('[CS] Failed to batch-read deals:', e.message);
    }
  }

  companies.forEach(c => {
    const cid = c.hs_object_id;
    const dealIds = companyDealMap[cid] || [];
    const deals = dealIds.map(id => dealPropsMap[id]).filter(Boolean);
    c._associated_deals = deals;
    c._deal_count = deals.length;
    c._open_deal_count = deals.filter(d => d.hs_is_closed_won !== 'true' && d.hs_is_closed_lost !== 'true').length;
    c._won_deal_count = deals.filter(d => d.hs_is_closed_won === 'true').length;
    c._lost_deal_count = deals.filter(d => d.hs_is_closed_lost === 'true').length;
    const latestDealContact = deals.reduce((latest, d) => {
      const candidates = [d.notes_last_contacted, d.hs_last_sales_activity_timestamp, d.notes_last_updated, d.createdate].filter(Boolean);
      candidates.forEach(dt => { if (!latest || dt > latest) latest = dt; });
      return latest;
    }, null);
    c._latest_deal_activity = latestDealContact;
    c._has_engagement = deals.length > 0 || !!c.notes_last_contacted;
  });

  return {
    companies,
    vigencia_deals: vigenciaDeals,
    owners: { ...ownerMap },
    total_companies: companies.length,
    total_deals: vigenciaDeals.length,
    timestamp: new Date().toISOString()
  };
}

// ===== ACTIVITIES =====

async function _fetchEngagements(token, objectType, hsId, engagementTypes) {
  const ownerMap = await fetchOwners(token);
  const activities = [];

  await Promise.all(engagementTypes.map(async (eng) => {
    try {
      const assocResp = await hubspotGet(token, `/crm/v3/objects/${objectType}/${hsId}/associations/${eng.type}?limit=50`);
      const ids = (assocResp.results || []).map(r => r.toObjectId || r.id).filter(Boolean);
      if (ids.length === 0) return;

      const batchResp = await hubspotPost(token, `/crm/v3/objects/${eng.type}/batch/read`, {
        properties: eng.props,
        inputs: ids.map(id => ({ id: String(id) }))
      });

      (batchResp.results || []).forEach(r => {
        const p = r.properties || {};
        const ts = p.hs_timestamp || r.createdAt;
        const owner = ownerMap[p.hubspot_owner_id] || null;
        let title = '', body = '';

        if (eng.type === 'notes') { body = p.hs_note_body || ''; }
        else if (eng.type === 'emails') { title = p.hs_email_subject || ''; body = p.hs_email_text || ''; }
        else if (eng.type === 'calls') { title = p.hs_call_title || ''; body = p.hs_call_body || ''; }
        else if (eng.type === 'meetings') { title = p.hs_meeting_title || ''; body = p.hs_meeting_body || ''; }

        body = body.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
        if (body.length > 300) body = body.substring(0, 300) + '…';

        activities.push({ type: eng.label, timestamp: ts, date: ts ? ts.substring(0, 10) : null, owner, title, body });
      });
    } catch (e) {
      console.error(`Failed to fetch ${eng.type} for ${objectType}/${hsId}:`, e.message);
    }
  }));

  activities.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  return activities.slice(0, 20);
}

const ENGAGEMENT_TYPES = [
  { type: 'notes', label: 'Note', props: ['hs_note_body', 'hs_timestamp', 'hubspot_owner_id'] },
  { type: 'emails', label: 'Email', props: ['hs_email_subject', 'hs_email_text', 'hs_timestamp', 'hubspot_owner_id'] },
  { type: 'calls', label: 'Call', props: ['hs_call_title', 'hs_call_body', 'hs_timestamp', 'hs_call_duration', 'hubspot_owner_id'] },
  { type: 'meetings', label: 'Meeting', props: ['hs_meeting_title', 'hs_meeting_body', 'hs_timestamp', 'hubspot_owner_id'] }
];

async function fetchDealActivities(token, hsId) {
  return _fetchEngagements(token, 'deals', hsId, ENGAGEMENT_TYPES);
}

async function fetchCompanyActivities(token, hsId) {
  return _fetchEngagements(token, 'companies', hsId, ENGAGEMENT_TYPES);
}

async function fetchCompanyDeals(token, companyHsId) {
  const assocResp = await hubspotGet(token, `/crm/v3/objects/companies/${companyHsId}/associations/deals?limit=500`);
  const dealIds = (assocResp.results || []).map(r => r.toObjectId || r.id).filter(Boolean);
  if (dealIds.length === 0) return [];

  const properties = [
    'dealname', 'dealstage', 'pipeline', 'amount', 'vidas', 'premio_mensal',
    'hubspot_owner_id', 'closedate', 'createdate', 'vigencia', 'data_de_renovacao',
    'hs_is_closed_won', 'hs_is_closed_lost', 'hs_object_id',
    'sdr', 'notes_last_updated', 'hs_lastmodifieddate'
  ];

  const ownerMap = await fetchOwners(token);
  const allDeals = [];
  for (let i = 0; i < dealIds.length; i += 100) {
    const chunk = dealIds.slice(i, i + 100);
    const batchResp = await hubspotPost(token, '/crm/v3/objects/deals/batch/read', {
      properties,
      inputs: chunk.map(id => ({ id: String(id) }))
    });
    (batchResp.results || []).forEach(r => {
      const p = r.properties || {};
      allDeals.push({ ...p, ownerName: ownerMap[p.hubspot_owner_id] || p.hubspot_owner_id || '-' });
    });
  }

  allDeals.sort((a, b) => (b.createdate || '').localeCompare(a.createdate || ''));
  return allDeals;
}

// ===== COTAÇÃO TICKETS =====

async function fetchCotacaoTickets(token) {
  // Da camada semântica; inclui 3 etapas removidas do portal que este fluxo
  // ainda consulta (registradas em referencia.tickets_cotacao, limpeza candidata).
  const COTACAO_PIPELINE = semantic.ticketPipelineId();
  const stageIds = semantic.ticketStageIds();
  const datePropEnter = stageIds.map(id => 'hs_date_entered_' + id);
  const datePropExit = stageIds.map(id => 'hs_date_exited_' + id);

  const properties = [
    'subject', 'content', 'hs_pipeline', 'hs_pipeline_stage', 'hs_ticket_priority',
    'hubspot_owner_id', 'createdate', 'closed_date', 'hs_lastmodifieddate',
    'hs_object_id', 'hs_num_associated_companies',
    'source_type', 'hs_ticket_category',
    ...datePropEnter, ...datePropExit
  ];

  let allResults = [];
  let after = 0;
  let hasMore = true;

  while (hasMore) {
    const body = {
      filterGroups: [{ filters: [{ propertyName: 'hs_pipeline', operator: 'EQ', value: COTACAO_PIPELINE }] }],
      properties,
      sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
      limit: 200,
      after
    };
    const response = await hubspotPost(token, '/crm/v3/objects/tickets/search', body);
    allResults = allResults.concat((response.results || []).map(r => ({ ...r.properties, _id: r.id })));
    hasMore = response.paging?.next?.after != null;
    after = response.paging?.next?.after || 0;
  }

  const ticketIds = allResults.map(t => t.hs_object_id || t._id).filter(Boolean);
  const companyAssoc = {};
  for (let i = 0; i < ticketIds.length; i += 100) {
    const batch = ticketIds.slice(i, i + 100);
    try {
      const assocResp = await hubspotPost(token, '/crm/v4/associations/tickets/companies/batch/read', {
        inputs: batch.map(id => ({ id: String(id) }))
      });
      (assocResp.results || []).forEach(r => {
        const from = r.from?.id;
        const tos = (r.to || []).map(t => t.toObjectId);
        if (from && tos.length > 0) companyAssoc[from] = tos;
      });
    } catch (e) {
      console.log('Association fetch error:', e.message);
    }
  }

  const allCompanyIds = [...new Set(Object.values(companyAssoc).flat())];
  const companyNames = {};
  for (let i = 0; i < allCompanyIds.length; i += 100) {
    const batch = allCompanyIds.slice(i, i + 100);
    try {
      const compResp = await hubspotPost(token, '/crm/v3/objects/companies/batch/read', {
        properties: ['name', 'hs_object_id'],
        inputs: batch.map(id => ({ id: String(id) }))
      });
      (compResp.results || []).forEach(r => {
        companyNames[r.id] = r.properties?.name || 'Unknown';
      });
    } catch (e) {
      console.log('Company batch read error:', e.message);
    }
  }

  allResults.forEach(t => {
    const tid = t.hs_object_id || t._id;
    const compIds = companyAssoc[tid] || [];
    t._companyIds = compIds;
    t._companyNames = compIds.map(id => companyNames[id] || 'Unknown');
    t._companyName = t._companyNames[0] || null;
  });

  return { tickets: allResults, companyAssoc, companyNames };
}

async function fetchTicketActivities(token, hsId) {
  const ownerMap = await fetchOwners(token);
  const activities = [];

  await Promise.all(ENGAGEMENT_TYPES.map(async (eng) => {
    try {
      const assocResp = await hubspotGet(token, `/crm/v3/objects/tickets/${hsId}/associations/${eng.type}?limit=50`);
      const ids = (assocResp.results || []).map(r => r.toObjectId || r.id).filter(Boolean);
      if (ids.length === 0) return;
      const batchResp = await hubspotPost(token, `/crm/v3/objects/${eng.type}/batch/read`, {
        properties: eng.props, inputs: ids.map(id => ({ id: String(id) }))
      });
      (batchResp.results || []).forEach(r => {
        const p = r.properties || {};
        activities.push({
          type: eng.label,
          timestamp: p.hs_timestamp || r.createdAt,
          owner: ownerMap[p.hubspot_owner_id] || null,
          title: p.hs_email_subject || p.hs_call_title || p.hs_meeting_title || '',
          body: (p.hs_note_body || p.hs_email_text || p.hs_call_body || p.hs_meeting_body || '').substring(0, 500)
        });
      });
    } catch { /* skip */ }
  }));

  activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return activities;
}

module.exports = {
  HUBSPOT_PIPELINE, BID_PIPELINE, DEALS_SINCE_MS, STAGE_MAP, STAGE_IDS, AE_NAMES,
  cleanOwnerName, fetchOwners,
  fetchAllDeals, pullHubSpotData,
  fetchCSCompanies, fetchVigenciaDeals, pullCSData,
  fetchDealActivities, fetchCompanyActivities, fetchCompanyDeals,
  fetchCotacaoTickets, fetchTicketActivities,
  hubspotGet, hubspotPost
};
