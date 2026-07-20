'use strict';

const { setCORSHeaders, requireAuth, methodCheck } = require('./_helpers');
const bq = require('../lib/bigquery');
const { canonicalizeBdrName, BDR_TEAM } = require('../lib/bdr-team');

const TEAM_SET = new Set(BDR_TEAM);
// Guarda de camada semântica: só nomes canônicos do time entram no payload.
// O silver.activities pode conter owners fora do time (ex.: owner_id vizinho
// a um BDR) que a canonicalização não resolve; sem este filtro esses registros
// contaminariam os totais "Todos os BDRs" no front. É filtro semântico no
// contrato da API, não compensação de bug no browser.
function isTeamMember(canonName) { return TEAM_SET.has(canonName); }

const PROJECT = 'gen-lang-client-0423905839';
const GOLD = 'axenya_sales_hubspot_bdr_prd_sae1_gold';
const SILVER = 'axenya_sales_hubspot_bdr_prd_sae1_silver';

function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const d = new Date(value + 'T00:00:00.000Z');
  return Number.isNaN(d.getTime()) ? null : d;
}
function iso(d) { return d.toISOString().slice(0, 10); }
function addDays(date, days) { const d = new Date(date); d.setUTCDate(d.getUTCDate() + days); return d; }
function inclusiveDays(since, until) { return Math.floor((until - since) / 86400000) + 1; }
function num(v) { return v == null || v === '' ? 0 : Number(v); }
function str(v) { return v == null ? null : String(v); }
function ymd(v) { return String(v || '').slice(0, 10); }
// Normaliza um TIMESTAMP do BigQuery para ISO 8601 UTC (com "Z").
// O BigQuery REST (endpoint /queries) devolve TIMESTAMP como STRING de
// epoch em SEGUNDOS com fração (ex.: "1784567311.617586"), NÃO como
// "YYYY-MM-DD HH:MM:SS". Sem normalizar, o browser faz new Date(epochStr)
// => Invalid Date => a UI mostra "NaN/NaN NaN:NaN". Tratamos as três formas
// possíveis: epoch-segundos, "YYYY-MM-DD HH:MM:SS" e ISO já pronta.
function timestamp(v) {
  if (v == null || v === '') return null;
  const value = String(v).trim();
  // 1) epoch em segundos (inteiro ou decimal) — formato do BigQuery REST
  if (/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value)) {
    const ms = Math.round(Number(value) * 1000);
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  // 2) "YYYY-MM-DD HH:MM:SS[.ffffff]" (sem timezone) — assume UTC
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value)) {
    const d = new Date(value.replace(' ', 'T') + 'Z');
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  // 3) já é ISO 8601 (com T e/ou timezone) — valida e devolve normalizada
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normalizeFamily(value) {
  const v = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
  if (v.includes('call') || v.includes('lig')) return 'calls';
  if (v.includes('email') || v.includes('mail')) return 'emails';
  if (v.includes('whats')) return 'whatsapp';
  if (v.includes('linkedin') || v.includes('linked')) return 'linkedin';
  if (v.includes('meeting') || v.includes('reuni')) return 'meetings';
  if (v.includes('total') || v.includes('all') || v.includes('atividade')) return 'total';
  return v;
}

function buildTargetsMap(targetRows = []) {
  const byName = new Map();
  targetRows.forEach((r) => {
    const name = canonicalizeBdrName(r.owner_name);
    if (!isTeamMember(name)) return;
    const family = normalizeFamily(r.activity_family);
    const value = num(r.target_daily);
    if (!byName.has(name)) byName.set(name, { total: 0, calls: 0, emails: 0, whatsapp: 0, linkedin: 0, meetings: 0 });
    const target = byName.get(name);
    if (Object.prototype.hasOwnProperty.call(target, family)) target[family] = Math.max(target[family], value);
  });
  byName.forEach((target) => {
    const strictTotal = target.calls + target.emails + target.whatsapp + target.linkedin + target.meetings;
    target.total = Math.max(target.total, strictTotal);
  });
  return Object.fromEntries([...byName.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

function buildHistoryPayload(rows, dealRows, since, until, historySince, sqlSummaryRows = [], targetRows = []) {
  const targetsMap = buildTargetsMap(targetRows);
  const dailyRows = rows.map((r) => {
    const owner = canonicalizeBdrName(r.owner_name);
    const calls = num(r.calls_total);
    const emails = num(r.emails_sent_total);
    const whatsapp = num(r.whatsapp_total);
    const linkedin = num(r.linkedin_total);
    const meetings = num(r.meetings_total);
    const strictTotal = calls + emails + whatsapp + linkedin + meetings;
    return {
      metric_date: ymd(r.metric_date),
      owner_name: owner,
      activities_total: strictTotal,
      calls_total: calls,
      emails_sent_total: emails,
      whatsapp_total: whatsapp,
      linkedin_total: linkedin,
      meetings_total: meetings,
      bdr_daily_target: targetsMap[owner] ? targetsMap[owner].total : 0,
      sql_deals: 0,
      refreshed_at: timestamp(r.refreshed_at),
    };
  }).filter((row) => isTeamMember(row.owner_name));
  const sqlDeals = dealRows.map((r) => ({
    deal_id: str(r.deal_id),
    bdr: canonicalizeBdrName(r.bdr),
    sql_date: ymd(r.sql_date),
    deal_stage_id: str(r.deal_stage_id),
  })).filter((row) => isTeamMember(row.bdr));
  const dailyByKey = new Map(dailyRows.map((row) => [`${row.metric_date}|${row.owner_name}`, row]));
  sqlSummaryRows.forEach((summary) => {
    const sqlDate = ymd(summary.metric_date);
    const bdr = canonicalizeBdrName(summary.owner_name);
    if (!isTeamMember(bdr)) return;
    const key = `${sqlDate}|${bdr}`;
    let row = dailyByKey.get(key);
    if (!row) {
      row = {
        metric_date: sqlDate,
        owner_name: bdr,
        activities_total: 0,
        calls_total: 0,
        emails_sent_total: 0,
        whatsapp_total: 0,
        linkedin_total: 0,
        meetings_total: 0,
        bdr_daily_target: targetsMap[bdr] ? targetsMap[bdr].total : 0,
        sql_deals: 0,
        refreshed_at: timestamp(summary.refreshed_at),
      };
      dailyRows.push(row);
      dailyByKey.set(key, row);
    }
    row.sql_deals += num(summary.sql_deals);
    if (!row.bdr_daily_target && targetsMap[bdr]) row.bdr_daily_target = targetsMap[bdr].total;
    if (!row.refreshed_at) row.refreshed_at = timestamp(summary.refreshed_at);
  });
  dailyRows.sort((a, b) => a.metric_date.localeCompare(b.metric_date) || String(a.owner_name).localeCompare(String(b.owner_name)));
  const maxDate = dailyRows.reduce((m, r) => (!m || r.metric_date > m ? r.metric_date : m), null);
  const maxRefreshedAt = dailyRows.reduce((m, r) => (!m || (r.refreshed_at && r.refreshed_at > m) ? r.refreshed_at : m), null);
  const dailySqlSum = dailyRows
    .filter((r) => r.metric_date >= since && r.metric_date <= until)
    .reduce((sum, r) => sum + r.sql_deals, 0);
  return {
    success: true,
    source: 'bigquery',
    range: { since, until, historySince },
    dailyRows,
    sqlDeals,
    metadata: {
      source: 'bigquery',
      project: PROJECT,
      goldDataset: GOLD,
      silverDataset: SILVER,
      maxMetricDate: maxDate,
      refreshedAt: maxRefreshedAt,
      generatedAt: new Date().toISOString(),
      bdrDailyTargets: targetsMap,
      targetNotes: 'Metas vigentes em gold.bdr_daily_target para a data until; provisórias/configuráveis.',
      reconciliation: {
        sqlDealsCount: sqlDeals.length,
        dailySqlSum,
        matches: sqlDeals.length === dailySqlSum,
      },
    },
  };
}

const QUERY_SOURCES = Object.freeze({
  dailyOps: `${PROJECT}.${GOLD}.bdr_daily_ops`,
  dailyTarget: `${PROJECT}.${GOLD}.bdr_daily_target`,
  sqlDeals: `${PROJECT}.${SILVER}.sql_deals`,
});

async function fetchHistory(since, until) {
  if (!bq.isConfigured()) {
    const e = new Error('BigQuery não configurado (GOOGLE_SERVICE_ACCOUNT_JSON ausente)');
    e.statusCode = 503;
    throw e;
  }
  const s = parseDate(since), u = parseDate(until);
  if (!s || !u || s > u) {
    const e = new Error('since/until inválidos (YYYY-MM-DD)');
    e.statusCode = 400;
    throw e;
  }
  const historySince = iso(addDays(s, -inclusiveDays(s, u)));
  const dailySql = `
    SELECT
      metric_date,
      owner_name,
      SUM(calls_total) AS calls_total,
      SUM(emails_sent_total) AS emails_sent_total,
      SUM(whatsapp_total) AS whatsapp_total,
      SUM(linkedin_total) AS linkedin_total,
      SUM(meetings_total) AS meetings_total,
      MAX(refreshed_at) AS refreshed_at
    FROM \`${QUERY_SOURCES.dailyOps}\`
    WHERE metric_date BETWEEN @historySince AND @until
    GROUP BY metric_date, owner_name
    ORDER BY metric_date ASC, owner_name ASC`;
  const dealsSql = `
    SELECT deal_id, owner_name AS bdr, sql_date, deal_stage_id
    FROM (
      SELECT deal_id, owner_name, sql_date, deal_stage_id, ingested_at,
        ROW_NUMBER() OVER (PARTITION BY deal_id ORDER BY ingested_at DESC) AS rn
      FROM \`${QUERY_SOURCES.sqlDeals}\`
      WHERE sql_date BETWEEN @since AND @until
    )
    WHERE rn = 1
    ORDER BY sql_date ASC, bdr ASC, deal_id ASC`;
  const sqlSummarySql = `
    SELECT metric_date, owner_name, SUM(sql_deals) AS sql_deals, MAX(refreshed_at) AS refreshed_at
    FROM \`${QUERY_SOURCES.dailyOps}\`
    WHERE metric_date BETWEEN @historySince AND @until
    GROUP BY metric_date, owner_name
    ORDER BY metric_date ASC, owner_name ASC`;
  const targetsSql = `
    SELECT owner_name, activity_family, MAX(target_daily) AS target_daily
    FROM \`${QUERY_SOURCES.dailyTarget}\`
    WHERE valid_from <= @until
      AND (valid_to IS NULL OR valid_to >= @until)
    GROUP BY owner_name, activity_family
    ORDER BY owner_name ASC, activity_family ASC`;
  const params = [
    { name: 'historySince', type: 'DATE', value: historySince },
    { name: 'since', type: 'DATE', value: since },
    { name: 'until', type: 'DATE', value: until },
  ];
  const [daily, deals, sqlSummary, targets] = await Promise.all([
    bq.query(dailySql, params),
    bq.query(dealsSql, params),
    bq.query(sqlSummarySql, params),
    bq.query(targetsSql, params),
  ]);
  return buildHistoryPayload(daily.rows, deals.rows, since, until, historySince, sqlSummary.rows, targets.rows);
}

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['GET'])) return;
  const user = requireAuth(req, res);
  if (!user) return;
  const q = new URL(`http://x${req.url}`).searchParams;
  try {
    const payload = await fetchHistory(q.get('since'), q.get('until'));
    return res.status(200).json(payload);
  } catch (e) {
    return res.status(e.statusCode || 500).json({ success: false, error: e.message, source: 'bigquery' });
  }
};

module.exports._test = { buildHistoryPayload, buildTargetsMap, normalizeFamily, parseDate, inclusiveDays, iso, addDays, timestamp, querySources: QUERY_SOURCES };
