'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const hist = require('../api/bdr-workload-history')._test;
const { canonicalizeBdrName } = require('../lib/bdr-team');

const payload = hist.buildHistoryPayload([
  { metric_date: '2026-07-13', owner_name: 'Thauan Pontes', activities_total: '999', calls_total: '2', emails_sent_total: '3', whatsapp_total: null, linkedin_total: '1', meetings_total: '4', sql_deals: '1', refreshed_at: '2026-07-20T11:00:00Z' },
  { metric_date: '2026-07-14', owner_name: 'Thauan Pontes', activities_total: '999', calls_total: '0', emails_sent_total: '0', whatsapp_total: '0', linkedin_total: '0', meetings_total: '0', sql_deals: '0', refreshed_at: '2026-07-20T11:00:00Z' },
], [
  { deal_id: '1', bdr: 'Thauan Pontes', sql_date: '2026-07-13', deal_stage_id: 'stage-a' },
  { deal_id: '2', bdr: 'Thauan Pontes', sql_date: '2026-07-14', deal_stage_id: 'stage-b' },
], '2026-07-13', '2026-07-14', '2026-07-11', [
  { metric_date: '2026-07-13', owner_name: 'Thauan Pontes', sql_deals: '1', refreshed_at: '2026-07-20T11:00:00Z' },
  { metric_date: '2026-07-14', owner_name: 'Thauan Pontes', sql_deals: '1', refreshed_at: '2026-07-20T11:00:00Z' },
], [
  { owner_name: 'Thauan Pontes', activity_family: 'calls', target_daily: '40' },
  { owner_name: 'Thauan Pontes', activity_family: 'emails', target_daily: '100' },
  { owner_name: 'Thauan Pontes', activity_family: 'whatsapp', target_daily: '30' },
  { owner_name: 'Thauan Pontes', activity_family: 'linkedin', target_daily: '20' },
]);

assert.strictEqual(payload.source, 'bigquery');
assert.strictEqual(payload.dailyRows[0].activities_total, 10, 'activities_total deve ignorar raw e somar cinco canais');
assert.strictEqual(payload.dailyRows[0].whatsapp_total, 0);
assert.strictEqual(payload.dailyRows[0].bdr_daily_target, 190);
assert.deepStrictEqual(payload.metadata.bdrDailyTargets['Thauan Pontes'], { total: 190, calls: 40, emails: 100, whatsapp: 30, linkedin: 20, meetings: 0 });
assert.strictEqual(payload.sqlDeals.length, 2);
assert.strictEqual(payload.sqlDeals[0].deal_id, '1');
assert.strictEqual(payload.metadata.maxMetricDate, '2026-07-14');
assert.strictEqual(payload.metadata.refreshedAt, '2026-07-20T11:00:00.000Z');
assert.deepStrictEqual(payload.metadata.reconciliation, { sqlDealsCount: 2, dailySqlSum: 2, matches: true });
assert.strictEqual(payload.dailyRows.find((row) => row.metric_date === '2026-07-14').sql_deals, 1);
assert.strictEqual(hist.inclusiveDays(hist.parseDate('2026-07-13'), hist.parseDate('2026-07-14')), 2);
assert.strictEqual(hist.iso(hist.addDays(hist.parseDate('2026-07-13'), -2)), '2026-07-11');

const zero = hist.buildHistoryPayload([{ metric_date: '2026-07-15', owner_name: 'Thauan Pontes', activities_total: '999' }], [], '2026-07-15', '2026-07-15', '2026-07-14');
assert.strictEqual(zero.dailyRows[0].activities_total, 0, 'zero real deve permanecer zero');
assert.strictEqual(zero.sqlDeals.length, 0, 'sem deals é zero real quando history existe');
assert.strictEqual(zero.metadata.reconciliation.matches, true);
assert.strictEqual(canonicalizeBdrName('90540671'), 'Thauan Pontes');

const ts = require('../api/bdr-workload-history')._test.timestamp;
assert.strictEqual(ts('1784567311.617586'), '2026-07-20T17:08:31.618Z', 'epoch decimal -> ISO');
assert.strictEqual(new Date(ts('1784567311.617586')).getTime() > 0, true, 'epoch vira Date válida');
assert.strictEqual(ts('1784567311'), '2026-07-20T17:08:31.000Z', 'epoch inteiro -> ISO');
assert.strictEqual(ts('1.784567311617586E9'), '2026-07-20T17:08:31.618Z', 'epoch em notação científica -> ISO');
assert.strictEqual(ts('2026-07-20 17:14:09.299639'), '2026-07-20T17:14:09.299Z', 'sql string -> ISO');
assert.strictEqual(new Date(ts('2026-07-20T11:00:00Z')).getTime() > 0, true, 'ISO -> Date válida');
assert.strictEqual(ts(null), null);
assert.strictEqual(ts(''), null);
assert.strictEqual(ts('not-a-date'), null, 'valor não parseável -> null, nunca NaN na UI');

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

const targets = hist.buildTargetsMap([
  { owner_name: '86900152', activity_family: 'calls', target_daily: '30' },
  { owner_name: '87213208', activity_family: 'calls', target_daily: '40' },
  { owner_name: 'Cintia Rodrigues', activity_family: 'emails_sent', target_daily: '100' },
  { owner_name: 'Cintia Rodrigues', activity_family: 'whatsapp', target_daily: '30' },
  { owner_name: 'Cintia Rodrigues', activity_family: 'linkedin', target_daily: '20' },
]);
assert.deepStrictEqual(targets['Cintia Rodrigues'], { total: 190, calls: 40, emails: 100, whatsapp: 30, linkedin: 20, meetings: 0 }, 'Cintia consolidada por nome canônico e MAX por canal');

assert.strictEqual(hist.querySources.dailyOps, 'gen-lang-client-0423905839.axenya_sales_hubspot_bdr_prd_sae1_gold.bdr_daily_ops', 'query diária deve ler gold.bdr_daily_ops');
assert.strictEqual(hist.querySources.dailyTarget, 'gen-lang-client-0423905839.axenya_sales_hubspot_bdr_prd_sae1_gold.bdr_daily_target', 'targets devem ler gold.bdr_daily_target');
assert.strictEqual(hist.querySources.sqlDeals, 'gen-lang-client-0423905839.axenya_sales_hubspot_bdr_prd_sae1_silver.sql_deals', 'deals SQL devem ler silver.sql_deals');

const apiSource = fs.readFileSync(path.join(__dirname, '../api/bdr-workload-history.js'), 'utf8');
assert(apiSource.includes('GROUP BY metric_date, owner_name'), 'Cintia com dois owner IDs deve consolidar por nome/data');

const ui = fs.readFileSync(path.join(__dirname, '../public/bdr-workload.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../public/bdr-workload.html'), 'utf8');
assert(ui.includes('function chartChannelComparison'), 'UI deve ter Comparativo de canais');
assert(ui.includes('Média móvel 7d'), 'UI deve ter média móvel 7d');
assert(ui.includes('s/ base'), 'baseline zero deve mostrar s/ base');
assert(ui.includes('gold.bdr_daily_target'), 'UI deve explicar fonte de metas');
assert(ui.includes('LinkedIn live depende'), 'quality check deve declarar limitação LinkedIn live');
assert(ui.includes('Object.keys(r).forEach(function (key) { by[r.date][key] = r[key]; })'), 'today live deve mutar a linha já referenciada pelo array do gráfico');
assert(html.includes('/bdr-workload.js?v=7'), 'cache busting deve estar em v=7');

console.log('test-bdr-workload ok');
