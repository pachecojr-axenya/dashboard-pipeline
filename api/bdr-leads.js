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
 *
 * MIGRADO para a fonte única (F5, 09/08/2026), depois de o defeito que o travava
 * cair no silver.
 *
 * O bloqueio era do ARMAZÉM, não da migração: `LAST_VALUE(... IGNORE NULLS)` fazia
 * esvaziar um campo ficar indistinguível de "não houve evento", e o dono removido
 * sobrevivia como vigente. O endpoint dava a BDRs **1.699 contatos que hoje não
 * têm dono nenhum** — 3.872 contra 2.173, 78% de inflação. Com a sentinela de
 * limpeza e o check `current_matches_payload` no lugar:
 *
 *   total     2.127 / 2.127   EXATO   (era 3.872 / 2.173)
 *   semStatus 8.298 / 8.311   0,16%   (era 12.711 / 8.434)
 *   0 contatos só na API · 0 só no armazém
 *   nome, cargo, bdr, status, origem, empresa, colaboradores: 100% iguais em 2.127
 *
 * Os 13 do `semStatus` são DEFASAGEM, não defeito: a extração é de hoje 09:30 UTC
 * e o portal segue sendo editado. É o que o selo de frescor existe para dizer.
 *
 * `hist` difere em 15 de 2.127, e o armazém está certo nos 15: a API REPETE o mesmo
 * status em re-save (`NEW@18:49` e `NEW@19:22`) e às vezes no mesmo instante
 * (`CONNECTED@14:14` duas vezes). `fact_crm_change` colapsa valor igual
 * consecutivo — e `NEW → NEW` não é transição. Contá-la infla "quantos contatos
 * mudaram de status hoje".
 *
 * Custo: de ~62 chamadas à API por request para 2 consultas.
 *
 * `?fonte=api` mantém a rota antiga viva para comparar.
 * ============================================================================
 *
 * O que JÁ está provado do lado do armazém, para quando o defeito cair:
 *  · o histórico de `hs_lead_status` de `fact_crm_change` é IDÊNTICO ao de
 *    `propertiesWithHistory` — valor e timestamp, nos 5 contatos com mais
 *    mudanças (8/8, 6/6, 6/6, 6/6, 6/6);
 *  · nos 2.173 contatos que as duas fontes têm em comum, `nome`, `cargo`, `bdr`,
 *    `status`, `origem` e a data de criação batem em 100%; `empresa` e
 *    `colaboradores` divergem em 1;
 *  · 0 contatos existem só na API — não há perda, só excesso.
 *
 * `numero_de_colaboradores` é FAIXA DE TEXTO no portal ("Abaixo de 1000"), não
 * número: 55 contatos têm valor e nenhum é numérico. A versão da API faz
 * `Number(...)` → NaN → null e por isso PERDE o fallback para o nº de
 * funcionários da empresa; o armazém devolve NULL no cast e o fallback acontece.
 * Diferença a favor do armazém, em até 55 contatos.
 *
 * A REGRA DE VIGÊNCIA do time continua aqui, aplicada igual nas duas fontes — é
 * regra de negócio do consumidor, não do armazém.
 */

const { hubspotPost, hubspotGet } = require('../lib/hubspot');
const { setCORSHeaders, requireAuth, getHubspotToken, methodCheck } = require('./_helpers');
const { BDR_TEAM, BDR_EXITS, HS_ALIAS, norm, resolveTeamIds } = require('../lib/bdr-team');
const whq = require('../lib/hubspot-wh-queries');
const wh = require('../lib/hubspot-warehouse');

const CONTACT_PROPS = [
  'firstname', 'lastname', 'email', 'jobtitle',
  'hs_lead_status', 'hubspot_owner_id', 'createdate', 'notes_last_contacted',
  'origem', 'axenya_origem_canonica', 'numero_de_colaboradores', 'associatedcompanyid',
];

// ── REGRA DE VIGÊNCIA DO TIME (decisão do dono, 2026-08-03; espelha public/bdr.html) ──
// A partir de 2026-08, Anderson Souza, Cintia Rodrigues, Thauan Pontes e Yokyko
// Muramoto deixam o time ATIVO de BDRs. Na cadência, a vigência é pelo MÊS DE CRIAÇÃO
// do contato: contatos dos BDRs saídos criados ANTES do corte continuam contando;
// criados a partir do corte saem do total (teamIdsAtivos + createdate < corte).
// Derivado de BDR_EXITS (lib/bdr-team.js) desde 14/08/2026: a mesma lista estava
// escrita aqui, no Workload e em public/bdr.html, e três cópias da régua de
// vigência é como uma tela passa a mostrar 13 BDRs e a vizinha 9.
const BDR_TEAM_EXITED = Object.keys(BDR_EXITS);
const BDR_TEAM_EFFECTIVE_FROM = Object.values(BDR_EXITS).sort()[0].slice(0, 7);

// Cache em memória por instância serverless (mesmo padrão do fetchOwners).
let _cache = { at: 0, data: null, fonte: null };
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

// Contagem de contatos do time SEM lead status. REGRA DE VIGÊNCIA (2026-08-03):
// BDRs que saíram do time (BDR_TEAM_EXITED) só contam se o contato foi criado ANTES
// de BDR_TEAM_EFFECTIVE_FROM; ativos contam sempre. Dois filterGroups (OR); grupos
// com lista vazia são omitidos (Search API rejeita IN com values: []).
async function countTeamNoStatus(token, idToBdr) {
  const ativos = [];
  const saidos = [];
  Object.keys(idToBdr).forEach(id => {
    (BDR_TEAM_EXITED.includes(idToBdr[id]) ? saidos : ativos).push(id);
  });
  const groups = [];
  if (ativos.length) {
    groups.push({
      filters: [
        { propertyName: 'hubspot_owner_id', operator: 'IN', values: ativos },
        { propertyName: 'hs_lead_status', operator: 'NOT_HAS_PROPERTY' },
      ],
    });
  }
  if (saidos.length) {
    groups.push({
      filters: [
        { propertyName: 'hubspot_owner_id', operator: 'IN', values: saidos },
        { propertyName: 'hs_lead_status', operator: 'NOT_HAS_PROPERTY' },
        { propertyName: 'createdate', operator: 'LT', value: `${BDR_TEAM_EFFECTIVE_FROM}-01T00:00:00Z` },
      ],
    });
  }
  if (!groups.length) return 0;
  const resp = await hubspotPost(token, '/crm/v3/objects/contacts/search', {
    filterGroups: groups,
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

// Contagem de contatos SEM status a partir do armazém, aplicando a MESMA regra de
// vigência que o countTeamNoStatus faz com dois filterGroups na API: ativo conta
// sempre; quem saiu conta só se o contato foi criado antes do corte.
function semStatusDoArmazem(porDono, idToBdr) {
  return porDono.reduce((soma, r) => {
    const bdr = idToBdr[r.owner_id];
    if (!bdr) return soma;
    if (!BDR_TEAM_EXITED.includes(bdr)) return soma + r.n;
    return r.criado_ym && r.criado_ym < BDR_TEAM_EFFECTIVE_FROM ? soma + r.n : soma;
  }, 0);
}

async function buildPayload(token, opcoes = {}) {
  const viaBQ = opcoes.fonte !== 'api' && wh.isConfigured();

  const ownerMap = viaBQ ? await whq.ownerMap() : await fetchOwnersRaw(token);
  const idToBdr = resolveTeamIds(ownerMap);
  const teamIds = Object.keys(idToBdr);
  if (!teamIds.length) throw new Error('Nenhum owner do time de BDRs encontrado no portal');

  let contacts, semStatus;
  if (viaBQ) {
    const r = await whq.bdrLeadContacts(teamIds);
    semStatus = semStatusDoArmazem(r.semStatusPorDono, idToBdr);
    contacts = r.contacts.map(c => {
      const colabs = c.numero_de_colaboradores != null
        ? c.numero_de_colaboradores
        : (c.company_employees != null ? c.company_employees : null);
      return {
        id: c.id,
        nome: [c.firstname, c.lastname].filter(Boolean).join(' ') || c.email || '(sem nome)',
        cargo: c.jobtitle || null,
        bdr: idToBdr[c.owner_id] || null,
        status: c.lead_status || null,
        criado: c.createdate || null,
        ultimo_contato: c.notes_last_contacted || null,
        origem: c.origem || null,
        origem_canonica: c.origem_canonica || null,
        empresa_id: c.company_id || null,
        empresa: c.company_name || null,
        colaboradores: Number.isFinite(colabs) ? colabs : null,
        hist: c.hist || [],
      };
    });
  } else {
    const [contactsRaw, sem] = await Promise.all([
      searchTeamContacts(token, teamIds),
      countTeamNoStatus(token, idToBdr),
    ]);
    semStatus = sem;
    const hist = await fetchStatusHistory(token, contactsRaw.map(c => c.id));
    const companyIds = [...new Set(contactsRaw.map(c => c.properties.associatedcompanyid).filter(Boolean))];
    const companies = await fetchCompanies(token, companyIds);
    contacts = contactsRaw.map(c => {
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
  }

  // REGRA DE VIGÊNCIA (2026-08-03): contatos de BDRs que saíram do time só entram
  // no payload se criados ANTES do corte (mês de criação < BDR_TEAM_EFFECTIVE_FROM).
  // O front aplica o mesmo filtro em _lContacts (defense-in-depth).
  const nowYm = new Date().toISOString().substring(0, 7);
  const activeContacts = contacts.filter(c => {
    if (!c.bdr || !BDR_TEAM_EXITED.includes(c.bdr)) return true;
    return (c.criado || nowYm).substring(0, 7) < BDR_TEAM_EFFECTIVE_FROM;
  });

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    team: BDR_TEAM,
    semStatus,
    total: activeContacts.length,
    contacts: activeContacts,
    fonte: viaBQ ? 'bq' : 'api',
  };
}

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['GET'])) return;
  const user = requireAuth(req, res);
  if (!user) return;

  const q = new URL(`http://x${req.url}`).searchParams;
  const fonte = q.get('fonte');
  const refresh = q.get('refresh') === '1';

  // Com a leitura no armazém o PAT deixa de ser pré-requisito.
  let token = null;
  if (fonte === 'api' || !wh.isConfigured()) {
    try { token = getHubspotToken(); }
    catch (e) { return res.status(503).json({ success: false, error: e.message }); }
  }

  try {
    // Cache separado por fonte: sem isso a comparação leria a resposta da outra.
    if (!refresh && _cache.data && _cache.fonte === (fonte === 'api' ? 'api' : 'bq')
        && Date.now() - _cache.at < CACHE_TTL) {
      return res.status(200).json({ ...(_cache.data), cached: true });
    }
    const data = await buildPayload(token, { fonte });
    _cache = { at: Date.now(), data, fonte: fonte === 'api' ? 'api' : 'bq' };
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
