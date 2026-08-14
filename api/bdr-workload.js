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
 *
 * MIGRADO para a fonte única (F5, 07/08/2026): `dim_company` + `dim_contact` +
 * `fact_crm_change` + `fact_engagement`. Custo antes: 3 buscas paginadas + lote de
 * propertiesWithHistory + 3 rodadas de associação + busca separada do Treble + 2
 * páginas de /crm/v3/owners, POR REQUEST. Agora: 4 consultas em paralelo.
 *
 * Dois ganhos que não são de custo:
 *  · o Treble deixa de precisar de passo próprio — `owner_attributed` já marca o
 *    toque cuja atribuição veio do contato (2.436 comunicações), e `owner_id` já é
 *    o dono efetivo;
 *  · a transição de `hs_lead_status` vem de `fact_crm_change` com `old_value`, que
 *    já está colapsado: re-save do mesmo status NÃO vira transição, e na versão
 *    antiga virava.
 *
 * `?fonte=api` mantém a rota antiga viva para comparar.
 */

const { hubspotPost, hubspotGet } = require('../lib/hubspot');
const { setCORSHeaders, requireAuth, getHubspotToken, methodCheck } = require('./_helpers');
const kv = require('../lib/kv');
const env = require('../lib/env');
const { BDR_TEAM, HS_ALIAS, norm, resolveTeamIds, findUnresolvedOwners, isActiveBdrOn, activeTeam } = require('../lib/bdr-team');
const whq = require('../lib/hubspot-wh-queries');
const wh = require('../lib/hubspot-warehouse');

const CONTACT_PROPS = [
  'firstname', 'lastname', 'jobtitle', 'hs_lead_status', 'hubspot_owner_id',
  'createdate', 'associatedcompanyid', 'numero_de_colaboradores',
  'hs_object_source_label', 'hs_object_source_detail_1',
];
const COMPANY_PROPS = [
  'name', 'numberofemployees', 'hubspot_owner_id', 'createdate',
  'hs_object_source_label', 'hs_object_source_detail_1',
];
// Treble: disparos de WhatsApp via integração (app id 26063081) entram como
// communications INTEGRATION com hubspot_owner_id NULO. Não vêm no fetch por owner
// do time; atribuímos ao BDR dono do CONTATO associado. Ver docs/treble-whatsapp-attribution-decision.md.
const TREBLE_SOURCE_ID = '26063081';

let _cache = {};
const CACHE_TTL = 5 * 60 * 1000;
const TODAY_CACHE_TTL = 90 * 1000;
const MAX_STALE_TODAY = 15 * 60 * 1000;
const MAX_STALE_HISTORY = 24 * 60 * 60 * 1000;

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
  emails: ['hs_timestamp', 'hubspot_owner_id', 'hs_email_direction'],
  communications: ['hs_timestamp', 'hubspot_owner_id', 'hs_communication_channel_type'],
  notes: ['hs_timestamp', 'hubspot_owner_id'],
  tasks: ['hs_timestamp', 'hubspot_owner_id'],
  meetings: ['hs_timestamp', 'hubspot_owner_id'],
};


function smallestAssociationId(row) {
  return (row.to || []).map((x) => String(x.toObjectId || '')).filter(Boolean).sort((a, b) => a.length - b.length || a.localeCompare(b))[0] || null;
}
async function fetchActivityAssociations(token, activities, post) {
  post = post || hubspotPost;
  const objectType = { calls: 'calls', emails: 'emails', communications: 'communications', meetings: 'meetings' };
  const diagnostics = { attempted: 0, succeeded: 0, errors: 0, available: false };
  await pool(Object.keys(objectType), 2, async (tipo) => {
    const typed = activities.filter((a) => a.tipo === tipo && a.id);
    for (let i = 0; i < typed.length; i += 100) {
      const batch = typed.slice(i, i + 100);
      await Promise.all(['contacts', 'companies'].map(async (toType) => {
        diagnostics.attempted += 1;
        try {
          const resp = await post(token, `/crm/v4/associations/${objectType[tipo]}/${toType}/batch/read`, { inputs: batch.map((a) => ({ id: a.id })) });
          diagnostics.succeeded += 1;
          (resp.results || []).forEach((r) => {
            const a = batch.find((x) => String(x.id) === String(r.from && r.from.id));
            const assocId = smallestAssociationId(r);
            if (a && assocId && toType === 'contacts') a.contact_id = String(assocId);
            if (a && assocId && toType === 'companies') a.company_id = String(assocId);
          });
        } catch (e) { diagnostics.errors += 1; }
      }));
    }
  });
  diagnostics.available = diagnostics.attempted > 0 && diagnostics.succeeded === diagnostics.attempted && diagnostics.errors === 0;
  return diagnostics;
}

async function fetchCallDispositions(token) {
  try {
    const list = await hubspotGet(token, '/calls/v1/dispositions');
    const map = {};
    (Array.isArray(list) ? list : []).forEach(d => { map[d.id] = d.label; });
    return map;
  } catch (e) { return {}; }
}

// Busca por janela de tempo que NÃO trunca: o search do HubSpot tem teto ~10k
// por consulta (searchAll para em 9.800). Se a janela bater no teto, divide no
// tempo e recorre — garante contagem completa em janelas longas (ex.: 30 dias,
// em que só as ligações já passam de 11k). Dedup por id ao juntar.
async function searchWindow(token, type, baseFilters, tsProp, sinceMs, untilMs, props) {
  const filters = baseFilters.concat([
    { propertyName: tsProp, operator: 'BETWEEN', value: String(sinceMs), highValue: String(untilMs) },
  ]);
  const rows = await searchAll(token, type, filters, props, tsProp);
  // < teto → completo; janela já mínima (1h) → desiste para não recorrer infinito
  if (rows.length < 9800 || (untilMs - sinceMs) <= 3600000) return rows;
  const mid = Math.floor((sinceMs + untilMs) / 2);
  const [a, b] = await Promise.all([
    searchWindow(token, type, baseFilters, tsProp, sinceMs, mid, props),
    searchWindow(token, type, baseFilters, tsProp, mid + 1, untilMs, props),
  ]);
  const seen = new Set(), merged = [];
  a.concat(b).forEach(r => { if (!seen.has(r.id)) { seen.add(r.id); merged.push(r); } });
  return merged;
}

// Dono (owner) de um lote de contatos — usado para atribuir comms Treble ao BDR.
async function fetchContactOwners(token, ids) {
  const uniq = [...new Set(ids.filter(Boolean).map(String))];
  const batches = [];
  for (let i = 0; i < uniq.length; i += 100) batches.push(uniq.slice(i, i + 100));
  const map = {};
  await pool(batches, 3, async batch => {
    const resp = await hubspotPost(token, '/crm/v3/objects/contacts/batch/read', {
      inputs: batch.map(id => ({ id })),
      properties: ['hubspot_owner_id'],
    });
    (resp.results || []).forEach(r => { map[r.id] = (r.properties && r.properties.hubspot_owner_id) || null; });
  });
  return map;
}

// WhatsApp do Treble: communications WHATS_APP com owner nulo (INTEGRATION 26063081).
// Resolve comm → contato associado → dono do contato → BDR do roster. Sem contato de
// BDR do roster => descartado (não some para "desconhecido" no ritmo). Marca treble=true
// para segregar manual (CRM_UI) × automático (Treble) sem dupla contagem.
async function fetchTrebleWhatsapp(token, idToBdr, sinceMs, untilMs) {
  const diag = { fetched: 0, integration: 0, withContact: 0, attributed: 0, unknown: 0 };
  const rows = await searchWindow(token, 'communications',
    [
      { propertyName: 'hs_communication_channel_type', operator: 'EQ', value: 'WHATS_APP' },
      { propertyName: 'hubspot_owner_id', operator: 'NOT_HAS_PROPERTY' },
    ],
    'hs_timestamp', sinceMs, untilMs,
    ['hs_timestamp', 'hs_communication_channel_type', 'hs_object_source', 'hs_object_source_id']);
  diag.fetched = rows.length;
  // Guarda: só INTEGRATION (Treble). owner-nulo hoje = 100% Treble, mas protege o futuro.
  const integ = rows.filter(r => String((r.properties || {}).hs_object_source || '') === 'INTEGRATION');
  diag.integration = integ.length;
  if (!integ.length) return { comms: [], diagnostics: diag };
  const comms = integ.map(r => ({
    id: r.id, tipo: 'communications', canal: 'WHATS_APP', treble: true,
    ts: r.properties.hs_timestamp, bdr: null, contact_id: null, company_id: null,
  }));
  await fetchActivityAssociations(token, comms);
  const contactIds = comms.map(c => c.contact_id).filter(Boolean);
  diag.withContact = contactIds.length;
  const ownerByContact = await fetchContactOwners(token, contactIds);
  comms.forEach(c => {
    const ownerId = c.contact_id ? ownerByContact[c.contact_id] : null;
    c.bdr = ownerId ? (idToBdr[ownerId] || null) : null;
    if (c.bdr) diag.attributed += 1; else diag.unknown += 1;
  });
  return { comms: comms.filter(c => c.bdr), diagnostics: diag };
}

async function fetchActivities(token, teamIds, idToBdr, sinceMs, untilMs) {
  const dispMap = await fetchCallDispositions(token);
  const out = [];
  await Promise.all(Object.keys(ACTIVITY_TYPES).map(async type => {
    const rows = await searchWindow(token, type,
      [{ propertyName: 'hubspot_owner_id', operator: 'IN', values: teamIds }],
      'hs_timestamp', sinceMs, untilMs, ACTIVITY_TYPES[type]);
    rows.forEach(r => {
      const p = r.properties;
      const a = { id: r.id, tipo: type, bdr: idToBdr[p.hubspot_owner_id] || null, ts: p.hs_timestamp };
      if (type === 'calls') {
        a.duracao_ms = p.hs_call_duration != null && p.hs_call_duration !== '' ? Number(p.hs_call_duration) : null;
        a.desfecho = dispMap[p.hs_call_disposition] || null;
        // Preserva o GUID cru: o BQ classifica desfecho por GUID e o consumidor
        // (bdr-workload-semantic) deve usar a MESMA chave, senao a definicao de
        // "conectada" muda entre hoje (live) e o historico (BQ). O label e so
        // para exibicao e pode variar com idioma/customizacao do portal.
        a.desfechoId = p.hs_call_disposition || null;
      }
      if (type === 'emails') a.direction = p.hs_email_direction || null;
      if (type === 'communications') a.canal = p.hs_communication_channel_type || null;
      out.push(a);
    });
  }));
  const associationDiagnostics = await fetchActivityAssociations(token, out);
  Object.defineProperty(out, 'associationDiagnostics', { value: associationDiagnostics, enumerable: false });
  // Treble WhatsApp (owner nulo) atribuído pelo dono do contato — some ao canal WhatsApp.
  const treble = await fetchTrebleWhatsapp(token, idToBdr, sinceMs, untilMs);
  treble.comms.forEach(c => out.push(c));
  Object.defineProperty(out, 'trebleDiagnostics', { value: treble.diagnostics, enumerable: false });
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

// Canal MECE do toque, a partir do que o armazém guarda. Mesma régua da versão
// antiga: nota e tarefa NÃO são canal de contato com o cliente.
function tipoDoToque(t) {
  if (t.kind === 'communications') return 'communications';
  return t.kind;
}

// ATRIBUIÇÃO POR DONO DO CONTATO — onde ela vale por decisão, e onde é pergunta
// aberta. O armazém marca `owner_attributed` no toque cujo dono veio do contato
// associado (o próprio toque não tinha dono).
//
// Para WhatsApp/LinkedIn (`communications`) isso é DECISÃO REGISTRADA: disparo via
// integração chega sem dono, e o disparo é do BDR. É o caso Treble.
//
// Para E-MAIL e NOTA a pergunta ficou aberta durante a migração e foi FECHADA
// pelo dono da área em 10/08/2026, com o critério explícito:
//
//     "Nota não é ação. E-mail é."
//
// E-mail sem dono é envio que aconteceu: alguém mandou, e o destinatário recebeu.
// Nota sem dono é quase sempre registro de automação escrevendo no CRM — não é
// trabalho de uma pessoa, e creditá-la infla a régua de produtividade. Medido em
// 01–06/08/2026: 425 notas atribuídas contra 429 com dono próprio (atribuir
// quase dobraria a contagem de nota do time) e 197 e-mails atribuídos.
//
// A régua MUDOU em relação à versão anterior deste arquivo, que descartava e-mail
// junto com nota. Quem comparar um número de workload de antes com um de depois
// vai ver e-mail subir, e o motivo é este — está declarado em `premissas` e a
// separação sai medida em `diagnostics.rawCounts.atribuicaoPorDonoDoContato`.
const ATRIBUICAO_POR_DECISAO = new Set(['communications', 'emails']);

// Contrapartida da decisão: NOTA nunca é atribuída no default. Fica nomeado em
// vez de ser "o que sobrou do Set acima" — a régua tem de ser legível dos dois
// lados, senão daqui a seis meses alguém adiciona 'notes' sem saber que existiu
// uma decisão.
const ATRIBUICAO_RECUSADA_POR_DECISAO = new Set(['notes']);

async function buildPayloadArmazem(idToBdr, teamIds, sinceMs, untilMs, opcoes = {}) {
  const todosAtribuidos = opcoes.atribuidos === 'todos';
  const w = await whq.workloadPayload(teamIds, sinceMs, untilMs);
  const S = wh.str, N = wh.num, TS = wh.timestamp;

  const companiesCreated = w.empresas.map(c => ({
    id: S(c.company_id),
    nome: S(c.company_name) || '(sem nome)',
    bdr: idToBdr[S(c.owner_id)] || null,
    colaboradores: c.employees == null ? null : Number(c.employees),
    fonte: sourceOf({ hs_object_source_detail_1: S(c.source_detail),
                      hs_object_source_label: S(c.source_label) }),
    criado: TS(c.hs_created_at),
  }));

  const contactsCreated = w.contatos.map(c => {
    const colabs = c.numero_de_colaboradores != null
      ? Number(c.numero_de_colaboradores)
      : (c.employees == null ? null : Number(c.employees));
    return {
      id: S(c.contact_id),
      nome: [S(c.first_name), S(c.last_name)].filter(Boolean).join(' ') || '(sem nome)',
      cargo: S(c.job_title),
      bdr: idToBdr[S(c.owner_id)] || null,
      empresa_id: S(c.company_id_prop),
      empresa: S(c.company_name),
      colaboradores: Number.isFinite(colabs) ? colabs : null,
      fonte: sourceOf({ hs_object_source_detail_1: S(c.source_detail),
                        hs_object_source_label: S(c.source_label) }),
      status: S(c.lead_status),
      criado: TS(c.hs_created_at),
    };
  });

  const transitions = w.transicoes.map(t => ({
    contato_id: S(t.contact_id),
    nome: [S(t.first_name), S(t.last_name)].filter(Boolean).join(' ') || '(sem nome)',
    cargo: S(t.job_title),
    bdr: idToBdr[S(t.owner_id)] || null,
    empresa_id: S(t.company_id_prop),
    de: S(t.old_value),
    para: S(t.new_value),
    ts: TS(t.changed_at),
    empresa: S(t.company_name),
    colaboradores: t.employees == null ? null : Number(t.employees),
  })).sort((a, b) => (a.ts < b.ts ? -1 : 1));

  const activities = w.toques.filter(t => {
    if (!wh.bool(t.owner_attributed)) return true;
    return todosAtribuidos || ATRIBUICAO_POR_DECISAO.has(String(t.kind));
  }).map(t => {
    const a = {
      owner_atribuido: wh.bool(t.owner_attributed),
      id: S(t.engagement_id),
      tipo: tipoDoToque(t),
      bdr: idToBdr[S(t.owner_id)] || null,
      ts: TS(t.occurred_at),
      contact_id: S(t.contact_id),
      company_id: S(t.company_id),
    };
    if (a.tipo === 'calls') {
      a.duracao_ms = t.duration_ms == null ? null : Number(t.duration_ms);
      a.desfecho = S(t.disposition_label);
      // GUID cru: é a chave que o bdr-workload-semantic usa para classificar
      // "conectada". Trocar por rótulo mudaria a definição entre hoje e o histórico.
      a.desfechoId = S(t.disposition_id);
    }
    if (a.tipo === 'emails') a.direction = S(t.direction);
    if (a.tipo === 'communications') {
      a.canal = S(t.channel_type);
      // Treble = WhatsApp de integração. Sem passo separado: a atribuição pelo
      // dono do contato já está feita na fato (`owner_attributed`).
      a.treble = String(t.source_label || '').toUpperCase() === 'INTEGRATION';
    }
    return a;
  }).sort((a, b) => (a.ts < b.ts ? -1 : 1));

  const trebleCount = activities.filter(a => a.treble).length;

  // PARTIÇÃO MECE dos toques sem dono próprio. Um toque atribuído cai em
  // exatamente um balde, e a soma dos baldes é o total — a asserção abaixo é o
  // que impede a régua de mudar sem ninguém ver. Só declarar o descarte (como
  // era antes) conta metade da história: não dava para saber o que ENTROU.
  const atribuidos = w.toques.filter(t => wh.bool(t.owner_attributed));
  const porTipo = (lista) => lista.reduce((acc, t) => {
    const k = String(t.kind); acc[k] = (acc[k] || 0) + 1; return acc;
  }, {});
  const entraram = atribuidos.filter(t => todosAtribuidos || ATRIBUICAO_POR_DECISAO.has(String(t.kind)));
  const descartados = atribuidos.filter(t => !(todosAtribuidos || ATRIBUICAO_POR_DECISAO.has(String(t.kind))));
  const atribuidosDescartados = descartados.length;
  if (entraram.length + descartados.length !== atribuidos.length) {
    // Impossível por construção — e é exatamente por isso que vale afirmar:
    // se um dia alguém trocar o filtro por um que não particiona, quebra aqui
    // em vez de publicar um total que não fecha.
    throw new Error(`particao de atribuicao nao fecha: ${entraram.length}+${descartados.length}`
      + ` != ${atribuidos.length}`);
  }
  return {
    companiesCreated, contactsCreated, transitions, activities,
    diagnostics: {
      teamIdsCount: teamIds.length,
      ownersInHubSpot: null,
      unresolvedOwnersCount: null,
      rawCounts: {
        companiesCreated: companiesCreated.length,
        contactsCreated: contactsCreated.length,
        contactsTouched: null,
        activities: activities.length,
        activitiesWithContactAssociation: activities.filter(a => a.contact_id).length,
        activitiesWithCompanyAssociation: activities.filter(a => a.company_id).length,
        activityAssociations: { available: true,
          nota: 'associacao vem como coluna da fato; nao ha rodada de batch a falhar' },
        trebleWhatsapp: { fetched: trebleCount, integration: trebleCount,
          withContact: activities.filter(a => a.treble && a.contact_id).length,
          attributed: trebleCount, unknown: 0,
          nota: 'sem passo separado: owner_attributed ja resolve a atribuicao pelo dono do contato' },
        transitions: transitions.length,
        // Cap declarado. Silenciar seria dizer "cobrimos tudo" cobrindo menos.
        toquesAtribuidosDescartados: atribuidosDescartados,
        // Os dois lados da régua, medidos. `total` = `entraram` + `descartados`,
        // sempre — a asserção acima garante.
        atribuicaoPorDonoDoContato: {
          regra: 'e-mail e communications ENTRAM; nota NAO (decisao de 10/08/2026: nota nao e acao, e-mail e)',
          total: atribuidos.length,
          entraram: entraram.length,
          descartados: descartados.length,
          entraramPorTipo: porTipo(entraram),
          descartadosPorTipo: porTipo(descartados),
          comoIncluirTudo: '?atribuidos=todos',
        },
      },
      sqlStatusNote: 'Qualificado conta transição de hs_lead_status para OPEN_DEAL no contato. SQL real por deal requer consulta separada ao pipeline de deals.',
    },
    premissas: {
      fonte: 'dim_company + dim_contact + fact_crm_change + fact_engagement',
      // Esta chave se chamava `atribuicao` e havia OUTRA `atribuicao` mais
      // abaixo no mesmo literal: em JS a segunda vence e esta aqui nunca chegava
      // ao payload. Premissa que nao e lida nao e premissa. Nomes separados
      // agora, porque sao dois fatos diferentes — de onde vem o dono quando ele
      // EXISTE, e o que se faz quando ele NAO existe.
      atribuicao_dono_proprio: 'hubspot_owner_id do objeto, resolvido pelo roster canonico (resolveTeamIds)',
      transicao: 'fact_crm_change de hs_lead_status, com old_value ja COLAPSADO — re-save do mesmo status nao conta como transicao, e na versao antiga contava',
      treble: 'owner_attributed marca o toque atribuido pelo dono do contato; source_label=INTEGRATION separa Treble de WhatsApp manual',
      desfecho: 'GUID em desfechoId (chave canonica) e rotulo do PORTAL em desfecho',
      atribuicao_sem_dono: 'toque SEM dono proprio vai para o dono do contato em communications (decisao do Treble) e em E-MAIL (decisao de 10/08/2026: "nota nao e acao, e-mail e"). NOTA e descartada por decisao — nota sem dono e quase sempre automacao escrevendo no CRM, e credita-la infla a regua de produtividade. A particao sai medida em diagnostics.rawCounts.atribuicaoPorDonoDoContato (entraram + descartados = total). `?atribuidos=todos` inclui tudo. Cada toque carrega owner_atribuido',
      atribuicao_mudanca: 'ATE 09/08/2026 o e-mail era DESCARTADO junto com a nota. Comparacao de workload que cruze essa data vai ver e-mail subir por mudanca de regua, nao por mudanca de esforco',
      diagnostics_nulos: 'ownersInHubSpot, unresolvedOwnersCount e contactsTouched sao da mecanica da API e nao existem aqui',
    },
  };
}

async function buildPayload(token, sinceMs, untilMs, opcoes = {}) {
  const viaBQ = opcoes.fonte !== 'api' && wh.isConfigured();
  const ownerMap = viaBQ ? await whq.ownerMap() : await fetchOwnersRaw(token);
  // Janela em BRT (UTC-3) — é a régua de dia que o resto do workload usa.
  const janelaSince = new Date(sinceMs - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const janelaUntil = new Date(untilMs - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const idToBdrBruto = resolveTeamIds(ownerMap);
  // BDR que JÁ tinha saído no primeiro dia da janela sai do payload inteiro:
  // não adianta filtrar depois, porque cada request a menos no HubSpot é
  // orçamento de API que não se gasta com quem não trabalha mais aqui. Janela
  // que CRUZA a saída mantém o dono (o corte fino é por dia, no agregador).
  const idToBdr = {};
  Object.keys(idToBdrBruto).forEach((id) => {
    if (isActiveBdrOn(idToBdrBruto[id], janelaSince)) idToBdr[id] = idToBdrBruto[id];
  });
  const teamIds = Object.keys(idToBdr);
  if (!teamIds.length) throw new Error('Nenhum owner do time de BDRs encontrado no portal');
  const teamDaJanela = activeTeam(janelaSince, janelaUntil);

  if (viaBQ) {
    const p = await buildPayloadArmazem(idToBdr, teamIds, sinceMs, untilMs,
      { atribuidos: opcoes.atribuidos });
    return { success: true, generatedAt: new Date().toISOString(), team: teamDaJanela,
             fonte: 'bq', ...p };
  }

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
      { propertyName: 'lastmodifieddate', operator: 'BETWEEN', value: String(sinceMs), highValue: String(untilMs) },
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

  // Diagnósticos (sem PII) para auditoria de dados
  const unresolvedOwners = findUnresolvedOwners(ownerMap);
  const diagnostics = {
    teamIdsCount: teamIds.length,
    ownersInHubSpot: Object.keys(ownerMap).length,
    unresolvedOwnersCount: unresolvedOwners.length,
    rawCounts: {
      companiesCreated: companiesRaw.length,
      contactsCreated: contactsCreatedRaw.length,
      contactsTouched: contactsTouchedRaw.length,
      activities: activities.length,
      activitiesWithContactAssociation: activities.filter(a => a.contact_id).length,
      activitiesWithCompanyAssociation: activities.filter(a => a.company_id).length,
      activityAssociations: activities.associationDiagnostics || { attempted: 0, succeeded: 0, errors: 0, available: false },
      trebleWhatsapp: activities.trebleDiagnostics || { fetched: 0, integration: 0, withContact: 0, attributed: 0, unknown: 0 },
      transitions: transitions.length,
    },
    sqlStatusNote: 'Qualificado conta transição de hs_lead_status para OPEN_DEAL no contato. SQL real por deal requer consulta separada ao pipeline de deals.',
  };

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    team: teamDaJanela,
    fonte: 'api',
    companiesCreated,
    contactsCreated,
    transitions,
    activities,
    diagnostics,
  };
}

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['GET'])) return;
  const user = requireAuth(req, res);
  if (!user) return;

  const q = new URL(`http://x${req.url}`).searchParams;
  const fonte = q.get('fonte');

  // Com a leitura no armazém o PAT deixa de ser pré-requisito para responder.
  let token = null;
  if (fonte === 'api' || !wh.isConfigured()) {
    try { token = getHubspotToken(); }
    catch (e) { return res.status(503).json({ success: false, error: e.message }); }
  }
  const reISO = /^\d{4}-\d{2}-\d{2}$/;
  const since = q.get('since'), until = q.get('until');
  if (!reISO.test(since || '') || !reISO.test(until || '')) {
    return res.status(400).json({ success: false, error: 'since e until obrigatórios (YYYY-MM-DD)' });
  }
  // Janela em America/Sao_Paulo (UTC-3, sem DST desde 2019)
  const sinceMs = Date.parse(`${since}T00:00:00.000-03:00`);
  const untilMs = Date.parse(`${until}T23:59:59.999-03:00`);
  if (!(sinceMs <= untilMs)) return res.status(400).json({ success: false, error: 'since > until' });

  // A fonte entra na chave: sem isso a comparação leria a resposta da outra.
  const key = `${since}|${until}|${fonte === 'api' ? 'api' : 'bq'}|${q.get('atribuidos') || ''}`;
  const kvKey = env.kvKey(`workload:${key}`); // namespaced por ambiente (dev/prod não colidem)
  const refresh = q.get('refresh') === '1';
  const todayIso = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const includesToday = since <= todayIso && until >= todayIso;
  const ttlMs = includesToday ? TODAY_CACHE_TTL : CACHE_TTL;
  const maxStaleMs = includesToday ? MAX_STALE_TODAY : MAX_STALE_HISTORY;

  // Cache em 2 camadas: L1 memória (por instância) + L2 KV (durável, compartilhado).
  // KV é dependência mole: se ausente/erro, degrada para L1 + live sem lançar.
  async function kvGet() {
    if (!kv.isConfigured()) return null;
    try { return await kv.getJSON(kvKey); } catch (e) { console.error('[bdr-workload] KV get', e.message); return null; }
  }
  async function kvSet(entry) {
    if (!kv.isConfigured()) return;
    try { await kv.setJSON(kvKey, entry); } catch (e) { console.error('[bdr-workload] KV set', e.message); }
  }
  const fresh = (entry) => entry && (Date.now() - entry.at < ttlMs);

  try {
    if (!refresh) {
      const l1 = _cache[key];
      if (fresh(l1)) return res.status(200).json({ ...(l1.data), cached: true, cacheLayer: 'memory', staleAgeMs: Date.now() - l1.at });
      const l2 = includesToday ? null : await kvGet();
      if (fresh(l2)) {
        _cache = { [key]: l2 }; // reidrata L1 após cold start
        return res.status(200).json({ ...(l2.data), cached: true, cacheLayer: 'kv', staleAgeMs: Date.now() - l2.at });
      }
    }
    const data = await buildPayload(token, sinceMs, untilMs,
      { fonte, atribuidos: q.get('atribuidos') });
    const entry = { at: Date.now(), data };
    _cache = { [key]: entry };
    await kvSet(entry); // best-effort
    return res.status(200).json(data);
  } catch (e) {
    console.error('[bdr-workload]', e.message);
    const l1 = _cache[key];
    if (l1 && Date.now() - l1.at <= maxStaleMs) return res.status(200).json({ ...(l1.data), cached: true, stale: true, staleAgeMs: Date.now() - l1.at, staleError: e.message });
    const l2 = await kvGet();
    if (l2 && Date.now() - l2.at <= maxStaleMs) return res.status(200).json({ ...(l2.data), cached: true, stale: true, cacheLayer: 'kv', staleAgeMs: Date.now() - l2.at, staleError: e.message });
    return res.status(500).json({ success: false, error: e.message });
  }
};

// Serviço interno para consumidores agregados server-side. Nunca expõe o payload
// nominal diretamente; `/api/bdr-workload-semantic` reduz para métricas antes de responder.
module.exports._service = { buildPayload };
module.exports._test = { fetchActivityAssociations, smallestAssociationId, fetchTrebleWhatsapp, fetchContactOwners };
