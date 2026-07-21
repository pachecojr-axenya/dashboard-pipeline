'use strict';
/**
 * GET /api/bdr-workload-calls?bdr=<nome>&since=YYYY-MM-DD&until=YYYY-MM-DD
 *
 * Drill-down LAZY das ligações de um BDR na janela: separa conversa × discagem,
 * agrupa por desfecho/duração e enriquece com "para quem" (contato/empresa)
 * via associação call→contact. Chamado só quando o usuário abre o detalhe —
 * não onera a carga principal de /api/bdr-workload.
 *
 * Privacidade: NUNCA retorna telefone, e-mail ou payload bruto. Só nome do
 * contato + empresa. Degrada: se a associação falhar, retorna o breakdown sem
 * "para quem".
 *
 * Ambientes: cache KV namespaced por env (lib/env). Ver
 * openspec/changes/bdr-intraday-history-drilldown/.
 *
 * NOTA: roster (BDR_TEAM/HS_ALIAS/norm) duplicado de api/bdr-workload.js e
 * api/bdr-leads.js — dívida técnica conhecida; convergir para lib/bdr-roster.js
 * na Fase 2. 13 BDRs estáveis (squad RH Summit).
 */

const { hubspotPost, hubspotGet } = require('../lib/hubspot');
const { setCORSHeaders, requireAuth, getHubspotToken, methodCheck } = require('./_helpers');
const kv = require('../lib/kv');
const env = require('../lib/env');
const { BDR_TEAM, HS_ALIAS, norm, resolveTeamIds } = require('../lib/bdr-team');

const MIN_CONVERSA = 60000; // 1 min em ms — mesmo corte da página

async function fetchOwnersRaw(token) {
  const map = {};
  for (const archived of ['false', 'true']) {
    let after, hasMore = true;
    while (hasMore) {
      const resp = await hubspotGet(token, `/crm/v3/owners?limit=200&archived=${archived}` + (after ? `&after=${after}` : ''));
      (resp.results || []).forEach(o => { map[o.id] = `${o.firstName || ''} ${o.lastName || ''}`.trim() || o.email || o.id; });
      hasMore = resp.paging && resp.paging.next && resp.paging.next.after != null;
      after = hasMore ? resp.paging.next.after : null;
    }
  }
  return map;
}

async function searchAll(token, objectType, filters, properties) {
  const all = [];
  let after = 0, hasMore = true;
  while (hasMore) {
    const resp = await hubspotPost(token, `/crm/v3/objects/${objectType}/search`, {
      filterGroups: [{ filters }], properties,
      sorts: [{ propertyName: 'hs_timestamp', direction: 'DESCENDING' }], limit: 200, after,
    });
    all.push(...(resp.results || []));
    hasMore = resp.paging && resp.paging.next && resp.paging.next.after != null;
    after = hasMore ? resp.paging.next.after : 0;
    if (all.length >= 5000) break; // teto defensivo (janela por BDR é curta)
  }
  return all;
}
async function fetchCallDispositions(token) {
  try {
    const list = await hubspotGet(token, '/calls/v1/dispositions');
    const map = {};
    (Array.isArray(list) ? list : []).forEach(d => { map[d.id] = d.label; });
    return map;
  } catch (e) { return {}; }
}

// Associação call -> contato (v4 batch). Retorna { callId: contactId }.
async function fetchCallContacts(token, callIds) {
  const out = {};
  for (let i = 0; i < callIds.length; i += 100) {
    const batch = callIds.slice(i, i + 100);
    try {
      const resp = await hubspotPost(token, '/crm/v4/associations/calls/contacts/batch/read', {
        inputs: batch.map(id => ({ id })),
      });
      (resp.results || []).forEach(r => {
        const to = (r.to || [])[0];
        if (r.from && to) out[r.from.id] = String(to.toObjectId);
      });
    } catch (e) { /* degrada: sem "para quem" para este lote */ }
  }
  return out;
}
async function fetchContactsById(token, ids) {
  const map = {};
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    try {
      const resp = await hubspotPost(token, '/crm/v3/objects/contacts/batch/read', {
        inputs: batch.map(id => ({ id })),
        properties: ['firstname', 'lastname', 'associatedcompanyid'],
      });
      (resp.results || []).forEach(r => {
        const p = r.properties || {};
        map[r.id] = { nome: `${p.firstname || ''} ${p.lastname || ''}`.trim() || null, companyId: p.associatedcompanyid || null };
      });
    } catch (e) { /* degrada */ }
  }
  return map;
}
async function fetchCompanyNames(token, ids) {
  const map = {};
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    try {
      const resp = await hubspotPost(token, '/crm/v3/objects/companies/batch/read', {
        inputs: batch.map(id => ({ id })), properties: ['name'],
      });
      (resp.results || []).forEach(r => { map[r.id] = (r.properties && r.properties.name) || null; });
    } catch (e) { /* degrada */ }
  }
  return map;
}

const DURATION_BUCKETS = [
  ['0s', 0, 1], ['<30s', 1, 30000], ['30s–1min', 30000, 60000],
  ['1–3min', 60000, 180000], ['3–10min', 180000, 600000], ['>10min', 600000, Infinity],
];
function bucketOf(ms) {
  const v = ms == null ? 0 : ms;
  for (const [label, lo, hi] of DURATION_BUCKETS) if (v >= lo && v < hi) return label;
  return '>10min';
}

function paginationOptions(q) {
  return {
    detail: q.get('detail') === '1',
    page: Math.max(1, Number(q.get('page') || 1)),
    limit: Math.min(50, Math.max(1, Number(q.get('limit') || 50))),
  };
}

function summarizeRows(rows, dispMap) {
  const byDesfecho = {}, byBucket = {};
  let conversas = 0;
  rows.forEach(r => {
    const p = r.properties || {};
    const ms = p.hs_call_duration != null && p.hs_call_duration !== '' ? Number(p.hs_call_duration) : null;
    const desfecho = dispMap[p.hs_call_disposition] || 'Sem desfecho';
    byDesfecho[desfecho] = (byDesfecho[desfecho] || 0) + 1;
    const bucket = bucketOf(ms); byBucket[bucket] = (byBucket[bucket] || 0) + 1;
    if (ms != null && ms >= MIN_CONVERSA) conversas++;
  });
  return {
    total: rows.length,
    conversas,
    discagens: rows.length - conversas,
    pctConversa: rows.length ? Math.round(conversas / rows.length * 100) : 0,
    byDesfecho,
    byBucket,
  };
}

async function build(token, bdrName, sinceMs, untilMs, options = {}) {
  const ownerMap = await fetchOwnersRaw(token);
  const idToBdr = resolveTeamIds(ownerMap);
  const ownerIds = Object.keys(idToBdr).filter(id => idToBdr[id] === bdrName);
  if (!ownerIds.length) throw new Error(`BDR não encontrado no time canônico: ${bdrName}`);

  const dispMap = await fetchCallDispositions(token);
  const rows = await searchAll(token, 'calls', [
    { propertyName: 'hubspot_owner_id', operator: 'IN', values: ownerIds },
    { propertyName: 'hs_timestamp', operator: 'BETWEEN', value: String(sinceMs), highValue: String(untilMs) },
  ], ['hs_timestamp', 'hs_call_duration', 'hs_call_disposition', 'hs_call_title']);

  const detail = options.detail === true;
  const page = Math.max(1, Number(options.page || 1));
  const limit = Math.min(50, Math.max(1, Number(options.limit || 50)));
  const pageRows = detail ? rows.slice((page - 1) * limit, page * limit) : [];
  const callIds = pageRows.map(r => r.id);
  const callToContact = detail ? await fetchCallContacts(token, callIds) : {};
  const contactIds = [...new Set(Object.values(callToContact))];
  const contactMap = contactIds.length ? await fetchContactsById(token, contactIds) : {};
  const companyIds = [...new Set(Object.values(contactMap).map(c => c && c.companyId).filter(Boolean))];
  const companyMap = companyIds.length ? await fetchCompanyNames(token, companyIds) : {};

  const enrichAttempted = detail && callIds.length > 0;
  const enrichOk = Object.keys(callToContact).length > 0;

  const calls = pageRows.map(r => {
    const p = r.properties || {};
    const ms = p.hs_call_duration != null && p.hs_call_duration !== '' ? Number(p.hs_call_duration) : null;
    const cid = callToContact[r.id];
    const contact = cid ? contactMap[cid] : null;
    return {
      ts: p.hs_timestamp || null,
      duracao_ms: ms,
      conversa: ms != null && ms >= MIN_CONVERSA,
      desfecho: dispMap[p.hs_call_disposition] || 'Sem desfecho',
      contato: contact ? contact.nome : null,
      empresa: contact && contact.companyId ? (companyMap[contact.companyId] || null) : null,
    };
  });

  // Agregados reconciliam com TODAS as linhas; o detalhe nominal é paginado.
  const summary = summarizeRows(rows, dispMap);

  return {
    success: true,
    bdr: bdrName,
    total: summary.total,
    conversas: summary.conversas,
    discagens: summary.discagens,
    pctConversa: summary.pctConversa,
    byDesfecho: summary.byDesfecho,
    byBucket: summary.byBucket,
    ...(detail ? { calls, pagination: { page, limit, total: rows.length, totalPages: Math.ceil(rows.length / limit) } } : {}),
    enriched: enrichAttempted ? enrichOk : null, // null = sem ligações; false = tentou e não veio "para quem"
    env: env.name,
  };
}

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['GET'])) return;
  const user = requireAuth(req, res);
  if (!user) return;

  let token;
  try { token = getHubspotToken(); }
  catch (e) { return res.status(503).json({ success: false, error: e.message }); }

  const q = new URL(`http://x${req.url}`).searchParams;
  const bdr = q.get('bdr');
  const since = q.get('since'), until = q.get('until');
  const reISO = /^\d{4}-\d{2}-\d{2}$/;
  if (!bdr) return res.status(400).json({ success: false, error: 'bdr obrigatório' });
  if (!reISO.test(since || '') || !reISO.test(until || '')) {
    return res.status(400).json({ success: false, error: 'since e until obrigatórios (YYYY-MM-DD)' });
  }
  const sinceMs = Date.parse(`${since}T00:00:00.000-03:00`);
  const untilMs = Date.parse(`${until}T23:59:59.999-03:00`);
  if (!(sinceMs <= untilMs)) return res.status(400).json({ success: false, error: 'since > until' });

  const kvKey = env.kvKey(`workload-calls:${bdr}|${since}|${until}`);
  const refresh = q.get('refresh') === '1';
  const { detail, page, limit } = paginationOptions(q);
  const scopedKvKey = `${kvKey}|detail:${detail ? 1 : 0}|page:${page}|limit:${limit}`;
  const CACHE_TTL = 5 * 60 * 1000;

  try {
    if (!refresh && kv.isConfigured()) {
      try {
        const hit = await kv.getJSON(scopedKvKey);
        if (hit && Date.now() - hit.at < CACHE_TTL) return res.status(200).json({ ...hit.data, cached: true });
      } catch (e) { /* segue para live */ }
    }
    const data = await build(token, bdr, sinceMs, untilMs, { detail, page, limit });
    if (kv.isConfigured()) { try { await kv.setJSON(scopedKvKey, { at: Date.now(), data }); } catch (e) { /* best-effort */ } }
    return res.status(200).json(data);
  } catch (e) {
    console.error('[bdr-workload-calls]', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
};

module.exports._test = { bucketOf, summarizeRows, build, paginationOptions, MIN_CONVERSA };
