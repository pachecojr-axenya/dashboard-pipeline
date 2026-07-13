'use strict';
/**
 * GET /api/bdr-treble
 *
 * Painel interno BDR | Treble. Fonte operacional: HubSpot communications
 * WHATS_APP já sincronizadas pelo pipeline Treble | HubSpot. Este endpoint não
 * chama Treble, não envia mensagens e não expõe payload bruto, contatos ou tokens.
 */

const { setCORSHeaders, requireAuth, getHubspotToken, methodCheck } = require('./_helpers');
const { hubspotPost, hubspotGet } = require('../lib/hubspot');

const CACHE_TTL_MS = 10 * 60 * 1000;
const PORTAL_ID = '44715285';
const DEFAULT_DAYS = 180;
const MIN_DAYS = 7;
const MAX_DAYS = 365;
const MAX_COMMUNICATIONS = 2000;
const BUILD_DEADLINE_MS = 50000;
const COMMUNICATION_PROPS = [
  'hs_object_id',
  'hs_timestamp',
  'hs_createdate',
  'hs_lastmodifieddate',
  'hs_communication_channel_type',
  'hs_communication_body',
  'hs_communication_direction',
  'hs_communication_status',
  'hubspot_owner_id'
];
const CONTACT_PROPS = ['hubspot_owner_id', 'hs_object_id'];
const FLOW_NONE = 'Sem identificação de flow';
const OWNER_NONE = 'Sem owner no contato';
const TREBLE_MARKER_RE = /WhatsApp\s+Treble|Treble\s+session|Treble\s+conversation|Origem\s+evento|Dedupe|poll_id|session_id|conversation_id/i;

let cacheByKey = {};

function clampDays(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULT_DAYS;
  return Math.max(MIN_DAYS, Math.min(MAX_DAYS, n));
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
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
  return String(value || '')
    .replace(/https?:\/\/[^\s|]+/gi, '[link redigido]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email redigido]')
    .replace(/(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?(?:9\s*)?\d{4}[-\s]?\d{4}/g, '[telefone redigido]')
    .replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, '[cnpj redigido]')
    .replace(/\b\d{14}\b/g, '[cnpj redigido]')
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '[cpf redigido]')
    .replace(/\b\d{11}\b/g, '[cpf redigido]')
    .replace(/\b(nome|contato|contact)\s*[:=]\s*[^|,;]+/gi, '$1: [nome redigido]')
    .replace(/\b(ol[aá]|oi|prezad[oa])\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÁÉÍÓÚÂÊÔÃÕÇáéíóúâêôãõç]+)(\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÁÉÍÓÚÂÊÔÃÕÇáéíóúâêôãõç]+)?\b/gi, '$1 [nome redigido]');
}

function snippetFrom(body, direction) {
  if (direction === 'INBOUND') return '[resposta recebida | conteúdo ocultado]';
  const text = redactPII(stripHtml(body));
  const max = direction === 'INBOUND' ? 160 : 240;
  return text.length > max ? text.slice(0, max - 1).trim() + '…' : text;
}

function isoDate(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function dateKey(v) {
  const iso = isoDate(v);
  return iso ? iso.slice(0, 10) : 'Sem data';
}

function safeId(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  if (/@/.test(s)) return null;
  if (/\+?\d[\d\s().-]{7,}/.test(s)) return null;
  if (/\b\d{11,14}\b/.test(s.replace(/\D/g, ''))) return null;
  if (s.length > 80) return null;
  const safe = s.replace(/[<>"'`\\;{}\[\]()]/g, '').trim();
  return safe ? redactPII(safe) : null;
}

function tagValue(text, labels) {
  for (const label of labels) {
    const re = new RegExp(label + '\\s*[:=]\\s*([^|\\n\\r<]+)', 'i');
    const m = String(text || '').match(re);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

function normalizeDirection(raw, text) {
  const s = String(raw || '').toLowerCase() + ' ' + String(text || '').toLowerCase();
  if (/\b(inbound|entrada|recebida|incoming|resposta|received)\b/.test(s)) return 'INBOUND';
  if (/\b(outbound|saida|saída|enviada|sent|envio|hsm)\b/.test(s)) return 'OUTBOUND';
  return 'UNKNOWN';
}

function normalizeStatus(raw, text, direction) {
  const s = (String(raw || '') + ' ' + String(text || '')).toLowerCase();
  if (/\b(read|lida|visualizada)\b/.test(s)) return { value: 'READ', label: 'Lida', measurability: 'Cobertura parcial' };
  if (/\b(delivered|entregue)\b/.test(s)) return { value: 'DELIVERED', label: 'Entregue', measurability: 'Cobertura parcial' };
  if (/\b(failed|erro|falha|undelivered|não entregue|nao entregue)\b/.test(s)) return { value: 'FAILED', label: 'Falha', measurability: 'Disponível' };
  if (/\b(sent|enviada|enviado)\b/.test(s)) return { value: 'SENT', label: 'Enviada', measurability: 'Disponível' };
  if (direction === 'INBOUND' || /\b(received|recebida|resposta|inbound)\b/.test(s)) return { value: 'RECEIVED', label: 'Resposta', measurability: 'Disponível' };
  return { value: 'UNKNOWN', label: 'Não medido', measurability: 'Não medido' };
}

function flowFrom(text) {
  const named = tagValue(text, ['Campanha', 'Campaign', 'Flow', 'Fluxo']);
  const namedSafe = safeId(named);
  if (namedSafe && !/^\d+$/.test(namedSafe)) return namedSafe;
  const internal = tagValue(text, ['Treble conversation', 'Conversation', 'conversation_id', 'Poll', 'poll_id']);
  return internal ? `__TREBLE_INTERNAL__${internal}` : FLOW_NONE;
}

function withDeadline(promise, ms) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Consulta Treble | HubSpot excedeu o limite de tempo.')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function fetchOwnersRaw(token) {
  const map = {};
  for (const archived of ['false', 'true']) {
    let after;
    let hasMore = true;
    while (hasMore) {
      const resp = await hubspotGet(token, '/crm/v3/owners?limit=200&archived=' + archived + (after ? '&after=' + encodeURIComponent(after) : ''));
      (resp.results || []).forEach(o => {
        const name = `${o.firstName || ''} ${o.lastName || ''}`.trim();
        map[o.id] = name || String(o.id);
      });
      hasMore = resp.paging && resp.paging.next && resp.paging.next.after != null;
      after = hasMore ? resp.paging.next.after : null;
    }
  }
  return map;
}

async function searchCommunications(token, days) {
  const all = [];
  let after = 0;
  let hasMore = true;
  const since = String(Date.now() - days * 24 * 60 * 60 * 1000);
  let truncated = false;
  while (hasMore && all.length < MAX_COMMUNICATIONS) {
    const resp = await hubspotPost(token, '/crm/v3/objects/communications/search', {
      filterGroups: [{ filters: [
        { propertyName: 'hs_communication_channel_type', operator: 'EQ', value: 'WHATS_APP' },
        { propertyName: 'hs_timestamp', operator: 'GTE', value: since }
      ] }],
      properties: COMMUNICATION_PROPS,
      sorts: [{ propertyName: 'hs_timestamp', direction: 'DESCENDING' }],
      limit: 200,
      after
    });
    all.push(...(resp.results || []));
    hasMore = resp.paging && resp.paging.next && resp.paging.next.after != null;
    after = hasMore ? resp.paging.next.after : 0;
  }
  if (hasMore) truncated = true;
  return {
    records: all.filter(r => TREBLE_MARKER_RE.test(String((r.properties || {}).hs_communication_body || ''))),
    truncated
  };
}

async function associationMap(token, ids) {
  const out = {};
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const resp = await hubspotPost(token, '/crm/v4/associations/communications/contacts/batch/read', { inputs: chunk.map(id => ({ id })) });
    (resp.results || []).forEach(r => {
      out[String(r.from && r.from.id)] = (r.to || []).map(t => String(t.toObjectId)).filter(Boolean);
    });
  }
  return out;
}

async function batchReadContacts(token, ids) {
  const out = {};
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const resp = await hubspotPost(token, '/crm/v3/objects/contacts/batch/read', {
      properties: CONTACT_PROPS,
      inputs: chunk.map(id => ({ id }))
    });
    (resp.results || []).forEach(r => { out[String(r.id)] = r.properties || {}; });
  }
  return out;
}

function pct(num, den) {
  return den ? num / den : null;
}

function buildSummary(messages) {
  const outbound = messages.filter(m => m.direction === 'OUTBOUND');
  const inbound = messages.filter(m => m.direction === 'INBOUND');
  const failed = messages.filter(m => m.status === 'FAILED');
  const delivered = messages.filter(m => m.status === 'DELIVERED' || m.status === 'READ');
  const read = messages.filter(m => m.status === 'READ');
  const statusMeasured = messages.filter(m => m.status !== 'UNKNOWN');
  const withoutOwner = messages.filter(m => !m.ownerPresent);
  return {
    total: messages.length,
    outbound: outbound.length,
    inbound: inbound.length,
    responses: inbound.length,
    failed: failed.length,
    delivered: delivered.length,
    read: read.length,
    withoutOwner: withoutOwner.length,
    statusMeasured: statusMeasured.length,
    deliveredState: delivered.length ? 'Cobertura parcial' : 'Não medido',
    readState: read.length ? 'Cobertura parcial' : 'Não medido',
    statusCoverage: pct(statusMeasured.length, messages.length),
    responseRate: pct(inbound.length, outbound.length),
    failureRate: pct(failed.length, outbound.length)
  };
}

function aggregate(messages, field) {
  const map = {};
  messages.forEach(m => {
    const key = m[field] || 'Sem dado';
    if (!map[key]) map[key] = { key, total: 0, outbound: 0, inbound: 0, failed: 0, delivered: 0, read: 0, unknown: 0, withoutOwner: 0, lastTimestamp: null };
    const row = map[key];
    row.total += 1;
    if (m.direction === 'OUTBOUND') row.outbound += 1;
    if (m.direction === 'INBOUND') row.inbound += 1;
    if (m.status === 'FAILED') row.failed += 1;
    if (m.status === 'DELIVERED' || m.status === 'READ') row.delivered += 1;
    if (m.status === 'READ') row.read += 1;
    if (m.status === 'UNKNOWN') row.unknown += 1;
    if (!m.ownerPresent) row.withoutOwner += 1;
    if (!row.lastTimestamp || String(m.timestamp || '') > String(row.lastTimestamp || '')) row.lastTimestamp = m.timestamp;
  });
  return Object.keys(map).map(k => {
    const r = map[k];
    r.responseRate = pct(r.inbound, r.outbound);
    r.failureRate = pct(r.failed, r.outbound);
    r.statusCoverage = pct(r.total - r.unknown, r.total);
    r.responseScore = r.inbound / (r.outbound + 10);
    return r;
  }).sort((a, b) => b.total - a.total || String(a.key).localeCompare(String(b.key)));
}

function aggregateByDay(messages) {
  const copy = messages.map(m => Object.assign({}, m, { day: dateKey(m.timestamp) }));
  return aggregate(copy, 'day').sort((a, b) => String(a.key).localeCompare(String(b.key)));
}

async function buildPayload(token, days) {
  const [owners, search] = await Promise.all([fetchOwnersRaw(token), searchCommunications(token, days)]);
  const raw = search.records;
  const commIds = raw.map(r => String(r.id));
  const assoc = await associationMap(token, commIds);
  const contactIds = [...new Set(Object.values(assoc).flat())];
  const contacts = await batchReadContacts(token, contactIds);

  const flowLabels = {};
  let nextInternalFlow = 1;
  function displayFlow(value) {
    if (!String(value).startsWith('__TREBLE_INTERNAL__')) return value;
    if (!flowLabels[value]) {
      flowLabels[value] = 'Flow interno ' + String(nextInternalFlow).padStart(2, '0');
      nextInternalFlow += 1;
    }
    return flowLabels[value];
  }

  const messages = raw.map(r => {
    const p = r.properties || {};
    const text = stripHtml(p.hs_communication_body || '');
    const directionRaw = tagValue(text, ['Direção', 'Direction']) || p.hs_communication_direction || '';
    const direction = normalizeDirection(directionRaw, text);
    const statusRaw = tagValue(text, ['Status']) || p.hs_communication_status || '';
    const status = normalizeStatus(statusRaw, text, direction);
    const ids = assoc[String(r.id)] || [];
    const primaryContact = ids.length ? contacts[ids[0]] || {} : {};
    const ownerId = primaryContact.hubspot_owner_id || p.hubspot_owner_id || null;
    const bdr = ownerId ? (owners[ownerId] || String(ownerId)) : OWNER_NONE;
    const flow = displayFlow(flowFrom(text));
    return {
      id: String(r.id),
      hubspotUrl: `https://app.hubspot.com/contacts/${PORTAL_ID}/record/0-18/${r.id}`,
      timestamp: isoDate(p.hs_timestamp || p.hs_createdate),
      updatedAt: isoDate(p.hs_lastmodifieddate),
      direction,
      status: status.value,
      statusLabel: status.label,
      bdr,
      bdrSource: ownerId ? 'Owner atual do contato associado | proxy inicial, não autor histórico por mensagem' : 'Sem owner associado | não atribuído',
      ownerPresent: !!ownerId,
      flow,
       hasFlow: flow !== FLOW_NONE,
       snippet: snippetFrom(p.hs_communication_body || '', direction),
      contactAssociationCount: ids.length,
      measurability: status.measurability
    };
  }).sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    cached: false,
    stale: false,
    meta: {
       source: 'HubSpot communications | channel WHATS_APP | communications sincronizadas pelo pipeline Treble | HubSpot',
       operationalOrigin: 'Treble API alimenta o Cloud Run existente | Vercel lê somente HubSpot communications sincronizadas',
      days,
      since: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(),
      cacheTtlMinutes: Math.round(CACHE_TTL_MS / 60000),
       maxCommunications: MAX_COMMUNICATIONS,
       truncated: search.truncated,
      rawTrebleCommunications: raw.length,
       associationModel: 'communication | contact em batch | owner atual do contato como proxy inicial de BDR',
       privacy: 'Sem emails, telefones ou documentos de contatos; snippets outbound redigidos por heurística e inbound ocultado.',
      limitations: [
        'BDR é proxy do owner atual do contato associado, não autor histórico por mensagem.',
        'Entrega/leitura dependem da cobertura sincronizada para HubSpot; Não medido não significa zero.',
         'Flow vem de metadata Treble gravada na communication quando disponível.',
         'Taxa de resposta é por mensagem | inbound dividido por outbound | não é taxa por conversa distinta.',
         'Snippets inbound ocultam o conteúdo para reduzir exposição de dados pessoais; outbound preserva a copy redigida.'
      ]
    },
    summary: buildSummary(messages),
    byBdr: aggregate(messages, 'bdr'),
    byFlow: aggregate(messages, 'flow'),
    byDay: aggregateByDay(messages),
    messages
  };
}

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['GET'])) return;
  const user = requireAuth(req, res);
  if (!user) return;

  let token;
  try { token = getHubspotToken(); }
  catch (e) { return res.status(503).json({ success: false, error: 'HubSpot token não configurado no servidor.' }); }

  const days = clampDays(req.query && req.query.days);
  const refresh = String((req.query && req.query.refresh) || '') === 'true';
  const key = 'days:' + days;
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
    return res.status(500).json({ success: false, error: 'Não foi possível carregar communications WhatsApp Treble do HubSpot.' });
  }
};
