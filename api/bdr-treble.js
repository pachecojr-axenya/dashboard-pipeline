'use strict';
/**
 * GET /api/bdr-treble
 *
 * Painel interno BDR | Treble. Fonte primária: API oficial Treble, read-only.
 * HubSpot não é fonte analítica aqui. Não envia mensagens, não muta Treble,
 * não expõe telefone, email, documento, session_id ou payload bruto.
 */

const { setCORSHeaders, requireAuth, methodCheck } = require('./_helpers');

const CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_DAYS = 90;
const MIN_DAYS = 7;
const MAX_DAYS = 365;
const MAX_FLOWS = 80;
const MAX_SESSIONS_PER_FLOW = 100;
const MAX_HISTORIES = 220;
const BUILD_DEADLINE_MS = 58000;
const TREBLE_BASE = 'https://main.treble.ai';

let cacheByKey = {};

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
  bru: 'Bru',
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

function clampDays(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULT_DAYS;
  return Math.max(MIN_DAYS, Math.min(MAX_DAYS, n));
}

function tokenFromEnv() {
  const raw = process.env.TREBLE_API_KEY || process.env.TREBLE_TOKEN || process.env.TREBLE_API_TOKEN || '';
  if (!raw) throw new Error('TREBLE_API_KEY não configurado no servidor.');
  const trimmed = String(raw).trim();
  try {
    const data = JSON.parse(trimmed);
    const key = data.api_key || data.apikey || data.key || data.token;
    if (key) return String(key).trim();
  } catch (e) { /* env pode ser só o valor da key */ }
  const line = trimmed.split(/\r?\n/).find(l => /^\s*(api_key|apikey|api key|key|token)\s*:/i.test(l));
  if (line) return line.split(':').slice(1).join(':').trim().replace(/^['"]|['"]$/g, '');
  return trimmed;
}

function withDeadline(promise, ms) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Consulta Treble excedeu o limite de tempo.')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function trebleGet(token, path) {
  const res = await fetch(TREBLE_BASE + path, {
    method: 'GET',
    headers: { Authorization: token, Accept: 'application/json' },
    signal: AbortSignal.timeout(25000)
  });
  if (!res.ok) throw new Error('Treble GET ' + path.split('?')[0] + ' | HTTP ' + res.status);
  return res.json();
}

function stripText(v) {
  return String(v || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function redactPII(value) {
  return stripText(value)
    .replace(/https?:\/\/[^\s|]+/gi, '[link redigido]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email redigido]')
    .replace(/(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?(?:9\s*)?\d{4}[-\s]?\d{4}/g, '[telefone redigido]')
    .replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, '[cnpj redigido]')
    .replace(/\b\d{14}\b/g, '[cnpj redigido]')
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '[cpf redigido]')
    .replace(/\b\d{11}\b/g, '[cpf redigido]')
    .replace(/\b(ol[aá]|oi|prezad[oa])\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÁÉÍÓÚÂÊÔÃÕÇáéíóúâêôãõç]+)(\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÁÉÍÓÚÂÊÔÃÕÇáéíóúâêôãõç]+)?\b/gi, '$1 [nome redigido]');
}

function safeLabel(value, fallback) {
  const s = redactPII(value).replace(/[<>"'`\\;{}\[\]()]/g, '').trim();
  if (!s) return fallback;
  if (/@/.test(s) || /\+?\d[\d\s().-]{7,}/.test(s) || /\b\d{11,14}\b/.test(s.replace(/\D/g, ''))) return fallback;
  return s.slice(0, 80);
}

function flowLabel(flow) {
  return safeLabel(flow && flow.name, 'Flow sem nome');
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
  if (/persona|modelo/.test(s)) return 'Modelo por persona';
  if (/workflow/.test(s)) return 'Workflow automatizado';
  return 'Sem família de copy';
}

function tsToIso(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return new Date(v * 1000).toISOString();
  if (/^\d+$/.test(String(v))) return new Date(Number(v) * 1000).toISOString();
  const d = new Date(String(v).replace(' ', 'T') + (String(v).includes('Z') ? '' : 'Z'));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function dayKey(iso) {
  return iso ? iso.slice(0, 10) : 'Sem data';
}

function isOutboundMessage(msg) {
  const sender = String(msg.sender || '').toUpperCase();
  return sender === 'AI' || sender === 'COMPANY' || sender === 'BOT';
}

function isInboundMessage(msg) {
  return String(msg.sender || '').toUpperCase() === 'USER';
}

function summarizeHistory(history) {
  const messages = Array.isArray(history) ? history.filter(h => h && h.type === 'MESSAGE' && h.message).map(h => h.message) : [];
  const outbound = messages.filter(isOutboundMessage);
  const inbound = messages.filter(isInboundMessage);
  const hsm = outbound.find(m => String(m.type || '').toUpperCase() === 'HSM') || outbound[0] || null;
  const delivered = outbound.some(m => m.delivered_at != null);
  const read = outbound.some(m => m.read_at != null);
  const replied = inbound.length > 0;
  const sent = outbound.length > 0;
  let reason = 'unknown';
  if (!messages.length) reason = 'no_history';
  else if (!sent) reason = 'no_outbound';
  else if (replied) reason = 'responded';
  else if (!delivered) reason = 'not_delivered';
  else if (!read) reason = 'delivered_not_read';
  else reason = 'read_no_reply';
  const text = hsm && hsm.text ? redactPII(hsm.text).slice(0, 260) : 'Copy não disponível na API';
  return { messages, outbound, inbound, sent, delivered, read, replied, reason, copy: text };
}

function pct(num, den) {
  return den ? num / den : null;
}

function emptyAgg(key, label) {
  return { key, label: label || key, sessions: 0, sent: 0, delivered: 0, read: 0, replied: 0, failures: 0, reasons: {}, samples: [] };
}

function addAgg(map, key, label, row) {
  if (!map[key]) map[key] = emptyAgg(key, label);
  const a = map[key];
  a.sessions += 1;
  if (row.sent) a.sent += 1;
  if (row.delivered) a.delivered += 1;
  if (row.read) a.read += 1;
  if (row.replied) a.replied += 1;
  if (row.reason !== 'responded') a.failures += 1;
  a.reasons[row.reason] = (a.reasons[row.reason] || 0) + 1;
  if (a.samples.length < 3 && row.copy && row.copy !== 'Copy não disponível na API') a.samples.push(row.copy);
}

function finishAgg(a) {
  const entries = Object.keys(a.reasons).map(k => ({ key: k, count: a.reasons[k], label: (REASON_META[k] || REASON_META.unknown).label }));
  entries.sort((x, y) => y.count - x.count);
  const top = entries[0] || { key: 'unknown', label: REASON_META.unknown.label, count: 0 };
  return Object.assign(a, {
    deliveryRate: pct(a.delivered, a.sent),
    readRate: pct(a.read, a.delivered),
    responseRate: pct(a.replied, a.sent),
    failureRate: pct(a.failures, a.sessions),
    topReason: top,
    reasonRows: entries
  });
}

function buildRows(flows, sessionsByFlow, historiesBySession) {
  const rows = [];
  flows.forEach(flow => {
    const label = flowLabel(flow);
    const bdr = inferBdr(label);
    const family = copyFamily(label);
    const sessions = sessionsByFlow[flow.id] || [];
    sessions.forEach(session => {
      const history = historiesBySession[session.id] || [];
      const h = summarizeHistory(history);
      rows.push({
        id: 's' + rows.length,
        flowId: String(flow.id),
        flow: label,
        bdr,
        bdrSource: 'Inferido pelo nome do flow | ajustar nomenclatura na Treble para 100% de precisão',
        family,
        createdAt: tsToIso(session.created_at),
        finishedAt: tsToIso(session.finished_at),
        sent: h.sent,
        delivered: h.delivered,
        read: h.read,
        replied: h.replied,
        reason: h.reason,
        reasonLabel: (REASON_META[h.reason] || REASON_META.unknown).label,
        severity: (REASON_META[h.reason] || REASON_META.unknown).severity,
        action: (REASON_META[h.reason] || REASON_META.unknown).action,
        copy: h.copy,
        outboundCount: h.outbound.length,
        inboundCount: h.inbound.length,
        messageCount: h.messages.length
      });
    });
  });
  return rows.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

function aggregate(rows) {
  const byFlow = {}, byBdr = {}, byFamily = {}, byDay = {}, byReason = {};
  rows.forEach(r => {
    addAgg(byFlow, r.flow, r.flow, r);
    addAgg(byBdr, r.bdr, r.bdr, r);
    addAgg(byFamily, r.family, r.family, r);
    addAgg(byDay, dayKey(r.createdAt), dayKey(r.createdAt), r);
    if (!byReason[r.reason]) byReason[r.reason] = { key: r.reason, label: r.reasonLabel, count: 0, severity: r.severity, action: r.action };
    byReason[r.reason].count += 1;
  });
  const arr = obj => Object.keys(obj).map(k => finishAgg(obj[k])).sort((a, b) => b.sessions - a.sessions || a.label.localeCompare(b.label));
  const reasonRows = Object.keys(byReason).map(k => byReason[k]).sort((a, b) => b.count - a.count);
  const summary = finishAgg(rows.reduce((a, r) => {
    a.sessions += 1;
    if (r.sent) a.sent += 1;
    if (r.delivered) a.delivered += 1;
    if (r.read) a.read += 1;
    if (r.replied) a.replied += 1;
    if (r.reason !== 'responded') a.failures += 1;
    a.reasons[r.reason] = (a.reasons[r.reason] || 0) + 1;
    return a;
  }, emptyAgg('total', 'Total')));
  summary.notDelivered = rows.filter(r => r.reason === 'not_delivered').length;
  summary.deliveredNotRead = rows.filter(r => r.reason === 'delivered_not_read').length;
  summary.readNoReply = rows.filter(r => r.reason === 'read_no_reply').length;
  summary.noHistory = rows.filter(r => r.reason === 'no_history').length;
  return { summary, byFlow: arr(byFlow), byBdr: arr(byBdr), byFamily: arr(byFamily), byDay: arr(byDay).sort((a, b) => a.key.localeCompare(b.key)), byReason: reasonRows };
}

async function buildPayload(token, days) {
  const until = Math.floor(Date.now() / 1000);
  const since = until - days * 24 * 60 * 60;
  const flowsRaw = await trebleGet(token, '/poll/api/all');
  const flows = (Array.isArray(flowsRaw) ? flowsRaw : []).slice(0, MAX_FLOWS).map(f => ({ id: String(f.id), name: flowLabel(f), settingsPresent: !!f.settings }));
  const sessionsByFlow = {};
  const flowErrors = [];
  let sessionsTruncated = false;
  await Promise.all(flows.map(async flow => {
    try {
      const path = '/devapi/poll/' + encodeURIComponent(flow.id) + '/sessions?limit=' + MAX_SESSIONS_PER_FLOW + '&since=' + since + '&until=' + until;
      const resp = await trebleGet(token, path);
      const results = Array.isArray(resp.results) ? resp.results : [];
      if (resp.next_id) sessionsTruncated = true;
      sessionsByFlow[flow.id] = results.filter(s => s && s.id).slice(0, MAX_SESSIONS_PER_FLOW);
    } catch (e) {
      sessionsByFlow[flow.id] = [];
      flowErrors.push({ flow: flow.name, reason: 'flow_api_error' });
    }
  }));
  const allSessions = [];
  flows.forEach(flow => (sessionsByFlow[flow.id] || []).forEach(s => allSessions.push({ flowId: flow.id, session: s })));
  allSessions.sort((a, b) => String(b.session.created_at || '').localeCompare(String(a.session.created_at || '')));
  const limited = allSessions.slice(0, MAX_HISTORIES);
  const historiesBySession = {};
  for (let i = 0; i < limited.length; i += 20) {
    const chunk = limited.slice(i, i + 20);
    await Promise.all(chunk.map(async item => {
      try {
        historiesBySession[item.session.id] = await trebleGet(token, '/devapi/session/' + encodeURIComponent(item.session.id) + '/history');
      } catch (e) {
        historiesBySession[item.session.id] = [];
      }
    }));
  }
  const sessionsByFlowLimited = {};
  const keep = new Set(limited.map(x => x.session.id));
  flows.forEach(flow => { sessionsByFlowLimited[flow.id] = (sessionsByFlow[flow.id] || []).filter(s => keep.has(s.id)); });
  const rows = buildRows(flows, sessionsByFlowLimited, historiesBySession);
  flowErrors.forEach(err => rows.push({
    id: 'flow_error_' + rows.length,
    flowId: 'error',
    flow: err.flow,
    bdr: inferBdr(err.flow),
    bdrSource: 'Inferido pelo nome do flow | ajustar nomenclatura na Treble para 100% de precisão',
    family: copyFamily(err.flow),
    createdAt: null,
    finishedAt: null,
    sent: false,
    delivered: false,
    read: false,
    replied: false,
    reason: 'flow_api_error',
    reasonLabel: REASON_META.flow_api_error.label,
    severity: REASON_META.flow_api_error.severity,
    action: REASON_META.flow_api_error.action,
    copy: 'Flow não retornou sessões na API Treble nesta consulta',
    outboundCount: 0,
    inboundCount: 0,
    messageCount: 0
  }));
  const aggs = aggregate(rows);
  return Object.assign({
    success: true,
    generatedAt: new Date().toISOString(),
    cached: false,
    stale: false,
    meta: {
      source: 'Treble API oficial | polls | sessions | history',
      days,
      since: new Date(since * 1000).toISOString(),
      until: new Date(until * 1000).toISOString(),
      cacheTtlMinutes: Math.round(CACHE_TTL_MS / 60000),
      flowsScanned: flows.length,
      sessionsFound: allSessions.length,
      sessionsAnalyzed: rows.length,
      flowErrors: flowErrors.length,
      sessionsTruncated: sessionsTruncated || allSessions.length > MAX_HISTORIES,
      maxHistories: MAX_HISTORIES,
      labelModel: 'Flow vem do nome real da conversa Treble | BDR e família de copy são inferidos do nome do flow',
      privacy: 'Sem telefone, email, documento, session_id ou payload bruto | copy outbound redigida por heurística | inbound ocultado por classificação de resposta',
      limitations: [
        'Motivo é diagnóstico observado por entrega, leitura e resposta | não é motivo Meta bruto.',
        'Falhas de deployment com failure_reason exigem webhook deployment.failure ativo.',
        'Labels de BDR dependem de nomenclatura do flow na Treble.'
      ]
    },
    messages: rows,
    flows: flows.map(f => ({ label: f.name, bdr: inferBdr(f.name), family: copyFamily(f.name) }))
  }, aggs);
}

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['GET'])) return;
  if (!requireAuth(req, res)) return;
  let token;
  try { token = tokenFromEnv(); }
  catch (e) { return res.status(503).json({ success: false, error: 'Treble API não configurada no servidor.' }); }
  const days = clampDays(req.query && req.query.days);
  const refresh = String((req.query && req.query.refresh) || '') === 'true';
  const key = 'v2:days:' + days;
  const cached = cacheByKey[key];
  if (!refresh && cached && Date.now() - cached.time < CACHE_TTL_MS) {
    return res.status(200).json(Object.assign({}, cached.payload, { cached: true, stale: false }));
  }
  try {
    const payload = await withDeadline(buildPayload(token, days), BUILD_DEADLINE_MS);
    cacheByKey[key] = { payload, time: Date.now() };
    return res.status(200).json(payload);
  } catch (e) {
    console.error('[bdr-treble]', e.message);
    if (cached && cached.payload) return res.status(200).json(Object.assign({}, cached.payload, { cached: true, stale: true }));
    return res.status(500).json({ success: false, error: 'Não foi possível carregar dados analíticos da Treble.' });
  }
};
