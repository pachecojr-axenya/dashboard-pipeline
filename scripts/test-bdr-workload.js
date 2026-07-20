'use strict';
const assert = require('assert');
const hist = require('../api/bdr-workload-history')._test;

const payload = hist.buildHistoryPayload([
  { metric_date: '2026-07-13', owner_name: 'Thauan Pontes', activities_total: '5', calls_total: '2', emails_sent_total: '3', whatsapp_total: null, linkedin_total: '0', meetings_total: '0', sql_deals: '1', refreshed_at: '2026-07-20T11:00:00Z' },
  { metric_date: '2026-07-14', owner_name: 'Thauan Pontes', activities_total: '0', calls_total: '0', emails_sent_total: '0', whatsapp_total: '0', linkedin_total: '0', meetings_total: '0', sql_deals: '0', refreshed_at: '2026-07-20T11:00:00Z' },
], [
  { deal_id: '1', bdr: 'Thauan Pontes', sql_date: '2026-07-13', deal_stage_id: 'stage-a' },
  { deal_id: '2', bdr: 'Thauan Pontes', sql_date: '2026-07-14', deal_stage_id: 'stage-b' },
], '2026-07-13', '2026-07-14', '2026-07-11', [
  { metric_date: '2026-07-13', owner_name: 'Thauan Pontes', sql_deals: '1', refreshed_at: '2026-07-20T11:00:00Z' },
  { metric_date: '2026-07-14', owner_name: 'Thauan Pontes', sql_deals: '1', refreshed_at: '2026-07-20T11:00:00Z' },
]);

assert.strictEqual(payload.source, 'bigquery');
assert.strictEqual(payload.dailyRows[0].activities_total, 5);
assert.strictEqual(payload.dailyRows[0].whatsapp_total, 0);
assert.strictEqual(payload.sqlDeals.length, 2);
assert.strictEqual(payload.sqlDeals[0].deal_id, '1');
assert.strictEqual(payload.metadata.maxMetricDate, '2026-07-14');
assert.strictEqual(payload.metadata.refreshedAt, '2026-07-20T11:00:00.000Z');
assert.deepStrictEqual(payload.metadata.reconciliation, { sqlDealsCount: 2, dailySqlSum: 2, matches: true });
assert.strictEqual(payload.dailyRows.find((row) => row.metric_date === '2026-07-14').sql_deals, 1);
assert.strictEqual(hist.inclusiveDays(hist.parseDate('2026-07-13'), hist.parseDate('2026-07-14')), 2);
assert.strictEqual(hist.iso(hist.addDays(hist.parseDate('2026-07-13'), -2)), '2026-07-11');

const zero = hist.buildHistoryPayload([{ metric_date: '2026-07-15', owner_name: 'Thauan Pontes', activities_total: '0' }], [], '2026-07-15', '2026-07-15', '2026-07-14');
assert.strictEqual(zero.dailyRows[0].activities_total, 0, 'zero real deve permanecer zero');
assert.strictEqual(zero.sqlDeals.length, 0, 'sem deals é zero real quando history existe');
assert.strictEqual(zero.metadata.reconciliation.matches, true);
assert.strictEqual(require('../lib/bdr-team').canonicalizeBdrName('90540671'), 'Thauan Pontes');

// --- Regressão freshness NaN (2026-07-20) ---
// O BigQuery REST devolve TIMESTAMP como epoch-segundos (string decimal).
// Antes do fix, esse valor passava cru e o browser gerava "NaN/NaN NaN:NaN".
// timestamp() precisa normalizar TODAS as formas para ISO 8601 parseável.
const ts = require('../api/bdr-workload-history')._test.timestamp;
// 1) epoch-segundos com fração (formato REAL do BigQuery REST)
assert.strictEqual(ts('1784567311.617586'), '2026-07-20T17:08:31.618Z', 'epoch decimal -> ISO');
assert.strictEqual(new Date(ts('1784567311.617586')).getTime() > 0, true, 'epoch vira Date válida');
// 2) epoch-segundos inteiro
assert.strictEqual(ts('1784567311'), '2026-07-20T17:08:31.000Z', 'epoch inteiro -> ISO');
// 3) "YYYY-MM-DD HH:MM:SS.ffffff" (sem timezone) -> assume UTC
assert.strictEqual(ts('2026-07-20 17:14:09.299639'), '2026-07-20T17:14:09.299Z', 'sql string -> ISO');
// 4) ISO já pronta é preservada como Date válida
assert.strictEqual(new Date(ts('2026-07-20T11:00:00Z')).getTime() > 0, true, 'ISO -> Date válida');
// 5) lixo/vazio -> null (nunca string que vire Invalid Date)
assert.strictEqual(ts(null), null);
assert.strictEqual(ts(''), null);
assert.strictEqual(ts('not-a-date'), null, 'valor não parseável -> null, nunca NaN na UI');

// --- Regressão contaminação de owner fora do time (2026-07-20) ---
// silver.activities/sql_deals podem conter owners não-canônicos (ex.: owner_id
// vizinho a um BDR). O payload NÃO pode incluí-los nos totais "Todos os BDRs".
const contaminated = hist.buildHistoryPayload([
  { metric_date: '2026-07-13', owner_name: 'Thauan Pontes', activities_total: '5', calls_total: '5', emails_sent_total: '0', whatsapp_total: '0', linkedin_total: '0', meetings_total: '0', refreshed_at: '2026-07-20T11:00:00Z' },
  { metric_date: '2026-07-13', owner_name: 'Gabriel Milan Ramos', activities_total: '3', calls_total: '3', emails_sent_total: '0', whatsapp_total: '0', linkedin_total: '0', meetings_total: '0', refreshed_at: '2026-07-20T11:00:00Z' },
], [
  { deal_id: '10', bdr: 'Thauan Pontes', sql_date: '2026-07-13', deal_stage_id: 'stage-a' },
  { deal_id: '11', bdr: 'Gabriel Milan Ramos', sql_date: '2026-07-13', deal_stage_id: 'stage-a' },
], '2026-07-13', '2026-07-13', '2026-07-12', []);
assert.strictEqual(contaminated.dailyRows.length, 1, 'owner fora do time removido das linhas diárias');
assert.strictEqual(contaminated.dailyRows[0].owner_name, 'Thauan Pontes');
assert.strictEqual(contaminated.sqlDeals.length, 1, 'deal de owner fora do time removido');
assert.strictEqual(contaminated.sqlDeals[0].deal_id, '10');

console.log('test-bdr-workload ok');
