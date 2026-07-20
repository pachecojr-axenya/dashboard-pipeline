'use strict';
const assert = require('assert');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
function today() { return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10); }
function hasPII(obj) {
  const s = JSON.stringify(obj);
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(s) || /\+?55\s?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}/.test(s);
}
async function getJson(base, path) {
  const res = await fetch(base + path, { headers: { 'x-local-dev-bypass': 'true' } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(path + ' falhou: ' + (data.error || res.status));
  return data;
}
(async () => {
  const base = arg('--base-url', 'http://localhost:3003').replace(/\/+$/, '');
  const since = arg('--since', today());
  const until = arg('--until', today());
  const live = await getJson(base, '/api/bdr-workload?since=' + since + '&until=' + until + '&refresh=1');
  const hist = await getJson(base, '/api/bdr-workload-history?since=' + since + '&until=' + until);
  assert(Array.isArray(live.activities), 'live.activities array');
  if (until >= today() && since <= today()) assert(live.activities.length > 0, 'esperado live activities >0 para hoje');
  assert.strictEqual(hist.source, 'bigquery');
  assert(Array.isArray(hist.dailyRows), 'history dailyRows array');
  assert(Array.isArray(hist.sqlDeals), 'history sqlDeals array');
  const dailySql = hist.dailyRows.filter((r) => r.metric_date >= since && r.metric_date <= until).reduce((s, r) => s + Number(r.sql_deals || 0), 0);
  assert.strictEqual(hist.sqlDeals.length, dailySql, 'sqlDeals deve reconciliar com soma diária da janela');
  assert(hist.metadata && hist.metadata.reconciliation && hist.metadata.reconciliation.matches === true, 'metadata reconciliation deve passar');
  assert(!hasPII(hist), 'history não deve conter PII');
  console.log('smoke-bdr-workload ok', JSON.stringify({ liveActivities: live.activities.length, sqlDeals: hist.sqlDeals.length, source: hist.source }));
})().catch((e) => { console.error(e.message); process.exit(1); });
