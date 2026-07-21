'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const bq = require('../lib/bigquery');
const sem = require('../api/bdr-workload-semantic')._test;
const pen = require('../api/bdr-workload-penetration')._test;
const cmp = require('../api/bdr-workload-compare')._test;
const cfg = require('../api/bdr-workload-config')._test;
const callsApi = require('../api/bdr-workload-calls')._test;

function req(q) { return { url: '/?' + q }; }
async function withBqStub(rows, fn) {
  const oldConfigured = bq.isConfigured;
  const oldQuery = bq.query;
  const calls = [];
  bq.isConfigured = () => true;
  bq.query = async (sql, params) => {
    calls.push({ sql, params });
    return { rows: typeof rows === 'function' ? rows(sql, params, calls.length) : rows };
  };
  try { return await fn(calls); }
  finally { bq.isConfigured = oldConfigured; bq.query = oldQuery; }
}

(async function main() {
  assert.deepStrictEqual(sem.CHANNELS, ['calls', 'emails', 'whatsapp', 'linkedin', 'meetings']);
  assert.throws(() => sem.parse(req('v=2&since=2026-07-01&until=2026-07-02&persona=RH')), /não suportados/);
  assert.equal(sem.isBusiness('2026-07-20'), true);
  assert.equal(sem.isBusiness('2026-07-19'), false);
  assert.equal(sem.normalizeTimestamp('1784567311.617586'), '2026-07-20T17:08:31.618Z');
  const liveAggregate = sem.aggregateLivePayload({
    team: ['Thauan Pontes'],
    activities: [
      { tipo: 'emails', direction: 'INCOMING_EMAIL', bdr: 'Thauan Pontes', nome: 'não deve vazar' },
      { tipo: 'emails', direction: 'OUTGOING_EMAIL', bdr: 'Thauan Pontes', contato_id: '123' },
      { tipo: 'calls', bdr: 'Thauan Pontes', telefone: 'proibido' },
    ],
    contactsCreated: [{ bdr: 'Thauan Pontes', nome: 'não deve vazar', id: '456' }],
  }, '2026-07-20', { bdr: 'Thauan Pontes', channels: sem.CHANNELS });
  assert.equal(liveAggregate[0].emails, 1, 'incoming é excluído do ritmo live');
  assert.equal(liveAggregate[0].calls, 1);
  assert.equal(liveAggregate[0].leadsCreated, 1);
  assert(!/não deve vazar|telefone|contato_id|123|456/.test(JSON.stringify(liveAggregate)), 'agregado live não contém PII/IDs nominais');
  await withBqStub([
    { metric_date: '2026-07-20', owner_name: 'Thauan Pontes', calls: '2', emails: '3', whatsapp: '1', linkedin: '0', meetings: '1', leads_created: '4', sql_deals: '1', refreshed_at: '2026-07-20T10:00:00Z' },
    { metric_date: '2026-07-20', owner_name: 'Owner Fora', calls: '99', emails: '99', whatsapp: '99', linkedin: '99', meetings: '99', leads_created: '99', sql_deals: '99', refreshed_at: '2026-07-20T11:00:00Z' },
  ], async (calls) => {
    const out = await sem.build(sem.parse(req('v=2&since=2026-07-20&until=2026-07-20&channels=calls,emails')));
    assert.equal(out.data.rhythm.totals.total, 5, 'total respeita canais selecionados e owner canônico');
    assert.equal(out.data.rhythm.totals.leadsCreated, 4);
    assert.equal(out.data.rhythm.totals.companiesCreated, null);
    assert.equal(out.unsupportedMetrics.statusTransitions.value, null);
    assert.equal(out.source.refreshedAt, '2026-07-20T10:00:00.000Z');
    assert(!calls[0].sql.includes('companies_created'));
    assert(!calls[0].sql.includes('contacts_created'));
    assert(!calls[0].sql.includes('status_transitions'));
    assert(!calls[0].sql.includes('connected_transitions'));
    assert(calls[0].sql.includes('leads_created'));
  });
  await withBqStub((sql, params) => {
    const since = params.find((p) => p.name === 'since').value;
    if (since === '2026-07-10') {
      return [{ metric_date: '2026-07-10', owner_name: 'Thauan Pontes', calls: '7', emails: '3', whatsapp: '0', linkedin: '0', meetings: '0', leads_created: '1', sql_deals: '0', refreshed_at: '1783699200' }];
    }
    return [{ metric_date: '2026-07-09', owner_name: 'Thauan Pontes', calls: '4', emails: '2', whatsapp: '0', linkedin: '0', meetings: '0', leads_created: '1', sql_deals: '0', refreshed_at: '1783612800' }];
  }, async () => {
    const out = await sem.build(sem.parse(req('v=2&since=2026-07-10&until=2026-07-10&bdr=Thauan%20Pontes')));
    const row = out.data.management[0];
    assert.equal(row.previousTotal, 6);
    assert.equal(row.deltaHistorical, 4);
    assert(/T/.test(out.source.refreshedAt), 'freshness BQ normalizada para ISO');
  });

  assert.equal(pen.bucketExact(0), '0');
  assert.equal(pen.bucketExact(6), '6+');
  assert.equal(pen.grouped('2'), '2–3');
  assert.equal(pen.grouped('5'), '4–5');
  const buckets = pen.buildBuckets([{ contacts_real: 0, companies: 2, converted: 0 }, { contacts_real: 1, companies: 3, converted: 1 }, { contacts_real: 6, companies: 5, converted: 2 }]);
  assert.equal(buckets.denominatorObserved, 10);
  assert.equal(buckets.exact.find((x) => x.label === '0').companies, 2);
  assert.equal(buckets.grouped.find((x) => x.label === '6+').companies, 5);
  const assoc = pen.association([{ contacts_real: 0, companies: 9, converted: 1 }, { contacts_real: 1, companies: 10, converted: 2 }, { contacts_real: 2, companies: 30, converted: 9 }]);
  assert.equal(assoc.find((x) => x.bucket === '0').rate, null);
  assert.equal(assoc.find((x) => x.bucket === '1').threshold, 'exploratory');
  assert.equal(assoc.find((x) => x.bucket === '2').threshold, 'descriptive');
  assert.throws(() => pen.parse(req('v=2&since=2026-07-01&until=2026-07-02&segmento=Tech')), /unsupported/);
  assert.throws(() => pen.parse(req('v=2&since=2026-07-01&until=2026-07-02&cohort=carteira_inicial')), /observed_snapshot/);
  assert.deepStrictEqual(pen.bdrIds('Cintia Rodrigues').sort(), ['86900152', '87213208']);

  assert.equal(cmp.businessDays('2026-07-20', '2026-07-24'), 5);
  assert.equal(cmp.days('2026-07-20', '2026-07-24'), 5);
  assert.throws(() => cmp.parse(req('v=2&aSince=2026-07-01&aUntil=2026-07-02&bSince=2026-07-03&bUntil=2026-07-04&domain=crm&breakdown=none')), /não suportado/);
  assert.equal(cmp.metricExpression('insercao', []), 'SUM(leads_created)');
  assert.equal(cmp.metricExpression('ritmo', ['calls', 'emails']), 'SUM(calls_total) + SUM(emails_sent_total)');
  const comps = cmp.makeComponents([
    { period_key: 'A', calls_total: 2, emails_sent_total: 3, whatsapp_total: 7, linkedin_total: 1, meetings_total: 0, owner_name: 'Thauan Pontes', metric: 5 },
    { period_key: 'B', calls_total: 4, emails_sent_total: 5, whatsapp_total: 9, linkedin_total: 1, meetings_total: 2, owner_name: 'Thauan Pontes', metric: 9 },
  ], { domain: 'ritmo', breakdown: 'canal', channels: ['calls', 'emails'] });
  assert.equal(comps.reduce((s, c) => s + c.delta, 0), 4, 'invariante respeita canais selecionados');
  await withBqStub([
    { period_key: 'A', metric_date: '2026-07-20', owner_name: 'Thauan Pontes', calls_total: '2', emails_sent_total: '3', whatsapp_total: '9', linkedin_total: '0', meetings_total: '0', metric: '5', refreshed_at: '2026-07-20T09:00:00Z' },
    { period_key: 'B', metric_date: '2026-07-21', owner_name: 'Thauan Pontes', calls_total: '4', emails_sent_total: '5', whatsapp_total: '9', linkedin_total: '0', meetings_total: '0', metric: '9', refreshed_at: '2026-07-21T09:00:00Z' },
    { period_key: 'B', metric_date: '2026-07-21', owner_name: 'Owner Fora', calls_total: '100', emails_sent_total: '100', whatsapp_total: '100', linkedin_total: '100', meetings_total: '100', metric: '500', refreshed_at: '2026-07-21T10:00:00Z' },
  ], async (calls) => {
    const out = await cmp.build(cmp.parse(req('v=2&aSince=2026-07-20&aUntil=2026-07-20&bSince=2026-07-21&bUntil=2026-07-21&domain=ritmo&breakdown=none&channels=calls,emails')));
    assert.equal(out.data.totalA, 5);
    assert.equal(out.data.totalB, 9);
    assert.equal(out.invariant.matches, true);
    assert.equal(out.source.refreshedAt, '2026-07-21T09:00:00.000Z');
    assert.equal(out.data.components[0].delta, 4, 'delta absoluto permanece assinado');
    assert.equal(out.data.componentsNormalized[0].deltaPerBusinessDay, 4, 'delta normalizado permanece assinado');
    assert(!calls[0].sql.includes('status_transitions'));
    assert(!calls[0].sql.includes('companies_created'));
    assert(calls[0].sql.includes('calls_total'));
  });

  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'bdr-workload-v2.js'), 'utf8');
  const legacyJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'bdr-workload.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'bdr-workload.html'), 'utf8');
  assert.equal(cfg.enabledFromEnv(undefined), false);
  assert.equal(cfg.enabledFromEnv('false'), false);
  assert.equal(cfg.enabledFromEnv('0'), false);
  assert.equal(cfg.enabledFromEnv('true'), true);
  const aggregateCalls = callsApi.paginationOptions(new URLSearchParams(''));
  assert.equal(aggregateCalls.detail, false, 'drill padrão retorna somente agregados');
  assert.equal(aggregateCalls.limit, 50);
  const pagedCalls = callsApi.paginationOptions(new URLSearchParams('detail=1&page=2&limit=5000'));
  assert.deepStrictEqual(pagedCalls, { detail: true, page: 2, limit: 50 });
  const callsSummary = callsApi.summarizeRows([
    { properties: { hs_call_duration: '61000', hs_call_disposition: 'ok' } },
    { properties: { hs_call_duration: '0', hs_call_disposition: 'miss' } },
  ], { ok: 'Conectada', miss: 'Sem atender' });
  assert.deepStrictEqual({ total: callsSummary.total, conversas: callsSummary.conversas, discagens: callsSummary.discagens, pctConversa: callsSummary.pctConversa }, { total: 2, conversas: 1, discagens: 1, pctConversa: 50 });
  assert(js.includes('Pulso & Reatividade'));
  assert(js.includes('Atividades & Canais'));
  assert(js.includes('Gestão por BDR'));
  assert(js.includes('Penetração & ICP'));
  assert(js.includes('Evolução A×B'));
  assert(js.includes('role="tablist"'));
  assert(js.includes('aria-sort'));
  assert(js.includes('openInfo'));
  assert(js.includes('leads_created'));
  assert(js.includes('CRM indisponível'));
  assert(js.includes("v1Query.set('workload', 'v1')"));
  assert(js.includes('/api/bdr-workload-config'));
  assert(js.includes('BDR_WORKLOAD_V2_ASSET_LOADED'));
  assert(legacyJs.includes('if (window.BDR_WORKLOAD_V2_ASSET_LOADED) return'), 'v1 assume fallback se asset v2 falhar');
  assert(js.includes("WorkloadBDRRouter.setMode('v2')"));
  assert(js.includes('Delta assinado'));
  assert(js.includes('data.byDesfecho'));
  assert(js.includes("event.key === 'Escape'"));
  assert(!/% da meta|gap para meta|Meta:/.test(js));
  assert(html.includes('WorkloadBDRRouter.help()'));
  assert(html.includes('WorkloadBDRRouter.refresh()'));
  assert(html.includes('/bdr-workload.js?v=9'));
  assert(html.includes('/bdr-workload-v2.js?v=1'));
  console.log('PASS bdr-workload-v2 tests');
})().catch((error) => { console.error(error); process.exit(1); });
