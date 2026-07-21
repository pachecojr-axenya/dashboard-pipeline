'use strict';

const { setCORSHeaders, requireAuth, methodCheck } = require('./_helpers');
const bq = require('../lib/bigquery');
const { BDR_TEAM, canonicalizeBdrName } = require('../lib/bdr-team');

const PROJECT = 'gen-lang-client-0423905839';
const GOLD = 'axenya_sales_hubspot_bdr_prd_sae1_gold';
const TABLE = `${PROJECT}.${GOLD}.bdr_daily_ops`;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const SUPPORTED_DOMAINS = ['ritmo', 'insercao', 'sql'];
const UNSUPPORTED_DOMAINS = ['crm', 'contato_efetivo'];
const BREAKDOWNS = ['canal', 'bdr', 'none'];
const CHANNELS = [
  ['calls', 'Ligações', 'calls_total'],
  ['emails', 'E-mails', 'emails_sent_total'],
  ['whatsapp', 'WhatsApp', 'whatsapp_total'],
  ['linkedin', 'LinkedIn', 'linkedin_total'],
  ['meetings', 'Reuniões', 'meetings_total'],
];

function bad(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}
function parseDate(value, name) {
  if (!ISO.test(String(value || ''))) throw bad(`${name} obrigatório (YYYY-MM-DD)`);
  return value;
}
function days(since, until) {
  return Math.floor((new Date(`${until}T00:00:00Z`) - new Date(`${since}T00:00:00Z`)) / 86400000) + 1;
}
function isBusiness(date) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
}
function businessDays(since, until) {
  let count = 0;
  const current = new Date(`${since}T00:00:00Z`);
  const end = new Date(`${until}T00:00:00Z`);
  while (current <= end) {
    if (isBusiness(current.toISOString().slice(0, 10))) count += 1;
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return count;
}
function todayBrt() { return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10); }
function parse(req) {
  const q = new URL(`http://x${req.url}`).searchParams;
  if (q.get('v') !== '2') throw bad('v=2 obrigatório');
  const domain = q.get('domain') || 'ritmo';
  if (UNSUPPORTED_DOMAINS.includes(domain)) throw bad(`${domain} ainda não suportado: gold.bdr_daily_ops não possui camada semântica de CRM/contato efetivo`);
  if (!SUPPORTED_DOMAINS.includes(domain)) throw bad('domain inválido');
  const breakdown = q.get('breakdown') || (domain === 'ritmo' ? 'canal' : 'none');
  if (!BREAKDOWNS.includes(breakdown)) throw bad('breakdown inválido');
  if (breakdown === 'canal' && domain !== 'ritmo') throw bad('breakdown=canal só é válido para domain=ritmo');
  if (q.get('porte') || q.get('segmento') || q.get('persona')) throw bad('porte/segmento/persona não suportados no endpoint compare atual');
  const bdr = q.get('bdr') ? canonicalizeBdrName(q.get('bdr')) : null;
  if (bdr && !BDR_TEAM.includes(bdr)) throw bad('BDR inválido');
  const channels = (q.get('channels') || CHANNELS.map((c) => c[0]).join(',')).split(',').filter(Boolean);
  if (channels.some((channel) => !CHANNELS.some((candidate) => candidate[0] === channel))) throw bad('canal inválido');
  const parsed = {
    aSince: parseDate(q.get('aSince'), 'aSince'),
    aUntil: parseDate(q.get('aUntil'), 'aUntil'),
    bSince: parseDate(q.get('bSince'), 'bSince'),
    bUntil: parseDate(q.get('bUntil'), 'bUntil'),
    domain,
    breakdown,
    businessDays: q.get('businessDays') !== 'false',
    bdr,
    channels,
  };
  if (parsed.aSince > parsed.aUntil || parsed.bSince > parsed.bUntil) throw bad('ranges inválidos');
  return parsed;
}
function metricExpression(domain, channels) {
  if (domain === 'sql') return 'SUM(sql_deals)';
  if (domain === 'insercao') return 'SUM(leads_created)';
  return channels.map((key) => {
    const channel = CHANNELS.find((candidate) => candidate[0] === key);
    return `SUM(${channel[2]})`;
  }).join(' + ') || '0';
}
function isTeamOwner(name) { return BDR_TEAM.includes(canonicalizeBdrName(name)); }
function num(value) { return Number(value || 0); }
function normalizeTimestamp(value) { if (value == null || value === '') return null; const raw = String(value).trim(); if (/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(raw)) { const d = new Date(Math.round(Number(raw) * 1000)); return Number.isNaN(d.getTime()) ? null : d.toISOString(); } if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(raw)) { const d = new Date(raw.replace(' ', 'T') + 'Z'); return Number.isNaN(d.getTime()) ? null : d.toISOString(); } const d = new Date(raw); return Number.isNaN(d.getTime()) ? null : d.toISOString(); }
function makeComponents(rows, requested) {
  if (requested.domain === 'ritmo' && requested.breakdown === 'canal') {
    return CHANNELS.filter((channel) => requested.channels.includes(channel[0])).map((channel) => {
      const a = rows.filter((row) => row.period_key === 'A').reduce((sum, row) => sum + num(row[channel[2]]), 0);
      const b = rows.filter((row) => row.period_key === 'B').reduce((sum, row) => sum + num(row[channel[2]]), 0);
      return { key: channel[0], label: channel[1], a, b, delta: b - a };
    });
  }
  if (requested.breakdown === 'bdr') {
    return BDR_TEAM.map((name) => {
      const a = rows.filter((row) => row.period_key === 'A' && canonicalizeBdrName(row.owner_name) === name).reduce((sum, row) => sum + num(row.metric), 0);
      const b = rows.filter((row) => row.period_key === 'B' && canonicalizeBdrName(row.owner_name) === name).reduce((sum, row) => sum + num(row.metric), 0);
      return { key: name, label: name, a, b, delta: b - a };
    }).filter((row) => row.a || row.b);
  }
  const a = rows.filter((row) => row.period_key === 'A').reduce((sum, row) => sum + num(row.metric), 0);
  const b = rows.filter((row) => row.period_key === 'B').reduce((sum, row) => sum + num(row.metric), 0);
  return [{ key: 'total', label: 'Total', a, b, delta: b - a }];
}
async function build(requested) {
  if (!bq.isConfigured()) throw Object.assign(new Error('BigQuery não configurado'), { statusCode: 503 });
  const metric = metricExpression(requested.domain, requested.channels);
  const sql = `
    SELECT 'A' AS period_key, metric_date, owner_name,
      SUM(calls_total) AS calls_total,
      SUM(emails_sent_total) AS emails_sent_total,
      SUM(whatsapp_total) AS whatsapp_total,
      SUM(linkedin_total) AS linkedin_total,
      SUM(meetings_total) AS meetings_total,
      ${metric} AS metric,
      MAX(refreshed_at) AS refreshed_at
    FROM \`${TABLE}\`
    WHERE metric_date BETWEEN @aSince AND @aUntil
    GROUP BY period_key, metric_date, owner_name
    UNION ALL
    SELECT 'B' AS period_key, metric_date, owner_name,
      SUM(calls_total) AS calls_total,
      SUM(emails_sent_total) AS emails_sent_total,
      SUM(whatsapp_total) AS whatsapp_total,
      SUM(linkedin_total) AS linkedin_total,
      SUM(meetings_total) AS meetings_total,
      ${metric} AS metric,
      MAX(refreshed_at) AS refreshed_at
    FROM \`${TABLE}\`
    WHERE metric_date BETWEEN @bSince AND @bUntil
    GROUP BY period_key, metric_date, owner_name`;
  const { rows } = await bq.query(sql, [
    { name: 'aSince', type: 'DATE', value: requested.aSince },
    { name: 'aUntil', type: 'DATE', value: requested.aUntil },
    { name: 'bSince', type: 'DATE', value: requested.bSince },
    { name: 'bUntil', type: 'DATE', value: requested.bUntil },
  ]);
  let filtered = rows.filter((row) => isTeamOwner(row.owner_name) && (!requested.bdr || canonicalizeBdrName(row.owner_name) === requested.bdr));
  if (requested.businessDays) filtered = filtered.filter((row) => isBusiness(String(row.metric_date).slice(0, 10)));
  const components = makeComponents(filtered, requested);
  const totalA = components.reduce((sum, component) => sum + component.a, 0);
  const totalB = components.reduce((sum, component) => sum + component.b, 0);
  const deltaTotal = totalB - totalA;
  const componentsSum = components.reduce((sum, component) => sum + component.delta, 0);
  const aBusinessDays = businessDays(requested.aSince, requested.aUntil);
  const bBusinessDays = businessDays(requested.bSince, requested.bUntil);
  const refreshedAt = filtered.reduce((latest, row) => { const ts = normalizeTimestamp(row.refreshed_at); return ts && (!latest || ts > latest) ? ts : latest; }, null);
  const componentsNormalized = components.map((component) => ({ ...component, aPerBusinessDay: aBusinessDays ? component.a / aBusinessDays : null, bPerBusinessDay: bBusinessDays ? component.b / bBusinessDays : null, deltaPerBusinessDay: (aBusinessDays && bBusinessDays) ? (component.b / bBusinessDays) - (component.a / aBusinessDays) : null }));
  const sqlImmature = requested.domain === 'sql' && (aBusinessDays < 7 || bBusinessDays < 7);
  const partial = requested.bUntil === todayBrt();
  return {
    success: true,
    contractVersion: '2.0',
    requestedRange: requested,
    resolvedRange: requested,
    filtersApplied: { bdr: requested.bdr, channels: requested.channels, businessDays: requested.businessDays },
    filtersIgnored: [],
    source: { kind: 'bq-operational', table: TABLE, refreshedAt },
    quality: {
      status: sqlImmature || partial ? 'warn' : 'pass',
      checks: [
        { key: 'sql_maturity', status: sqlImmature ? 'warn' : 'pass', message: sqlImmature ? 'SQL imaturo em janela <7 dias úteis' : 'ok' },
        { key: 'intraday_comparability', status: partial ? 'warn' : 'pass', message: partial ? 'Período B inclui hoje e usa o último snapshot Gold; o período A não foi truncado no mesmo horário.' : 'Períodos fechados comparáveis.' },
      ],
    },
    coverage: { aBusinessDays, bBusinessDays, normalizedByBusinessDay: Math.abs(aBusinessDays - bBusinessDays) > 2, partial },
    data: {
      domain: requested.domain,
      breakdown: requested.breakdown,
      totalA,
      totalB,
      deltaTotal,
      components,
      componentsNormalized,
      defaultMode: Math.abs(aBusinessDays - bBusinessDays) > 2 ? 'per_business_day' : 'absolute',
      normalized: { aPerBusinessDay: aBusinessDays ? totalA / aBusinessDays : null, bPerBusinessDay: bBusinessDays ? totalB / bBusinessDays : null },
    },
    invariant: { componentsSum, deltaTotal, matches: componentsSum === deltaTotal },
  };
}
module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['GET'])) return;
  const user = requireAuth(req, res);
  if (!user) return;
  try { return res.status(200).json(await build(parse(req))); }
  catch (error) { return res.status(error.statusCode || 500).json({ success: false, error: error.message }); }
};
module.exports._test = { parse, days, businessDays, todayBrt, makeComponents, metricExpression, build, CHANNELS, SUPPORTED_DOMAINS, UNSUPPORTED_DOMAINS, TABLE, normalizeTimestamp };
