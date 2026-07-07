'use strict';

const { setCORSHeaders, requireAuth, getHubspotToken, methodCheck } = require('./_helpers');
const { readSpreadsheetRange, listSpreadsheetTabs } = require('../lib/sheets');
const { hubspotPost, fetchOwners } = require('../lib/hubspot');

const DEFAULT_SPREADSHEET_ID = '1dkjxOiNx1sM_YMhUk9VfO4-HxaOId94RCm9cSpp7cK0';
const DEFAULT_RULES = {
  minContactsPerCompany: 2,
  staleActivityDays: 7,
  highRiskDaysWithoutCreation: 5,
  highRiskDaysWithoutActivity: 7,
};
const CACHE_TTL_MS = 30 * 60 * 1000;
const PORTAL_ID = '44715285';
const PIPELINE_LABELS = { '782758156': 'Vendas', '894130090': 'Bid' };
const STAGE_LABELS = {
  '1144746905': 'Reunião Agendada', '1144746906': 'Diagnóstico', '1144746908': 'Cotação',
  '1144746909': 'Consultoria', '1144746910': 'Negociação', '1317543716': 'Stand by',
  '1288611084': 'Implantação', '1144844314': 'Ganho', '1144746911': 'Perdido',
  '1363560722': 'Cotação', '1349620551': 'Reunião Pré-RFP', '1349620555': 'Proposta Enviada',
  '1349620556': 'Consultoria', '1353387279': 'Negociação', '1353387280': 'Ganho',
  '1353457025': 'Implantação', '1373066362': 'Standby'
};
const COMPANY_PROPERTIES = [
  'name', 'domain', 'hubspot_owner_id', 'createdate', 'hs_lastmodifieddate',
  'numberofemployees', 'lifecyclestage', 'industry', 'num_associated_contacts',
  'num_associated_deals', 'hs_num_open_deals', 'recent_deal_close_date',
  'notes_last_updated', 'notes_last_contacted', 'num_contacted_notes',
  'hs_last_sales_activity_timestamp', 'hs_last_logged_call_date',
  'hs_last_booked_meeting_date', 'hs_last_open_task_date', 'hs_object_id'
];
const DEAL_PROPERTIES = [
  'dealname', 'dealstage', 'pipeline', 'amount', 'arr_estimado', 'primeira_fatura', 'premio_mensal',
  'hubspot_owner_id', 'sdr', 'createdate', 'closedate', 'hs_object_id', 'hs_is_closed_won',
  'hs_is_closed_lost', 'motivo_do_declinio_ou_perdido', 'motivo_de_declinio_perdido___descricao',
  'notes_last_updated', 'hs_last_sales_activity_timestamp'
];

let cacheKey = null;
let cacheTime = 0;
let cachePayload = null;

function norm(v) {
  return String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(ltda|limitada|s\/?a|sa|s a|me|epp|eireli|holding|grupo)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function normalizeDomain(v) {
  let s = String(v || '').trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('?')[0];
  return s || null;
}
function slug(v) { return norm(v).replace(/\s+/g, '_') || 'sem_id'; }
function n(v) { const x = Number(String(v || '').replace(/\./g, '').replace(',', '.')); return isNaN(x) ? 0 : x; }
function int(v) { const x = parseInt(String(v || '').replace(/\D/g, ''), 10); return isNaN(x) ? 0 : x; }
function iso(v) { return v ? String(v).substring(0, 10) : null; }
function daysBetween(a, b) { const da = a ? Date.parse(a) : NaN; const db = b ? Date.parse(b) : Date.now(); return isNaN(da) ? null : Math.max(0, Math.floor((db - da) / 86400000)); }
function median(arr) { const xs = arr.filter(x => Number.isFinite(x)).sort((a, b) => a - b); if (!xs.length) return 0; const m = Math.floor(xs.length / 2); return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2; }
function pct(a, b) { return b ? a / b : 0; }
function safeDateMax(values) { return values.filter(Boolean).sort().pop() || null; }

function headerIndex(headers) {
  const out = {};
  headers.forEach((h, i) => { out[norm(h).replace(/\s+/g, '_')] = i; });
  return out;
}
function pick(row, idx, names) {
  for (const name of names) {
    const key = norm(name).replace(/\s+/g, '_');
    if (idx[key] != null && row[idx[key]] != null && String(row[idx[key]]).trim() !== '') return String(row[idx[key]]).trim();
  }
  return '';
}
function parseCompanyId(raw) {
  const s = String(raw || '');
  const m = s.match(/company\/(\d+)/) || s.match(/companies\/(\d+)/) || s.match(/\b(\d{6,})\b/);
  return m ? m[1] : '';
}
function bdrFromTab(tab) { return String(tab || '').replace(/^\d+\s*-\s*/, '').trim(); }

async function readListRows(spreadsheetId, tabsParam) {
  let tabs = tabsParam ? tabsParam.split(',').map(s => s.trim()).filter(Boolean) : [];
  if (!tabs.length) {
    const allTabs = await listSpreadsheetTabs(spreadsheetId);
    tabs = allTabs.filter(t => /^\d{2}\s*-\s*/.test(t));
    if (!tabs.length && allTabs.includes('Lista Clean')) tabs = ['Lista Clean'];
  }
  const rows = [];
  for (const tab of tabs) {
    const values = await readSpreadsheetRange(spreadsheetId, `'${tab.replace(/'/g, "''")}'!A:Z`);
    if (!values || values.length < 2) continue;
    const idx = headerIndex(values[0]);
    values.slice(1).forEach((r, i) => {
      const name = pick(r, idx, ['company_name', 'name', 'empresa']);
      if (!name) return;
      const rawId = pick(r, idx, ['company_id_or_apollo_id', 'hubspot_company_id', 'company_id', 'hubspot_link']);
      const hsId = parseCompanyId(rawId) || parseCompanyId(pick(r, idx, ['hubspot_link']));
      const assigned = pick(r, idx, ['assigned_bdr', 'owner_bdr', 'bdr']) || bdrFromTab(tab);
      const lives = n(pick(r, idx, ['lives_count', 'vidas_or_employees', 'vidas', 'employees', 'numberofemployees']));
      const domain = normalizeDomain(pick(r, idx, ['company_domain', 'domain', 'company_website', 'website']));
      rows.push({
        listCompanyId: `${tab}:${i + 2}:${slug(name)}:${domain || hsId || ''}`,
        companyNameFromList: name,
        companyDomainFromList: domain,
        companyWebsiteFromList: pick(r, idx, ['company_website', 'website']),
        cnpjFromList: pick(r, idx, ['cnpj']),
        assignedBdrFromList: assigned || 'Sem BDR',
        listBatch: pick(r, idx, ['list_batch', 'run_id']) || tab,
        listCreatedAt: iso(pick(r, idx, ['list_created_at', 'distributed_at', 'created_at'])) || null,
        priority: pick(r, idx, ['priority', 'rank_no_lote']) || '',
        segmentFromList: pick(r, idx, ['segment', 'industry', 'status_abm']) || '',
        companySizeFromList: pick(r, idx, ['company_size', 'tier']) || '',
        livesCountFromList: lives || null,
        livesRangeFromList: livesRange(lives),
        sourceFromList: pick(r, idx, ['source', 'source_primary', 'bucket_fonte']) || '',
        notes: pick(r, idx, ['notes', 'qa_flags', 'first_action_suggested']) || '',
        hubspotCompanyIdFromList: hsId || null,
      });
    });
  }
  return rows;
}

function livesRange(v) {
  const x = Number(v) || 0;
  if (!x) return 'Sem dado';
  if (x < 200) return '<200';
  if (x < 500) return '200 a 499';
  if (x < 1000) return '500 a 999';
  if (x < 3000) return '1.000 a 2.999';
  if (x < 5000) return '3.000 a 4.999';
  return '5.000+';
}

async function batchRead(token, objectType, ids, properties) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  const out = {};
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const resp = await hubspotPost(token, `/crm/v3/objects/${objectType}/batch/read`, { properties, inputs: chunk.map(id => ({ id })) });
    (resp.results || []).forEach(r => { out[String(r.id)] = Object.assign({ hs_object_id: String(r.id) }, r.properties || {}); });
  }
  return out;
}

async function searchRecentCompanies(token, sinceIso) {
  if (!sinceIso) return [];
  let after = 0, hasMore = true, all = [];
  while (hasMore && all.length < 5000) {
    const resp = await hubspotPost(token, '/crm/v3/objects/companies/search', {
      filterGroups: [{ filters: [{ propertyName: 'createdate', operator: 'GTE', value: String(Date.parse(sinceIso + 'T00:00:00Z')) }] }],
      properties: COMPANY_PROPERTIES,
      limit: 200,
      after,
    });
    all = all.concat((resp.results || []).map(r => Object.assign({ hs_object_id: String(r.id) }, r.properties || {})));
    hasMore = resp.paging && resp.paging.next && resp.paging.next.after != null;
    after = hasMore ? resp.paging.next.after : 0;
  }
  return all;
}

async function associationMap(token, fromType, toType, ids) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  const out = {};
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const resp = await hubspotPost(token, `/crm/v4/associations/${fromType}/${toType}/batch/read`, { inputs: chunk.map(id => ({ id })) });
    (resp.results || []).forEach(r => { out[String(r.from && r.from.id)] = (r.to || []).map(t => String(t.toObjectId)).filter(Boolean); });
  }
  return out;
}

function dealValue(d) {
  return n(d.amount) || n(d.arr_estimado) || (n(d.primeira_fatura) * 12) || (n(d.premio_mensal) * 12) || 0;
}
function latestDealStage(deals) {
  if (!deals.length) return null;
  const sorted = deals.slice().sort((a, b) => String(b.createdate || '').localeCompare(String(a.createdate || '')));
  return STAGE_LABELS[sorted[0].dealstage] || sorted[0].dealstage || null;
}
function classifyAttackStatus(matched, contacts, hasActivity, deals) {
  if (!matched) return 'not_in_hubspot';
  if (!contacts) return 'created_no_contacts';
  if (!hasActivity) return 'created_with_contacts_no_activity';
  if (!deals.length) return 'contacted_no_deal';
  if (deals.some(d => d.hs_is_closed_won === 'true')) return 'closed_won';
  if (deals.some(d => d.hs_is_closed_lost === 'true') && !deals.some(d => d.hs_is_closed_won !== 'true' && d.hs_is_closed_lost !== 'true')) return 'closed_lost';
  if (deals.some(d => d.hs_is_closed_won !== 'true' && d.hs_is_closed_lost !== 'true')) return 'active_pipeline';
  return 'deal_created';
}
function classifyVisibility(matched, contacts, hasActivity, deals, lostReason) {
  if (!matched || (!contacts && !hasActivity)) return 'no_visibility';
  if (contacts < DEFAULT_RULES.minContactsPerCompany || !hasActivity) return 'partial_visibility';
  if (deals.length && (deals.some(d => d.hs_is_closed_won !== 'true' && d.hs_is_closed_lost !== 'true') || lostReason)) return 'high_visibility';
  return 'good_visibility';
}
function riskLevel(row, matched, contacts, hasActivity, lastActivity) {
  const noCreateDays = daysBetween(row.listCreatedAt || '2026-06-23');
  const stale = lastActivity ? daysBetween(lastActivity) : null;
  if (!matched && noCreateDays != null && noCreateDays > DEFAULT_RULES.highRiskDaysWithoutCreation) return 'high';
  if (matched && (!contacts || !hasActivity)) return 'high';
  if (stale != null && stale > DEFAULT_RULES.highRiskDaysWithoutActivity) return 'high';
  if (matched && contacts && (!hasActivity || stale == null || stale > DEFAULT_RULES.staleActivityDays)) return 'medium';
  return 'low';
}

async function buildPayload(req) {
  const allowQueryConfig = process.env.LIST_ATTACK_ALLOW_QUERY_CONFIG === 'true';
  const spreadsheetId = String((allowQueryConfig && req.query.sheetId) || process.env.LIST_ATTACK_SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID);
  const tabsParam = String((allowQueryConfig && req.query.tabs) || process.env.LIST_ATTACK_TABS || '').trim();
  const token = getHubspotToken();
  const [listRows, ownerMap] = await Promise.all([readListRows(spreadsheetId, tabsParam), fetchOwners(token)]);
  const idsFromList = [...new Set(listRows.map(r => r.hubspotCompanyIdFromList).filter(Boolean))];
  const minDate = listRows.map(r => r.listCreatedAt).filter(Boolean).sort()[0] || '2026-06-23';
  const [companiesById, recentCompanies] = await Promise.all([
    batchRead(token, 'companies', idsFromList, COMPANY_PROPERTIES),
    searchRecentCompanies(token, minDate)
  ]);
  recentCompanies.forEach(c => { companiesById[String(c.hs_object_id)] = c; });
  const byDomain = {}, byName = {};
  Object.keys(companiesById).forEach(id => {
    const c = companiesById[id];
    const d = normalizeDomain(c.domain); if (d) byDomain[d] = c;
    const name = norm(c.name); if (name) byName[name] = c;
  });
  const matchedIds = [];
  const matchInfo = {};
  listRows.forEach(r => {
    let c = r.hubspotCompanyIdFromList ? companiesById[String(r.hubspotCompanyIdFromList)] : null;
    let method = c ? 'manual' : null;
    let conf = c ? 'high' : 'none';
    if (!c && r.companyDomainFromList && byDomain[r.companyDomainFromList]) { c = byDomain[r.companyDomainFromList]; method = 'domain'; conf = 'high'; }
    if (!c && byName[norm(r.companyNameFromList)]) { c = byName[norm(r.companyNameFromList)]; method = 'exact_name'; conf = 'medium'; }
    if (c) matchedIds.push(String(c.hs_object_id));
    matchInfo[r.listCompanyId] = { company: c, method, conf };
  });
  const companyDealIds = await associationMap(token, 'companies', 'deals', matchedIds);
  const allDealIds = [...new Set(Object.values(companyDealIds).flat())];
  const dealsById = await batchRead(token, 'deals', allDealIds, DEAL_PROPERTIES);
  const records = listRows.map(r => {
    const mi = matchInfo[r.listCompanyId] || {};
    const c = mi.company || null;
    const cid = c ? String(c.hs_object_id) : null;
    const deals = cid ? (companyDealIds[cid] || []).map(id => dealsById[id]).filter(Boolean) : [];
    const contacts = c ? int(c.num_associated_contacts) : 0;
    const lastActivity = c ? safeDateMax([c.hs_last_sales_activity_timestamp, c.notes_last_contacted, c.notes_last_updated, c.hs_last_logged_call_date, c.hs_last_booked_meeting_date, c.hs_last_open_task_date]) : null;
    const hasActivity = !!lastActivity || int(c && c.num_contacted_notes) > 0 || deals.some(d => d.notes_last_updated || d.hs_last_sales_activity_timestamp);
    const won = deals.filter(d => d.hs_is_closed_won === 'true');
    const lost = deals.filter(d => d.hs_is_closed_lost === 'true');
    const active = deals.filter(d => d.hs_is_closed_won !== 'true' && d.hs_is_closed_lost !== 'true');
    const lostDeal = lost.slice().sort((a, b) => String(b.closedate || '').localeCompare(String(a.closedate || '')))[0] || null;
    const lostReason = lostDeal ? (lostDeal.motivo_do_declinio_ou_perdido || '') : '';
    const status = classifyAttackStatus(!!c, contacts, hasActivity, deals);
    const vis = classifyVisibility(!!c, contacts, hasActivity, deals, lostReason);
    return Object.assign({}, r, {
      hubspotCompanyId: cid,
      hubspotCompanyName: c && c.name || null,
      hubspotCompanyDomain: c && normalizeDomain(c.domain) || null,
      hubspotCompanyUrl: cid ? `https://app.hubspot.com/contacts/${PORTAL_ID}/company/${cid}` : null,
      hubspotOwnerId: c && c.hubspot_owner_id || null,
      hubspotOwnerName: c && (ownerMap[c.hubspot_owner_id] || c.hubspot_owner_id) || null,
      matchedInHubSpot: !!c,
      matchConfidence: mi.conf || 'none',
      matchMethod: mi.method || null,
      companyCreatedAt: c && iso(c.createdate) || null,
      companyCreatedBy: null,
      daysUntilCreated: c && r.listCreatedAt ? daysBetween(r.listCreatedAt, c.createdate) : null,
      wasCreatedAfterListGeneration: !!(c && r.listCreatedAt && iso(c.createdate) >= r.listCreatedAt),
      associatedContactsCount: contacts,
      contactsCreatedAfterListGeneration: null,
      contactsCreatedByBdrCount: null,
      contactsPerCompany: contacts,
      hasMinimumContactPenetration: contacts >= DEFAULT_RULES.minContactsPerCompany,
      totalActivitiesCount: int(c && c.num_contacted_notes) || (hasActivity ? 1 : 0),
      bdrActivitiesCount: null,
      firstActivityDate: null,
      lastActivityDate: iso(lastActivity),
      hasCommercialActivity: hasActivity,
      hasBdrActivity: hasActivity,
      daysSinceLastActivity: lastActivity ? daysBetween(lastActivity) : null,
      associatedDealsCount: deals.length,
      activeDealsCount: active.length,
      closedLostDealsCount: lost.length,
      closedWonDealsCount: won.length,
      currentDealStage: latestDealStage(active.length ? active : deals),
      currentPipeline: active[0] ? (PIPELINE_LABELS[active[0].pipeline] || active[0].pipeline) : null,
      latestDealCreatedAt: iso((deals.slice().sort((a,b)=>String(b.createdate||'').localeCompare(String(a.createdate||'')))[0] || {}).createdate),
      latestDealAmount: active.reduce((s, d) => s + dealValue(d), 0) || deals.reduce((s, d) => s + dealValue(d), 0),
      hasLostReason: !!lostReason,
      lostReason: lostReason || null,
      lostReasonDetail: lostDeal && lostDeal.motivo_de_declinio_perdido___descricao || null,
      lostAt: lostDeal && iso(lostDeal.closedate) || null,
      attackStatus: status,
      visibilityStatus: vis,
      riskLevel: riskLevel(r, !!c, contacts, hasActivity, iso(lastActivity)),
      suggestedAction: actionFor(status, vis),
      pipelineCreated: deals.reduce((s, d) => s + dealValue(d), 0),
      pipelineActive: active.reduce((s, d) => s + dealValue(d), 0),
      pipelineLost: lost.reduce((s, d) => s + dealValue(d), 0),
      pipelineWon: won.reduce((s, d) => s + dealValue(d), 0),
      updatedAt: new Date().toISOString(),
    });
  });
  return summarize(records, spreadsheetId, tabsParam);
}

function actionFor(status, vis) {
  if (status === 'not_in_hubspot') return 'Verificar se deve ser criada ou justificar descarte';
  if (status === 'created_no_contacts') return 'Criar contatos prioritários';
  if (status === 'created_with_contacts_no_activity') return 'Iniciar cadência comercial';
  if (status === 'contacted_no_deal') return 'Validar se há oportunidade ou motivo de perda';
  if (vis === 'partial_visibility') return 'Completar visibilidade no CRM';
  return 'Acompanhar evolução';
}

function summarize(records, spreadsheetId, tabsParam) {
  const matched = records.filter(r => r.matchedInHubSpot);
  const contacts = matched.map(r => r.associatedContactsCount || 0);
  const k = {
    totalCompanies: records.length,
    matchedCompanies: matched.length,
    notInHubSpot: records.length - matched.length,
    hubspotPresenceRate: pct(matched.length, records.length),
    createdAfterList: matched.filter(r => r.wasCreatedAfterListGeneration).length,
    associatedContacts: records.reduce((s, r) => s + (r.associatedContactsCount || 0), 0),
    avgContactsPerMatchedCompany: matched.length ? contacts.reduce((a, b) => a + b, 0) / matched.length : 0,
    medianContactsPerMatchedCompany: median(contacts),
    companiesWithCommercialActivity: records.filter(r => r.hasCommercialActivity).length,
    attackRate: pct(records.filter(r => r.hasCommercialActivity).length, records.length),
    companiesWithDeal: records.filter(r => r.associatedDealsCount > 0).length,
    activePipelineCompanies: records.filter(r => r.activeDealsCount > 0).length,
    lostCompanies: records.filter(r => r.closedLostDealsCount > 0).length,
    wonCompanies: records.filter(r => r.closedWonDealsCount > 0).length,
    pipelineCreated: records.reduce((s, r) => s + (r.pipelineCreated || 0), 0),
    pipelineActive: records.reduce((s, r) => s + (r.pipelineActive || 0), 0),
    pipelineLost: records.reduce((s, r) => s + (r.pipelineLost || 0), 0),
    pipelineWon: records.reduce((s, r) => s + (r.pipelineWon || 0), 0),
    highRiskCompanies: records.filter(r => r.riskLevel === 'high').length,
    weakMatches: records.filter(r => r.matchConfidence === 'low' || r.matchConfidence === 'medium').length,
  };
  return { success: true, records, metrics: k, meta: { spreadsheetId, tabs: tabsParam || 'auto BDR tabs', processedCompanies: records.length, confidentMatches: records.filter(r => r.matchConfidence === 'high').length, rules: DEFAULT_RULES, timestamp: new Date().toISOString(), source: 'Google Sheets + HubSpot server-side' } };
}

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['GET'])) return;
  const user = requireAuth(req, res);
  if (!user) return;
  const allowQueryConfig = process.env.LIST_ATTACK_ALLOW_QUERY_CONFIG === 'true';
  const key = JSON.stringify({ sheetId: (allowQueryConfig && req.query.sheetId) || process.env.LIST_ATTACK_SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID, tabs: (allowQueryConfig && req.query.tabs) || process.env.LIST_ATTACK_TABS || '', v: 'v1' });
  if (cachePayload && cacheKey === key && (Date.now() - cacheTime) < CACHE_TTL_MS && String(req.query.refresh || '') !== 'true') {
    return res.status(200).json(Object.assign({}, cachePayload, { cached: true }));
  }
  try {
    const payload = await buildPayload(req);
    cacheKey = key; cacheTime = Date.now(); cachePayload = payload;
    return res.status(200).json(Object.assign({}, payload, { cached: false }));
  } catch (e) {
    console.error('[bdr-list-attack]', e.message);
    return res.status(500).json({ success: false, error: 'Não foi possível carregar os dados da lista ou do HubSpot. Verifique as integrações e tente novamente.' });
  }
};
