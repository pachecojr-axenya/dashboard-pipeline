'use strict';
/**
 * GET /api/bdr-treble-dw
 * BDR | Treble Dashboard | ClickHouse deployment fact.
 * Segurança: não expõe PII nem credenciais; uma linha sanitizada por tentativa.
 */

const { setCORSHeaders, requireAuth, methodCheck } = require('./_helpers');

const CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_DAYS = 30;
const MIN_DAYS = 7;
const MAX_DAYS = 90;
const ROW_LIMIT = 10000;
const QUERY_LIMIT = ROW_LIMIT + 1;
const SENTINEL_SQL = "toDateTime64('2000-01-01 00:00:00', 6, 'America/Sao_Paulo')";
const PII_KEYS = {
  cellphone: true,
  country_code: true,
  deployment_id: true,
  batch_id: true,
  treble_id: true,
  phone: true,
  email: true,
  document: true,
  content: true,
  message: true,
  text: true,
  body: true,
  copy: true,
  session_id: true
};

let cacheByKey = {};

const BDR_ALIASES = {
  gabi: 'Gabriele', gabriele: 'Gabriele', leticia: 'Letícia', 'letícia': 'Letícia', giovana: 'Giovana',
  thauan: 'Thauan', aline: 'Aline', pri: 'Priscilla', priscilla: 'Priscilla', cynthia: 'Cíntia',
  cintia: 'Cíntia', 'cíntia': 'Cíntia', bru: 'Bruna', bruna: 'Bruna', bruno: 'Bruno', yoky: 'Yoky'
};

const REASON_META = {
  responded: { label: 'Respondeu', severity: 'success', action: 'Replicar abordagem | resposta registrada' },
  delivered_no_reply: { label: 'Entregue, sem resposta', severity: 'warning', action: 'Revisar CTA, horário e follow-up' },
  not_delivered: { label: 'Não entregue', severity: 'danger', action: 'Verificar HSM, número, opt-in e linha de envio' },
  unknown: { label: 'Indeterminado', severity: 'neutral', action: 'Validar status na Treble' }
};

function getClickHouseCredentials() {
  const host = process.env.TREBLE_WAREHOUSE_HOST;
  const port = process.env.TREBLE_WAREHOUSE_PORT || '8443';
  const user = process.env.TREBLE_WAREHOUSE_USER;
  const password = process.env.TREBLE_WAREHOUSE_PASSWORD;
  const database = process.env.TREBLE_WAREHOUSE_DATABASE || 'client_analytics';
  if (!host || !user || !password) throw new Error('clickhouse_config_missing');
  return { host, port, user, password, database };
}

function basicAuth(user, password) {
  return 'Basic ' + Buffer.from(String(user) + ':' + String(password), 'utf8').toString('base64');
}

async function clickhouseQuery(creds, sql) {
  const base = 'https://' + creds.host + ':' + creds.port + '/?database=' + encodeURIComponent(creds.database);
  const res = await fetch(base, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'text/plain; charset=utf-8',
      Authorization: basicAuth(creds.user, creds.password)
    },
    body: sql,
    signal: AbortSignal.timeout(25000)
  });
  if (!res.ok) throw new Error('clickhouse_http_' + res.status);
  const json = await res.json();
  return { rows: json.data || [], meta: json.meta || [], statistics: json.statistics || {}, rowsRead: json.rows || 0 };
}

function clampDays(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULT_DAYS;
  return Math.max(MIN_DAYS, Math.min(MAX_DAYS, n));
}

function normalizeText(v) { return String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function inferBdr(name) { const first = (normalizeText(name).match(/[a-z]+/) || [''])[0]; return BDR_ALIASES[first] || 'Responsável não inferido'; }
function copyFamily(name) { const s = normalizeText(name); if (/mensagem\s*1|msg\s*1|abertura|inicial|oi\b/.test(s)) return 'Abertura | primeira mensagem'; if (/mensagem\s*2|msg\s*2|follow|retomada|mais cedo|liguei/.test(s)) return 'Follow-up | retomada'; if (/conectado|conexao/.test(s)) return 'Conexão pendente'; if (/workflow|automacao|automatizado/.test(s)) return 'Workflow automatizado'; return 'Outros'; }
function inferAudience(flowName) { const s = normalizeText(flowName); if (/rh|people|gente|dp|folha|pessoas/.test(s)) return 'RH | People | DP'; if (/beneficio|saude|plano|medico|odonto/.test(s)) return 'Benefícios | Saúde corporativa'; if (/sst|seguranca|ocupacional|epp|epi/.test(s)) return 'SST | Saúde ocupacional'; if (/financeiro|compras|suprimento|payments/.test(s)) return 'Financeiro | Compras'; if (/juri|compliance|legal|regula/.test(s)) return 'Jurídico | Compliance'; return 'Público geral'; }
function pct(num, den) { if (!den) return null; return Math.round((num / den) * 1000) / 10; }
function isDeliveredStatus(status) { return String(status || '').toUpperCase() === 'DELIVERED'; }
function safeDay(v) { return v ? String(v).slice(0, 10) : ''; }
function reasonFor(delivered, replied) { if (replied) return 'responded'; if (delivered) return 'delivered_no_reply'; return 'not_delivered'; }

function sanitizeMessage(r) {
  const flow = String(r.flow || 'Flow sem nome');
  const replied = Number(r.replied_real || 0) > 0;
  const delivered = Number(r.delivered_real || 0) > 0 || isDeliveredStatus(r.status) || replied;
  const reason = reasonFor(delivered, replied);
  const meta = REASON_META[reason] || REASON_META.unknown;
  const family = copyFamily(flow);
  const audience = inferAudience(flow);
  return {
    flow: flow,
    pollId: r.poll_id == null ? '' : String(r.poll_id),
    createdAt: r.created_at || '',
    createdDay: r.created_day || safeDay(r.created_at),
    bdr: inferBdr(flow),
    bdrSource: 'Inferido do nome do flow',
    family: family,
    audience: audience,
    semanticGroup: family + ' | ' + audience + ' | ' + meta.label,
    sent: true,
    delivered: delivered,
    deliveredSource: replied && !(Number(r.delivered_real || 0) > 0 || isDeliveredStatus(r.status)) ? 'inferido_por_resposta' : 'timestamp_or_status',
    replied: replied,
    read: false,
    readAvailable: false,
    reason: reason,
    reasonLabel: meta.label,
    severity: meta.severity,
    action: meta.action,
    nonDeliveryReason: delivered ? '' : String(r.status || 'UNKNOWN'),
    diagnostic: false
  };
}

function assertNoPii(obj) {
  const bad = [];
  function walk(x) {
    if (!x || typeof x !== 'object') return;
    Object.keys(x).forEach(function (k) {
      if (PII_KEYS[k.toLowerCase()]) bad.push(k);
      walk(x[k]);
    });
  }
  walk(obj);
  if (bad.length) throw new Error('pii_key_in_payload');
}

function incCounters(a, m) {
  a.enviadas++;
  if (a.sent != null) a.sent++;
  if (m.delivered) { a.entregues++; if (a.delivered != null) a.delivered++; }
  if (m.replied) { a.respondidas++; if (a.replied != null) a.replied++; }
  if (!m.delivered && a.deploymentFailures != null) a.deploymentFailures++;
  if (!m.delivered && a.falhas != null) a.falhas++;
}

function aggregateMessages(messages) {
  const summary = { sessions: messages.length, enviadas: messages.length, sent: messages.length, entregues: 0, delivered: 0, lidas: 0, read: 0, respondidas: 0, replied: 0, falhas: 0, failures: 0, deploymentFailures: 0, flowsCount: 0, bdrsCount: 0 };
  const flows = {}, bdrs = {}, reasons = {}, days = {}, convDays = {};
  messages.forEach(function (m) {
    if (m.delivered) { summary.entregues++; summary.delivered++; }
    if (m.replied) { summary.respondidas++; summary.replied++; }
    if (!m.delivered) { summary.falhas++; summary.failures++; summary.deploymentFailures++; }
    flows[m.flow] = flows[m.flow] || { flow: m.flow, bdr: m.bdr, family: m.family, audience: m.audience, enviadas: 0, entregues: 0, respondidas: 0, falhas: 0, deploymentFailures: 0 };
    bdrs[m.bdr] = bdrs[m.bdr] || { bdr: m.bdr, enviadas: 0, entregues: 0, respondidas: 0, falhas: 0, deploymentFailures: 0, flows: {} };
    reasons[m.reasonLabel] = reasons[m.reasonLabel] || { reason: m.reason, label: m.reasonLabel, count: 0, severity: m.severity, action: m.action };
    days[m.createdDay] = days[m.createdDay] || { dia: m.createdDay, day: m.createdDay, createdDay: m.createdDay, enviadas: 0, sent: 0, entregues: 0, delivered: 0, lidas: 0, read: 0, respondidas: 0, replied: 0, deploymentFailures: 0 };
    const ck = m.createdDay + '|' + m.flow;
    convDays[ck] = convDays[ck] || { day: m.createdDay, name: m.flow, conversationId: m.pollId, sent: 0, delivered: 0, deploymentFailures: 0, responded: 0, failureReasons: {} };
    [flows[m.flow], bdrs[m.bdr], days[m.createdDay]].forEach(function (a) { incCounters(a, m); });
    convDays[ck].sent++;
    if (m.delivered) convDays[ck].delivered++;
    if (m.replied) convDays[ck].responded++;
    if (!m.delivered) { convDays[ck].deploymentFailures++; convDays[ck].failureReasons[m.nonDeliveryReason || 'UNKNOWN'] = (convDays[ck].failureReasons[m.nonDeliveryReason || 'UNKNOWN'] || 0) + 1; }
    bdrs[m.bdr].flows[m.flow] = true;
    reasons[m.reasonLabel].count++;
  });
  const byFlow = Object.keys(flows).map(function (k) { const a = flows[k]; a.taxaEntrega = pct(a.entregues, a.enviadas); a.taxaResposta = pct(a.respondidas, a.enviadas); return a; }).sort(function (a, b) { return b.enviadas - a.enviadas; });
  const byBdr = Object.keys(bdrs).map(function (k) { const a = bdrs[k]; a.flowsCount = Object.keys(a.flows).length; delete a.flows; a.taxaEntrega = pct(a.entregues, a.enviadas); a.taxaResposta = pct(a.respondidas, a.enviadas); return a; }).sort(function (a, b) { return b.enviadas - a.enviadas; });
  const timeline = Object.keys(days).map(function (k) { return days[k]; }).sort(function (a, b) { return String(a.dia).localeCompare(String(b.dia)); });
  const byReason = Object.keys(reasons).map(function (k) { return reasons[k]; }).sort(function (a, b) { return b.count - a.count; });
  const byConversationDay = Object.keys(convDays).map(function (k) { return convDays[k]; }).sort(function (a, b) { return String(b.day).localeCompare(String(a.day)) || b.sent - a.sent; });
  summary.flowsCount = byFlow.length; summary.bdrsCount = byBdr.length; summary.taxaEntrega = pct(summary.entregues, summary.enviadas); summary.taxaResposta = pct(summary.respondidas, summary.enviadas); summary.taxaLeitura = null; summary.readMetricAvailable = false; summary.deliveryAnalyticsAvailable = true; summary.deliveryAnalyticsStatus = 'clickhouse_fact_deployment_status'; summary.realObservedAttempts = summary.enviadas; summary.realObservedDeliveryRate = summary.enviadas ? summary.entregues / summary.enviadas : null;
  return { summary: summary, timeline: timeline, byFlow: byFlow, byBdr: byBdr, byReason: byReason, byConversationDay: byConversationDay };
}

function buildSql(days) {
  return "SELECT formatDateTime(toTimeZone(timestamps_eta, 'America/Sao_Paulo'), '%Y-%m-%dT%H:%i:%S-03:00') AS created_at, toString(toDate(toTimeZone(timestamps_eta, 'America/Sao_Paulo'))) AS created_day, toString(status) AS status, toString(poll_id) AS poll_id, toString(poll_name) AS flow, if(timestamp_delivered > " + SENTINEL_SQL + " OR status = 'DELIVERED', 1, 0) AS delivered_real, if(timestamp_responded > " + SENTINEL_SQL + ", 1, 0) AS replied_real, toString(origin) AS origin FROM client_analytics.fact_deployment_status WHERE timestamps_eta >= now('America/Sao_Paulo') - INTERVAL " + days + " DAY ORDER BY timestamps_eta DESC LIMIT " + QUERY_LIMIT + " FORMAT JSON";
}

async function buildPayloadFromDW(days) {
  const creds = getClickHouseCredentials();
  const result = await clickhouseQuery(creds, buildSql(days));
  const rawRows = result.rows || [];
  const truncated = rawRows.length > ROW_LIMIT;
  const messages = rawRows.slice(0, ROW_LIMIT).map(sanitizeMessage);
  const agg = aggregateMessages(messages);
  const payload = { success: true, source: 'treble_data_warehouse', generatedAt: new Date().toISOString(), cached: false, days: days, messages: messages, summary: agg.summary, timeline: agg.timeline, byFlow: agg.byFlow, byBdr: agg.byBdr, byReason: agg.byReason, sessions: [], deploymentReport: { available: true, source: 'client_analytics.fact_deployment_status', byDay: agg.timeline, byConversationDay: agg.byConversationDay }, meta: { source: 'Treble Data Warehouse (ClickHouse)', sourceLabel: 'Treble Data Warehouse (ClickHouse)', timezone: 'America/Sao_Paulo', periodDays: days, minDays: MIN_DAYS, maxDays: MAX_DAYS, rowsReturned: messages.length, rowLimit: ROW_LIMIT, rowsTruncated: truncated, sessionsTruncated: truncated, readMetricAvailable: false, readMetricLabel: 'Indisponível nesta fato', privacy: 'Sem telefone, email, documento, deployment_id, batch_id, treble_id, conteúdo ou payload bruto', limitations: ['Retenção máxima disponível: 90 dias', 'BDR, público e família são inferidos do nome do flow', 'Métrica de leitura não existe de forma confiável em fact_deployment_status e fica indisponível', 'Se timestamp_responded é válido sem evidência explícita de entrega, o evento é considerado entregue para consistência do funil de resposta'] }, apiMap: [{ step: 1, method: 'POST', endpoint: 'ClickHouse HTTP | client_analytics.fact_deployment_status', purpose: 'Tentativas reais de deployment Treble', returns: 'Linhas sanitizadas por tentativa', usedFor: 'Envios, entregas, respostas e não entregues sem PII' }] };
  assertNoPii(payload);
  return payload;
}

function cacheKey(req) { return 'dw-' + clampDays(req.query.days); }
function getFromCache(key) { const entry = cacheByKey[key]; if (!entry) return null; if (Date.now() - entry.ts > CACHE_TTL_MS) { delete cacheByKey[key]; return null; } return entry.payload; }
function setCache(key, payload) { cacheByKey[key] = { payload: payload, ts: Date.now() }; }

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const auth = requireAuth(req, res); if (!auth) return;
  if (!methodCheck(req, res, 'GET')) return;
  const days = clampDays(req.query.days);
  const key = cacheKey(req);
  const refresh = String(req.query.refresh || '') === 'true' || String(req.query.refresh || '') === '1';
  const cached = refresh ? null : getFromCache(key);
  if (cached) return res.json(Object.assign({}, cached, { cached: true }));
  try {
    const payload = await buildPayloadFromDW(days);
    setCache(key, payload);
    res.json(payload);
  } catch (e) {
    console.error('[bdr-treble-dw] Error:', e && e.message ? e.message : 'unknown');
    res.status(500).json({ success: false, error: 'data_warehouse_error', message: 'Falha ao consultar Treble Data Warehouse. Fallback REST disponível no frontend.', hint: 'Verificar configuração do Data Warehouse sem expor credenciais.' });
  }
};

module.exports._test = { buildSql: buildSql, clickhouseQuery: clickhouseQuery, buildPayloadFromDW: buildPayloadFromDW, clampDays: clampDays, sanitizeMessage: sanitizeMessage, aggregateMessages: aggregateMessages, assertNoPii: assertNoPii, ROW_LIMIT: ROW_LIMIT };
