'use strict';
/**
 * GET /api/bdr-leads
 *
 * Contatos trabalhados pelo time de BDRs (owner do contato = BDR do time) com o
 * HISTÓRICO COMPLETO de hs_lead_status (propertiesWithHistory). O front reconstrói
 * qualquer recorte temporal a partir das transições — snapshot do funil na data X,
 * taxa de contato por coorte, desqualificações por dia — sem precisar de snapshot
 * externo: o próprio HubSpot guarda o histórico do campo (decisão 2026-07-10; se o
 * volume passar de ~9k contatos com status, revisitar com snapshot diário).
 *
 * Fonte de atribuição: hubspot_owner_id do CONTATO (o campo custom `bdr` de contato
 * existe mas está vazio no portal | 5 registros em 2026-07-10).
 *
 * Volumes medidos em 2026-07-10: 9.921 contatos do time, 2.411 com lead status.
 * Custo: ~13 páginas de search + ~49 batches de history (50/batch, ~340ms) com
 * concorrência 4 ≈ 6-9s. Cache em memória por instância (TTL 10 min); ?refresh=1
 * força atualização.
 */

const { hubspotPost, hubspotGet } = require('../lib/hubspot');
const { setCORSHeaders, requireAuth, getHubspotToken, methodCheck } = require('./_helpers');

// Time canônico | espelho do BDR_LIST de public/settings-modal.js (fonte única de
// nomes no front). Aqui só os NOMES; os owner-ids são resolvidos ao vivo via
// fetchOwners + alias, porque há owners duplicados no portal (ex.: duas Cíntias).
const BDR_TEAM = [
  'Anderson Souza', 'Cintia Rodrigues', 'Gabriele Almeida', 'Priscilla Feliciello',
  'Leticia Romão', 'Allan Valença', 'Bruna Reis', 'Emanuelle Braga', 'Felipe Andrade',
  'Giovana Nunes', 'Marcelli Netto', 'Thauan Pontes', 'Yokyko Muramoto',
];
// Grafias do HubSpot -> nome canônico (mesmo mapa do BDR_HS_ALIAS de bdr.html).
const HS_ALIAS = {
  'gabriele de almeida silva': 'Gabriele Almeida',
  'bruna cristina dos reis silva': 'Bruna Reis',
  'giovana rocha': 'Giovana Nunes',
};

const CONTACT_PROPS = [
  'firstname', 'lastname', 'email', 'jobtitle',
  'hs_lead_status', 'hubspot_owner_id', 'createdate', 'notes_last_contacted',
  'origem', 'axenya_origem_canonica', 'numero_de_colaboradores', 'associatedcompanyid',
];

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Cache em memória por instância serverless (mesmo padrão do fetchOwners).
let _cache = { at: 0, data: null };
const CACHE_TTL = 10 * 60 * 1000;

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

// Owners CRUS (nome completo, ativos + arquivados). Não usa fetchOwners da lib porque
// o cleanOwnerName de lá encurta nomes ('Anderson Souza' -> 'Anderson', qualquer Cíntia
// -> 'Cíntia'), o que colidiria com homônimos fora do time (ex.: Cintia Minamoto).
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

// Resolve owner-ids do time: TODOS os ids cujo nome completo (normalizado + alias) bate
// com um nome canônico — cobre owners duplicados/arquivados da mesma pessoa (ex.: as
// duas grafias de Cíntia Rodrigues), sem pegar homônimos parciais.
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

async function searchTeamContacts(token, teamIds) {
  const all = [];
  let after = 0, hasMore = true;
  while (hasMore) {
    const resp = await hubspotPost(token, '/crm/v3/objects/contacts/search', {
      filterGroups: [{
        filters: [
          { propertyName: 'hubspot_owner_id', operator: 'IN', values: teamIds },
          { propertyName: 'hs_lead_status', operator: 'HAS_PROPERTY' },
        ],
      }],
      properties: CONTACT_PROPS,
      sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
      limit: 200,
      after,
    });
    all.push(...(resp.results || []));
    hasMore = resp.paging && resp.paging.next && resp.paging.next.after != null;
    after = hasMore ? resp.paging.next.after : 0;
    if (all.length >= 9800) break; // teto do search da API (10k); acima disso, paginar por createdate
  }
  return all;
}

async function countTeamNoStatus(token, teamIds) {
  const resp = await hubspotPost(token, '/crm/v3/objects/contacts/search', {
    filterGroups: [{
      filters: [
        { propertyName: 'hubspot_owner_id', operator: 'IN', values: teamIds },
        { propertyName: 'hs_lead_status', operator: 'NOT_HAS_PROPERTY' },
      ],
    }],
    limit: 1,
  });
  return resp.total || 0;
}

// Histórico de hs_lead_status | máx. 50 inputs por batch quando há propertiesWithHistory.
async function fetchStatusHistory(token, ids) {
  const batches = [];
  for (let i = 0; i < ids.length; i += 50) batches.push(ids.slice(i, i + 50));
  const hist = {};
  await pool(batches, 2, async batch => {
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
        .sort((a, b) => (a[1] < b[1] ? -1 : 1)); // cronológico (antigo -> novo)
    });
  });
  return hist;
}

async function fetchCompanies(token, ids) {
  const batches = [];
  for (let i = 0; i < ids.length; i += 100) batches.push(ids.slice(i, i + 100));
  const map = {};
  await pool(batches, 2, async batch => {
    const resp = await hubspotPost(token, '/crm/v3/objects/companies/batch/read', {
      inputs: batch.map(id => ({ id })),
      properties: ['name', 'numberofemployees', 'domain'],
    });
    (resp.results || []).forEach(r => {
      map[r.id] = {
        name: r.properties.name || null,
        employees: r.properties.numberofemployees != null ? Number(r.properties.numberofemployees) : null,
      };
    });
  });
  return map;
}

async function buildPayload(token) {
  const ownerMap = await fetchOwnersRaw(token);
  const idToBdr = resolveTeamIds(ownerMap);
  const teamIds = Object.keys(idToBdr);
  if (!teamIds.length) throw new Error('Nenhum owner do time de BDRs encontrado no portal');

  const [contactsRaw, semStatus] = await Promise.all([
    searchTeamContacts(token, teamIds),
    countTeamNoStatus(token, teamIds),
  ]);

  const hist = await fetchStatusHistory(token, contactsRaw.map(c => c.id));


  const companyIds = [...new Set(contactsRaw.map(c => c.properties.associatedcompanyid).filter(Boolean))];
  const companies = await fetchCompanies(token, companyIds);

  const contacts = contactsRaw.map(c => {
    const p = c.properties;
    const comp = p.associatedcompanyid ? companies[p.associatedcompanyid] : null;
    const colabs = p.numero_de_colaboradores != null && p.numero_de_colaboradores !== ''
      ? Number(p.numero_de_colaboradores)
      : (comp && comp.employees != null ? comp.employees : null);
    return {
      id: c.id,
      nome: [p.firstname, p.lastname].filter(Boolean).join(' ') || p.email || '(sem nome)',
      cargo: p.jobtitle || null,
      bdr: idToBdr[p.hubspot_owner_id] || null,
      status: p.hs_lead_status || null,
      criado: p.createdate || null,
      ultimo_contato: p.notes_last_contacted || null,
      origem: p.origem || null,
      origem_canonica: p.axenya_origem_canonica || null,
      empresa_id: p.associatedcompanyid || null,
      empresa: comp ? comp.name : null,
      colaboradores: Number.isFinite(colabs) ? colabs : null,
      hist: hist[c.id] || [],
    };
  });

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    team: BDR_TEAM,
    semStatus,
    total: contacts.length,
    contacts,
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

  const refresh = new URL(`http://x${req.url}`).searchParams.get('refresh') === '1';

  try {
    if (!refresh && _cache.data && Date.now() - _cache.at < CACHE_TTL) {
      return res.status(200).json({ ...(_cache.data), cached: true });
    }
    const data = await buildPayload(token);
    _cache = { at: Date.now(), data };
    return res.status(200).json(data);
  } catch (e) {
    console.error('[bdr-leads]', e.message);
    // Fallback stale: melhor servir a última foto boa (com aviso) do que derrubar a
    // seção inteira por um rate limit transitório da cota compartilhada.
    if (_cache.data) {
      return res.status(200).json({ ...(_cache.data), cached: true, stale: true, staleError: e.message });
    }
    return res.status(500).json({ success: false, error: e.message });
  }
};
