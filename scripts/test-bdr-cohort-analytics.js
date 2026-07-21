'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const api = require('../api/bdr-cohort-analytics');
const { BDR_OWNER_MAP } = require('../lib/bdr-team');
const t = api._test;
function sp(q) { return new URL('http://x?' + q).searchParams; }
(function testParseRange() {
  const r = t.parseRange(sp('since=2026-06-01&until=2026-06-30&bdr=Gabriele%20Almeida'));
  assert.equal(r.days, 30); assert.equal(r.bdr, 'Gabriele Almeida');
  assert.throws(() => t.parseRange(sp('since=2025-01-01&until=2026-06-30')), /365/);
})();
(function testFallbackStale() {
  const r = { since: '2026-07-10', until: '2026-07-20', days: 11 };
  const e = t.effectiveRange(r, '2026-07-02');
  assert.equal(e.usedFallback, true); assert.equal(e.until, '2026-07-02'); assert.equal(e.since, '2026-06-03'); assert.match(e.note, /snapshot vai até 2026-07-02/);
  const c = t.effectiveRange({ since: '2026-06-20', until: '2026-07-20', days: 31 }, '2026-07-02');
  assert.equal(c.usedFallback, false); assert.equal(c.until, '2026-07-02'); assert.equal(c.since, '2026-06-03'); assert.equal(c.expandedTo30d, true);
  const short = t.effectiveRange({ since: '2026-06-20', until: '2026-06-20', days: 1 }, '2026-07-02');
  assert.equal(short.since, '2026-05-22'); assert.equal(short.expandedTo30d, true);
})();
(function testWilson() {
  const w = t.wilson95(50, 100);
  assert(Math.abs(w.rate - 0.5) < 1e-9); assert(w.low > 0.40 && w.low < 0.41); assert(w.high > 0.59 && w.high < 0.60);
})();
(function testRoster() {
  assert.equal(t.OWNER_IDS.length, 14); assert.equal(Object.keys(BDR_OWNER_MAP).length, 14); assert(t.OWNER_ID_SQL.includes("'83025540'"));
})();
(function testNoPiiAndSources() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'api', 'bdr-cohort-analytics.js'), 'utf8');
  assert(src.includes('vw_dash_bdr_effort_sql_v1'));
  assert(src.includes('vw_dash_bdr_penetration_v1'));
  assert(src.includes('vw_dash_bdr_sql_by_porte_v1'));
  assert(!/company_id\s*[:]/.test(src));
  assert(!/contact_id\s*[:]/.test(src));
  assert(!/bdrId\s*[:]/.test(src));
  assert(src.includes('sampleSufficient'));
})();
(function testUiMarkersAndAsset() {
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'bdr-workload.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'bdr-workload.html'), 'utf8');
  assert(js.includes('/api/bdr-cohort-analytics?since='));
  assert(js.includes('Inteligência de Coorte | snapshot analítico'));
  assert(js.includes('Associação observacional | esforço real até a data do SQL'));
  assert(js.includes('Penetração observada | empresa e contato'));
  assert(js.includes('Conversão empresa→SQL por porte | 30d'));
  assert(js.includes('Filtros aplicados:'));
  assert(js.includes('mínimo analítico de 30 dias'));
  assert(html.includes('/bdr-workload.js?v=9'));
})();
console.log('PASS bdr-cohort-analytics tests');
