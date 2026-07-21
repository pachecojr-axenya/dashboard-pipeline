'use strict';

const { setCORSHeaders, requireAuth, methodCheck } = require('./_helpers');
const bigquery = require('../lib/bigquery');
const { BDR_TEAM, BDR_OWNER_MAP, canonicalizeBdrName } = require('../lib/bdr-team');

const PROJECT = 'gen-lang-client-0423905839';
const DATASET = 'axenya_commercial_intel_prd';
const VIEWS = {
  effort: `${PROJECT}.${DATASET}.vw_dash_bdr_effort_sql_v1`,
  penetration: `${PROJECT}.${DATASET}.vw_dash_bdr_penetration_v1`,
  tier: `${PROJECT}.${DATASET}.vw_dash_bdr_sql_by_porte_v1`,
};
const OWNER_IDS = Object.keys(BDR_OWNER_MAP);
const OWNER_ID_SQL = OWNER_IDS.map((id) => `'${id}'`).join(', ');
const CACHE_TTL_MS = 15 * 60 * 1000;
const MIN_EFFORT_N = 30;
const MIN_TIER_N = 20;
const MIN_PENETRATION_COMPANIES = 20;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
let l1 = new Map();

function parseDate(value, name) {
  if (!ISO_RE.test(String(value || ''))) throw new Error(`${name} obrigatório (YYYY-MM-DD)`);
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw new Error(`${name} inválido`);
  return value;
}
function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function daysInclusive(since, until) {
  return Math.floor((new Date(`${until}T00:00:00Z`) - new Date(`${since}T00:00:00Z`)) / 86400000) + 1;
}
function parseRange(query) {
  const since = parseDate(query.get('since'), 'since');
  const until = parseDate(query.get('until'), 'until');
  if (since > until) throw new Error('since > until');
  const days = daysInclusive(since, until);
  if (days > 365) throw new Error('janela máxima é 365 dias');
  const bdrRaw = query.get('bdr');
  const bdr = bdrRaw ? canonicalizeBdrName(bdrRaw) : null;
  if (bdrRaw && !BDR_TEAM.includes(bdr)) throw new Error('BDR inválido');
  return { since, until, days, bdr };
}
function effectiveRange(requested, latestDataDate) {
  if (!latestDataDate) throw new Error('Snapshot analítico sem last_touch_date disponível');
  const analyticDays = Math.max(30, requested.days);
  if (requested.since > latestDataDate) {
    const until = latestDataDate;
    const since = addDays(until, -(analyticDays - 1));
    return { since, until, usedFallback: true, expandedTo30d: requested.days < 30, note: `Pedido ${requested.since}–${requested.until}; exibindo janela analítica ${since}–${until} porque o snapshot vai até ${latestDataDate} e a análise exige no mínimo 30 dias.` };
  }
  if (requested.until > latestDataDate) {
    const truncatedDays = daysInclusive(requested.since, latestDataDate);
    const expandedTo30d = truncatedDays < 30;
    const since = expandedTo30d ? addDays(latestDataDate, -29) : requested.since;
    return { since, until: latestDataDate, usedFallback: false, expandedTo30d, note: `Pedido ${requested.since}–${requested.until}; exibindo janela analítica ${since}–${latestDataDate}, limitada pela data máxima do snapshot e pelo mínimo de 30 dias.` };
  }
  if (requested.days < 30) {
    const since = addDays(requested.until, -29);
    return { since, until: requested.until, usedFallback: false, expandedTo30d: true, note: `Pedido ${requested.since}–${requested.until}; camada analítica expandida para ${since}–${requested.until} (mínimo de 30 dias).` };
  }
  return { since: requested.since, until: requested.until, usedFallback: false, expandedTo30d: false, note: 'Janela solicitada coberta pelo snapshot analítico.' };
}
function wilson95(successes, n) {
  const z = 1.959963984540054;
  const s = Number(successes || 0);
  const total = Number(n || 0);
  if (!total) return { low: 0, high: 0, rate: 0 };
  const phat = s / total;
  const denom = 1 + (z * z) / total;
  const center = (phat + (z * z) / (2 * total)) / denom;
  const margin = (z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * total)) / total)) / denom;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin), rate: phat };
}
function bdrName(id) { return BDR_OWNER_MAP[String(id)] || canonicalizeBdrName(id); }
function enrichConversion(row, minN) {
  const cohorts = Number(row.cohorts || 0);
  const converted = Number(row.converted || 0);
  return { ...row, cohorts, converted, rate: cohorts ? converted / cohorts : 0, wilson95: wilson95(converted, cohorts), sampleSufficient: cohorts >= minN };
}
function num(v) { return Number(v || 0); }
async function latestDate() {
  const sql = `SELECT MAX(last_touch_date) AS latestDataDate FROM \`${VIEWS.penetration}\` WHERE bdr_id IN (${OWNER_ID_SQL})`;
  const { rows } = await bigquery.query(sql);
  return rows[0] && rows[0].latestDataDate ? String(rows[0].latestDataDate) : null;
}
function params(range) { return [{ name: 'since', type: 'DATE', value: range.since }, { name: 'until', type: 'DATE', value: range.until }]; }
async function queryEffort(range) {
  const sql = `SELECT bdr_id, effort_band, effort_band_order, COUNT(*) AS cohorts, SUM(converted_30d) AS converted FROM \`${VIEWS.effort}\` WHERE bdr_id IN (${OWNER_ID_SQL}) AND first_touch_date BETWEEN @since AND @until GROUP BY bdr_id, effort_band, effort_band_order ORDER BY bdr_id, effort_band_order`;
  const { rows } = await bigquery.query(sql, params(range));
  return rows.map((r) => enrichConversion({ bdr: bdrName(r.bdr_id), effortBand: r.effort_band, effortBandOrder: num(r.effort_band_order), cohorts: r.cohorts, converted: r.converted }, MIN_EFFORT_N));
}
async function queryPenetration(range) {
  const sql = `SELECT bdr_id, COUNT(DISTINCT company_id) AS companies_observed, COUNT(DISTINCT IF(company_with_real_touch = 1, company_id, NULL)) AS companies_real, SUM(contacts_observed) AS contacts_observed, SUM(contacts_real) AS contacts_real, APPROX_QUANTILES(touches_real_until_sql_date, 2)[OFFSET(1)] AS median_depth, COUNTIF(depth_band = '0') AS bucket_0, COUNTIF(depth_band = '1') AS bucket_1, COUNTIF(depth_band = '2-3') AS bucket_2_3, COUNTIF(depth_band = '4+') AS bucket_4_plus, MAX(last_touch_date) AS latest_data FROM \`${VIEWS.penetration}\` WHERE bdr_id IN (${OWNER_ID_SQL}) AND first_touch_date BETWEEN @since AND @until GROUP BY GROUPING SETS ((bdr_id), ()) ORDER BY bdr_id`;
  const { rows } = await bigquery.query(sql, params(range));
  return rows.map((r) => ({ bdr: r.bdr_id == null ? '__ALL__' : bdrName(r.bdr_id), isAll: r.bdr_id == null, companiesObserved: num(r.companies_observed), companiesReal: num(r.companies_real), contactsObserved: num(r.contacts_observed), contactsReal: num(r.contacts_real), medianDepth: num(r.median_depth), buckets: { '0': num(r.bucket_0), '1': num(r.bucket_1), '2-3': num(r.bucket_2_3), '4+': num(r.bucket_4_plus) }, latestData: r.latest_data || null, sampleSufficient: num(r.companies_observed) >= MIN_PENETRATION_COMPANIES }));
}
async function queryTier(range) {
  const sql = `SELECT bdr_id, COALESCE(NULLIF(porte, ''), 'desconhecido') AS porte, COUNT(*) AS cohorts, SUM(converted_30d) AS converted FROM \`${VIEWS.tier}\` WHERE bdr_id IN (${OWNER_ID_SQL}) AND first_touch_date BETWEEN @since AND @until GROUP BY bdr_id, porte ORDER BY bdr_id, porte`;
  const { rows } = await bigquery.query(sql, params(range));
  return rows.map((r) => enrichConversion({ bdr: bdrName(r.bdr_id), porte: r.porte || 'desconhecido', cohorts: r.cohorts, converted: r.converted }, MIN_TIER_N));
}
function stripByBdr(payload, bdr) {
  if (!bdr) return payload;
  return { ...payload, effort: payload.effort.filter((r) => r.bdr === bdr), penetration: payload.penetration.filter((r) => r.bdr === bdr), tier: payload.tier.filter((r) => r.bdr === bdr) };
}
async function buildPayload(requested) {
  const latestDataDate = await latestDate();
  const eff = effectiveRange(requested, latestDataDate);
  const [effort, penetration, tier] = await Promise.all([queryEffort(eff), queryPenetration(eff), queryTier(eff)]);
  return stripByBdr({ success: true, requestedRange: { since: requested.since, until: requested.until, days: requested.days }, effectiveRange: { since: eff.since, until: eff.until }, usedFallback: eff.usedFallback, expandedTo30d: eff.expandedTo30d, team: BDR_TEAM, effort, penetration, tier, metadata: { grain: 'company|bdr cohort', latestDataDate, minEffortN: MIN_EFFORT_N, minTierN: MIN_TIER_N, minPenetrationCompanies: MIN_PENETRATION_COMPANIES, generatedAt: new Date().toISOString(), notes: [eff.note, 'Snapshot analítico baseado em Commercial Intelligence; não é realtime.', 'Associação observacional: correlação ≠ causalidade; reverse causation mitigada usando esforço real pré-SQL.', 'Filtros aplicados nesta camada: período e BDR; canal/fonte da inserção não se aplicam a esta camada.'], caveats: ['Sem IDs de company/contact e sem PII no payload.', 'Denominadores de penetração são observados no snapshot, não carteira total/elegíveis.'] } }, requested.bdr);
}

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['GET'])) return;
  const user = requireAuth(req, res);
  if (!user) return;
  try {
    const requested = parseRange(new URL(`http://x${req.url}`).searchParams);
    const key = `${requested.since}|${requested.until}|${requested.bdr || ''}`;
    const cached = l1.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return res.status(200).json({ ...cached.data, cached: true, cacheLayer: 'memory' });
    const data = await buildPayload(requested);
    l1.set(key, { at: Date.now(), data });
    return res.status(200).json(data);
  } catch (e) {
    const status = /obrigat|inválido|since|máxima|BDR/.test(e.message) ? 400 : 500;
    console.error('[bdr-cohort-analytics]', e.message);
    return res.status(status).json({ success: false, error: e.message });
  }
};

module.exports._test = { parseRange, effectiveRange, wilson95, OWNER_IDS, VIEWS, OWNER_ID_SQL, buildPayload };
