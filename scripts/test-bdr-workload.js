'use strict';
const assert = require('assert');
const hist = require('../api/bdr-workload-history')._test;

const payload = hist.buildHistoryPayload([
  { metric_date: '2026-07-13', owner_name: 'Ana', activities_total: '5', calls_total: '2', emails_sent_total: '3', whatsapp_total: null, linkedin_total: '0', meetings_total: '0', sql_deals: '1', refreshed_at: '2026-07-20T11:00:00Z' },
  { metric_date: '2026-07-14', owner_name: 'Ana', activities_total: '0', calls_total: '0', emails_sent_total: '0', whatsapp_total: '0', linkedin_total: '0', meetings_total: '0', sql_deals: '0', refreshed_at: '2026-07-20T11:00:00Z' },
], [
  { deal_id: '1', bdr: 'Ana', sql_date: '2026-07-13', deal_stage_id: 'stage-a' },
  { deal_id: '2', bdr: 'Ana', sql_date: '2026-07-14', deal_stage_id: 'stage-b' },
], '2026-07-13', '2026-07-14', '2026-07-11', [
  { metric_date: '2026-07-13', owner_name: 'Ana', sql_deals: '1', refreshed_at: '2026-07-20T11:00:00Z' },
  { metric_date: '2026-07-14', owner_name: 'Ana', sql_deals: '1', refreshed_at: '2026-07-20T11:00:00Z' },
]);

assert.strictEqual(payload.source, 'bigquery');
assert.strictEqual(payload.dailyRows[0].activities_total, 5);
assert.strictEqual(payload.dailyRows[0].whatsapp_total, 0);
assert.strictEqual(payload.sqlDeals.length, 2);
assert.strictEqual(payload.sqlDeals[0].deal_id, '1');
assert.strictEqual(payload.metadata.maxMetricDate, '2026-07-14');
assert.strictEqual(payload.metadata.refreshedAt, '2026-07-20T11:00:00Z');
assert.deepStrictEqual(payload.metadata.reconciliation, { sqlDealsCount: 2, dailySqlSum: 2, matches: true });
assert.strictEqual(payload.dailyRows.find((row) => row.metric_date === '2026-07-14').sql_deals, 1);
assert.strictEqual(hist.inclusiveDays(hist.parseDate('2026-07-13'), hist.parseDate('2026-07-14')), 2);
assert.strictEqual(hist.iso(hist.addDays(hist.parseDate('2026-07-13'), -2)), '2026-07-11');

const zero = hist.buildHistoryPayload([{ metric_date: '2026-07-15', owner_name: 'Ana', activities_total: '0' }], [], '2026-07-15', '2026-07-15', '2026-07-14');
assert.strictEqual(zero.dailyRows[0].activities_total, 0, 'zero real deve permanecer zero');
assert.strictEqual(zero.sqlDeals.length, 0, 'sem deals é zero real quando history existe');
assert.strictEqual(zero.metadata.reconciliation.matches, true);
assert.strictEqual(require('../lib/bdr-team').canonicalizeBdrName('90540671'), 'Thauan Pontes');

console.log('test-bdr-workload ok');
