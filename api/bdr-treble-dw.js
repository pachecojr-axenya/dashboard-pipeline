'use strict';
/**
 * GET /api/bdr-treble-dw
 *
 * BDR | Treble Dashboard — Data Warehouse Version
 * 
 * Fonte: Treble Data Warehouse (ClickHouse) via HTTP API
 * Diferença vs API REST: 1 query SQL ao invés de 100+ chamadas API
 * 
 * Segurança: não expõe telefone, email, documento, session_id ou payload bruto.
 */

const { setCORSHeaders, requireAuth, methodCheck } = require('./_helpers');

const CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_DAYS = 30;
const MIN_DAYS = 7;
const MAX_DAYS = 90;

let cacheByKey = {};

// ============================================================
// BDR Mapping (mesmo do endpoint original)
// ============================================================

const BDR_ALIASES = {
  gabi: 'Gabriele',
  gabriele: 'Gabriele',
  leticia: 'Letícia',
  'letícia': 'Letícia',
  giovana: 'Giovana',
  thauan: 'Thauan',
  aline: 'Aline',
  pri: 'Priscilla',
  priscilla: 'Priscilla',
  cynthia: 'Cíntia',
  cintia: 'Cíntia',
  'cíntia': 'Cíntia',
  bru: 'Bruna',
  bruna: 'Bruna',
  bruno: 'Bruno',
  yoky: 'Yoky'
};

const REASON_META = {
  responded: { label: 'Respondeu', severity: 'success', action: 'Replicar abordagem | resposta registrada' },
  not_delivered: { label: 'Sem evidência de entrega', severity: 'danger', action: 'Verificar HSM, número, opt-in e linha de envio' },
  delivered_not_read: { label: 'Entregue, não lida', severity: 'warning', action: 'Testar horário, primeira linha e remetente' },
  read_no_reply: { label: 'Lida, sem resposta', severity: 'warning', action: 'Revisar CTA e fricção da pergunta' },
  no_response: { label: 'Sem resposta', severity: 'warning', action: 'Ajustar follow-up e promessa inicial' },
  no_outbound: { label: 'Sessão sem envio detectado', severity: 'neutral', action: 'Auditar configuração do flow' },
  no_history: { label: 'Sem histórico capturado', severity: 'neutral', action: 'Validar sincronização da API Treble' },
  flow_api_error: { label: 'Flow com erro na API Treble', severity: 'neutral', action: 'Reprocessar no próximo refresh ou auditar o flow na Treble' },
  unknown: { label: 'Indeterminado', severity: 'neutral', action: 'Falta dado suficiente para diagnóstico' }
};

// ============================================================
// ClickHouse HTTP Client
// ============================================================

function getClickHouseCredentials() {
  const host = process.env.TREBLE_WAREHOUSE_HOST;
  const port = process.env.TREBLE_WAREHOUSE_PORT || '8443';
  const user = process.env.TREBLE_WAREHOUSE_USER;
  const password = process.env.TREBLE_WAREHOUSE_PASSWORD;
  const database = process.env.TREBLE_WAREHOUSE_DATABASE || 'client_analytics';
  
  if (!host || !user || !password) {
    throw new Error('Credenciais do Treble Data Warehouse não configuradas (TREBLE_WAREHOUSE_HOST, TREBLE_WAREHOUSE_USER, TREBLE_WAREHOUSE_PASSWORD)');
  }
  
  return { host, port, user, password, database };
}

async function clickhouseQuery(creds, sql) {
  const url = `https://${creds.host}:${creds.port}/?query=${encodeURIComponent(sql)}&user=${encodeURIComponent(creds.user)}&password=${encodeURIComponent(creds.password)}&database=${encodeURIComponent(creds.database)}`;
  
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(25000)
  });
  
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ClickHouse HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  
  // ClickHouse retorna JSON com meta, data, rows, statistics
  const json = await res.json();
  return {
    rows: json.data || [],
    meta: json.meta || [],
    statistics: json.statistics || {},
    rowsRead: json.rows || 0
  };
}

// ============================================================
// Helpers
// ============================================================

function clampDays(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULT_DAYS;
  return Math.max(MIN_DAYS, Math.min(MAX_DAYS, n));
}

function inferBdr(name) {
  const raw = String(name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const first = (raw.match(/[a-z]+/) || [''])[0];
  return BDR_ALIASES[first] || 'Responsável não inferido';
}

function copyFamily(name) {
  const s = String(name || '').toLowerCase();
  if (/mensagem\s*1|msg\s*1|abertura|inicial|oi\b/.test(s)) return 'Abertura | primeira mensagem';
  if (/mensagem\s*2|msg\s*2|follow|retomada|mais cedo|liguei/.test(s)) return 'Follow-up | retomada';
  if (/conectado|conexao|conexão/.test(s)) return 'Conexão pendente';
  if (/workflow|automa[cç][aã]o|automatizado/.test(s)) return 'Workflow automatizado';
  return 'Outros';
}

function inferAudience(flowName) {
  const s = String(flowName || '').toLowerCase();
  if (/rh|people|gente|dp|folha|pessoas/.test(s)) return 'RH | People | DP';
  if (/benef[ií]cio|sa[uú]de|plano|m[eé]dico|odonto/.test(s)) return 'Benefícios | Saúde corporativa';
  if (/sst|seguran[cç]a|ocupacional|epp|epi/.test(s)) return 'SST | Saúde ocupacional';
  if (/financeiro|compras|suprimento|payments/.test(s)) return 'Financeiro | Compras';
  if (/juri|compliance|legal|regula/.test(s)) return 'Jurídico | Compliance';
  return 'Público geral';
}

function semanticGroup(family, audience, reason) {
  const f = family || 'Outros';
  const a = audience || 'Público geral';
  return `${f} | ${a} | ${reason}`;
}

function clamp(val, min, max) {
  const n = Number(val);
  if (!Number.isFinite(n)) return 0;
  return Math.max(min, Math.min(max, n));
}

function pct(num, den) {
  if (!den) return null;
  return Math.round((num / den) * 1000) / 10;
}

// ============================================================
// Main Query Builder
// ============================================================

async function buildPayloadFromDW(days) {
  const creds = getClickHouseCredentials();
  
  // ============================================================
  // Query 1: Funil principal (por dia)
  // ============================================================
  const funnelSql = `
    SELECT
      toDate(timestamps_eta) AS dia,
      count() AS enviadas,
      countIf(status = 'DELIVERED') AS entregues,
      countIf(timestamp_delivered > '2000-01-01') AS lidas,
      countIf(timestamp_responded IS NOT NULL) AS respondidas
    FROM fact_deployment_status
    WHERE timestamps_eta >= now() - INTERVAL ${days} DAY
    GROUP BY dia
    ORDER BY dia DESC
  `;
  
  // ============================================================
  // Query 2: Por Flow/Campanha
  // ============================================================
  const byFlowSql = `
    SELECT
      poll_id,
      poll_name AS flow,
      count() AS enviadas,
      countIf(status = 'DELIVERED') AS entregues,
      countIf(timestamp_responded IS NOT NULL) AS respondidas,
      countIf(status != 'DELIVERED') AS falhas
    FROM fact_deployment_status
    WHERE timestamps_eta >= now() - INTERVAL ${days} DAY
    GROUP BY poll_id, poll_name
    ORDER BY enviadas DESC
    LIMIT 100
  `;
  
  // ============================================================
  // Query 3: Por BDR (inferido do nome do flow)
  // ============================================================
  const byBdrSql = `
    SELECT
      poll_name AS flow,
      count() AS enviadas,
      countIf(status = 'DELIVERED') AS entregues,
      countIf(timestamp_responded IS NOT NULL) AS respondidas,
      countIf(status != 'DELIVERED') AS falhas
    FROM fact_deployment_status
    WHERE timestamps_eta >= now() - INTERVAL ${days} DAY
    GROUP BY poll_name
    ORDER BY enviadas DESC
  `;
  
  // ============================================================
  // Query 4: Motivos de falha
  // ============================================================
  const failuresSql = `
    SELECT
      status AS motivo,
      count() AS total
    FROM fact_deployment_status
    WHERE timestamps_eta >= now() - INTERVAL ${days} DAY
      AND status != 'DELIVERED'
    GROUP BY status
    ORDER BY total DESC
  `;
  
  // ============================================================
  // Query 5: Sessões por flow (transferências para agente)
  // ============================================================
  const sessionsSql = `
    SELECT
      poll_name AS flow,
      count() AS sessoes,
      countIf(status = 'HumanHandover') AS transferidas_agente,
      countIf(status = 'Finished') AS finalizadas
    FROM fact_sessions
    WHERE created_at >= now() - INTERVAL ${days} DAY
      AND inbound_outbound = 'OUTBOUND'
    GROUP BY poll_name
    ORDER BY sessoes DESC
    LIMIT 50
  `;
  
  // Execute all queries in parallel
  const [funnelRes, byFlowRes, byBdrRes, failuresRes, sessionsRes] = await Promise.all([
    clickhouseQuery(creds, funnelSql).catch(e => ({ rows: [], error: e.message })),
    clickhouseQuery(creds, byFlowSql).catch(e => ({ rows: [], error: e.message })),
    clickhouseQuery(creds, byBdrSql).catch(e => ({ rows: [], error: e.message })),
    clickhouseQuery(creds, failuresSql).catch(e => ({ rows: [], error: e.message })),
    clickhouseQuery(creds, sessionsSql).catch(e => ({ rows: [], error: e.message }))
  ]);
  
  // ============================================================
  // Process results
  // ============================================================
  
  // Funnel
  const timeline = (funnelRes.rows || []).map(r => ({
    dia: r.dia || '',
    enviadas: clamp(r.enviadas, 0, 1e9),
    entregues: clamp(r.entregues, 0, 1e9),
    lidas: clamp(r.lidas, 0, 1e9),
    respondidas: clamp(r.respondidas, 0, 1e9)
  }));
  
  // By Flow
  const byFlow = (byFlowRes.rows || []).map(r => {
    const flow = String(r.flow || 'Flow sem nome');
    return {
      flow,
      bdr: inferBdr(flow),
      family: copyFamily(flow),
      audience: inferAudience(flow),
      enviadas: clamp(r.enviadas, 0, 1e9),
      entregues: clamp(r.entregues, 0, 1e9),
      respondidas: clamp(r.respondidas, 0, 1e9),
      falhas: clamp(r.falhas, 0, 1e9),
      taxaEntrega: pct(r.entregues, r.enviadas),
      taxaResposta: pct(r.respondidas, r.entregues)
    };
  });
  
  // By BDR (aggregate by inferred BDR)
  const bdrAgg = {};
  (byBdrRes.rows || []).forEach(r => {
    const flow = String(r.flow || '');
    const bdr = inferBdr(flow);
    if (!bdrAgg[bdr]) {
      bdrAgg[bdr] = { bdr, enviadas: 0, entregues: 0, respondidas: 0, falhas: 0, flows: new Set() };
    }
    bdrAgg[bdr].enviadas += clamp(r.enviadas, 0, 1e9);
    bdrAgg[bdr].entregues += clamp(r.entregues, 0, 1e9);
    bdrAgg[bdr].respondidas += clamp(r.respondidas, 0, 1e9);
    bdrAgg[bdr].falhas += clamp(r.falhas, 0, 1e9);
    bdrAgg[bdr].flows.add(flow);
  });
  
  const byBdr = Object.values(bdrAgg).map(b => ({
    bdr: b.bdr,
    enviadas: b.enviadas,
    entregues: b.entregues,
    respondidas: b.respondidas,
    falhas: b.falhas,
    flowsCount: b.flows.size,
    taxaEntrega: pct(b.entregues, b.enviadas),
    taxaResposta: pct(b.respondidas, b.entregues)
  })).sort((a, b) => b.enviadas - a.enviadas);
  
  // Failures
  const byReason = (failuresRes.rows || []).map(r => ({
    reason: r.motivo || 'UNKNOWN',
    count: clamp(r.total, 0, 1e9)
  }));
  
  // Sessions
  const sessions = (sessionsRes.rows || []).map(r => {
    const flow = String(r.flow || 'Flow sem nome');
    return {
      flow,
      bdr: inferBdr(flow),
      sessoes: clamp(r.sessoes, 0, 1e9),
      transferidasAgente: clamp(r.transferidas_agente, 0, 1e9),
      finalizadas: clamp(r.finalizadas, 0, 1e9),
      taxaTransferencia: pct(r.transferidas_agente, r.sessoes)
    };
  });
  
  // Summary
  const summary = {
    enviadas: timeline.reduce((s, r) => s + r.enviadas, 0),
    entregues: timeline.reduce((s, r) => s + r.entregues, 0),
    lidas: timeline.reduce((s, r) => s + r.lidas, 0),
    respondidas: timeline.reduce((s, r) => s + r.respondidas, 0),
    falhas: byReason.reduce((s, r) => s + r.count, 0),
    flowsCount: byFlow.length,
    bdrsCount: byBdr.length
  };
  
  summary.taxaEntrega = pct(summary.entregues, summary.enviadas);
  summary.taxaResposta = pct(summary.respondidas, summary.entregues);
  summary.taxaLeitura = pct(summary.lidas, summary.entregues);
  
  return {
    success: true,
    source: 'treble_data_warehouse',
    generatedAt: new Date().toISOString(),
    cached: false,
    days,
    summary,
    timeline,
    byFlow,
    byBdr,
    byReason,
    sessions,
    meta: {
      sourceLabel: 'Treble Data Warehouse (ClickHouse)',
      queryTime: '1-5s',
      coverage: 'Últimos 3 meses',
      privacy: 'Sem telefone, email, documento ou session_id exposto',
      limitations: [
        'Latência de até 3 horas da operação real',
        'BDR inferido do nome do flow (padronizar nomenclatura para 100% precisão)',
        'Público e família de copy inferidos do nome do flow'
      ]
    },
    apiMap: [
      { source: 'ClickHouse', table: 'fact_deployment_status', purpose: 'Envios, entregas, respostas, falhas' },
      { source: 'ClickHouse', table: 'fact_sessions', purpose: 'Sessões, transferências para agente' }
    ]
  };
}

// ============================================================
// Cache
// ============================================================

function cacheKey(req) {
  const days = clampDays(req.query.days);
  return `dw-${days}`;
}

function getFromCache(key) {
  const entry = cacheByKey[key];
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    delete cacheByKey[key];
    return null;
  }
  return entry.payload;
}

function setCache(key, payload) {
  cacheByKey[key] = { payload, ts: Date.now() };
}

// ============================================================
// Handler
// ============================================================

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  
  // Auth check
  const auth = requireAuth(req, res);
  if (!auth) return;
  
  // Method check
  if (!methodCheck(req, res, 'GET')) return;
  
  const days = clampDays(req.query.days);
  const key = cacheKey(req);
  
  // Try cache
  const cached = getFromCache(key);
  if (cached) {
    return res.json({ ...cached, cached: true });
  }
  
  try {
    const payload = await buildPayloadFromDW(days);
    setCache(key, payload);
    res.json(payload);
  } catch (e) {
    console.error('[bdr-treble-dw] Error:', e.message);
    
    // Fallback response
    res.status(500).json({
      success: false,
      error: 'data_warehouse_error',
      message: e.message,
      hint: 'Verificar variáveis TREBLE_WAREHOUSE_HOST, TREBLE_WAREHOUSE_USER, TREBLE_WAREHOUSE_PASSWORD no ambiente'
    });
  }
};
