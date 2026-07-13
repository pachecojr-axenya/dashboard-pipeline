'use strict';
/**
 * GET /api/bdr-workload?since=YYYY-MM-DD&until=YYYY-MM-DD[&refresh=1]
 *
 * Carga de trabalho dos BDRs na janela pedida (datas em America/Sao_Paulo):
 *  - companiesCreated: empresas criadas na janela com owner do time (push Apollo/
 *    Lusha conta como inserção do BDR; hs_created_by_user_id só existe nas manuais,
 *    então a atribuição é pelo hubspot_owner_id | validado 2026-07-13: 796/880
 *    empresas desde 01/06 têm owner).
 *  - contactsCreated: contatos criados na janela com owner do time, COM ou SEM
 *    hs_lead_status (o /api/bdr-leads só cobre quem tem status; inserção não).
 *  - transitions: transições de hs_lead_status dentro da janela, derivadas do
 *    propertiesWithHistory dos contatos do time com lastmodifieddate >= since
 *    (mudança de status sempre atualiza o lastmodified — filtro barato antes do
 *    batch de histórico).
 *
 * Fonte de criação (hs_object_source_detail_1): 'Apollo Integration' | 'Lusha' |
 * 'hubspot-development-growth' (chave de API interna do Samuel — automações, NÃO
 * é inserção de BDR) | CRM_UI (manual). Agregação e filtros ficam no front.
 *
 * Espelho do time/alias de api/bdr-leads.js — consolidar em lib/bdr-team.js quando
 * houver um 3º consumidor (não tocar no bdr-leads em produção por ora).
 */

const { hubspotPost, hubspotGet } = require('../lib/hubspot');
const { setCORSHeaders, requireAuth, getHubspotToken, methodCheck } = require('./_helpers');

const BDR_TEAM = [
  'Anderson Souza', 'Cintia Rodrigues', 'Gabriele Almeida', 'Priscilla Feliciello',
  'Leticia Romão', 'Allan Valença', 'Bruna Reis', 'Emanuelle Braga', 'Felipe Andrade',
  'Giovana Nunes', 'Marcelli Netto', 'Thauan Pontes', 'Yokyko Muramoto',
];
const HS_ALIAS = {
  'gabriele de almeida silva': 'Gabriele Almeida',
  'bruna cristina dos reis silva': 'Bruna Reis',
  'giovana rocha': 'Giovana Nunes',
};

const CONTACT_PROPS = [
  'firstname', 'lastname', 'jobtitle', 'hs_lead_status', 'hubspot_owner_id',
  'createdate', 'associatedcompanyid', 'numero_de_colaboradores',
  'hs_object_source_label', 'hs_object_source_detail_1',
];
const COMPANY_PROPS = [
  'name', 'numberofemployees', 'hubspot_owner_id', 'createdate',
  'hs_object_source_label', 'hs_object_source_detail_1',
];

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

let _cache = {};
const CACHE_TTL = 5 * 60 * 1000;

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

async function fetchOwnersRaw(token) {
  const map = {};
  for (const archived of ['false', 'true']) {
    let after, hasMore = true;
    while (hasMore) {
      const resp = await hubspotGet(token, `/crm/v3/owners?limit=200&archived=${archived}` + (after ? `&after=${after}` : ''));
      (resp.results || []).forEach(o => {
        map[o.id] = `${o.firstName || ''} ${o.lastName || ''}`.trim() || o.email || o.id;
      });
      hasMore = resp.paging && resp.paging.next && resp.paging.next.after != null;
      after = hasMore ? resp.paging.next.after : null;
    }
  }
  return map;
}

function resolveTeamIds(ownerMap) {
  const canonSet = {};
  BDR_TEAM.forEach(n => { canonSet[norm(n)] = n; });
  const idToBdr = {};
  Object.keys(ownerMap).forEach(id => {
    const raw = norm(ownerMap[id]);
    const canonical = canonSet[norm(HS_ALIAS[raw] || raw)];
    if (canonical) idToBdr[id] = canonical;
  });
  return idToBdr;
}

async function searchAll(token, objectType, filters, properties, sortProp) {
  const all = [];
  let after = 0, hasMore = true;
  while (hasMore) {
    const resp = await hubspotPost(token, `/crm/v3/objects/${objectType}/search`, {
      filterGroups: [{ filters }],
      properties,
      sorts: [{ propertyName: sortProp || 'createdate', direction: 'DESCENDING' }],
      limit: 200,
      after,
    });
    all.push(...(resp.results || []));
    hasMore = resp.paging && resp.paging.next && resp.paging.next.after != null;
    after = hasMore ? resp.paging.next.after : 0;
    if (all.length >= 9800) break;
  }
  return all;
}

async function fetchStatusHistory(token, ids) {
  const batches = [];
  for (let i = 0; i < ids.length; i += 50) batches.push(ids.slice(i, i + 50));
  const hist = {};
  await pool(batches, 3, async batch => {
    const resp = await hubspotPost(token, '/crm/v3/objects/contacts/batch/read', {
      inputs: batch.map(id => ({ id })),
      properties: ['hs_lead_status'],
      propertiesWithHistory: ['hs_lead_status'],
    });
    (resp.results || []).forEach(r => {
      const h = (r.propertiesWithHistory && r.propertiesWithHistory.hs_lead_status) || [];
      hist[r.id] = h
        .filter(x => x.value)
        .map(x => [x.value, x.timestamp])
        .sort((a, b) => (a[1] < b[1] ? -1 : 1));
    });
  });
  return hist;
}

async function fetchCompaniesById(token, ids) {
  const batches = [];
  for (let i = 0; i < ids.length; i += 100) batches.push(ids.slice(i, i + 100));
  const map = {};
  await pool(batches, 2, async batch => {
    const resp = await hubspotPost(token, '/crm/v3/objects/companies/batch/read', {
      inputs: batch.map(id => ({ id })),
      properties: COMPANY_PROPS,
    });
    (resp.results || []).forEach(r => {
      map[r.id] = {
        name: r.properties.name || null,
        employees: r.properties.numberofemployees != null && r.properties.numberofemployees !== ''
          ? Number(r.properties.numberofemployees) : null,
        criado: r.properties.createdate || null,
      };
    });
  });
  return map;
}

// Atividades (engagements) da janela por owner do time. Cada tipo pagina até o teto
// do search (9800) — janelas muito longas podem truncar o rabo; o front avisa.
const ACTIVITY_TYPES = {
  calls: ['hs_timestamp', 'hubspot_owner_id', 'hs_call_duration', 'hs_call_disposition'],
  emails: ['hs_timestamp', 'hubspot_owner_id'],
  communications: ['hs_timestamp', 'hubspot_owner_id', 'hs_communication_channel_type'],
  notes: ['hs_timestamp', 'hubspot_owner_id'],
  tasks: ['hs_timestamp', 'hubspot_owner_id'],
  meetings: ['hs_timestamp', 'hubspot_owner_id'],
};

async function fetchCallDispositions(token) {
  try {
    const list = await hubspotGet(token, '/calls/v1/dispositions');
    const map = {};
    (Array.isArray(list) ? list : []).forEach(d => { map[d.id] = d.label; });
    return map;
  } catch (e) { return {}; }
}

async function fetchActivities(token, teamIds, idToBdr, sinceMs, untilMs) {
  const dispMap = await fetchCallDispositions(token);
  const out = [];
  await Promise.all(Object.keys(ACTIVITY_TYPES).map(async type => {
    const rows = await searchAll(token, type, [
      { propertyName: 'hubspot_owner_id', operator: 'IN', values: teamIds },
      { propertyName: 'hs_timestamp', operator: 'BETWEEN', value: String(sinceMs), highValue: String(untilMs) },
    ], ACTIVITY_TYPES[type], 'hs_timestamp');
    rows.forEach(r => {
      const p = r.properties;
      const a = { tipo: type, bdr: idToBdr[p.hubspot_owner_id] || null, ts: p.hs_timestamp };
      if (type === 'calls') {
        a.duracao_ms = p.hs_call_duration != null && p.hs_call_duration !== '' ? Number(p.hs_call_duration) : null;
        a.desfecho = dispMap[p.hs_call_disposition] || null;
      }
      if (type === 'communications') a.canal = p.hs_communication_channel_type || null;
      out.push(a);
    });
  }));
  out.sort((a, b) => (a.ts < b.ts ? -1 : 1));
  return out;
}

// 'Apollo Integration' -> Apollo | 'Lusha' -> Lusha | chave API interna -> API interna | CRM_UI -> Manual
function sourceOf(p) {
  const d = p.hs_object_source_detail_1 || '';
  if (/apollo/i.test(d)) return 'Apollo';
  if (/lusha/i.test(d)) return 'Lusha';
  if (/hubspot-development-growth/i.test(d)) return 'API interna';
  if (p.hs_object_source_label === 'CRM_UI') return 'Manual';
  return d || p.hs_object_source_label || 'Outra';
}

async function buildPayload(token, sinceMs, untilMs) {
  const ownerMap = await fetchOwnersRaw(token);
  const idToBdr = resolveTeamIds(ownerMap);
  const teamIds = Object.keys(idToBdr);
  if (!teamIds.length) throw new Error('Nenhum owner do time de BDRs encontrado no portal');

  const [companiesRaw, contactsCreatedRaw, contactsTouchedRaw] = await Promise.all([
    searchAll(token, 'companies', [
      { propertyName: 'hubspot_owner_id', operator: 'IN', values: teamIds },
      { propertyName: 'createdate', operator: 'BETWEEN', value: String(sinceMs), highValue: String(untilMs) },
    ], COMPANY_PROPS),
    searchAll(token, 'contacts', [
      { propertyName: 'hubspot_owner_id', operator: 'IN', values: teamIds },
      { propertyName: 'createdate', operator: 'BETWEEN', value: String(sinceMs), highValue: String(untilMs) },
    ], CONTACT_PROPS),
    searchAll(token, 'contacts', [
      { propertyName: 'hubspot_owner_id', operator: 'IN', values: teamIds },
      { propertyName: 'hs_lead_status', operator: 'HAS_PROPERTY' },
      { propertyName: 'lastmodifieddate', operator: 'GTE', value: String(sinceMs) },
    ], CONTACT_PROPS),
  ]);

  const [hist, activities] = await Promise.all([
    fetchStatusHistory(token, contactsTouchedRaw.map(c => c.id)),
    fetchActivities(token, teamIds, idToBdr, sinceMs, untilMs),
  ]);

  const transitions = [];
  contactsTouchedRaw.forEach(c => {
    const h = hist[c.id] || [];
    h.forEach(([val, ts], i) => {
      const t = new Date(ts).getTime();
      if (t >= sinceMs && t <= untilMs) {
        transitions.push({
          contato_id: c.id,
          nome: [c.properties.firstname, c.properties.lastname].filter(Boolean).join(' ') || '(sem nome)',
          cargo: c.properties.jobtitle || null,
          bdr: idToBdr[c.properties.hubspot_owner_id] || null,
          empresa_id: c.properties.associatedcompanyid || null,
          de: i > 0 ? h[i - 1][0] : null,
          para: val,
          ts,
        });
      }
    });
  });

  const companyIds = [...new Set(
    contactsCreatedRaw.map(c => c.properties.associatedcompanyid)
      .concat(transitions.map(t => t.empresa_id))
      .filter(Boolean)
  )];
  const companiesMap = await fetchCompaniesById(token, companyIds);

  const companiesCreated = companiesRaw.map(c => ({
    id: c.id,
    nome: c.properties.name || '(sem nome)',
    bdr: idToBdr[c.properties.hubspot_owner_id] || null,
    colaboradores: c.properties.numberofemployees != null && c.properties.numberofemployees !== ''
      ? Number(c.properties.numberofemployees) : null,
    fonte: sourceOf(c.properties),
    criado: c.properties.createdate,
  }));

  const contactsCreated = contactsCreatedRaw.map(c => {
    const p = c.properties;
    const comp = p.associatedcompanyid ? companiesMap[p.associatedcompanyid] : null;
    return {
      id: c.id,
      nome: [p.firstname, p.lastname].filter(Boolean).join(' ') || '(sem nome)',
      cargo: p.jobtitle || null,
      bdr: idToBdr[p.hubspot_owner_id] || null,
      empresa_id: p.associatedcompanyid || null,
      empresa: comp ? comp.name : null,
      colaboradores: p.numero_de_colaboradores != null && p.numero_de_colaboradores !== ''
        ? Number(p.numero_de_colaboradores)
        : (comp && comp.employees != null ? comp.employees : null),
      fonte: sourceOf(p),
      status: p.hs_lead_status || null,
      criado: p.createdate,
    };
  });

  transitions.forEach(t => {
    const comp = t.empresa_id ? companiesMap[t.empresa_id] : null;
    t.empresa = comp ? comp.name : null;
    t.colaboradores = comp && comp.employees != null ? comp.employees : null;
  });
  transitions.sort((a, b) => (a.ts < b.ts ? -1 : 1));

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    team: BDR_TEAM,
    companiesCreated,
    contactsCreated,
    transitions,
    activities,
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
  const reISO = /^\d{4}-\d{2}-\d{2}$/;
  const since = q.get('since'), until = q.get('until');
  if (!reISO.test(since || '') || !reISO.test(until || '')) {
    return res.status(400).json({ success: false, error: 'since e until obrigatórios (YYYY-MM-DD)' });
  }
  // Janela em America/Sao_Paulo (UTC-3, sem DST desde 2019)
  const sinceMs = Date.parse(`${since}T00:00:00.000-03:00`);
  const untilMs = Date.parse(`${until}T23:59:59.999-03:00`);
  if (!(sinceMs <= untilMs)) return res.status(400).json({ success: false, error: 'since > until' });

  const key = `${since}|${until}`;
  const refresh = q.get('refresh') === '1';

  try {
    const hit = _cache[key];
    if (!refresh && hit && Date.now() - hit.at < CACHE_TTL) {
      return res.status(200).json({ ...(hit.data), cached: true });
    }
    const data = await buildPayload(token, sinceMs, untilMs);
    _cache = { [key]: { at: Date.now(), data } };
    return res.status(200).json(data);
  } catch (e) {
    console.error('[bdr-workload]', e.message);
    const hit = _cache[key];
    if (hit) return res.status(200).json({ ...(hit.data), cached: true, stale: true, staleError: e.message });
    return res.status(500).json({ success: false, error: e.message });
  }
};
