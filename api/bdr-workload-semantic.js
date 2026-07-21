'use strict';

const { setCORSHeaders, requireAuth, getHubspotToken, methodCheck } = require('./_helpers');
const bq = require('../lib/bigquery');
const { _service: workloadService } = require('./bdr-workload');
const { BDR_TEAM, canonicalizeBdrName } = require('../lib/bdr-team');

const PROJECT = 'gen-lang-client-0423905839';
const GOLD = 'axenya_sales_hubspot_bdr_prd_sae1_gold';
const TABLE = `${PROJECT}.${GOLD}.bdr_workload_daily_dimension_v2`;
const REACTIVITY_TABLE = `${PROJECT}.${GOLD}.bdr_workload_reactivity_v2`;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const CHANNELS = ['calls', 'emails', 'whatsapp', 'linkedin', 'meetings'];
const CHANNEL_SQL = { calls: 'calls_total', emails: 'emails_sent_total', whatsapp: 'whatsapp_total', linkedin: 'linkedin_total', meetings: 'meetings_total' };
const PORTE_VALUES = ['enterprise', 'grande', 'media', 'pme', 'desconhecido'];
const LIVE_TTL_MS = 90 * 1000;
let l1 = new Map();
// filterOptions faz DISTINCT na tabela inteira e muda raramente: cache longo.
const FILTER_OPTIONS_TTL_MS = 10 * 60 * 1000;
let filterOptionsCache = { at: 0, val: null };
async function cachedFilterOptions() { if (filterOptionsCache.val && Date.now() - filterOptionsCache.at < FILTER_OPTIONS_TTL_MS) return filterOptionsCache.val; const val = await queryFilterOptions(); filterOptionsCache = { at: Date.now(), val }; return val; }
// Cache curto do payload completo: Pulso/Canais/Gestão batem no mesmo endpoint;
// evita refazer as queries a cada troca de aba/recarga. refresh=1 ignora o cache.
const PAYLOAD_TTL_MS = 45 * 1000;
let payloadCache = new Map();
function payloadKey(r) { return JSON.stringify({ s: r.since, u: r.until, b: r.bdr || '', c: (r.channels || []).join(','), bd: r.businessDays, p: r.porte || '', sg: r.segmento || '', pe: r.persona || '' }); }

const LIVE_RHYTHM_FIELDS = ['calls', 'callsConversation', 'callsDial', 'emails', 'whatsapp', 'linkedin', 'meetings', 'activities', 'total'];
const LIVE_CRM_FIELDS = ['attempted', 'crmMovements', 'connected', 'qualified', 'disqualified'];
const LIVE_OVERRIDE_FIELDS = LIVE_RHYTHM_FIELDS.concat(LIVE_CRM_FIELDS);
const LIVE_TRANSITION_MAP = { ATTEMPTED: 'attempted', ATTEMPTED_TO_CONTACT: 'attempted', OPEN: 'attempted', IN_PROGRESS: 'attempted', CONNECTED: 'connected', OPEN_DEAL: 'qualified', UNQUALIFIED: 'disqualified', BAD_TIMING: 'disqualified' };
function idOf(value) { return value == null || value === '' ? null : String(value); }
function transitionBucket(value) { return LIVE_TRANSITION_MAP[String(value || '').toUpperCase()] || null; }
function associationsAvailable(payload) { const d = payload && payload.diagnostics && payload.diagnostics.activityAssociations; if (d) return d.available === true; return (payload.activities || []).some((a) => idOf(a.company_id || a.companyId || a.empresa_id || a.associatedcompanyid || a.contact_id || a.contactId || a.contato_id)); }
function liveSets(row) { if (!row._sets) row._sets = { companiesTouched: new Set(), contactsTouched: new Set() }; return row._sets; }
function stripPrivate(row) { delete row._sets; return row; }
function addTouched(row, activity) { const sets = liveSets(row); const companyId = idOf(activity.company_id || activity.companyId || activity.empresa_id || activity.associatedcompanyid); const contactId = idOf(activity.contact_id || activity.contactId || activity.contato_id); if (companyId) sets.companiesTouched.add(companyId); if (contactId) sets.contactsTouched.add(contactId); }
function hasLiveCoverage(live) { return !!(live && live.used && Array.isArray(live.rows) && live.rows.length); }
function liveRowMap(live) { const map = {}; if (!hasLiveCoverage(live)) return map; live.rows.forEach((row) => { map[`${String(row.date || row.metric_date).slice(0, 10)}|${canonicalizeBdrName(row.bdr || row.owner_name)}`] = row; }); return map; }
function mergeLiveRow(target, liveRow) { LIVE_OVERRIDE_FIELDS.forEach((field) => { if (Object.prototype.hasOwnProperty.call(liveRow, field)) target[field] = num(liveRow[field]); }); if (Object.prototype.hasOwnProperty.call(liveRow, 'companiesTouched')) target.companiesTouched = num(liveRow.companiesTouched); if (Object.prototype.hasOwnProperty.call(liveRow, 'contactsTouched')) target.contactsTouched = num(liveRow.contactsTouched); return target; }
function mergeCumulativeLiveRow(base, liveRow, requested) {
  const merged = Object.assign({}, base);
  const liveRhythmTotal = selectedTotal(liveRow, requested.channels);
  if (liveRhythmTotal >= base.total) LIVE_RHYTHM_FIELDS.forEach((field) => { if (Object.prototype.hasOwnProperty.call(liveRow, field)) merged[field] = num(liveRow[field]); });
  if (num(liveRow.crmMovements) >= base.crmMovements) LIVE_CRM_FIELDS.forEach((field) => { if (Object.prototype.hasOwnProperty.call(liveRow, field)) merged[field] = num(liveRow[field]); });
  if (Object.prototype.hasOwnProperty.call(liveRow, 'companiesTouched')) merged.companiesTouched = Math.max(base.companiesTouched, num(liveRow.companiesTouched));
  if (Object.prototype.hasOwnProperty.call(liveRow, 'contactsTouched')) merged.contactsTouched = Math.max(base.contactsTouched, num(liveRow.contactsTouched));
  merged.source = 'bq_or_live_cumulative';
  return merged;
}
function liveLineage(live) { const liveUsed = hasLiveCoverage(live); const bq = 'bq_daily_dimension_v2'; const hybrid = liveUsed ? 'bq_or_live_cumulative' : bq; const touchedSrc = liveUsed && live.rows.some((r) => Object.prototype.hasOwnProperty.call(r, 'companiesTouched') || Object.prototype.hasOwnProperty.call(r, 'contactsTouched')) ? 'bq_or_live_cumulative' : bq; return { calls: hybrid, callsConversation: hybrid, callsDial: hybrid, emails: hybrid, whatsapp: hybrid, linkedin: hybrid, meetings: hybrid, activities: hybrid, total: hybrid, companiesTouched: touchedSrc, contactsTouched: touchedSrc, companiesInserted: bq, contactsInserted: bq, attempted: hybrid, crmMovements: hybrid, connected: hybrid, qualified: hybrid, disqualified: hybrid, sqlDeals: bq, reactivity: 'bq_reactivity_v2' }; }

function bad(message) { const error = new Error(message); error.statusCode = 400; return error; }
function parseDate(value, name) { if (!ISO.test(String(value || ''))) throw bad(`${name} obrigatório (YYYY-MM-DD)`); return value; }
function parseList(value) { return String(value || '').split(',').map((v) => v.trim()).filter(Boolean); }
function parse(req) {
  const q = new URL(`http://x${req.url}`).searchParams;
  if (q.get('v') !== '2') throw bad('v=2 obrigatório');
  const bdr = q.get('bdr') ? canonicalizeBdrName(q.get('bdr')) : null;
  if (bdr && !BDR_TEAM.includes(bdr)) throw bad('BDR inválido');
  const channels = parseList(q.get('channels') || CHANNELS.join(','));
  if (channels.some((channel) => !CHANNELS.includes(channel))) throw bad('canal inválido');
  const porte = q.get('porte') || null;
  if (porte && !PORTE_VALUES.includes(porte)) throw bad('porte inválido');
  const since = parseDate(q.get('since'), 'since');
  const until = parseDate(q.get('until'), 'until');
  if (since > until) throw bad('since > until');
  return { since, until, bdr, channels, businessDays: q.get('businessDays') !== 'false', porte, segmento: q.get('segmento') || null, persona: q.get('persona') || null, refresh: q.get('refresh') === '1' };
}
function todayIso() { return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10); }
function includesToday(r) { const t = todayIso(); return r.since <= t && r.until >= t; }
function liveRangeMs(day) { return { sinceMs: Date.parse(`${day}T00:00:00.000-03:00`), untilMs: Date.parse(`${day}T23:59:59.999-03:00`) }; }
function isBusiness(date) { const day = new Date(`${date}T00:00:00Z`).getUTCDay(); return day !== 0 && day !== 6; }
function num(value) { return Number(value || 0); }
function normalizeTimestamp(value) { if (value == null || value === '') return null; const raw = String(value).trim(); if (/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(raw)) { const d = new Date(Math.round(Number(raw) * 1000)); return Number.isNaN(d.getTime()) ? null : d.toISOString(); } if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(raw)) { const d = new Date(raw.replace(' ', 'T') + 'Z'); return Number.isNaN(d.getTime()) ? null : d.toISOString(); } const d = new Date(raw); return Number.isNaN(d.getTime()) ? null : d.toISOString(); }
function isTeamOwner(name) { return BDR_TEAM.includes(canonicalizeBdrName(name)); }
function selectedTotal(row, channels) { return channels.reduce((sum, channel) => sum + num(row[channel]), 0); }
function emptyBdrRow(bdr) { return { bdr, calls: 0, callsConversation: 0, callsDial: 0, emails: 0, whatsapp: 0, linkedin: 0, meetings: 0, activities: 0, total: 0, companiesTouched: 0, contactsTouched: 0, companiesInserted: 0, contactsInserted: 0, attempted: 0, crmMovements: 0, connected: 0, qualified: 0, disqualified: 0, sqlDeals: 0, previousTotal: null, deltaHistorical: null }; }
function activityBucket(activity) { if (activity.tipo === 'calls') return 'calls'; if (activity.tipo === 'emails') return String(activity.direction || '').toUpperCase() === 'INCOMING_EMAIL' ? null : 'emails'; if (activity.tipo === 'communications' && activity.canal === 'WHATS_APP') return 'whatsapp'; if (activity.tipo === 'communications' && activity.canal === 'LINKEDIN_MESSAGE') return 'linkedin'; if (activity.tipo === 'meetings') return 'meetings'; return null; }
function aggregateLivePayload(payload, day, requested) { const byBdr = {}; const includeTouched = associationsAvailable(payload); (payload.team || BDR_TEAM).forEach((bdr) => { byBdr[bdr] = emptyBdrRow(bdr); }); function rowFor(rawBdr) { const bdr = canonicalizeBdrName(rawBdr); if (!isTeamOwner(bdr) || (requested.bdr && bdr !== requested.bdr)) return null; if (!byBdr[bdr]) byBdr[bdr] = emptyBdrRow(bdr); return byBdr[bdr]; } (payload.activities || []).forEach((activity) => { const row = rowFor(activity.bdr); if (!row) return; const bucket = activityBucket(activity); if (!bucket) return; row[bucket] += 1; if (bucket === 'calls') { const duration = Number(activity.duracao_ms == null ? activity.duration_ms : activity.duracao_ms); if (Number.isFinite(duration) && duration >= 60000) row.callsConversation += 1; else row.callsDial += 1; } if (includeTouched) addTouched(row, activity); }); (payload.companiesCreated || []).forEach((company) => { const row = rowFor(company.bdr); if (row) row.companiesInserted += 1; }); (payload.contactsCreated || []).forEach((contact) => { const row = rowFor(contact.bdr); if (!row) return; row.contactsInserted += 1;  }); (payload.transitions || []).forEach((transition) => { const row = rowFor(transition.bdr); if (!row) return; const bucket = transitionBucket(transition.para || transition.to || transition.status); if (bucket) { row.crmMovements += 1; row[bucket] += 1; } }); Object.values(byBdr).forEach((row) => { if (includeTouched) { const sets = liveSets(row); row.companiesTouched = sets.companiesTouched.size; row.contactsTouched = sets.contactsTouched.size; } else { delete row.companiesTouched; delete row.contactsTouched; } row.activities = row.calls + row.emails + row.whatsapp + row.linkedin + row.meetings; row.total = selectedTotal(row, requested.channels); }); return Object.values(byBdr).filter((row) => !requested.bdr || row.bdr === requested.bdr).map((row) => ({ date: day, source: 'live', ...stripPrivate(row) })); }
async function liveRowsForToday(requested) { if (!includesToday(requested) || requested.porte || requested.segmento || requested.persona) return { rows: [], used: false, error: null, disabledByFilters: !!(requested.porte || requested.segmento || requested.persona) }; const day = todayIso(); const key = `${day}|${requested.bdr || ''}|${requested.channels.join(',')}`; const cached = l1.get(key); if (!requested.refresh && cached && Date.now() - cached.at < LIVE_TTL_MS) return { rows: cached.rows, used: true, cached: true, error: null, generatedAt: cached.generatedAt }; try { const token = getHubspotToken(); const range = liveRangeMs(day); const payload = await workloadService.buildPayload(token, range.sinceMs, range.untilMs); const rows = aggregateLivePayload(payload, day, requested); const generatedAt = normalizeTimestamp(payload.generatedAt || payload.source && payload.source.generatedAt || payload.refreshedAt) || new Date().toISOString(); l1.set(key, { at: Date.now(), rows, generatedAt }); return { rows, used: true, cached: false, error: null, generatedAt }; } catch (error) { return { rows: [], used: false, error: error.message }; } }
function previousRange(requested) { const days = Math.floor((new Date(`${requested.until}T00:00:00Z`) - new Date(`${requested.since}T00:00:00Z`)) / 86400000) + 1; const end = new Date(`${requested.since}T00:00:00Z`); end.setUTCDate(end.getUTCDate() - 1); const start = new Date(end); start.setUTCDate(start.getUTCDate() - days + 1); return { since: start.toISOString().slice(0, 10), until: end.toISOString().slice(0, 10) }; }
function filterSql(alias, requested, params) { const wh = [`${alias}.metric_date BETWEEN @since AND @until`]; if (requested.bdr) wh.push(`${alias}.owner_name = @bdr`); if (requested.porte) wh.push(`COALESCE(NULLIF(${alias}.porte,''),'desconhecido') = @porte`); if (requested.segmento) wh.push(`COALESCE(NULLIF(${alias}.segmento,''),'desconhecido') = @segmento`); if (requested.persona) wh.push(`COALESCE(NULLIF(${alias}.persona,''),'não classificada') = @persona`); if (requested.businessDays) wh.push(`EXTRACT(DAYOFWEEK FROM ${alias}.metric_date) NOT IN (1,7)`); if (params) { if (requested.bdr) params.push({ name: 'bdr', type: 'STRING', value: requested.bdr }); if (requested.porte) params.push({ name: 'porte', type: 'STRING', value: requested.porte }); if (requested.segmento) params.push({ name: 'segmento', type: 'STRING', value: requested.segmento }); if (requested.persona) params.push({ name: 'persona', type: 'STRING', value: requested.persona }); } return wh.join(' AND '); }
async function queryRows(since, until, requested) { const r = Object.assign({}, requested, { since, until }); const params = [{ name: 'since', type: 'DATE', value: since }, { name: 'until', type: 'DATE', value: until }]; const sql = `SELECT metric_date, owner_id, owner_name, SUM(calls_total) calls, SUM(calls_conversation_total) calls_conversation, SUM(calls_dial_total) calls_dial, SUM(emails_sent_total) emails, SUM(whatsapp_total) whatsapp, SUM(linkedin_total) linkedin, SUM(meetings_total) meetings, SUM(activities_total) activities_total, SUM(companies_touched) companies_touched, SUM(contacts_touched) contacts_touched, SUM(companies_inserted) companies_inserted, SUM(contacts_inserted) contacts_inserted, SUM(attempted_total) attempted, SUM(crm_movements) crm_movements, SUM(connected_total) connected, SUM(qualified_total) qualified, SUM(disqualified_total) disqualified, SUM(sql_deals) sql_deals, MAX(refreshed_at) refreshed_at FROM \`${TABLE}\` d WHERE ${filterSql('d', r, params)} GROUP BY metric_date, owner_id, owner_name ORDER BY metric_date, owner_name`; const { rows } = await bq.query(sql, params); return { sql, rows }; }
function bqItem(row, source, requested) {
  return {
    date: String(row.metric_date || row.date).slice(0, 10),
    bdr: canonicalizeBdrName(row.owner_name || row.bdr),
    source,
    calls: num(row.calls),
    callsConversation: num(row.calls_conversation),
    callsDial: num(row.calls_dial),
    emails: num(row.emails),
    whatsapp: num(row.whatsapp),
    linkedin: num(row.linkedin),
    meetings: num(row.meetings),
    activities: num(row.activities_total),
    total: selectedTotal({ calls: row.calls, emails: row.emails, whatsapp: row.whatsapp, linkedin: row.linkedin, meetings: row.meetings }, requested.channels),
    companiesTouched: num(row.companies_touched),
    contactsTouched: num(row.contacts_touched),
    companiesInserted: num(row.companies_inserted),
    contactsInserted: num(row.contacts_inserted),
    attempted: num(row.attempted),
    crmMovements: num(row.crm_movements),
    connected: num(row.connected),
    qualified: num(row.qualified),
    disqualified: num(row.disqualified),
    sqlDeals: num(row.sql_deals),
  };
}
function liveItem(row, source) {
  const item = { date: String(row.date || row.metric_date).slice(0, 10), bdr: canonicalizeBdrName(row.bdr || row.owner_name), source, sqlDeals: num(row.sqlDeals || row.sql_deals) };
  if (Object.prototype.hasOwnProperty.call(row, 'companiesTouched')) item.companiesTouched = num(row.companiesTouched);
  if (Object.prototype.hasOwnProperty.call(row, 'contactsTouched')) item.contactsTouched = num(row.contactsTouched);
  return mergeLiveRow(item, row);
}
function rowsToAggregates(rows, requested, live) {
  const today = todayIso();
  const byBdr = {};
  const series = [];
  let refreshedAt = null;
  const liveByKey = liveRowMap(live);
  const seenKeys = new Set();
  function addItem(item) {
    if (!isTeamOwner(item.bdr) || (requested.bdr && item.bdr !== requested.bdr)) return;
    if (!byBdr[item.bdr]) byBdr[item.bdr] = emptyBdrRow(item.bdr);
    const target = byBdr[item.bdr];
    Object.keys(target).forEach((key) => { if (typeof target[key] === 'number' && typeof item[key] === 'number') target[key] += item[key]; });
    series.push(item);
  }
  rows.forEach((row) => {
    const base = bqItem(row, 'bq', requested);
    const key = `${base.date}|${base.bdr}`;
    seenKeys.add(key);
    const liveRow = base.date === today ? liveByKey[key] : null;
    if (liveRow) {
      addItem(mergeCumulativeLiveRow(base, liveRow, requested));
    } else {
      addItem(base);
    }
    const ts = normalizeTimestamp(row.refreshed_at);
    if (ts && (!refreshedAt || ts > refreshedAt)) refreshedAt = ts;
  });
  if (hasLiveCoverage(live)) {
    live.rows.forEach((row) => {
      const item = liveItem(row, 'live');
      const key = `${item.date}|${item.bdr}`;
      if (!seenKeys.has(key)) addItem(item);
    });
  }
  return { byBdr, series, refreshedAt };
}
function addBaseline(current, previous) { Object.keys(current.byBdr).forEach((bdr) => { const prev = previous.byBdr[bdr] ? previous.byBdr[bdr].total : 0; current.byBdr[bdr].previousTotal = prev || null; current.byBdr[bdr].deltaHistorical = prev ? current.byBdr[bdr].total - prev : null; }); }
function percentile(values, p) { const xs = values.map(Number).filter((x) => Number.isFinite(x)).sort((a, b) => a - b); if (!xs.length) return null; const idx = (xs.length - 1) * p; const lo = Math.floor(idx); const hi = Math.ceil(idx); if (lo === hi) return xs[lo]; return xs[lo] + (xs[hi] - xs[lo]) * (idx - lo); }
function bucketHours(h) { if (h == null || !Number.isFinite(Number(h))) return 'sem_toque'; const x = Number(h); if (x < 1) return 'lt_1h'; if (x < 4) return '1_4h'; if (x < 24) return '4_24h'; if (x < 72) return '24_72h'; return '72h_plus'; }
function reactivityFromRows(rows) { const touched = rows.filter((r) => String(r.has_touch) === 'true' || r.has_touch === true || Number(r.has_touch) === 1); const hours = touched.map((r) => Number(r.hours_to_first_touch)).filter((x) => Number.isFinite(x)); const buckets = { lt_1h: 0, '1_4h': 0, '4_24h': 0, '24_72h': 0, '72h_plus': 0, sem_toque: 0 }; rows.forEach((r) => { buckets[bucketHours((String(r.has_touch) === 'true' || r.has_touch === true || Number(r.has_touch) === 1) ? Number(r.hours_to_first_touch) : null)] += 1; }); return { p50Hours: percentile(hours, 0.5), p75Hours: percentile(hours, 0.75), withoutFirstTouch: buckets.sem_toque, eligible: rows.length, touched: touched.length, coverage: rows.length ? touched.length / rows.length : 0, buckets }; }
async function queryReactivity(requested) { const params = [{ name: 'since', type: 'DATE', value: requested.since }, { name: 'until', type: 'DATE', value: requested.until }]; const wh = ['eligible_date BETWEEN @since AND @until']; if (requested.bdr) { wh.push('owner_name = @bdr'); params.push({ name: 'bdr', type: 'STRING', value: requested.bdr }); } if (requested.porte) { wh.push("COALESCE(NULLIF(porte,''),'desconhecido') = @porte"); params.push({ name: 'porte', type: 'STRING', value: requested.porte }); } if (requested.segmento) { wh.push("COALESCE(NULLIF(segmento,''),'desconhecido') = @segmento"); params.push({ name: 'segmento', type: 'STRING', value: requested.segmento }); } if (requested.persona) { wh.push("COALESCE(NULLIF(persona,''),'não classificada') = @persona"); params.push({ name: 'persona', type: 'STRING', value: requested.persona }); } const sql = `SELECT owner_name, eligible_date, hours_to_first_touch, has_touch, porte, segmento, persona FROM \`${REACTIVITY_TABLE}\` WHERE ${wh.join(' AND ')}`; const { rows } = await bq.query(sql, params); return reactivityFromRows(rows.filter((r) => isTeamOwner(r.owner_name))); }
async function queryFilterOptions() { const sql = `SELECT ARRAY_AGG(DISTINCT COALESCE(NULLIF(porte,''),'desconhecido') IGNORE NULLS ORDER BY COALESCE(NULLIF(porte,''),'desconhecido')) portes, ARRAY_AGG(DISTINCT COALESCE(NULLIF(segmento,''),'desconhecido') IGNORE NULLS ORDER BY COALESCE(NULLIF(segmento,''),'desconhecido')) segmentos, ARRAY_AGG(DISTINCT COALESCE(NULLIF(persona,''),'não classificada') IGNORE NULLS ORDER BY COALESCE(NULLIF(persona,''),'não classificada')) personas FROM \`${TABLE}\``; const { rows } = await bq.query(sql, []); const row = rows[0] || {}; return { bdr: BDR_TEAM, porte: row.portes || PORTE_VALUES, segmento: row.segmentos || [], persona: row.personas || [] }; }
async function build(requested) { if (!bq.isConfigured()) throw Object.assign(new Error('BigQuery não configurado'), { statusCode: 503 }); const prevRange = previousRange(requested); const [currentRows, previousRows, reactivity, filterOptions, live] = await Promise.all([queryRows(requested.since, requested.until, requested), queryRows(prevRange.since, prevRange.until, requested), queryReactivity(requested), cachedFilterOptions(), liveRowsForToday(requested)]); const current = rowsToAggregates(currentRows.rows, requested, live.used ? live : null); const previous = rowsToAggregates(previousRows.rows, requested, null); addBaseline(current, previous); const totals = Object.values(current.byBdr).reduce((acc, row) => { Object.keys(acc).forEach((k) => { if (typeof acc[k] === 'number') acc[k] += num(row[k]); }); return acc; }, { calls: 0, callsConversation: 0, callsDial: 0, emails: 0, whatsapp: 0, linkedin: 0, meetings: 0, activities: 0, total: 0, companiesTouched: 0, contactsTouched: 0, companiesInserted: 0, contactsInserted: 0, attempted: 0, crmMovements: 0, connected: 0, qualified: 0, disqualified: 0, sqlDeals: 0 }); const selectedSum = requested.channels.reduce((sum, channel) => sum + totals[channel], 0); const refreshedAt = live.used && live.generatedAt && (!current.refreshedAt || live.generatedAt > current.refreshedAt) ? live.generatedAt : current.refreshedAt; return { success: true, contractVersion: '2.1', requestedRange: { since: requested.since, until: requested.until }, resolvedRange: { since: requested.since, until: requested.until }, baselineRange: prevRange, filtersApplied: { bdr: requested.bdr, channels: requested.channels, businessDays: requested.businessDays, porte: requested.porte, segmento: requested.segmento, persona: requested.persona }, filtersIgnored: [], filterOptions, supportedFilters: { pulse: ['bdr', 'channels', 'businessDays', 'porte', 'segmento', 'persona'], channels: ['bdr', 'channels', 'businessDays', 'porte', 'segmento', 'persona'], management: ['bdr', 'channels', 'businessDays', 'porte', 'segmento', 'persona'], penetration: ['bdr', 'porte', 'segmento', 'persona'], evolution: ['bdr', 'channels', 'businessDays', 'porte', 'segmento', 'persona'] }, source: { kind: live.used ? 'hybrid' : 'bq-operational', table: TABLE, refreshedAt, liveToday: live.used, liveCached: !!live.cached, liveOverlay: live.used ? 'HubSpot live usado apenas sem filtros porte/segmento/persona.' : (live.disabledByFilters ? 'HubSpot live desativado porque há filtro porte/segmento/persona; somente Gold v2.' : 'Fonte BQ operacional') }, quality: { status: live.error ? 'warn' : 'pass', checks: [{ key: 'mece_total', status: totals.total === selectedSum ? 'pass' : 'fail', message: 'ritmo real = soma dos canais selecionados' }, { key: 'reactivity', status: 'pass', message: 'Reatividade vem de bdr_workload_reactivity_v2.' }, { key: 'live_merge', status: live.used ? 'pass' : (includesToday(requested) ? 'warn' : 'pass'), message: live.used ? 'Hoje agregado do HubSpot live no servidor.' : (live.disabledByFilters ? 'Live omitido por filtro ICP.' : (live.error || 'Janela sem hoje.')) }] }, coverage: { reactivity: { status: 'available', eligible: reactivity.eligible, touched: reactivity.touched, coverage: reactivity.coverage } }, data: { rhythm: { totals, series: current.series.sort((a, b) => a.date.localeCompare(b.date) || a.bdr.localeCompare(b.bdr)), byBdr: Object.values(current.byBdr).sort((a, b) => a.bdr.localeCompare(b.bdr)) }, reactivity, management: Object.values(current.byBdr).sort((a, b) => a.bdr.localeCompare(b.bdr)) } };
}

module.exports = async function handler(req, res) { setCORSHeaders(req, res); if (!methodCheck(req, res, ['GET'])) return; const user = requireAuth(req, res); if (!user) return; try { const requested = parse(req); if (requested.refresh) return res.status(200).json(await build(requested)); const key = payloadKey(requested); const hit = payloadCache.get(key); if (hit && Date.now() - hit.at < PAYLOAD_TTL_MS) return res.status(200).json(hit.val); const val = await build(requested); if (payloadCache.size > 200) payloadCache.clear(); payloadCache.set(key, { at: Date.now(), val }); return res.status(200).json(val); } catch (error) { return res.status(error.statusCode || 500).json({ success: false, error: error.message }); } };
module.exports._service = { liveRowsForToday };
module.exports._test = { parse, CHANNELS, CHANNEL_SQL, isBusiness, build, TABLE, REACTIVITY_TABLE, normalizeTimestamp, aggregateLivePayload, liveRowsForToday, previousRange, activityBucket, percentile, bucketHours, reactivityFromRows, rowsToAggregates, liveLineage, todayIso };
