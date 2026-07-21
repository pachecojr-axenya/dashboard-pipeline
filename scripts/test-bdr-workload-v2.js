'use strict';
const assert = require('assert');
const bq = require('../lib/bigquery');
const sem = require('../api/bdr-workload-semantic')._test;
const pen = require('../api/bdr-workload-penetration')._test;
const cmp = require('../api/bdr-workload-compare')._test;
const drill = require('../api/bdr-workload-drill')._test;

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
  assert.deepStrictEqual(bq.decodeCell([{ v: 'grande' }, { v: 'pme' }], { mode: 'REPEATED', type: 'STRING' }), ['grande', 'pme']);
  assert.deepStrictEqual(sem.CHANNELS, ['calls', 'emails', 'whatsapp', 'linkedin', 'meetings']);
  const parsedSem = sem.parse(req('v=2&since=2026-07-01&until=2026-07-02&porte=grande&segmento=Tech&persona=RH'));
  assert.equal(parsedSem.porte, 'grande');
  assert.equal(parsedSem.segmento, 'Tech');
  assert.equal(parsedSem.persona, 'RH');
  assert.equal(sem.isBusiness('2026-07-20'), true);
  assert.equal(sem.isBusiness('2026-07-19'), false);
  assert.equal(sem.normalizeTimestamp('1784567311.617586'), '2026-07-20T17:08:31.618Z');
  const r = sem.reactivityFromRows([{ has_touch: true, hours_to_first_touch: 0 }, { has_touch: true, hours_to_first_touch: 2 }, { has_touch: false }]);
  assert.equal(r.p50Hours, 1);
  assert.equal(r.p75Hours, 1.5);
  assert.equal(r.buckets.lt_1h, 1);
  assert.equal(r.buckets.sem_toque, 1);
  const liveAggregate = sem.aggregateLivePayload({ team: ['Thauan Pontes'], activities: [{ tipo: 'emails', direction: 'OUTGOING_EMAIL', bdr: 'Thauan Pontes', contato_id: '123' }, { tipo: 'calls', bdr: 'Thauan Pontes', telefone: 'proibido' }], contactsCreated: [{ bdr: 'Thauan Pontes', nome: 'não deve vazar', id: '456' }] }, '2026-07-20', { bdr: 'Thauan Pontes', channels: sem.CHANNELS });
  assert.equal(liveAggregate[0].emails, 1);
  assert.equal(liveAggregate[0].calls, 1);
  assert.equal(liveAggregate[0].contactsInserted, 1);
  assert.equal(liveAggregate[0].leadsCreated, undefined);
  assert(!/não deve vazar|telefone|contato_id|123|456/.test(JSON.stringify(liveAggregate)), 'agregado live não contém PII/IDs nominais');
  await withBqStub((sql, params, n) => {
    if (sql.includes('bdr_workload_reactivity_v2')) return [{ owner_name: 'Thauan Pontes', has_touch: true, hours_to_first_touch: 0 }, { owner_name: 'Thauan Pontes', has_touch: false }];
    if (sql.includes('ARRAY_AGG')) return [{ portes: ['grande'], segmentos: ['Tech'], personas: ['RH'] }];
    if (n === 1) return [{ metric_date: '2026-07-17', owner_name: 'Thauan Pontes', calls: '2', calls_conversation: '1', calls_dial: '1', emails: '3', whatsapp: '1', linkedin: '0', meetings: '1', activities_total: '7', companies_touched: '2', contacts_touched: '5', companies_inserted: '1', contacts_inserted: '4', attempted: '6', crm_movements: '10', connected: '3', qualified: '2', disqualified: '1', sql_deals: '1', refreshed_at: '2026-07-17T10:00:00Z' }];
    return [];
  }, async (calls) => {
    const out = await sem.build(sem.parse(req('v=2&since=2026-07-17&until=2026-07-17&channels=calls,emails&porte=grande&segmento=Tech&persona=RH')));
    assert.equal(out.data.rhythm.totals.total, 5);
    assert.equal(out.data.rhythm.totals.companiesInserted, 1);
    assert.equal(out.data.rhythm.totals.contactsInserted, 4);
    assert.equal(out.data.rhythm.totals.attempted, 6);
    assert.equal(out.data.rhythm.totals.crmMovements, 10);
    assert.equal(out.data.rhythm.totals.connected, 3);
    assert.equal(out.data.reactivity.buckets.lt_1h, 1);
    assert(calls[0].sql.includes('bdr_workload_daily_dimension_v2'));
    assert(calls[0].sql.includes('persona'));
    assert(!calls[0].sql.includes('leads_created'));
    assert(!calls[0].sql.includes('companies_created'));
  });

  assert.equal(pen.bucketExact(0), '0');
  assert.equal(pen.bucketExact(6), '6+');
  assert.equal(pen.grouped('2'), '2–3');
  const buckets = pen.buildBuckets([{ contacts_real: 0, companies: 2, converted: 0 }, { contacts_real: 1, companies: 3, converted: 1 }, { contacts_real: 6, companies: 5, converted: 2 }]);
  assert.equal(buckets.denominatorEligible, 10);
  assert.equal(buckets.exact.find((x) => x.label === '0').companies, 2);
  assert.equal(pen.wilson(2, 10).rate, 0.2);
  assert.deepStrictEqual(pen.bdrIds('Cintia Rodrigues').sort(), ['86900152', '87213208']);
  await withBqStub((sql) => sql.includes('company_owner') ? [{ porte: 'grande', segmento: 'Tech', contacts_touched: '0', companies: '2', converted: '0', contacts_eligible: '3', contacts_touched_sum: '0', touches_real: '0', refreshed_at: '2026-07-17T10:00:00Z' }] : [{ personas: ['RH'], portes: ['grande'], segmentos: ['Tech'] }], async (calls) => {
    const out = await pen.build(pen.parse(req('v=2&since=2026-07-01&until=2026-07-31&persona=RH&porte=grande&segmento=Tech')));
    assert.equal(out.coverage.denominatorEligible, 2);
    assert.equal(out.data.bucketsExact.find((x) => x.label === '0').companies, 2);
    assert(calls[0].sql.includes('bdr_workload_company_contact_v2'));
    assert(calls[0].sql.includes('company_owner'));
    assert(!JSON.stringify(calls[0].params).includes('ARRAY'));
  });

  assert.equal(cmp.businessDays('2026-07-20', '2026-07-24'), 5);
  assert.equal(cmp.metricExpression('crm', []), 'SUM(crm_movements)');
  assert.equal(cmp.metricExpression('insercao', []), 'SUM(companies_inserted) + SUM(contacts_inserted)');
  ['ritmo', 'insercao', 'crm', 'contato_efetivo', 'sql'].forEach((domain) => assert(cmp.SUPPORTED_DOMAINS.includes(domain)));
  const crmComps = cmp.makeComponents([{ period_key: 'A', owner_name: 'Thauan Pontes', crm_movements: 10, attempted_total: 7, connected_total: 2, qualified_total: 1, disqualified_total: 1, metric: 10 }, { period_key: 'B', owner_name: 'Thauan Pontes', crm_movements: 12, attempted_total: 8, connected_total: 3, qualified_total: 2, disqualified_total: 1, metric: 12 }], { domain: 'crm', breakdown: 'none', channels: [] });
  assert.equal(crmComps.length, 1);
  assert.equal(crmComps[0].key, 'crmMovements');
  assert.equal(crmComps[0].delta, 2);
  await withBqStub([{ period_key: 'A', metric_date: '2026-07-20', owner_name: 'Thauan Pontes', crm_movements: '10', attempted_total: '7', connected_total: '2', qualified_total: '1', disqualified_total: '1', metric: '10', refreshed_at: '2026-07-20T09:00:00Z' }, { period_key: 'B', metric_date: '2026-07-21', owner_name: 'Thauan Pontes', crm_movements: '12', attempted_total: '8', connected_total: '3', qualified_total: '2', disqualified_total: '1', metric: '12', refreshed_at: '2026-07-21T09:00:00Z' }], async (calls) => {
    const out = await cmp.build(cmp.parse(req('v=2&aSince=2026-07-20&aUntil=2026-07-20&bSince=2026-07-21&bUntil=2026-07-21&domain=crm&breakdown=none')));
    assert.equal(out.data.totalA, 10);
    assert.equal(out.data.totalB, 12);
    assert.equal(out.invariant.matches, true);
    assert.equal(out.data.waterfall.find((x) => x.key === 'attempted').b, 8);
    assert(calls[0].sql.includes('bdr_workload_daily_dimension_v2'));
    assert(calls[0].sql.includes('crm_movements'));
  });

  assert.deepStrictEqual(drill.parseContext('channel:calls'), { type: 'channel', value: 'calls' });
  assert.throws(() => drill.parse(req('kind=activity&since=2026-07-01&until=2026-07-02&context=foo:bar')), /context inválido/);
  const dq = drill.queryFor(drill.parse(req('kind=activity&since=2026-07-01&until=2026-07-02&context=channel:calls&limit=500')), false);
  assert(dq.sql.includes('bdr_workload_touch_detail_v2'));
  assert(dq.sql.includes('x.channel = @contextValue'));
  assert.equal(dq.params.find((p) => p.name === 'limit').value, 50);
  const crmQ = drill.queryFor(drill.parse(req('kind=crm&since=2026-07-01&until=2026-07-02&context=event:connected')), false);
  assert(crmQ.sql.includes('bdr_workload_crm_events_v2'));
  assert(crmQ.sql.includes('x.event_type = @contextValue'));
  const clean = drill.sanitizeRow({ company_id: '1', contact_id: '2', deal_id: '3', email: 'x@y.com', phone: '123', contact_name: 'Pessoa', company_name: 'Empresa', owner_name: 'Thauan Pontes' });
  assert.equal(clean.companyUrl, 'https://app.hubspot.com/contacts/44715285/record/0-2/1');
  assert.equal(clean.dealUrl, 'https://app.hubspot.com/contacts/44715285/record/0-3/3');
  assert.equal(clean.contactUrl, undefined);
  assert.equal(clean.contact_id, undefined);
  assert.equal(clean.company_name, 'Empresa');
  assert(!/x@y.com|123|Pessoa/.test(JSON.stringify(clean)));

  console.log('PASS bdr-workload-v2 API contract tests');
})().catch((error) => { console.error(error); process.exit(1); });
