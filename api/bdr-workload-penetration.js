'use strict';

const { setCORSHeaders, requireAuth, methodCheck } = require('./_helpers');
const bq = require('../lib/bigquery');
const { BDR_TEAM, BDR_OWNER_MAP, canonicalizeBdrName } = require('../lib/bdr-team');

const PROJECT = 'gen-lang-client-0423905839';
const DATASET = 'axenya_commercial_intel_prd';
const VIEW = `${PROJECT}.${DATASET}.vw_dash_bdr_penetration_v1`;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const OWNER_IDS = Object.keys(BDR_OWNER_MAP);
const OWNER_ID_LITERAL = OWNER_IDS.map((id) => `'${id}'`).join(',');

function bad(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}
function parseDate(value, name) {
  if (!ISO.test(String(value || ''))) throw bad(`${name} obrigatório (YYYY-MM-DD)`);
  return value;
}
function bdrIds(name) {
  if (!name) return [];
  const canon = canonicalizeBdrName(name);
  if (!BDR_TEAM.includes(canon)) throw bad('BDR inválido');
  return OWNER_IDS.filter((id) => BDR_OWNER_MAP[id] === canon);
}
function bucketExact(value) {
  const n = Number(value || 0);
  return n >= 6 ? '6+' : String(n);
}
function grouped(key) {
  if (key === '0' || key === '1' || key === '6+') return key;
  if (key === '2' || key === '3') return '2–3';
  return '4–5';
}
function wilson(successes, n) {
  const z = 1.959963984540054;
  const s = Number(successes || 0);
  const t = Number(n || 0);
  if (!t) return null;
  const p = s / t;
  const d = 1 + z * z / t;
  const c = (p + z * z / (2 * t)) / d;
  const m = z * Math.sqrt((p * (1 - p) + z * z / (4 * t)) / t) / d;
  return { low: Math.max(0, c - m), high: Math.min(1, c + m), rate: p };
}
function parse(req) {
  const q = new URL(`http://x${req.url}`).searchParams;
  if (q.get('v') !== '2') throw bad('v=2 obrigatório');
  if (q.get('segmento') || q.get('persona')) throw bad('segmento/persona unsupported: schema atual da view não possui esses atributos');
  const cohort = q.get('cohort') || 'observed_snapshot';
  if (cohort !== 'observed_snapshot') throw bad('cohort suportado apenas: observed_snapshot');
  return {
    since: parseDate(q.get('since'), 'since'),
    until: parseDate(q.get('until'), 'until'),
    cohort,
    bdr: q.get('bdr') || null,
    bdrIds: bdrIds(q.get('bdr')),
    porte: q.get('porte') || null,
  };
}
function buildBuckets(rows) {
  const exact = ['0', '1', '2', '3', '4', '5', '6+'].map((label) => ({ label, companies: 0, converted: 0 }));
  const map = Object.fromEntries(exact.map((bucket) => [bucket.label, bucket]));
  rows.forEach((row) => {
    const key = bucketExact(row.contacts_real);
    map[key].companies += Number(row.companies || 0);
    map[key].converted += Number(row.converted || 0);
  });
  const total = exact.reduce((sum, bucket) => sum + bucket.companies, 0);
  exact.forEach((bucket) => { bucket.percent = total ? bucket.companies / total : 0; });
  const groupedMap = {};
  exact.forEach((bucket) => {
    const key = grouped(bucket.label);
    if (!groupedMap[key]) groupedMap[key] = { label: key, companies: 0, converted: 0 };
    groupedMap[key].companies += bucket.companies;
    groupedMap[key].converted += bucket.converted;
  });
  const groupedBuckets = ['0', '1', '2–3', '4–5', '6+'].map((key) => {
    const bucket = groupedMap[key] || { label: key, companies: 0, converted: 0 };
    bucket.percent = total ? bucket.companies / total : 0;
    return bucket;
  });
  return { exact, grouped: groupedBuckets, denominatorObserved: total };
}
function association(rows) {
  return buildBuckets(rows).exact.map((bucket) => {
    const n = bucket.companies;
    const converted = bucket.converted;
    const w = wilson(converted, n);
    return { bucket: bucket.label, n, converted, rate: n >= 10 ? w.rate : null, wilson95: n >= 10 ? w : null, threshold: n < 10 ? 'insufficient' : (n < 30 ? 'exploratory' : 'descriptive') };
  });
}
async function build(requested) {
  if (!bq.isConfigured()) throw Object.assign(new Error('BigQuery não configurado'), { statusCode: 503 });
  if (requested.since > requested.until) throw bad('since > until');
  const ownerFilter = requested.bdrIds.length ? `AND bdr_id IN (${requested.bdrIds.map((id) => `'${id}'`).join(',')})` : `AND bdr_id IN (${OWNER_ID_LITERAL})`;
  const porteFilter = requested.porte ? "AND COALESCE(NULLIF(porte,''),'Desconhecido') = @porte" : '';
  const sql = `SELECT bdr_id, COALESCE(NULLIF(porte,''),'Desconhecido') porte, LEAST(CAST(contacts_real AS INT64),6) contacts_real, COUNT(DISTINCT company_id) companies, SUM(CAST(converted_30d AS INT64)) converted, SUM(CAST(contacts_observed AS INT64)) contacts_observed, SUM(CAST(contacts_real AS INT64)) contacts_real_sum, MAX(last_touch_date) last_touch_date FROM \`${VIEW}\` WHERE first_touch_date BETWEEN @since AND @until ${ownerFilter} ${porteFilter} GROUP BY bdr_id, porte, contacts_real ORDER BY contacts_real`;
  const params = [{ name: 'since', type: 'DATE', value: requested.since }, { name: 'until', type: 'DATE', value: requested.until }];
  if (requested.porte) params.push({ name: 'porte', type: 'STRING', value: requested.porte });
  const { rows } = await bq.query(sql, params);
  const buckets = buildBuckets(rows);
  const contactsObserved = rows.reduce((sum, row) => sum + Number(row.contacts_observed || 0), 0);
  const contactsReal = rows.reduce((sum, row) => sum + Number(row.contacts_real_sum || 0), 0);
  const latest = rows.reduce((max, row) => String(row.last_touch_date || '') > max ? String(row.last_touch_date) : max, '');
  return {
    success: true,
    contractVersion: '2.0',
    requestedRange: { since: requested.since, until: requested.until },
    resolvedRange: { since: requested.since, until: requested.until },
    filtersApplied: { bdr: requested.bdr ? canonicalizeBdrName(requested.bdr) : null, porte: requested.porte, cohort: requested.cohort },
    filtersIgnored: [],
    unsupportedFilters: { segmento: { status: 'disabled', reason: 'vw_dash_bdr_penetration_v1 não possui segmento' }, persona: { status: 'disabled', reason: 'vw_dash_bdr_penetration_v1 não possui cargo/persona' } },
    source: { kind: 'ci-analytic', view: VIEW, refreshedAt: latest, latestDataDate: latest },
    quality: { status: 'warn', checks: [{ key: 'denominator', status: 'warn', message: 'Denominador é snapshot observado; não inventa população elegível fora da view atual.' }] },
    coverage: { denominatorObserved: buckets.denominatorObserved, contactsObserved, contactsReal, attributeCoverage: { porte: rows.length ? rows.filter((row) => row.porte !== 'Desconhecido').reduce((sum, row) => sum + Number(row.companies || 0), 0) / Math.max(1, buckets.denominatorObserved) : 0, segmento: 0, persona: 0 } },
    data: { bucketsExact: buckets.exact, bucketsGrouped: buckets.grouped, association: association(rows), notes: ['Associação observacional; correlação não implica causalidade.', 'Confundidores não controlados: porte, qualidade da carteira e maturação/timing dos toques.'] },
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
module.exports._test = { parse, bdrIds, bucketExact, grouped, buildBuckets, association, wilson, build, VIEW };
