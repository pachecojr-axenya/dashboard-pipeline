'use strict';

const { setCORSHeaders, requireAuth, getHubspotToken, methodCheck } = require('./_helpers');
const bq = require('../lib/bigquery');
const { _service: workloadService } = require('./bdr-workload');
const { BDR_TEAM, canonicalizeBdrName } = require('../lib/bdr-team');

const PROJECT = 'gen-lang-client-0423905839';
const GOLD = 'axenya_sales_hubspot_bdr_prd_sae1_gold';
const TABLE = `${PROJECT}.${GOLD}.bdr_daily_ops`;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const CHANNELS = ['calls', 'emails', 'whatsapp', 'linkedin', 'meetings'];
const CHANNEL_SQL = { calls: 'calls_total', emails: 'emails_sent_total', whatsapp: 'whatsapp_total', linkedin: 'linkedin_total', meetings: 'meetings_total' };
const UNSUPPORTED_METRICS = {
  companiesCreated: { status: 'unsupported', value: null, reason: 'gold.bdr_daily_ops não possui companies_created.' },
  statusTransitions: { status: 'unsupported', value: null, reason: 'gold.bdr_daily_ops não possui status_transitions.' },
  connectedTransitions: { status: 'unsupported', value: null, reason: 'gold.bdr_daily_ops não possui connected_transitions.' },
};
const LIVE_TTL_MS = 90 * 1000;
let l1 = new Map();

function bad(message) { const error = new Error(message); error.statusCode = 400; return error; }
function parseDate(value, name) { if (!ISO.test(String(value || ''))) throw bad(`${name} obrigatório (YYYY-MM-DD)`); return value; }
function parse(req) {
  const q = new URL(`http://x${req.url}`).searchParams;
  if (q.get('v') !== '2') throw bad('v=2 obrigatório');
  if (q.get('porte') || q.get('segmento') || q.get('persona')) throw bad('porte/segmento/persona não suportados no endpoint semantic atual');
  const bdr = q.get('bdr') ? canonicalizeBdrName(q.get('bdr')) : null;
  if (bdr && !BDR_TEAM.includes(bdr)) throw bad('BDR inválido');
  const channels = (q.get('channels') || CHANNELS.join(',')).split(',').filter(Boolean);
  if (channels.some((channel) => !CHANNELS.includes(channel))) throw bad('canal inválido');
  const since = parseDate(q.get('since'), 'since');
  const until = parseDate(q.get('until'), 'until');
  if (since > until) throw bad('since > until');
  return { since, until, bdr, channels, businessDays: q.get('businessDays') !== 'false', refresh: q.get('refresh') === '1' };
}
function todayIso() { return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10); }
function includesToday(r) { const t = todayIso(); return r.since <= t && r.until >= t; }
function liveRangeMs(day) { return { sinceMs: Date.parse(`${day}T00:00:00.000-03:00`), untilMs: Date.parse(`${day}T23:59:59.999-03:00`) }; }
function isBusiness(date) { const day = new Date(`${date}T00:00:00Z`).getUTCDay(); return day !== 0 && day !== 6; }
function num(value) { return Number(value || 0); }
function normalizeTimestamp(value) {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  if (/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(raw)) { const d = new Date(Math.round(Number(raw) * 1000)); return Number.isNaN(d.getTime()) ? null : d.toISOString(); }
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(raw)) { const d = new Date(raw.replace(' ', 'T') + 'Z'); return Number.isNaN(d.getTime()) ? null : d.toISOString(); }
  const d = new Date(raw); return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function isTeamOwner(name) { return BDR_TEAM.includes(canonicalizeBdrName(name)); }
function selectedTotal(row, channels) { return channels.reduce((sum, channel) => sum + num(row[channel]), 0); }
function emptyBdrRow(bdr) { return { bdr, calls: 0, emails: 0, whatsapp: 0, linkedin: 0, meetings: 0, total: 0, leadsCreated: 0, contactsCreated: null, companiesCreated: null, statusTransitions: null, connectedTransitions: null, sqlDeals: 0, previousTotal: null, deltaHistorical: null }; }
function activityBucket(activity) {
  if (activity.tipo === 'calls') return 'calls';
  if (activity.tipo === 'emails') return String(activity.direction || '').toUpperCase() === 'INCOMING_EMAIL' ? null : 'emails';
  if (activity.tipo === 'communications' && activity.canal === 'WHATS_APP') return 'whatsapp';
  if (activity.tipo === 'communications' && activity.canal === 'LINKEDIN_MESSAGE') return 'linkedin';
  if (activity.tipo === 'meetings') return 'meetings';
  return null;
}
function aggregateLivePayload(payload, day, requested) {
  const byBdr = {};
  (payload.team || BDR_TEAM).forEach((bdr) => { byBdr[bdr] = emptyBdrRow(bdr); });
  (payload.activities || []).forEach((activity) => {
    const bdr = canonicalizeBdrName(activity.bdr);
    if (!isTeamOwner(bdr) || (requested.bdr && bdr !== requested.bdr)) return;
    const bucket = activityBucket(activity);
    if (!bucket) return;
    if (!byBdr[bdr]) byBdr[bdr] = emptyBdrRow(bdr);
    byBdr[bdr][bucket] += 1;
  });
  (payload.contactsCreated || []).forEach((contact) => {
    const bdr = canonicalizeBdrName(contact.bdr);
    if (!isTeamOwner(bdr) || (requested.bdr && bdr !== requested.bdr)) return;
    if (!byBdr[bdr]) byBdr[bdr] = emptyBdrRow(bdr);
    byBdr[bdr].leadsCreated += 1;
  });
  Object.values(byBdr).forEach((row) => { row.total = selectedTotal(row, requested.channels); });
  return Object.values(byBdr).filter((row) => !requested.bdr || row.bdr === requested.bdr).map((row) => ({ date: day, source: 'live', ...row }));
}
async function liveRowsForToday(requested) {
  if (!includesToday(requested)) return { rows: [], used: false, error: null };
  const day = todayIso();
  const key = `${day}|${requested.bdr || ''}|${requested.channels.join(',')}`;
  const cached = l1.get(key);
    if (!requested.refresh && cached && Date.now() - cached.at < LIVE_TTL_MS) return { rows: cached.rows, used: true, cached: true, error: null, generatedAt: cached.generatedAt };
  try {
    const token = getHubspotToken();
    const range = liveRangeMs(day);
    const payload = await workloadService.buildPayload(token, range.sinceMs, range.untilMs);
    const rows = aggregateLivePayload(payload, day, requested);
    const generatedAt = normalizeTimestamp(payload.generatedAt || payload.source && payload.source.generatedAt || payload.refreshedAt) || new Date().toISOString();
    l1.set(key, { at: Date.now(), rows, generatedAt });
    return { rows, used: true, cached: false, error: null, generatedAt };
  } catch (error) {
    return { rows: [], used: false, error: error.message };
  }
}
function previousRange(requested) {
  const days = Math.floor((new Date(`${requested.until}T00:00:00Z`) - new Date(`${requested.since}T00:00:00Z`)) / 86400000) + 1;
  const end = new Date(`${requested.since}T00:00:00Z`); end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - days + 1);
  return { since: start.toISOString().slice(0, 10), until: end.toISOString().slice(0, 10) };
}
async function queryRows(since, until) {
  const sql = `SELECT metric_date, owner_name, SUM(calls_total) AS calls, SUM(emails_sent_total) AS emails, SUM(whatsapp_total) AS whatsapp, SUM(linkedin_total) AS linkedin, SUM(meetings_total) AS meetings, SUM(leads_created) AS leads_created, SUM(sql_deals) AS sql_deals, MAX(refreshed_at) AS refreshed_at FROM \`${TABLE}\` WHERE metric_date BETWEEN @since AND @until GROUP BY metric_date, owner_name ORDER BY metric_date, owner_name`;
  const { rows } = await bq.query(sql, [{ name: 'since', type: 'DATE', value: since }, { name: 'until', type: 'DATE', value: until }]);
  return { sql, rows };
}
function rowsToAggregates(rows, requested, live) {
  const today = todayIso();
  const byBdr = {};
  const series = [];
  let refreshedAt = null;
  rows.forEach((row) => {
    const date = String(row.metric_date || row.date).slice(0, 10);
    if (live && date === today) return;
    const bdr = canonicalizeBdrName(row.owner_name || row.bdr);
    if (!isTeamOwner(bdr) || (requested.bdr && bdr !== requested.bdr) || (requested.businessDays && !isBusiness(date))) return;
    if (!byBdr[bdr]) byBdr[bdr] = emptyBdrRow(bdr);
    const target = byBdr[bdr];
    CHANNELS.forEach((channel) => { target[channel] += num(row[channel]); });
    target.total += selectedTotal(row, requested.channels);
    target.leadsCreated += num(row.leads_created || row.leadsCreated);
    target.sqlDeals += num(row.sql_deals || row.sqlDeals);
    const ts = normalizeTimestamp(row.refreshed_at || row.refreshedAt);
    if (ts && (!refreshedAt || ts > refreshedAt)) refreshedAt = ts;
    series.push({ date, bdr, total: selectedTotal(row, requested.channels), calls: num(row.calls), emails: num(row.emails), whatsapp: num(row.whatsapp), linkedin: num(row.linkedin), meetings: num(row.meetings), leadsCreated: num(row.leads_created || row.leadsCreated), sqlDeals: num(row.sql_deals || row.sqlDeals), source: row.source || 'bq' });
  });
  if (live) live.rows.forEach((row) => {
    if (requested.businessDays && !isBusiness(row.date)) return;
    if (!byBdr[row.bdr]) byBdr[row.bdr] = emptyBdrRow(row.bdr);
    const target = byBdr[row.bdr];
    CHANNELS.forEach((channel) => { target[channel] += num(row[channel]); });
    target.total += row.total; target.leadsCreated += row.leadsCreated; target.sqlDeals += row.sqlDeals;
    series.push({ date: row.date, bdr: row.bdr, total: row.total, calls: row.calls, emails: row.emails, whatsapp: row.whatsapp, linkedin: row.linkedin, meetings: row.meetings, leadsCreated: row.leadsCreated, sqlDeals: row.sqlDeals, source: 'live' });
  });
  return { byBdr, series, refreshedAt };
}
function addBaseline(current, previous, requested) {
  Object.keys(current.byBdr).forEach((bdr) => {
    const prev = previous.byBdr[bdr] ? previous.byBdr[bdr].total : 0;
    current.byBdr[bdr].previousTotal = prev || null;
    current.byBdr[bdr].deltaHistorical = prev ? current.byBdr[bdr].total - prev : null;
  });
}
async function build(requested) {
  if (!bq.isConfigured()) throw Object.assign(new Error('BigQuery não configurado'), { statusCode: 503 });
  const currentRows = await queryRows(requested.since, requested.until);
  const prevRange = previousRange(requested);
  const previousRows = await queryRows(prevRange.since, prevRange.until);
  const live = await liveRowsForToday(requested);
  const current = rowsToAggregates(currentRows.rows, requested, live.used ? live : null);
  const previous = rowsToAggregates(previousRows.rows, requested, null);
  addBaseline(current, previous, requested);
  const totals = Object.values(current.byBdr).reduce((acc, row) => { CHANNELS.forEach((channel) => { acc[channel] += row[channel]; }); acc.total += row.total; acc.leadsCreated += row.leadsCreated; acc.sqlDeals += row.sqlDeals; return acc; }, { calls: 0, emails: 0, whatsapp: 0, linkedin: 0, meetings: 0, total: 0, leadsCreated: 0, contactsCreated: null, companiesCreated: null, statusTransitions: null, connectedTransitions: null, sqlDeals: 0 });
  const selectedSum = requested.channels.reduce((sum, channel) => sum + totals[channel], 0);
  const sourceKind = live.used ? 'hybrid' : 'bq-operational';
  const refreshedAt = live.used && live.generatedAt && (!current.refreshedAt || live.generatedAt > current.refreshedAt) ? live.generatedAt : current.refreshedAt;
  return { success: true, contractVersion: '2.0', requestedRange: { since: requested.since, until: requested.until }, resolvedRange: { since: requested.since, until: requested.until }, baselineRange: prevRange, filtersApplied: { bdr: requested.bdr, channels: requested.channels, businessDays: requested.businessDays }, filtersIgnored: [], source: { kind: sourceKind, table: TABLE, refreshedAt, liveToday: live.used, liveCached: !!live.cached, caveat: live.used ? 'Hoje vem de HubSpot live agregado no servidor e substitui a linha Gold do dia; e-mails incoming são excluídos.' : (live.error || 'Fonte BQ operacional') }, unsupportedMetrics: UNSUPPORTED_METRICS, quality: { status: live.error ? 'warn' : 'pass', checks: [{ key: 'mece_total', status: totals.total === selectedSum ? 'pass' : 'fail', message: 'ritmo real = soma dos canais selecionados' }, { key: 'reactivity_gate', status: 'warn', message: 'Reatividade bloqueada: modelo atual não possui associação auditável entry→first real touch.' }, { key: 'live_merge', status: live.used ? 'pass' : (includesToday(requested) ? 'warn' : 'pass'), message: live.used ? 'Hoje agregado do HubSpot live no servidor.' : (live.error || 'Janela sem hoje.') }] }, coverage: { reactivity: { status: 'blocked', auditableAssociations: 0, totalEligible: null, explanation: 'Silver activities não possui contact/company; não há grão contact_id×owner_assignment_spell auditável.' } }, data: { rhythm: { totals, series: current.series.sort((a, b) => a.date.localeCompare(b.date) || a.bdr.localeCompare(b.bdr)), byBdr: Object.values(current.byBdr).sort((a, b) => a.bdr.localeCompare(b.bdr)) }, reactivity: { status: 'degraded', p50: null, p75: null, withoutFirstTouch: null, coverage: 0, gate: 'Sem associação auditável entry→first real touch no modelo atual; nenhum proxy foi inventado.' }, management: Object.values(current.byBdr) } };
}

module.exports = async function handler(req, res) { setCORSHeaders(req, res); if (!methodCheck(req, res, ['GET'])) return; const user = requireAuth(req, res); if (!user) return; try { return res.status(200).json(await build(parse(req))); } catch (error) { return res.status(error.statusCode || 500).json({ success: false, error: error.message }); } };
module.exports._test = { parse, CHANNELS, CHANNEL_SQL, isBusiness, build, UNSUPPORTED_METRICS, TABLE, normalizeTimestamp, aggregateLivePayload, previousRange, activityBucket };
