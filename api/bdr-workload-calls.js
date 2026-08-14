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
 *
 * MIGRADO para a fonte única (F5, 07/08/2026): `silver.fact_engagement` +
 * `dim_call_disposition` (via `disposition_label`) + `dim_contact` + `dim_company`.
 * O rótulo do desfecho é o do PORTAL, não o padrão da doc — quatro desfechos
 * deste portal estão semanticamente trocados (armadilha A16).
 *
 * Custo antes: 1 busca paginada de calls + 3 rodadas de batch (call→contact,
 * contact, company) + 2 páginas de /crm/v3/owners, por request. Agora: 2 consultas.
 * `?fonte=api` mantém a rota antiga viva para comparar.
 */

const { hubspotPost, hubspotGet } = require('../lib/hubspot');
const { setCORSHeaders, requireAuth, getHubspotToken, methodCheck } = require('./_helpers');
const kv = require('../lib/kv');
const env = require('../lib/env');
const { BDR_TEAM, HS_ALIAS, norm, resolveTeamIds, bdrExitDate } = require('../lib/bdr-team');
const whq = require('../lib/hubspot-wh-queries');
const wh = require('../lib/hubspot-warehouse');

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
    // O caminho é `/calling/v1/`, não `/calls/v1/`. Estava errado desde sempre e
    // o `catch` devolvia `{}` em silêncio — resultado: TODA ligação caía em
    // "Sem desfecho" e o card de desfechos estava morto em produção sem nunca ter
    // dado erro. Medido em 07/08/2026: 688 de 688 ligações de um BDR sem desfecho
    // pela API, contra 634 Ocupado / 50 Conectado / 4 sem desfecho no armazém.
    const list = await hubspotGet(token, '/calling/v1/dispositions');
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
  const viaBQ = options.fonte !== 'api' && wh.isConfigured();

  // O roster continua sendo a régua: `resolveTeamIds` casa nome do dono com o
  // time canônico. Só a ORIGEM do mapa de donos muda — e o armazém tem 187 donos
  // onde /crm/v3/owners entregava 54. Roster em código foi o que fez um BDR com
  // 909 atividades vivas desaparecer do BI; a régua fica, a fonte melhora.
  const ownerMap = viaBQ ? await whq.ownerMap() : await fetchOwnersRaw(token);
  const idToBdr = resolveTeamIds(ownerMap);
  const ownerIds = Object.keys(idToBdr).filter(id => idToBdr[id] === bdrName);
  if (!ownerIds.length) throw new Error(`BDR não encontrado no time canônico: ${bdrName}`);

  // No armazém o rótulo viaja na própria linha (`_label`), então o dispMap é
  // montado a partir das linhas — nada de segunda fonte para o mesmo rótulo.
  let rows, dispMap;
  if (viaBQ) {
    rows = await whq.bdrCalls(ownerIds, sinceMs, untilMs);
    dispMap = {};
    rows.forEach(r => { const d = r.properties.hs_call_disposition; if (d && r._label) dispMap[d] = r._label; });
  } else {
    dispMap = await fetchCallDispositions(token);
    rows = await searchAll(token, 'calls', [
      { propertyName: 'hubspot_owner_id', operator: 'IN', values: ownerIds },
      { propertyName: 'hs_timestamp', operator: 'BETWEEN', value: String(sinceMs), highValue: String(untilMs) },
    ], ['hs_timestamp', 'hs_call_duration', 'hs_call_disposition', 'hs_call_title']);
  }

  // Corte de saída: ligação carimbada DEPOIS de o BDR sair não é esforço dele
  // (é telefone que continuou tocando num contato que ficou com o nome antigo).
  // Fica aqui, e não só no agregado, senão o drill mostraria a ligação que o
  // gráfico já não conta e a tela se contradiria sozinha.
  const saida = bdrExitDate(bdrName);
  if (saida) {
    rows = rows.filter((r) => {
      const ts = r.properties && r.properties.hs_timestamp;
      if (!ts) return true;
      const ms = /^\d+$/.test(String(ts)) ? Number(ts) : Date.parse(ts);
      if (!Number.isFinite(ms)) return true;
      return new Date(ms - 3 * 60 * 60 * 1000).toISOString().slice(0, 10) < saida;
    });
  }

  const detail = options.detail === true;
  const page = Math.max(1, Number(options.page || 1));
  const limit = Math.min(50, Math.max(1, Number(options.limit || 50)));
  const pageRows = detail ? rows.slice((page - 1) * limit, page * limit) : [];
  const callIds = pageRows.map(r => r.id);
  // No armazém o "para quem" já está na linha (contact_id/company_id são colunas
  // da fato). Fora dele são 3 rodadas de batch por página.
  const callToContact = (detail && !viaBQ) ? await fetchCallContacts(token, callIds) : {};
  const contactIds = [...new Set(Object.values(callToContact))];
  const contactMap = contactIds.length ? await fetchContactsById(token, contactIds) : {};
  const companyIds = [...new Set(Object.values(contactMap).map(c => c && c.companyId).filter(Boolean))];
  const companyMap = companyIds.length ? await fetchCompanyNames(token, companyIds) : {};

  const enrichAttempted = detail && callIds.length > 0;
  const enrichOk = viaBQ
    ? pageRows.some(r => r._contato || r._empresa)
    : Object.keys(callToContact).length > 0;

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
      // Privacidade preservada: só nome do contato e da empresa. Nunca telefone,
      // e-mail ou payload bruto.
      contato: viaBQ ? (r._contato || null) : (contact ? contact.nome : null),
      empresa: viaBQ
        ? (r._empresa || null)
        : (contact && contact.companyId ? (companyMap[contact.companyId] || null) : null),
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
    fonte: viaBQ ? 'bq' : 'api',
    env: env.name,
  };
}

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['GET'])) return;
  const user = requireAuth(req, res);
  if (!user) return;

  const q = new URL(`http://x${req.url}`).searchParams;

  // Com a leitura no armazém o PAT deixa de ser pré-requisito para responder;
  // ele só é exigido quando a rota antiga é pedida de propósito.
  let token = null;
  const precisaAPI = q.get('fonte') === 'api' || !wh.isConfigured();
  if (precisaAPI) {
    try { token = getHubspotToken(); }
    catch (e) { return res.status(503).json({ success: false, error: e.message }); }
  }
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
  const scopedKvKey = `${kvKey}|detail:${detail ? 1 : 0}|page:${page}|limit:${limit}`
    + `|fonte:${q.get('fonte') === 'api' ? 'api' : 'bq'}`;
  const CACHE_TTL = 5 * 60 * 1000;

  try {
    if (!refresh && kv.isConfigured()) {
      try {
        const hit = await kv.getJSON(scopedKvKey);
        if (hit && Date.now() - hit.at < CACHE_TTL) return res.status(200).json({ ...hit.data, cached: true });
      } catch (e) { /* segue para live */ }
    }
    const data = await build(token, bdr, sinceMs, untilMs, { detail, page, limit, fonte: q.get('fonte') });
    if (kv.isConfigured()) { try { await kv.setJSON(scopedKvKey, { at: Date.now(), data }); } catch (e) { /* best-effort */ } }
    return res.status(200).json(data);
  } catch (e) {
    console.error('[bdr-workload-calls]', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
};

module.exports._test = { bucketOf, summarizeRows, build, paginationOptions, MIN_CONVERSA };
